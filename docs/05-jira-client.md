# Module 5 — Jira API Client

**Status:** built · tested

## 1. Purpose

One small, reliable layer for every Jira call, with retries, timeouts, typed errors and tracing in one place.

**Code:** `packages/core/src/jira/` (`http.ts`, `client.ts`, `errors.ts`, `adf.ts`, `jql.ts`) · **Tests:** `packages/core/test/jira-http.test.ts`, `mapping.test.ts`

## 2. Endpoints (REST v3)

| Method                             | Endpoint                                            | Used by                   |
| ---------------------------------- | --------------------------------------------------- | ------------------------- |
| `myself()`                         | `GET /rest/api/3/myself`                            | preflight / `verify-jira` |
| `getProject(key)`                  | `GET /project/{key}`                                | preflight                 |
| `getIssueTypes`, `getCreateFields` | `GET /issue/createmeta/{project}/issuetypes[/{id}]` | preflight                 |
| `getLinkTypes()`                   | `GET /issueLinkType`                                | preflight                 |
| `searchJql(jql, fields)`           | `POST /search/jql` (nextPageToken paging)           | importer, verifier, agent |
| `getIssue(key, fields)`            | `GET /issue/{key}`                                  | agent                     |
| `getComments(key)`                 | `GET /issue/{key}/comment` (startAt paging)         | importer, verifier, agent |
| `bulkCreate(issues)`               | `POST /issue/bulk` (≤ 50)                           | importer                  |
| `addComment(key, body)`            | `POST /issue/{key}/comment`                         | importer                  |
| `createLink(type, a, b)`           | `POST /issueLink`                                   | importer                  |
| `getTransitions` / `transition`    | `GET/POST /issue/{key}/transitions`                 | importer                  |

The legacy `/search` endpoint was retired by Atlassian; `searchJql` uses the enhanced `/search/jql` endpoint and is exposed as an **async generator**, so callers write `for await (const issue of jira.searchJql(...))` and never handle paging.

## 3. Reader / Writer split (ADR-009 in code)

```ts
class JiraReader { myself, getProject, searchJql, getIssue, getComments, getTransitions, ... }
class JiraWriter extends JiraReader { bulkCreate, addComment, createLink, transition }
```

The importer receives a `JiraWriter`; the agent's tools are constructed with a `JiraReader`. Calling a write method from agent code does not compile.
**Rejected:** a single client with a runtime read-only flag (can be forgotten; only checked at runtime).

## 4. HTTP layer: axios + interceptors

`createJiraHttp()` builds one axios instance (`baseURL`, Basic `auth`, 30 s `timeout`) with:

- **Request interceptor**: stamps the start time.
- **Response interceptor (success)**: emits `jira_http` trace events `{method, path, status, ms, retries}`.
- **Response interceptor (error)**: the retry policy below, then conversion to a typed error and a `jira_error` trace event.

### Retry policy

| Condition               | Reads (GET, or `idempotent: true`)      | Writes                                                |
| ----------------------- | --------------------------------------- | ----------------------------------------------------- |
| 429 Too Many Requests   | Retry: wait `Retry-After`, else backoff | Retry (Jira did not process it)                       |
| 503 Service Unavailable | Retry                                   | Retry (not processed)                                 |
| 502 / 504               | Retry                                   | **No retry**                                          |
| Network error / timeout | Retry                                   | **No retry**: the write may already have been applied |
| Other 4xx               | No retry                                | No retry                                              |

- Backoff: `1s × 2^(attempt-1)`, capped at 60 s, with jitter (×0.5–1.0) so parallel workers don't retry in lockstep. Max 5 retries.
- `Retry-After` accepts seconds or an HTTP date.
- `POST /search/jql` is a read and is marked `idempotent: true`.

**Why writes are not retried after timeouts:** if `POST /comment` times out after Jira saved it, a blind retry duplicates the comment. Instead the write fails, and the importer's idempotency checks (Module 6) repair it on the next run. Tested: `does NOT retry a write that timed out`.

### Typed errors

`JiraAuthError` (401/403, message names `JIRA_EMAIL` / `JIRA_API_TOKEN`), `JiraNotFoundError` (404), `JiraValidationError` (400, includes Jira's `errorMessages`), `JiraRateLimitError` (429 after retries), `JiraUnavailableError` (5xx / network after retries). Callers branch on classes, never on raw status codes.

## 5. ADF helpers

- `textToAdf(text)`: one paragraph per line; empty lines become empty paragraphs (Jira rejects empty text nodes).
- `adfToText(adf)`: walks the tree back to plain text; also flattens lists, panels and mentions defensively.
- Round trip is exact for **all 2,059 comments and 400 descriptions** in the dataset (tested).

## 6. JQL scope

`scopedJql(project, label, inner?)` → `project = "TYN" AND labels = "<scope>" AND (<inner>)`. Literals are quoted and escaped by `jqlString`. All scoping is built in code.

## 7. Testing approach

`FakeJira` (`src/testing/fake-jira.ts`) implements the endpoints above in memory and plugs in as an **axios adapter**, so tests exercise the real client, interceptors, retry policy and JSON shapes. It supports a JQL subset and **fault injection** (status codes, Retry-After headers, network errors, and "applied then timed out" writes). It can also be served over HTTP (`npm run fake-jira`) to run the CLI end-to-end without a Jira site (development only; never used for the submitted report).

Verified behaviours: Retry-After waits; exponential 503 backoff; no retry of timed-out writes; read retry after network errors; idempotent search retry; no retry on 401 with actionable message; 404 mapping; give-up after max retries; multi-page search.

## 8. Likely questions

**Q: Why not retry everything?** Retrying a write after a timeout can duplicate data. Writes retry only when Jira signals the request was not processed (429/503).

**Q: Why an async generator for search?** Paging is an implementation detail; callers iterate, and memory stays bounded for large result sets.

**Q: How do you test retry logic without waiting?** The `sleep` function is injectable; tests record requested delays instead of sleeping.
