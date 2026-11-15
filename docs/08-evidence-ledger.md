# Module 8 — Evidence Ledger

**Status:** built · tested

## 1. Purpose

Guarantee that every citation in the report refers to something the agent actually fetched from Jira during that investigation, and that quoted evidence text comes from Jira, not from the model.

**Code:** `packages/core/src/ledger.ts`, `tools/terminal.ts` · **Tests:** `packages/core/test/tools.test.ts` (record_decision + ledger)

## 2. How it works

1. Each investigation gets a fresh `EvidenceLedger`.
2. Every tool records what it showed the model: issues (key, source ID, summary, kind) and comments (id, issue, position, **recorded time, actor, role, body**, and whether it was shown only inside a collapsed run).
3. `record_decision` validates the model's decision against the ledger before accepting it.
4. The report renders evidence from the ledger's copy (recorded actor/role/time and text excerpt). The model's own words appear only in the labelled explanation.

## 3. Validation rules

| Check                 | Rule                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Requirement           | Must equal the requirement assigned to this investigation                                                      |
| Decision              | `PASS`, `FAIL` or `INSUFFICIENT_EVIDENCE`                                                                      |
| Cited issue           | Must have been returned by a tool in this investigation                                                        |
| Cited comment         | Must have been returned by `get_comments` / `check_scope` in this investigation, and belong to the cited issue |
| PASS                  | At least one cited **comment** with stance `supports_pass` (status/description alone is never evidence)        |
| FAIL                  | At least one cited comment with stance `supports_fail`                                                         |
| INSUFFICIENT_EVIDENCE | Non-empty `outstanding` list (what verification or clarification is missing)                                   |
| Explanation           | Required                                                                                                       |

The ledger also tracks which issues were **opened** (`get_issue`) and whose **comments were read** (`get_comments`), which the coverage gate uses (Module 7).

On failure the tool returns `Decision rejected:` with each problem and an **actionable** hint. When a PASS/FAIL lacks a `comment_id`, or cites an unknown one, the rejection lists the comment ids already read on that issue with actor, role and an excerpt, e.g. `Comment ids you have read on KAN-123: 11523 (#4, <actor> / QA Lead: "…")`. Added after a local model repeatedly failed to fix vague rejections and downgraded a correct decision. The hint (e.g. "comment 99999 was never returned … in this investigation"). The model can fix and resubmit within its budget.

## 4. Why

The brief says "do not invent missing results or approve requirements from unrelated evidence". The ledger makes fabricated citations **mechanically impossible** rather than relying on prompt instructions, and the PASS/FAIL rules encode "ticket status alone is not proof" in code.

**Rejected alternatives**

- _Trust the model's citations_: hallucinated IDs are a well-known failure mode.
- _Validate after the run_: too late to correct; validating inside the loop lets the model self-correct.
- _Global ledger across investigations_: would let one investigation cite evidence it never examined itself.

## 5. Test evidence

- Unfetched comment id → rejected ("never fetched").
- PASS citing only the requirement's status → rejected.
- INSUFFICIENT_EVIDENCE without `outstanding` → rejected.
- Deciding a different requirement than assigned → rejected.
- Properly evidenced PASS citing a superseding QA retest → accepted and returned as the terminal result.

## 6. Likely questions

**Q: How do you know the report's evidence is real?** Every cited comment was returned by a Jira tool call in that investigation, and the quoted text in the report comes from the ledger (Jira data), not from model output.

**Q: Can the model still be wrong?** Yes. It can misjudge real evidence. The ledger prevents fabricated evidence; judgement quality is addressed by prompts (Module 11), the deterministic scope tool (Module 7) and evaluation against the expected outcomes (Module 15).
