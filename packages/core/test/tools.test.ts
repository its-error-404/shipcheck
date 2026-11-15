import { beforeAll, describe, expect, it } from "vitest";
import { loadDataset } from "../src/import/dataset";
import type { Dataset } from "../src/models/dataset";
import { Importer } from "../src/import/importer";
import { type JiraReader } from "../src/jira/client";
import { EvidenceLedger } from "../src/ledger";
import { ScopedJiraView } from "../src/tools/jira-view";
import { executeTool, INVESTIGATION_TOOLS, DISCOVERY_TOOLS, toolSpecs } from "../src/tools/registry";
import type { ToolContext } from "../src/tools/types";
import { checkScopeText } from "../src/tools/parse";
import { noopTrace } from "../src/trace";
import { DATASET_PATH, fakeClient } from "./helpers";

let ds: Dataset;
let reader: JiraReader;
let keyOf: (sid: string) => string;

beforeAll(async () => {
  ds = await loadDataset(DATASET_PATH);
  const { fake, jira } = fakeClient();
  const report = await new Importer(jira, ds, { projectKey: "TYN", concurrency: 8 }).run();
  // An unrelated ticket outside the scope, linked to REQ-01: must stay invisible.
  const outsider = fake.seedIssue("[OUT-1] other team ticket", ["other-team"]);
  fake.links.push({ id: "1", type: "Relates", outward: outsider.key, inward: report.map["REQ-01"]! });
  reader = jira; // JiraWriter is-a JiraReader; tools only use read methods
  keyOf = (sid) => report.map[sid]!;
});

const ctx = (requirement?: string): ToolContext => {
  return {
    view: new ScopedJiraView(reader, "TYN", ds.dataset_label),
    target: ds.target,
    ledger: new EvidenceLedger(),
    trace: noopTrace,
    requirementKey: requirement ? keyOf(requirement) : undefined,
  };
};
const run = (c: ToolContext, name: string, args: unknown) => executeTool(INVESTIGATION_TOOLS, name, args, c);

describe("search_issues", () => {
  it("finds the manifest by kind, inside the scope only", async () => {
    const r = await run(ctx(), "search_issues", { kind: "manifest" });
    expect(r.content).toMatch(/MANIFEST · manifest/);
    expect(r.content).toMatch(/^1 issue/);
  });
  it("finds records by source id", async () => {
    const r = await run(ctx(), "search_issues", { source_ids: ["REQ-04", "REC-6024"] });
    expect(r.content).toMatch(/REQ-04/);
    expect(r.content).toMatch(/REC-6024/);
  });
});

describe("get_issue", () => {
  it("tags outgoing vs incoming links and hides out-of-scope links", async () => {
    const r = await run(ctx(), "get_issue", { ref: "REQ-04" });
    expect(r.content).toMatch(/OUTGOING .*REC-6024/);
    expect(r.content).toMatch(/OUTGOING .*REC-1028/);
    expect(r.content).toMatch(/INCOMING .*REC-8977/); // misleading backlink from billing-console
    expect(r.content).toMatch(/INCOMING .*MANIFEST/);
    expect(r.content).not.toMatch(/Recorded event/); // no comments in get_issue
    const r1 = await run(ctx(), "get_issue", { ref: "REQ-01" });
    expect(r1.content).not.toMatch(/OUT-1/);
    expect(r1.content).toMatch(/1 link\(s\) to issues outside the assessment scope are hidden/);
  });
  it("returns a recoverable error for unknown refs", async () => {
    const r = await run(ctx(), "get_issue", { ref: "REC-0000" });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/HINT/);
  });
});

describe("get_comments", () => {
  it("collapses the 62 noise comments on the streaming ticket but keeps the real result", async () => {
    const c = ctx();
    const r = await run(c, "get_comments", { ref: "REC-5957", limit: 30 });
    expect(r.content).toMatch(/62 near-identical comments collapsed/);
    expect(r.content).toMatch(/STREAM-731.*49 of 50/s);
    expect(r.content.length).toBeLessThan(3000);
    expect([...c.ledger.comments.values()].filter((x) => x.collapsed)).toHaveLength(62);
  });
  it("shows recorded actor/role/time and sorts by recorded time", async () => {
    const r = await run(ctx(), "get_comments", { ref: "REC-9745" });
    const i870 = r.content.indexOf("REDACT-870");
    const i901 = r.content.indexOf("REDACT-901");
    expect(i870).toBeGreaterThan(-1);
    expect(i901).toBeGreaterThan(i870);
    expect(r.content).toMatch(/Priya Nair \(QA Lead\)/);
  });
  it("filters with contains and pages", async () => {
    const r = await run(ctx(), "get_comments", { ref: "REC-9745", contains: "supersedes" });
    expect(r.content).toMatch(/1 matching/);
    const p = await run(ctx(), "get_comments", { ref: "REC-9745", limit: 2 });
    expect(p.content).toMatch(/offset=2/);
  });
});

describe("check_scope", () => {
  const commentId = async (c: ToolContext, ref: string, needle: string) => {
    await run(c, "get_comments", { ref, limit: 30 });
    return [...c.ledger.comments.values()].find((x) => x.body.includes(needle))!.id;
  };
  it("flags the staging latency run as environment mismatch", async () => {
    const c = ctx();
    const r = await run(c, "check_scope", { ref: "REC-1028", comment_id: await commentId(c, "REC-1028", "PERF-812") });
    expect(r.content).toMatch(/MISMATCH on environment/);
  });
  it("matches the production latency run fully", async () => {
    const c = ctx();
    const r = await run(c, "check_scope", { ref: "REC-6024", comment_id: await commentId(c, "REC-6024", "PERF-827") });
    expect(r.content).toMatch(/→ MATCH$/m);
  });
  it("reports prompt as not stated on the EVAL-55 completion (model must connect the p6 harness note)", async () => {
    const c = ctx();
    const r = await run(c, "check_scope", {
      ref: "REC-4323",
      comment_id: await commentId(c, "REC-4323", "EVAL-55 completed"),
    });
    expect(r.content).toMatch(/not stated: prompt/);
  });
  it("reads approval scope wording", () => {
    const s = checkScopeText(
      "Approved: release R2.4, commit b7a91f2, service atlas-assistant. Approval scope: staging.",
      ds.target,
    );
    expect(s.mismatched).toEqual(["environment"]);
    const p = checkScopeText(
      "Approved release R2.4, commit b7a91f2, service atlas-assistant for production from an engineering standpoint.",
      ds.target,
    );
    expect(p.verdict).toBe("MATCH_ON_STATED_FIELDS");
  });
  it("catches the wrong service and wrong release", () => {
    expect(
      checkScopeText("release R2.4; commit b7a91f2; service support-widget; environment production.", ds.target)
        .mismatched,
    ).toEqual(["service"]);
    expect(
      checkScopeText("release R2.3; commit 42d09ce; service atlas-assistant; environment production.", ds.target)
        .mismatched,
    ).toEqual(["release", "commit"]);
  });
});

describe("record_decision + ledger", () => {
  it("rejects citations that were never fetched", async () => {
    const c = ctx("REQ-07");
    const r = await run(c, "record_decision", {
      requirement_key: "REQ-07",
      decision: "PASS",
      explanation: "The superseding retest passed 28 of 28 on the target build.",
      evidence: [{ issue_key: keyOf("REC-9745"), comment_id: "99999", stance: "supports_pass", why: "retest" }],
    });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/never fetched/);
    expect(r.terminal).toBeUndefined();
  });
  it("rejects PASS without a supporting comment and INSUFFICIENT without outstanding", async () => {
    const c = ctx("REQ-11");
    await run(c, "get_issue", { ref: "REQ-11" });
    const pass = await run(c, "record_decision", {
      requirement_key: "REQ-11",
      decision: "PASS",
      explanation: "Requirement is marked Done in Jira so it passes.",
      evidence: [{ issue_key: keyOf("REQ-11"), stance: "supports_pass", why: "status Done" }],
    });
    expect(pass.content).toMatch(/PASS requires at least one cited comment/);
    const ins = await run(c, "record_decision", {
      requirement_key: "REQ-11",
      decision: "INSUFFICIENT_EVIDENCE",
      explanation: "Only a developer claim exists for this build.",
      evidence: [],
    });
    expect(ins.content).toMatch(/requires 'outstanding'/);
  });
  it("rejects deciding a different requirement than assigned", async () => {
    const c = ctx("REQ-07");
    const r = await run(c, "record_decision", {
      requirement_key: "REQ-05",
      decision: "INSUFFICIENT_EVIDENCE",
      explanation: "Trying to decide another requirement here.",
      evidence: [],
      outstanding: ["x"],
    });
    expect(r.content).toMatch(/must be/);
  });
  it("accepts a properly evidenced decision", async () => {
    const c = ctx("REQ-07");
    await run(c, "get_issue", { ref: "REC-9745" });
    await run(c, "get_comments", { ref: "REC-9745" });
    const id = [...c.ledger.comments.values()].find((x) => x.body.includes("REDACT-901"))!.id;
    const r = await run(c, "record_decision", {
      requirement_key: "REQ-07",
      decision: "PASS",
      explanation: "REDACT-901 explicitly supersedes REDACT-870 and passes 28 of 28 on the target build.",
      evidence: [
        { issue_key: keyOf("REC-9745"), comment_id: id, stance: "supports_pass", why: "superseding retest passes" },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(r.terminal).toMatchObject({ decision: "PASS" });
  });
});

describe("submit_plan", () => {
  it("accepts the manifest's 12 requirements and rejects incomplete or wrong plans", async () => {
    const c = ctx();
    const all = Array.from({ length: 12 }, (_, i) => `REQ-${String(i + 1).padStart(2, "0")}`);
    const ok = await executeTool(
      DISCOVERY_TOOLS,
      "submit_plan",
      { manifest_key: "MANIFEST", requirement_keys: all },
      c,
    );
    expect(ok.terminal).toBeTruthy();
    const partial = await executeTool(
      DISCOVERY_TOOLS,
      "submit_plan",
      { manifest_key: "MANIFEST", requirement_keys: all.slice(0, 10) },
      c,
    );
    expect(partial.content).toMatch(/did not include/);
    const wrong = await executeTool(
      DISCOVERY_TOOLS,
      "submit_plan",
      { manifest_key: "MANIFEST", requirement_keys: [...all, "REC-6024"] },
      c,
    );
    expect(wrong.content).toMatch(/not a requirement/);
  });
});

describe("tool specs", () => {
  it("produce provider-safe JSON schemas", () => {
    const specs = toolSpecs(INVESTIGATION_TOOLS);
    expect(specs.map((s) => s.name)).toEqual([
      "search_issues",
      "get_issue",
      "get_comments",
      "check_scope",
      "record_decision",
    ]);
    const json = JSON.stringify(specs);
    expect(json).not.toMatch(/\$schema|additionalProperties/);
  });
  it("invalid args become recoverable errors", async () => {
    const r = await run(ctx(), "get_comments", { ref: "REC-9745", limit: 500 });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/Invalid arguments/);
  });
});
