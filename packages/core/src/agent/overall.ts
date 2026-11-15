import { DECISIONS, type Decision } from "../models/decision";
import type { OverallResult, RequirementResult } from "../models/assessment";

/**
 * Overall release decision: a fixed rule, so it is computed in code (ADR-003).
 * Any mandatory FAIL → BLOCKED; otherwise any INSUFFICIENT_EVIDENCE → NEEDS_REVIEW; otherwise READY.
 * Requirements whose mandatory flag is not stated are treated as mandatory (conservative).
 */
export const computeOverall = (results: readonly RequirementResult[]): OverallResult => {
  const counts = Object.fromEntries(DECISIONS.map((d) => [d, 0])) as Record<Decision, number>;
  for (const r of results) counts[r.decision]++;

  const isMandatory = (r: RequirementResult) => r.mandatory !== false;
  const failed = results.filter((r) => isMandatory(r) && r.decision === "FAIL").map((r) => r.sourceId ?? r.key);
  const insufficient = results.filter((r) => r.decision === "INSUFFICIENT_EVIDENCE").map((r) => r.sourceId ?? r.key);

  if (results.length === 0) return { decision: "NEEDS_REVIEW", reason: "No requirements were assessed.", counts };
  if (failed.length)
    return { decision: "BLOCKED", reason: `Mandatory requirement(s) failed: ${failed.join(", ")}.`, counts };
  if (insufficient.length)
    return {
      decision: "NEEDS_REVIEW",
      reason: `No failures, but evidence is insufficient for: ${insufficient.join(", ")}.`,
      counts,
    };
  return { decision: "READY", reason: "All requirements passed with applicable evidence.", counts };
};
