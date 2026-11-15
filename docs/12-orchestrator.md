# Module 12 — Orchestrator

**Status:** built · tested

**Code:** `packages/core/src/agent/orchestrator.ts`, `agent/overall.ts`, `report/run-store.ts`, `apps/cli/src/index.ts` · **Tests:** `packages/core/test/orchestrator.test.ts`

## 1. Command

```bash
npm run assess                                  # release/label/project from .env defaults
npm run assess -- --release R2.4 --project KAN --label tyn-release-assessment-v2
npm run assess -- --resume runs/<runId>         # reuse decided requirements after a quota stop
npm run assess -- --concurrency 3               # paid tiers; default 1 for free tiers
npm run assess -- --only REQ-05,REQ-08          # quick demo: discovery runs, then only these are investigated
```

## 2. Phases

```
Preflight     Jira auth + project; load scope (abort if empty: "run the importer first")
Discovery     agent → submit_plan (validated)                    failure → ABORTED, no decisions
Manifest      code parses Target + rules from Jira               missing / wrong release → ABORTED
Investigate   one fresh agent + ledger per requirement (p-limit concurrency)
                terminal            → decided (evidence enriched from the ledger)
                any other stop      → INSUFFICIENT_EVIDENCE, status agent_failed, reason stated
                daily quota         → stop new work; remaining → not_assessed
                unexpected exception→ contained to that requirement
              each result persisted immediately (requirements/<REQ>.json + transcripts/<REQ>.json)
Aggregate     overall decision in code (computeOverall)
```

## 3. Overall decision (pure function)

Any **mandatory** FAIL → `BLOCKED`; otherwise any `INSUFFICIENT_EVIDENCE` → `NEEDS_REVIEW`; otherwise `READY`. `Mandatory` comes from each requirement's text; if not stated, the requirement is treated as mandatory and a run issue is recorded (conservative).

## 4. Partial runs (`--only`)

For quick demos. Discovery still runs (the agent finds the manifest itself); then only the selected requirements are investigated. Unknown IDs abort with the list of valid ones. The result carries `partial: { selected, total }`; the report and terminal label the overall decision **"partial: not a release decision"**, and `evaluate` scores only the selected requirements.

## 5. Resume

`--resume runs/<id>` loads `requirements/*.json`; results with status `decided` (or previously `resumed`) are reused, everything else is re-investigated. This turns a free-tier daily quota stop into a pause rather than a failure.

## 5. Failure handling summary

| Failure                                        | Result                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| Jira preflight fails                           | ABORTED with the Jira error (e.g. the list of accessible project keys) |
| Nothing in scope                               | ABORTED: "Run the importer first"                                      |
| Discovery fails                                | ABORTED; never a confident wrong report                                |
| Manifest target missing or for another release | ABORTED                                                                |
| Investigator budget/LLM failure                | That requirement → INSUFFICIENT_EVIDENCE with reason; others continue  |
| Daily quota                                    | Remaining requirements → NOT ASSESSED; resumable                       |
| Unexpected exception                           | Contained to its requirement via `Promise.allSettled`                  |

## 6. Test evidence (fake Jira + scripted model using the real tools)

12 requirements discovered; target read from the manifest; all investigated; report rendered with Jira links and metrics · discovery failure aborts · wrong release aborts · empty scope aborts · quota after 3 investigations → 3 decided, 1 agent_failed, 8 not_assessed, then resume reuses 3 and completes 9 · a crashing investigation is contained · results and transcripts persisted.
