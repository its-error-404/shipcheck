/**
 * Source record → Jira representation (docs/04-data-mapping.md).
 * Pure functions: no I/O, fully unit-tested.
 */
import type { SourceRecord } from "./dataset";

export const LINK_TYPE = "Relates";
export const JIRA_COMMENT_LIMIT = 32_767;
export const JIRA_SUMMARY_LIMIT = 255;

const META_START = "── Source record (imported) ──";
const META_END = "── Original description ──";

/** Labels cannot contain whitespace; source IDs and releases are already safe. */
export function sanitizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

export const srcLabel = (sourceId: string) => `src-${sanitizeLabel(sourceId)}`;
export const kindLabel = (kind: string) => `kind-${sanitizeLabel(kind)}`;
export const releaseLabel = (release: string) => `rel-${sanitizeLabel(release)}`;

export function labelsFor(record: SourceRecord, datasetLabel: string): string[] {
  const labels = [datasetLabel, srcLabel(record.source_id), kindLabel(record.kind), releaseLabel(record.release)];
  // The manifest's own text states requirement records carry this label.
  if (record.kind === "requirement") labels.push("rr-requirement");
  return labels.map(sanitizeLabel);
}

export function summaryFor(record: SourceRecord): string {
  const summary = `[${record.source_id}] ${record.summary}`;
  if (summary.length > JIRA_SUMMARY_LIMIT) {
    throw new Error(`Summary for ${record.source_id} exceeds ${JIRA_SUMMARY_LIMIT} characters; refusing to truncate`);
  }
  return summary;
}

export function descriptionFor(record: SourceRecord, datasetLabel: string, unresolvedLinks: string[] = []): string {
  const lines = [
    META_START,
    `Source ID: ${record.source_id}`,
    `Kind: ${record.kind}`,
    `Release: ${record.release}`,
    `Recorded status: ${record.recorded_status}`,
    `Dataset: ${datasetLabel}`,
    `Source links (declared by this record): ${record.links.length ? record.links.join(", ") : "none"}`,
  ];
  if (unresolvedLinks.length) lines.push(`Unresolved source links (not in dataset): ${unresolvedLinks.join(", ")}`);
  lines.push(META_END, record.description);
  return lines.join("\n");
}

export function commentHeader(sourceId: string, index: number, total: number): string {
  return `[Source comment ${index}/${total} · ${sourceId}]`;
}

export function commentBodyFor(sourceId: string, index: number, total: number, original: string): string {
  const body = `${commentHeader(sourceId, index, total)}\n${original}`;
  if (body.length > JIRA_COMMENT_LIMIT) {
    throw new Error(`Comment ${index}/${total} of ${sourceId} exceeds Jira's ${JIRA_COMMENT_LIMIT}-character limit`);
  }
  return body;
}

const HEADER_RE = /^\[Source comment (\d+)\/(\d+) · ([^\]]+)\]\n?/;

/** Splits an imported comment into its header fields and the verbatim original text. */
export function parseImportedComment(text: string):
  | { index: number; total: number; sourceId: string; original: string }
  | undefined {
  const m = HEADER_RE.exec(text);
  if (!m) return undefined;
  return { index: Number(m[1]), total: Number(m[2]), sourceId: m[3]!, original: text.slice(m[0].length) };
}

/** Extracts the importer metadata block and original description from an issue description. */
export function parseDescription(text: string): {
  meta: Record<string, string>;
  declaredLinks: string[];
  original: string;
} {
  const start = text.indexOf(META_START);
  const end = text.indexOf(META_END);
  if (start === -1 || end === -1) return { meta: {}, declaredLinks: [], original: text };
  const meta: Record<string, string> = {};
  for (const line of text.slice(start + META_START.length, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const declared = meta["Source links (declared by this record)"] ?? "none";
  const declaredLinks = declared === "none" ? [] : declared.split(",").map((s) => s.trim()).filter(Boolean);
  return { meta, declaredLinks, original: text.slice(end + META_END.length).replace(/^\n/, "") };
}

/** Recovers the source ID from a Jira issue's labels. */
export function sourceIdFromLabels(labels: string[] | undefined): string | undefined {
  const l = labels?.find((x) => x.startsWith("src-"));
  return l?.slice(4);
}
