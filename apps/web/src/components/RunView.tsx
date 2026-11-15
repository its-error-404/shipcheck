import { useState } from "react";
import { api } from "../api";
import { dateTime, duration, number, percent } from "../format";
import type { RunDetail } from "../types";
import { Badge, CountsBar } from "./Badge";
import { RequirementPanel } from "./RequirementPanel";

interface Props {
  run: RunDetail;
  site?: string;
  running: boolean;
  onResume: (runId: string) => void;
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="stat">
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
  </div>
);

export const RunView = ({ run, site, running, onResume }: Props) => {
  const { summary, report, metrics, requirements } = run;
  const [open, setOpen] = useState<string | undefined>(requirements[0]?.key);
  const target = report?.target;
  const canResume = !running && summary.state !== "complete";

  return (
    <article className="run-view">
      <header className="run-head">
        <div>
          <div className="eyebrow mono">{summary.id}</div>
          <h2>
            Release {summary.release ?? "—"}
            {summary.partial && <span className="chip">partial run</span>}
          </h2>
          {report?.overall && <p className="lead">{report.overall.reason}</p>}
          {summary.state === "incomplete" && (
            <p className="lead">
              {running ? "This run is in progress." : "This run did not finish."} {requirements.length} requirement
              result(s) saved so far.
            </p>
          )}
        </div>
        <div className="run-head-side">
          <Badge value={summary.overall?.decision} size="lg" />
          {summary.state === "complete" && (
            <a className="btn btn-ghost" href={api.reportUrl(summary.id)} target="_blank" rel="noreferrer">
              Markdown report
            </a>
          )}
          {canResume && (
            <button className="btn" type="button" onClick={() => onResume(summary.id)}>
              Resume run
            </button>
          )}
        </div>
      </header>

      {summary.partial && (
        <div className="notice">
          Only {summary.partial.selected.join(", ")} of {summary.partial.total} requirements were assessed. This is a
          demo of the agent, not a release decision.
        </div>
      )}

      <div className="stats">
        <Stat label="Model" value={summary.model ?? "—"} />
        <Stat label="Prompt" value={summary.promptVersion ?? "—"} />
        <Stat label="Started" value={dateTime(summary.startedAt)} />
        <Stat label="Wall clock" value={duration(metrics?.wallClockMs)} />
        <Stat label="Model calls" value={number(metrics?.llm.calls)} />
        <Stat label="Tokens" value={number(metrics?.tokens.total)} />
        <Stat label="Tool calls" value={number(metrics?.tools.calls)} />
        {summary.accuracy !== undefined && <Stat label="Eval accuracy" value={percent(summary.accuracy)} />}
      </div>

      {target && (
        <div className="target">
          <span className="muted">Target</span>
          {Object.entries(target).map(([k, v]) => (
            <span key={k} className="target-field">
              <span className="muted">{k}</span> <span className="mono">{String(v)}</span>
            </span>
          ))}
        </div>
      )}

      <CountsBar counts={summary.counts} />

      {report?.runIssues && report.runIssues.length > 0 && (
        <div className="notice notice-warn">
          {report.runIssues.map((i) => (
            <div key={i}>{i}</div>
          ))}
        </div>
      )}

      <div className="req-table">
        {requirements.map((r) => {
          const isOpen = open === r.key;
          return (
            <div key={r.key} className={`req-row-wrap ${isOpen ? "open" : ""}`}>
              <button className="req-row" type="button" onClick={() => setOpen(isOpen ? undefined : r.key)}>
                <span className="mono strong req-id">{r.sourceId ?? r.key}</span>
                <span className="req-summary">{r.summary.replace(/^\[[^\]]+\]\s*/, "")}</span>
                <span className="muted small req-meta">
                  {r.status === "decided"
                    ? `${r.agent?.turns ?? 0} turns · ${duration(r.agent?.durationMs)}`
                    : r.status.replace("_", " ")}
                </span>
                <Badge value={r.decision} />
                <span className="chev" aria-hidden>
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {isOpen && <RequirementPanel r={r} runId={summary.id} site={site} />}
            </div>
          );
        })}
        {requirements.length === 0 && <p className="muted pad">No requirement results yet.</p>}
      </div>
    </article>
  );
};
