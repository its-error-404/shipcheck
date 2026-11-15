/**
 * Scoped, cached, read-only view of Jira for the agent's tools.
 *
 * - Built on JiraReader only (no write path).
 * - Loads the set of in-scope issues once; anything outside the scope label
 *   is invisible (links to it are hidden, lookups fail).
 * - Caches issues and comments for the run so several investigations that
 *   open the same ticket don't refetch it.
 */
import { adfToText } from "../jira/adf";
import type { JiraIssue, JiraReader } from "../jira/client";
import { scopedJql } from "../jira/jql";
import { parseDescription, parseImportedComment, sourceIdFromLabels } from "../import/mapping";
import { parseRecordedHeader } from "./parse";

export interface ScopeEntry {
  key: string;
  sourceId?: string;
  kind?: string;
  release?: string;
  summary: string;
  status?: string;
}

export interface IssueView extends ScopeEntry {
  recordedStatus?: string;
  description: string;
  declaredLinks: string[];
  links: { key: string; sourceId?: string; summary: string; direction: "outgoing" | "incoming" }[];
  hiddenLinks: number;
}

export interface CommentView {
  id: string;
  position?: number;
  total?: number;
  recordedAt?: string;
  actor?: string;
  role?: string;
  body: string;
}

const labelValue = (labels: string[] | undefined, prefix: string) =>
  labels?.find((l) => l.startsWith(prefix))?.slice(prefix.length);

export class ScopedJiraView {
  private scope?: Map<string, ScopeEntry>;
  private bySource = new Map<string, string>();
  private issueCache = new Map<string, Promise<IssueView>>();
  private commentCache = new Map<string, Promise<CommentView[]>>();

  constructor(
    readonly jira: JiraReader,
    readonly projectKey: string,
    readonly scopeLabel: string,
  ) {}

  jql(inner?: string): string {
    return scopedJql(this.projectKey, this.scopeLabel, inner);
  }

  /** One paged search of the whole scope (keys + labels + summary). */
  async loadScope(): Promise<Map<string, ScopeEntry>> {
    if (this.scope) return this.scope;
    const issues = await this.jira.searchAll(this.jql(), ["summary", "labels", "status"]);
    const scope = new Map<string, ScopeEntry>();
    for (const i of issues) {
      const entry = this.entryFrom(i);
      scope.set(i.key, entry);
      if (entry.sourceId) this.bySource.set(entry.sourceId.toUpperCase(), i.key);
    }
    this.scope = scope;
    return scope;
  }

  entryFrom(i: JiraIssue): ScopeEntry {
    return {
      key: i.key,
      sourceId: sourceIdFromLabels(i.fields.labels),
      kind: labelValue(i.fields.labels, "kind-"),
      release: labelValue(i.fields.labels, "rel-"),
      summary: i.fields.summary ?? "",
      status: i.fields.status?.name,
    };
  }

  /** Resolves a Jira key or a source ID (REC-1234 / REQ-08) to an in-scope Jira key. */
  async resolve(keyOrSourceId: string): Promise<string | undefined> {
    const scope = await this.loadScope();
    const k = keyOrSourceId.trim().toUpperCase();
    if (scope.has(k)) return k;
    return this.bySource.get(k);
  }

  async inScope(key: string): Promise<ScopeEntry | undefined> {
    return (await this.loadScope()).get(key);
  }

  async search(inner: string | undefined, limit: number): Promise<ScopeEntry[]> {
    const out: ScopeEntry[] = [];
    for await (const i of this.jira.searchJql(this.jql(inner), ["summary", "labels", "status"], Math.min(limit, 100))) {
      out.push(this.entryFrom(i));
      if (out.length >= limit) break;
    }
    return out;
  }

  getIssue(key: string): Promise<IssueView> {
    let p = this.issueCache.get(key);
    if (!p) {
      p = this.fetchIssue(key);
      this.issueCache.set(key, p);
      p.catch(() => this.issueCache.delete(key));
    }
    return p;
  }

  private async fetchIssue(key: string): Promise<IssueView> {
    const scope = await this.loadScope();
    const i = await this.jira.getIssue(key, ["summary", "labels", "status", "description", "issuelinks"]);
    const base = this.entryFrom(i);
    const desc = parseDescription(adfToText(i.fields.description));
    const declared = new Set(desc.declaredLinks.map((s) => s.toUpperCase()));
    const links: IssueView["links"] = [];
    const seen = new Set<string>();
    let hidden = 0;
    for (const l of i.fields.issuelinks ?? []) {
      const other = l.inwardIssue ?? l.outwardIssue;
      if (!other || seen.has(other.key)) continue;
      seen.add(other.key);
      const entry = scope.get(other.key);
      if (!entry) {
        hidden++;
        continue;
      }
      links.push({
        key: other.key,
        sourceId: entry.sourceId,
        summary: entry.summary,
        direction: entry.sourceId && declared.has(entry.sourceId.toUpperCase()) ? "outgoing" : "incoming",
      });
    }
    links.sort((a, b) => (a.direction === b.direction ? 0 : a.direction === "outgoing" ? -1 : 1));
    return {
      ...base,
      recordedStatus: desc.meta["Recorded status"],
      description: desc.original,
      declaredLinks: desc.declaredLinks,
      links,
      hiddenLinks: hidden,
    };
  }

  getComments(key: string): Promise<CommentView[]> {
    let p = this.commentCache.get(key);
    if (!p) {
      p = this.jira.getComments(key).then((cs) =>
        cs.map((c) => {
          const text = adfToText(c.body);
          const imported = parseImportedComment(text);
          const header = parseRecordedHeader(imported?.original ?? text);
          return {
            id: c.id,
            position: imported?.index,
            total: imported?.total,
            recordedAt: header.recordedAt,
            actor: header.actor,
            role: header.role,
            body: header.body,
          };
        }),
      );
      this.commentCache.set(key, p);
      p.catch(() => this.commentCache.delete(key));
    }
    return p;
  }
}
