# Module 3 — Jira Site & Project Setup

**Status:** approved

## 1. Purpose

Provide a clean, dedicated Jira project that the importer writes into and the agent reads from, set up so that a reviewer can reproduce it in about ten minutes at zero cost.

## 2. Decisions

### 2.1 Site: free Jira Cloud

A dedicated free Jira Cloud site (`<name>.atlassian.net`). The free plan includes the full REST API v3 and requires no card.
**Rejected:** Jira Data Center (paid, heavy, not requested); an employer's Jira (the brief forbids company systems).

### 2.2 Project: company-managed, Scrum template, key `SHIP`

|               | Company-managed ✅                        | Team-managed                          |
| ------------- | ----------------------------------------- | ------------------------------------- |
| Issue types   | Shared standard types                     | Per-project                           |
| Workflow      | Standard To Do → In Progress → Done       | Simple, team-editable                 |
| API behaviour | Predictable, matches most enterprise Jira | Small field-configuration differences |

The Scrum template's workflow (To Do / In Progress / Done) matches the dataset's `recorded_status` values exactly. **Note:** the company-managed _Kanban_ template uses Backlog / Selected for Development / In Progress / Done, which would not match "To Do"; team-managed Kanban (To Do / In Progress / Done) also works. The importer **does not assume** this: it discovers issue types, fields and transitions at runtime, so team-managed projects also work.

### 2.3 Issue type: `Task` for every record, kind as a label

| Option                           | Verdict                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| Map kinds to Story/Task/Bug      | Kinds don't map cleanly; differs between project types                   |
| Custom issue types               | Admin setup per reviewer, which hurts reproducibility                    |
| **One type + `kind-*` label** ✅ | Works anywhere with no setup; exact source kind preserved and searchable |

### 2.4 Link type: built-in "Relates"

| Option                       | Verdict                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Blocks / Duplicates / Clones | Wrong semantics; could mislead the agent and human readers                                                           |
| Custom "Evidence for" type   | Admin setup, which hurts reproducibility                                                                             |
| **Relates** ✅               | Exists everywhere, neutral meaning; direction preserved via the source-links list in each description (see Module 4) |

### 2.5 Statuses

Each issue is transitioned to the status whose **name** matches `recorded_status`, discovered at runtime. If no matching status exists, the issue stays put; the recorded status is always written in the description, so nothing is lost. Keeping real statuses preserves the "Done is not proof" trap rather than sanitising it.

### 2.6 Authentication

| Option                                        | Verdict                                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Classic API token + Basic auth** ✅ default | Simplest; base URL `https://<site>.atlassian.net`                                                                                               |
| Scoped API token (optional hardening)         | Read-only (`read:jira-work`) token for the assessment step; uses `https://api.atlassian.com/ex/jira/<cloudId>`, so the base URL is configurable |
| OAuth 2.0 (3LO)                               | For apps acting on behalf of other users; unnecessary                                                                                           |

Credentials live only in `.env` (gitignored). `.env.example` lists variable names without values.

**Defence in depth:** only the importer uses write methods; the agent's tools have no write path. With a read-only scoped token, a prompt-injected model could not modify Jira even in principle.

### 2.7 Native Jira metadata vs scenario facts

Jira shows the importer's account as reporter/comment author and the import time as created date. The brief states these belong to the importer. The scenario actor, role and recorded timestamp are preserved **verbatim** in each comment's text; the comment tool parses them, and the report cites only the recorded values.

### 2.8 Scope isolation

Every agent query is built by code as `project = <KEY> AND labels = "<dataset_label>" AND (...)`. The model supplies only the inner filter and cannot remove the scope, so other tickets in the project are never visible to the agent.

## 3. Setup steps (reviewer reproducible, free)

1. **Jira site**: atlassian.com → Jira → _Get it free_; choose a site name.
2. **Project**: Scrum template, company-managed (or team-managed Kanban), key `SHIP` (any key works; it's configurable).
3. **API token**: id.atlassian.com/manage-profile/security/api-tokens → _Create API token_; copy it once.
4. **LLM key**: aistudio.google.com → _Get API key_ (free tier, no billing). Optional backup: console.groq.com.
5. Copy `.env.example` to `.env` and fill in the values. Never commit `.env`.

## 4. Failure modes

| Risk                                      | Handling                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| Wrong email/token                         | `verify` calls `GET /rest/api/3/myself` first and fails fast with a clear message |
| Wrong project key / no permission         | Checked before any write                                                          |
| Labels field not on create screen         | Detected via create metadata; importer stops with fix instructions                |
| Rate limiting during import               | axios interceptor backoff (Module 5)                                              |
| Free site deactivated after 120 days idle | Irrelevant to the assessment; noted                                               |

## 5. Likely questions

**Q: Why not proper issue types?** Reproducibility: labels need no admin setup and preserve the exact source kind.

**Q: How do you stop the agent reading unrelated tickets?** A mandatory project + label clause added in code, not by the model.

**Q: Could a malicious ticket make the agent change Jira?** No: the agent's tools are read-only, and it can run with a read-only scoped token.

**Q: Jira says you authored everything. How does the report show the real actors?** Scenario actor, role and timestamp are kept in the text, parsed by the tool and cited in the report; native author and timestamp are never presented as scenario facts.

## 6. Decision records

- [ADR-008 — Single issue type with labels, Relates links](decisions/ADR-008-issue-type-and-links.md)
- [ADR-009 — Read-only agent access to Jira](decisions/ADR-009-read-only-agent.md)
