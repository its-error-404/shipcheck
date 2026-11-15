# ADR-002 — No RAG / vector search

**Status:** accepted · **Module:** 1

## Context

Evidence is relational (requirement → linked record → linked dependency) and hinges on exact identifiers (commit hashes, prompt versions, environment names).

## Decision

The agent navigates Jira directly with search, issue and comment tools. No embeddings and no vector store.

## Alternatives

- **RAG over ticket text**: similarity search doesn't traverse links (it would likely miss a defect two links away), blurs `b7a91f2` vs `9c3e1aa`, adds infrastructure, and reads from a copy rather than Jira.

## Consequences

- ✅ Evidence always comes live from Jira, exact identifiers are preserved, and there's no extra infrastructure.
- ❌ Would need a search index if the project grew to millions of loosely linked tickets (not the case here).
