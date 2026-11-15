/** Jira Cloud REST API constants (docs/DESIGN.md). */
export const JIRA_API = "/rest/api/3";

/** Built-in, symmetric link type used for every source link (ADR-008). */
export const JIRA_LINK_TYPE = "Relates";

export const JIRA_LIMITS = {
  summaryChars: 255,
  commentChars: 32_767,
  bulkCreate: 50,
  searchPage: 100,
  commentsPage: 100,
  projectsPage: 50,
  createMetaPage: 200,
} as const;

export const JIRA_HTTP_DEFAULTS = {
  timeoutMs: 30_000,
  maxRetries: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
} as const;

/** Statuses meaning "request not processed": safe to retry reads and writes. */
export const RETRY_ALWAYS_STATUSES: readonly number[] = [429, 503];
/** Statuses safe to retry for reads only (a write may already have been applied). */
export const RETRY_READS_ONLY_STATUSES: readonly number[] = [502, 504];

export const DEFAULT_ISSUE_TYPE = "Task";
export const REQUIRED_CREATE_FIELDS = ["summary", "description", "labels"] as const;
