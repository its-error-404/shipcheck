import type { Budget, StopReason } from "./agent";
import type { Target } from "./dataset";
import type { Decision, OverallDecision, Stance } from "./decision";

/** How a requirement's result was obtained. */
export const RESULT_STATUSES = ["decided", "agent_failed", "not_assessed", "resumed"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** One cited piece of evidence, enriched from the ledger (Jira data, not model text). */
export interface EvidenceItem {
  issueKey: string;
  sourceId?: string;
  issueSummary?: string;
  commentId?: string;
  position?: string;
  recordedAt?: string;
  actor?: string;
  role?: string;
  excerpt?: string;
  stance: Stance;
  why: string;
}

export interface AgentStats {
  stopReason: StopReason;
  error?: string;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  durationMs: number;
  llmLatencyMs: number;
  waitedMs: number;
}

export interface RequirementResult {
  key: string;
  sourceId?: string;
  summary: string;
  criterion?: string;
  /** undefined = not stated in Jira (treated as mandatory and flagged). */
  mandatory?: boolean;
  status: ResultStatus;
  decision: Decision;
  explanation: string;
  evidence: EvidenceItem[];
  outstanding: string[];
  anomalies: string[];
  agent?: AgentStats;
}

export interface OverallResult {
  decision: OverallDecision;
  reason: string;
  counts: Record<Decision, number>;
}

export interface AssessmentRequest {
  projectKey: string;
  scopeLabel: string;
  release: string;
}

export interface AssessmentResult {
  runId: string;
  status: "COMPLETED" | "ABORTED";
  abortReason?: string;
  startedAt: string;
  finishedAt: string;
  request: AssessmentRequest;
  model: string;
  provider: string;
  promptVersion: string;
  budgets: { discovery: Budget; investigation: Budget };
  scopeIssueCount?: number;
  manifest?: { key: string; sourceId?: string; summary: string };
  target?: Target;
  overall?: OverallResult;
  requirements: RequirementResult[];
  discovery?: AgentStats;
  runIssues: string[];
}
