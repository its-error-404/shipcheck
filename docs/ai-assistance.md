# AI assistance

The brief allows AI coding tools. I used **Claude** (Anthropic) as a pair programmer and reviewer throughout.

| Activity       | How                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Design         | Each part was discussed before coding: options, trade-offs, what to reject. I chose the architecture and the stack (TypeScript, no agent framework, axios, Fastify, a free or local model) |
| Implementation | Code was generated part by part against the agreed design, then reviewed, run and tested by me. Lint enforces the coding conventions                                                       |
| Testing        | Automated tests against an in-memory Jira and a scripted model, written alongside each part                                                                                                |
| Real runs      | Run on my machine against my Jira site. Problems were diagnosed from the traces and fixed in code (see [RESULTS.md](RESULTS.md))                                                           |
| Review         | The finished submission was reviewed critically; verified defects (a server race, cross-site requests, a missing scope check) were fixed and tested                                        |

**Boundaries kept:** the agent never receives the dataset file or my expected outcomes, and the prompts contain nothing specific to this dataset.
