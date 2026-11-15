import { describe, expect, it } from "vitest";
import { ExpectedSchema, evaluateRun } from "../src/eval/evaluate";
import type { AssessmentResult, RequirementResult } from "../src/models/assessment";

// Synthetic fixture: the real expected-outcome file is kept out of the repository.
const expected = ExpectedSchema.parse({
  release: "R0.0",
  overall: "BLOCKED",
  requirements: {
    "REQ-A": { decision: "PASS" },
    "REQ-B": { decision: "FAIL" },
    "REQ-C": { decision: "INSUFFICIENT_EVIDENCE" },
    "REQ-D": { decision: "PASS" },
  },
});

const req = (id: string, decision: RequirementResult["decision"]): RequirementResult => ({
  key: id,
  sourceId: id,
  summary: "",
  status: "decided",
  decision,
  explanation: "",
  evidence: [],
  outstanding: [],
  anomalies: [],
});

describe("evaluation", () => {
  it("scores matches, overall and wrong-direction errors", () => {
    const run = {
      runId: "r",
      model: "m",
      promptVersion: "v",
      status: "COMPLETED",
      requirements: [
        req("REQ-A", "FAIL"),
        req("REQ-B", "INSUFFICIENT_EVIDENCE"),
        req("REQ-C", "PASS"),
        req("REQ-D", "PASS"),
      ],
      overall: { decision: "BLOCKED" },
    } as unknown as AssessmentResult;
    const e = evaluateRun(run, expected);
    expect(e.correct).toBe(1);
    expect(e.overall.match).toBe(true);
    // FAIL → INSUFFICIENT is over-caution, not critical; PASS↔FAIL and INSUFFICIENT → PASS are critical.
    expect(e.criticalErrors).toEqual([
      "REQ-A: expected PASS, got FAIL",
      "REQ-C: expected INSUFFICIENT_EVIDENCE, got PASS",
    ]);
  });

  it("scores only the selected requirements of a partial run", () => {
    const run = {
      runId: "r",
      model: "m",
      promptVersion: "v",
      status: "COMPLETED",
      partial: { selected: ["REQ-D"], total: 4 },
      requirements: [req("REQ-D", "PASS")],
      overall: { decision: "READY" },
    } as unknown as AssessmentResult;
    const e = evaluateRun(run, expected);
    expect(e.total).toBe(1);
    expect(e.correct).toBe(1);
    expect(e.overall.expected).toMatch(/partial/);
  });
});
