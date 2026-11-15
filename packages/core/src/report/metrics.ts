/**
 * Run metrics (docs/DESIGN.md), derived from trace events and results.
 * Cost uses configurable per-million-token prices (0 on free tiers).
 */
import { TRACE_EVENTS } from "../constants/trace";
import type { AssessmentResult } from "../models/assessment";
import type { TraceEvent } from "../trace";

export interface TokenPrices {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
}

export interface RunMetrics {
  wallClockMs: number;
  llm: { calls: number; latencyMs: number; waitedMs: number; retries: number; errors: number };
  tools: { calls: number; errors: number; timeMs: number; byTool: Record<string, number> };
  jira: { httpCalls: number; retries: number; errors: number; timeMs: number };
  tokens: { input: number; output: number; cached: number; total: number };
  cost: { usd: number; prices: TokenPrices };
  perRequirement: {
    requirement: string;
    decision: string;
    status: string;
    turns: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    stopReason?: string;
  }[];
  discovery?: { turns: number; toolCalls: number; inputTokens: number; outputTokens: number; durationMs: number };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const buildMetrics = (
  result: AssessmentResult,
  events: readonly TraceEvent[],
  prices: TokenPrices = { inputPerMTok: 0, outputPerMTok: 0 },
): RunMetrics => {
  const of = (type: string) => events.filter((e) => e.type === type);
  const llmCalls = of(TRACE_EVENTS.llmCall);
  const toolCalls = of(TRACE_EVENTS.toolCall);
  const byTool: Record<string, number> = {};
  for (const t of toolCalls) byTool[String(t.tool)] = (byTool[String(t.tool)] ?? 0) + 1;

  const tokens = {
    input: llmCalls.reduce((n, e) => n + num(e.inputTokens), 0),
    output: llmCalls.reduce((n, e) => n + num(e.outputTokens), 0),
    cached: llmCalls.reduce((n, e) => n + num(e.cachedTokens), 0),
    total: 0,
  };
  tokens.total = tokens.input + tokens.output;
  const usd = (tokens.input / 1e6) * prices.inputPerMTok + (tokens.output / 1e6) * prices.outputPerMTok;

  return {
    wallClockMs: Date.parse(result.finishedAt) - Date.parse(result.startedAt),
    llm: {
      calls: llmCalls.length,
      latencyMs: llmCalls.reduce((n, e) => n + num(e.latencyMs), 0),
      waitedMs: llmCalls.reduce((n, e) => n + num(e.waitedMs), 0),
      retries: of(TRACE_EVENTS.llmRetry).length,
      errors: of(TRACE_EVENTS.llmError).length,
    },
    tools: {
      calls: toolCalls.length,
      errors: toolCalls.filter((e) => e.ok === false).length,
      timeMs: toolCalls.reduce((n, e) => n + num(e.ms), 0),
      byTool,
    },
    jira: {
      httpCalls: of(TRACE_EVENTS.jiraHttp).length,
      retries: of(TRACE_EVENTS.jiraRetry).length,
      errors: of(TRACE_EVENTS.jiraError).length,
      timeMs: of(TRACE_EVENTS.jiraHttp).reduce((n, e) => n + num(e.ms), 0),
    },
    tokens,
    cost: { usd: Math.round(usd * 10_000) / 10_000, prices },
    perRequirement: result.requirements.map((r) => ({
      requirement: r.sourceId ?? r.key,
      decision: r.decision,
      status: r.status,
      turns: r.agent?.turns ?? 0,
      toolCalls: r.agent?.toolCalls ?? 0,
      inputTokens: r.agent?.inputTokens ?? 0,
      outputTokens: r.agent?.outputTokens ?? 0,
      durationMs: r.agent?.durationMs ?? 0,
      stopReason: r.agent?.stopReason,
    })),
    discovery: result.discovery && {
      turns: result.discovery.turns,
      toolCalls: result.discovery.toolCalls,
      inputTokens: result.discovery.inputTokens,
      outputTokens: result.discovery.outputTokens,
      durationMs: result.discovery.durationMs,
    },
  };
};
