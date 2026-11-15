# Design

How Shipcheck works, the main decisions and why, and what it does not do.

## 1. The problem

A release (R2.4) has 12 requirements. The evidence for them (QA runs, approvals, defects, developer notes) is spread over 400 Jira issues and 2,059 comments, mixed with noise and deliberate traps: results on the wrong build, staging approvals, a different prompt, superseded retests, conflicting results, defects hidden behind a linked record. The agent must investigate Jira through tools and decide, per requirement, `PASS`, `FAIL` or `INSUFFICIENT_EVIDENCE`, then give an overall `BLOCKED` / `NEEDS_REVIEW` / `READY`.

The rules come from the manifest record in Jira, for example: Jira status `Done` is not proof; QA results must match the target release, commit, service and environment (and the deployed prompt for quality checks); a later retest that explicitly supersedes an earlier one governs; equally authoritative, unresolved results mean insufficient evidence; an unclosed defect on the target blocks, including through linked records.

## 2. Overview

```
dataset.json ──importer──▶ Jira (label tyn-release-assessment-v2)
                                  ▲ read-only tools
Preflight ─▶ Discovery agent ─▶ Manifest (code) ─▶ Investigator agent × 12 ─▶ Overall (code) ─▶ Report
             finds manifest      reads target       one fresh agent per         any FAIL → BLOCKED
             + requirements;     + rules from       requirement, bounded,       any INSUFFICIENT → NEEDS_REVIEW
             checked by code     Jira               checked by the ledger       else READY
```

- **The model decides what to look at and judges the evidence.** It calls tools to search, open issues, read comments and check scope. It never receives the dataset file.
- **Code decides what can be decided mechanically:** whether a result's build matches the target, whether a citation is real, whether the investigation covered the linked records, and the overall decision.

## 3. Import

| Source            | In Jira                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `source_id`       | Summary prefix `[REC-9745] …` and label `src-REC-9745` (exact lookup, idempotency key)                                                          |
| `kind`, `release` | Labels `kind-…`, `rel-…`; requirements also get `rr-requirement` (named in the manifest)                                                        |
| `recorded_status` | The Jira status of the same name                                                                                                                |
| `description`     | A short importer metadata block, then the original text verbatim                                                                                |
| `comments`        | One Jira comment each, in source order, with header `[Source comment n/N · ID]`, text verbatim (actor, role and recorded time stay in the text) |
| `links`           | Jira "Relates" links, plus a line in the description recording which record declared them                                                       |

- **Repeatable:** issues are found by their `src-` label before anything is created, so a rerun creates nothing new and an interrupted import resumes.
- **Checked:** `npm run verify-import` reads everything back and diffs it against the dataset (issues, comments, labels, statuses, links) into `artifacts/import/verify-report.json`.
- Jira gives every imported comment the same timestamp, so the recorded time and actor inside the text are the scenario facts, as the manifest says.

## 4. The agent

**Discovery.** An agent searches inside the label scope, finds the manifest and submits the requirement list. Code checks that every key is an in-scope requirement linked from the manifest. Then code reads the target build and the rules from the manifest.

**Investigation.** One fresh agent per requirement, with the target, the rules and the requirement key. Separate contexts keep one requirement's noise out of another and contain failures.

| Tool              | What it does                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `search_issues`   | Structured search; code builds the JQL, always inside the project and label                            |
| `get_issue`       | Metadata, original description, links marked OUTGOING (declared here) or INCOMING (declared elsewhere) |
| `get_comments`    | Paged comments with recorded actor, role and time; near-identical noise collapsed into one line        |
| `check_scope`     | Compares the release/commit/service/environment/prompt stated in a comment with the target. Pure code  |
| `record_decision` | Ends the investigation. Validated before it is accepted (below)                                        |

**Budgets.** Each agent has limits on turns, tool calls, tokens and time, with a warning to conclude before the turn limit. Long conversations drop old tool output. An agent that hits a limit does not produce a decision.

## 5. Guardrails in code

Each guardrail enforces a manifest rule mechanically instead of trusting the prompt:

| Check (in `record_decision`) | Rule it enforces                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Evidence ledger**          | Every cited issue and comment must have been fetched in this investigation. PASS needs a cited comment supporting pass, FAIL one supporting fail. No invented results                            |
| **Coverage**                 | Before deciding, the agent must open and read the requirement, its linked records and their links (two hops). Hidden dependencies cannot be skipped. A rejection names the exact missing calls   |
| **Scope**                    | If every result cited for a PASS or FAIL names a different build (or a different prompt, for prompt criteria), the decision is rejected: a result on another build says nothing about the target |
| **INSUFFICIENT needs a gap** | `INSUFFICIENT_EVIDENCE` must say what verification is missing                                                                                                                                    |

A rejection is returned to the model as a tool error it can fix. The evidence lines in the report come from the ledger (Jira data), not from the model's text; only the explanation is written by the model, and it is labelled.

## 6. Failure handling

| Situation                                    | Result                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| An investigation stops (budget, model error) | That requirement is `INSUFFICIENT_EVIDENCE` with the reason; the others continue |
| Daily model quota exhausted                  | No new work starts; the rest is marked not assessed; `--resume` continues later  |
| Discovery fails or finds the wrong release   | The run aborts with the reason; no decisions are reported                        |
| Jira 429 / 5xx                               | Retried with backoff (Retry-After respected); writes are not blindly retried     |
| Process stopped                              | Each finished requirement is already saved; `--resume` reuses them               |

## 7. Key decisions

| Decision                                 | Why                                                                                         | Alternative considered                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Orchestrator + one agent per requirement | Isolated context, contained failures, readable traces                                       | One agent for everything: context grows, one failure ends the run             |
| Tools over Jira, no RAG                  | Evidence is relational (requirement → link → link) with exact IDs                           | Vector search: does not follow links, would miss hidden dependencies          |
| Mechanical checks in code                | String comparison of builds and citation checks should not depend on the model              | Prompt-only rules: small models do not follow them reliably (seen in testing) |
| Read-only agent                          | The agent's tools have no write access to Jira                                              | One shared client                                                             |
| TypeScript, no agent framework           | The loop is ~200 lines; full control of budgets, tracing and validation                     | LangChain/LangGraph: more to learn and explain than it saves here             |
| Any OpenAI-compatible model              | Free tiers and local models (Ollama) with no code change; production can use a hosted model | One provider SDK                                                              |
| axios                                    | Interceptors for auth, retry and tracing in one place                                       | fetch: retries and interceptors by hand                                       |

## 8. Server and UI (optional)

`npm run ui` serves a React UI and a small Fastify API on `127.0.0.1:4000`. The UI lists runs, shows each requirement's reasoning with the quoted Jira evidence, the agent's tool calls, and live progress over Socket.io; it can start a run. It uses the same session code as the CLI, so both write identical run folders.

- One run at a time (a second start gets `409`, also when two requests arrive together).
- It only accepts requests from its own page: POSTs and WebSockets from other websites are refused, and only JSON bodies are accepted. Secrets never leave the server; `/api/config` reports only which settings are present.
- It is a local tool: there is no login.

## 9. Code and tests

```
packages/core/src/  agent/ (loop, orchestrator, prompts, session) · tools/ · jira/ · import/ · llm/ · report/ · eval/
apps/cli/           commands: verify-jira, import, verify-import, verify-llm, assess, evaluate
apps/server/        Fastify + Socket.io      apps/web/   React + Vite
```

Shared types, constants and helpers live in `models/`, `constants/` and `utils/`. `npm run check` runs typecheck, lint, format check and 90 tests. The tests use an in-memory Jira behind the real HTTP client and a scripted model, so they are fast and need no network: import and re-import, tools and scope checks, every guardrail (including the scope rule on the real dataset), the agent loop and budgets, the orchestrator end to end, quota and resume, and the server API and live events.

## 10. Limitations

- **Judgement still depends on the model.** With a small local model (`qwen3:8b`), one requirement where equally authoritative QA results conflict was judged FAIL instead of insufficient evidence; that judgement is not something code can fully decide.
- **Parsers expect the dataset's phrasing** (`release R2.4; commit …`, `Recorded event … | actor … | role …`). Real Jira text would need a broader format.
- **The time budget is checked between model calls,** so one very slow call can overrun it.
- **Local models are slow** (about 40 s per turn on an 8 GB GPU). A hosted model is a configuration change.
