# Results

## Final report

**[`runs/20261115-154957-R2.4/report.md`](../runs/20261115-154957-R2.4/report.md): release R2.4 is BLOCKED.** Mandatory requirements REQ-02, REQ-05, REQ-08, REQ-09 and REQ-12 failed.

| Requirement | Decision              | Why (short)                                                                                            |
| ----------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| REQ-01      | PASS                  | QA regression run on the target build: 146 of 146 cases pass; an earlier failure was on another commit |
| REQ-02      | FAIL                  | QA retest on the target build found one customer receiving another customer's document                 |
| REQ-03      | INSUFFICIENT_EVIDENCE | The production evaluation used prompt p6, not the deployed p7; the other ran on staging, older commit  |
| REQ-04      | PASS                  | Production latency 1.40 s within the 2.0 s limit; the staging result does not apply                    |
| REQ-05      | FAIL                  | QA cost result USD 0.018 is above the 0.012 limit; a developer's "waived" note does not override QA    |
| REQ-06      | INSUFFICIENT_EVIDENCE | The Security Owner approved staging only; the production approval came from another role               |
| REQ-07      | PASS                  | QA: 28 of 28 redaction cases pass on the target; the failure found was in a different service          |
| REQ-08      | FAIL                  | QA: 0 of 12 escalations reached the support queue; the defect is still open                            |
| REQ-09      | FAIL                  | One rollback rehearsal passed, another failed with data loss; treated as blocking (see limitation)     |
| REQ-10      | PASS                  | A later QA retest supersedes an earlier failure: 60 of 60 cases pass on the target                     |
| REQ-11      | INSUFFICIENT_EVIDENCE | The QA result is on an older release (R2.3); nothing verified on the target                            |
| REQ-12      | FAIL                  | QA streaming result on the target build shows a duplicated final message                               |

Each requirement in the report lists the cited Jira evidence (issue, comment, actor, role, recorded time, quoted text), what is outstanding, and the agent's turns, tool calls, tokens and time.

## How the final report was produced

Model: `qwen3:8b`, locally through Ollama (8 GB GPU). Three runs, each kept in `runs/`:

| Run                                                              | What                                                                                                    | Time     | Model calls | Tokens  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------- | ----------- | ------- |
| [`20261115-110400-R2.4`](../runs/20261115-110400-R2.4/report.md) | Full run, all 12 requirements. Two stopped early (see below) and were reported as insufficient evidence | 1 h 42 m | 90          | 411,127 |
| [`20261115-142937-R2.4`](../runs/20261115-142937-R2.4/report.md) | `--resume`: reran the two stopped requirements (REQ-07, REQ-12)                                         | 12 m     | 16          | 58,148  |
| [`20261115-154957-R2.4`](../runs/20261115-154957-R2.4/report.md) | `--resume` after adding the scope rule: reran REQ-03 and REQ-09; **final report**                       | 18 m     | 20          | 72,810  |

`--resume` reuses finished requirements from a saved run, so only the named ones are investigated again. Discovery runs again every time (the manifest and target are re-read from Jira). In total: 126 model calls, about 542,000 tokens (most served from the prompt cache), $0 with a local model.

Import: 400 issues, 2,059 comments, 76 links and 400 statuses, verified against the dataset with no mismatches ([`artifacts/import/verify-report.json`](../artifacts/import/verify-report.json)).

## What went wrong, and what changed

Each problem was found in the trace and fixed in code, not by tuning prompts for a specific requirement.

| Seen in a run                                                                                                                                  | Change                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Free hosted models were overloaded or hit a 20-requests-per-day limit                                                                          | Switched to a local model (Ollama); quota stops are handled and runs can resume                |
| The model cited source IDs and left out comment ids, then gave up on vague errors                                                              | Citations accept source IDs; rejections list the comment ids already read                      |
| The model decided after 3–4 turns without opening the linked QA records                                                                        | **Coverage check**: the requirement, its linked records and their links must be read first     |
| REQ-12: the model resubmitted a correct decision 15 times against a coverage message it did not understand                                     | Rejections name the exact missing calls, e.g. `get_issue(ref="KAN-321")`                       |
| REQ-07: the PC went to sleep mid-call and the investigation timed out                                                                          | Rerun with `--resume`; keep the machine awake during local runs                                |
| REQ-03: FAIL based on an evaluation run on prompt p6; on a rerun the model then tried PASS from the same evaluation (that rerun was discarded) | **Scope rule**: a PASS or FAIL cannot rest only on results recorded on another build or prompt |

## Known limitation

**REQ-09** is judged FAIL. One rollback rehearsal passed and another, equally authoritative, failed on the target build, with nothing resolving the conflict; under the manifest rules that is insufficient evidence. Deciding which of two conflicting results is authoritative is a judgement the model makes, not something code can check reliably, and this small local model weighs the failure more heavily. The overall decision is the same either way (the release is blocked by other failures), and a stronger hosted model is a configuration change.

## Evaluating runs

`npm run evaluate -- runs/<id>` scores a run against an expected-outcomes file kept outside the repository, so the answer key is not published ([eval/README.md](../eval/README.md)). The agent never reads it.
