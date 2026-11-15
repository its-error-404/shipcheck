/**
 * One assessment run, end to end: config → clients → assess() → saved run folder.
 *
 * Shared by the CLI (`npm run assess`) and the web server (`POST /api/runs`) so
 * both produce identical run folders. Callers add their own trace sinks
 * (terminal progress, Socket.io) and may inject Jira/LLM clients (tests).
 */
import { loadAssessConfig, loadJiraConfig, loadLlmConfig } from "../config";
import { JiraReader } from "../jira/client";
import { createJiraHttp } from "../jira/http";
import { OpenAICompatibleClient } from "../llm/openai-compatible";
import type { LlmClient } from "../llm/types";
import type { AssessmentResult, RequirementResult } from "../models/assessment";
import { renderReport } from "../report/markdown";
import { buildMetrics, type RunMetrics } from "../report/metrics";
import { JsonlTrace, RunStore, newRunId } from "../report/run-store";
import { MemoryTrace, TeeTrace, type TraceSink } from "../trace";
import { assess } from "./orchestrator";

export interface SessionOptions {
  release?: string;
  projectKey?: string;
  scopeLabel?: string;
  concurrency?: number;
  only?: readonly string[];
  resume?: ReadonlyMap<string, RequirementResult>;
  /** Base folder for run outputs (default "runs"). */
  outDir?: string;
  /** Extra trace sinks, e.g. terminal progress or a Socket.io broadcaster. */
  sinks?: TraceSink[];
  /** Injected clients (tests, fake Jira). When omitted they are built from the environment. */
  jira?: JiraReader;
  llm?: LlmClient;
  siteUrl?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SessionInfo {
  runId: string;
  dir: string;
  release: string;
  projectKey: string;
  scopeLabel: string;
  model: string;
  provider: string;
  siteUrl?: string;
  only?: readonly string[];
  resumed: number;
}

export interface PreparedSession {
  info: SessionInfo;
  /** Runs the assessment and writes report.md / report.json / metrics.json. */
  run: () => Promise<SessionOutcome>;
}

export interface SessionOutcome {
  info: SessionInfo;
  result: AssessmentResult;
  metrics: RunMetrics;
}

/** Validates config and creates the run folder; nothing calls Jira or the model until run(). */
export const prepareSession = async (o: SessionOptions = {}): Promise<PreparedSession> => {
  const env = o.env ?? process.env;
  const assessCfg = loadAssessConfig(env);
  const release = o.release ?? assessCfg.ASSESS_RELEASE;
  const scopeLabel = o.scopeLabel ?? assessCfg.ASSESS_SCOPE_LABEL;
  const runId = newRunId(release);
  const store = await RunStore.create(o.outDir ?? "runs", runId);
  const jsonl = new JsonlTrace(store.tracePath);
  const memory = new MemoryTrace();
  const trace = new TeeTrace([jsonl, memory, ...(o.sinks ?? [])]);

  let jira = o.jira;
  let projectKey = o.projectKey;
  let siteUrl = o.siteUrl;
  if (!jira || !projectKey) {
    const jiraCfg = loadJiraConfig(env);
    projectKey ??= jiraCfg.JIRA_PROJECT_KEY;
    siteUrl ??= jiraCfg.JIRA_BASE_URL;
    jira ??= new JiraReader(
      createJiraHttp({
        baseUrl: jiraCfg.JIRA_BASE_URL,
        email: jiraCfg.JIRA_EMAIL,
        apiToken: jiraCfg.JIRA_API_TOKEN,
        trace,
      }),
    );
  }

  let llm = o.llm;
  let prices = { inputPerMTok: 0, outputPerMTok: 0 };
  if (!llm) {
    const llmCfg = loadLlmConfig(env);
    prices = { inputPerMTok: llmCfg.LLM_PRICE_INPUT_PER_MTOK, outputPerMTok: llmCfg.LLM_PRICE_OUTPUT_PER_MTOK };
    llm = new OpenAICompatibleClient({
      baseURL: llmCfg.LLM_BASE_URL,
      apiKey: llmCfg.LLM_API_KEY,
      model: llmCfg.LLM_MODEL,
      provider: llmCfg.LLM_PROVIDER,
      temperature: llmCfg.LLM_TEMPERATURE,
      maxOutputTokens: llmCfg.LLM_MAX_OUTPUT_TOKENS,
      reasoningEffort: llmCfg.LLM_REASONING_EFFORT,
      rpm: llmCfg.LLM_RPM,
      timeoutMs: llmCfg.LLM_TIMEOUT_MS,
      trace,
    });
  }

  const info: SessionInfo = {
    runId,
    dir: store.dir,
    release,
    projectKey,
    scopeLabel,
    model: llm.model,
    provider: llm.provider,
    siteUrl,
    only: o.only,
    resumed: o.resume?.size ?? 0,
  };

  const run = async (): Promise<SessionOutcome> => {
    try {
      const result = await assess({
        jira: jira!,
        llm: llm!,
        trace,
        runId,
        projectKey: projectKey!,
        scopeLabel,
        release,
        concurrency: o.concurrency ?? assessCfg.ASSESS_CONCURRENCY,
        resume: o.resume,
        only: o.only,
        budgets: {
          discovery: { elideAboveChars: assessCfg.AGENT_ELIDE_ABOVE_CHARS },
          investigation: {
            maxTurns: assessCfg.AGENT_MAX_TURNS,
            timeoutMs: assessCfg.AGENT_TIMEOUT_MS,
            elideAboveChars: assessCfg.AGENT_ELIDE_ABOVE_CHARS,
          },
        },
        onRequirement: store.saveRequirement,
      });
      const metrics = buildMetrics(result, memory.events, prices);
      await store.saveFinal(result, metrics, renderReport(result, metrics, { siteUrl }));
      return { info, result, metrics };
    } finally {
      await jsonl.close();
    }
  };

  return { info, run };
};
