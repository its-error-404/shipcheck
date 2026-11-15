/** Agent loop defaults and phase budgets (docs/10-agent-loop.md). */
export const LOOP_DEFAULTS = {
  warnAtTurnsLeft: 3,
  elideAboveChars: 60_000,
  elideMinResultChars: 1_500,
  keepRecentMessages: 4,
  textPreviewChars: 500,
} as const;

export const DISCOVERY_BUDGET = {
  maxTurns: 12,
  maxToolCalls: 25,
  maxInputTokens: 150_000,
  timeoutMs: 5 * 60_000,
} as const;

export const INVESTIGATION_BUDGET = {
  maxTurns: 20,
  maxToolCalls: 40,
  maxInputTokens: 200_000,
  timeoutMs: 8 * 60_000,
} as const;
