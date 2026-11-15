/**
 * Live progress for `assess`, rendered from trace events (presentation is
 * separate from the agent: the orchestrator only emits events).
 */
import { TRACE_EVENTS, type TraceEvent, type TraceSink } from "@shipcheck/core";
import { SYMBOL, c, decision, detail, duration, info, ok, out, step, warn } from "./ui";

const TOTAL_STEPS = 4;

const summariseArgs = (args: unknown): string => {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  if (a.decision) return String(a.decision);
  const parts: string[] = [];
  for (const k of ["ref", "kind", "text", "release", "comment_id", "contains"])
    if (a[k] !== undefined) parts.push(k === "ref" ? String(a[k]) : `${k}=${String(a[k])}`);
  if (Array.isArray(a.source_ids)) parts.push(`ids=${a.source_ids.join(",")}`);
  if (Array.isArray(a.requirement_keys)) parts.push(`${a.requirement_keys.length} requirements`);
  return parts.join(" ");
};

export interface ProgressOptions {
  /** Hide individual tool calls. */
  quiet?: boolean;
}

export class AssessProgress implements TraceSink {
  private readonly startedAt = Date.now();
  private total = 0;
  private done = 0;
  private finishedDurations: number[] = [];
  private current?: string;

  constructor(private readonly opts: ProgressOptions = {}) {}

  private elapsed = () => c.gray(duration(Date.now() - this.startedAt));

  emit(e: TraceEvent): void {
    switch (e.type) {
      case TRACE_EVENTS.runPhase:
        return this.phase(e);
      case TRACE_EVENTS.agentStart:
        if (e.label !== "discovery") {
          this.current = String(e.label);
          out(
            `  ${c.cyan(SYMBOL.bullet)} ${c.bold(this.current)} ${c.gray(`(${this.done + 1}/${this.total})`)}  investigating…  ${this.elapsed()}`,
          );
        }
        return;
      case TRACE_EVENTS.toolCall:
        if (this.opts.quiet || e.tool === "record_decision" || e.tool === "submit_plan") {
          if (e.ok === false && (e.tool === "record_decision" || e.tool === "submit_plan"))
            detail(`${c.yellow(`${String(e.tool)} rejected`)}: the agent will fix it and retry`);
          return;
        }
        return detail(
          `${e.ok === false ? c.yellow(`${String(e.tool)} (error)`) : String(e.tool)} ${summariseArgs(e.args)}`.slice(
            0,
            110,
          ),
        );
      case TRACE_EVENTS.budgetWarning:
        return warn(`${String(e.label)}: ${String(e.turnsLeft)} turn(s) left; asking the agent to conclude`);
      case TRACE_EVENTS.llmRetry:
        return warn(
          `Model ${String(e.reason).replace("_", " ")}: retry ${String(e.attempt)} in ${duration(Number(e.delayMs))}`,
        );
      case TRACE_EVENTS.jiraRetry:
        return warn(`Jira ${String(e.status)}: retry ${String(e.attempt)} in ${String(e.delayMs)} ms`);
      case TRACE_EVENTS.requirementResult:
        return this.result(e);
      default:
        return;
    }
  }

  private phase(e: TraceEvent): void {
    switch (e.phase) {
      case "preflight":
        return step(1, TOTAL_STEPS, "Preflight", "Jira access and assessment scope");
      case "scope":
        return ok(`${String(e.issues)} issues in scope`);
      case "discovery":
        out();
        return step(2, TOTAL_STEPS, "Discovery", "the agent locates the release manifest and its requirements");
      case "plan":
        return ok(
          `Manifest ${String(e.manifestKey)}${e.manifestSourceId ? ` (${String(e.manifestSourceId)})` : ""} · ${String(e.requirements)} requirements`,
        );
      case "target": {
        const t = e.target as Record<string, string>;
        return info(`Target  ${t.release} · ${t.commit} · ${t.service} · ${t.environment} · prompt ${t.prompt}`);
      }
      case "investigation":
        this.total = Number(e.requirements ?? 0);
        out();
        return step(3, TOTAL_STEPS, "Investigation", `${this.total} requirements, one bounded agent each`);
      case "aggregate":
        out();
        return step(4, TOTAL_STEPS, "Report", "overall decision computed in code");
      default:
        return;
    }
  }

  private result(e: TraceEvent): void {
    this.done++;
    const ms = Number(e.durationMs ?? 0);
    if (ms) this.finishedDurations.push(ms);
    const id = String(e.sourceId ?? e.key);
    const remaining = this.total - this.done;
    const avg = this.finishedDurations.length
      ? this.finishedDurations.reduce((a, b) => a + b, 0) / this.finishedDurations.length
      : 0;
    const eta = remaining > 0 && avg ? c.gray(`  ETA ~${duration(avg * remaining)}`) : "";
    const stats = e.turns !== undefined ? c.gray(`${String(e.turns)} turns · ${duration(ms)}`) : "";
    const mark =
      e.status === "decided"
        ? c.green(SYMBOL.ok)
        : e.status === "resumed"
          ? c.cyan(SYMBOL.retry)
          : c.yellow(SYMBOL.warn);
    const note =
      e.status === "resumed"
        ? c.gray("reused from previous run")
        : e.status === "agent_failed"
          ? c.yellow(`agent stopped: ${String(e.stopReason)}`)
          : e.status === "not_assessed"
            ? c.yellow("not assessed (quota)")
            : stats;
    out(`  ${mark} ${c.bold(id.padEnd(8))} ${decision(String(e.decision), 22)} ${note}${eta}`);
  }
}
