/**
 * Scripted LLM for tests and offline demos: each step inspects the
 * conversation so far and returns the next reply (text and/or tool calls).
 * Lets us test the loop, budgets and failure handling deterministically.
 */
import type { ChatRequest, ChatResponse, LlmClient, ToolCall } from "./types";

export type ScriptStep =
  | { text?: string; toolCalls?: Omit<ToolCall, "id">[]; inputTokens?: number }
  | ((req: ChatRequest) => { text?: string; toolCalls?: Omit<ToolCall, "id">[]; inputTokens?: number })
  | Error;

export class ScriptedLlm implements LlmClient {
  readonly model = "scripted";
  readonly provider = "test";
  readonly requests: ChatRequest[] = [];
  private i = 0;

  constructor(
    private readonly steps: ScriptStep[],
    private readonly repeatLast = false,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(structuredClone(req));
    const idx = this.i < this.steps.length ? this.i++ : this.repeatLast ? this.steps.length - 1 : -1;
    const step = this.steps[idx];
    if (step === undefined) throw new Error("ScriptedLlm: script exhausted");
    if (step instanceof Error) throw step;
    const s = typeof step === "function" ? step(req) : step;
    return {
      text: s.text,
      toolCalls: (s.toolCalls ?? []).map((tc, k) => ({ ...tc, id: `call_${this.requests.length}_${k}` })),
      usage: { inputTokens: s.inputTokens ?? 1000, outputTokens: 100 },
      latencyMs: 1,
      model: this.model,
      waitedMs: 0,
      retries: 0,
    };
  }
}
