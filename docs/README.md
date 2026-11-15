# Documentation index

Each module follows the same template: purpose → options considered → decision → rejected alternatives → design → failure modes → likely questions → status.

| #   | Module                                           | Status                                            |
| --- | ------------------------------------------------ | ------------------------------------------------- |
| 0   | [Problem & evaluation](00-problem.md)            | approved                                          |
| 1   | [Overall architecture](01-architecture.md)       | approved                                          |
| 2   | [Stack](02-stack.md)                             | approved                                          |
| 3   | [Jira site & project setup](03-jira-setup.md)    | approved                                          |
| 4   | [Data → Jira mapping](04-data-mapping.md)        | approved                                          |
| 5   | [Jira API client](05-jira-client.md)             | built · tested                                    |
| 6   | [Importer & verification](06-importer.md)        | built · tested                                    |
| 7   | [Agent tools](07-agent-tools.md)                 | built · tested                                    |
| 8   | [Evidence ledger](08-evidence-ledger.md)         | built · tested                                    |
| 9   | [LLM adapter](09-llm-adapter.md)                 | built · tested                                    |
| 10  | [Agent loop & budgets](10-agent-loop.md)         | built · tested                                    |
| 11  | [Prompts & rules](11-prompts.md)                 | built · tested                                    |
| 12  | [Orchestrator](12-orchestrator.md)               | built · tested                                    |
| 13  | [Report & overall decision](13-report.md)        | built · tested                                    |
| 14  | [Trace & metrics](14-trace-metrics.md)           | built · tested                                    |
| 15  | [Testing & evaluation](15-testing-evaluation.md) | built · tested                                    |
| 16  | Server + Socket.io (bonus)                       | not built (time prioritised for a correct report) |
| 17  | React UI (bonus)                                 | not built (time prioritised for a correct report) |
| 18  | Docs & submission                                | planned                                           |

## Decision records

| ADR                                                 | Title                                                   | Status   |
| --------------------------------------------------- | ------------------------------------------------------- | -------- |
| [001](decisions/ADR-001-per-requirement-agents.md)  | Orchestrator with per-requirement agents                | accepted |
| [002](decisions/ADR-002-no-rag.md)                  | No RAG / vector search                                  | accepted |
| [003](decisions/ADR-003-deterministic-checks.md)    | Deterministic code for rule checks and overall decision | accepted |
| [004](decisions/ADR-004-typescript-no-framework.md) | TypeScript with no agent framework                      | accepted |
| [005](decisions/ADR-005-free-tier-llm.md)           | Provider-agnostic LLM on free tiers                     | accepted |
| [006](decisions/ADR-006-axios.md)                   | axios for Jira HTTP                                     | accepted |
| [007](decisions/ADR-007-fastify.md)                 | Fastify for the bonus server                            | accepted |
| [008](decisions/ADR-008-issue-type-and-links.md)    | Single issue type with labels; Relates links            | accepted |
| [009](decisions/ADR-009-read-only-agent.md)         | Read-only agent access to Jira                          | accepted |
| [010](decisions/ADR-010-verbatim-import.md)         | Verbatim import with separated importer metadata        | accepted |

See also: [Coding standards](coding-standards.md).

Also: [AI assistance](ai-assistance.md) (how AI tools were used).
