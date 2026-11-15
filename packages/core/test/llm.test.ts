import { describe, expect, it } from "vitest";
import { OpenAICompatibleClient } from "../src/llm/openai-compatible";
import { LlmAuthError, LlmBadRequestError, LlmQuotaExhaustedError } from "../src/llm/errors";
import { RateLimiter } from "../src/llm/rate-limiter";
import { MemoryTrace } from "../src/trace";

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

const fakeFetch = (replies: Reply[]) => {
  const calls: any[] = [];
  const f = (async (_url: any, init: any) => {
    calls.push(JSON.parse(init.body));
    const r = replies.shift() ?? replies[replies.length - 1]!;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
  return { f, calls };
};

const okToolCall = {
  status: 200,
  body: {
    id: "x",
    object: "chat.completion",
    created: 1,
    model: "gemini-test",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "get_issue", arguments: '{"ref":"REQ-04"}' },
              extra_content: { google: { thought_signature: "sig" } },
            },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 40,
      total_tokens: 1240,
      prompt_tokens_details: { cached_tokens: 800 },
    },
  },
};

const client = (replies: Reply[], extra: Record<string, unknown> = {}) => {
  const { f, calls } = fakeFetch(replies);
  const sleeps: number[] = [];
  const trace = new MemoryTrace();
  const c = new OpenAICompatibleClient({
    baseURL: "https://llm.example/v1",
    apiKey: "k",
    model: "gemini-test",
    fetch: f,
    trace,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { c, calls, sleeps, trace };
};
const req = {
  system: "sys",
  messages: [{ role: "user" as const, content: "go" }],
  tools: [{ name: "get_issue", description: "d", parameters: { type: "object", properties: {} } }],
};

describe("OpenAI-compatible adapter", () => {
  it("parses tool calls and usage (incl. cached tokens), temperature 0", async () => {
    const { c, calls } = client([okToolCall]);
    const r = await c.chat(req);
    expect(r.toolCalls[0]).toMatchObject({ id: "c1", name: "get_issue", args: { ref: "REQ-04" } });
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 40, cachedTokens: 800 });
    expect(calls[0].temperature).toBe(0);
    expect(calls[0].messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("echoes the provider's raw tool call back verbatim (e.g. Gemini thought signatures)", async () => {
    const { c, calls } = client([okToolCall, okToolCall]);
    const r = await c.chat(req);
    await c.chat({
      ...req,
      messages: [
        ...req.messages,
        { role: "assistant", toolCalls: r.toolCalls },
        { role: "tool", toolCallId: "c1", name: "get_issue", content: "ok" },
      ],
    });
    const assistant = calls[1].messages[2];
    expect(assistant.tool_calls[0].extra_content.google.thought_signature).toBe("sig");
    expect(calls[1].messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "ok" });
  });

  it("waits the provider-suggested delay on a per-minute 429, then succeeds", async () => {
    const { c, sleeps, trace } = client([
      {
        status: 429,
        body: {
          error: {
            message: "Quota exceeded for metric: requests per minute. Please retry in 37.2s.",
            details: [{ retryDelay: "37s" }],
          },
        },
      },
      okToolCall,
    ]);
    const r = await c.chat(req);
    expect(r.retries).toBe(1);
    expect(sleeps).toEqual([37000]);
    expect(r.waitedMs).toBeGreaterThanOrEqual(37000);
    expect(trace.events.some((e) => e.type === "llm_retry")).toBe(true);
  });

  it("stops immediately on a daily quota (no pointless retries)", async () => {
    const { c, sleeps } = client([
      {
        status: 429,
        body: { error: { message: "Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier" } },
      },
    ]);
    await expect(c.chat(req)).rejects.toBeInstanceOf(LlmQuotaExhaustedError);
    expect(sleeps).toEqual([]);
  });

  it("backs off on 5xx, fails fast on 401 and 400", async () => {
    const a = client([{ status: 503, body: { error: { message: "overloaded" } } }, okToolCall]);
    await expect(a.c.chat(req)).resolves.toBeTruthy();
    expect(a.sleeps).toEqual([2000]);
    await expect(client([{ status: 401, body: { error: { message: "bad key" } } }]).c.chat(req)).rejects.toBeInstanceOf(
      LlmAuthError,
    );
    await expect(
      client([{ status: 400, body: { error: { message: "model not found" } } }]).c.chat(req),
    ).rejects.toBeInstanceOf(LlmBadRequestError);
  });

  it("marks invalid JSON arguments instead of throwing", async () => {
    const bad = structuredClone(okToolCall);
    (bad.body as any).choices[0].message.tool_calls[0].function.arguments = '{"ref": REQ-04';
    const r = await client([bad]).c.chat(req);
    expect(r.toolCalls[0]!.args).toEqual({ __invalid_json: '{"ref": REQ-04' });
  });
});

describe("RateLimiter", () => {
  it("never exceeds the configured requests per minute", async () => {
    let now = 0;
    const waits: number[] = [];
    const rl = new RateLimiter(
      3,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );
    for (let i = 0; i < 7; i++) await rl.acquire();
    expect(waits.length).toBe(2); // requests 4 and 7 had to wait for the window
    expect(now).toBeGreaterThanOrEqual(120_000);
  });
});
