# ADR-010 — Verbatim import with separated importer metadata

**Status:** accepted · **Module:** 4

## Context

The brief requires preserving source identifiers, relationships, recorded evidence, actor names, roles and event timestamps. Jira assigns its own author and timestamp to everything imported.

## Decision

Source text is written verbatim. Importer metadata (source ID, kind, release, recorded status, declared links, comment position `n/N`) is added in clearly delimited blocks outside the original text. Source IDs are both a summary prefix and a label.

## Consequences

- ✅ Nothing is lost or rewritten; file order and recorded time remain independently visible; stable citations.
- ❌ Comment bodies carry one extra header line (stripped by `verify-import` when diffing).
