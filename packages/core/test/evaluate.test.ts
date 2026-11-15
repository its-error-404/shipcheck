import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ExpectedSchema, evaluateRun } from "../src/eval/evaluate";
import type { AssessmentResult, RequirementResult } from "../src/models/assessment";

const expectedPath = fileURLToPath(new URL("../../../eval/expected-R2.4.json", import.meta.url));

describe("evaluation", () => {
  it("scores matches, overall and wrong-direction errors", async () => {
    const expected = ExpectedSchema.parse(JSON.parse(await readFile(expectedPath, "utf8")));
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
    const reqs = Object.entries(expected.requirements).map(([id, e]) => req(id, e.decision));
    reqs[0] = req("REQ-01", "FAIL"); // expected PASS → critical
    reqs[2] = req("REQ-03", "PASS"); // expected INSUFFICIENT → critical
    reqs[1] = req("REQ-02", "INSUFFICIENT_EVIDENCE"); // expected FAIL → over-cautious, not critical
    const run = {
      runId: "r",
      model: "m",
      promptVersion: "v1",
      status: "COMPLETED",
      requirements: reqs,
      overall: { decision: "BLOCKED" },
    } as unknown as AssessmentResult;
    const e = evaluateRun(run, expected);
    expect(e.correct).toBe(9);
    expect(e.overall.match).toBe(true);
    expect(e.criticalErrors).toEqual([
      "REQ-01: expected PASS, got FAIL",
      "REQ-03: expected INSUFFICIENT_EVIDENCE, got PASS",
    ]);
  });
});
