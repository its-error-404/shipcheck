/**
 * Repeatable, idempotent importer (docs/06-importer.md).
 *
 * Every step checks Jira before writing (issues by src- label, comments by
 * their [Source comment n/N] header, links by existing pairs, statuses by
 * name), so a crashed import resumes on rerun and a second run creates
 * nothing. Jira is the source of truth; import-map.json is only an output log.
 */
import pLimit from "p-limit";
import { adfToText, textToAdf } from "../jira/adf";
import type { JiraIssue, JiraTransition, JiraWriter } from "../jira/client";
import { JiraError } from "../jira/errors";
import { scopedJql } from "../jira/jql";
import { noopTrace, type TraceSink } from "../trace";
import { DEFAULT_ISSUE_TYPE, JIRA_LIMITS, JIRA_LINK_TYPE, REQUIRED_CREATE_FIELDS } from "../constants/jira";
import { TRACE_EVENTS } from "../constants/trace";
import type { Dataset, SourceRecord } from "../models/dataset";
import { sourceIdFromLabels } from "../utils/labels";
import { commentBodyFor, descriptionFor, labelsFor, parseImportedComment, summaryFor } from "./mapping";

export interface ImportOptions {
  projectKey: string;
  /** Defaults to dataset.dataset_label. */
  scopeLabel?: string;
  issueTypeName?: string;
  concurrency?: number;
  dryRun?: boolean;
  trace?: TraceSink;
  log?: (msg: string) => void;
}

export interface ImportReport {
  projectKey: string;
  scopeLabel: string;
  dryRun: boolean;
  startedAt: string;
  durationMs: number;
  records: number;
  issues: { created: number; existing: number; failed: number };
  comments: { created: number; existing: number; failed: number; expected: number };
  links: { created: number; existing: number; failed: number; expected: number };
  statuses: { transitioned: number; alreadyCorrect: number; unmatched: number };
  warnings: string[];
  errors: string[];
  map: Record<string, string>;
}

const SEARCH_FIELDS = ["summary", "labels", "status", "issuelinks"];

export class Importer {
  private readonly log: (msg: string) => void;
  private readonly trace: TraceSink;

  constructor(
    private readonly jira: JiraWriter,
    private readonly dataset: Dataset,
    private readonly opts: ImportOptions,
  ) {
    this.log = opts.log ?? (() => {});
    this.trace = opts.trace ?? noopTrace;
  }

  private get scope(): string {
    return this.opts.scopeLabel ?? this.dataset.dataset_label;
  }

  /** Checks credentials, project, issue type, labels field and link type before any write. */
  async preflight(): Promise<{ issueTypeId: string; user: string }> {
    const me = await this.jira.myself();
    this.log(`✓ Authenticated as ${me.displayName}`);
    const project = await this.jira.getProjectOrExplain(this.opts.projectKey);
    this.log(`✓ Project ${project.key} (${project.name})`);

    const wanted = (this.opts.issueTypeName ?? DEFAULT_ISSUE_TYPE).toLowerCase();
    const types = await this.jira.getIssueTypes(this.opts.projectKey);
    const type = types.find((t) => t.name.toLowerCase() === wanted);
    if (!type) {
      throw new Error(
        `Issue type "${this.opts.issueTypeName ?? DEFAULT_ISSUE_TYPE}" not found in ${this.opts.projectKey}. Available: ${types.map((t) => t.name).join(", ")}`,
      );
    }
    const fields = await this.jira.getCreateFields(this.opts.projectKey, type.id);
    for (const f of REQUIRED_CREATE_FIELDS) {
      if (!fields.includes(f)) {
        throw new Error(
          `Field "${f}" is not on the create screen for ${type.name} in ${this.opts.projectKey}. Add it in the project's field configuration and rerun.`,
        );
      }
    }
    this.log(`✓ Issue type ${type.name} with summary/description/labels`);

    const linkTypes = await this.jira.getLinkTypes();
    if (!linkTypes.some((l) => l.name === JIRA_LINK_TYPE)) {
      throw new Error(`Link type "${JIRA_LINK_TYPE}" not found. Available: ${linkTypes.map((l) => l.name).join(", ")}`);
    }
    this.log(`✓ Link type ${JIRA_LINK_TYPE}`);
    return { issueTypeId: type.id, user: me.displayName };
  }

  /** Existing imported issues in scope, keyed by source ID. */
  async discover(): Promise<Map<string, JiraIssue>> {
    const issues = await this.jira.searchAll(scopedJql(this.opts.projectKey, this.scope), SEARCH_FIELDS);
    const bySource = new Map<string, JiraIssue>();
    for (const issue of issues) {
      const sid = sourceIdFromLabels(issue.fields.labels);
      if (!sid) continue;
      if (bySource.has(sid)) {
        throw new Error(
          `Two Jira issues carry src-${sid} (${bySource.get(sid)!.key}, ${issue.key}). Resolve the duplicate before importing.`,
        );
      }
      bySource.set(sid, issue);
    }
    return bySource;
  }

  async run(): Promise<ImportReport> {
    const started = Date.now();
    const report: ImportReport = {
      projectKey: this.opts.projectKey,
      scopeLabel: this.scope,
      dryRun: !!this.opts.dryRun,
      startedAt: new Date(started).toISOString(),
      durationMs: 0,
      records: this.dataset.records.length,
      issues: { created: 0, existing: 0, failed: 0 },
      comments: { created: 0, existing: 0, failed: 0, expected: 0 },
      links: { created: 0, existing: 0, failed: 0, expected: 0 },
      statuses: { transitioned: 0, alreadyCorrect: 0, unmatched: 0 },
      warnings: [],
      errors: [],
      map: {},
    };
    const records = this.dataset.records;
    const knownIds = new Set(records.map((r) => r.source_id));
    report.comments.expected = records.reduce((n, r) => n + r.comments.length, 0);

    const { issueTypeId } = await this.preflight();
    let existing = await this.discover();
    report.issues.existing = existing.size;
    this.log(`Found ${existing.size} already-imported issues in scope`);

    // ── 1. Issues ────────────────────────────────────────────────────────
    const missing = records.filter((r) => !existing.has(r.source_id));
    if (this.opts.dryRun) {
      this.log(`[dry-run] would create ${missing.length} issues`);
    } else {
      for (let i = 0; i < missing.length; i += JIRA_LIMITS.bulkCreate) {
        const batch = missing.slice(i, i + JIRA_LIMITS.bulkCreate);
        const payload = batch.map((r) => ({
          fields: {
            project: { key: this.opts.projectKey },
            issuetype: { id: issueTypeId },
            summary: summaryFor(r),
            description: textToAdf(
              descriptionFor(
                r,
                this.scope,
                r.links.filter((l) => !knownIds.has(l)),
              ),
            ),
            labels: labelsFor(r, this.scope),
          },
        }));
        const result = await this.jira.bulkCreate(payload);
        report.issues.created += result.created.filter(Boolean).length;
        for (const e of result.errors) {
          report.issues.failed++;
          report.errors.push(`Create ${batch[e.index]?.source_id}: ${e.message}`);
        }
        this.log(`Created issues ${i + 1}-${i + batch.length} of ${missing.length}`);
      }
      // Re-read from Jira so later steps work from the source of truth.
      existing = await this.discover();
    }
    for (const [sid, issue] of existing) report.map[sid] = issue.key;

    // ── 2. Comments (strict order within an issue, parallel across issues) ──
    const limit = pLimit(this.opts.concurrency ?? 4);
    await Promise.all(
      records.map((r) =>
        limit(async () => {
          const issue = existing.get(r.source_id);
          if (!issue) {
            if (!this.opts.dryRun) report.errors.push(`Comments skipped for ${r.source_id}: issue missing`);
            return;
          }
          await this.importComments(r, issue.key, report);
        }),
      ),
    );
    this.log(`Comments: ${report.comments.created} created, ${report.comments.existing} already present`);

    // ── 3. Links ─────────────────────────────────────────────────────────
    const existingPairs = new Set<string>();
    for (const issue of existing.values()) {
      for (const link of issue.fields.issuelinks ?? []) {
        if (link.type.name !== JIRA_LINK_TYPE) continue;
        const other = link.inwardIssue?.key ?? link.outwardIssue?.key;
        if (other) existingPairs.add(pairKey(issue.key, other));
      }
    }
    const wantedPairs = new Map<string, [string, string]>();
    for (const r of records) {
      for (const target of r.links) {
        if (!knownIds.has(target)) {
          report.warnings.push(
            `${r.source_id} links to ${target}, which is not in the dataset (recorded in description)`,
          );
          continue;
        }
        const a = existing.get(r.source_id)?.key;
        const b = existing.get(target)?.key;
        if (!a || !b) continue;
        wantedPairs.set(pairKey(a, b), [a, b]);
      }
    }
    report.links.expected = wantedPairs.size;
    for (const [key, [from, to]] of wantedPairs) {
      if (existingPairs.has(key)) {
        report.links.existing++;
        continue;
      }
      if (this.opts.dryRun) continue;
      try {
        await this.jira.createLink(JIRA_LINK_TYPE, from, to);
        report.links.created++;
      } catch (e) {
        report.links.failed++;
        report.errors.push(`Link ${from} → ${to}: ${(e as Error).message}`);
      }
    }
    this.log(`Links: ${report.links.created} created, ${report.links.existing} already present`);

    // ── 4. Statuses ──────────────────────────────────────────────────────
    const transitionCache = new Map<string, JiraTransition[]>();
    for (const r of records) {
      const issue = existing.get(r.source_id);
      if (!issue) continue;
      const current = issue.fields.status?.name ?? "";
      if (current.toLowerCase() === r.recorded_status.toLowerCase()) {
        report.statuses.alreadyCorrect++;
        continue;
      }
      if (this.opts.dryRun) continue;
      try {
        let transitions = transitionCache.get(current);
        if (!transitions) {
          transitions = await this.jira.getTransitions(issue.key);
          transitionCache.set(current, transitions);
        }
        const t = transitions.find((x) => x.to.name.toLowerCase() === r.recorded_status.toLowerCase());
        if (!t) {
          report.statuses.unmatched++;
          report.warnings.push(
            `${issue.key} (${r.source_id}): no transition from "${current}" to "${r.recorded_status}"; recorded status kept in description`,
          );
          continue;
        }
        await this.jira.transition(issue.key, t.id);
        report.statuses.transitioned++;
      } catch (e) {
        report.errors.push(`Status ${issue.key}: ${(e as Error).message}`);
      }
    }
    this.log(
      `Statuses: ${report.statuses.transitioned} transitioned, ${report.statuses.alreadyCorrect} already correct, ${report.statuses.unmatched} unmatched`,
    );

    report.durationMs = Date.now() - started;
    this.trace.emit({ type: TRACE_EVENTS.importComplete, durationMs: report.durationMs, errors: report.errors.length });
    return report;
  }

  /** Adds missing comments for one issue, strictly in source order. */
  private async importComments(r: SourceRecord, key: string, report: ImportReport): Promise<void> {
    const total = r.comments.length;
    if (total === 0) return;
    const present = new Set<number>();
    for (const c of await this.jira.getComments(key)) {
      const parsed = parseImportedComment(adfToText(c.body));
      if (parsed && parsed.sourceId === r.source_id) present.add(parsed.index);
    }
    report.comments.existing += present.size;
    const missing = r.comments.map((_, i) => i + 1).filter((n) => !present.has(n));
    if (missing.length === 0) return;
    const maxPresent = Math.max(0, ...present);
    if (missing[0]! < maxPresent) {
      report.warnings.push(
        `${key} (${r.source_id}): comment ${missing[0]} missing before already-present ${maxPresent}; Jira order will differ from source order (the n/N header still preserves it)`,
      );
    }
    if (this.opts.dryRun) return;
    for (const n of missing) {
      try {
        await this.jira.addComment(key, textToAdf(commentBodyFor(r.source_id, n, total, r.comments[n - 1]!)));
        report.comments.created++;
      } catch (e) {
        report.comments.failed++;
        report.errors.push(`Comment ${n}/${total} on ${key} (${r.source_id}): ${(e as Error).message}`);
        // Stop this issue so later comments don't land out of order; a rerun resumes here.
        if (e instanceof JiraError) return;
        throw e;
      }
    }
  }
}

const pairKey = (a: string, b: string): string => {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};
