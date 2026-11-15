# Module 13 — Report

**Status:** built · tested

**Code:** `packages/core/src/report/markdown.ts`; JSON is the `AssessmentResult` model (`models/assessment.ts`).

## Outputs

- `runs/<runId>/report.md`: human-readable.
- `runs/<runId>/report.json`: machine-readable `AssessmentResult`.

## Contents

1. **Overall decision** with the rule applied (stated as computed in code) and counts.
2. **Run table:** run ID, Jira scope (+ issue count), manifest link, target (from the manifest), model + provider, prompt version, timestamps.
3. **Summary table:** requirement (Jira link + source ID), acceptance criterion, decision badge, key evidence reference.
4. **Per requirement:** Jira link, criterion, mandatory flag; the **model's explanation (labelled)**; _evidence relied on_ and _evidence considered and rejected_, each with Jira key, source ID, comment id and position, **recorded time, actor and role**, stance, reason and a quoted excerpt; outstanding verification; anomalies; agent stats (turns, tool calls, tokens, time, stop reason).
5. **Run issues:** every agent stop, quota event or unparsed field, stated honestly.
6. **Execution metrics** (Module 14).

## Integrity

Evidence lines are rendered from the evidence ledger (Jira data fetched during the run), never from model output. Only the explanation is model-written, and it is labelled as such.
