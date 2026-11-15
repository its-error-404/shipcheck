# Module 16: Server and live runs (bonus)

**Status:** built · tested

**Code:** `apps/server/src/` (`app.ts`, `live.ts`, `routes/runs.ts`, `constants.ts`), `packages/core/src/agent/session.ts`, `packages/core/src/report/run-reader.ts` · **Tests:** `apps/server/test/server.test.ts`

## 1. Purpose

Expose the same assessment the CLI runs through an HTTP API, and stream its progress live to a browser. The server adds no assessment logic: it reads run folders and starts runs through the same session code as `npm run assess`.

```bash
npm run ui        # build the web UI, then serve UI + API on http://127.0.0.1:4000
npm run serve     # API (and an already-built UI) only
```

## 2. Options considered

| Option                                      | For                                                                                       | Against                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Fastify + Socket.io** ✅                  | Small, typed, fast to start; Socket.io gives reconnects, fallbacks and broadcast for free | Two libraries instead of one                                                                |
| Express + Socket.io                         | Most familiar                                                                             | No built-in schema or logging story; async errors need wrappers                             |
| Server-Sent Events only                     | No extra dependency; one-way streaming fits                                               | Hand-rolled reconnect and replay; Socket.io was an explicit stack goal                      |
| UI reads run folders directly (static site) | No server at all                                                                          | No live runs; cannot start a run                                                            |
| Separate job queue (BullMQ/Redis) for runs  | Durable, multi-worker                                                                     | Infrastructure for a single-user local tool; free tiers and one GPU allow one run at a time |

## 3. Design

```
Browser ──REST──▶ Fastify ──▶ RunReader (runs/<id>/…)               read-only
   ▲                 │
   │                 └──POST /api/runs──▶ LiveRuns ──▶ prepareSession() ──▶ assess()
   │                                         │                             (same code as the CLI)
   └────Socket.io: run:status / run:trace / run:replay / run:finished / run:failed
```

**Shared session (`prepareSession`).** Config validation, client construction, the run folder, trace sinks, `assess()`, metrics and report writing live in one function. The CLI adds a terminal progress sink; the server adds a Socket.io sink. Both produce identical run folders, so anything started from the UI can be resumed or evaluated from the CLI and vice versa.

**One run at a time.** `LiveRuns` rejects a second start with `409` and the active run id. Free tiers share one quota and a local model shares one GPU, so concurrent runs would only slow each other down. Within a run, `ASSESS_CONCURRENCY` still controls parallel investigations.

**Live events.** Every trace event of the active run is broadcast as `run:trace`. The server keeps the active run's events (bounded) and sends them as `run:replay` to a client that connects mid-run, so opening the page halfway through shows the full progress, not an empty panel.

**Reading runs.** `RunReader` lists run folders newest first. A folder is _complete_ once `report.json` exists. Before that (a run in progress, or one that was stopped) the per-requirement files written as each investigation finishes are read instead, so partial progress is visible and the UI can offer **Resume**.

## 4. API

| Method | Path                             | Returns                                                                                                                               |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                    | `{ ok: true }`                                                                                                                        |
| GET    | `/api/config`                    | Which Jira/LLM settings are present, plus site, project and model names. Never secret values                                          |
| GET    | `/api/runs`                      | Run summaries: state, release, model, overall decision, counts, time, tokens                                                          |
| GET    | `/api/runs/:id`                  | `report.json`, `metrics.json` and requirement results                                                                                 |
| GET    | `/api/runs/:id/report.md`        | The Markdown report                                                                                                                   |
| GET    | `/api/runs/:id/trace`            | Trace events (newest 5,000)                                                                                                           |
| GET    | `/api/runs/:id/transcripts/:req` | One investigation's full conversation                                                                                                 |
| GET    | `/api/live`                      | Active run and last result                                                                                                            |
| POST   | `/api/runs`                      | Body `{ only?: string[], resumeFrom?: string }` → `202` with the run info; `409` when busy; `400` for invalid input or missing config |

## 5. Security and failure modes

| Concern                         | Handling                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Starting runs uses your tokens  | Binds to `127.0.0.1` by default (`SERVER_HOST` to change). This is a local tool, not a public service; there is no auth layer |
| Path traversal in run ids       | Run ids and requirement ids are checked against a plain-name pattern before any file access; anything else is a 404           |
| Secrets                         | `/api/config` reports only which keys are present. Tokens never leave the server process                                      |
| Missing or invalid config       | Start returns `400` with the same actionable message the CLI prints (e.g. "JIRA_BASE_URL is not set")                         |
| Run fails mid-way               | `run:failed` with the reason; per-requirement results already saved stay readable; Resume reuses them                         |
| Server stopped mid-run (Ctrl+C) | Stops at once; the run folder keeps finished requirements and is resumable                                                    |
| Client disconnects / reconnects | Socket.io reconnects; status and replay are re-sent on connect                                                                |

## 6. Configuration

| Variable          | Default     | Meaning                     |
| ----------------- | ----------- | --------------------------- |
| `SERVER_HOST`     | `127.0.0.1` | Bind address                |
| `SERVER_PORT`     | `4000`      | Port                        |
| `SERVER_RUNS_DIR` | `runs`      | Run folders to list and use |

Jira, LLM and assessment settings are the same `.env` values the CLI uses.

## 7. Tests

`server.test.ts` builds the app on a random port with an injected session factory (no Jira, no model) and checks: health and config without secret values; start → `202`; second start → `409`; Socket.io `run:started`, `run:trace`, `run:finished`; replay to a client that joins mid-run; run list and detail after completion; Markdown report and transcripts; `--only` passed through; invalid input → `400`; config errors surfaced; an interrupted run read from its per-requirement files; unsafe ids → `404`.

## 8. Likely questions

**Why not put the server in front of everything and drop the CLI?** The CLI is the primary, scriptable interface and what CI would use. The server is a thin layer over the same session function; neither depends on the other.

**Why is there no authentication?** It runs locally and binds to loopback. Exposing it would need auth and per-user credentials, which is out of scope for a local assessment tool.

**What happens with two browser tabs?** Both receive the same live events; only one run can be started.

**Why Socket.io rather than SSE?** SSE would work for one-way streaming. Socket.io adds reconnects, transport fallback and rooms with no extra code, and was a deliberate stack choice.
