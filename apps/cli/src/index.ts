#!/usr/bin/env node
/**
 * CLI entry point.
 *   npm run verify-jira     check credentials + project (read-only)
 *   npm run import          import inputs/dataset.json into Jira (idempotent)
 *   npm run verify-import   diff Jira against the dataset (read-only)
 *   npm run assess          run the release-readiness agent (Module 12)
 */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import {
  CallbackTrace,
  Importer,
  JsonlTrace,
  MemoryTrace,
  OpenAICompatibleClient,
  RunStore,
  TRACE_EVENTS,
  TeeTrace,
  assess,
  buildMetrics,
  ExpectedSchema,
  evaluateRun,
  renderEval,
  loadAssessConfig,
  loadLlmConfig,
  loadLlmConnection,
  newRunId,
  renderReport,
  JiraReader,
  JiraWriter,
  createJiraHttp,
  loadDataset,
  loadJiraConfig,
  verifyImport,
  type TraceSink,
} from "@tyn/core";

const program = new Command().name("tyn").description("Jira release-evidence agent: importer and assessment CLI");

const jiraHttp = (trace?: TraceSink) => {
  const cfg = loadJiraConfig();
  return {
    cfg,
    http: createJiraHttp({ baseUrl: cfg.JIRA_BASE_URL, email: cfg.JIRA_EMAIL, apiToken: cfg.JIRA_API_TOKEN, trace }),
  };
};

/** Prints retries as they happen so a slow import never looks frozen. */
const retryLogger: TraceSink = {
  emit(e) {
    if (e.type === TRACE_EVENTS.jiraRetry)
      console.warn(`  ↻ ${e.method} ${e.path} → ${e.status}; retry ${e.attempt} in ${e.delayMs} ms`);
  },
};

const writeJson = async (dir: string, name: string, data: unknown) => {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
  return path;
};

program
  .command("verify-jira")
  .description("Check Jira credentials and project access (read-only)")
  .action(async () => {
    const { cfg, http } = jiraHttp();
    const jira = new JiraReader(http);
    const me = await jira.myself();
    console.log(`✓ Authenticated as ${me.displayName}`);
    const project = await jira.getProjectOrExplain(cfg.JIRA_PROJECT_KEY);
    console.log(`✓ Project ${project.key}: ${project.name}`);
  });

program
  .command("import")
  .description("Import the dataset into Jira (safe to rerun)")
  .option("-d, --dataset <path>", "dataset JSON", "inputs/dataset.json")
  .option("-p, --project <key>", "Jira project key (default: JIRA_PROJECT_KEY)")
  .option("-l, --label <label>", "scope label (default: dataset_label from the dataset)")
  .option("-t, --issue-type <name>", "issue type", "Task")
  .option("-c, --concurrency <n>", "parallel workers for comments")
  .option("--dry-run", "preflight and plan only; no writes", false)
  .option("-o, --out <dir>", "where to write import-map.json and import-report.json", "artifacts/import")
  .action(async (o) => {
    const { cfg, http } = jiraHttp(retryLogger);
    const dataset = await loadDataset(o.dataset);
    const projectKey = o.project ?? cfg.JIRA_PROJECT_KEY;
    console.log(
      `Importing ${dataset.records.length} records into ${projectKey} (scope label: ${o.label ?? dataset.dataset_label})${o.dryRun ? " [dry-run]" : ""}`,
    );
    const report = await new Importer(new JiraWriter(http), dataset, {
      projectKey,
      scopeLabel: o.label,
      issueTypeName: o.issueType,
      concurrency: Number(o.concurrency ?? cfg.JIRA_CONCURRENCY),
      dryRun: o.dryRun,
      log: (m) => console.log(m),
    }).run();
    const { map, ...summary } = report;
    if (!o.dryRun) await writeJson(o.out, "import-map.json", map);
    const path = await writeJson(o.out, o.dryRun ? "import-plan.json" : "import-report.json", summary);
    console.log(
      `\nIssues: ${report.issues.created} created, ${report.issues.existing} existing, ${report.issues.failed} failed`,
    );
    console.log(
      `Comments: ${report.comments.created} created, ${report.comments.existing} existing (expected ${report.comments.expected})`,
    );
    console.log(
      `Links: ${report.links.created} created, ${report.links.existing} existing (expected ${report.links.expected})`,
    );
    console.log(`Duration: ${(report.durationMs / 1000).toFixed(1)} s · report: ${path}`);
    for (const w of report.warnings) console.warn(`⚠ ${w}`);
    if (report.errors.length) {
      for (const e of report.errors) console.error(`✗ ${e}`);
      console.error(`\n${report.errors.length} error(s). Rerun the same command to resume; completed work is skipped.`);
      process.exitCode = 1;
    }
  });

program
  .command("verify-import")
  .description("Diff Jira against the dataset (read-only)")
  .option("-d, --dataset <path>", "dataset JSON", "inputs/dataset.json")
  .option("-p, --project <key>", "Jira project key (default: JIRA_PROJECT_KEY)")
  .option("-l, --label <label>", "scope label (default: dataset_label)")
  .option("-o, --out <dir>", "where to write verify-report.json", "artifacts/import")
  .action(async (o) => {
    const { cfg, http } = jiraHttp(retryLogger);
    const dataset = await loadDataset(o.dataset);
    const report = await verifyImport(
      new JiraReader(http),
      dataset,
      o.project ?? cfg.JIRA_PROJECT_KEY,
      o.label ?? dataset.dataset_label,
      cfg.JIRA_CONCURRENCY,
    );
    const path = await writeJson(o.out, "verify-report.json", report);
    const c = report.counts;
    console.log(
      `Issues ${c.foundIssues}/${c.expectedIssues} · comments ${c.matchingComments}/${c.expectedComments} · links ${c.foundLinks}/${c.expectedLinks} · statuses ${c.statusMatches}/${c.expectedIssues}`,
    );
    if (report.ok) console.log(`✓ Jira matches the dataset · ${path}`);
    else {
      for (const m of report.mismatches.slice(0, 50)) console.error(`✗ ${m}`);
      console.error(`${report.mismatches.length} mismatch(es) · ${path}`);
      process.exitCode = 1;
    }
  });

program
  .command("verify-llm")
  .description("List models your LLM key can use and test tool calling (LLM_MODEL, or several with --models)")
  .option("-m, --models <ids>", "comma-separated model ids to probe, e.g. gemini-3.7-flash,gemini-3.6-flash")
  .action(async (o: { models?: string }) => {
    const conn = loadLlmConnection();
    const lister = new OpenAICompatibleClient({ baseURL: conn.LLM_BASE_URL, apiKey: conn.LLM_API_KEY, model: "none" });
    const available = await lister.listModels().catch((e: Error) => {
      console.warn(`Could not list models: ${e.message}`);
      return [] as string[];
    });
    if (available.length) {
      const flash = available.filter((m) => /flash/i.test(m) && !/tts|live|audio|image|embed|omni/i.test(m));
      console.log(`✓ Key works. ${available.length} models available; text "flash" models:\n  ${flash.join("\n  ")}`);
    }
    const candidates = (o.models ?? process.env.LLM_MODEL ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    if (!candidates.length) {
      console.log("\nSet LLM_MODEL in .env (or pass --models a,b,c) to test tool calling.");
      return;
    }
    const cfg = { ...loadLlmConnection(), timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60_000) };
    const effort = process.env.LLM_REASONING_EFFORT || undefined;
    console.log(`\nProbing ${candidates.length} model(s) with a tool call (timeout ${cfg.timeoutMs / 1000} s each):`);
    const working: string[] = [];
    for (const model of candidates) {
      const llm = new OpenAICompatibleClient({
        baseURL: cfg.LLM_BASE_URL,
        apiKey: cfg.LLM_API_KEY,
        model,
        reasoningEffort: effort,
        timeoutMs: cfg.timeoutMs,
        maxRetries: 0,
      });
      try {
        const res = await llm.chat({
          system: "You are a connectivity test. Always respond by calling the provided tool.",
          messages: [{ role: "user", content: "Call the ping tool with message 'ok'." }],
          tools: [
            {
              name: "ping",
              description: "Connectivity check",
              parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
            },
          ],
        });
        if (res.toolCalls[0]?.name === "ping") {
          working.push(model);
          console.log(`  ✓ ${model}: tool call OK in ${(res.latencyMs / 1000).toFixed(1)} s (served as ${res.model})`);
        } else console.log(`  ✗ ${model}: answered without calling the tool`);
      } catch (e) {
        console.log(`  ✗ ${model}: ${(e as Error).message.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
    if (working.length)
      console.log(`\nUse one of: ${working.join(", ")} (set LLM_MODEL in .env; prefer the fastest non-preview).`);
    else process.exitCode = 1;
  });

program
  .command("assess")
  .description("Run the release-readiness agent against Jira and write the report")
  .option("-r, --release <release>", "target release (default: ASSESS_RELEASE)")
  .option("-p, --project <key>", "Jira project key (default: JIRA_PROJECT_KEY)")
  .option("-l, --label <label>", "dataset scope label (default: ASSESS_SCOPE_LABEL)")
  .option("-c, --concurrency <n>", "parallel investigations (default: ASSESS_CONCURRENCY, 1 for free tiers)")
  .option("--resume <runDir>", "reuse decided requirements from a previous run folder")
  .option("-o, --out <dir>", "base folder for run outputs", "runs")
  .action(async (o) => {
    const jiraCfg = loadJiraConfig();
    const llmCfg = loadLlmConfig();
    const assessCfg = loadAssessConfig();
    const release: string = o.release ?? assessCfg.ASSESS_RELEASE;
    const runId = newRunId(release);
    const store = await RunStore.create(o.out, runId);
    const jsonl = new JsonlTrace(store.tracePath);
    const memory = new MemoryTrace();
    const progress = new CallbackTrace((e) => {
      if (e.type === TRACE_EVENTS.toolCall)
        console.log(`    · [${e.label}] ${e.tool}${e.ok ? "" : " (error)"} ${JSON.stringify(e.args).slice(0, 90)}`);
      if (e.type === TRACE_EVENTS.llmRetry)
        console.warn(`    ↻ LLM ${e.reason}; retry ${e.attempt} in ${Math.round(Number(e.delayMs) / 1000)} s`);
      if (e.type === TRACE_EVENTS.jiraRetry)
        console.warn(`    ↻ Jira ${e.status}; retry ${e.attempt} in ${e.delayMs} ms`);
    });
    const trace = new TeeTrace([jsonl, memory, progress]);

    const http = createJiraHttp({
      baseUrl: jiraCfg.JIRA_BASE_URL,
      email: jiraCfg.JIRA_EMAIL,
      apiToken: jiraCfg.JIRA_API_TOKEN,
      trace,
    });
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
    if (resume) console.log(`Resuming: ${resume.size} requirement result(s) found in ${o.resume}`);

    console.log(`Run ${runId}: release ${release} · model ${llm.model} (${llm.provider}) · output ${store.dir}`);
    const result = await assess({
      jira: new JiraReader(http),
      llm,
      trace,
      runId,
      projectKey: o.project ?? jiraCfg.JIRA_PROJECT_KEY,
      scopeLabel: o.label ?? assessCfg.ASSESS_SCOPE_LABEL,
      release,
      concurrency: Number(o.concurrency ?? assessCfg.ASSESS_CONCURRENCY),
      resume,
      budgets: {
        discovery: { elideAboveChars: assessCfg.AGENT_ELIDE_ABOVE_CHARS },
        investigation: {
          maxTurns: assessCfg.AGENT_MAX_TURNS,
          timeoutMs: assessCfg.AGENT_TIMEOUT_MS,
          elideAboveChars: assessCfg.AGENT_ELIDE_ABOVE_CHARS,
        },
      },
      onRequirement: store.saveRequirement,
      log: (m) => console.log(m),
    });
    const metrics = buildMetrics(result, memory.events, {
      inputPerMTok: llmCfg.LLM_PRICE_INPUT_PER_MTOK,
      outputPerMTok: llmCfg.LLM_PRICE_OUTPUT_PER_MTOK,
    });
    await store.saveFinal(result, metrics, renderReport(result, metrics, { siteUrl: jiraCfg.JIRA_BASE_URL }));
    await jsonl.close();
    console.log(`\nReport: ${join(store.dir, "report.md")}`);
    if (result.status === "ABORTED") process.exitCode = 2;
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
    const result = evaluateRun(run, expected);
    const md = renderEval(result);
    await writeFile(join(runDir, "evaluation.md"), md);
    await writeFile(join(runDir, "evaluation.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(md);
    console.log(`Saved: ${join(runDir, "evaluation.md")}`);
  });

program.parseAsync().catch((err: Error) => {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
});
