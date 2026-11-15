import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { JIRA_HTTP_DEFAULTS, RETRY_ALWAYS_STATUSES, RETRY_READS_ONLY_STATUSES } from "../constants/jira";
import { TRACE_EVENTS } from "../constants/trace";
import { noopTrace, type TraceSink } from "../trace";
import { sleep as defaultSleep, type Sleep } from "../utils/async";
import {
  JiraAuthError,
  JiraError,
  JiraNotFoundError,
  JiraRateLimitError,
  JiraUnavailableError,
  JiraValidationError,
  jiraErrorText,
} from "./errors";

/** Per-request flags we attach to axios configs. */
declare module "axios" {
  interface AxiosRequestConfig {
    /** Marks a non-GET request as safe to retry (e.g. POST /search/jql is a read). */
    idempotent?: boolean;
    _retryCount?: number;
    _startedAt?: number;
  }
}

export interface JiraHttpOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  trace?: TraceSink;
  /** Injectable for tests so retries don't actually wait. */
  sleep?: Sleep;
}

/** Parses Retry-After (seconds or HTTP date) into milliseconds. */
export const parseRetryAfter = (value: unknown, now = Date.now()): number | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(String(value));
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
};

const isRead = (config: InternalAxiosRequestConfig): boolean => {
  const method = (config.method ?? "get").toLowerCase();
  return method === "get" || method === "head" || config.idempotent === true;
};

/**
 * Retry policy (see docs/05-jira-client.md):
 *  - 429 and 503 mean "not processed": retry reads and writes.
 *  - 502/504 and network errors/timeouts: retry reads only, because a write
 *    may already have been applied and a blind retry could duplicate it.
 *  - 4xx (other than 429): never retry.
 */
const shouldRetry = (error: AxiosError): boolean => {
  const config = error.config;
  if (!config) return false;
  const status = error.response?.status;
  if (status !== undefined && RETRY_ALWAYS_STATUSES.includes(status)) return true;
  if (status !== undefined && RETRY_READS_ONLY_STATUSES.includes(status)) return isRead(config);
  if (!error.response) return isRead(config); // network error or timeout
  return false;
};

const toJiraError = (error: AxiosError): JiraError => {
  const status = error.response?.status;
  const detail = jiraErrorText(error.response?.data);
  const where = `${(error.config?.method ?? "").toUpperCase()} ${error.config?.url ?? ""}`;
  const msg = (base: string) => `${base} (${where})${detail ? `: ${detail}` : ""}`;
  if (status === 401 || status === 403)
    return new JiraAuthError(
      msg(
        `Jira rejected the credentials or permissions [${status}]. Check JIRA_EMAIL, JIRA_API_TOKEN and project access`,
      ),
      status,
      error.response?.data,
    );
  if (status === 404) return new JiraNotFoundError(msg("Not found [404]"), status, error.response?.data);
  if (status === 400)
    return new JiraValidationError(msg("Jira rejected the request [400]"), status, error.response?.data);
  if (status === 429) return new JiraRateLimitError(msg("Rate limited by Jira after retries [429]"), status);
  if (status && status >= 500)
    return new JiraUnavailableError(msg(`Jira unavailable after retries [${status}]`), status);
  if (!error.response) return new JiraUnavailableError(msg(`Network error: ${error.code ?? error.message}`));
  return new JiraError(msg(`Unexpected Jira response [${status}]`), status, error.response?.data);
};

export const createJiraHttp = (opts: JiraHttpOptions): AxiosInstance => {
  const trace = opts.trace ?? noopTrace;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? JIRA_HTTP_DEFAULTS.maxRetries;
  const baseDelay = opts.baseDelayMs ?? JIRA_HTTP_DEFAULTS.baseDelayMs;
  const maxDelay = opts.maxDelayMs ?? JIRA_HTTP_DEFAULTS.maxDelayMs;

  const http = axios.create({
    baseURL: opts.baseUrl.replace(/\/+$/, ""),
    auth: { username: opts.email, password: opts.apiToken },
    timeout: opts.timeoutMs ?? JIRA_HTTP_DEFAULTS.timeoutMs,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  });

  http.interceptors.request.use((config) => {
    config._startedAt ??= Date.now();
    return config;
  });

  http.interceptors.response.use(
    (response) => {
      const c = response.config;
      trace.emit({
        type: TRACE_EVENTS.jiraHttp,
        method: (c.method ?? "get").toUpperCase(),
        path: c.url,
        status: response.status,
        ms: Date.now() - (c._startedAt ?? Date.now()),
        retries: c._retryCount ?? 0,
      });
      return response;
    },
    async (error: AxiosError) => {
      const config = error.config;
      if (config && shouldRetry(error) && (config._retryCount ?? 0) < maxRetries) {
        const attempt = (config._retryCount ?? 0) + 1;
        config._retryCount = attempt;
        const retryAfter = parseRetryAfter(error.response?.headers?.["retry-after"]);
        const backoff = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
        // Jitter spreads parallel workers so they don't retry in lockstep.
        const delay = retryAfter ?? Math.round(backoff * (0.5 + Math.random() * 0.5));
        trace.emit({
          type: TRACE_EVENTS.jiraRetry,
          method: (config.method ?? "get").toUpperCase(),
          path: config.url,
          status: error.response?.status ?? error.code ?? "network",
          attempt,
          delayMs: delay,
        });
        await sleep(delay);
        return http.request(config);
      }
      const jiraError = toJiraError(error);
      trace.emit({
        type: TRACE_EVENTS.jiraError,
        method: (config?.method ?? "get").toUpperCase(),
        path: config?.url,
        status: error.response?.status ?? error.code ?? "network",
        error: jiraError.name,
        retries: config?._retryCount ?? 0,
      });
      throw jiraError;
    },
  );

  return http;
};
