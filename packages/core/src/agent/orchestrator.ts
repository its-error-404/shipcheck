/**
 * Orchestrator (docs/DESIGN.md).
 *
 * Phase 1  discovery agent → plan (validated by code)
 * Phase 2  code reads target + rules from the manifest in Jira
 * Phase 3  one fresh, bounded investigator agent per requirement
 * Phase 4  overall decision computed in code
 *
 * Failures are contained and reported: a failed investigation becomes
 * INSUFFICIENT_EVIDENCE with the reason; a daily quota stops new work and
 * leaves the rest NOT ASSESSED; a failed discovery aborts with no report of
 * decisions (never a confident wrong report).
 */
import pLimit from "p-limit";
import { DISCOVERY_BUDGET, INVESTIGATION_BUDGET } from "../constants/agent";
import { TRACE_EVENTS } from "../constants/trace";
import type { JiraReader } from "../jira/client";
import { EvidenceLedger } from "../ledger";
import type { LlmClient } from "../llm/types";
import type { Budget } from "../models/agent";
import type {
  AgentStats,
  AssessmentRequest,
  AssessmentResult,
  EvidenceItem,
  RequirementResult,
} from "../models/assessment";
import type { Target } from "../models/dataset";
import type { DecisionInput } from "../models/decision";
import { ScopedJiraView } from "../tools/jira-view";
import { DISCOVERY_TOOLS, INVESTIGATION_TOOLS } from "../tools/registry";
import type { Plan } from "../tools/terminal";
import type { TraceSink } from "../trace";
import { runAgent, type AgentRunResult } from "./loop";
import { parseCriterion, parseMandatory, parseTarget } from "./manifest";
import { computeOverall } from "./overall";
import {
  PROMPT_VERSION,
  discoverySystemPrompt,
  discoveryTask,
  investigatorSystemPrompt,
  investigatorTask,
} from "./prompts";

const EXCERPT_CHARS = 280;

export interface AssessOptions extends AssessmentRequest {
  jira: JiraReader;
  llm: LlmClient;
  trace: TraceSink;
  runId: string;
  concurrency?: number;
  budgets?: { discovery?: Partial<Budget>; investigation?: Partial<Budget> };
  /** Previously decided results to reuse (resume after a quota stop). Keyed by Jira key. */
  resume?: ReadonlyMap<string, RequirementResult>;
  /** Assess only these requirements (source IDs like REQ-04, or Jira keys); discovery still runs. For quick demos. */
  only?: readonly string[];
  /** Called as soon as each requirement finishes (used to persist results incrementally). */
  onRequirement?: (result: RequirementResult, transcript?: AgentRunResult<unknown>["transcript"]) => Promise<void>;
  log?: (message: string) => void;
}

const statsOf = (r: AgentRunResult<unknown>, model?: string): AgentStats => ({
  model,
  stopReason: r.stopReason,
  error: r.error,
  turns: r.turns,
  toolCalls: r.toolCalls,
  toolErrors: r.toolErrors,
  inputTokens: r.usage.inputTokens,
  outputTokens: r.usage.outputTokens,
  cachedTokens: r.usage.cachedTokens ?? 0,
  durationMs: r.durationMs,
  llmLatencyMs: r.llmLatencyMs,
  waitedMs: r.waitedMs,
});

/** Turns the model's citations into evidence items quoted from the ledger (Jira data). */
const enrichEvidence = (decision: DecisionInput, ledger: EvidenceLedger): EvidenceItem[] =>
  decision.evidence.map((e) => {
    const issue = ledger.issues.get(e.issue_key);
    const comment = e.comment_id ? ledger.comments.get(e.comment_id) : undefined;
    return {
      issueKey: e.issue_key,
      sourceId: issue?.sourceId ?? comment?.sourceId,
      issueSummary: issue?.summary,
      commentId: e.comment_id,
      position: comment?.position ? `${comment.position}/${comment.total ?? "?"}` : undefined,
      recordedAt: comment?.recordedAt,
      actor: comment?.actor,
      role: comment?.role,
      excerpt: comment ? truncate(comment.body, EXCERPT_CHARS) : undefined,
      stance: e.stance,
      why: e.why,
    };
  });

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Evidence the agent examined before failing, so the report shows what was looked at. */
const examinedEvidence = (ledger: EvidenceLedger): EvidenceItem[] =>
  [...ledger.issues.values()].map((i) => ({
    issueKey: i.key,
    sourceId: i.sourceId,
    issueSummary: i.summary,
    stance: "inconclusive" as const,
    why: "Examined by the agent before it stopped; no decision was recorded.",
  }));

export const assess = async (o: AssessOptions): Promise<AssessmentResult> => {
  const log = o.log ?? (() => {});
  const startedAt = new Date().toISOString();
  const budgets = {
    discovery: { ...DISCOVERY_BUDGET, ...o.budgets?.discovery },
    investigation: { ...INVESTIGATION_BUDGET, ...o.budgets?.investigation },
  };
  const request: AssessmentRequest = { projectKey: o.projectKey, scopeLabel: o.scopeLabel, release: o.release };
  const result: AssessmentResult = {
    runId: o.runId,
    status: "COMPLETED",
    startedAt,
    finishedAt: startedAt,
    request,
    model: o.llm.model,
    provider: o.llm.provider,
    promptVersion: PROMPT_VERSION,
    budgets,
    requirements: [],
    runIssues: [],
  };
  const abort = (reason: string): AssessmentResult => {
    log(`✗ Aborted: ${reason}`);
    result.status = "ABORTED";
    result.abortReason = reason;
    result.finishedAt = new Date().toISOString();
    o.trace.emit({ type: TRACE_EVENTS.runEnd, status: result.status, reason });
    return result;
  };
  const phase = (name: string, detail?: Record<string, unknown>) => {
    log(`▸ ${name}`);
    o.trace.emit({ type: TRACE_EVENTS.runPhase, phase: name, ...detail });
  };

  o.trace.emit({
    type: TRACE_EVENTS.runStart,
    runId: o.runId,
    request,
    model: o.llm.model,
    promptVersion: PROMPT_VERSION,
  });

  // ── Preflight ──────────────────────────────────────────────────────────
  phase("preflight");
  const view = new ScopedJiraView(o.jira, o.projectKey, o.scopeLabel);
  try {
    await o.jira.myself();
    await o.jira.getProjectOrExplain(o.projectKey);
    result.scopeIssueCount = (await view.loadScope()).size;
  } catch (e) {
    return abort(`Jira preflight failed: ${(e as Error).message}`);
  }
  if (!result.scopeIssueCount)
    return abort(`No issues found in project ${o.projectKey} with label "${o.scopeLabel}". Run the importer first.`);
  log(`  ${result.scopeIssueCount} issues in scope`);
  o.trace.emit({ type: TRACE_EVENTS.runPhase, phase: "scope", issues: result.scopeIssueCount });

  // ── Phase 1: discovery ─────────────────────────────────────────────────
  phase("discovery");
  const promptInput = { projectKey: o.projectKey, scopeLabel: o.scopeLabel, release: o.release };
  const discovery = await runAgent<Plan>({
    label: "discovery",
    llm: o.llm,
    system: discoverySystemPrompt(promptInput),
    task: discoveryTask(promptInput),
    tools: DISCOVERY_TOOLS,
    ctx: { view, ledger: new EvidenceLedger(), trace: o.trace },
    budget: budgets.discovery,
    trace: o.trace,
  });
  result.discovery = statsOf(discovery, o.llm.model);
  if (discovery.stopReason !== "terminal" || !discovery.terminal)
    return abort(
      `Discovery did not produce a valid plan (${discovery.stopReason}${discovery.error ? `: ${discovery.error}` : ""}).`,
    );
  const plan = discovery.terminal;
  if (o.only?.length) {
    const wanted = new Set(o.only.map((x) => x.trim().toUpperCase()));
    const selected = plan.requirements.filter(
      (r) => wanted.has(r.key.toUpperCase()) || wanted.has((r.sourceId ?? "").toUpperCase()),
    );
    const known = new Set(plan.requirements.flatMap((r) => [r.key.toUpperCase(), (r.sourceId ?? "").toUpperCase()]));
    const unknown = [...wanted].filter((w) => !known.has(w));
    if (unknown.length || !selected.length)
      return abort(
        `--only: ${unknown.join(", ") || "nothing"} not among the manifest's requirements (${plan.requirements.map((r) => r.sourceId ?? r.key).join(", ")}).`,
      );
    result.partial = { selected: selected.map((r) => r.sourceId ?? r.key), total: plan.requirements.length };
    plan.requirements = selected;
  }
  log(`  manifest ${plan.manifestKey} · ${plan.requirements.length} requirements`);
  o.trace.emit({
    type: TRACE_EVENTS.runPhase,
    phase: "plan",
    manifestKey: plan.manifestKey,
    manifestSourceId: plan.manifestSourceId,
    requirements: plan.requirements.length,
  });

  // ── Phase 2: target + rules from the manifest (code, not the model) ────
  phase("manifest");
  const manifest = await view.getIssue(plan.manifestKey);
  const target: Target | undefined = parseTarget(manifest.description);
  if (!target) return abort(`Manifest ${plan.manifestKey} has no parseable "Target: {...}" line.`);
  if (target.release.toLowerCase() !== o.release.toLowerCase())
    return abort(`Manifest ${plan.manifestKey} targets ${target.release}, not the requested ${o.release}.`);
  result.manifest = { key: manifest.key, sourceId: manifest.sourceId, summary: manifest.summary };
  result.target = target;
  o.trace.emit({ type: TRACE_EVENTS.runPhase, phase: "target", target });
  const system = investigatorSystemPrompt({
    target,
    manifestKey: manifest.key,
    manifestSourceId: manifest.sourceId,
    rulesText: manifest.description,
  });

  // ── Phase 3: one investigator per requirement ──────────────────────────
  phase("investigation", { requirements: plan.requirements.length, concurrency: o.concurrency ?? 1 });
  let quotaExhausted = false;
  const limit = pLimit(o.concurrency ?? 1);

  const publish = async (outcome: RequirementResult, transcript?: AgentRunResult<unknown>["transcript"]) => {
    o.trace.emit({
      type: TRACE_EVENTS.requirementResult,
      key: outcome.key,
      sourceId: outcome.sourceId,
      summary: outcome.summary,
      decision: outcome.decision,
      status: outcome.status,
      stopReason: outcome.agent?.stopReason,
      turns: outcome.agent?.turns,
      toolCalls: outcome.agent?.toolCalls,
      durationMs: outcome.agent?.durationMs,
    });
    await o.onRequirement?.(outcome, transcript);
    return outcome;
  };

  const investigate = async (req: Plan["requirements"][number]): Promise<RequirementResult> => {
    const issue = await view.getIssue(req.key);
    const base = {
      key: req.key,
      sourceId: req.sourceId,
      summary: req.summary,
      criterion: parseCriterion(issue.description),
      mandatory: parseMandatory(issue.description),
    };
    if (base.mandatory === undefined)
      result.runIssues.push(`${req.sourceId ?? req.key}: "Mandatory" not stated; treated as mandatory.`);

    const prior = o.resume?.get(req.key);
    if (prior && (prior.status === "decided" || prior.status === "resumed")) {
      log(`  ↺ ${req.sourceId ?? req.key}: reused ${prior.decision} from previous run`);
      return publish({ ...prior, status: "resumed" });
    }
    if (quotaExhausted) {
      return publish({
        ...base,
        status: "not_assessed",
        decision: "INSUFFICIENT_EVIDENCE",
        explanation:
          "Not assessed: the LLM daily quota was exhausted earlier in this run. Rerun with --resume to complete it.",
        evidence: [],
        outstanding: ["Run the investigation for this requirement (resume the run after the quota resets)."],
        anomalies: [],
      });
    }

    const ledger = new EvidenceLedger();
    const run = await runAgent<DecisionInput>({
      label: req.sourceId ?? req.key,
      llm: o.llm,
      system,
      task: investigatorTask(req),
      tools: INVESTIGATION_TOOLS,
      ctx: { view, target, ledger, trace: o.trace, requirementKey: req.key },
      budget: budgets.investigation,
      trace: o.trace,
    });
    if (run.stopReason === "quota_exhausted") quotaExhausted = true;

    const outcome: RequirementResult =
      run.stopReason === "terminal" && run.terminal
        ? {
            ...base,
            status: "decided",
            decision: run.terminal.decision,
            explanation: run.terminal.explanation,
            evidence: enrichEvidence(run.terminal, ledger),
            outstanding: run.terminal.outstanding,
            anomalies: run.terminal.anomalies,
            agent: statsOf(run, o.llm.model),
          }
        : {
            ...base,
            status: "agent_failed",
            decision: "INSUFFICIENT_EVIDENCE",
            explanation: `The agent did not complete this investigation (stop reason: ${run.stopReason}${run.error ? `; ${run.error}` : ""}). No decision was recorded, so the requirement cannot be considered verified.`,
            evidence: examinedEvidence(ledger),
            outstanding: ["Re-run the investigation; the agent stopped before recording a decision."],
            anomalies: [],
            agent: statsOf(run, o.llm.model),
          };
    if (outcome.status === "agent_failed")
      result.runIssues.push(
        `${outcome.sourceId ?? outcome.key}: agent stopped (${run.stopReason})${run.error ? `: ${run.error}` : ""}`,
      );
    log(
      `  ${outcome.status === "decided" ? "✓" : "✗"} ${outcome.sourceId ?? outcome.key}: ${outcome.decision}${outcome.status === "decided" ? "" : ` (${run.stopReason})`}`,
    );
    return publish(outcome, run.transcript);
  };

  const settled = await Promise.allSettled(plan.requirements.map((req) => limit(() => investigate(req))));
  result.requirements = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    // Defensive: an unexpected exception in one investigation must not lose the others.
    const req = plan.requirements[i]!;
    const reason = (s.reason as Error)?.message ?? String(s.reason);
    result.runIssues.push(`${req.sourceId ?? req.key}: unexpected error: ${reason}`);
    return {
      key: req.key,
      sourceId: req.sourceId,
      summary: req.summary,
      status: "agent_failed",
      decision: "INSUFFICIENT_EVIDENCE",
      explanation: `Investigation failed with an unexpected error: ${reason}`,
      evidence: [],
      outstanding: ["Re-run the investigation."],
      anomalies: [],
    } satisfies RequirementResult;
  });
  if (quotaExhausted)
    result.runIssues.push("LLM daily quota exhausted during the run; remaining requirements were not assessed.");

  // ── Phase 4: overall decision (code) ───────────────────────────────────
  phase("aggregate");
  result.overall = computeOverall(result.requirements);
  result.finishedAt = new Date().toISOString();
  o.trace.emit({ type: TRACE_EVENTS.runEnd, status: result.status, overall: result.overall.decision });
  log(`■ Overall: ${result.overall.decision}. ${result.overall.reason}`);
  return result;
};
