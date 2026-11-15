# Module 1 — Overall Architecture

**Status:** approved

## 1. Purpose

Decide **how the AI investigates**: the agent pattern, the split between model judgement and deterministic code, and the high-level component layout.

## 2. High-level design

```
                 ┌──────────────────────────┐
 dataset.json ──▶│  Importer (one-off, CLI) │──── Jira REST v3 ──┐
                 └──────────────────────────┘                    │
                                                                 ▼
                                                        ┌─────────────────┐
                                                        │  Jira Cloud     │
                                                        │  project + label│
                                                        │  scope          │
                                                        └────────▲────────┘
                                                                 │ REST v3 (read-only)
┌──────────────────────────── Assessment run ────────────────────┼─────────────────┐
│                                                                │                 │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐    │                 │
│  │ Orchestrator │──▶│ Agent loop   │──▶│  Tool layer      │────┘                 │
│  │ phases,      │   │ LLM ↔ tools, │   │  Jira gateway    │                      │
│  │ budgets      │   │ bounded      │   │  + checkers      │                      │
│  └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘                      │
│         │                  │                    │                                │
│         │           ┌──────▼───────┐    ┌───────▼─────────┐                      │
│         │           │ LLM adapter  │    │ Evidence ledger │ records what was     │
│         │           │              │    │                 │ fetched; validates   │
│         │           └──────────────┘    └───────┬─────────┘ citations            │
│         ▼                                       ▼                                │
│  ┌───────────────────────────────────────────────────────┐                       │
│  │ Report builder → report.md / report.json              │                       │
│  │ Tracer → trace.jsonl     Metrics → metrics.json       │                       │
│  └───────────────────────────────────────────────────────┘                       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Run phases

1. **Discovery**: an agent searches Jira (always inside the label scope), finds the manifest for the target release, reads its rules and calls `submitPlan(manifestKey, requirementKeys[])`. Code then verifies every key exists, is in scope, and is linked from the manifest.
2. **Investigation**: one fresh, bounded agent per requirement. It receives the target, the manifest rules text (fetched from Jira) and the requirement key. It traverses links both ways, reads comments, runs scope checks, and ends with `recordDecision(...)`.
3. **Aggregation**: deterministic code computes the overall decision and writes the report, trace and metrics.

## 3. Options considered

### A. Fixed pipeline (no real agent)

Code walks the links, regex-parses comments and applies the rules.

- ✅ Fast, cheap, repeatable; likely accurate on this dataset.
- ❌ The brief requires that _"the model must select evidence-gathering or checking actions through tools."_
- ❌ Brittle: it breaks when wording changes.
- **Rejected as the core design.** Deterministic code is still used for _checks_ (scope matching, overall decision).

### B. Put the full dataset in the prompt

- ❌ Explicitly disallowed by the brief.
- ❌ 400 records of distractors reduce accuracy and raise cost.
- **Rejected.**

### C. RAG (vector search over tickets)

- ❌ Evidence is **relational** (requirement → link → link). Similarity search does not traverse links and would likely miss a defect reachable only through a linked record's own link.
- ❌ Decisive facts are **exact identifiers** (`b7a91f2` vs `9c3e1aa`, `p6` vs `p7`), which embeddings blur.
- ❌ Extra infrastructure (embeddings, vector store) for 400 records, and evidence would come from a copy instead of Jira.
- **Rejected.** RAG suits large unstructured corpora, not small linked records with exact IDs.

### D. Single ReAct agent for the whole release

- ✅ Simplest; fits in context at this size.
- ❌ Context grows continuously; noisy tickets and earlier requirements stay in view.
- ❌ Cross-contamination between requirements.
- ❌ One crash or budget overrun loses the whole run.
- **Workable, but weaker on context management and failure handling, both of which are graded.**

### E. Orchestrator + one agent per requirement ✅ **Chosen**

- ✅ Small, focused contexts.
- ✅ Failures contained: one requirement degrades to `INSUFFICIENT_EVIDENCE`, the run continues.
- ✅ Parallelisable.
- ✅ Per-requirement traces are easy to read.
- ❌ Repeated system-prompt tokens (mitigated with prompt caching) and some extra orchestration code.

### F. Extra critic/verifier agent

- ✅ Could catch mistakes.
- ❌ Roughly doubles cost and latency; adds complexity before the basics are proven.
- **Deferred** to future work.

## 4. Who decides what

| Step                                       | Owner                                     | Reason                                                                                    |
| ------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Find manifest & requirements               | **Model** via tools, **verified by code** | Brief: "let the agent identify the target requirements"; code guards against a wrong list |
| Which tickets/comments to read             | **Model**                                 | The core skill being assessed                                                             |
| Does a result match the target build?      | **Tool (code)**, invoked by the model     | Mechanical string comparison; LLMs can misread hashes                                     |
| PASS / FAIL / INSUFFICIENT per requirement | **Model**                                 | Requires judgement: superseding, contradictions, approver role, dependencies              |
| BLOCKED / NEEDS_REVIEW / READY             | **Code**                                  | A fixed rule; no reason to risk a model error                                             |

## 5. Failure modes

| Failure                                    | Handling                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Discovery returns wrong/unknown keys       | Code validation fails → run aborts with a clear error (no confident wrong report)   |
| One investigation errors or exceeds budget | That requirement → `INSUFFICIENT_EVIDENCE` with the failure stated; others continue |
| Jira unavailable / rate-limited            | Retries with backoff (Module 5); persistent failure surfaces as a tool error        |
| Model returns invalid decision             | Tool rejects it with an error message; the model can retry within budget            |

## 6. Likely questions

**Q: Why not one agent?** It works at this size, but context grows and is cross-contaminated, and one failure kills the run. Per-requirement isolation scores better on context management and failure handling, and scales to hundreds of requirements.

**Q: Isn't a code-based scope check "not AI"?** The model still decides when to check and what the result means. The tool only performs a reliable comparison. Model plans and judges; tools compute.

**Q: Why no RAG?** Linked records plus exact identifiers. RAG doesn't follow links and blurs exact IDs.

**Q: How does it scale?** Cost per requirement is independent of project size; searches are always label-scoped; parallelism is configurable.

**Q: What if discovery finds the wrong requirements?** Code checks them against Jira (in scope, linked from the manifest). On mismatch the run stops with an explicit error.

## 7. Decision records

- [ADR-001 — Orchestrator with per-requirement agents](decisions/ADR-001-per-requirement-agents.md)
- [ADR-002 — No RAG / vector search](decisions/ADR-002-no-rag.md)
- [ADR-003 — Deterministic code for rule checks and overall decision](decisions/ADR-003-deterministic-checks.md)
