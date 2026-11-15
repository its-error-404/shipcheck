/**
 * Bounded tool-calling loop (docs/10-agent-loop.md).
 *
 * The model chooses every action through tools. The loop enforces four
 * independent budgets (turns, tool calls, input tokens, wall-clock), warns
 * the model before the budget runs out so it can land gracefully, and always
 * reports why it stopped. It never converts a failure into a decision.
 */
import { LlmQuotaExhaustedError } from "../llm/errors";
import type { LlmClient, Msg, ToolCall, Usage } from "../llm/types";
import { executeTool, toolSpecs } from "../tools/registry";
import type { ToolContext, ToolDef, ToolResult } from "../tools/types";
import type { TraceSink } from "../trace";

export interface Budget {
  maxTurns: number;
  maxToolCalls: number;
  maxInputTokens: number;
  timeoutMs: number;
  /** Turns remaining at which the "land now" warning is injected. */
  warnAtTurnsLeft?: number;
  /** Conversation size (chars) above which old large tool results are elided. */
  elideAboveChars?: number;
}

export type StopReason =
  | "terminal"
  | "max_turns"
  | "max_tool_calls"
  | "token_budget"
  | "timeout"
  | "no_tool_call"
  | "llm_error"
  | "quota_exhausted";

export interface AgentRunResult<T> {
  label: string;
  stopReason: StopReason;
  terminal?: T;
  error?: string;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  usage: Usage;
  llmLatencyMs: number;
  waitedMs: number;
  durationMs: number;
  transcript: Msg[];
}

export interface RunAgentOptions {
  label: string;
  llm: LlmClient;
  system: string;
  task: string;
  tools: ToolDef[];
  ctx: ToolContext;
  budget: Budget;
  trace: TraceSink;
}

const NUDGE =
  "You replied without calling a tool. Continue the investigation using the tools, and finish by calling the terminal tool. Do not answer in plain text.";

export async function runAgent<T = unknown>(o: RunAgentOptions): Promise<AgentRunResult<T>> {
  const started = Date.now();
  const specs = toolSpecs(o.tools);
  const messages: Msg[] = [{ role: "user", content: o.task }];
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  let turns = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let llmLatencyMs = 0;
  let waitedMs = 0;
  let nudged = false;
  let warned = false;
  const warnAt = o.budget.warnAtTurnsLeft ?? 3;

  const finish = (stopReason: StopReason, extra: { terminal?: T; error?: string } = {}): AgentRunResult<T> => {
    const result: AgentRunResult<T> = {
      label: o.label,
      stopReason,
      ...extra,
      turns,
      toolCalls,
      toolErrors,
      usage,
      llmLatencyMs,
      waitedMs,
      durationMs: Date.now() - started,
      transcript: messages,
    };
    o.trace.emit({
      type: "agent_stop",
      label: o.label,
      stopReason,
      error: extra.error,
      turns,
      toolCalls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      durationMs: result.durationMs,
    });
    return result;
  };

  o.trace.emit({ type: "agent_start", label: o.label, model: o.llm.model, budget: o.budget });

  for (;;) {
    if (turns >= o.budget.maxTurns) return finish("max_turns");
    if (toolCalls >= o.budget.maxToolCalls) return finish("max_tool_calls");
    if (usage.inputTokens >= o.budget.maxInputTokens) return finish("token_budget");
    if (Date.now() - started >= o.budget.timeoutMs) return finish("timeout");

    // Land gracefully: warn once before the turn budget runs out.
    const turnsLeft = o.budget.maxTurns - turns;
    if (!warned && turnsLeft <= warnAt) {
      warned = true;
      messages.push({
        role: "user",
        content: `Budget almost exhausted (${turnsLeft} turn(s) left). Call the terminal tool now with the evidence you have; list anything you could not verify as outstanding.`,
      });
      o.trace.emit({ type: "budget_warning", label: o.label, turnsLeft });
    }
    elideIfLarge(messages, o.budget.elideAboveChars ?? 60_000, o.trace, o.label);

    let reply;
    try {
      reply = await o.llm.chat({ system: o.system, messages, tools: specs });
    } catch (e) {
      if (e instanceof LlmQuotaExhaustedError) return finish("quota_exhausted", { error: e.message });
      return finish("llm_error", { error: (e as Error).message });
    }
    turns++;
    usage.inputTokens += reply.usage.inputTokens;
    usage.outputTokens += reply.usage.outputTokens;
    usage.cachedTokens = (usage.cachedTokens ?? 0) + (reply.usage.cachedTokens ?? 0);
    llmLatencyMs += reply.latencyMs;
    waitedMs += reply.waitedMs;
    o.trace.emit({
      type: "llm_call",
      label: o.label,
      turn: turns,
      model: reply.model,
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
      cachedTokens: reply.usage.cachedTokens,
      latencyMs: reply.latencyMs,
      waitedMs: reply.waitedMs,
      retries: reply.retries,
      finishReason: reply.finishReason,
      text: reply.text?.slice(0, 500),
      toolCalls: reply.toolCalls.map((t) => t.name),
    });
    messages.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });

    if (reply.toolCalls.length === 0) {
      if (nudged) return finish("no_tool_call", { error: "Model stopped calling tools without a terminal result." });
      nudged = true;
      messages.push({ role: "user", content: NUDGE });
      continue;
    }

    // Tool calls run sequentially, in the order requested (deterministic trace).
    for (const call of reply.toolCalls) {
      if (toolCalls >= o.budget.maxToolCalls) {
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: "ERROR: tool-call budget exhausted; not executed." });
        continue;
      }
      toolCalls++;
      const result = await runOneTool(o, call);
      if (result.isError) toolErrors++;
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: result.content });
      if (result.terminal !== undefined) {
        // Answer any remaining calls so the transcript stays well-formed, then stop.
        for (const rest of reply.toolCalls.slice(reply.toolCalls.indexOf(call) + 1))
          messages.push({ role: "tool", toolCallId: rest.id, name: rest.name, content: "Not executed: investigation already finished." });
        return finish("terminal", { terminal: result.terminal as T });
      }
    }
  }
}

async function runOneTool(o: RunAgentOptions, call: ToolCall): Promise<ToolResult> {
  const t0 = Date.now();
  let result: ToolResult;
  const invalid = (call.args as { __invalid_json?: string })?.__invalid_json;
  if (invalid !== undefined) {
    result = { content: `ERROR: arguments for ${call.name} were not valid JSON: ${invalid.slice(0, 200)}`, isError: true };
  } else {
    try {
      result = await executeTool(o.tools, call.name, call.args, o.ctx);
    } catch (e) {
      // A bug in a tool must not crash the run: report it to the model and the trace.
      result = { content: `ERROR: tool ${call.name} failed unexpectedly: ${(e as Error).message}`, isError: true };
    }
  }
  o.trace.emit({
    type: "tool_call",
    label: o.label,
    tool: call.name,
    args: call.args,
    ok: !result.isError,
    terminal: result.terminal !== undefined,
    resultChars: result.content.length,
    ms: Date.now() - t0,
    preview: result.content.slice(0, 300),
  });
  return result;
}

/** Context safety valve: replace the oldest large tool results once the conversation gets big. */
function elideIfLarge(messages: Msg[], limit: number, trace: TraceSink, label: string): void {
  const size = () => messages.reduce((n, m) => n + JSON.stringify(m).length, 0);
  if (size() <= limit) return;
  let elided = 0;
  for (let i = 0; i < messages.length - 4 && size() > limit; i++) {
    const m = messages[i]!;
    if (m.role === "tool" && m.content.length > 1500 && !m.content.startsWith("[earlier result elided")) {
      m.content = `[earlier result elided to save context: ${m.name} output, already examined; its evidence remains citable]`;
      elided++;
    }
  }
  if (elided) trace.emit({ type: "context_elided", label, results: elided, chars: size() });
}
