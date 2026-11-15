/**
 * REST API over run folders and the live run manager.
 *
 *   GET  /api/health                         liveness
 *   GET  /api/config                         which settings are present (never values of secrets)
 *   GET  /api/runs                           run summaries, newest first
 *   GET  /api/runs/:id                       report, metrics, requirements, evaluation
 *   GET  /api/runs/:id/report.md             the Markdown report
 *   GET  /api/runs/:id/trace                 trace events
 *   GET  /api/runs/:id/transcripts/:req      one investigation's conversation
 *   GET  /api/live                           active run status
 *   POST /api/runs  { only?: string[], resumeFrom?: string }   start a run (409 when busy)
 */
import { RunNotFoundError, RunStore, isSafeName, loadAssessConfig, type RunReader } from "@shipcheck/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { join } from "node:path";
import { API_PREFIX } from "../constants";
import { RunBusyError, type LiveRuns } from "../live";

export interface RunRoutesDeps {
  reader: RunReader;
  live: LiveRuns;
  runsDir: string;
  env: NodeJS.ProcessEnv;
}

const REQUIREMENT_ID = /^[A-Za-z0-9_-]{1,40}$/;

const notFound = (reply: FastifyReply, err: unknown) => {
  if (err instanceof RunNotFoundError) return reply.code(404).send({ error: err.message });
  throw err;
};

/** Reports whether each config group is usable, with only non-secret details. */
const configStatus = (env: NodeJS.ProcessEnv) => {
  const has = (k: string) => Boolean(env[k]?.trim());
  const jiraKeys = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_PROJECT_KEY"];
  const llmKeys = ["LLM_BASE_URL", "LLM_MODEL"];
  const assess = loadAssessConfig(env);
  return {
    jira: {
      ok: jiraKeys.every(has),
      missing: jiraKeys.filter((k) => !has(k)),
      site: env.JIRA_BASE_URL,
      project: env.JIRA_PROJECT_KEY,
    },
    llm: {
      ok: llmKeys.every(has),
      missing: llmKeys.filter((k) => !has(k)),
      provider: env.LLM_PROVIDER,
      model: env.LLM_MODEL,
    },
    release: assess.ASSESS_RELEASE,
    scopeLabel: assess.ASSESS_SCOPE_LABEL,
  };
};

export const registerRunRoutes = (app: FastifyInstance, deps: RunRoutesDeps) => {
  const { reader, live, runsDir, env } = deps;

  app.get(`${API_PREFIX}/health`, async () => ({ ok: true }));
  app.get(`${API_PREFIX}/config`, async () => configStatus(env));
  app.get(`${API_PREFIX}/live`, async () => live.status());
  app.get(`${API_PREFIX}/runs`, async () => reader.list());

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/runs/:id`, async (req, reply) =>
    reader.get(req.params.id).catch((err) => notFound(reply, err)),
  );

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/runs/:id/report.md`, async (req, reply) => {
    const md = await reader.report(req.params.id).catch((err) => notFound(reply, err));
    return reply.type("text/markdown; charset=utf-8").send(md);
  });

  app.get<{ Params: { id: string } }>(`${API_PREFIX}/runs/:id/trace`, async (req, reply) =>
    reader.trace(req.params.id).catch((err) => notFound(reply, err)),
  );

  app.get<{ Params: { id: string; req: string } }>(`${API_PREFIX}/runs/:id/transcripts/:req`, async (req, reply) =>
    reader.transcript(req.params.id, req.params.req).catch((err) => notFound(reply, err)),
  );

  app.post<{ Body: { only?: unknown; resumeFrom?: unknown } | undefined }>(`${API_PREFIX}/runs`, async (req, reply) => {
    const body = req.body ?? {};
    const only = Array.isArray(body.only) ? body.only.map(String) : undefined;
    if (only?.some((id) => !REQUIREMENT_ID.test(id)))
      return reply.code(400).send({ error: "only must be a list of requirement IDs such as REQ-04." });
    let resume;
    if (body.resumeFrom !== undefined) {
      const from = String(body.resumeFrom);
      if (!isSafeName(from)) return reply.code(400).send({ error: "resumeFrom must be a run id." });
      resume = await RunStore.loadResume(join(runsDir, from));
      if (resume.size === 0) return reply.code(400).send({ error: `No saved results in run ${from}.` });
    }
    try {
      const info = await live.start({ only, resume });
      return reply.code(202).send(info);
    } catch (err) {
      if (err instanceof RunBusyError) return reply.code(409).send({ error: err.message, runId: err.runId });
      // Config errors (missing Jira/LLM settings) are the user's to fix: show the message.
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
};
