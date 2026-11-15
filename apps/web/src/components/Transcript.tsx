import { useEffect, useState } from "react";
import { api } from "../api";
import type { Msg } from "../types";

const PREVIEW_CHARS = 600;

const ToolResult = ({ name, content }: { name: string; content: string }) => {
  const [open, setOpen] = useState(false);
  const long = content.length > PREVIEW_CHARS;
  return (
    <div className="msg msg-tool">
      <div className="msg-role">← {name}</div>
      <pre>{open || !long ? content : `${content.slice(0, PREVIEW_CHARS)}…`}</pre>
      {long && (
        <button className="link" type="button" onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show all (${content.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  );
};

/** One investigation's conversation: the task, each tool call the model chose, and what the tool returned. */
export const Transcript = ({ runId, requirement }: { runId: string; requirement: string }) => {
  const [msgs, setMsgs] = useState<Msg[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.transcript(runId, requirement).then(setMsgs, (e: Error) => setError(e.message));
  }, [runId, requirement]);

  if (error) return <p className="muted small">No transcript saved for this requirement.</p>;
  if (!msgs) return <p className="muted small">Loading transcript…</p>;
  return (
    <div className="transcript">
      {msgs.map((m, i) => {
        if (m.role === "tool") return <ToolResult key={i} name={m.name} content={m.content} />;
        if (m.role === "user")
          return (
            <div key={i} className="msg msg-user">
              <div className="msg-role">Task</div>
              <pre>{m.content}</pre>
            </div>
          );
        return (
          <div key={i} className="msg msg-assistant">
            <div className="msg-role">Agent</div>
            {m.content && <pre>{m.content}</pre>}
            {m.toolCalls?.map((t) => (
              <div key={t.id} className="tool-call">
                <span className="mono strong">{t.name}</span>
                <code>{JSON.stringify(t.args)}</code>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};
