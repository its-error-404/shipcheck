import { describe, expect, it } from "vitest";
import { loadDataset, type Dataset } from "../src/import/dataset";
import { Importer } from "../src/import/importer";
import { verifyImport } from "../src/import/verify";
import { DATASET_PATH, fakeClient } from "./helpers";

async function freshImport(dataset?: Dataset) {
  const ds = dataset ?? (await loadDataset(DATASET_PATH));
  const ctx = fakeClient();
  const report = await new Importer(ctx.jira, ds, { projectKey: "TYN", concurrency: 8 }).run();
  return { ds, ...ctx, report };
}

describe("Importer (full dataset against fake Jira)", () => {
  it("imports every record, comment, link and status, and verify-import passes", async () => {
    const { ds, fake, jira, report } = await freshImport();
    expect(report.errors).toEqual([]);
    expect(report.issues.created).toBe(400);
    expect(report.comments.created).toBe(2059);
    expect(report.links.created).toBe(report.links.expected);
    expect(report.statuses.unmatched).toBe(0);
    expect(fake.issues.size).toBe(400);

    const v = await verifyImport(jira, ds, "TYN");
    expect(v.mismatches).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.counts.matchingComments).toBe(2059);
    expect(v.counts.statusMatches).toBe(400);
  });

  it("is idempotent: a second run creates nothing", async () => {
    const { ds, jira, fake } = await freshImport();
    const before = fake.requests.length;
    const second = await new Importer(jira, ds, { projectKey: "TYN" }).run();
    expect(second.issues.created).toBe(0);
    expect(second.comments.created).toBe(0);
    expect(second.links.created).toBe(0);
    expect(second.statuses.transitioned).toBe(0);
    expect(second.issues.existing).toBe(400);
    expect(fake.requests.slice(before).some((r) => r.method === "POST" && !r.path.endsWith("/search/jql"))).toBe(false);
  });

  it("resumes after a crash midway without duplicates", async () => {
    const ds = await loadDataset(DATASET_PATH);
    const { fake, jira } = fakeClient();
    // Every comment POST after the 500th fails hard (simulates Jira going down).
    let posts = 0;
    fake.fail({
      match: (m, p) => m === "POST" && p.endsWith("/comment") && ++posts > 500,
      status: 400,
      times: 1e9,
    });
    const first = await new Importer(jira, ds, { projectKey: "TYN" }).run();
    expect(first.comments.created).toBe(500);
    expect(first.errors.length).toBeGreaterThan(0);

    (fake as any).faults = []; // Jira is back
    const second = await new Importer(jira, ds, { projectKey: "TYN" }).run();
    expect(second.errors).toEqual([]);
    expect(second.comments.created).toBe(2059 - 500);
    const v = await verifyImport(jira, ds, "TYN");
    expect(v.ok).toBe(true);
  });

  it("dry-run writes nothing", async () => {
    const ds = await loadDataset(DATASET_PATH);
    const { fake, jira } = fakeClient();
    const r = await new Importer(jira, ds, { projectKey: "TYN", dryRun: true }).run();
    expect(r.dryRun).toBe(true);
    expect(fake.issues.size).toBe(0);
  });

  it("ignores unrelated tickets outside the scope label", async () => {
    const ds = await loadDataset(DATASET_PATH);
    const { fake, jira } = fakeClient();
    fake.seedIssue("Someone else's ticket", ["other-team"]);
    const r = await new Importer(jira, ds, { projectKey: "TYN" }).run();
    expect(r.issues.created).toBe(400);
    expect((await verifyImport(jira, ds, "TYN")).ok).toBe(true);
  });

  it("verify-import detects tampering", async () => {
    const { ds, fake, jira } = await freshImport();
    const victim = [...fake.issues.values()][5]!;
    victim.comments.pop();
    victim.status = "To Do";
    const v = await verifyImport(jira, ds, "TYN");
    expect(v.ok).toBe(false);
    expect(v.mismatches.join("\n")).toMatch(/comments, expected/);
  });

  it("fails preflight clearly when the project is wrong", async () => {
    const ds = await loadDataset(DATASET_PATH);
    const { jira } = fakeClient();
    await expect(new Importer(jira, ds, { projectKey: "NOPE" }).run()).rejects.toThrow(/Projects you can access: TYN/);
  });
});
