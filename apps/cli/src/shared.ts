import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TRACE_EVENTS, createJiraHttp, loadJiraConfig, type TraceSink } from "@shipcheck/core";
import { warn } from "./ui";

export const jiraHttp = (trace?: TraceSink) => {
  const cfg = loadJiraConfig();
  return {
    cfg,
    http: createJiraHttp({ baseUrl: cfg.JIRA_BASE_URL, email: cfg.JIRA_EMAIL, apiToken: cfg.JIRA_API_TOKEN, trace }),
  };
};

/** Prints Jira retries as they happen so a slow import never looks frozen. */
export const retryLogger: TraceSink = {
  emit(e) {
    if (e.type === TRACE_EVENTS.jiraRetry)
      warn(`Jira ${String(e.status)} on ${e.method} ${e.path}: retry ${e.attempt} in ${e.delayMs} ms`);
  },
};

export const writeJson = async (dir: string, name: string, data: unknown): Promise<string> => {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
};
