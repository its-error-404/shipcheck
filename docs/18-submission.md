# Module 18: Submission and results

**Status:** done

## 1. What is submitted

| Deliverable                    | Where                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source code                    | `packages/core` (agent, tools, Jira, importer, report), `apps/cli`, `apps/server`, `apps/web`                                                      |
| Setup and run instructions     | [README.md](../README.md)                                                                                                                          |
| Pinned dependencies            | Exact versions in every `package.json`, plus `package-lock.json`                                                                                   |
| Import evidence                | [`artifacts/import/`](../artifacts/import/): plan, report (400 issues, 2,059 comments, 76 links, statuses) and the source-ID → Jira-key map        |
| Generated report               | [`runs/20261115-110400-R2.4/report.md`](../runs/20261115-110400-R2.4/report.md) and `report.json`                                                  |
| Trace                          | `runs/20261115-110400-R2.4/trace.jsonl` (every model call, tool call and Jira request) and `transcripts/` (each investigation's full conversation) |
| Execution time and token usage | `runs/20261115-110400-R2.4/metrics.json`, summarised below and at the end of the report                                                            |
| Design explanation             | [docs/README.md](README.md): one document per module, decision records, coding standards                                                           |
| AI assistance note             | [ai-assistance.md](ai-assistance.md)                                                                                                               |

## 2. Submitted run

| Item       | Value                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| Run        | `20261115-110400-R2.4`                                                                 |
| Jira scope | project `KAN`, label `tyn-release-assessment-v2`, 400 issues                           |
| Manifest   | `KAN-363` (MANIFEST), found by the discovery agent; 12 requirements, validated by code |
| Target     | R2.4 · commit `b7a91f2` · service `atlas-assistant` · production · prompt `p7`         |
| Model      | `qwen3:8b` via Ollama, local (RTX 4060, 8 GB); prompt v3                               |
| Overall    | **BLOCKED**: mandatory requirements failed                                             |

| Requirement | Decision              | Turns | Time    | Notes                                                                   |
| ----------- | --------------------- | ----- | ------- | ----------------------------------------------------------------------- |
| REQ-01      | PASS                  | 3     | 1m 40s  |                                                                         |
| REQ-02      | FAIL                  | 6     | 4m 01s  |                                                                         |
| REQ-03      | FAIL                  | 8     | 4m 53s  |                                                                         |
| REQ-04      | PASS                  | 5     | 2m 26s  |                                                                         |
| REQ-05      | FAIL                  | 9     | 5m 16s  |                                                                         |
| REQ-06      | INSUFFICIENT_EVIDENCE | 3     | 2m 32s  |                                                                         |
| REQ-07      | INSUFFICIENT_EVIDENCE | 2     | —       | Agent stopped (timeout): the host slept mid-call (see §4)               |
| REQ-08      | FAIL                  | 12    | 6m 24s  |                                                                         |
| REQ-09      | FAIL                  | 9     | 4m 20s  |                                                                         |
| REQ-10      | PASS                  | 5     | 1m 53s  |                                                                         |
| REQ-11      | INSUFFICIENT_EVIDENCE | 5     | 3m 14s  |                                                                         |
| REQ-12      | INSUFFICIENT_EVIDENCE | 20    | 17m 46s | Agent stopped (turn budget) after repeated coverage rejections (see §4) |

Both stopped investigations defaulted to `INSUFFICIENT_EVIDENCE` with the reason stated in the report, as designed: an agent that cannot finish never produces a confident result.

## 3. Execution metrics

| Metric              | Value                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Wall clock          | 1 h 42 m (includes ~45 min the machine was asleep during REQ-07)                                                 |
| Model calls         | 90 (1 retry, 0 errors)                                                                                           |
| Tokens              | 411,127 total: 335,489 input (295,190 served from the prompt cache), 75,638 output                               |
| Tool calls          | 114: 36 `get_issue`, 33 `get_comments`, 6 `search_issues`, 1 `submit_plan`, 38 `record_decision`                 |
| Rejected tool calls | 28, almost all `record_decision` attempts refused by the evidence ledger or coverage gate (15 of them in REQ-12) |
| Jira requests       | 81 (0 retries, 0 errors), 33 s total                                                                             |
| Cost                | $0 (local model). With a hosted model, set `LLM_PRICE_*` and the report prices the same token counts             |
| Discovery           | 3 turns, 78 s                                                                                                    |

Model latency dominates: about 38 s per turn for an 8B "thinking" model on a consumer 8 GB GPU. The same run on a hosted model is minutes, not an hour (the provider is configuration).

## 4. What the run showed, and what changed after it

**REQ-07: host sleep.** One model call started at 11:26 and its 5-minute timeout fired only at 12:11. A timer firing 40 minutes late means the process was suspended: the PC went to sleep. On wake the call timed out, retried and succeeded in 58 s, but the investigation had used its 20-minute wall-clock budget and stopped. _Mitigation:_ keep the machine awake during long local runs (README), and rerun just the stopped requirements with `--resume`.

**REQ-12: an unhelpful rejection message.** The agent had reached its decision by turn 3, but the coverage gate refused it: the requirement's own comments had not been read, and one linked record's comments had been read without opening the record. The message said "open AND read the comments of …", and the small model kept resubmitting the same decision for 15 turns. _Fix (after the run, tested):_ the rejection now names each missing call exactly, e.g. `get_comments(ref="KAN-403") [REQ-12], get_issue(ref="KAN-321") [REC-5957]`, and tells the model not to resubmit until they are done. The lesson matches run 3 in [15-testing-evaluation.md](15-testing-evaluation.md): small models need precise, actionable feedback, not general instructions.

**To complete the two stopped requirements** without redoing the other ten:

```bash
npm run assess -- --resume runs/20261115-110400-R2.4
```

Decided requirements are reused from the folder, so only REQ-07 and REQ-12 are investigated again, and a new run folder is written with the complete report.

## 5. Reproducing

```bash
npm install && cp .env.example .env     # Jira + LLM settings
npm run verify-jira && npm run import && npm run verify-import
npm run assess                          # or: npm run ui, then "New run"
```

For a quick look without a long run: `npm run assess -- --only REQ-04` (discovery plus one requirement, a few minutes on a local model), or open the UI on the submitted run folder with `npm run ui`.
