/**
 * Evaluation (docs/15-testing-evaluation.md): scores a finished run against
 * hand-derived expected outcomes. The expected file is read only here, never
 * by the agent, so it measures the agent rather than steering it.
 */
import { z } from "zod";
import { DECISIONS, OVERALL_DECISIONS } from "../models/decision";
import type { AssessmentResult } from "../models/assessment";

export const ExpectedSchema = z.object({
  release: z.string(),
  note: z.string().optional(),
  overall: z.enum(OVERALL_DECISIONS),
  requirements: z.record(z.string(), z.object({ decision: z.enum(DECISIONS), key_evidence: z.string().optional() })),
});
export type Expected = z.infer<typeof ExpectedSchema>;

export interface EvalRow {
  requirement: string;
  expected: string;
  actual: string;
  match: boolean;
  status: string;
  anomaliesFlagged: number;
  keyEvidence?: string;
}

export interface EvalResult {
  runId: string;
  model: string;
  promptVersion: string;
  overall: { expected: string; actual: string; match: boolean };
  correct: number;
  total: number;
  accuracy: number;
  /** Wrong-direction errors are worse than over-caution: PASS↔FAIL, or INSUFFICIENT → PASS. */
  criticalErrors: string[];
  rows: EvalRow[];
}

export const evaluateRun = (run: AssessmentResult, expected: Expected): EvalResult => {
  const bySource = new Map(run.requirements.map((r) => [r.sourceId ?? r.key, r]));
  const rows: EvalRow[] = Object.entries(expected.requirements).map(([id, exp]) => {
    const got = bySource.get(id);
    return {
      requirement: id,
      expected: exp.decision,
      actual: got?.decision ?? "MISSING",
      match: got?.decision === exp.decision,
      status: got?.status ?? "missing",
      anomaliesFlagged: got?.anomalies.length ?? 0,
      keyEvidence: exp.key_evidence,
    };
  });
  const criticalErrors = rows
    .filter(
      (r) =>
        (r.expected === "PASS" && r.actual === "FAIL") ||
        (r.expected === "FAIL" && r.actual === "PASS") ||
        (r.expected === "INSUFFICIENT_EVIDENCE" && r.actual === "PASS"),
    )
    .map((r) => `${r.requirement}: expected ${r.expected}, got ${r.actual}`);
  const correct = rows.filter((r) => r.match).length;
  return {
    runId: run.runId,
    model: run.model,
    promptVersion: run.promptVersion,
    overall: {
      expected: expected.overall,
      actual: run.overall?.decision ?? run.status,
      match: run.overall?.decision === expected.overall,
    },
    correct,
    total: rows.length,
    accuracy: rows.length ? correct / rows.length : 0,
    criticalErrors,
    rows,
  };
};

export const renderEval = (e: EvalResult): string =>
  [
    `# Evaluation: ${e.runId}`,
    "",
    `Model \`${e.model}\` · prompt ${e.promptVersion}`,
    "",
    `**Requirement accuracy:** ${e.correct}/${e.total} (${Math.round(e.accuracy * 100)}%) · **Overall:** expected ${e.overall.expected}, got ${e.overall.actual} ${e.overall.match ? "✅" : "❌"}`,
    "",
    e.criticalErrors.length
      ? `**Critical errors (wrong direction):**\n${e.criticalErrors.map((c) => `- ${c}`).join("\n")}`
      : "**Critical errors (wrong direction):** none",
    "",
    "| Requirement | Expected | Actual | Match | Status | Anomalies flagged | Key evidence (expected) |",
    "|---|---|---|---|---|---|---|",
    ...e.rows.map(
      (r) =>
        `| ${r.requirement} | ${r.expected} | ${r.actual} | ${r.match ? "✅" : "❌"} | ${r.status} | ${r.anomaliesFlagged} | ${r.keyEvidence ?? ""} |`,
    ),
    "",
  ].join("\n");
