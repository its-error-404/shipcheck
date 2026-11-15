import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCriterion, parseMandatory, parseTarget } from "../src/agent/manifest";
import { assess } from "../src/agent/orchestrator";
import { computeOverall } from "../src/agent/overall";
import { loadDataset } from "../src/import/dataset";
import { Importer } from "../src/import/importer";
import type { JiraReader } from "../src/jira/client";
import { LlmQuotaExhaustedError } from "../src/llm/errors";
import { ScriptedLlm } from "../src/llm/scripted";
import type { ChatRequest } from "../src/llm/types";
import type { RequirementResult } from "../src/models/assessment";
import { renderReport } from "../src/report/markdown";
import { buildMetrics } from "../src/report/metrics";
import { RunStore } from "../src/report/run-store";
import { MemoryTrace } from "../src/trace";
import { DATASET_PATH, fakeClient } from "./helpers";

let reader: JiraReader;
beforeAll(async () => {
  const ds = await loadDataset(DATASET_PATH);
  const { jira } = fakeClient();
  await new Importer(jira, ds, { projectKey: "TYN", concurrency: 8 }).run();
  reader = jira;
});

const lastTool = (req: ChatRequest) =>
  [...req.messages].reverse().find((m) => m.role === "tool") as { content: string } | undefined;
const outgoing = (text: string) => [...text.matchAll(/OUTGOING (\S+)/g)].map((m) => m[1]!);
const isDiscovery = (req: ChatRequest) => req.system.includes("discovery step");

/**
 * A generic scripted "model": it only uses the real tools and what they return.
 * Discovery: find manifest → open it → submit its outgoing links.
 * Investigation: open requirement → read comments of its first outgoing record → record INSUFFICIENT.
 */
const policy = (failOn?: (req: ChatRequest) => Error | undefined) =>
  new ScriptedLlm(
    [
      (req) => {
        const err = failOn?.(req);
        if (err) throw err;
        const n = req.messages.length;
        const last = lastTool(req)?.content ?? "";
        if (isDiscovery(req)) {
          if (n === 1) return { toolCalls: [{ name: "search_issues", args: { kind: "manifest" } }] };
          if (last.includes("issue(s)"))
            return { toolCalls: [{ name: "get_issue", args: { ref: /^(\S+) ·/m.exec(last.split("\n")[1]!)![1] } }] };
          const key = /^(\S+) · source/m.exec(last)![1]!;
          return {
            toolCalls: [{ name: "submit_plan", args: { manifest_key: key, requirement_keys: outgoing(last) } }],
          };
        }
        const reqKey = /Investigate requirement (\S+)/.exec((req.messages[0] as { content: string }).content)![1]!;
        if (n === 1) return { toolCalls: [{ name: "get_issue", args: { ref: reqKey } }] };
        // Like a diligent model: open + read every OUTGOING record seen so far (incl. dependencies), batched.
        const tools = req.messages.filter((m) => m.role === "tool") as { content: string }[];
        const opened = new Set(tools.map((t) => /^(\S+) · source/m.exec(t.content)?.[1]).filter(Boolean));
        const read = new Set(tools.map((t) => /^(\S+) \(\S+\) · \d+ comment/m.exec(t.content)?.[1]).filter(Boolean));
        const wanted = new Set([reqKey, ...tools.flatMap((t) => outgoing(t.content))]);
        const calls = [...wanted].flatMap((k) => [
          ...(opened.has(k) ? [] : [{ name: "get_issue", args: { ref: k } }]),
          ...(read.has(k) ? [] : [{ name: "get_comments", args: { ref: k } }]),
        ]);
        if (calls.length) return { toolCalls: calls };
        return {
          toolCalls: [
            {
              name: "record_decision",
              args: {
                requirement_key: reqKey,
                decision: "INSUFFICIENT_EVIDENCE",
                explanation: "Scripted policy: evidence was read but this test model does not judge it.",
                evidence: [],
                outstanding: ["Human review"],
                anomalies: [],
              },
            },
          ],
        };
      },
    ],
    true,
  );

const run = (llm: ScriptedLlm, extra: Partial<Parameters<typeof assess>[0]> = {}) => {
  const trace = new MemoryTrace();
  return assess({
    jira: reader,
    llm,
    trace,
    runId: "test",
    projectKey: "TYN",
    scopeLabel: "tyn-release-assessment-v2",
    release: "R2.4",
    ...extra,
  }).then((result) => ({ result, trace }));
};

describe("manifest parsing", () => {
  it("reads target, mandatory and criterion lines", () => {
    expect(
      parseTarget(
        'x\nTarget: {"release": "R2.4", "commit": "b7a91f2", "prompt": "p7", "environment": "production", "service": "atlas-assistant"}\ny',
      ),
    ).toEqual({
      release: "R2.4",
      commit: "b7a91f2",
      prompt: "p7",
      environment: "production",
      service: "atlas-assistant",
    });
    expect(parseTarget("Target: {broken")).toBeUndefined();
    expect(parseMandatory("Mandatory: yes")).toBe(true);
    expect(parseMandatory("nothing")).toBeUndefined();
    expect(parseCriterion("Acceptance criterion: p95 at most 2.0 s.")).toBe("p95 at most 2.0 s.");
  });
});

describe("overall decision (pure rule)", () => {
  const r = (decision: RequirementResult["decision"], mandatory?: boolean): RequirementResult => ({
    key: "K",
    summary: "",
    status: "decided",
    decision,
    explanation: "",
    evidence: [],
    outstanding: [],
    anomalies: [],
    mandatory,
  });
  it("applies FAIL → BLOCKED, INSUFFICIENT → NEEDS_REVIEW, all PASS → READY", () => {
    expect(computeOverall([r("PASS", true), r("FAIL", true), r("INSUFFICIENT_EVIDENCE", true)]).decision).toBe(
      "BLOCKED",
    );
    expect(computeOverall([r("PASS", true), r("INSUFFICIENT_EVIDENCE", true)]).decision).toBe("NEEDS_REVIEW");
    expect(computeOverall([r("PASS", true), r("PASS")]).decision).toBe("READY");
  });
  it("ignores a FAIL on an explicitly non-mandatory requirement, treats unknown as mandatory", () => {
    expect(computeOverall([r("PASS", true), r("FAIL", false)]).decision).toBe("READY");
    expect(computeOverall([r("FAIL", undefined)]).decision).toBe("BLOCKED");
  });
});

describe("orchestrator end-to-end (fake Jira + scripted model through real tools)", () => {
  it("discovers 12 requirements, reads target from the manifest, investigates each, writes a report", async () => {
    const { result, trace } = await run(policy());
    expect(result.status).toBe("COMPLETED");
    expect(result.manifest?.sourceId).toBe("MANIFEST");
    expect(result.target).toMatchObject({ release: "R2.4", commit: "b7a91f2", prompt: "p7" });
    expect(result.requirements).toHaveLength(12);
    expect(result.requirements.every((q) => q.status === "decided" && q.mandatory === true && q.criterion)).toBe(true);
    expect(result.overall?.decision).toBe("NEEDS_REVIEW");
    const md = renderReport(result, buildMetrics(result, trace.events), { siteUrl: "https://x.atlassian.net" });
    expect(md).toMatch(/Overall decision: 🟡 NEEDS_REVIEW/);
    expect(md).toMatch(/\[TYN-\d+\]\(https:\/\/x\.atlassian\.net\/browse\/TYN-\d+\) \(REQ-01\)/);
    expect(md).toMatch(/Execution metrics/);
  });

  it("aborts (no decisions) when discovery cannot produce a plan", async () => {
    const { result } = await run(new ScriptedLlm([{ text: "no idea" }, { text: "still no idea" }]));
    expect(result.status).toBe("ABORTED");
    expect(result.abortReason).toMatch(/Discovery did not produce a valid plan \(no_tool_call/);
    expect(result.requirements).toEqual([]);
    expect(renderReport(result)).toMatch(/Run aborted/);
  });

  it("aborts when the manifest targets a different release than requested", async () => {
    const { result } = await run(policy(), { release: "R9.9" });
    expect(result.status).toBe("ABORTED");
    expect(result.abortReason).toMatch(/targets R2.4, not the requested R9.9/);
  });

  it("aborts with a helpful message when nothing is in scope", async () => {
    const { result } = await run(policy(), { scopeLabel: "never-imported" });
    expect(result.abortReason).toMatch(/Run the importer first/);
  });

  it("on daily quota: stops new work, marks the rest NOT ASSESSED, and resumes later", async () => {
    let investigations = 0;
    const quotaAfterThree = policy((req) => {
      if (!isDiscovery(req) && req.messages.length === 1 && ++investigations > 3)
        return new LlmQuotaExhaustedError("Daily quota exhausted");
      return undefined;
    });
    const dir = await mkdtemp(join(tmpdir(), "run-"));
    const store = await RunStore.create(dir, "r1");
    const { result } = await run(quotaAfterThree, { onRequirement: store.saveRequirement });
    const statuses = result.requirements.map((q) => q.status);
    expect(statuses.filter((s) => s === "decided")).toHaveLength(3);
    expect(statuses.filter((s) => s === "agent_failed")).toHaveLength(1); // the one that hit the quota
    expect(statuses.filter((s) => s === "not_assessed")).toHaveLength(8);
    expect(result.runIssues.join("\n")).toMatch(/quota exhausted/);
    expect(result.overall?.decision).toBe("NEEDS_REVIEW");

    const resume = await RunStore.loadResume(store.dir);
    const llm2 = policy();
    const { result: resumed } = await run(llm2, { resume });
    expect(resumed.requirements.filter((q) => q.status === "resumed")).toHaveLength(3);
    expect(resumed.requirements.filter((q) => q.status === "decided")).toHaveLength(9);
  });

  it("contains a failing investigation as INSUFFICIENT_EVIDENCE with the reason", async () => {
    const flaky = policy((req) =>
      !isDiscovery(req) && /REQ-05/.test((req.messages[0] as any).content) ? new Error("model crashed") : undefined,
    );
    const { result } = await run(flaky);
    const req05 = result.requirements.find((q) => q.sourceId === "REQ-05")!;
    expect(req05.status).toBe("agent_failed");
    expect(req05.decision).toBe("INSUFFICIENT_EVIDENCE");
    expect(req05.explanation).toMatch(/llm_error.*model crashed/);
    expect(result.requirements.filter((q) => q.status === "decided")).toHaveLength(11);
  });

  it("persists requirement results and transcripts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-"));
    const store = await RunStore.create(dir, "r2");
    await run(policy(), { onRequirement: store.saveRequirement });
    const saved = JSON.parse(await readFile(join(store.dir, "requirements", "REQ-08.json"), "utf8"));
    expect(saved.sourceId).toBe("REQ-08");
    const transcript = JSON.parse(await readFile(join(store.dir, "transcripts", "REQ-08.json"), "utf8"));
    expect(transcript[0].role).toBe("user");
  });
});
