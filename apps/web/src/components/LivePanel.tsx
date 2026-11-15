import { useEffect, useState } from "react";
import { duration } from "../format";
import type { LiveEvent, LiveStatus } from "../types";
import { Badge } from "./Badge";

const PHASES = [
  { id: "preflight", title: "Preflight" },
  { id: "discovery", title: "Discovery" },
  { id: "investigation", title: "Investigation" },
  { id: "aggregate", title: "Report" },
] as const;

const LOG_LINES = 12;

interface Progress {
  phase?: string;
  total: number;
  done: { id: string; decision: string; status: string; durationMs?: number }[];
  current?: string;
  log: string[];
}

const describe = (e: LiveEvent): string | undefined => {
  switch (e.type) {
    case "tool_call":
      return `${e.ok === false ? "✗" : "·"} ${String(e.label ?? "")} ${String(e.tool)}${e.ok === false ? " (rejected, retrying)" : ""}`;
    case "llm_retry":
      return `Model ${String(e.reason).replace("_", " ")}, retrying`;
    case "budget_warning":
      return `${String(e.label)}: ${String(e.turnsLeft)} turn(s) left`;
    case "jira_retry":
      return `Jira ${String(e.status)}, retrying`;
    default:
      return undefined;
  }
};

/** Derives phase, progress and a short log from the raw trace events (same source as the CLI progress). */
const derive = (events: LiveEvent[]): Progress => {
  const p: Progress = { total: 0, done: [], log: [] };
  for (const e of events) {
    if (e.type === "run_phase") {
      p.phase = String(e.phase);
      if (e.phase === "investigation") p.total = Number(e.requirements ?? 0);
    } else if (e.type === "agent_start" && e.label !== "discovery") p.current = String(e.label);
    else if (e.type === "requirement_result") {
      p.done.push({
        id: String(e.sourceId ?? e.key),
        decision: String(e.decision),
        status: String(e.status),
        durationMs: typeof e.durationMs === "number" ? e.durationMs : undefined,
      });
    }
    const line = describe(e);
    if (line) p.log.push(line);
  }
  p.log = p.log.slice(-LOG_LINES);
  return p;
};

const useNow = () => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
};

/** Live progress of the active run, streamed over Socket.io. */
export const LivePanel = ({ status, events }: { status: LiveStatus; events: LiveEvent[] }) => {
  const now = useNow();
  const active = status.active;
  if (!active) return null;
  const p = derive(events);
  const phaseIndex = PHASES.findIndex((ph) => ph.id === p.phase);
  const elapsed = now - new Date(active.startedAt).getTime();
  const finished = p.done.filter((d) => d.durationMs);
  const avg = finished.length ? finished.reduce((a, d) => a + (d.durationMs ?? 0), 0) / finished.length : 0;
  const remaining = Math.max(0, p.total - p.done.length);

  return (
    <section className="live" aria-live="polite">
      <div className="live-head">
        <span className="pulse" aria-hidden />
        <strong>Run in progress</strong>
        <span className="mono muted">{active.info.runId}</span>
        <span className="spacer" />
        <span className="muted small">
          {active.info.model} · {duration(elapsed)}
          {avg > 0 && remaining > 0 && ` · ETA ~${duration(avg * remaining)}`}
        </span>
      </div>
      <ol className="phases">
        {PHASES.map((ph, i) => (
          <li key={ph.id} className={i < phaseIndex ? "done" : i === phaseIndex ? "current" : ""}>
            {ph.title}
            {ph.id === "investigation" && p.total > 0 && (
              <span className="muted">
                {" "}
                {p.done.length}/{p.total}
              </span>
            )}
          </li>
        ))}
      </ol>
      {p.total > 0 && (
        <div className="progress">
          <span style={{ width: `${(p.done.length / p.total) * 100}%` }} />
        </div>
      )}
      <div className="live-body">
        <div className="live-results">
          {p.done.map((d) => (
            <div key={d.id} className="live-result">
              <span className="mono">{d.id}</span>
              <Badge value={d.decision} />
              <span className="muted small">{d.status === "decided" ? duration(d.durationMs) : d.status}</span>
            </div>
          ))}
          {p.current && !p.done.some((d) => d.id === p.current) && (
            <div className="live-result">
              <span className="mono">{p.current}</span>
              <span className="muted small">investigating…</span>
            </div>
          )}
        </div>
        <pre className="live-log">{p.log.join("\n") || "Waiting for the first events…"}</pre>
      </div>
    </section>
  );
};
