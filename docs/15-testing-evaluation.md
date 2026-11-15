# Module 15: Testing & Evaluation

**Status:** built · tested

## 1. Two kinds of verification

|                   | Tests (`npm test`)                                           | Evaluation (`npm run evaluate`)                             |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Question answered | Does the code behave as designed?                            | Does the agent reach the right decisions on real Jira data? |
| Model             | Scripted test double (`ScriptedLlm`)                         | The configured real LLM                                     |
| Jira              | In-memory `FakeJira` (real client code via an axios adapter) | The real Jira Cloud site                                    |
| Deterministic     | Yes                                                          | As far as the provider allows                               |
| Network           | None                                                         | Jira + LLM                                                  |

## 2. Test suite (83 tests, 9 files)

| File                   | Covers                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jira-http.test.ts`    | Retry policy: Retry-After, 503 backoff, no retry of timed-out writes, idempotent search retry, 401 no-retry with actionable message, 404 mapping, give-up after max retries, multi-page search                                                                                                                                                                                                                        |
| `mapping.test.ts`      | ADF round trip of all 2,059 comments and 400 descriptions; labels incl. `rr-requirement`; metadata block; `n/N` comment headers; refusal to truncate; JQL scope wrapping and escaping                                                                                                                                                                                                                                 |
| `importer.test.ts`     | Full import into fake Jira + `verify-import` OK; idempotent rerun (zero writes); resume after crash; dry run; unrelated tickets ignored; tamper detection; helpful wrong-project error                                                                                                                                                                                                                                |
| `tools.test.ts`        | Scope enforcement; link direction (OUTGOING/INCOMING, hidden out-of-scope); noise collapsing (62 → 1 line); recorded-time ordering; `check_scope` verdicts (staging, production, prompt not stated, approval wording, wrong service/release); ledger rejections; **coverage gate** (incl. a 2-hop dependency); source-ID citations; actionable comment-id hints; `submit_plan` validation; provider-safe tool schemas |
| `llm.test.ts`          | OpenAI-compatible adapter: tool-call and usage parsing, raw tool-call echo (Gemini thought signatures), per-minute 429 waits, daily quota stops, 5xx backoff, 401/400 fail fast, invalid JSON args, timeouts labelled; rate limiter                                                                                                                                                                                   |
| `loop.test.ts`         | Model-chosen tool sequence to an accepted decision; rejected decision corrected; nudge then `no_tool_call`; budget warning then `max_turns`; tool-call and token budgets; quota and LLM errors produce no decision; invalid JSON and unknown tools recoverable; context elision                                                                                                                                       |
| `orchestrator.test.ts` | Manifest parsing; overall rule; end-to-end discovery → 12 investigations → report; aborts (discovery failure, wrong release, empty scope); quota stop → NOT ASSESSED → resume; crash containment; persistence                                                                                                                                                                                                         |
| `evaluate.test.ts`     | Accuracy, overall match and wrong-direction ("critical") errors                                                                                                                                                                                                                                                                                                                                                       |
| `server.test.ts`       | HTTP API and Socket.io: start → 202, busy → 409, live and replayed events, run list/detail/report/transcripts, `--only` pass-through, input validation, config errors, interrupted runs, unsafe ids → 404                                                                                                                                                                                                             |

`npm run check` runs typecheck, lint, format check and the tests.

## 3. Evaluation

The expected outcome per requirement was derived by hand from the records. It is stored in a **local, git-ignored file** (`eval/expected-<release>.json`) so the public repository does not publish an answer key; the agent never reads it and the prompts contain no dataset-specific content. The file format is shown in [`eval/README.md`](../eval/README.md).

`npm run evaluate -- runs/<runId>` writes `evaluation.md` / `evaluation.json` into the run folder:

- requirement accuracy and overall-decision match;
- **critical errors**: wrong-direction mistakes (PASS↔FAIL, or INSUFFICIENT → PASS) are worse than over-caution, because the brief stresses that missing proof must not be approved;
- per requirement: expected vs actual, status, anomalies flagged.

## 4. Run history (what we measured and changed)

The design was validated iteratively against the real Jira site. Each finding led to a fix in code, not just a prompt tweak.

| #   | Model                                 | What happened                                                                                                                                                                                                                                                                                     | Change                                                                                                                                                                                          |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Newest hosted Flash model (free tier) | Provider overloaded: requests hung 120 s, then 503 "high demand"; run aborted cleanly in discovery                                                                                                                                                                                                | Timeouts labelled in the trace; `LLM_TIMEOUT_MS`; `verify-llm --models` probes availability and latency before a run                                                                            |
| 2   | Hosted Flash model (free tier)        | First requirement decided correctly with strong reasoning (rejected a run on the wrong commit), then the **free tier's 20 requests/day per model** was exhausted; quota stop handled honestly, remaining requirements marked not assessed                                                         | Prompt batching to cut requests; per-requirement model recorded; local model path (Ollama) with a setup script                                                                                  |
| 3   | qwen3:8b (local)                      | The model reached the right judgement but **cited source IDs** and **omitted comment ids**; validator errors were not actionable, so it gave up and downgraded its decision                                                                                                                       | Citations accept source IDs; rejections list the exact comment ids already read (actor, role, excerpt)                                                                                          |
| 4   | qwen3:8b (local)                      | The model **stopped investigating early** (3–4 turns, linked QA records never opened); quota-oriented prompt wording encouraged it and nothing prevented deciding blind                                                                                                                           | **Coverage gate**: no decision until the requirement, its linked records and their dependencies (2 hops) are opened and read; prompt v3; configurable investigation timeout                     |
| 5   | qwen3:8b (local)                      | Thorough investigations (6–8 turns); two remaining errors traced to `check_scope` output: "prompt not stated" misled the model on a non-prompt criterion, and a prompt mismatch stated in a neighbouring comment was missed                                                                       | `check_scope` reports the build match separately from the prompt and surfaces prompt statements from other comments on the same record                                                          |
| 6   | qwen3:8b (local)                      | **Submitted run** `20261115-110400-R2.4`: overall BLOCKED; 10 of 12 decided with thorough investigations (3–12 turns). Two stopped: REQ-07 timed out because the PC slept mid-call; REQ-12 hit the turn budget resubmitting a correct decision against a coverage rejection it did not understand | Coverage rejections name each missing `get_issue` / `get_comments` call; keep the host awake for local runs; `--resume` reruns only stopped requirements ([18-submission.md](18-submission.md)) |

**Lesson:** a small local model needs **mechanical guardrails** (coverage gate, validated citations, actionable errors, tools that surface the right facts) more than longer prompts. Each guardrail encodes a rule from the brief ("investigate linked records", "do not invent results") without telling the model what to decide.

## 5. Model choice (quality · cost · latency)

| Model                                | Observed                                       | Cost        | Latency                  | Constraint              |
| ------------------------------------ | ---------------------------------------------- | ----------- | ------------------------ | ----------------------- |
| Newest hosted Flash                  | n/a                                            | Free tier   | n/a                      | Overloaded on free tier |
| Hosted Flash                         | Strong reasoning on the requirement it reached | Free tier   | ~1.5 s/turn              | 20 requests/day/model   |
| qwen3:8b via Ollama (RTX 4060, 8 GB) | Good with guardrails                           | Free, local | ~30–40 s/turn (thinking) | None; data stays local  |

The provider is configuration (`LLM_BASE_URL`, `LLM_MODEL`), so a production deployment can use a stronger hosted model (e.g. Azure OpenAI) with no code change.
