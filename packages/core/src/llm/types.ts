/**
 * Provider-neutral chat types. The agent loop only knows these; adapters map
 * them to a provider's wire format (docs/09-llm-adapter.md).
 */
import type { ToolSpec } from "../tools/registry";

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed JSON arguments, or { __invalid_json: raw } if the model emitted invalid JSON. */
  args: unknown;
  /** Provider's original tool-call object, echoed back verbatim on the next turn (e.g. Gemini thought signatures). */
  raw?: unknown;
}

export type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export interface ChatRequest {
  system: string;
  messages: Msg[];
  tools: ToolSpec[];
}

export interface ChatResponse {
  text?: string;
  toolCalls: ToolCall[];
  usage: Usage;
  latencyMs: number;
  finishReason?: string;
  model: string;
  /** Time spent waiting on rate limits / retries before the successful call. */
  waitedMs: number;
  retries: number;
}

export interface LlmClient {
  readonly model: string;
  readonly provider: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
