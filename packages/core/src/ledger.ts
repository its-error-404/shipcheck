/**
 * Evidence ledger (docs/08-evidence-ledger.md).
 *
 * Records every issue and comment a tool returned to the model during one
 * investigation. record_decision is validated against it, so the model can
 * only cite evidence it actually fetched from Jira, and the report quotes the
 * ledger's copy of the text rather than the model's paraphrase.
 */
import { DECISIONS, type DecisionInput } from "./models/decision";
import type { LedgerComment, LedgerIssue } from "./models/evidence";

export class EvidenceLedger {
  readonly issues = new Map<string, LedgerIssue>();
  readonly comments = new Map<string, LedgerComment>();
  /** Issues opened with get_issue (not just seen in search results). */
  readonly opened = new Set<string>();
  /** Issues whose comments were read with get_comments. */
  readonly commentsRead = new Set<string>();

  markOpened(key: string): void {
    this.opened.add(key);
  }

  markCommentsRead(key: string): void {
    this.commentsRead.add(key);
  }

  /** Required issues not yet opened and read, for the coverage gate. */
  missingCoverage(required: readonly string[]): string[] {
    return this.missingSteps(required).map((m) => m.key);
  }

  /** The exact tool calls still needed per required issue, so a rejection can say precisely what to do. */
  missingSteps(required: readonly string[]): { key: string; steps: ("get_issue" | "get_comments")[] }[] {
    return required
      .map((key) => ({
        key,
        steps: [
          ...(this.opened.has(key) ? [] : (["get_issue"] as const)),
          ...(this.commentsRead.has(key) ? [] : (["get_comments"] as const)),
        ],
      }))
      .filter((m) => m.steps.length > 0);
  }

  recordIssue(issue: LedgerIssue): void {
    this.issues.set(issue.key, { ...this.issues.get(issue.key), ...issue });
  }

  recordComment(comment: LedgerComment): void {
    const prev = this.comments.get(comment.id);
    // A comment once shown in full stays "not collapsed".
    this.comments.set(comment.id, { ...comment, collapsed: comment.collapsed && (prev?.collapsed ?? true) });
  }

  /** Comment ids already shown for an issue, formatted as a hint the model can act on. */
  private commentHint(issueKey: string): string {
    const seen = [...this.comments.values()].filter((c) => c.issueKey === issueKey && !c.collapsed);
    if (!seen.length) return `You have not read any comments on ${issueKey} yet: call get_comments on it.`;
    const list = seen
      .slice(0, 12)
      .map(
        (c) =>
          `${c.id} (#${c.position ?? "?"}, ${c.actor ?? "?"} / ${c.role ?? "?"}: "${c.body.slice(0, 60).replace(/\s+/g, " ")}…")`,
      )
      .join("; ");
    return `Comment ids you have read on ${issueKey}: ${list}.`;
  }

  /** Returns a list of problems; empty means the decision is acceptable. */
  validate(input: DecisionInput, assignedKey: string): string[] {
    const problems: string[] = [];
    if (input.requirement_key !== assignedKey)
      problems.push(`requirement_key must be ${assignedKey} (you are investigating ${assignedKey}).`);
    if (!DECISIONS.includes(input.decision)) problems.push(`decision must be one of ${DECISIONS.join(", ")}.`);
    if (input.explanation.trim().length < 20)
      problems.push("explanation is required (explain the decision in a few sentences).");

    for (const [i, ev] of input.evidence.entries()) {
      const where = `evidence[${i}]`;
      if (!this.issues.has(ev.issue_key))
        problems.push(`${where}: issue ${ev.issue_key} was never fetched in this investigation. Call get_issue first.`);
      if (ev.comment_id) {
        const c = this.comments.get(ev.comment_id);
        if (!c)
          problems.push(
            `${where}: comment ${ev.comment_id} was never returned by get_comments/check_scope in this investigation.`,
          );
        else if (c.issueKey !== ev.issue_key)
          problems.push(`${where}: comment ${ev.comment_id} belongs to ${c.issueKey}, not ${ev.issue_key}.`);
      }
    }
    const commentCites = input.evidence.filter((e) => e.comment_id);
    if (input.decision === "PASS" && !commentCites.some((e) => e.stance === "supports_pass"))
      problems.push(
        `PASS requires comment_id on at least one evidence item with stance supports_pass (status or descriptions alone are not evidence). ${this.hintsFor(input, "supports_pass")}`,
      );
    if (input.decision === "FAIL" && !commentCites.some((e) => e.stance === "supports_fail"))
      problems.push(
        `FAIL requires comment_id on at least one evidence item with stance supports_fail. ${this.hintsFor(input, "supports_fail")}`,
      );
    if (input.decision === "INSUFFICIENT_EVIDENCE" && input.outstanding.length === 0)
      problems.push("INSUFFICIENT_EVIDENCE requires 'outstanding': what verification or clarification is missing.");
    return problems;
  }

  /** Hints listing readable comment ids on the issues the model cited with the given stance. */
  private hintsFor(input: DecisionInput, stance: string): string {
    const keys = [...new Set(input.evidence.filter((e) => e.stance === stance).map((e) => e.issue_key))].filter((k) =>
      this.issues.has(k),
    );
    return keys.length
      ? keys.map((k) => this.commentHint(k)).join(" ")
      : "Cite the issue and the comment_id that shows the result.";
  }
}
