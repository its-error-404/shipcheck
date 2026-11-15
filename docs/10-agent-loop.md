# Module 10 — Agent Loop & Budgets

**Status:** built · tested

## 1. Purpose

A bounded, observable tool-calling loop: the "agent" itself.

**Code:** `packages/core/src/agent/loop.ts` · **Tests:** `packages/core/test/loop.test.ts`

## 2. Algorithm

```
messages = [task]
loop:
  stop if turns ≥ maxTurns | toolCalls ≥ maxToolCalls | inputTokens ≥ maxInputTokens | elapsed ≥ timeout
  if turns left ≤ 3 (once): append "Budget almost exhausted: call the terminal tool now…"
  elide old large tool results if the conversation exceeds the size threshold
  reply = llm.chat(system, messages, tools)       // quota → stop(quota_exhausted); other error → stop(llm_error)
  if no tool calls: nudge once; second time → stop(no_tool_call)
  for each tool call, in order:
     validate (zod) → run (read-only) → append result → trace
     if a terminal tool accepted the result → stop(terminal)
```

## 3. Budgets

Configured per phase by the orchestrator (Module 12):

|                                | Discovery | Each investigation |
| ------------------------------ | --------- | ------------------ |
| Max model turns                | 12        | 20                 |
| Max tool calls                 | 25        | 40                 |
| Max input tokens               | 150k      | 200k               |
| Wall-clock (incl. quota waits) | 5 min     | 8 min              |

**Graceful landing:** when 3 turns remain, the loop asks the model to finish with the evidence it has and list anything unverified as outstanding. A hard cut-off would discard the whole investigation.

## 4. Stop reasons

`terminal` · `max_turns` · `max_tool_calls` · `token_budget` · `timeout` · `no_tool_call` · `llm_error` · `quota_exhausted`

Every stop is traced (`agent_stop`) with turns, tool calls, tokens and duration. Any non-`terminal` stop becomes `INSUFFICIENT_EVIDENCE` in the report with the reason stated (Module 12). A failure is never converted into PASS or FAIL.

## 5. Robustness

| Problem                                | Handling                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Model answers in prose                 | One nudge; then `no_tool_call`                                                                                                          |
| Invalid JSON arguments                 | Tool error returned to the model                                                                                                        |
| Unknown tool name                      | Tool error listing available tools                                                                                                      |
| Tool throws unexpectedly (a bug)       | Converted to a tool error; run continues; visible in trace                                                                              |
| Terminal tool rejected (bad citations) | Rejection returned; model can fix within budget                                                                                         |
| Several tool calls in one turn         | Executed sequentially in order; remaining calls after a terminal result are answered "not executed" so the transcript stays well-formed |

## 6. Context management

- Primary mechanisms: per-requirement isolation (Module 1), compact tools, collapsed noise and the 6,000-character result cap (Module 7). Expected size: roughly 10–25k tokens per investigation.
- **Safety valve:** above ~60k characters, the oldest tool results larger than 1,500 characters are replaced with `[earlier result elided … its evidence remains citable]`. The ledger keeps the facts, so citations stay valid.
- **Rejected:** LLM-written conversation summaries (extra quota, risk of losing exact figures).

## 7. Observability

Trace events: `agent_start`, `llm_call` (turn, tokens incl. cached, latency, quota wait, retries, finish reason, tool names, text preview), `tool_call` (tool, args, ok, terminal, result size, duration, preview), `budget_warning`, `context_elided`, `agent_stop`. The full transcript is returned for the investigation trace.

## 8. Test evidence

Model-chosen tool sequence ending in an accepted decision; rejected decision fed back and corrected; nudge then `no_tool_call`; budget warning injected then `max_turns`; tool-call and token budgets; quota exhaustion and LLM errors produce no decision; invalid JSON and unknown tool become recoverable errors; context elision triggers.

## 9. Likely questions

**Q: What stops it looping forever?** Four independent budgets, all reported.

**Q: What if the model never decides?** Nudge, then the budget warning; otherwise `INSUFFICIENT_EVIDENCE` with the honest reason.

**Q: Why sequential tool execution?** Deterministic, readable traces and gentler on rate limits; the latency gain from parallelism is small here.

**Q: Is it deterministic?** As far as providers allow: temperature 0, sequential tools, fixed investigation order. The trace records exactly what happened.
