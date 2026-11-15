/**
 * Deterministic parsers for imported record text. No judgement here: they
 * only extract what the text states.
 */
import { TARGET_FIELDS, type Target, type TargetField } from "../models/dataset";

export interface RecordedHeader {
  recordedAt?: string;
  actor?: string;
  role?: string;
  body: string;
}

const RECORDED_RE = /^Recorded event (\S+) \| actor ([^|]+?) \| role ([^\n]+?)\s*(?:\n|$)/;

/** Splits "Recorded event <ts> | actor <name> | role <role>\n<body>" into fields. */
export const parseRecordedHeader = (text: string): RecordedHeader => {
  const m = RECORDED_RE.exec(text);
  if (!m) return { body: text };
  return { recordedAt: m[1], actor: m[2]!.trim(), role: m[3]!.trim(), body: text.slice(m[0].length) };
};

const PATTERNS: Record<TargetField, RegExp[]> = {
  release: [/\brelease\s+(R\d+(?:\.\d+)*)\b/gi],
  commit: [/\bcommit\s+([0-9a-f]{6,40})\b/gi],
  service: [/\bservice\s+([a-z0-9][a-z0-9-]*[a-z0-9])\b/gi],
  environment: [
    /\benvironment\s+([a-z][a-z-]*)\b/gi,
    /\bapproval scope:\s*([a-z][a-z-]*)\b/gi,
    /\bfor (production|staging)\b/gi,
  ],
  prompt: [/\bprompt(?:\s+bundle)?\s+(p\d+)\b/gi],
};

export interface FieldCheck {
  field: TargetField;
  expected: string;
  found: string[];
  status: "match" | "mismatch" | "not_stated" | "ambiguous";
}

export interface ScopeCheck {
  verdict: "MATCH" | "MATCH_ON_STATED_FIELDS" | "MISMATCH" | "AMBIGUOUS";
  fields: FieldCheck[];
  mismatched: TargetField[];
  notStated: TargetField[];
}

/** Compares the scope stated in a text with the target build. */
/** All values of one scope field stated in a text (e.g. every "prompt pN" mention). */
export const extractField = (text: string, field: TargetField): string[] => {
  const found = new Set<string>();
  for (const re of PATTERNS[field]) for (const m of text.matchAll(re)) found.add(m[1]!.toLowerCase());
  return [...found];
};

/** Fields that identify the build/deployment; the prompt matters only for prompt-quality criteria. */
export const CORE_SCOPE_FIELDS: readonly TargetField[] = ["release", "commit", "service", "environment"];

export const checkScopeText = (text: string, target: Target): ScopeCheck => {
  const fields: FieldCheck[] = TARGET_FIELDS.map((field) => {
    const found = new Set<string>();
    for (const re of PATTERNS[field]) for (const m of text.matchAll(re)) found.add(m[1]!.toLowerCase());
    const expected = target[field];
    const values = [...found];
    let status: FieldCheck["status"];
    if (values.length === 0) status = "not_stated";
    else if (values.length > 1) status = values.includes(expected.toLowerCase()) ? "ambiguous" : "mismatch";
    else status = values[0] === expected.toLowerCase() ? "match" : "mismatch";
    return { field, expected, found: values, status };
  });
  const mismatched = fields.filter((f) => f.status === "mismatch").map((f) => f.field);
  const notStated = fields.filter((f) => f.status === "not_stated").map((f) => f.field);
  const ambiguous = fields.some((f) => f.status === "ambiguous");
  const verdict = mismatched.length
    ? "MISMATCH"
    : ambiguous
      ? "AMBIGUOUS"
      : notStated.length
        ? "MATCH_ON_STATED_FIELDS"
        : "MATCH";
  return { verdict, fields, mismatched, notStated };
};

/** Normalises text for near-duplicate detection (numbers → #, whitespace collapsed). */
export const noiseSignature = (actor: string | undefined, body: string): string => {
  return `${actor ?? ""}::${body.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase()}`;
};
