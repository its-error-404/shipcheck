# Module 7 — Agent Tools

**Status:** built · tested

## 1. Purpose

The tools are the model's only window into Jira. Each is small, read-only, scope-enforced, and returns compact text designed for context efficiency.

**Code:** `packages/core/src/tools/` · **Tests:** `packages/core/test/tools.test.ts`

| Tool              | Phase                    | Purpose                                                        |
| ----------------- | ------------------------ | -------------------------------------------------------------- |
| `search_issues`   | discovery, investigation | Structured search → compact rows                               |
| `get_issue`       | discovery, investigation | Metadata, original description, links tagged OUTGOING/INCOMING |
| `get_comments`    | discovery, investigation | Paged, parsed comments with near-duplicate runs collapsed      |
| `check_scope`     | investigation            | Deterministic target-build comparison for one comment          |
| `submit_plan`     | discovery (terminal)     | Manifest + requirements, validated against Jira                |
| `record_decision` | investigation (terminal) | Decision + citations, validated by the evidence ledger         |

## 2. Shared design rules

- **Read-only:** tools run on `ScopedJiraView`, which wraps a `JiraReader` (no write methods exist in the type).
- **Scope enforced in code:** every query is `project = KEY AND labels = "<scope>" AND (…)`; the set of in-scope keys is loaded once; links to issues outside the scope are hidden and counted.
- **Errors are results, not crashes:** unknown refs, invalid arguments and Jira failures return `ERROR: … HINT: …` so the model can recover.
- **Size cap:** every result is capped at 6,000 characters with a paging hint.
- **zod validation:** model arguments are validated; the same schemas become the JSON Schema in the tool definitions (stripped of keywords some providers reject).
- **Run cache:** issues and comments are cached per run so separate investigations don't refetch.
- **Ledger:** every issue and comment shown to the model is recorded (Module 8).

## 3. Tool contracts

### `search_issues({ text?, source_ids?, kind?, release?, limit≤25 })`

Code builds the JQL from structured parameters. Output rows: `TYN-57 · REC-9745 · evidence · filed R2.4 · Jira status Done · "summary"`. The description reminds the model that the _filed_ release is not necessarily the scope of a result.
**Rejected:** raw JQL from the model (syntax errors waste turns; injection surface).

### `get_issue({ ref })`

`ref` is a Jira key or a source ID. Returns source metadata (kind, filed release, recorded status, Jira status), the original description, and links:

```
→ OUTGOING TYN-342 · REC-4076 · "…" (declared by this record)
← INCOMING TYN-360 · MANIFEST · "…" (declared by the other record)
```

Direction comes from the description's "Source links (declared by this record)" line (Module 4). Comments are not included, only their count, so the model chooses whether to read them.

### `get_comments({ ref, order?, offset?, limit≤30, contains? })`

Each comment shows: Jira comment id, source position `#n/N` (file order), **recorded** time, actor and role (parsed from the text, never Jira's native author), and the body.

- `order: "recorded"` (default) sorts by scenario time; `"source"` keeps file order. Both exist because the rules forbid resolving contradictions by file order.
- **Near-duplicate collapsing:** a run of ≥ 3 comments with the same actor and the same text apart from numbers becomes one line with the count, id range, time range and an example. On the noisiest ticket in the dataset, 64 comments become 3 entries (≈ 1 KB) while the one decisive result stays intact.
- Paging is by entries after collapsing; `contains` filters by text.
  **Rejected:** LLM summarisation of comments (an extra model call per page, and it can paraphrase away decisive details like "49 of 50").

### `check_scope({ ref, comment_id })`

Extracts release / commit / service / environment / prompt **stated** in the comment (also recognises "Approval scope: staging" and "for production") and compares with the target:

```
release: r2.4 ✓ · commit: b7a91f2 ✓ · service: atlas-assistant ✓
environment: staging ✗ mismatch (target production) · prompt: not stated (target p7)
→ MISMATCH on environment
```

Verdicts: `MATCH`, `MATCH on stated fields; not stated: …`, `MISMATCH on …`, `AMBIGUOUS`. It never judges relevance. Example: a completion comment may state no prompt while a different comment on the same record describes the harness configuration. Connecting them is the model's job.
**Rejected:** applying scope checks automatically to every comment (would silently pre-decide relevance and turn the agent into a pipeline).

**Prompt context (added after evaluation):** the output reports the **build/deployment match** (release, commit, service, environment) separately from the prompt. When a comment states no prompt, the tool lists prompt statements made in **other comments on the same issue** (e.g. a harness configured with `p6`), or says the prompt is stated nowhere and only matters for criteria about the deployed prompt. A local model had (a) refused a valid regression PASS because "prompt not stated", and (b) missed a p6 harness note in a neighbouring comment. Both are fixed by surfacing facts, not by deciding.

### `submit_plan({ manifest_key, requirement_keys[] })`

Validated: the manifest is kind `manifest`; every requirement is in scope, kind `requirement`, and linked from the manifest; every outgoing link declared by the manifest is included. Otherwise the plan is rejected with specific reasons.

### `record_decision({ requirement_key, decision, explanation, evidence[], outstanding?, anomalies? })`

Evidence items carry `issue_key`, optional `comment_id`, a `stance` (`supports_pass`, `supports_fail`, `inconclusive`, `not_applicable`) and a one-line `why`. Rejected evidence (wrong build, wrong service…) is cited with `not_applicable` so the report shows what was considered and dismissed. `anomalies` captures embedded instructions, contradictions and similar. Validated by the ledger (Module 8).

### Coverage gate (added after evaluation, see Module 15)

Before `record_decision` is accepted, the requirement, every record it links to (OUTGOING), and those records' OUTGOING links (2 hops) must have been **opened with `get_issue` and their comments read with `get_comments`**. Otherwise the decision is rejected with the exact list of records still to examine. This enforces the brief's "investigate linked records" mechanically (a small local model was observed deciding without opening any evidence) without telling the model what to decide. The 2-hop rule makes defects reachable only through a linked record's own links unmissable.

### Citations accept source IDs

Models often cite records by source ID (`REQ-xx`, `REC-xxxx`). `record_decision` resolves these to Jira keys before validation, matching the other tools, which already accept either form.

**Rejected overall:** a single `get_requirement_with_all_evidence` tool. That is a fixed pipeline under another name and dumps context; the graded skill is the model choosing what to open next.

## 4. Test evidence

- Manifest found by kind; source-ID search; scope excludes an unrelated ticket.
- A requirement shows OUTGOING links to its evidence and INCOMING links from a misleading backlink (another service) and the manifest.
- An out-of-scope link is hidden and counted.
- Noisiest ticket: 62 near-duplicates collapsed, the decisive comment kept, output < 3 KB.
- Recorded-time ordering puts an earlier QA run before its retest; `contains` and paging work.
- `check_scope`: staging run → MISMATCH environment; production run → MATCH; comment without a prompt → prompt not stated (with sibling-comment context); approval wording parsed; wrong service and wrong release detected.
- Invalid arguments and unknown refs return recoverable errors.

## 5. Likely questions

**Q: Why structured search instead of JQL?** Fewer wasted turns, no injection surface, scope always enforced.

**Q: Doesn't collapsing hide evidence?** Only runs of near-identical comments from the same actor are collapsed, and their ids stay listed (and recorded in the ledger). Distinct comments are never collapsed.

**Q: Why does `get_issue` exclude comments?** Context discipline: the model sees links and metadata first and opens comments only where needed.

**Q: Why tag link direction?** The dataset contains backlinks from other services' records into our evidence. Marking them INCOMING lets the agent see and dismiss them deliberately.
