#!/usr/bin/env node
/**
 * CLI entry point.
 *   npm run verify-jira     check credentials + project (read-only)
 *   npm run import          import inputs/dataset.json into Jira (idempotent)
 *   npm run verify-import   diff Jira against the dataset (read-only)
 *   npm run assess          run the release-readiness agent (Module 12)
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import {
  Importer,
  JiraReader,
  JiraWriter,
  createJiraHttp,
  loadDataset,
  loadJiraConfig,
  verifyImport,
  type TraceSink,
} from "@tyn/core";

const program = new Command()
  .name("tyn")
  .description("Jira release-evidence agent: importer and assessment CLI");

function jiraHttp(trace?: TraceSink) {
  const cfg = loadJiraConfig();
  return {
    cfg,
    http: createJiraHttp({ baseUrl: cfg.JIRA_BASE_URL, email: cfg.JIRA_EMAIL, apiToken: cfg.JIRA_API_TOKEN, trace }),
  };
}

/** Prints retries as they happen so a slow import never looks frozen. */
const retryLogger: TraceSink = {
  emit(e) {
    if (e.type === "jira_retry") console.warn(`  ↻ ${e.method} ${e.path} → ${e.status}; retry ${e.attempt} in ${e.delayMs} ms`);
  },
};

async function writeJson(dir: string, name: string, data: unknown) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
  return path;
}

program
  .command("verify-jira")
  .description("Check Jira credentials and project access (read-only)")
  .action(async () => {
    const { cfg, http } = jiraHttp();
    const jira = new JiraReader(http);
    const me = await jira.myself();
    const project = await jira.getProject(cfg.JIRA_PROJECT_KEY);
    console.log(`✓ Authenticated as ${me.displayName}`);
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
    console.log(`Importing ${dataset.records.length} records into ${projectKey} (scope label: ${o.label ?? dataset.dataset_label})${o.dryRun ? " [dry-run]" : ""}`);
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
    console.log(`\nIssues: ${report.issues.created} created, ${report.issues.existing} existing, ${report.issues.failed} failed`);
    console.log(`Comments: ${report.comments.created} created, ${report.comments.existing} existing (expected ${report.comments.expected})`);
    console.log(`Links: ${report.links.created} created, ${report.links.existing} existing (expected ${report.links.expected})`);
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
    const report = await verifyImport(new JiraReader(http), dataset, o.project ?? cfg.JIRA_PROJECT_KEY, o.label ?? dataset.dataset_label, cfg.JIRA_CONCURRENCY);
    const path = await writeJson(o.out, "verify-report.json", report);
    const c = report.counts;
    console.log(`Issues ${c.foundIssues}/${c.expectedIssues} · comments ${c.matchingComments}/${c.expectedComments} · links ${c.foundLinks}/${c.expectedLinks} · statuses ${c.statusMatches}/${c.expectedIssues}`);
    if (report.ok) console.log(`✓ Jira matches the dataset · ${path}`);
    else {
      for (const m of report.mismatches.slice(0, 50)) console.error(`✗ ${m}`);
      console.error(`${report.mismatches.length} mismatch(es) · ${path}`);
      process.exitCode = 1;
    }
  });

program.parseAsync().catch((err: Error) => {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
});
