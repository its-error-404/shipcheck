import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import {
  ExpectedSchema,
  JiraReader,
  JsonlTrace,
  MemoryTrace,
  OpenAICompatibleClient,
  RunStore,
  TeeTrace,
  assess,
  buildMetrics,
  evaluateRun,
  loadAssessConfig,
  loadJiraConfig,
  loadLlmConfig,
  newRunId,
  renderEval,
  renderReport,
} from "@tyn/core";
import { jiraHttp } from "../shared";
import { AssessProgress } from "../progress";
import { banner, c, decision, duration, fail, info, ok, out, table, warn } from "../ui";

export const registerAssessCommands = (program: Command) => {
  program
    .command("assess")
    .description("Run the release-readiness agent against Jira and write the report")
    .option("-r, --release <release>", "target release (default: ASSESS_RELEASE)")
    .option("-p, --project <key>", "Jira project key (default: JIRA_PROJECT_KEY)")
    .option("-l, --label <label>", "dataset scope label (default: ASSESS_SCOPE_LABEL)")
    .option("-c, --concurrency <n>", "parallel investigations (default: ASSESS_CONCURRENCY, 1 for free tiers)")
    .option("--resume <runDir>", "reuse decided requirements from a previous run folder")
    .option(
      "--only <ids>",
      "assess only these requirements, e.g. REQ-05 or REQ-04,REQ-08 (quick demo; not a release decision)",
    )
    .option("-q, --quiet", "hide individual tool calls", false)
    .option("-o, --out <dir>", "base folder for run outputs", "runs")
    .action(async (o) => {
      const jiraCfg = loadJiraConfig();
      const llmCfg = loadLlmConfig();
      const assessCfg = loadAssessConfig();
      const release: string = o.release ?? assessCfg.ASSESS_RELEASE;
      const projectKey: string = o.project ?? jiraCfg.JIRA_PROJECT_KEY;
      const scopeLabel: string = o.label ?? assessCfg.ASSESS_SCOPE_LABEL;
      const runId = newRunId(release);
      const store = await RunStore.create(o.out, runId);
      const jsonl = new JsonlTrace(store.tracePath);
      const memory = new MemoryTrace();
      const trace = new TeeTrace([jsonl, memory, new AssessProgress({ quiet: o.quiet })]);
      const { http } = jiraHttp(trace);
      const llm = new OpenAICompatibleClient({
        baseURL: llmCfg.LLM_BASE_URL,
        apiKey: llmCfg.LLM_API_KEY,
        model: llmCfg.LLM_MODEL,
        provider: llmCfg.LLM_PROVIDER,
        temperature: llmCfg.LLM_TEMPERATURE,
        maxOutputTokens: llmCfg.LLM_MAX_OUTPUT_TOKENS,
        reasoningEffort: llmCfg.LLM_REASONING_EFFORT,
        rpm: llmCfg.LLM_RPM,
        timeoutMs: llmCfg.LLM_TIMEOUT_MS,
        trace,
      });
      const resume = o.resume ? await RunStore.loadResume(o.resume) : undefined;

      banner("Release readiness assessment", [
        ["Release", c.bold(release)],
        ["Jira", `${jiraCfg.JIRA_BASE_URL}  project ${projectKey}  label ${scopeLabel}`],
        ["Model", `${llm.model} ${c.gray(`(${llm.provider})`)}`],
        ["Run", `${runId} ${c.gray(`→ ${store.dir}`)}`],
        ...(resume ? ([["Resume", `${resume.size} result(s) from ${o.resume}`]] as [string, string][]) : []),
        ...(o.only
          ? ([["Scope", c.yellow(`only ${o.only} (partial run: not a release decision)`)]] as [string, string][])
          : []),
      ]);

      const result = await assess({
        jira: new JiraReader(http),
        llm,
        trace,
        runId,
        projectKey,
        scopeLabel,
        release,
        concurrency: Number(o.concurrency ?? assessCfg.ASSESS_CONCURRENCY),
        resume,
        only: o.only ? String(o.only).split(",") : undefined,
        budgets: {
          discovery: { elideAboveChars: assessCfg.AGENT_ELIDE_ABOVE_CHARS },
          investigation: {
            maxTurns: assessCfg.AGENT_MAX_TURNS,
            timeoutMs: assessCfg.AGENT_TIMEOUT_MS,
            elideAboveChars: assessCfg.AGENT_ELIDE_ABOVE_CHARS,
          },
        },
        onRequirement: store.saveRequirement,
      });
      const metrics = buildMetrics(result, memory.events, {
        inputPerMTok: llmCfg.LLM_PRICE_INPUT_PER_MTOK,
        outputPerMTok: llmCfg.LLM_PRICE_OUTPUT_PER_MTOK,
      });
      await store.saveFinal(result, metrics, renderReport(result, metrics, { siteUrl: jiraCfg.JIRA_BASE_URL }));
      await jsonl.close();

      out();
      if (result.status === "ABORTED") {
        fail(`Run aborted: ${result.abortReason ?? ""}`);
        info(`Details: ${join(store.dir, "report.md")}`);
        out();
        process.exitCode = 2;
        return;
      }
      table(
        ["Requirement", "Decision", "Result"],
        result.requirements.map((r) => [
          c.bold(r.sourceId ?? r.key),
          decision(r.decision),
          r.status === "decided"
            ? c.gray(`${r.agent?.turns ?? 0} turns · ${duration(r.agent?.durationMs ?? 0)}`)
            : r.status === "resumed"
              ? c.gray("reused")
              : c.yellow(r.status.replace("_", " ")),
        ]),
      );
      out();
      const overall = result.overall!;
      if (result.partial)
        warn(
          `Partial run: ${result.partial.selected.length} of ${result.partial.total} requirements. Not a release decision.`,
        );
      out(
        `  ${c.bold(result.partial ? "Overall (partial)" : "Overall")}  ${decision(overall.decision)}  ${c.gray(overall.reason)}`,
      );
      out(
        `  ${c.gray(`${overall.counts.PASS} pass · ${overall.counts.FAIL} fail · ${overall.counts.INSUFFICIENT_EVIDENCE} insufficient · ${duration(metrics.wallClockMs)} · ${metrics.llm.calls} model calls · ${metrics.tokens.total.toLocaleString("en-US")} tokens`)}`,
      );
      for (const issue of result.runIssues) warn(issue);
      out();
      ok(`Report  ${join(store.dir, "report.md")}`);
      info(`Trace   ${store.tracePath}`);
      info(`Next: ${c.bold(`npm run evaluate -- ${store.dir}`)}`);
      out();
    });

  program
    .command("evaluate")
    .description("Score a finished run against expected outcomes (eval/expected-<release>.json)")
    .argument("<runDir>", "run folder, e.g. runs/20261115-083548-R2.4")
    .option("-e, --expected <file>", "expected outcomes file (default: eval/expected-<release>.json)")
    .action(async (runDir: string, o: { expected?: string }) => {
      const run = JSON.parse(await readFile(join(runDir, "report.json"), "utf8"));
      const expectedPath = o.expected ?? join("eval", `expected-${run.request.release}.json`);
      const expected = ExpectedSchema.parse(JSON.parse(await readFile(expectedPath, "utf8")));
      const e = evaluateRun(run, expected);
      await writeFile(join(runDir, "evaluation.md"), renderEval(e));
      await writeFile(join(runDir, "evaluation.json"), `${JSON.stringify(e, null, 2)}\n`);

      banner("Evaluation", [
        ["Run", e.runId],
        ["Model", e.model],
        ["Prompt", e.promptVersion],
      ]);
      table(
        ["Requirement", "Expected", "Actual", ""],
        e.rows.map((r) => [
          c.bold(r.requirement),
          decision(r.expected),
          decision(r.actual),
          r.match ? c.green("✓") : c.red("✗"),
        ]),
      );
      out();
      const pct = Math.round(e.accuracy * 100);
      const color = pct >= 90 ? c.green : pct >= 60 ? c.yellow : c.red;
      out(`  ${c.bold("Accuracy")}  ${color(`${e.correct}/${e.total} (${pct}%)`)}`);
      out(
        `  ${c.bold("Overall")}   expected ${decision(e.overall.expected)}, got ${decision(e.overall.actual)} ${e.overall.match ? c.green("✓") : c.red("✗")}`,
      );
      if (e.criticalErrors.length) for (const ce of e.criticalErrors) warn(`Wrong direction: ${ce}`);
      else ok("No wrong-direction errors (no unsupported PASS, no PASS↔FAIL swaps)");
      out();
      info(`Saved ${join(runDir, "evaluation.md")}`);
      out();
    });
};
