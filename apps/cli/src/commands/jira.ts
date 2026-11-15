import type { Command } from "commander";
import { Importer, JiraReader, JiraWriter, loadDataset, verifyImport } from "@shipcheck/core";
import { jiraHttp, retryLogger, writeJson } from "../shared";
import { banner, c, duration, fail, info, ok, out, step, table, warn } from "../ui";

export const registerJiraCommands = (program: Command) => {
  program
    .command("verify-jira")
    .description("Check Jira credentials and project access (read-only)")
    .action(async () => {
      const { cfg, http } = jiraHttp();
      banner("Jira connection check", [
        ["Site", cfg.JIRA_BASE_URL],
        ["Project", cfg.JIRA_PROJECT_KEY],
      ]);
      const jira = new JiraReader(http);
      const me = await jira.myself();
      ok(`Authenticated as ${c.bold(me.displayName)}`);
      const project = await jira.getProjectOrExplain(cfg.JIRA_PROJECT_KEY);
      ok(`Project ${c.bold(project.key)} · ${project.name}`);
      out();
      info(`Next: ${c.bold("npm run import -- --dry-run")}`);
      out();
    });

  program
    .command("import")
    .description("Import the dataset into Jira (safe to rerun; resumes where it stopped)")
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
      banner(`Import into Jira${o.dryRun ? c.yellow("  (dry run: no writes)") : ""}`, [
        ["Site", cfg.JIRA_BASE_URL],
        ["Project", projectKey],
        ["Scope label", o.label ?? dataset.dataset_label],
        [
          "Records",
          `${dataset.records.length} records · ${dataset.records.reduce((n, r) => n + r.comments.length, 0)} comments`,
        ],
      ]);
      step(1, 2, "Preflight and import");
      const report = await new Importer(new JiraWriter(http), dataset, {
        projectKey,
        scopeLabel: o.label,
        issueTypeName: o.issueType,
        concurrency: Number(o.concurrency ?? cfg.JIRA_CONCURRENCY),
        dryRun: o.dryRun,
        log: (m) => (m.startsWith("✓") ? ok(m.slice(2)) : info(m)),
      }).run();
      const { map, ...summary } = report;
      if (!o.dryRun) await writeJson(o.out, "import-map.json", map);
      const path = await writeJson(o.out, o.dryRun ? "import-plan.json" : "import-report.json", summary);
      out();
      step(2, 2, "Summary");
      table(
        ["", "Created", "Already present", "Failed", "Expected"],
        [
          [
            "Issues",
            String(report.issues.created),
            String(report.issues.existing),
            String(report.issues.failed),
            String(report.records),
          ],
          [
            "Comments",
            String(report.comments.created),
            String(report.comments.existing),
            String(report.comments.failed),
            String(report.comments.expected),
          ],
          [
            "Links",
            String(report.links.created),
            String(report.links.existing),
            String(report.links.failed),
            String(report.links.expected),
          ],
          [
            "Statuses",
            String(report.statuses.transitioned),
            String(report.statuses.alreadyCorrect),
            String(report.statuses.unmatched),
            "—",
          ],
        ],
      );
      out();
      for (const w of report.warnings) warn(w);
      if (report.errors.length) {
        for (const e of report.errors.slice(0, 20)) fail(e);
        out();
        fail(`${report.errors.length} error(s). Rerun the same command to resume; completed work is skipped.`);
        process.exitCode = 1;
      } else ok(`Done in ${duration(report.durationMs)} · report: ${path}`);
      if (!o.dryRun && !report.errors.length) info(`Next: ${c.bold("npm run verify-import")}`);
      out();
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
      const projectKey = o.project ?? cfg.JIRA_PROJECT_KEY;
      banner("Verify import", [
        ["Project", projectKey],
        ["Scope label", o.label ?? dataset.dataset_label],
      ]);
      const report = await verifyImport(
        new JiraReader(http),
        dataset,
        projectKey,
        o.label ?? dataset.dataset_label,
        cfg.JIRA_CONCURRENCY,
      );
      const path = await writeJson(o.out, "verify-report.json", report);
      const k = report.counts;
      const row = (name: string, got: number, want: number) => [
        name,
        `${got}/${want}`,
        got === want ? c.green("✓") : c.red("✗"),
      ];
      table(
        ["Check", "Found", ""],
        [
          row("Issues", k.foundIssues, k.expectedIssues),
          row("Comments (verbatim)", k.matchingComments, k.expectedComments),
          row("Links", k.foundLinks, k.expectedLinks),
          row("Statuses", k.statusMatches, k.expectedIssues),
        ],
      );
      out();
      if (report.ok) {
        ok(`Jira matches the dataset · ${path}`);
        info(`Next: ${c.bold("npm run verify-llm")}`);
      } else {
        for (const m of report.mismatches.slice(0, 30)) fail(m);
        fail(`${report.mismatches.length} mismatch(es) · ${path}`);
        process.exitCode = 1;
      }
      out();
    });
};
