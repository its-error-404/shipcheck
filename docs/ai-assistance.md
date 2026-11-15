# AI assistance

The brief allows AI coding tools. This is how they were used.

## Tools

- **Claude** (Anthropic), used as a pair programmer and design reviewer throughout.

## How the work was split

| Activity                | Approach                                                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem analysis        | Read the brief and dataset together; traced every requirement's evidence graph by hand to derive the expected outcomes ([00-problem.md](00-problem.md)) and identify the traps                                                                                                            |
| Architecture and stack  | Each module was discussed before any code: options, trade-offs, rejected alternatives, likely questions. I approved each design and the stack choices (TypeScript, no framework, axios, Fastify, free-tier LLM) before implementation                                                     |
| Implementation          | Code was generated module by module against the agreed designs, then reviewed, run and tested. Coding standards (constants/models/utils, `as const` over enums, arrow functions, DRY) were applied as a dedicated pass and are enforced by lint                                           |
| Testing                 | 83 automated tests against an in-memory Jira, a scripted model and an injected session for the server; every module tested before moving on                                                                                                                                               |
| Real runs and debugging | Runs were executed on my machine against my Jira site. Failures were diagnosed from the trace (provider overload, free-tier daily quota, Windows IPv6 `localhost`, a small model deciding without investigating) and fixed in code ([15-testing-evaluation.md](15-testing-evaluation.md)) |
| Documentation           | Written alongside each module, then updated with real results                                                                                                                                                                                                                             |

## What I verified myself

- Every design decision and its rationale (each module doc records the options considered and why).
- The import into my Jira site (`verify-import`).
- The real assessment runs, the report, and the evaluation against expected outcomes.

## Boundaries kept

- The agent never receives the dataset file or the expected outcomes; prompts contain no dataset-specific content.
- No external evidence or company systems were used.
