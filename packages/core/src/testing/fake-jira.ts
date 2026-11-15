/**
 * In-memory fake of the Jira Cloud REST v3 endpoints we use.
 *
 * It plugs in as an axios adapter, so tests exercise the *real* client code,
 * interceptors, retry policy and JSON shapes, with no network. It supports a
 * small JQL subset (AND/OR/NOT, parentheses, =, !=, in, ~ on project, labels,
 * key, summary, text, status) and fault injection for retry tests.
 */
import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

interface FakeIssue {
  id: string;
  key: string;
  summary: string;
  description: unknown;
  labels: string[];
  status: string;
  comments: { id: string; body: unknown; created: string }[];
}

interface FakeLink {
  id: string;
  type: string;
  outward: string;
  inward: string;
}

interface Fault {
  match: (method: string, path: string) => boolean;
  status: number;
  times: number;
  headers?: Record<string, string>;
  /** Apply the request's side effect before failing (simulates "timed out after Jira saved it"). */
  applyThenFail?: boolean;
}

const STATUSES = ["To Do", "In Progress", "Done"];
const LINK_TYPES = [
  { id: "10000", name: "Blocks", inward: "is blocked by", outward: "blocks" },
  { id: "10003", name: "Relates", inward: "relates to", outward: "relates to" },
];

export class FakeJira {
  readonly issues = new Map<string, FakeIssue>();
  readonly links: FakeLink[] = [];
  readonly requests: { method: string; path: string }[] = [];
  private faults: Fault[] = [];
  private seq = 10000;
  private commentSeq = 50000;
  private clock = Date.parse("2026-11-15T00:00:00Z");

  constructor(readonly projectKey = "TYN") {}

  /** Inject failures for matching requests. */
  fail(fault: Fault): void {
    this.faults.push(fault);
  }

  /** Seed an issue directly (e.g. an unrelated ticket outside the scope). */
  seedIssue(summary: string, labels: string[], status = "To Do"): FakeIssue {
    const id = String(++this.seq);
    const issue: FakeIssue = {
      id,
      key: `${this.projectKey}-${this.issues.size + 1}`,
      summary,
      description: null,
      labels,
      status,
      comments: [],
    };
    this.issues.set(issue.key, issue);
    return issue;
  }

  readonly adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const method = (config.method ?? "get").toUpperCase();
    const url = new URL((config.baseURL ?? "") + (config.url ?? ""), "https://fake.atlassian.net");
    for (const [k, v] of Object.entries(config.params ?? {})) url.searchParams.set(k, String(v));
    const path = url.pathname;
    this.requests.push({ method, path });
    const body = typeof config.data === "string" && config.data ? JSON.parse(config.data) : config.data;

    const fault = this.faults.find((f) => f.times > 0 && f.match(method, path));
    if (fault) {
      fault.times--;
      if (fault.applyThenFail) {
        this.route(method, path, url.searchParams, body);
        throw new AxiosError("timeout of 30000ms exceeded", "ECONNABORTED", config);
      }
      if (fault.status === 0) throw new AxiosError("socket hang up", "ECONNRESET", config);
      return this.respond(config, fault.status, { errorMessages: ["injected fault"] }, fault.headers);
    }

    const { status, data } = this.route(method, path, url.searchParams, body);
    return this.respond(config, status, data);
  };

  private respond(
    config: InternalAxiosRequestConfig,
    status: number,
    data: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = {
      data,
      status,
      statusText: String(status),
      headers: new AxiosHeaders(headers),
      config,
      request: {},
    };
    if (status >= 200 && status < 300) return response;
    throw new AxiosError(
      `Request failed with status code ${status}`,
      AxiosError.ERR_BAD_RESPONSE,
      config,
      {},
      response,
    );
  }

  route(method: string, path: string, q: URLSearchParams, body: any): { status: number; data: unknown } {
    let m: RegExpExecArray | null;
    const p = path.replace(/^\/rest\/api\/3/, "");

    if (method === "GET" && p === "/myself") return ok({ accountId: "fake-1", displayName: "Fake Importer" });
    if (method === "GET" && p === "/project/search")
      return ok({ values: [{ key: this.projectKey, name: "Fake project" }] });
    if (method === "GET" && (m = /^\/project\/([^/]+)$/.exec(p)))
      return m[1] === this.projectKey ? ok({ id: "1", key: this.projectKey, name: "Fake project" }) : notFound();
    if (method === "GET" && /^\/issue\/createmeta\/[^/]+\/issuetypes$/.test(p))
      return ok({
        issueTypes: [
          { id: "10001", name: "Task" },
          { id: "10002", name: "Bug" },
        ],
      });
    if (method === "GET" && /^\/issue\/createmeta\/[^/]+\/issuetypes\/[^/]+$/.test(p))
      return ok({
        fields: ["summary", "description", "labels", "issuetype", "project"].map((fieldId) => ({ fieldId })),
      });
    if (method === "GET" && p === "/issueLinkType") return ok({ issueLinkTypes: LINK_TYPES });

    if (method === "POST" && p === "/issue/bulk") return this.bulkCreate(body);
    if (method === "POST" && p === "/search/jql") return this.search(body);
    if (method === "POST" && p === "/issueLink") return this.createLink(body);

    if ((m = /^\/issue\/([^/]+)\/comment$/.exec(p))) {
      const issue = this.issues.get(decodeURIComponent(m[1]!));
      if (!issue) return notFound();
      if (method === "GET") {
        const startAt = Number(q.get("startAt") ?? 0);
        const max = Number(q.get("maxResults") ?? 50);
        return ok({
          comments: issue.comments.slice(startAt, startAt + max),
          total: issue.comments.length,
          startAt,
          maxResults: max,
        });
      }
      if (method === "POST") {
        const c = {
          id: String(++this.commentSeq),
          body: body.body,
          created: new Date((this.clock += 1000)).toISOString(),
        };
        issue.comments.push(c);
        return { status: 201, data: c };
      }
    }
    if ((m = /^\/issue\/([^/]+)\/transitions$/.exec(p))) {
      const issue = this.issues.get(decodeURIComponent(m[1]!));
      if (!issue) return notFound();
      if (method === "GET")
        return ok({
          transitions: STATUSES.filter((s) => s !== issue.status).map((s) => ({
            id: String(11 + STATUSES.indexOf(s) * 10),
            name: s,
            to: { name: s },
          })),
        });
      if (method === "POST") {
        const target = STATUSES[(Number(body.transition.id) - 11) / 10];
        if (!target) return bad("invalid transition");
        issue.status = target;
        return { status: 204, data: "" };
      }
    }
    if (method === "GET" && (m = /^\/issue\/([^/]+)$/.exec(p))) {
      const issue = this.issues.get(decodeURIComponent(m[1]!));
      if (!issue) return notFound();
      return ok(this.view(issue, (q.get("fields") ?? "").split(",").filter(Boolean)));
    }
    return notFound();
  }

  private bulkCreate(body: { issueUpdates: { fields: any }[] }) {
    const issues: { id: string; key: string }[] = [];
    const errors: unknown[] = [];
    body.issueUpdates.forEach((u, i) => {
      const f = u.fields;
      const badLabel = (f.labels ?? []).find((l: string) => /\s/.test(l));
      if (!f.summary || badLabel) {
        errors.push({
          failedElementNumber: i,
          elementErrors: { errors: badLabel ? { labels: "no spaces" } : { summary: "required" } },
        });
        return;
      }
      const issue = this.seedIssue(f.summary, f.labels ?? []);
      issue.description = f.description ?? null;
      issues.push({ id: issue.id, key: issue.key });
    });
    return { status: 201, data: { issues, errors } };
  }

  private createLink(body: any) {
    const outward = body.outwardIssue?.key;
    const inward = body.inwardIssue?.key;
    if (!this.issues.has(outward) || !this.issues.has(inward)) return notFound();
    this.links.push({ id: String(++this.seq), type: body.type.name, outward, inward });
    return { status: 201, data: "" };
  }

  private search(body: { jql: string; fields?: string[]; maxResults?: number; nextPageToken?: string }) {
    const pred = parseJql(body.jql);
    const all = [...this.issues.values()].filter((i) => pred(i, this)).sort((a, b) => Number(a.id) - Number(b.id));
    const start = body.nextPageToken ? Number(body.nextPageToken) : 0;
    const size = Math.min(body.maxResults ?? 50, 100);
    const page = all.slice(start, start + size);
    const isLast = start + size >= all.length;
    return ok({
      issues: page.map((i) => this.view(i, body.fields ?? [])),
      isLast,
      ...(isLast ? {} : { nextPageToken: String(start + size) }),
    });
  }

  /** Text of an issue for `text ~` matching. */
  searchableText(issue: FakeIssue): string {
    const adf = (d: unknown): string => JSON.stringify(d ?? "");
    return [issue.summary, adf(issue.description), ...issue.comments.map((c) => adf(c.body))].join(" ").toLowerCase();
  }

  private view(issue: FakeIssue, fields: string[]) {
    const all = fields.length === 0 || fields.includes("*all");
    const want = (f: string) => all || fields.includes(f);
    const out: Record<string, unknown> = {};
    if (want("summary")) out.summary = issue.summary;
    if (want("description")) out.description = issue.description;
    if (want("labels")) out.labels = issue.labels;
    if (want("status")) out.status = { name: issue.status };
    if (want("issuelinks"))
      out.issuelinks = this.links
        .filter((l) => l.outward === issue.key || l.inward === issue.key)
        .map((l) => {
          const type = LINK_TYPES.find((t) => t.name === l.type)!;
          const otherKey = l.outward === issue.key ? l.inward : l.outward;
          const other = { key: otherKey, fields: { summary: this.issues.get(otherKey)?.summary } };
          // Each side sees the *other* issue under inwardIssue or outwardIssue. Our code only
          // reads "whichever is present" because Relates is symmetric.
          return l.outward === issue.key
            ? { id: l.id, type, inwardIssue: other }
            : { id: l.id, type, outwardIssue: other };
        });
    if (want("comment")) out.comment = { comments: issue.comments, total: issue.comments.length };
    return { id: issue.id, key: issue.key, fields: out };
  }
}

const ok = (data: unknown) => ({ status: 200, data });
const notFound = () => ({ status: 404, data: { errorMessages: ["Not found"] } });
const bad = (msg: string) => ({ status: 400, data: { errorMessages: [msg] } });

// ── Minimal JQL ─────────────────────────────────────────────────────────────
type Pred = (issue: FakeIssue, jira: FakeJira) => boolean;

const tokenize = (jql: string): string[] => {
  const tokens: string[] = [];
  const re = /\s*("(?:[^"\\]|\\.)*"|\(|\)|,|!=|!~|=|~|[^\s(),=!~"]+)/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(jql)) && m[1] !== undefined) tokens.push(m[1]);
  return tokens;
};

const unquote = (t: string) => (t.startsWith('"') ? t.slice(1, -1).replace(/\\(.)/g, "$1") : t);

export const parseJql = (jql: string): Pred => {
  const t = tokenize(jql.replace(/\border by\b.*$/i, ""));
  let i = 0;
  const peek = () => t[i]?.toUpperCase();
  const expr = (): Pred => {
    let left = term();
    while (peek() === "OR") {
      i++;
      const l = left,
        r = term();
      left = (x, j) => l(x, j) || r(x, j);
    }
    return left;
  };
  const term = (): Pred => {
    let left = factor();
    while (peek() === "AND") {
      i++;
      const l = left,
        r = factor();
      left = (x, j) => l(x, j) && r(x, j);
    }
    return left;
  };
  const factor = (): Pred => {
    if (peek() === "NOT") {
      i++;
      const f = factor();
      return (x, j) => !f(x, j);
    }
    if (t[i] === "(") {
      i++;
      const e = expr();
      i++; // ")"
      return e;
    }
    return clause();
  };
  const clause = (): Pred => {
    const field = (t[i++] ?? "").toLowerCase();
    let op = (t[i++] ?? "").toLowerCase();
    if (op === "not" && peek() === "IN") {
      i++;
      op = "not in";
    }
    let values: string[];
    if (op === "in" || op === "not in") {
      values = [];
      i++; // "("
      while (t[i] !== ")" && i < t.length) {
        if (t[i] !== ",") values.push(unquote(t[i]!));
        i++;
      }
      i++; // ")"
    } else {
      values = [unquote(t[i++] ?? "")];
    }
    const get = (x: FakeIssue, j: FakeJira): string[] => {
      switch (field) {
        case "project":
          return [x.key.split("-")[0]!];
        case "labels":
          return x.labels;
        case "key":
        case "issuekey":
          return [x.key];
        case "summary":
          return [x.summary];
        case "status":
          return [x.status];
        case "text":
          return [j.searchableText(x)];
        default:
          throw new Error(`FakeJira: unsupported JQL field ${field}`);
      }
    };
    const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    return (x, j) => {
      const have = get(x, j);
      switch (op) {
        case "=":
          return have.some((h) => eq(h, values[0]!));
        case "!=":
          return !have.some((h) => eq(h, values[0]!));
        case "in":
          return have.some((h) => values.some((v) => eq(h, v)));
        case "not in":
          return !have.some((h) => values.some((v) => eq(h, v)));
        case "~":
          return have.some((h) => h.toLowerCase().includes(values[0]!.toLowerCase().replace(/\*/g, "")));
        case "!~":
          return !have.some((h) => h.toLowerCase().includes(values[0]!.toLowerCase()));
        default:
          throw new Error(`FakeJira: unsupported JQL operator ${op}`);
      }
    };
  };
  const pred = expr();
  return pred;
};
