/**
 * verify-import: reads the whole scope back from Jira and diffs it against the
 * dataset. Proves "source identifiers, relationships and recorded evidence"
 * were preserved. Read-only.
 */
import pLimit from "p-limit";
import { adfToText } from "../jira/adf";
import type { JiraReader } from "../jira/client";
import { scopedJql } from "../jira/jql";
import type { Dataset } from "./dataset";
import {
  LINK_TYPE,
  descriptionFor,
  labelsFor,
  parseImportedComment,
  sourceIdFromLabels,
  summaryFor,
} from "./mapping";

export interface VerifyReport {
  ok: boolean;
  checkedAt: string;
  projectKey: string;
  scopeLabel: string;
  counts: {
    expectedIssues: number;
    foundIssues: number;
    expectedComments: number;
    matchingComments: number;
    expectedLinks: number;
    foundLinks: number;
    statusMatches: number;
  };
  mismatches: string[];
}

export async function verifyImport(
  jira: JiraReader,
  dataset: Dataset,
  projectKey: string,
  scopeLabel = dataset.dataset_label,
  concurrency = 4,
): Promise<VerifyReport> {
  const mismatches: string[] = [];
  const issues = await jira.searchAll(scopedJql(projectKey, scopeLabel), [
    "summary",
    "labels",
    "status",
    "issuelinks",
    "description",
  ]);
  const bySource = new Map(issues.map((i) => [sourceIdFromLabels(i.fields.labels) ?? `?${i.key}`, i]));
  const known = new Set(dataset.records.map((r) => r.source_id));

  for (const sid of bySource.keys()) {
    if (!known.has(sid)) mismatches.push(`Issue ${bySource.get(sid)!.key} (${sid}) is in scope but not in the dataset`);
  }

  let matchingComments = 0;
  let statusMatches = 0;
  const limit = pLimit(concurrency);
  await Promise.all(
    dataset.records.map((r) =>
      limit(async () => {
        const issue = bySource.get(r.source_id);
        if (!issue) {
          mismatches.push(`${r.source_id}: no Jira issue`);
          return;
        }
        const f = issue.fields;
        if (f.summary !== summaryFor(r)) mismatches.push(`${issue.key}: summary differs`);
        const wantLabels = labelsFor(r, scopeLabel).sort();
        const haveLabels = [...(f.labels ?? [])].sort();
        for (const l of wantLabels) if (!haveLabels.includes(l)) mismatches.push(`${issue.key}: missing label ${l}`);
        const unresolved = r.links.filter((l) => !known.has(l));
        if (adfToText(f.description) !== descriptionFor(r, scopeLabel, unresolved))
          mismatches.push(`${issue.key}: description differs from source`);
        if ((f.status?.name ?? "").toLowerCase() === r.recorded_status.toLowerCase()) statusMatches++;
        else mismatches.push(`${issue.key}: status "${f.status?.name}" ≠ recorded "${r.recorded_status}"`);

        const comments = await jira.getComments(issue.key);
        const parsed = comments.map((c) => parseImportedComment(adfToText(c.body)));
        if (comments.length !== r.comments.length)
          mismatches.push(`${issue.key}: ${comments.length} comments, expected ${r.comments.length}`);
        r.comments.forEach((original, i) => {
          const p = parsed.find((x) => x?.sourceId === r.source_id && x.index === i + 1);
          if (!p) mismatches.push(`${issue.key}: comment ${i + 1}/${r.comments.length} missing`);
          else if (p.original !== original) mismatches.push(`${issue.key}: comment ${i + 1} text differs from source`);
          else matchingComments++;
        });
        // Jira order should equal source order.
        const order = parsed.map((p) => p?.index ?? -1);
        if (order.some((v, i) => v !== i + 1)) mismatches.push(`${issue.key}: comment order differs from source order`);
      }),
    ),
  );

  // Links (unordered pairs, Relates)
  const keyOf = (sid: string) => bySource.get(sid)?.key;
  const found = new Set<string>();
  for (const issue of issues) {
    for (const link of issue.fields.issuelinks ?? []) {
      if (link.type.name !== LINK_TYPE) continue;
      const other = link.inwardIssue?.key ?? link.outwardIssue?.key;
      if (other) found.add([issue.key, other].sort().join("|"));
    }
  }
  const expected = new Set<string>();
  for (const r of dataset.records) {
    for (const t of r.links) {
      const a = keyOf(r.source_id);
      const b = keyOf(t);
      if (a && b) expected.add([a, b].sort().join("|"));
    }
  }
  let foundLinks = 0;
  for (const pair of expected) {
    if (found.has(pair)) foundLinks++;
    else mismatches.push(`Missing link ${pair.replace("|", " ↔ ")}`);
  }

  const expectedComments = dataset.records.reduce((n, r) => n + r.comments.length, 0);
  return {
    ok: mismatches.length === 0,
    checkedAt: new Date().toISOString(),
    projectKey,
    scopeLabel,
    counts: {
      expectedIssues: dataset.records.length,
      foundIssues: bySource.size,
      expectedComments,
      matchingComments,
      expectedLinks: expected.size,
      foundLinks,
      statusMatches,
    },
    mismatches,
  };
}
