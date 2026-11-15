/**
 * OpenAI-compatible Chat Completions adapter. One implementation covers
 * Gemini (OpenAI endpoint), Groq, Ollama, OpenRouter, OpenAI and Azure OpenAI
 * (v1 endpoint): only baseURL / apiKey / model change.
 *
 * Retries are ours, not the SDK's (maxRetries: 0): every wait is traced, and we
 * can tell a per-minute limit (wait and retry) from a daily quota (stop).
 */
import OpenAI, { APIConnectionError, APIError } from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { noopTrace, type TraceSink } from "../trace";
import {
  LlmAuthError,
  LlmBadRequestError,
  LlmError,
  LlmQuotaExhaustedError,
  LlmUnavailableError,
} from "./errors";
import { RateLimiter } from "./rate-limiter";
import type { ChatRequest, ChatResponse, LlmClient, Msg, ToolCall } from "./types";

export interface OpenAICompatibleOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  provider?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Optional reasoning effort for thinking models ("low" | "medium" | "high"). */
  reasoningEffort?: string;
  rpm?: number;
  maxRetries?: number;
  timeoutMs?: number;
  trace?: TraceSink;
  sleep?: (ms: number) => Promise<void>;
  /** For tests: a fetch implementation. */
  fetch?: typeof fetch;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Extracts a suggested retry delay (ms) from headers or provider error bodies ("retryDelay": "37s", "retry in 37.1s"). */
export function suggestedDelayMs(err: APIError): number | undefined {
  const header = err.headers?.get?.("retry-after");
  if (header && Number.isFinite(Number(header))) return Number(header) * 1000;
  const text = `${err.message} ${JSON.stringify(err.error ?? "")}`;
  const m = /retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)s"/i.exec(text) ?? /retry in (\d+(?:\.\d+)?)\s*s/i.exec(text);
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

/** True when a 429 is a long-window quota (per day) rather than a per-minute limit. */
export function isDailyQuota(err: APIError): boolean {
  const text = `${err.message} ${JSON.stringify(err.error ?? "")}`;
  return /per\s*day|perday|daily|requests_per_day|RPD/i.test(text);
}

export class OpenAICompatibleClient implements LlmClient {
  readonly model: string;
  readonly provider: string;
  private readonly client: OpenAI;
  private readonly limiter: RateLimiter;
  private readonly trace: TraceSink;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.model = opts.model;
    this.provider = opts.provider ?? new URL(opts.baseURL).hostname;
    this.client = new OpenAI({
      baseURL: opts.baseURL,
      apiKey: opts.apiKey,
      maxRetries: 0,
      timeout: opts.timeoutMs ?? 120_000,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    this.sleep = opts.sleep ?? defaultSleep;
    this.limiter = new RateLimiter(opts.rpm ?? 0, Date.now, this.sleep);
    this.trace = opts.trace ?? noopTrace;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const maxRetries = this.opts.maxRetries ?? 4;
    let waitedMs = 0;
    for (let attempt = 0; ; attempt++) {
      waitedMs += await this.limiter.acquire();
      const started = Date.now();
      try {
        const res = await this.client.chat.completions.create({
          model: this.model,
          messages: toWire(req.system, req.messages),
          tools: req.tools.map(
            (t): ChatCompletionTool => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            }),
          ),
          tool_choice: "auto",
          temperature: this.opts.temperature ?? 0,
          max_tokens: this.opts.maxOutputTokens ?? 8192,
          ...(this.opts.reasoningEffort ? { reasoning_effort: this.opts.reasoningEffort as "low" } : {}),
        });
        const choice = res.choices[0];
        const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? [])
          .filter((tc) => tc.type === "function")
          .map((tc, i) => ({
            id: tc.id || `call_${Date.now()}_${i}`,
            name: tc.function.name,
            args: parseArgs(tc.function.arguments),
            raw: tc,
          }));
        return {
          text: choice?.message.content ?? undefined,
          toolCalls,
          usage: {
            inputTokens: res.usage?.prompt_tokens ?? 0,
            outputTokens: res.usage?.completion_tokens ?? 0,
            cachedTokens: res.usage?.prompt_tokens_details?.cached_tokens ?? undefined,
          },
          latencyMs: Date.now() - started,
          finishReason: choice?.finish_reason ?? undefined,
          model: res.model || this.model,
          waitedMs,
          retries: attempt,
        };
      } catch (e) {
        const decision = this.classify(e);
        if (decision.kind === "fail" || attempt >= maxRetries) {
          this.trace.emit({ type: "llm_error", error: decision.error.name, message: decision.error.message, attempt });
          throw decision.error;
        }
        const delay = decision.delayMs ?? Math.min(60_000, 2000 * 2 ** attempt);
        this.trace.emit({ type: "llm_retry", reason: decision.reason, attempt: attempt + 1, delayMs: delay });
        waitedMs += delay;
        await this.sleep(delay);
      }
    }
  }

  private classify(
    e: unknown,
  ): { kind: "retry"; reason: string; delayMs?: number; error: LlmError } | { kind: "fail"; error: LlmError } {
    if (e instanceof APIConnectionError) {
      return { kind: "retry", reason: "connection", error: new LlmUnavailableError(`LLM connection failed: ${e.message}`) };
    }
    if (e instanceof APIError) {
      const s = e.status;
      const msg = `${this.provider} ${this.model}: ${e.message}`;
      if (s === 401 || s === 403) return { kind: "fail", error: new LlmAuthError(`LLM rejected the API key or model access [${s}]. Check LLM_API_KEY / LLM_MODEL. ${msg}`, s) };
      if (s === 429) {
        if (isDailyQuota(e)) return { kind: "fail", error: new LlmQuotaExhaustedError(`Daily LLM quota exhausted: ${msg}`, s) };
        return { kind: "retry", reason: "rate_limited", delayMs: suggestedDelayMs(e), error: new LlmUnavailableError(`Rate limited after retries: ${msg}`, s) };
      }
      if (s !== undefined && s >= 500) return { kind: "retry", reason: `server_${s}`, error: new LlmUnavailableError(`LLM server error after retries: ${msg}`, s) };
      return { kind: "fail", error: new LlmBadRequestError(`LLM rejected the request [${s}]: ${msg}`, s) };
    }
    return { kind: "fail", error: new LlmError(`Unexpected LLM failure: ${(e as Error)?.message ?? String(e)}`) };
  }
}

function parseArgs(raw: string | undefined): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __invalid_json: raw };
  }
}

function toWire(system: string, messages: Msg[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "tool") out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    else
      out.push({
        role: "assistant",
        content: m.content ?? null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map(
                (tc) =>
                  (tc.raw as never) ?? {
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                  },
              ),
            }
          : {}),
      });
  }
  return out;
}
