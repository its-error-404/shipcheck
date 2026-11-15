/** Display helpers. */
export const duration = (ms?: number): string => {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export const number = (n?: number): string => (n === undefined ? "—" : n.toLocaleString("en-US"));

export const dateTime = (iso?: string): string =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const percent = (ratio?: number): string => (ratio === undefined ? "—" : `${Math.round(ratio * 100)}%`);

export const label = (value: string): string => value.replaceAll("_", " ").toLowerCase();

/** Link to an issue on the Jira site, when the site is known. */
export const issueUrl = (site: string | undefined, key: string): string | undefined =>
  site ? `${site.replace(/\/$/, "")}/browse/${key}` : undefined;
