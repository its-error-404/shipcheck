/** LLM adapter defaults (docs/09-llm-adapter.md). */
export const LLM_DEFAULTS = {
  temperature: 0,
  maxOutputTokens: 8_192,
  maxRetries: 4,
  timeoutMs: 120_000,
  baseBackoffMs: 2_000,
  maxBackoffMs: 60_000,
  rateWindowMs: 60_000,
} as const;
