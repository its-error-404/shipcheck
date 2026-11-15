/**
 * Run folder layout (docs/12-orchestrator.md, docs/14-trace-metrics.md):
 *   runs/<runId>/report.md · report.json · metrics.json · trace.jsonl
 *   runs/<runId>/requirements/<REQ>.json   (written as each finishes: enables --resume)
 *   runs/<runId>/transcripts/<REQ>.json    (full conversation per investigation)
 */
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Msg } from "../llm/types";
import type { AssessmentResult, RequirementResult } from "../models/assessment";
import type { TraceEvent, TraceSink } from "../trace";

const RUN_FILES = {
  reportMd: "report.md",
  reportJson: "report.json",
  metrics: "metrics.json",
  trace: "trace.jsonl",
  requirementsDir: "requirements",
  transcriptsDir: "transcripts",
} as const;

const safeName = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, "_");

export const newRunId = (release: string, now = new Date()): string =>
  `${now.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")}-${safeName(release)}`;

/** Appends one JSON object per line. */
export class JsonlTrace implements TraceSink {
  private readonly stream: WriteStream;
  constructor(path: string) {
    this.stream = createWriteStream(path, { flags: "a" });
  }
  emit(event: TraceEvent): void {
    this.stream.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  }
  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}

export class RunStore {
  private constructor(readonly dir: string) {}

  static async create(baseDir: string, runId: string): Promise<RunStore> {
    const dir = join(baseDir, runId);
    await mkdir(join(dir, RUN_FILES.requirementsDir), { recursive: true });
    await mkdir(join(dir, RUN_FILES.transcriptsDir), { recursive: true });
    return new RunStore(dir);
  }

  get tracePath(): string {
    return join(this.dir, RUN_FILES.trace);
  }

  private writeJson = (path: string, data: unknown): Promise<void> =>
    writeFile(path, `${JSON.stringify(data, null, 2)}\n`);

  saveRequirement = async (result: RequirementResult, transcript?: Msg[]): Promise<void> => {
    const name = `${safeName(result.sourceId ?? result.key)}.json`;
    await this.writeJson(join(this.dir, RUN_FILES.requirementsDir, name), result);
    if (transcript) await this.writeJson(join(this.dir, RUN_FILES.transcriptsDir, name), transcript);
  };

  saveFinal = async (result: AssessmentResult, metrics: unknown, markdown: string): Promise<void> => {
    await this.writeJson(join(this.dir, RUN_FILES.reportJson), result);
    await this.writeJson(join(this.dir, RUN_FILES.metrics), metrics);
    await writeFile(join(this.dir, RUN_FILES.reportMd), markdown);
  };

  /** Loads per-requirement results from a previous run folder (for --resume), keyed by Jira key. */
  static loadResume = async (runDir: string): Promise<Map<string, RequirementResult>> => {
    const dir = join(runDir, RUN_FILES.requirementsDir);
    const results = new Map<string, RequirementResult>();
    for (const file of await readdir(dir).catch(() => [] as string[])) {
      if (!file.endsWith(".json")) continue;
      const r = JSON.parse(await readFile(join(dir, file), "utf8")) as RequirementResult;
      results.set(r.key, r);
    }
    return results;
  };
}
