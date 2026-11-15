# ADR-001 — Orchestrator with per-requirement agents

**Status:** accepted · **Module:** 1

## Context

The agent must assess 12 requirements whose evidence is spread across ~35 linked Jira issues, one of which has 64 comments. Graders assess context management and failure handling.

## Decision

A discovery agent identifies the manifest and requirements through tools. Code validates the list. Each requirement is then investigated by a fresh, bounded agent with its own context. Code aggregates the results.

## Alternatives

- **Single agent for the release**: simpler, but context grows, requirements contaminate each other, and one failure loses the run.
- **Fixed pipeline**: violates the brief's tool-selection requirement.
- **Critic agent on top**: deferred; doubles cost before the basics are proven.

## Consequences

- ✅ Small contexts, contained failures, parallelism, readable traces.
- ❌ System prompt repeated per requirement (mitigated by prompt caching); slightly more orchestration code.
