# ADR-003 — Deterministic code for rule checks and the overall decision

**Status:** accepted · **Module:** 1

## Context

Some steps are judgement (superseding, contradictions, approver authority); others are mechanical (does commit X equal the target commit? any FAIL → BLOCKED).

## Decision

- The **model** chooses what to fetch and decides each requirement.
- A **`checkScope` tool** (code) compares a result's release/commit/service/environment/prompt to the target. The model chooses when to call it.
- **Code** computes the overall decision from the per-requirement decisions.

## Alternatives

- **Model does everything**: risks misreading hashes or misapplying a fixed rule.
- **Code does everything**: violates the brief's requirement that the model selects actions.

## Consequences

- ✅ Mechanical steps are always right; the model's effort goes to genuine judgement.
- ❌ The scope parser expects "key value" pairs (`release R2.4; commit …`). Unparseable text returns "unknown" fields, and the model must then judge from the raw text.
