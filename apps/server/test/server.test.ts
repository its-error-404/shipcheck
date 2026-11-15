import {
  RunStore,
  buildMetrics,
  newRunId,
  type AssessmentResult,
  type RequirementResult,
  type SessionOptions,
} from "@shipcheck/core";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSession } from "@shipcheck/core";
import { buildApp, type ShipcheckApp } from "../src/app";
import { LIVE_EVENTS } from "../src/constants";
import type { SessionFactory } from "../src/live";

const requirement: RequirementResult = {
  key: "SHIP-1",
  sourceId: "REQ-01",
  summary: "[REQ-01] Example",
  status: "decided",
  decision: "PASS",
  explanation: "Verified by QA on the target build.",
  evidence: [],
  outstanding: [],
  anomalies: [],
};

/** A session that writes a real run folder, emits a couple of trace events and waits for `gate`. */
const fakeFactory = (
  gate: Promise<void> = Promise.resolve(),
  opts: { fail?: string; seenOnly?: (o: SessionOptions) => void; prepareMs?: number } = {},
) =>
  (async (o) => {
    if (opts.prepareMs) await new Promise((r) => setTimeout(r, opts.prepareMs));
    if (opts.fail) throw new Error(opts.fail);
    opts.seenOnly?.(o);
    const runId = newRunId("R2.4");
    const store = await RunStore.create(o.outDir!, runId);
    const info = {
      runId,
      dir: store.dir,
      release: "R2.4",
      projectKey: "SHIP",
      scopeLabel: "scope",
      model: "scripted",
      provider: "test",
      resumed: 0,
    };
    return {
      info,
      run: async () => {
        for (const s of o.sinks ?? []) s.emit({ type: "run_start", runId });
        await gate;
        await store.saveRequirement(requirement, [{ role: "user", content: "Investigate requirement SHIP-1" }]);
        const result: AssessmentResult = {
          runId,
          status: "COMPLETED",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          request: { projectKey: "SHIP", scopeLabel: "scope", release: "R2.4" },
          model: "scripted",
          provider: "test",
          promptVersion: "v3",
          budgets: {} as AssessmentResult["budgets"],
          overall: {
            decision: "READY",
            reason: "All mandatory requirements pass.",
            counts: { PASS: 1, FAIL: 0, INSUFFICIENT_EVIDENCE: 0 },
          },
          requirements: [requirement],
          runIssues: [],
        };
        for (const s of o.sinks ?? []) s.emit({ type: "run_end", status: "COMPLETED" });
        const metrics = buildMetrics(result, []);
        await store.saveFinal(result, metrics, "# Report\n");
        return { info, result, metrics };
      },
    };
  }) as SessionFactory;

let current: ShipcheckApp | undefined;
let socket: Socket | undefined;

const start = async (createSession: SessionFactory, runsDir?: string) => {
  const dir = runsDir ?? (await mkdtemp(join(tmpdir(), "shipcheck-runs-")));
  current = await buildApp({ runsDir: dir, createSession, env: {} });
  await current.app.listen({ host: "127.0.0.1", port: 0 });
  const address = current.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { ...current, dir, url: `http://127.0.0.1:${port}` };
};

afterEach(async () => {
  socket?.disconnect();
  socket = undefined;
  if (current) {
    await current.live.settled();
    await current.app.close();
  }
  current = undefined;
});

describe("web server", () => {
  it("serves health, config without secrets, and an empty run list", async () => {
    const { app } = await start(fakeFactory());
    expect((await app.inject({ url: "/api/health" })).json()).toEqual({ ok: true });
    const config = (await app.inject({ url: "/api/config" })).json();
    expect(config.jira.ok).toBe(false);
    expect(config.jira.missing).toContain("JIRA_API_TOKEN");
    expect(JSON.stringify(config)).not.toMatch(/TOKEN"\s*:\s*"/);
    expect((await app.inject({ url: "/api/runs" })).json()).toEqual([]);
  });

  it("starts a run, streams live events over Socket.io, and rejects a second run while busy", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, url, live } = await start(fakeFactory(gate));

    socket = connect(url, { transports: ["websocket"] });
    const seen: string[] = [];
    const finished = new Promise<{ overall: { decision: string } }>((resolve) => {
      socket!.on(LIVE_EVENTS.started, () => seen.push("started"));
      socket!.on(LIVE_EVENTS.trace, (e: { type: string }) => seen.push(e.type));
      socket!.on(LIVE_EVENTS.finished, resolve);
    });
    await new Promise<void>((r) => socket!.on("connect", () => r()));

    const first = await app.inject({ method: "POST", url: "/api/runs", payload: {} });
    expect(first.statusCode).toBe(202);
    const runId = first.json().runId as string;

    const busy = await app.inject({ method: "POST", url: "/api/runs", payload: {} });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().runId).toBe(runId);
    expect((await app.inject({ url: "/api/live" })).json().active.info.runId).toBe(runId);

    // A client that connects mid-run gets the events it missed.
    const late = connect(url, { transports: ["websocket"] });
    const replayed = await new Promise<{ type: string }[]>((resolve) => late.on(LIVE_EVENTS.replay, resolve));
    late.disconnect();
    expect(replayed.map((e) => e.type)).toEqual(["run_start"]);

    release();
    expect((await finished).overall.decision).toBe("READY");
    await live.settled();
    expect(seen).toEqual(["started", "run_start", "run_end"]);

    const runs = (await app.inject({ url: "/api/runs" })).json();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: runId, state: "complete", counts: { PASS: 1 } });

    const detail = (await app.inject({ url: `/api/runs/${runId}` })).json();
    expect(detail.report.overall.decision).toBe("READY");
    expect(detail.requirements[0].sourceId).toBe("REQ-01");
    expect((await app.inject({ url: `/api/runs/${runId}/report.md` })).body).toContain("# Report");
    expect((await app.inject({ url: `/api/runs/${runId}/transcripts/REQ-01` })).json()).toHaveLength(1);
    expect((await app.inject({ url: `/api/runs/${runId}/transcripts/REQ-99` })).statusCode).toBe(404);
  });

  it("passes --only through, validates input, and shows config errors", async () => {
    let only: readonly string[] | undefined;
    const { app } = await start(fakeFactory(Promise.resolve(), { seenOnly: (o) => (only = o.only) }));
    const ok = await app.inject({ method: "POST", url: "/api/runs", payload: { only: ["REQ-04", "REQ-08"] } });
    expect(ok.statusCode).toBe(202);
    expect(only).toEqual(["REQ-04", "REQ-08"]);
    await current!.live.settled();

    const bad = await app.inject({ method: "POST", url: "/api/runs", payload: { only: ["../etc"] } });
    expect(bad.statusCode).toBe(400);

    await current!.app.close();
    current = undefined;
    const { app: broken } = await start(fakeFactory(Promise.resolve(), { fail: "JIRA_BASE_URL is not set" }));
    const res = await broken.inject({ method: "POST", url: "/api/runs", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/JIRA_BASE_URL is not set/);
  });

  it("shows an interrupted run from its per-requirement files and refuses unsafe ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipcheck-runs-"));
    await mkdir(join(dir, "20261115-110400-R2.4", "requirements"), { recursive: true });
    await writeFile(join(dir, "20261115-110400-R2.4", "requirements", "REQ-01.json"), JSON.stringify(requirement));
    const { app } = await start(fakeFactory(), dir);

    const [run] = (await app.inject({ url: "/api/runs" })).json();
    expect(run).toMatchObject({ id: "20261115-110400-R2.4", state: "incomplete", release: "R2.4", requirements: 1 });
    expect((await app.inject({ url: "/api/runs/..%2F..%2Fetc" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/runs/nope" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/nope" })).statusCode).toBe(404);
  });

  it("starts only one run when two requests arrive at the same moment", async () => {
    const { app } = await start(fakeFactory(Promise.resolve(), { prepareMs: 50 }));
    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/runs", payload: {} }),
      app.inject({ method: "POST", url: "/api/runs", payload: {} }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409]);
  });

  it("refuses runs and live events requested by other websites", async () => {
    const { app, url } = await start(fakeFactory());
    const crossSite = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: { origin: "https://evil.example" },
      payload: {},
    });
    expect(crossSite.statusCode).toBe(403);
    const plain = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: { "content-type": "text/plain" },
      payload: "x",
    });
    expect(plain.statusCode).toBe(415);
    const own = await app.inject({ method: "POST", url: "/api/runs", headers: { origin: url }, payload: {} });
    expect(own.statusCode).toBe(202);

    socket = connect(url, { transports: ["websocket"], extraHeaders: { origin: "https://evil.example" } });
    const outcome = await new Promise<string>((resolve) => {
      socket!.on("connect", () => resolve("connected"));
      socket!.on("connect_error", () => resolve("refused"));
    });
    expect(outcome).toBe("refused");
  });

  it("rejects resuming from a run with no saved results", async () => {
    const { app } = await start(fakeFactory());
    const res = await app.inject({ method: "POST", url: "/api/runs", payload: { resumeFrom: "20990101-000000-R9" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/No saved results/);
  });
});

describe("prepareSession", () => {
  it("validates configuration before creating a run folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipcheck-runs-"));
    await expect(prepareSession({ outDir: dir, env: {} })).rejects.toThrow(/JIRA_BASE_URL/);
    expect(await readdir(dir)).toEqual([]);
  });
});
