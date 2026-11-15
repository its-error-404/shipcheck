/**
 * Minimal, professional terminal output. Built on Node's util.styleText (no dependency).
 * Colour is used only to carry meaning (status, warnings, detail) and is disabled
 * automatically for NO_COLOR, --no-color, or non-terminal output.
 */
import { styleText } from "node:util";

type Style = Parameters<typeof styleText>[0];

const colorEnabled = (): boolean =>
  !process.env.NO_COLOR && !process.argv.includes("--no-color") && (process.stdout.isTTY ?? false);

const paint = (style: Style, text: string): string => (colorEnabled() ? styleText(style, text) : text);

export const c = {
  bold: (t: string) => paint("bold", t),
  dim: (t: string) => paint("dim", t),
  green: (t: string) => paint("green", t),
  red: (t: string) => paint("red", t),
  yellow: (t: string) => paint("yellow", t),
  cyan: (t: string) => paint("cyan", t),
  gray: (t: string) => paint("gray", t),
};

export const SYMBOL = { ok: "✓", fail: "✗", warn: "!", info: "›", dot: "·", retry: "↻", bullet: "•" } as const;

export const out = (line = ""): void => {
  process.stdout.write(`${line}\n`);
};

/** Command banner: title plus a few aligned key/value lines. */
export const banner = (title: string, rows: [string, string][] = []) => {
  out();
  out(c.bold(title));
  const width = Math.max(0, ...rows.map(([k]) => k.length));
  for (const [k, v] of rows) out(`  ${c.gray(k.padEnd(width))}  ${v}`);
  out();
};

/** Numbered step header, e.g. "[2/4] Discovery". */
export const step = (n: number, total: number, title: string, detail?: string) =>
  out(`${c.cyan(`[${n}/${total}]`)} ${c.bold(title)}${detail ? c.gray(`  ${detail}`) : ""}`);

export const ok = (text: string) => out(`  ${c.green(SYMBOL.ok)} ${text}`);
export const info = (text: string) => out(`  ${c.gray(SYMBOL.info)} ${text}`);
export const detail = (text: string) => out(`    ${c.dim(text)}`);
export const warn = (text: string) => out(`  ${c.yellow(SYMBOL.warn)} ${c.yellow(text)}`);
export const fail = (text: string) => out(`  ${c.red(SYMBOL.fail)} ${c.red(text)}`);

/** Error block with an optional "How to fix" hint. */
export const errorBlock = (message: string, hint?: string) => {
  out();
  out(`${c.red(`${SYMBOL.fail} Error`)}  ${message}`);
  if (hint) out(`  ${c.bold("How to fix:")} ${hint}`);
  out();
};

export const duration = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60
    ? `${m}m ${String(s % 60).padStart(2, "0")}s`
    : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

const DECISION_STYLE: Record<string, (t: string) => string> = {
  PASS: c.green,
  FAIL: c.red,
  INSUFFICIENT_EVIDENCE: c.yellow,
  BLOCKED: c.red,
  NEEDS_REVIEW: c.yellow,
  READY: c.green,
};

/** Coloured decision label, padded for alignment. */
export const decision = (d: string, pad = 0): string => (DECISION_STYLE[d] ?? ((t: string) => t))(d.padEnd(pad));

/** Simple aligned table (no borders). */
export const table = (headers: string[], rows: string[][]) => {
  // eslint-disable-next-line no-control-regex
  const visible = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "").length;
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => visible(r[i] ?? ""))));
  const fmt = (cells: string[]) =>
    cells.map((cell, i) => cell + " ".repeat(Math.max(0, widths[i]! - visible(cell)))).join("  ");
  out(`  ${c.gray(fmt(headers))}`);
  for (const r of rows) out(`  ${fmt(r)}`);
};

/** Turns known error messages into a short hint. */
export const hintFor = (message: string): string | undefined => {
  if (/JIRA_API_TOKEN|credentials/i.test(message))
    return "Check JIRA_EMAIL and JIRA_API_TOKEN in .env (create a token at id.atlassian.com).";
  if (/Project ".*" not found/i.test(message)) return "Set JIRA_PROJECT_KEY in .env to one of the keys listed above.";
  if (/LLM_MODEL is not set|LLM_API_KEY|LLM_BASE_URL/i.test(message))
    return "Fill in the LLM section of .env, then run `npm run verify-llm`.";
  if (/quota/i.test(message))
    return "Wait for the quota to reset or switch LLM_MODEL, then rerun with --resume runs/<runId>.";
  if (/ECONNREFUSED|127\.0\.0\.1:11434|localhost:11434/i.test(message))
    return "Start Ollama (or run `npm run setup:ollama`).";
  if (/run the importer/i.test(message)) return "Run `npm run import` first.";
  return undefined;
};
