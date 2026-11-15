# Shipcheck

A tool-using AI agent that investigates Jira and produces an evidence-backed **release-readiness report**: a `PASS` / `FAIL` / `INSUFFICIENT_EVIDENCE` decision per requirement and an overall `BLOCKED` / `NEEDS_REVIEW` / `READY` decision for the release.

- The model chooses every evidence-gathering action through **read-only, scope-enforced Jira tools**. It never receives the dataset file.
- Every citation is **validated against what the agent actually fetched** in that run (evidence ledger), and evidence in the report is quoted from Jira, not from the model.
- The agent **must open and read every linked record and dependency** before it may decide (coverage gate).
- The overall decision is computed **in code** from a fixed rule.
- Runs are **bounded** (turns, tool calls, tokens, time), **traced** (JSONL), **measured** (time, tokens, cost) and **resumable**.

TypeScript · Node.js 22 · no agent framework · any OpenAI-compatible LLM (Gemini, Groq, Ollama, OpenAI, Azure OpenAI) · Jira Cloud REST v3 · CLI, plus a Fastify + Socket.io server and React UI with live progress.

![Shipcheck web UI](docs/images/ui-run.png)

---

## Results

**Release R2.4: BLOCKED.** Mandatory requirements failed (REQ-02, REQ-03, REQ-05, REQ-08, REQ-09); 3 pass, 5 fail, 4 insufficient evidence.

| Run                                                           | Model                    | Wall clock | Model calls | Tokens                   | Tool calls | Cost |
| ------------------------------------------------------------- | ------------------------ | ---------- | ----------- | ------------------------ | ---------- | ---- |
| [`20261115-110400-R2.4`](runs/20261115-110400-R2.4/report.md) | qwen3:8b (local, Ollama) | 1 h 42 m   | 90          | 411,127 (295,190 cached) | 114        | $0   |

The run folder has `report.md` (human), `report.json` (machine), `trace.jsonl` (every model call, tool call and Jira request), `transcripts/` (each investigation's full conversation) and `metrics.json`. Import evidence is in [`artifacts/import/`](artifacts/import/).

Two investigations stopped and were reported as `INSUFFICIENT_EVIDENCE` with the reason (REQ-07: the PC slept mid-call; REQ-12: turn budget). What happened, the fix made afterwards, and how to rerun just those two: [docs/18-submission.md](docs/18-submission.md). Run history and lessons: [docs/15-testing-evaluation.md](docs/15-testing-evaluation.md).

---

## Quick start (about 10 minutes, free)

**Prerequisites:** Node.js 22+, a free Jira Cloud site, and an LLM endpoint (a free Gemini API key, or Ollama locally).

```bash
npm install
cp .env.example .env        # fill in Jira + LLM settings (see below)
npm run check               # typecheck + lint + format + 83 tests (no network needed)
```

### 1. Jira

1. Create a free site at atlassian.com (Jira → Get it free).
2. Create a project: **Scrum** template (company-managed) or team-managed Kanban; any key works.
3. Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>.
4. Set `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` in `.env`.

```bash
npm run verify-jira         # ✓ Authenticated … ✓ Project … (lists project keys if yours is wrong)
npm run import -- --dry-run # preflight + plan, no writes
npm run import              # 400 issues, 2,059 comments, links, statuses (safe to rerun; resumes)
npm run verify-import       # diffs Jira against the dataset → artifacts/import/verify-report.json
```

### 2. LLM (pick one)

**Gemini (free tier)**: key from <https://aistudio.google.com>:

```
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_API_KEY=...
LLM_MODEL=<a Flash model>
LLM_RPM=8
```

```bash
npm run verify-llm                                       # lists models your key can use
npm run verify-llm -- --models gemini-3.6-flash,gemini-3.5-flash   # probes tool calling + latency
```

Note: some free tiers allow very few requests per day per model; a full run needs roughly 80–150.

**Ollama (local, unlimited, data stays on the machine)**: Windows one-liner:

```bash
npm run setup:ollama        # installs Ollama, sets context window, pulls qwen3:8b, updates .env
npm run verify-llm -- --models qwen3:8b
```

### 3. Assess

```bash
npm run assess                               # release, label, project from .env (R2.4 by default)
npm run assess -- --release R2.4 --project KAN
npm run assess -- --resume runs/<runId>      # continue after a quota stop; decided requirements are reused
npm run assess -- --only REQ-05              # quick demo: discovery + selected requirements only (not a release decision)
npm run evaluate -- runs/<runId>             # score against a local expected-outcomes file (eval/README.md)
```

Local models are slow (about 40 s per turn on an 8 GB GPU; a full run is around an hour). Keep the machine awake during a run: if it sleeps, the investigation in progress times out. `--resume` then reruns only the requirements that did not finish.

### 4. Web UI (optional)

```bash
npm run ui                  # builds the UI and serves it with the API on http://127.0.0.1:4000
```

Browse runs, open any requirement to see its reasoning and the Jira evidence quoted with actor, role and time, read the agent's own tool calls, and start a run (full or selected requirements) with live progress over Socket.io. The server binds to localhost: it uses your `.env` credentials. Details: [docs/16-server.md](docs/16-server.md), [docs/17-web-ui.md](docs/17-web-ui.md).

---

## How it works

```
Preflight ─▶ Discovery agent ─▶ Manifest (code) ─▶ Investigator agent × 12 ─▶ Overall (code) ─▶ Report
             finds manifest +    parses target     fresh context, budget,     any FAIL → BLOCKED
             requirements via    + rules from      ledger, coverage gate      any INSUFFICIENT → NEEDS_REVIEW
             tools; validated    Jira                                         else READY
```

| Tool                              | Purpose                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `search_issues`                   | Structured search (code builds the JQL, always inside project + label scope)                     |
| `get_issue`                       | Metadata, original description, links tagged OUTGOING / INCOMING                                 |
| `get_comments`                    | Paged comments with **recorded** actor/role/time; near-duplicate noise collapsed                 |
| `check_scope`                     | Deterministic comparison of a result's release/commit/service/environment/prompt with the target |
| `submit_plan` / `record_decision` | Terminal tools, validated against Jira and the evidence ledger                                   |

Full design: **[docs/README.md](docs/README.md)**: one document per module (options considered, decision, rejected alternatives, failure modes, likely questions), decision records, [coding standards](docs/coding-standards.md) and [AI assistance](docs/ai-assistance.md).

---

## Repository layout

```
packages/core/src/
  agent/       orchestrator, loop, prompts, manifest parsing, overall decision
  tools/       read-only agent tools, scoped Jira view, parsers, registry
  jira/        HTTP layer (retry policy), client (reader/writer split), ADF, JQL
  import/      dataset schema, mapping, idempotent importer, verifier
  llm/         provider-neutral types, OpenAI-compatible adapter, rate limiter, scripted test double
  report/      markdown report, metrics, run store (trace, resume), run reader
  agent/session.ts  one run end to end, shared by the CLI and the server
  eval/        scoring against expected outcomes
  constants/ models/ utils/ testing/ (fake Jira)
apps/cli/      commands: verify-jira, import, verify-import, verify-llm, assess, evaluate
apps/server/   Fastify REST API + Socket.io live runs
apps/web/      React + Vite UI
artifacts/     import plan, report and ID map from the real import
docs/          design documentation
eval/          format of the local expected-outcomes file (read only by `evaluate`, never by the agent)
inputs/        dataset.json (import input only)
runs/          assessment outputs
scripts/       setup-ollama.ps1
```

## Commands

| Command                                  | What it does                                     |
| ---------------------------------------- | ------------------------------------------------ |
| `npm run check`                          | Typecheck, lint, format check, tests             |
| `npm run verify-jira`                    | Credentials + project check                      |
| `npm run import [-- --dry-run]`          | Idempotent import into Jira                      |
| `npm run verify-import`                  | Diff Jira against the dataset                    |
| `npm run verify-llm [-- --models a,b]`   | List models; probe tool calling and latency      |
| `npm run assess [-- --resume runs/<id>]` | Run the agent and write the report               |
| `npm run evaluate -- runs/<id>`          | Score a run against expected outcomes            |
| `npm run ui`                             | Build the web UI and serve UI + API (:4000)      |
| `npm run serve`                          | Serve the API (and a built UI)                   |
| `npm run web:dev`                        | UI dev server with hot reload (:5173)            |
| `npm run setup:ollama`                   | Local LLM setup (Windows)                        |
| `npm run fake-jira`                      | In-memory Jira over HTTP for offline development |
