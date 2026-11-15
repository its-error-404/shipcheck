import { useState } from "react";
import type { ConfigStatus } from "../types";

interface Props {
  config?: ConfigStatus;
  requirementIds: string[];
  onStart: (only?: string[]) => Promise<void>;
  onClose: () => void;
}

/** Start a full run, or a quick demo run on a few requirements (same as the CLI's --only). */
export const NewRunDialog = ({ config, requirementIds, onStart, onClose }: Props) => {
  const [mode, setMode] = useState<"all" | "some">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ready = Boolean(config?.jira.ok && config?.llm.ok);
  const missing = [...(config?.jira.missing ?? []), ...(config?.llm.missing ?? [])];

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onStart(mode === "some" ? picked : undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal aria-label="New run" onClick={(e) => e.stopPropagation()}>
        <h3>New assessment run</h3>
        <dl className="kv">
          <dt>Release</dt>
          <dd>{config?.release ?? "—"}</dd>
          <dt>Jira</dt>
          <dd>{config?.jira.ok ? `${config.jira.site} · project ${config.jira.project}` : "not configured"}</dd>
          <dt>Model</dt>
          <dd>
            {config?.llm.ok ? `${config.llm.model} (${config.llm.provider ?? "openai-compatible"})` : "not configured"}
          </dd>
        </dl>
        {!ready && (
          <div className="notice notice-warn">
            Missing settings in .env: {missing.join(", ") || "unknown"}. Copy .env.example to .env and restart the
            server.
          </div>
        )}
        <fieldset className="choice">
          <label>
            <input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> All requirements (release
            decision)
          </label>
          <label>
            <input type="radio" checked={mode === "some"} onChange={() => setMode("some")} /> Only selected requirements
            (quick demo, not a release decision)
          </label>
        </fieldset>
        {mode === "some" && (
          <div className="picker">
            {requirementIds.length === 0 && (
              <p className="muted small">Requirement IDs appear here after the first full run.</p>
            )}
            {requirementIds.map((id) => (
              <label key={id} className={`pick ${picked.includes(id) ? "on" : ""}`}>
                <input type="checkbox" checked={picked.includes(id)} onChange={() => toggle(id)} />
                {id}
              </label>
            ))}
          </div>
        )}
        {error && <div className="notice notice-bad">{error}</div>}
        <div className="dialog-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!ready || busy || (mode === "some" && picked.length === 0)}
            onClick={submit}
          >
            {busy ? "Starting…" : "Start run"}
          </button>
        </div>
      </div>
    </div>
  );
};
