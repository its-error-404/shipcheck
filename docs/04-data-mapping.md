# Module 4 — Data → Jira Mapping

**Status:** approved

## 1. Purpose

Define exactly how each source record, comment and link is represented in Jira, so that nothing in the source is lost and recorded scenario facts stay distinguishable from importer metadata.

## 2. Mapping

| Source            | Jira                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `source_id`       | Summary prefix `[REC-9745] …` **and** label `src-REC-9745`                                                   |
| `summary`         | Summary text after the prefix                                                                                |
| `kind`            | Label `kind-<kind>`; requirements also get `rr-requirement` (named in the manifest's own text)               |
| `release`         | Label `rel-<release>`                                                                                        |
| `recorded_status` | Jira status with the same name (transition discovered at runtime) + written in the description               |
| `description`     | Description (ADF): importer metadata block, then the original text verbatim                                  |
| `comments[]`      | One Jira comment each, in source order: header `[Source comment n/N · <source_id>]` + original text verbatim |
| `links[]`         | Jira "Relates" link to each target + `Source links (declared by this record)` line in the description        |
| `dataset_label`   | Label on every issue (assessment scope)                                                                      |

### Description layout

```
── Source record (imported) ──
Source ID: REC-9745
Kind: evidence
Release: R2.4
Recorded status: Done
Dataset: tyn-release-assessment-v2
Source links (declared by this record): none
── Original description ──
<original description, verbatim>
```

### Comment layout

```
[Source comment 4/5 · REC-9745]
<original comment text, verbatim: "Recorded event <ts> | actor <name> | role <role>" + body>
```

## 3. Decisions

| #   | Decision                                          | Reason                                                                                                                                      | Rejected                                                                                       |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| a   | Source ID in summary **and** label                | Summary = human/model readability; label = exact lookup and idempotency key                                                                 | Custom field (admin setup); entity properties (not visible, not JQL-searchable without an app) |
| b   | Release as label                                  | One searchable mechanism; no version administration                                                                                         | Fix Version (extra setup, second mechanism)                                                    |
| c   | `rr-requirement` on requirements                  | The manifest text says requirements carry this label; Jira must not contradict the source                                                   | Omitting it                                                                                    |
| d   | Verbatim text, metadata clearly separated         | Brief requires preserving actors, roles and timestamps; importer additions sit outside the original text                                    | Rewriting or normalising text                                                                  |
| e   | Keep file order (header) and recorded time (text) | Jira collapses created-time to import time; the rules forbid resolving contradictions by file order, so both must stay visible and distinct | Sorting comments at import                                                                     |
| f   | Link direction via description                    | "Relates" is symmetric in the UI; tools label links outgoing (declared here) vs incoming (declared elsewhere)                               | Relying on Jira inward/outward placement                                                       |
| g   | ADF bodies, converted to plain text by tools      | REST v3 requires ADF; the model never sees raw ADF JSON                                                                                     | REST v2 plain text (legacy; new search endpoint is v3)                                         |

**Faithful import:** record-level release labels can be misleading (e.g. REC-5825 is filed under R2.4 but its result is on R2.3). They are preserved as source data; the agent is instructed to trust the scope stated in the result text, verified by `checkScope`.

## 4. Edge cases

| Case                                    | Handling                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| Link target not in dataset              | No Jira link; listed as "unresolved source link" in the description and import report |
| Duplicate declared link                 | Created once                                                                          |
| Text over Jira's 32,767-character limit | Import fails loudly; never truncates silently                                         |
| Unsafe label characters                 | Sanitiser (source IDs and releases are already safe)                                  |
| Unicode / special characters            | Passed through ADF unchanged                                                          |

## 5. Verification

`verify-import` reads the scope back from Jira and diffs it against the dataset: issue count, comment count, comment text (after removing the header), labels, statuses and declared links. It writes a verification report suitable for the submission.

## 6. Likely questions

**Q: You added headers to comments. Isn't that altering evidence?** The original text is verbatim; the header is separated importer metadata, needed because Jira gives every imported comment the same timestamp.

**Q: Why keep misleading release labels?** Faithful import; sanitising would remove the traps the agent must handle.

**Q: How do you know the import is complete?** `verify-import` produces a diff report.

## 7. Decision records

- [ADR-010 — Verbatim import with separated importer metadata](decisions/ADR-010-verbatim-import.md)
