# Module 9 — LLM Adapter

**Status:** built · tested

## 1. Purpose

One small interface between the agent loop and any model provider, with quota handling designed for free tiers.

**Code:** `packages/core/src/llm/` · **Tests:** `packages/core/test/llm.test.ts`

## 2. Interface

```ts
interface LlmClient {
  model: string;
  provider: string;
  chat({ system, messages, tools }): Promise<{
    text?;
    toolCalls: { id; name; args; raw? }[];
    usage: { inputTokens; outputTokens; cachedTokens? };
    latencyMs;
    waitedMs;
    retries;
    finishReason;
    model;
  }>;
}
```

The loop only knows these provider-neutral types (`Msg`, `ToolCall`, `Usage`). Adapters map them to a wire format.

## 3. `OpenAICompatibleClient`

Uses the official `openai` npm package with a custom `baseURL`. One implementation covers every OpenAI-compatible endpoint:

| Provider                  | `LLM_BASE_URL`                                             |
| ------------------------- | ---------------------------------------------------------- |
| Google Gemini (free tier) | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| Groq (free tier)          | `https://api.groq.com/openai/v1`                           |
| Ollama (local)            | `http://127.0.0.1:11434/v1`                                |
| OpenRouter                | `https://openrouter.ai/api/v1`                             |
| OpenAI                    | `https://api.openai.com/v1`                                |
| Azure OpenAI (v1 API)     | `https://<resource>.openai.azure.com/openai/v1/`           |

Details:

- `temperature: 0` by default (as repeatable as providers allow; not bit-identical).
- `max_tokens` default 8192 (thinking models count reasoning tokens against it); optional `reasoning_effort`.
- **Raw tool calls are echoed back verbatim** on the next turn. Some providers attach data the next request must carry (e.g. Gemini's thought signatures in `extra_content`). Tested.
- Missing tool-call ids are synthesised; invalid JSON arguments become `{ __invalid_json }` and are returned to the model as a tool error rather than crashing.
- Token usage, including provider-reported cached tokens, is returned on every call for metrics.

**Rejected:** a provider SDK per vendor (more code, no benefit); the Anthropic adapter is deferred as optional because it isn't needed for a free run.

## 4. Quota and failure handling

SDK retries are disabled (`maxRetries: 0`). Our own policy is traced and distinguishes short from long quota windows:

| Situation                                 | Handling                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Our own pacing                            | `RateLimiter`: sliding 60 s window at `LLM_RPM`, shared by all concurrent investigations                                          |
| 429, per-minute limit                     | Wait the provider-suggested delay (`Retry-After`, `retryDelay: "37s"`, "retry in 37.2s"), else exponential backoff; max 4 retries |
| 429, **daily** quota                      | `LlmQuotaExhaustedError` immediately (no pointless retries); orchestrator stops starting new work and keeps finished results      |
| 5xx / connection errors                   | Exponential backoff (2 s, 4 s, …, capped at 60 s); max 4 retries                                                                  |
| 401 / 403                                 | `LlmAuthError` immediately: "Check LLM_API_KEY / LLM_MODEL"                                                                       |
| Other 4xx (bad model name, bad parameter) | `LlmBadRequestError` immediately                                                                                                  |

Every retry emits an `llm_retry` trace event with its reason and delay; `waitedMs` is reported per call so execution-time metrics separate model latency from quota waiting.

**Why not the SDK's built-in retries?** They are invisible to the trace, and they can't distinguish a per-minute limit (wait 30 s) from a daily quota (stop and resume later).

## 5. `ScriptedLlm`

A deterministic test double: each step inspects the conversation and returns text and/or tool calls, or throws. Used to test the loop, budgets and failure handling without a real model.

## 6. Configuration

```
LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
LLM_RPM                 # stay under the free per-minute limit
LLM_TEMPERATURE=0
LLM_MAX_OUTPUT_TOKENS=8192
LLM_REASONING_EFFORT    # optional
```

## 7. Test evidence

Tool-call and usage parsing (incl. cached tokens); raw tool-call echo (Gemini thought signature preserved); per-minute 429 waits 37 s then succeeds; daily quota stops without retrying; 503 backs off then succeeds; 401 and 400 fail fast with typed errors; invalid JSON arguments marked; rate limiter never exceeds RPM.

## 8. Likely questions

**Q: How do you switch to Azure OpenAI?** Set `LLM_BASE_URL` to the resource's v1 endpoint, the key (or a token from managed identity in production) and the deployment name as `LLM_MODEL`. No code change.

**Q: What happens when the free quota runs out mid-run?** Per-minute limits are waited out. A daily quota stops new investigations, finished results are kept and reported, and a rerun resumes the rest (Module 12).
