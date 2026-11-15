# ADR-006 — axios for Jira HTTP

**Status:** accepted · **Module:** 2

## Context

Jira calls need Basic auth, timeouts, 429/5xx retry honouring Retry-After, and per-request timing for the trace.

## Decision

A single axios instance (`baseURL`, `auth`, `timeout`) with a response interceptor for retry/backoff and a request/response interceptor pair for timing and trace events.

## Alternatives

- **Native fetch**: zero dependencies, but retry and tracing must be hand-wrapped.
- **ky**: built-in Retry-After retry; less familiar.
- **jira.js**: complete but large; hides retry/paging; we need ~7 endpoints.

## Consequences

- ✅ One central, well-known place for cross-cutting HTTP behaviour.
- ❌ One additional dependency (pinned in the lockfile).
