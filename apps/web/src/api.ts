/** Thin client for the REST API (apps/server/src/routes/runs.ts), on axios like the Jira client. */
import axios, { type AxiosError } from "axios";
import type { ConfigStatus, LiveStatus, Msg, RunDetail, RunSummary, SessionInfo } from "./types";

const http = axios.create({ baseURL: "/api", timeout: 30_000 });

/** Surface the server's `{ error }` message instead of axios' generic one. */
http.interceptors.response.use(undefined, (err: AxiosError<{ error?: string }>) =>
  Promise.reject(new Error(err.response?.data?.error ?? err.message)),
);

const get = async <T>(path: string): Promise<T> => (await http.get<T>(path)).data;
const id = encodeURIComponent;

export const api = {
  config: () => get<ConfigStatus>("/config"),
  live: () => get<LiveStatus>("/live"),
  runs: () => get<RunSummary[]>("/runs"),
  run: (runId: string) => get<RunDetail>(`/runs/${id(runId)}`),
  transcript: (runId: string, req: string) => get<Msg[]>(`/runs/${id(runId)}/transcripts/${id(req)}`),
  reportUrl: (runId: string) => `/api/runs/${id(runId)}/report.md`,
  start: async (body: { only?: string[]; resumeFrom?: string }) => (await http.post<SessionInfo>("/runs", body)).data,
};
