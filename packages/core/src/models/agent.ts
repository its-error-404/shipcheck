/** Why an agent run stopped. Anything other than "terminal" is reported as a failure, never as a decision. */
export const STOP_REASONS = [
  "terminal",
  "max_turns",
  "max_tool_calls",
  "token_budget",
  "timeout",
  "no_tool_call",
  "llm_error",
  "quota_exhausted",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface Budget {
  maxTurns: number;
  maxToolCalls: number;
  maxInputTokens: number;
  timeoutMs: number;
  /** Turns remaining at which the "land now" warning is injected. */
  warnAtTurnsLeft?: number;
  /** Conversation size (chars) above which old large tool results are elided. */
  elideAboveChars?: number;
}
