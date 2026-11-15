# ADR-004 — TypeScript with no agent framework

**Status:** accepted · **Module:** 2

## Context

The brief grades tool use, context management, bounded execution and failure handling. The workload is I/O-bound orchestration of Jira and LLM calls.

## Decision

TypeScript (strict) on Node.js 22 LTS. The agent loop is written directly against an LLM SDK (~150 lines), with no LangChain, LangGraph, Vercel AI SDK or similar.

## Alternatives

- **Python**: AI default, but offers no advantage for I/O-bound orchestration here, with weaker compile-time guarantees for tool contracts.
- **LangChain/LangGraph**: hides the loop and token usage; churn.
- **Vercel AI SDK**: strongest alternative; rejected because we would still write budgets, the ledger and orchestration, and lose provider-specific usage detail.

## Consequences

- ✅ Every graded mechanism is visible and explainable; compile-time safety on tool schemas.
- ❌ We maintain our own loop (small, tested).
