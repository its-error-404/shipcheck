import type { AxiosInstance } from "axios";
import type { AdfDoc } from "./adf";
import { JiraNotFoundError } from "./errors";

/** The subset of Jira's issue shape we rely on. */
export interface JiraIssueLink {
  id: string;
  type: { name: string; inward?: string; outward?: string };
  inwardIssue?: { key: string; fields?: { summary?: string } };
  outwardIssue?: { key: string; fields?: { summary?: string } };
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    labels?: string[];
    status?: { name: string };
    issuelinks?: JiraIssueLink[];
    [field: string]: unknown;
  };
}

export interface JiraComment {
  id: string;
  body: unknown;
  created?: string;
  author?: { displayName?: string };
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

export interface BulkCreateResult {
  /** Created issues, aligned to input positions (undefined where Jira rejected the element). */
  created: ({ id: string; key: string } | undefined)[];
  errors: { index: number; message: string }[];
}

/**
 * Read-only Jira access. The agent's tools are constructed with a JiraReader,
 * so they cannot call a write method: this is enforced at compile time (ADR-009).
 */
export class JiraReader {
  constructor(protected readonly http: AxiosInstance) {}

  async myself(): Promise<{ accountId: string; displayName: string; emailAddress?: string }> {
    return (await this.http.get("/rest/api/3/myself")).data;
  }

  async getProject(key: string): Promise<{ id: string; key: string; name: string }> {
    return (await this.http.get(`/rest/api/3/project/${encodeURIComponent(key)}`)).data;
  }

  /** Projects visible to the current user (used to give helpful errors). */
  async listProjects(): Promise<{ key: string; name: string }[]> {
    const data = (await this.http.get("/rest/api/3/project/search", { params: { maxResults: 50 } })).data;
    return (data.values ?? []).map((p: { key: string; name: string }) => ({ key: p.key, name: p.name }));
  }

  /** getProject, but a 404 explains which project keys do exist. */
  async getProjectOrExplain(key: string): Promise<{ id: string; key: string; name: string }> {
    try {
      return await this.getProject(key);
    } catch (e) {
      if (!(e instanceof JiraNotFoundError)) throw e;
      const projects = await this.listProjects().catch(() => []);
      const list = projects.length ? projects.map((p) => `${p.key} ("${p.name}")`).join(", ") : "none visible to this account";
      throw new JiraNotFoundError(
        `Project "${key}" not found. Projects you can access: ${list}. Set JIRA_PROJECT_KEY in .env to the right key (shown in the project URL / Project settings).`,
        404,
      );
    }
  }

  async getIssueTypes(projectKey: string): Promise<{ id: string; name: string }[]> {
    const data = (
      await this.http.get(`/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`, {
        params: { maxResults: 100 },
      })
    ).data;
    return data.issueTypes ?? data.values ?? [];
  }

  async getCreateFields(projectKey: string, issueTypeId: string): Promise<string[]> {
    const data = (
      await this.http.get(
        `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`,
        { params: { maxResults: 200 } },
      )
    ).data;
    const fields: { fieldId?: string; key?: string }[] = data.fields ?? data.values ?? [];
    return fields.map((f) => f.fieldId ?? f.key ?? "").filter(Boolean);
  }

  async getLinkTypes(): Promise<{ id: string; name: string; inward: string; outward: string }[]> {
    return (await this.http.get("/rest/api/3/issueLinkType")).data.issueLinkTypes ?? [];
  }

  /**
   * Enhanced JQL search (POST /rest/api/3/search/jql). The legacy /search
   * endpoint was retired by Atlassian; this one pages with nextPageToken.
   * Exposed as an async generator so callers never handle paging.
   */
  async *searchJql(jql: string, fields: string[], pageSize = 100): AsyncGenerator<JiraIssue> {
    let nextPageToken: string | undefined;
    do {
      const data = (
        await this.http.post(
          "/rest/api/3/search/jql",
          { jql, fields, maxResults: pageSize, ...(nextPageToken ? { nextPageToken } : {}) },
          { idempotent: true },
        )
      ).data as { issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean };
      for (const issue of data.issues ?? []) yield issue;
      nextPageToken = data.isLast === false || (data.isLast === undefined && data.nextPageToken) ? data.nextPageToken : undefined;
    } while (nextPageToken);
  }

  async searchAll(jql: string, fields: string[]): Promise<JiraIssue[]> {
    const out: JiraIssue[] = [];
    for await (const issue of this.searchJql(jql, fields)) out.push(issue);
    return out;
  }

  async getIssue(key: string, fields: string[]): Promise<JiraIssue> {
    return (
      await this.http.get(`/rest/api/3/issue/${encodeURIComponent(key)}`, {
        params: { fields: fields.join(",") },
      })
    ).data;
  }

  /** All comments of an issue, oldest first (Jira creation order). */
  async getComments(key: string): Promise<JiraComment[]> {
    const out: JiraComment[] = [];
    let startAt = 0;
    for (;;) {
      const data = (
        await this.http.get(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
          params: { startAt, maxResults: 100, orderBy: "created" },
        })
      ).data as { comments: JiraComment[]; total: number };
      out.push(...data.comments);
      startAt += data.comments.length;
      if (data.comments.length === 0 || startAt >= data.total) return out;
    }
  }

  async getTransitions(key: string): Promise<JiraTransition[]> {
    return (await this.http.get(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`)).data.transitions ?? [];
  }
}

/** Read + write access. Only the importer receives this. */
export class JiraWriter extends JiraReader {
  /** POST /rest/api/3/issue/bulk (max 50 per call). */
  async bulkCreate(issues: { fields: Record<string, unknown> }[]): Promise<BulkCreateResult> {
    if (issues.length > 50) throw new Error("bulkCreate accepts at most 50 issues per call");
    const data = (await this.http.post("/rest/api/3/issue/bulk", { issueUpdates: issues })).data as {
      issues?: { id: string; key: string }[];
      errors?: { failedElementNumber: number; elementErrors?: { errorMessages?: string[]; errors?: Record<string, string> } }[];
    };
    const failed = new Map<number, string>();
    for (const e of data.errors ?? []) {
      const msgs = [
        ...(e.elementErrors?.errorMessages ?? []),
        ...Object.entries(e.elementErrors?.errors ?? {}).map(([k, v]) => `${k}: ${v}`),
      ];
      failed.set(e.failedElementNumber, msgs.join("; ") || "rejected");
    }
    // Jira returns successful issues in input order, skipping failed elements.
    const createdQueue = [...(data.issues ?? [])];
    const created = issues.map((_, i) => (failed.has(i) ? undefined : createdQueue.shift()));
    return { created, errors: [...failed].map(([index, message]) => ({ index, message })) };
  }

  async addComment(key: string, body: AdfDoc): Promise<{ id: string }> {
    return (await this.http.post(`/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body })).data;
  }

  /** Creates a link. For "Relates" the semantics are symmetric; direction is kept in the description. */
  async createLink(typeName: string, outwardKey: string, inwardKey: string): Promise<void> {
    await this.http.post("/rest/api/3/issueLink", {
      type: { name: typeName },
      outwardIssue: { key: outwardKey },
      inwardIssue: { key: inwardKey },
    });
  }

  async transition(key: string, transitionId: string): Promise<void> {
    await this.http.post(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      transition: { id: transitionId },
    });
  }
}
