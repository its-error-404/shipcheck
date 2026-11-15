# ADR-007 — Fastify for the bonus server

**Status:** accepted · **Module:** 2

## Context

An optional server exposes `POST /api/assess`, run status/report routes, and streams trace events to the React UI via Socket.io.

## Decision

Fastify with `fastify-type-provider-zod` (reusing the agent's zod schemas), pino logging, and Socket.io attached to the underlying HTTP server.

## Alternatives

- **Express**: familiar; no built-in validation or structured logging; async errors need wrappers in v4.

## Consequences

- ✅ Schema-first validation from shared zod schemas; structured logs; good TypeScript support.
- Status: designed, not built (time prioritised for assessment correctness).
- Note: speed was not a deciding factor; runs are LLM-latency bound.
