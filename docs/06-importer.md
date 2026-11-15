# Module 6 — Importer & Import Verification

**Status:** built · tested

## 1. Purpose

A repeatable, safe-to-rerun import of all 400 records, 2,059 comments and the declared links, plus a read-only verifier that proves the import is complete and faithful.

**Code:** `packages/core/src/import/` (`dataset.ts`, `mapping.ts`, `importer.ts`, `verify.ts`), `apps/cli/src/index.ts` · **Tests:** `packages/core/test/importer.test.ts`

## 2. Commands

```bash
npm run verify-jira                 # credentials + project check (read-only)
npm run import -- --dry-run         # preflight + plan, no writes
npm run import                      # import (safe to rerun)
npm run verify-import               # diff Jira against the dataset (read-only)
```

Options: `--dataset`, `--project`, `--label`, `--issue-type`, `--concurrency`, `--out` (default `artifacts/import/`).
Outputs: `import-report.json`, `import-map.json` (source ID → Jira key, a log only), `verify-report.json`.

## 3. Flow

```
1. Load dataset.json and validate with zod (fail fast; also rejects duplicate source IDs)
2. Preflight: credentials → project → issue type → summary/description/labels on create screen → "Relates" link type
3. Discover existing issues: JQL  project = KEY AND labels = "<scope>"  → source ID → key (from src- label)
4. Create missing issues: POST /issue/bulk, 50 per call; per-element errors recorded, others continue
5. Re-read from Jira (source of truth)
6. Comments: per issue, detect present ones by their [Source comment n/N] header; add missing ones strictly in order
   (sequential within an issue, parallel across issues via p-limit)
7. Links: create missing "Relates" links (unordered pairs, so no duplicates in either direction)
8. Statuses: transition to the status whose name matches recorded_status (transitions cached per from-status)
9. Write reports
```

## 4. Idempotency (the central design point)

| Item    | "Already done?" check                                             |
| ------- | ----------------------------------------------------------------- |
| Issue   | `src-<source_id>` label exists in scope                           |
| Comment | Jira comment whose header is `[Source comment n/N · <source_id>]` |
| Link    | Unordered pair already linked with "Relates"                      |
| Status  | Current status name equals recorded status                        |

Consequences: a crashed import resumes on rerun; a second run performs **zero writes** (tested by asserting no write requests were made); reviewers get identical results on their own site.

**Rejected alternatives**

- _Delete and re-import_: destructive, slow, and changes Jira keys (breaking report references).
- _Local state file as truth_: goes stale if Jira is edited. Jira is the truth; `import-map.json` is only a log.
- _Jira CSV import (UI)_: not repeatable from code; unreliable for links and comment order.

**Ordering safety:** comments within an issue are posted sequentially, and on the first failure the importer stops that issue, so later comments never land before earlier ones. A rerun resumes from the gap. If a gap is ever detected before an already-present comment, a warning is recorded (the `n/N` header still preserves source order).

**Duplicate guard:** if two Jira issues carry the same `src-` label, the importer stops and asks for the duplicate to be resolved rather than guessing.

## 5. Verification (`verify-import`)

Reads the scope back and checks, per record: summary, labels, description (exact text), status, comment count, **comment text identical after header removal**, comment order, and every declared link. Exits non-zero on any mismatch (CI-friendly). Detects issues in scope that are not in the dataset.

## 6. Test evidence (fake Jira, full dataset)

| Test                                        | Result                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Full import                                 | 400 issues, 2,059 comments, all links, 252 transitions + 148 already correct; `verify-import` OK |
| Second run                                  | 0 creates, 0 comments, 0 links, 0 transitions; no write requests                                 |
| Crash after 500 comments, rerun             | Second run adds exactly 1,559; verify OK                                                         |
| Dry run                                     | No writes                                                                                        |
| Unrelated ticket in project                 | Ignored; verify OK                                                                               |
| Tampering (deleted comment, changed status) | Detected                                                                                         |
| Wrong project key                           | Preflight fails before any write                                                                 |

End-to-end CLI run against the fake served over HTTP: import 1.8 s, verify OK, rerun 0.4 s with nothing created.

## 7. Performance

About 2,400 API calls on a real site (8 bulk creates, 2,059 comments, 76 links, ~250 transitions). With 4 workers, expect a few minutes; Jira rate limiting is absorbed by the retry policy.

## 8. Likely questions

**Q: What if the import fails halfway?** Rerun it. Every step checks Jira first, so it resumes with no duplicates.

**Q: How do you prove fidelity?** `verify-import` diffs Jira against the dataset and writes a report included in the submission.

**Q: Why does the importer re-read Jira after creating issues?** So all later steps work from Jira's actual state, not from assumptions about what the bulk call did.

**Q: Why stop an issue's comments on the first failure?** Jira orders comments by creation time; continuing would put later comments before the missing one.
