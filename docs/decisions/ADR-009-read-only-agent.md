# ADR-009 — Read-only agent access to Jira

**Status:** accepted · **Module:** 3

## Context

The dataset contains a planted instruction aimed at automated reviewers. An agent with write access could, if manipulated, alter evidence.

## Decision

Only the importer can call write endpoints. The agent's tool layer exposes read operations only, every query is wrapped in a code-enforced project + label scope, and the assessment step can run with a read-only scoped API token.

## Consequences

- ✅ Two independent layers (code + credentials) prevent the agent from modifying Jira.
- ❌ Two tokens are needed for full hardening (optional; one classic token works by default).
