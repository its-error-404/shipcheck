# ADR-008 — Single issue type with labels; "Relates" links

**Status:** accepted · **Module:** 3

## Context

Records have four kinds (manifest, requirement, evidence, work) and directed links. Reviewers must be able to reproduce the Jira setup without admin configuration.

## Decision

Every record is a `Task`. Kind, release, source ID and dataset scope are labels. Links use the built-in "Relates" type; direction is preserved in each issue's description (source-links list).

## Alternatives

- Custom issue types / custom link types: need admin setup for every reviewer.
- Blocks/Duplicates link types: misleading semantics.

## Consequences

- ✅ Works on any Jira Cloud project with zero configuration; everything is searchable with JQL.
- ❌ Kind is not visible as a Jira issue-type icon (cosmetic only).
