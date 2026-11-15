/**
 * Types shared with the backend. Imported as types only, so no server code is
 * bundled into the browser build.
 */
export type {
  AgentStats,
  AssessmentResult,
  Decision,
  EvidenceItem,
  Msg,
  OverallDecision,
  RequirementResult,
  RunDetail,
  RunMetrics,
  RunSummary,
  SessionInfo,
  TraceEvent,
} from "@shipcheck/core";

import type { SessionInfo } from "@shipcheck/core";

/** GET /api/config: which settings are present (never secret values). */
export interface ConfigStatus {
  jira: { ok: boolean; missing: string[]; site?: string; project?: string };
  llm: { ok: boolean; missing: string[]; provider?: string; model?: string };
  release: string;
  scopeLabel: string;
}

/** GET /api/live and the run:status Socket.io event. */
export interface LiveStatus {
  active?: { info: SessionInfo; startedAt: string };
  last?: { runId: string; ok: boolean; error?: string; finishedAt: string };
}

export type LiveEvent = { type: string; ts: string; [key: string]: unknown };
