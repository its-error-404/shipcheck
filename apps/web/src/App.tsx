import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { LivePanel } from "./components/LivePanel";
import { NewRunDialog } from "./components/NewRunDialog";
import { RunList } from "./components/RunList";
import { RunView } from "./components/RunView";
import type { ConfigStatus, RunDetail, RunSummary } from "./types";
import { useLive } from "./useLive";

/** The selected run lives in the URL hash (#/runs/<id>) so links and refreshes keep it. */
const runFromHash = (): string | undefined => /^#\/runs\/(.+)$/.exec(window.location.hash)?.[1];

export const App = () => {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<string | undefined>(runFromHash());
  const [detail, setDetail] = useState<RunDetail>();
  const [config, setConfig] = useState<ConfigStatus>();
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.runs();
      setRuns(list);
      setError(undefined);
      setSelected((s) => s ?? list.find((r) => r.state === "complete" && !r.partial)?.id ?? list[0]?.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const live = useLive(refresh);
  const activeRunId = live.status.active?.info.runId;

  useEffect(() => {
    void refresh();
    api.config().then(setConfig, () => undefined);
    const onHash = () => setSelected(runFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  // Reload the selected run; while a run is active, poll it so saved results appear as they finish.
  useEffect(() => {
    if (!selected) return setDetail(undefined);
    let cancelled = false;
    const load = () =>
      api.run(selected).then(
        (d) => !cancelled && setDetail(d),
        () => !cancelled && setDetail(undefined),
      );
    void load();
    const timer = selected === activeRunId ? setInterval(load, 5000) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [selected, activeRunId, runs]);

  const select = (id: string) => {
    window.location.hash = `#/runs/${id}`;
    setSelected(id);
  };

  const requirementIds = useMemo(() => {
    const source = runs.find((r) => r.state === "complete" && !r.partial) ? detail?.requirements : undefined;
    return (source ?? detail?.requirements ?? []).map((r) => r.sourceId ?? r.key).sort();
  }, [runs, detail]);

  const start = async (only?: string[], resumeFrom?: string) => {
    const info = await api.start({ only, resumeFrom });
    await refresh();
    select(info.runId);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ✓
          </span>
          <span className="brand-name">Shipcheck</span>
          <span className="muted small brand-sub">release readiness from Jira evidence</span>
        </div>
        <div className="topbar-right">
          <span className={`conn ${live.connected ? "on" : ""}`}>{live.connected ? "live" : "offline"}</span>
          {config && (
            <span className="muted small">
              {config.llm.model ?? "no model"} · {config.jira.project ?? "no Jira"}
            </span>
          )}
          <button
            className="btn btn-primary"
            type="button"
            disabled={Boolean(activeRunId)}
            onClick={() => setDialog(true)}
          >
            {activeRunId ? "Run in progress" : "New run"}
          </button>
        </div>
      </header>

      <div className="layout">
        <RunList runs={runs} selected={selected} activeRunId={activeRunId} onSelect={select} />
        <main className="main">
          {error && <div className="notice notice-bad">Cannot reach the server: {error}</div>}
          {live.status.last && !live.status.last.ok && !activeRunId && (
            <div className="notice notice-bad">
              Run {live.status.last.runId} failed: {live.status.last.error}
            </div>
          )}
          <LivePanel status={live.status} events={live.events} />
          {detail ? (
            <RunView
              key={detail.summary.id}
              run={detail}
              site={config?.jira.site}
              running={detail.summary.id === activeRunId}
              onResume={(id) => void start(undefined, id).catch((e: Error) => setError(e.message))}
            />
          ) : (
            !error && (
              <div className="empty">
                <h2>No run selected</h2>
                <p className="muted">Pick a run on the left, or start a new one.</p>
              </div>
            )
          )}
        </main>
      </div>

      {dialog && (
        <NewRunDialog
          config={config}
          requirementIds={requirementIds}
          onStart={(only) => start(only)}
          onClose={() => setDialog(false)}
        />
      )}
    </div>
  );
};
