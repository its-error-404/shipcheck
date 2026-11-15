/**
 * Typed Jira errors. Callers branch on the class, never on raw HTTP codes.
 * The agent's tool layer converts these into readable tool errors.
 */
export class JiraError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 401/403: credentials or permissions. Never retried. */
export class JiraAuthError extends JiraError {}

/** 404: issue/project/endpoint not found. Never retried. */
export class JiraNotFoundError extends JiraError {}

/** 400: Jira rejected the payload (includes Jira's errorMessages). Never retried. */
export class JiraValidationError extends JiraError {}

/** 429 after all retries were used. */
export class JiraRateLimitError extends JiraError {}

/** 5xx, timeouts or network failures after all retries were used. */
export class JiraUnavailableError extends JiraError {}

/** Extracts Jira's human-readable error text from a response body. */
export function jiraErrorText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as { errorMessages?: unknown; errors?: unknown; message?: unknown };
  const parts: string[] = [];
  if (Array.isArray(d.errorMessages)) parts.push(...d.errorMessages.map(String));
  if (d.errors && typeof d.errors === "object") {
    for (const [field, msg] of Object.entries(d.errors as Record<string, unknown>)) {
      parts.push(`${field}: ${String(msg)}`);
    }
  }
  if (typeof d.message === "string") parts.push(d.message);
  return parts.join("; ");
}
