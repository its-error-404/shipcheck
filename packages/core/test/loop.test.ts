import { beforeAll, describe, expect, it } from "vitest";
import { runAgent, type Budget } from "../src/agent/loop";
import { loadDataset, type Dataset } from "../src/import/dataset";
import { Importer } from "../src/import/importer";
import type { JiraReader } from "../src/jira/client";
import { EvidenceLedger } from "../src/ledger";
import { LlmQuotaExhaustedError } from "../src/llm/errors";
import { ScriptedLlm } from "../src/llm/scripted";
import { ScopedJiraView } from "../src/tools/jira-view";
import { INVESTIGATION_TOOLS } from "../src/tools/registry";
import { MemoryTrace } from "../src/trace";
import { DATASET_PATH, fakeClient } from "./helpers";

let ds: Dataset;
let reader: JiraReader;
let keyOf: (s: string) => string;
beforeAll(async () => {
  ds = await loadDataset(DATASET_PATH);
  const { jira } = fakeClient();
  const rep = await new Importer(jira, ds, { projectKey: "TYN", concurrency: 8 }).run();
  reader = jira;
  keyOf = (s) => rep.map[s]!;
});

const budget: Budget = { maxTurns: 10, maxToolCalls: 20, maxInputTokens: 100_000, timeoutMs: 60_000 };
function setup(llm: ScriptedLlm, b: Partial<Budget> = {}) {
  const trace = new MemoryTrace();
  const ctx = { view: new ScopedJiraView(reader, "TYN", ds.dataset_label), target: ds.target, ledger: new EvidenceLedger(), trace, requirementKey: keyOf("REQ-07") };
  return { trace, ctx, run: () => runAgent({ label: "REQ-07", llm, system: "sys", task: "Investigate REQ-07", tools: INVESTIGATION_TOOLS, ctx, budget: { ...budget, ...b }, trace }) };
}

/** Finds the comment id in the transcript so the scripted model can cite it like a real one would. */
const idOf = (req: any, needle: string) => {
  const tool = [...req.messages].reverse().find((m: any) => m.role === "tool" && m.content.includes(needle));
  const block = tool.content.split("\n\n").find((b: string) => b.includes(needle));
  return /\[comment (\d+)/.exec(block)![1]!;
};

describe("agent loop", () => {
  it("runs tools chosen by the model and stops on an accepted terminal decision", async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ name: "get_issue", args: { ref: "REQ-07" } }] },
      { toolCalls: [{ name: "get_issue", args: { ref: "REC-9745" } }, { name: "get_comments", args: { ref: "REC-9745" } }] },
      (req) => ({
        toolCalls: [{ name: "record_decision", args: {
          requirement_key: keyOf("REQ-07"), decision: "PASS",
          explanation: "REDACT-901 explicitly supersedes REDACT-870 and passes 28/28 on the target build.",
          evidence: [{ issue_key: keyOf("REC-9745"), comment_id: idOf(req, "REDACT-901"), stance: "supports_pass", why: "superseding retest" }],
        } }],
      }),
    ]);
    const { run, trace } = setup(llm);
    const r = await run();
    expect(r.stopReason).toBe("terminal");
    expect((r.terminal as any).decision).toBe("PASS");
    expect(r.turns).toBe(3);
    expect(r.toolCalls).toBe(4);
    expect(trace.events.filter((e) => e.type === "tool_call").map((e) => e.tool)).toEqual(["get_issue", "get_issue", "get_comments", "record_decision"]);
  });

  it("feeds a rejected decision back so the model can fix it", async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ name: "record_decision", args: { requirement_key: keyOf("REQ-07"), decision: "PASS", explanation: "Jira says Done, so it passes for sure.", evidence: [{ issue_key: keyOf("REQ-07"), stance: "supports_pass", why: "status" }] } }] },
      (req) => {
        const last = req.messages[req.messages.length - 1] as any;
        expect(last.content).toMatch(/Decision rejected/);
        return { toolCalls: [{ name: "record_decision", args: { requirement_key: keyOf("REQ-07"), decision: "INSUFFICIENT_EVIDENCE", explanation: "No QA evidence was examined in this run at all.", evidence: [], outstanding: ["Examine linked QA records"] } }] };
      },
    ]);
    const r = await setup(llm).run();
    expect(r.stopReason).toBe("terminal");
    expect(r.toolErrors).toBe(1);
  });

  it("nudges once when the model answers in text, then stops with no_tool_call", async () => {
    const llm = new ScriptedLlm([{ text: "I think it passes." }, { text: "Still passes." }]);
    const r = await setup(llm).run();
    expect(r.stopReason).toBe("no_tool_call");
    expect((llm.requests[1]!.messages.at(-1) as any).content).toMatch(/without calling a tool/);
  });

  it("warns before the turn budget runs out, then stops at max_turns", async () => {
    const llm = new ScriptedLlm([{ toolCalls: [{ name: "search_issues", args: { kind: "evidence", limit: 1 } }] }], true);
    const { run, trace } = setup(llm, { maxTurns: 5 });
    const r = await run();
    expect(r.stopReason).toBe("max_turns");
    expect(r.turns).toBe(5);
    expect(trace.events.some((e) => e.type === "budget_warning")).toBe(true);
    expect(llm.requests.some((q) => q.messages.some((m: any) => m.role === "user" && /Budget almost exhausted/.test(m.content)))).toBe(true);
  });

  it("enforces tool-call and token budgets", async () => {
    const many = new ScriptedLlm([{ toolCalls: Array.from({ length: 6 }, () => ({ name: "search_issues", args: { kind: "work", limit: 1 } })) }], true);
    expect((await setup(many, { maxToolCalls: 10 }).run()).stopReason).toBe("max_tool_calls");
    const heavy = new ScriptedLlm([{ toolCalls: [{ name: "search_issues", args: { kind: "work", limit: 1 } }], inputTokens: 60_000 }], true);
    expect((await setup(heavy, { maxInputTokens: 100_000 }).run()).stopReason).toBe("token_budget");
  });

  it("reports quota exhaustion and LLM errors honestly (never a decision)", async () => {
    const q = await setup(new ScriptedLlm([new LlmQuotaExhaustedError("Daily LLM quota exhausted")])).run();
    expect(q.stopReason).toBe("quota_exhausted");
    expect(q.terminal).toBeUndefined();
    const e = await setup(new ScriptedLlm([new Error("boom")])).run();
    expect(e.stopReason).toBe("llm_error");
    expect(e.error).toMatch(/boom/);
  });

  it("turns invalid JSON args and unknown tools into recoverable tool errors", async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ name: "get_issue", args: { __invalid_json: "{ref:" } }, { name: "delete_issue", args: {} }] },
      { text: "done" }, { text: "done" },
    ]);
    const r = await setup(llm).run();
    const tools = r.transcript.filter((m) => m.role === "tool") as any[];
    expect(tools[0].content).toMatch(/not valid JSON/);
    expect(tools[1].content).toMatch(/Unknown tool 'delete_issue'/);
    expect(r.toolErrors).toBe(2);
  });

  it("elides old large tool results when the conversation grows too big", async () => {
    const llm = new ScriptedLlm([{ toolCalls: [{ name: "search_issues", args: { kind: "evidence", limit: 25 } }] }], true);
    const { run, trace } = setup(llm, { maxTurns: 8, elideAboveChars: 4000 });
    await run();
    expect(trace.events.some((e) => e.type === "context_elided")).toBe(true);
  });
});
