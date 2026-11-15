# Module 2 — Technology Stack

**Status:** approved

## 1. Purpose

Choose the language, runtime, libraries and model provider, with explicit trade-offs. Guiding principles:

1. Use a mainstream, strongly typed stack (TypeScript / Node.js) that suits I/O-bound orchestration.
2. Keep every graded mechanism (tool loop, budgets, context management, failure handling) visible in our own code.
3. **Zero cost to reproduce**: everything runs on free tiers or locally.

## 2. Final stack

| Layer                  | Choice                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Language               | TypeScript 5.9, strict (7.x evaluated; not yet supported by typescript-eslint)     |
| Runtime                | Node.js 22 LTS                                                                     |
| Repo                   | npm workspaces monorepo (`packages/core`, `apps/cli`, `apps/server`, `apps/web`)   |
| Agent framework        | None: a thin tool-calling loop we own                                              |
| LLM interface          | OpenAI-compatible Chat Completions via the `openai` npm package (custom `baseURL`) |
| Default model provider | Google Gemini API, free tier (AI Studio key)                                       |
| Backup providers       | Groq (free tier), Ollama (local, offline); optional Anthropic adapter              |
| Quota handling         | Client-side rate limiter, 429 backoff honouring Retry-After, resumable runs        |
| Jira HTTP client       | axios with interceptors (retry/backoff + request tracing)                          |
| Validation             | zod (tool inputs, decisions, config); converted to JSON Schema for the LLM         |
| CLI                    | commander, run via tsx                                                             |
| Tests                  | Vitest                                                                             |
| Lint/format            | ESLint (typescript-eslint) + Prettier, enforced by `npm run check`                 |
| Bonus server           | Fastify + Socket.io (live trace streaming)                                         |
| Bonus UI               | React + Vite, plain CSS, axios (TanStack Query not needed for three endpoints)     |

## 3. Decisions and alternatives

### 3.1 Language: TypeScript

| Option            | Pros                                                                                                           | Cons                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **TypeScript** ✅ | Compile-time safety for tool schemas and decision objects; first-class LLM SDKs; one language from agent to UI | Smaller AI/data ecosystem (not needed)                                                          |
| Python            | AI default, huge ecosystem                                                                                     | Weaker compile-time guarantees for tool contracts; a second language would be needed for any UI |
| Go / Java         | Fast, typed                                                                                                    | Weaker LLM SDKs, slower development, no benefit here                                            |

The workload is I/O-bound orchestration (Jira + LLM calls), not numerical ML. Python's data libraries add nothing; TypeScript's types catch malformed tool contracts before runtime.

### 3.2 Runtime: Node.js 22 LTS

LTS support to 2027, native `fetch`/`AbortController`, and familiar to every reviewer. **Rejected:** Bun/Deno (faster startup but more reviewer setup friction and SDK compatibility risk); Node 20 (closer to end of life).

### 3.3 Agent framework: none

| Option                      | Verdict                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Own thin loop** ✅        | ~150 lines. Full control of budgets, citation validation, tracing and token accounting; the graded tool loop is directly visible                              |
| LangChain.js / LangGraph.js | Heavy abstraction hides the loop and token usage; frequent breaking changes; overkill for three phases                                                        |
| Vercel AI SDK               | Strongest alternative (clean, provider-agnostic, zod tools) but hides provider-specific usage details; we would still write budgets, ledger and orchestration |
| OpenAI Agents SDK / Mastra  | Vendor-specific or opinionated; another dependency to justify                                                                                                 |
| Claude Agent SDK            | Designed for coding agents with filesystem/shell access; too broad for a read-only investigation                                                              |

The brief grades tool use, context management, bounded execution and failure handling, exactly what a framework would hide. Writing them is the demonstration.

### 3.4 Model provider: free, provider-agnostic

Constraint: reproducible at zero cost (free tiers or local models).

| Option                              | Cost                                | Verdict                                                                                                                                                 |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gemini API free tier** ✅ default | No billing required (AI Studio key) | Reliable tool calling, large context; rate-limited. Free-tier content may be used by Google to improve products, which is acceptable for fictional data |
| **Groq free tier** (backup)         | No card required                    | Very fast, OpenAI-compatible, tool calling on open models; tight tokens-per-minute limit for our prompt sizes                                           |
| **Ollama** (offline fallback)       | Free, local                         | Runs 7–8B tool-calling models on a consumer GPU; weaker on nuanced rule application                                                                     |
| Anthropic / OpenAI / Bedrock        | Paid                                | Supported by design (adapter) but not used for the submitted run                                                                                        |

**Why an OpenAI-compatible interface:** Gemini, Groq, Ollama and OpenRouter all expose OpenAI-style Chat Completions endpoints. One adapter with a configurable `baseURL` covers every free option; switching providers is an `.env` change. An optional Anthropic adapter implements the same `LlmClient` interface to show the design isn't tied to one vendor.

**Free-tier engineering (turned into features):**

- Client-side rate limiter (requests/minute from config) keeps us under quota proactively.
- HTTP 429 → honour Retry-After / exponential backoff with jitter; counted as waiting, not failure.
- Investigation concurrency defaults to 1 on free tiers (configurable).
- Each completed requirement is persisted, so a rerun after a quota reset resumes instead of restarting.
- Comment paging and noise collapsing keep tokens per call low.

### 3.5 Jira HTTP client: axios

| Option            | Pros                                                                                                                       | Cons                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Native `fetch`    | Built in, zero dependencies                                                                                                | Doesn't throw on 4xx/5xx; manual JSON; retry/tracing must be hand-written |
| **axios** ✅      | Widely known; throws on non-2xx; `baseURL`/`auth`/`timeout` config; **interceptors** centralise retry, backoff and tracing | One extra dependency (supply-chain surface)                               |
| ky                | Small fetch wrapper with built-in Retry-After-aware retry                                                                  | Less familiar; another concept to explain                                 |
| got / undici      | Powerful Node clients                                                                                                      | Overkill / lower level                                                    |
| `jira.js` library | Typed, complete                                                                                                            | Large; hides retry/paging; we need only ~7 endpoints                      |

Interceptors give a single, well-known place for 429/5xx retry, Retry-After handling, and per-request timing for the trace. Readability and a single cross-cutting hook outweigh one dependency.

### 3.6 Validation: zod

Tool arguments from the LLM are untrusted input; zod validates them and its schemas convert to the JSON Schema that tool definitions require. **Rejected:** yup/joi (no clean JSON Schema export), io-ts (verbose).

### 3.7 Bonus server: Fastify

| Option         | Notes                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fastify** ✅ | Schema-first validation (reuses the agent's zod schemas via `fastify-type-provider-zod`), built-in structured logging (pino), TypeScript-first, plugin encapsulation, native async error handling |
| Express        | Familiar and simple, but no built-in validation or structured logging                                                                                                                             |

Raw throughput (Fastify benchmarks roughly 2–3× faster than Express) was **not** the deciding factor: each assessment is dominated by LLM latency measured in seconds. Socket.io attaches to Fastify's underlying HTTP server for live trace events.

### 3.8 Supporting tools

| Need            | Choice                               | Rejected                                   |
| --------------- | ------------------------------------ | ------------------------------------------ |
| Run TS          | tsx                                  | ts-node (slower, ESM quirks)               |
| CLI             | commander                            | yargs (heavier)                            |
| Tests           | Vitest                               | Jest (slower, more ESM/TS config)          |
| Package manager | npm workspaces + `package-lock.json` | pnpm (reviewers may not have it)           |
| UI              | React + Vite + TanStack Query        | Next.js (SSR unnecessary for a local tool) |

### 3.9 Repo shape: monorepo

`packages/core` holds all logic; the CLI and server are thin shells over it; the UI is optional and removable without touching the agent. **Rejected:** a single package (mixes server/UI/agent dependencies).

## 4. Failure modes

| Risk                                   | Mitigation                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Free-tier quota exhausted mid-run      | Rate limiter, backoff, resumable per-requirement results; unfinished requirements reported honestly |
| Provider outage                        | Switch `LLM_BASE_URL` / `LLM_MODEL` to the backup provider                                          |
| Model returns malformed tool arguments | zod rejects with a readable error fed back to the model                                             |
| Dependency drift                       | Lockfile + exact versions                                                                           |

## 5. Likely questions

**Q: Why not Python?** I/O-bound orchestration, not ML. TypeScript gives compile-time safety on tool schemas, one language end to end, and the architecture is language-agnostic.

**Q: Why no LangChain?** The graded behaviours are what frameworks hide; our loop is short and readable.

**Q: Why a free model? Won't accuracy suffer?** The design concentrates difficulty where models are good (judgement over small, focused contexts) and moves mechanical checks into code. The provider is configurable, so a stronger model is a config change.

**Q: Vendor lock-in?** One `LlmClient` interface; OpenAI-compatible endpoints cover Gemini, Groq, Ollama, OpenRouter and OpenAI; Anthropic has its own adapter.

**Q: Why axios over fetch?** Interceptors give one central place for retry, backoff and request tracing across all Jira calls.

**Q: Why Fastify?** Schema-first validation reusing the same zod schemas, built-in structured logging, and TypeScript support. Not raw speed: the workload is LLM-latency bound.

## 6. Decision records

- [ADR-004 — TypeScript with no agent framework](decisions/ADR-004-typescript-no-framework.md)
- [ADR-005 — Provider-agnostic LLM on free tiers](decisions/ADR-005-free-tier-llm.md)
- [ADR-006 — axios for Jira HTTP](decisions/ADR-006-axios.md)
- [ADR-007 — Fastify for the bonus server](decisions/ADR-007-fastify.md)
