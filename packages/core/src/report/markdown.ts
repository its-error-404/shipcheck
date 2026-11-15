/**
 * Human-readable release-readiness report (docs/13-report.md).
 * Evidence lines are rendered from the ledger (Jira data); the model's own
 * words appear only in the clearly labelled explanation.
 */
import type { AssessmentResult, EvidenceItem, RequirementResult } from "../models/assessment";
import type { Decision, OverallDecision, Stance } from "../models/decision";
import type { RunMetrics } from "./metrics";

export interface ReportOptions {
  /** Jira site URL for issue links, e.g. https://your-site.atlassian.net */
  siteUrl?: string;
}

const DECISION_BADGE: Record<Decision, string> = {
  PASS: "✅ PASS",
  FAIL: "❌ FAIL",
  INSUFFICIENT_EVIDENCE: "⚠️ INSUFFICIENT_EVIDENCE",
};

const OVERALL_BADGE: Record<OverallDecision, string> = {
  BLOCKED: "⛔ BLOCKED",
  NEEDS_REVIEW: "🟡 NEEDS_REVIEW",
  READY: "🟢 READY",
};

const STANCE_LABEL: Record<Stance, string> = {
  supports_pass: "supports PASS",
  supports_fail: "supports FAIL",
  inconclusive: "inconclusive",
  not_applicable: "rejected (not applicable)",
};

const STATUS_NOTE: Record<RequirementResult["status"], string> = {
  decided: "",
  resumed: " _(reused from a previous run)_",
  agent_failed: " _(agent did not complete; see explanation)_",
  not_assessed: " _(not assessed)_",
};

const esc = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const fmtInt = (n: number): string => n.toLocaleString("en-US");

export const renderReport = (r: AssessmentResult, metrics?: RunMetrics, opts: ReportOptions = {}): string => {
  const link = (key: string) => (opts.siteUrl ? `[${key}](${opts.siteUrl.replace(/\/+$/, "")}/browse/${key})` : key);
  const ref = (key: string, sourceId?: string) => `${link(key)}${sourceId ? ` (${sourceId})` : ""}`;
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  push(`# Release Readiness Report: ${r.request.release}`, "");
  if (r.status === "ABORTED") {
    push(
      `> **Run aborted.** ${r.abortReason ?? ""}`,
      "",
      "No requirement decisions were produced. Fix the cause above and rerun.",
      "",
    );
  } else if (r.overall) {
    if (r.partial)
      push(
        `> **Partial run:** ${r.partial.selected.length} of ${r.partial.total} requirements assessed (${r.partial.selected.join(", ")}). The decision below covers only these and is **not a release decision**.`,
        "",
      );
    push(
      `## Overall decision${r.partial ? " (partial)" : ""}: ${OVERALL_BADGE[r.overall.decision]}`,
      "",
      r.overall.reason,
      "",
    );
    push(
      `Rule applied (computed in code, not by the model): any mandatory FAIL → BLOCKED; otherwise any INSUFFICIENT_EVIDENCE → NEEDS_REVIEW; otherwise READY.`,
      "",
      `**Counts:** ${r.overall.counts.PASS} PASS · ${r.overall.counts.FAIL} FAIL · ${r.overall.counts.INSUFFICIENT_EVIDENCE} INSUFFICIENT_EVIDENCE`,
      "",
    );
  }

  push("## Run", "");
  push("| | |", "|---|---|");
  push(`| Run ID | \`${r.runId}\` |`);
  push(
    `| Jira scope | project \`${r.request.projectKey}\`, label \`${r.request.scopeLabel}\`${r.scopeIssueCount ? ` (${r.scopeIssueCount} issues)` : ""} |`,
  );
  if (r.manifest) push(`| Manifest | ${ref(r.manifest.key, r.manifest.sourceId)} |`);
  if (r.target)
    push(
      `| Target (from manifest) | release \`${r.target.release}\` · commit \`${r.target.commit}\` · service \`${r.target.service}\` · environment \`${r.target.environment}\` · prompt \`${r.target.prompt}\` |`,
    );
  const models = [...new Set(r.requirements.map((q) => q.agent?.model).filter(Boolean))];
  const mixed = models.length > 1 || (models.length === 1 && models[0] !== r.model);
  push(
    `| Model | \`${r.model}\` via ${r.provider}${mixed ? ` (resumed run; models per requirement: ${models.map((m) => `\`${m}\``).join(", ")})` : ""} |`,
    `| Prompt version | ${r.promptVersion} |`,
  );
  push(`| Started / finished | ${r.startedAt} → ${r.finishedAt} |`, "");

  if (r.requirements.length) {
    push("## Summary", "");
    push("| Requirement | Acceptance criterion | Decision | Key evidence |", "|---|---|---|---|");
    for (const q of r.requirements) {
      const key = q.evidence.find((e) => e.stance === "supports_pass" || e.stance === "supports_fail") ?? q.evidence[0];
      const keyRef = key
        ? `${link(key.issueKey)}${key.sourceId ? ` ${key.sourceId}` : ""}${key.commentId ? ` · comment ${key.commentId}` : ""}`
        : "—";
      push(
        `| ${ref(q.key, q.sourceId)} ${esc(q.summary)} | ${esc(q.criterion ?? "—")} | ${DECISION_BADGE[q.decision]}${STATUS_NOTE[q.status]} | ${keyRef} |`,
      );
    }
    push("");

    push("## Requirement details", "");
    for (const q of r.requirements) push(...renderRequirement(q, ref));
  }

  if (r.runIssues.length) {
    push("## Run issues (reported honestly)", "");
    for (const issue of r.runIssues) push(`- ${issue}`);
    push("");
  } else {
    push("## Run issues", "", "None: every investigation completed and recorded a validated decision.", "");
  }

  if (metrics) push(...renderMetrics(metrics, r.requirements.filter((q) => q.status === "resumed").length));

  push(
    "---",
    "",
    "_Evidence excerpts, actors, roles and recorded timestamps are quoted from Jira via the evidence ledger; every cited comment was fetched by the agent during this run. Explanations are written by the model._",
    "",
  );
  return out.join("\n");
};

const renderRequirement = (q: RequirementResult, ref: (key: string, sourceId?: string) => string): string[] => {
  const out: string[] = [];
  out.push(`### ${q.sourceId ?? q.key}: ${q.summary}: ${DECISION_BADGE[q.decision]}${STATUS_NOTE[q.status]}`, "");
  out.push(`- **Jira:** ${ref(q.key, q.sourceId)}`);
  if (q.criterion) out.push(`- **Acceptance criterion:** ${q.criterion}`);
  out.push(
    `- **Mandatory:** ${q.mandatory === undefined ? "not stated (treated as mandatory)" : q.mandatory ? "yes" : "no"}`,
    "",
  );
  out.push(`**Explanation (model):** ${q.explanation}`, "");

  const supporting = q.evidence.filter((e) => e.stance !== "not_applicable");
  const rejected = q.evidence.filter((e) => e.stance === "not_applicable");
  if (supporting.length) {
    out.push("**Evidence relied on:**", "");
    for (const e of supporting) out.push(...renderEvidence(e, ref));
    out.push("");
  }
  if (rejected.length) {
    out.push("**Evidence considered and rejected:**", "");
    for (const e of rejected) out.push(...renderEvidence(e, ref));
    out.push("");
  }
  if (q.outstanding.length) {
    out.push("**Outstanding verification / clarification:**", "");
    for (const o of q.outstanding) out.push(`- ${o}`);
    out.push("");
  }
  if (q.anomalies.length) {
    out.push("**Anomalies flagged:**", "");
    for (const a of q.anomalies) out.push(`- ⚠️ ${a}`);
    out.push("");
  }
  if (q.agent) {
    const a = q.agent;
    out.push(
      `<sub>Agent${a.model ? ` (${a.model})` : ""}: ${a.turns} turns · ${a.toolCalls} tool calls (${a.toolErrors} errors) · ${fmtInt(a.inputTokens)} in / ${fmtInt(a.outputTokens)} out tokens · ${secs(a.durationMs)} · stop: ${a.stopReason}</sub>`,
      "",
    );
  }
  return out;
};

const renderEvidence = (e: EvidenceItem, ref: (key: string, sourceId?: string) => string): string[] => {
  const where = [
    ref(e.issueKey, e.sourceId),
    e.commentId ? `comment ${e.commentId}${e.position ? ` (#${e.position})` : ""}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const who =
    e.recordedAt || e.actor ? ` · recorded ${e.recordedAt ?? "?"} · ${e.actor ?? "?"} (${e.role ?? "?"})` : "";
  const lines = [`- ${where}${who}: **${STANCE_LABEL[e.stance]}**. ${e.why}`];
  if (e.excerpt) lines.push(`  > ${esc(e.excerpt)}`);
  return lines;
};

const renderMetrics = (m: RunMetrics, reused: number): string[] => [
  "## Execution metrics",
  "",
  ...(reused
    ? [
        `_${reused} requirement(s) were reused from an earlier run (\`--resume\`). The totals below cover only this run; the reused investigations' model calls and tokens are in that run's report (per-requirement rows below keep their original figures)._`,
        "",
      ]
    : []),
  "| Metric | Value |",
  "|---|---|",
  `| Wall-clock time | ${secs(m.wallClockMs)} |`,
  `| Model calls | ${m.llm.calls} (latency ${secs(m.llm.latencyMs)}, rate-limit waiting ${secs(m.llm.waitedMs)}, ${m.llm.retries} retries, ${m.llm.errors} errors) |`,
  `| Tool calls | ${m.tools.calls} (${m.tools.errors} returned errors) · ${Object.entries(m.tools.byTool)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")} |`,
  `| Jira HTTP calls | ${m.jira.httpCalls} (${m.jira.retries} retries, ${m.jira.errors} errors, ${secs(m.jira.timeMs)}) |`,
  `| Tokens | ${fmtInt(m.tokens.input)} input (${fmtInt(m.tokens.cached)} cached) · ${fmtInt(m.tokens.output)} output · ${fmtInt(m.tokens.total)} total |`,
  `| Estimated cost | USD ${m.cost.usd.toFixed(4)} (at USD ${m.cost.prices.inputPerMTok}/M input, ${m.cost.prices.outputPerMTok}/M output) |`,
  "",
  "| Requirement | Decision | Turns | Tool calls | Input tokens | Output tokens | Time | Stop |",
  "|---|---|---|---|---|---|---|---|",
  ...(m.discovery
    ? [
        `| _discovery_ | — | ${m.discovery.turns} | ${m.discovery.toolCalls} | ${fmtInt(m.discovery.inputTokens)} | ${fmtInt(m.discovery.outputTokens)} | ${secs(m.discovery.durationMs)} | — |`,
      ]
    : []),
  ...m.perRequirement.map(
    (p) =>
      `| ${p.requirement} | ${p.decision} | ${p.turns} | ${p.toolCalls} | ${fmtInt(p.inputTokens)} | ${fmtInt(p.outputTokens)} | ${secs(p.durationMs)} | ${p.stopReason ?? p.status} |`,
  ),
  "",
];
