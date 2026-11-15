import { useState } from "react";
import { dateTime, duration, issueUrl, label, number } from "../format";
import type { EvidenceItem, RequirementResult } from "../types";
import { Badge } from "./Badge";
import { Transcript } from "./Transcript";

const STANCE_TONE: Record<string, string> = {
  supports_pass: "good",
  supports_fail: "bad",
  context: "muted",
};

const IssueLink = ({ site, issueKey }: { site?: string; issueKey: string }) => {
  const href = issueUrl(site, issueKey);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="mono">
      {issueKey}
    </a>
  ) : (
    <span className="mono">{issueKey}</span>
  );
};

const Evidence = ({ e, site }: { e: EvidenceItem; site?: string }) => (
  <li className="evidence">
    <div className="evidence-head">
      <span className={`dot dot-${STANCE_TONE[e.stance] ?? "muted"}`} title={label(e.stance)} />
      <IssueLink site={site} issueKey={e.issueKey} />
      {e.sourceId && <span className="muted mono">{e.sourceId}</span>}
      {e.commentId && <span className="muted small">comment {e.position ?? e.commentId}</span>}
      <span className="spacer" />
      {e.actor && (
        <span className="small">
          {e.actor}
          {e.role && <span className="muted"> · {e.role}</span>}
        </span>
      )}
      {e.recordedAt && <span className="muted small">{dateTime(e.recordedAt)}</span>}
    </div>
    {e.excerpt && <blockquote>{e.excerpt}</blockquote>}
    <p className="small">
      <span className="muted">{label(e.stance)}: </span>
      {e.why}
    </p>
  </li>
);

/** Full result for one requirement: decision, reasoning, cited Jira evidence, gaps and the agent's transcript. */
export const RequirementPanel = ({ r, runId, site }: { r: RequirementResult; runId: string; site?: string }) => {
  const [showTranscript, setShowTranscript] = useState(false);
  const id = r.sourceId ?? r.key;
  return (
    <div className="req-panel">
      <div className="req-panel-head">
        <div>
          <div className="eyebrow">
            <IssueLink site={site} issueKey={r.key} /> · {r.mandatory === false ? "optional" : "mandatory"}
            {r.status !== "decided" && <span className="chip">{label(r.status)}</span>}
          </div>
          <h3>{r.summary.replace(/^\[[^\]]+\]\s*/, "")}</h3>
          {r.criterion && <p className="muted">{r.criterion}</p>}
        </div>
        <Badge value={r.decision} size="lg" />
      </div>

      <section>
        <h4>Why</h4>
        <p>{r.explanation}</p>
      </section>

      {r.evidence.length > 0 && (
        <section>
          <h4>Evidence from Jira ({r.evidence.length})</h4>
          <ul className="evidence-list">
            {r.evidence.map((e, i) => (
              <Evidence key={`${e.issueKey}-${e.commentId ?? i}`} e={e} site={site} />
            ))}
          </ul>
        </section>
      )}

      {(r.outstanding.length > 0 || r.anomalies.length > 0) && (
        <div className="two-col">
          {r.outstanding.length > 0 && (
            <section>
              <h4>Outstanding</h4>
              <ul className="plain">
                {r.outstanding.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </section>
          )}
          {r.anomalies.length > 0 && (
            <section>
              <h4>Anomalies</h4>
              <ul className="plain">
                {r.anomalies.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {r.agent && (
        <section className="agent-stats">
          <span>{r.agent.turns} turns</span>
          <span>{r.agent.toolCalls} tool calls</span>
          {r.agent.toolErrors > 0 && <span>{r.agent.toolErrors} rejected</span>}
          <span>{number(r.agent.inputTokens + r.agent.outputTokens)} tokens</span>
          <span>{duration(r.agent.durationMs)}</span>
          <span className="muted">stop: {label(r.agent.stopReason)}</span>
          <span className="spacer" />
          <button className="btn btn-ghost" type="button" onClick={() => setShowTranscript(!showTranscript)}>
            {showTranscript ? "Hide transcript" : "Show agent transcript"}
          </button>
        </section>
      )}
      {showTranscript && <Transcript runId={runId} requirement={id} />}
    </div>
  );
};
