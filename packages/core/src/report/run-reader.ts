/**
 * Read-only access to run folders (used by the web server).
 *
 * A run folder is complete once report.json exists. Before that (a run in
 * progress, or one that was interrupted) the per-requirement files written as
 * each investigation finishes are still readable, so partial progress shows.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Decision } from "../models/decision";
import type { AssessmentResult, RequirementResult } from "../models/assessment";
import type { RunMetrics } from "./metrics";

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const TRACE_EVENT_LIMIT = 5000;

export type RunState = "complete" | "aborted" | "incomplete";

export interface RunSummary {
  id: string;
  state: RunState;
  release?: string;
  model?: string;
  promptVersion?: string;
  startedAt?: string;
  finishedAt?: string;
  overall?: AssessmentResult["overall"];
  partial?: AssessmentResult["partial"];
  counts: Record<Decision, number>;
  requirements: number;
  wallClockMs?: number;
  tokens?: number;
  /** Accuracy against the local answer key, when an evaluation was saved in the folder. */
  accuracy?: number;
}

export interface RunDetail {
  summary: RunSummary;
  report?: AssessmentResult;
  metrics?: RunMetrics;
  requirements: RequirementResult[];
  evaluation?: unknown;
}

export class RunNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Run not found: ${id}`);
    this.name = "RunNotFoundError";
  }
}

/** Rejects anything that is not a plain folder/file name (no path traversal). */
export const isSafeName = (name: string): boolean => RUN_ID_PATTERN.test(name) && !name.includes("..");

const readJson = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const emptyCounts = (): Record<Decision, number> => ({ PASS: 0, FAIL: 0, INSUFFICIENT_EVIDENCE: 0 });

const countDecisions = (rs: readonly RequirementResult[]): Record<Decision, number> => {
  const counts = emptyCounts();
  for (const r of rs) counts[r.decision] += 1;
  return counts;
};

/** "20261115-110400-R2.4" → ISO start time and release. */
const parseRunId = (id: string): { startedAt?: string; release?: string } => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)$/.exec(id);
  if (!m) return {};
  const [, y, mo, d, h, mi, s, release] = m;
  return { startedAt: `${y}-${mo}-${d}T${h}:${mi}:${s}Z`, release };
};

export class RunReader {
  constructor(readonly baseDir: string) {}

  private dirOf = (id: string): string => {
    if (!isSafeName(id)) throw new RunNotFoundError(id);
    return join(this.baseDir, id);
  };

  private readRequirementFiles = async (dir: string): Promise<RequirementResult[]> => {
    const reqDir = join(dir, "requirements");
    const files = (await readdir(reqDir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
    const results = await Promise.all(files.map((f) => readJson<RequirementResult>(join(reqDir, f))));
    return results.filter((r): r is RequirementResult => r !== undefined);
  };

  private summarise = async (id: string, dir: string): Promise<RunDetail> => {
    const [report, metrics, evaluation] = await Promise.all([
      readJson<AssessmentResult>(join(dir, "report.json")),
      readJson<RunMetrics>(join(dir, "metrics.json")),
      readJson<{ accuracy?: number }>(join(dir, "evaluation.json")),
    ]);
    const requirements = report?.requirements ?? (await this.readRequirementFiles(dir));
    const fromId = parseRunId(id);
    const summary: RunSummary = {
      id,
      state: report ? (report.status === "ABORTED" ? "aborted" : "complete") : "incomplete",
      release: report?.request.release ?? fromId.release,
      model: report?.model ?? requirements.find((r) => r.agent?.model)?.agent?.model,
      promptVersion: report?.promptVersion,
      startedAt: report?.startedAt ?? fromId.startedAt,
      finishedAt: report?.finishedAt,
      overall: report?.overall,
      partial: report?.partial,
      counts: report?.overall?.counts ?? countDecisions(requirements),
      requirements: requirements.length,
      wallClockMs: metrics?.wallClockMs,
      tokens: metrics?.tokens.total,
      accuracy: evaluation?.accuracy,
    };
    return { summary, report, metrics, requirements, evaluation };
  };

  /** Newest first. Folders that are not run folders are skipped. */
  list = async (): Promise<RunSummary[]> => {
    const entries = await readdir(this.baseDir, { withFileTypes: true }).catch(() => []);
    const ids = entries
      .filter((e) => e.isDirectory() && isSafeName(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();
    const details = await Promise.all(ids.map((id) => this.summarise(id, join(this.baseDir, id))));
    return details.map((d) => d.summary);
  };

  get = async (id: string): Promise<RunDetail> => {
    const dir = this.dirOf(id);
    const info = await stat(dir).catch(() => undefined);
    if (!info?.isDirectory()) throw new RunNotFoundError(id);
    return this.summarise(id, dir);
  };

  transcript = async (id: string, requirement: string): Promise<unknown[]> => {
    if (!isSafeName(requirement)) throw new RunNotFoundError(`${id}/${requirement}`);
    const t = await readJson<unknown[]>(join(this.dirOf(id), "transcripts", `${requirement}.json`));
    if (!t) throw new RunNotFoundError(`${id}/${requirement}`);
    return t;
  };

  /** Trace events (JSON lines); the newest TRACE_EVENT_LIMIT when the file is large. */
  trace = async (id: string): Promise<unknown[]> => {
    const text = await readFile(join(this.dirOf(id), "trace.jsonl"), "utf8").catch(() => {
      throw new RunNotFoundError(id);
    });
    const lines = text.split("\n").filter(Boolean).slice(-TRACE_EVENT_LIMIT);
    return lines.flatMap((l) => {
      try {
        return [JSON.parse(l) as unknown];
      } catch {
        return [];
      }
    });
  };

  report = async (id: string): Promise<string> => {
    const md = await readFile(join(this.dirOf(id), "report.md"), "utf8").catch(() => undefined);
    if (md === undefined) throw new RunNotFoundError(id);
    return md;
  };
}
