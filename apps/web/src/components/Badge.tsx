import { label } from "../format";

const TONE: Record<string, string> = {
  PASS: "good",
  READY: "good",
  FAIL: "bad",
  BLOCKED: "bad",
  INSUFFICIENT_EVIDENCE: "warn",
  NEEDS_REVIEW: "warn",
};

/** Decision or overall decision as a coloured pill. */
export const Badge = ({ value, size = "md" }: { value?: string; size?: "md" | "lg" }) =>
  value ? (
    <span className={`badge badge-${TONE[value] ?? "muted"} badge-${size}`}>{label(value)}</span>
  ) : (
    <span className={`badge badge-muted badge-${size}`}>pending</span>
  );

/** PASS / FAIL / INSUFFICIENT counts as a compact proportional bar. */
export const CountsBar = ({ counts }: { counts: { PASS: number; FAIL: number; INSUFFICIENT_EVIDENCE: number } }) => {
  const total = counts.PASS + counts.FAIL + counts.INSUFFICIENT_EVIDENCE;
  if (!total) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="counts">
      <div className="counts-bar" aria-hidden>
        <span className="seg seg-good" style={{ width: pct(counts.PASS) }} />
        <span className="seg seg-bad" style={{ width: pct(counts.FAIL) }} />
        <span className="seg seg-warn" style={{ width: pct(counts.INSUFFICIENT_EVIDENCE) }} />
      </div>
      <span className="counts-text">
        {counts.PASS} pass · {counts.FAIL} fail · {counts.INSUFFICIENT_EVIDENCE} insufficient
      </span>
    </div>
  );
};
