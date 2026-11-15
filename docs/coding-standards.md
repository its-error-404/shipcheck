# Coding Standards

Enforced by `npm run check` (typecheck → lint → format check → tests).

## 1. Project structure

```
packages/core/src/
  constants/   Pure values grouped by domain: jira, llm, tools, agent, labels, trace
  models/      Shared domain types and vocabularies: dataset, decision, evidence, jira-view, agent
  utils/       Small reusable pure helpers: async (sleep), labels
  jira/        Jira HTTP layer, client, errors, ADF, JQL
  import/      Dataset loading, mapping, importer, verifier
  tools/       Agent tools, scoped Jira view, parsers, registry
  llm/         Provider-neutral types, adapters, rate limiter, scripted test double
  agent/       Agent loop (orchestrator, prompts, report added in Modules 11–14)
  testing/     Fake Jira (in-memory + HTTP) for tests and offline demos
apps/cli/      Thin CLI over @tyn/core: commands/ (one module per command), ui.ts (styling), progress.ts (live progress from trace events)
```

**Rule of placement:** a type, constant or helper used by more than one module lives in `models/`, `constants/` or `utils/`. One used by a single module stays next to its code (e.g. the description markers in `import/mapping.ts`).

## 2. Single source of truth (DRY)

| Concept                                                    | Defined once in                           | Used by                                                         |
| ---------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| Label prefixes (`src-`, `kind-`, `rel-`), `rr-requirement` | `constants/labels.ts` + `utils/labels.ts` | mapping, importer, verifier, scoped view, search tool           |
| Decisions, overall decisions, evidence stances             | `models/decision.ts`                      | ledger, `record_decision` zod schema, report                    |
| Record kinds                                               | `models/dataset.ts` (`RECORD_KINDS`)      | dataset schema, `search_issues` zod schema                      |
| Target fields                                              | `models/dataset.ts` (`TARGET_FIELDS`)     | scope checker                                                   |
| Stop reasons, budgets                                      | `models/agent.ts`, `constants/agent.ts`   | agent loop, orchestrator                                        |
| Jira endpoints, limits, retry statuses                     | `constants/jira.ts`                       | HTTP layer, client, importer, mapping                           |
| LLM defaults                                               | `constants/llm.ts`                        | adapter, rate limiter                                           |
| Tool limits                                                | `constants/tools.ts`                      | tools, loop                                                     |
| Trace event names                                          | `constants/trace.ts` (`TRACE_EVENTS`)     | every emitter, CLI                                              |
| Retry/backoff `sleep`                                      | `utils/async.ts`                          | Jira HTTP, LLM adapter, rate limiter (all injectable for tests) |

Zod schemas generate both the runtime validation and the TypeScript type (`z.infer`), so a model is never declared twice.

## 3. `as const` instead of `enum`

```ts
export const DECISIONS = ["PASS", "FAIL", "INSUFFICIENT_EVIDENCE"] as const;
export type Decision = (typeof DECISIONS)[number];
z.enum(DECISIONS); // same list drives validation
```

- Literal union types with no runtime enum object, and no numeric-enum pitfalls.
- Works directly with zod and JSON Schema (tool definitions).
- `enum` declarations are banned by lint (`no-restricted-syntax`).

## 4. Functions and classes

- **Arrow functions** for all standalone functions and helpers (`func-style: expression`, `prefer-arrow-callback`).
- **Classes only for stateful services with injected dependencies**: `JiraReader`/`JiraWriter` (axios instance), `Importer`, `ScopedJiraView` (scope + caches), `EvidenceLedger`, `RateLimiter`, `OpenAICompatibleClient`, `FakeJira`.
- **Pure functions** wherever possible (mapping, parsing, scope checks, overall decision) for easy unit testing.

## 5. Types and safety

- `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`.
- `import type` for type-only imports (lint-enforced).
- Untrusted input (dataset, `.env`, LLM tool arguments) is always validated with zod before use.
- Typed error classes (`JiraAuthError`, `LlmQuotaExhaustedError`, …). Callers branch on classes, never on raw status codes or message text.

## 6. Dependency injection for testability

Clocks, `sleep`, `fetch`, axios adapters and the LLM client are injectable. Tests never wait for real time and never touch the network: retries, quotas and budgets are all tested deterministically.

## 7. Errors and failure handling

- Fail fast on configuration and preflight problems, with actionable messages.
- Inside the agent, model mistakes and tool failures become **tool results** the model can recover from, never crashes.
- Nothing silently truncates source data; nothing silently converts a failure into a decision.

## 8. Formatting and linting

- Prettier (120 columns, double quotes, trailing commas).
- ESLint: `@eslint/js` + `typescript-eslint` recommended, plus the rules above; `eslint-config-prettier` disables style rules that conflict with Prettier.
- Tests may use `any` / non-null assertions for fixtures (relaxed only under `test/` and `testing/`).

## 9. Toolchain versions

- **Node.js 22 LTS** (`engines: >=22`).
- **TypeScript 5.9**, pinned. TypeScript 7 (the native compiler) was evaluated, but `typescript-eslint` does not yet support it; 5.9 keeps the lint toolchain working.
- All dependencies pinned to exact versions with a committed `package-lock.json`.

## 10. Terminal output

- One styling module (`apps/cli/src/ui.ts`) built on Node's `util.styleText`: no dependency.
- Colour only carries meaning: green PASS/success, red FAIL/error, amber INSUFFICIENT/warnings, grey/dim detail. Disabled for `NO_COLOR`, `--no-color` and non-terminal output.
- Every command: a banner (what and where), numbered steps, a summary, and a "Next:" hint. Errors print a "How to fix" hint.
- Live progress is rendered from trace events (`progress.ts`): the agent never prints, so presentation and logic stay separate.

## 11. Commits

Small, focused commits with conventional prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
