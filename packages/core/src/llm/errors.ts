/** Typed LLM failures. The orchestrator branches on these (docs/09-llm-adapter.md). */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Bad API key or no access to the model. Never retried. */
export class LlmAuthError extends LlmError {}

/** Bad request: wrong model name, unsupported parameter, malformed tools. Never retried. */
export class LlmBadRequestError extends LlmError {}

/** Daily (or otherwise long-window) quota exhausted: stop starting new work, resume later. */
export class LlmQuotaExhaustedError extends LlmError {}

/** Transient failures that persisted after all retries. */
export class LlmUnavailableError extends LlmError {}
