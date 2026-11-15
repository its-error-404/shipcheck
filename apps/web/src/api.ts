/** Thin client for the REST API (apps/server/src/routes/runs.ts). */
import type { ConfigStatus, LiveStatus, Msg, RunDetail, RunSummary, SessionInfo } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
};

export const api = {
  config: () => request<ConfigStatus>("/config"),
  live: () => request<LiveStatus>("/live"),
  runs: () => request<RunSummary[]>("/runs"),
  run: (id: string) => request<RunDetail>(`/runs/${encodeURIComponent(id)}`),
  transcript: (id: string, req: string) =>
    request<Msg[]>(`/runs/${encodeURIComponent(id)}/transcripts/${encodeURIComponent(req)}`),
  reportUrl: (id: string) => `/api/runs/${encodeURIComponent(id)}/report.md`,
  start: (body: { only?: string[]; resumeFrom?: string }) =>
    request<SessionInfo>("/runs", { method: "POST", body: JSON.stringify(body) }),
};
