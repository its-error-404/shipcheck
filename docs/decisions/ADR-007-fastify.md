# ADR-007 — Fastify for the bonus server

**Status:** accepted · **Module:** 2

## Context

An optional server exposes `POST /api/runs`, run list/report/trace/transcript routes, and streams trace events to the React UI via Socket.io.

## Decision

Fastify, with Socket.io attached to the underlying HTTP server. The API has only two inputs (`only`, `resumeFrom`), validated by hand against strict patterns; a schema type provider can be added if the API grows. Fastify's built-in pino logger is available (off by default to keep the console readable).

## Alternatives

- **Express**: familiar; no built-in validation or structured logging; async errors need wrappers in v4.

## Consequences

- ✅ Small, typed, quick to start; `app.inject()` makes route tests fast without a network port; Socket.io shares the same HTTP server.
- Status: built ([16-server.md](../16-server.md)).
- Note: speed was not a deciding factor; runs are LLM-latency bound.
