# ADR-005 — Provider-agnostic LLM on free tiers

**Status:** accepted · **Module:** 2

## Context

The solution must be reproducible at zero cost. Free tiers (Gemini, Groq) impose requests-per-minute, tokens-per-minute and requests-per-day limits.

## Decision

- One `LlmClient` interface. The primary adapter speaks OpenAI-compatible Chat Completions with a configurable `baseURL`.
- Default: Gemini API free tier. Backup: Groq. Offline fallback: Ollama. Optional: Anthropic adapter.
- Treat quotas as a first-class design constraint: client-side rate limiting, Retry-After-aware backoff, concurrency 1 by default, resumable per-requirement results.

## Alternatives

- **Paid Claude/GPT**: unavailable.
- **Groq as default**: free tokens-per-minute too tight for our prompt sizes.
- **Local only (Ollama)**: weaker rule-following on 7–8B models.

## Consequences

- ✅ Zero cost; provider switch is configuration; quota handling mirrors production needs.
- ❌ Slower runs on free tiers; free-tier data may be used by the provider (acceptable: fictional data).
