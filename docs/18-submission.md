# Module 18: Submission and results

**Status:** done

## 1. What is submitted

| Deliverable                    | Where                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Source code                    | `packages/core` (agent, tools, Jira, importer, report), `apps/cli`, `apps/server`, `apps/web`                                               |
| Setup and run instructions     | [README.md](../README.md)                                                                                                                   |
| Pinned dependencies            | Exact versions in every `package.json`, plus `package-lock.json`                                                                            |
| Import evidence                | [`artifacts/import/`](../artifacts/import/): plan, report (400 issues, 2,059 comments, 76 links, statuses) and the source-ID → Jira-key map |
| Generated report (final)       | [`runs/20261115-142937-R2.4/report.md`](../runs/20261115-142937-R2.4/report.md) and `report.json`                                           |
| First full run                 | [`runs/20261115-110400-R2.4/`](../runs/20261115-110400-R2.4/report.md): all 12 investigations, 10 decided                                   |
| Trace                          | `trace.jsonl` in each run folder (every model call, tool call and Jira request) and `transcripts/` (each investigation's full conversation) |
| Execution time and token usage | `metrics.json` in each run folder, summarised below and at the end of each report                                                           |
| Design explanation             | [docs/README.md](README.md): one document per module, decision records, coding standards                                                    |
| AI assistance note             | [ai-assistance.md](ai-assistance.md)                                                                                                        |

## 2. Submitted run

| Item       | Value                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------- |
| Runs       | `20261115-110400-R2.4` (full), completed by `20261115-142937-R2.4` (`--resume`, final report) |
| Jira scope | project `KAN`, label `tyn-release-assessment-v2`, 400 issues                                  |
| Manifest   | `KAN-363` (MANIFEST), found by the discovery agent; 12 requirements, validated by code        |
| Target     | R2.4 · commit `b7a91f2` · service `atlas-assistant` · production · prompt `p7`                |
| Model      | `qwen3:8b` via Ollama, local (RTX 4060, 8 GB); prompt v3                                      |
| Overall    | **BLOCKED**: mandatory requirements failed (4 pass, 6 fail, 2 insufficient)                   |

| Requirement | Decision              | Turns | Time   | Notes                                                                        |
| ----------- | --------------------- | ----- | ------ | ---------------------------------------------------------------------------- |
| REQ-01      | PASS                  | 3     | 1m 40s |                                                                              |
| REQ-02      | FAIL                  | 6     | 4m 01s |                                                                              |
| REQ-03      | FAIL                  | 8     | 4m 53s |                                                                              |
| REQ-04      | PASS                  | 5     | 2m 26s |                                                                              |
| REQ-05      | FAIL                  | 9     | 5m 16s |                                                                              |
| REQ-06      | INSUFFICIENT_EVIDENCE | 3     | 2m 32s |                                                                              |
| REQ-07      | PASS                  | 6     | 5m 54s | Resume run. In the first run the agent stopped (timeout) when the host slept |
| REQ-08      | FAIL                  | 12    | 6m 24s |                                                                              |
| REQ-09      | FAIL                  | 9     | 4m 20s |                                                                              |
| REQ-10      | PASS                  | 5     | 1m 53s |                                                                              |
| REQ-11      | INSUFFICIENT_EVIDENCE | 5     | 3m 14s |                                                                              |
| REQ-12      | FAIL                  | 7     | 4m 39s | Resume run, after the coverage-message fix. First run: turn budget (see §4)  |

In the first run, both stopped investigations defaulted to `INSUFFICIENT_EVIDENCE` with the reason stated in the report, as designed: an agent that cannot finish never produces a confident result. The first run's report is kept as it was, so that behaviour can be inspected.

## 3. Execution metrics

First full run (`20261115-110400-R2.4`):

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

Resume run (`20261115-142937-R2.4`): 12 m wall clock (discovery again, then two investigations), 16 model calls, 58,148 tokens (37,707 cached), 21 tool calls of which 5 were rejected `record_decision` attempts that the agent then corrected. Combined: 106 model calls and 469,275 tokens for the complete assessment.

Model latency dominates: about 38 s per turn for an 8B "thinking" model on a consumer 8 GB GPU. The same run on a hosted model is minutes, not an hour (the provider is configuration).

## 4. What the run showed, and what changed after it

**REQ-07: host sleep.** One model call started at 11:26 and its 5-minute timeout fired only at 12:11. A timer firing 40 minutes late means the process was suspended: the PC went to sleep. On wake the call timed out, retried and succeeded in 58 s, but the investigation had used its 20-minute wall-clock budget and stopped. _Mitigation:_ keep the machine awake during long local runs (README), and rerun just the stopped requirements with `--resume`.

**REQ-12: an unhelpful rejection message.** The agent had reached its decision by turn 3, but the coverage gate refused it: the requirement's own comments had not been read, and one linked record's comments had been read without opening the record. The message said "open AND read the comments of …", and the small model kept resubmitting the same decision for 15 turns. _Fix (after the run, tested):_ the rejection now names each missing call exactly, e.g. `get_comments(ref="KAN-403") [REQ-12], get_issue(ref="KAN-321") [REC-5957]`, and tells the model not to resubmit until they are done. The lesson matches run 3 in [15-testing-evaluation.md](15-testing-evaluation.md): small models need precise, actionable feedback, not general instructions.

**Completing the two stopped requirements.** With the fix in place, the run was resumed without redoing the other ten:

```bash
npm run assess -- --resume runs/20261115-110400-R2.4
```

Discovery ran again (the manifest and target were re-read from Jira), the ten decided requirements were reused, and only REQ-07 and REQ-12 were investigated. REQ-12 was rejected twice by the coverage gate, followed the now-specific instructions, and was decided FAIL in 7 turns; REQ-07 was decided PASS in 6 turns. The result, `20261115-142937-R2.4`, is the final report.

## 5. Reproducing

```bash
npm install && cp .env.example .env     # Jira + LLM settings
npm run verify-jira && npm run import && npm run verify-import
npm run assess                          # or: npm run ui, then "New run"
```

For a quick look without a long run: `npm run assess -- --only REQ-04` (discovery plus one requirement, a few minutes on a local model), or open the UI on the submitted run folder with `npm run ui`.
