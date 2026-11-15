/**
 * Read-only investigation tools (docs/07-agent-tools.md).
 * Every result is compact text, capped, and recorded in the evidence ledger.
 */
import { z } from "zod";
import { TOOL_LIMITS } from "../constants/tools";
import { JiraError } from "../jira/errors";
import { jqlString } from "../jira/jql";
import { CORE_SCOPE_FIELDS, checkScopeText, extractField, noiseSignature } from "./parse";
import { RECORD_KINDS } from "../models/dataset";
import type { CommentView, ScopeEntry } from "../models/jira-view";
import { kindLabel, releaseLabel, srcLabel } from "../utils/labels";
import { capped, defineTool, toolError, type ToolContext, type ToolResult } from "./types";

const row = (e: ScopeEntry) =>
  `${e.key} · ${e.sourceId ?? "?"} · ${e.kind ?? "?"} · filed ${e.release ?? "?"} · Jira status ${e.status ?? "?"} · "${e.summary}"`;

/** Wraps a tool body so Jira failures become readable tool errors instead of crashes. */
const guarded = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof JiraError)
      return toolError(`Jira call failed: ${e.message}`, "Retry later or continue with the evidence you have.");
    throw e;
  }
};

const resolveOrError = async (ctx: ToolContext, ref: string): Promise<string | ToolResult> => {
  const key = await ctx.view.resolve(ref);
  return (
    key ??
    toolError(
      `${ref} is not an issue in the assessment scope.`,
      "Use search_issues to find the right key or source ID.",
    )
  );
};

// ── search_issues ──────────────────────────────────────────────────────────
export const searchIssues = defineTool({
  name: "search_issues",
  description:
    "Search Jira issues inside the assessment scope (always restricted to the project and dataset label). " +
    "All filters are optional and combined with AND. Returns compact rows: key · source ID · kind · release label · Jira status · summary. " +
    "Note: the 'filed' release label is how a record was filed; the scope of a result is stated inside its comments.",
  schema: z.object({
    text: z
      .string()
      .max(TOOL_LIMITS.searchTextMax)
      .optional()
      .describe("Full-text search over summary, description and comments"),
    source_ids: z
      .array(z.string())
      .max(TOOL_LIMITS.sourceIdsMax)
      .optional()
      .describe("Exact source IDs, e.g. ['REQ-04', 'REC-6024']"),
    kind: z.enum(RECORD_KINDS).optional(),
    release: z.string().optional().describe("Release label the record was filed under, e.g. 'R2.4'"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(TOOL_LIMITS.searchMax)
      .optional()
      .describe(`Max rows (default ${TOOL_LIMITS.searchDefault})`),
  }),
  run: (a, ctx) =>
    guarded(async () => {
      const clauses: string[] = [];
      if (a.text) clauses.push(`text ~ ${jqlString(a.text)}`);
      if (a.source_ids?.length)
        clauses.push(`labels in (${a.source_ids.map((s) => jqlString(srcLabel(s))).join(", ")})`);
      if (a.kind) clauses.push(`labels = ${jqlString(kindLabel(a.kind))}`);
      if (a.release) clauses.push(`labels = ${jqlString(releaseLabel(a.release))}`);
      const limit = a.limit ?? TOOL_LIMITS.searchDefault;
      const rows = await ctx.view.search(clauses.join(" AND ") || undefined, limit);
      for (const r of rows)
        ctx.ledger.recordIssue({ key: r.key, sourceId: r.sourceId, summary: r.summary, kind: r.kind });
      if (rows.length === 0) return { content: "No matching issues in scope." };
      return {
        content: capped(
          `${rows.length} issue(s)${rows.length === limit ? ` (limit ${limit}; refine to see more)` : ""}:\n${rows.map(row).join("\n")}`,
        ),
      };
    }),
});

// ── get_issue ──────────────────────────────────────────────────────────────
export const getIssue = defineTool({
  name: "get_issue",
  description:
    "Open one in-scope issue by Jira key (TYN-12) or source ID (REQ-04 / REC-6024). Returns source metadata, the original description, " +
    "and links tagged OUTGOING (declared by this record) or INCOMING (declared by the other record). Comments are NOT included: use get_comments.",
  schema: z.object({ ref: z.string().describe("Jira key or source ID") }),
  run: (a, ctx) =>
    guarded(async () => {
      const key = await resolveOrError(ctx, a.ref);
      if (typeof key !== "string") return key;
      const v = await ctx.view.getIssue(key);
      const comments = await ctx.view.getComments(key);
      ctx.ledger.recordIssue({ key, sourceId: v.sourceId, summary: v.summary, kind: v.kind });
      ctx.ledger.markOpened(key);
      const lines = [
        `${v.key} · source ${v.sourceId ?? "?"} · kind ${v.kind ?? "?"} · filed under ${v.release ?? "?"} · recorded status ${v.recordedStatus ?? "?"} · Jira status ${v.status ?? "?"}`,
        `Summary: ${v.summary}`,
        `Description:\n${v.description
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")}`,
        `Links (${v.links.length}):`,
        ...(v.links.length
          ? v.links.map((l) =>
              l.direction === "outgoing"
                ? `  → OUTGOING ${l.key} · ${l.sourceId ?? "?"} · "${l.summary}" (declared by this record)`
                : `  ← INCOMING ${l.key} · ${l.sourceId ?? "?"} · "${l.summary}" (declared by the other record)`,
            )
          : ["  none"]),
        ...(v.hiddenLinks ? [`  (${v.hiddenLinks} link(s) to issues outside the assessment scope are hidden)`] : []),
        `Comments: ${comments.length} (use get_comments to read them)`,
      ];
      return { content: capped(lines.join("\n")) };
    }),
});

// ── get_comments ───────────────────────────────────────────────────────────
type Entry = { kind: "one"; c: CommentView } | { kind: "run"; cs: CommentView[] };

const collapse = (comments: CommentView[]): Entry[] => {
  const out: Entry[] = [];
  let i = 0;
  while (i < comments.length) {
    const sig = noiseSignature(comments[i]!.actor, comments[i]!.body);
    let j = i + 1;
    while (j < comments.length && noiseSignature(comments[j]!.actor, comments[j]!.body) === sig) j++;
    if (j - i >= TOOL_LIMITS.collapseMinRun) out.push({ kind: "run", cs: comments.slice(i, j) });
    else for (let k = i; k < j; k++) out.push({ kind: "one", c: comments[k]! });
    i = j;
  }
  return out;
};

const who = (c: CommentView) => `${c.actor ?? "unknown actor"} (${c.role ?? "unknown role"})`;

export const getComments = defineTool({
  name: "get_comments",
  description:
    "Read comments of one in-scope issue. Each comment shows its Jira comment id, source position n/N (file order), the RECORDED event time, " +
    "actor and role (the scenario facts; Jira's native author/time belong to the importer), and the text. " +
    "Runs of 3+ near-identical comments (same actor, same text apart from numbers) are collapsed into one line. " +
    "order='recorded' sorts by recorded event time; order='source' keeps file order. Paged by entries.",
  schema: z.object({
    ref: z.string().describe("Jira key or source ID"),
    order: z.enum(["recorded", "source"]).optional().describe("Default 'recorded'"),
    offset: z.number().int().min(0).optional().describe("Entry offset for paging (default 0)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(TOOL_LIMITS.commentsMax)
      .optional()
      .describe(`Entries per page (default ${TOOL_LIMITS.commentsDefault})`),
    contains: z
      .string()
      .max(TOOL_LIMITS.containsMax)
      .optional()
      .describe("Only comments whose text contains this (case-insensitive)"),
  }),
  run: (a, ctx) =>
    guarded(async () => {
      const key = await resolveOrError(ctx, a.ref);
      if (typeof key !== "string") return key;
      const entry = await ctx.view.inScope(key);
      let comments = [...(await ctx.view.getComments(key))];
      const total = comments.length;
      const order = a.order ?? "recorded";
      if (order === "recorded")
        comments.sort(
          (x, y) => (x.recordedAt ?? "").localeCompare(y.recordedAt ?? "") || (x.position ?? 0) - (y.position ?? 0),
        );
      else comments.sort((x, y) => (x.position ?? 0) - (y.position ?? 0));
      if (a.contains) comments = comments.filter((c) => c.body.toLowerCase().includes(a.contains!.toLowerCase()));

      const entries = collapse(comments);
      const offset = a.offset ?? 0;
      const limit = a.limit ?? TOOL_LIMITS.commentsDefault;
      const page = entries.slice(offset, offset + limit);
      ctx.ledger.recordIssue({ key, sourceId: entry?.sourceId, summary: entry?.summary, kind: entry?.kind });
      if (!a.contains) ctx.ledger.markCommentsRead(key);

      const lines: string[] = [];
      for (const e of page) {
        if (e.kind === "one") {
          const c = e.c;
          ctx.ledger.recordComment({ ...c, issueKey: key, sourceId: entry?.sourceId, collapsed: false });
          lines.push(
            `[comment ${c.id} · #${c.position ?? "?"}/${c.total ?? "?"} · recorded ${c.recordedAt ?? "?"} · ${who(c)}]\n${c.body}`,
          );
        } else {
          const first = e.cs[0]!;
          const last = e.cs[e.cs.length - 1]!;
          for (const c of e.cs)
            ctx.ledger.recordComment({ ...c, issueKey: key, sourceId: entry?.sourceId, collapsed: true });
          lines.push(
            `⋯ [${e.cs.length} near-identical comments collapsed · ids ${first.id}…${last.id} · recorded ${first.recordedAt ?? "?"} → ${last.recordedAt ?? "?"} · ${who(first)}]\n` +
              `  e.g. "${first.body.slice(0, TOOL_LIMITS.collapseExampleChars)}"`,
          );
        }
      }
      const shownTo = offset + page.length;
      const header =
        `${key} (${entry?.sourceId ?? "?"}) · ${total} comment(s)${a.contains ? `, ${comments.length} matching "${a.contains}"` : ""} · ` +
        `order=${order} · entries ${entries.length ? offset + 1 : 0}–${shownTo} of ${entries.length}`;
      const footer = shownTo < entries.length ? `\nMore: call get_comments with offset=${shownTo}.` : "";
      return { content: capped(`${header}\n\n${lines.join("\n\n") || "(no comments)"}${footer}`) };
    }),
});

// ── check_scope ────────────────────────────────────────────────────────────
export const checkScope = defineTool({
  name: "check_scope",
  description:
    "Deterministically compare the release / commit / service / environment / prompt STATED in one comment with the target build. " +
    "It only extracts and compares what the text states; it does not decide whether the evidence is relevant or sufficient.",
  schema: z.object({
    ref: z.string().describe("Jira key or source ID of the issue"),
    comment_id: z.string().describe("Jira comment id (from get_comments)"),
  }),
  run: (a, ctx) =>
    guarded(async () => {
      const key = await resolveOrError(ctx, a.ref);
      if (typeof key !== "string") return key;
      const c = (await ctx.view.getComments(key)).find((x) => x.id === a.comment_id);
      if (!c) return toolError(`Comment ${a.comment_id} is not on ${key}.`, "Use get_comments to list comment ids.");
      const entry = await ctx.view.inScope(key);
      ctx.ledger.recordIssue({ key, sourceId: entry?.sourceId, summary: entry?.summary, kind: entry?.kind });
      ctx.ledger.recordComment({ ...c, issueKey: key, sourceId: entry?.sourceId, collapsed: false });
      if (!ctx.target) return toolError("check_scope needs the target build, which is only known after discovery.");
      const r = checkScopeText(c.body, ctx.target);
      const fmt = r.fields.map((f) => {
        if (f.status === "match") return `  ${f.field}: ${f.found[0]} ✓`;
        if (f.status === "not_stated") return `  ${f.field}: not stated (target ${f.expected})`;
        return `  ${f.field}: ${f.found.join(" / ")} ✗ ${f.status} (target ${f.expected})`;
      });
      const verdict =
        r.verdict === "MISMATCH"
          ? `MISMATCH on ${r.mismatched.join(", ")}`
          : r.verdict === "MATCH_ON_STATED_FIELDS"
            ? `MATCH on stated fields; not stated: ${r.notStated.join(", ")}`
            : r.verdict;
      // Core build match is reported separately: the prompt only matters for criteria about the deployed prompt.
      const core = r.fields.filter((f) => CORE_SCOPE_FIELDS.includes(f.field));
      const coreLine = core.every((f) => f.status === "match")
        ? "Build/deployment (release, commit, service, environment): MATCHES the target."
        : `Build/deployment (release, commit, service, environment): ${core
            .filter((f) => f.status !== "match")
            .map(
              (f) => `${f.field} ${f.status === "not_stated" ? "not stated" : `${f.found.join("/")} ≠ ${f.expected}`}`,
            )
            .join(", ")}.`;
      const promptField = r.fields.find((f) => f.field === "prompt")!;
      const lines = [coreLine];
      if (promptField.status === "not_stated") {
        // Surface prompt statements made elsewhere on the same issue (e.g. a harness configuration note).
        const elsewhere = (await ctx.view.getComments(key))
          .filter((o) => o.id !== c.id)
          .map((o) => ({ o, prompts: extractField(o.body, "prompt") }))
          .filter((x) => x.prompts.length);
        lines.push(
          elsewhere.length
            ? `Prompt not stated in this comment. Other comments on ${key} state: ${elsewhere
                .map(
                  (x) =>
                    `comment ${x.o.id} (#${x.o.position ?? "?"}, ${who(x.o)}, recorded ${x.o.recordedAt ?? "?"}): prompt ${x.prompts.join("/")}`,
                )
                .join("; ")}. Target prompt is ${ctx.target.prompt}.`
            : `Prompt not stated anywhere on ${key}. This only matters if the acceptance criterion concerns the deployed prompt (${ctx.target.prompt}).`,
        );
      } else if (promptField.status !== "match") {
        lines.push(
          `Prompt ${promptField.found.join("/")} ≠ deployed ${ctx.target.prompt}: relevant if the criterion concerns the deployed prompt.`,
        );
      }
      return {
        content: `${key} comment ${c.id} · recorded ${c.recordedAt ?? "?"} · ${who(c)}\n${fmt.join("\n")}\n→ ${verdict}\n${lines.join("\n")}`,
      };
    }),
});
