import { dateTime } from "../format";
import type { RunSummary } from "../types";
import { Badge } from "./Badge";

interface Props {
  runs: RunSummary[];
  selected?: string;
  activeRunId?: string;
  onSelect: (id: string) => void;
}

const stateNote = (r: RunSummary, activeRunId?: string): string | undefined => {
  if (r.id === activeRunId) return "running";
  if (r.state === "incomplete") return "incomplete";
  if (r.state === "aborted") return "aborted";
  if (r.partial) return `partial · ${r.partial.selected.length}/${r.partial.total}`;
  return undefined;
};

export const RunList = ({ runs, selected, activeRunId, onSelect }: Props) => (
  <nav className="run-list" aria-label="Runs">
    <div className="section-title">Runs</div>
    {runs.length === 0 && <p className="muted small pad">No runs yet. Start one with “New run”.</p>}
    {runs.map((r) => {
      const note = stateNote(r, activeRunId);
      return (
        <button
          key={r.id}
          className={`run-item ${r.id === selected ? "selected" : ""}`}
          onClick={() => onSelect(r.id)}
          type="button"
        >
          <div className="run-item-top">
            <span className="run-item-title">{r.release ?? r.id}</span>
            <Badge value={r.overall?.decision} />
          </div>
          <div className="run-item-meta">
            <span>{dateTime(r.startedAt)}</span>
            {r.model && <span className="mono">{r.model}</span>}
          </div>
          <div className="run-item-meta">
            <span>
              {r.counts.PASS}/{r.counts.FAIL}/{r.counts.INSUFFICIENT_EVIDENCE}
              <span className="muted"> pass/fail/insuff.</span>
            </span>
            {note && <span className={`chip ${note === "running" ? "chip-live" : ""}`}>{note}</span>}
          </div>
        </button>
      );
    })}
  </nav>
);
