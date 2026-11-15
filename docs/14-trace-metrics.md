# Module 14 — Trace & Metrics

**Status:** built · tested

**Code:** `packages/core/src/trace.ts`, `constants/trace.ts`, `report/run-store.ts` (`JsonlTrace`), `report/metrics.ts`

## Trace

`runs/<runId>/trace.jsonl`: one JSON event per line, timestamped. Event types are defined once in `TRACE_EVENTS`:

| Event                                     | Fields                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `run_start` / `run_phase` / `run_end`     | request, model, prompt version, phase, status, overall                                                         |
| `agent_start` / `agent_stop`              | label (discovery / REQ-xx), budget, stop reason, turns, tool calls, tokens, duration                           |
| `llm_call`                                | turn, model, input/output/cached tokens, latency, quota wait, retries, finish reason, tool names, text preview |
| `llm_retry` / `llm_error`                 | reason, attempt, delay                                                                                         |
| `tool_call`                               | tool, arguments, ok, terminal, result size, duration, preview                                                  |
| `jira_http` / `jira_retry` / `jira_error` | method, path, status, duration, retries                                                                        |
| `budget_warning` / `context_elided`       | turns left / results elided                                                                                    |
| `requirement_result`                      | key, decision, status                                                                                          |

Sinks compose: `TeeTrace([JsonlTrace, MemoryTrace, CallbackTrace])` writes the file, keeps events for metrics, and prints live progress (the bonus UI would add a Socket.io sink).

`runs/<runId>/transcripts/<REQ>.json` holds the full conversation per investigation.

## Metrics

`runs/<runId>/metrics.json` + the report's _Execution metrics_ section:

- wall-clock time; model latency vs **rate-limit waiting** (separated, so free-tier waits don't look like slow models)
- model calls, retries, errors; tool calls by tool and tool errors; Jira HTTP calls, retries, errors, time
- input / cached / output / total tokens
- **estimated cost** from `LLM_PRICE_INPUT_PER_MTOK` / `LLM_PRICE_OUTPUT_PER_MTOK` (0 on free tiers; set paid prices to estimate production cost)
- per requirement: decision, status, turns, tool calls, tokens, time, stop reason; plus discovery
