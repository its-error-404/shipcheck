/**
 * Builds the Fastify app with Socket.io attached (docs/DESIGN.md).
 * Kept separate from index.ts so tests can build it on a random port.
 */
import fastifyStatic from "@fastify/static";
import { RunReader, prepareSession } from "@shipcheck/core";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Server as IoServer } from "socket.io";
import { API_PREFIX, LIVE_EVENTS, SERVER_DEFAULTS } from "./constants";
import { LiveRuns, type SessionFactory } from "./live";
import { registerRunRoutes } from "./routes/runs";

/**
 * Only the UI's own page may start runs or listen to them. Browsers send an Origin
 * header on cross-site requests; without this check any website you visit could
 * POST to localhost or open a WebSocket to it. Requests with no Origin (curl, the
 * CLI, tests) are allowed: they are not driven by a web page.
 */
const isLocalOrigin = (origin: string | undefined): boolean =>
  origin === undefined || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);

export interface AppOptions {
  runsDir?: string;
  /** Built web UI to serve at /. Skipped when the folder does not exist (API-only). */
  webDir?: string;
  createSession?: SessionFactory;
  env?: NodeJS.ProcessEnv;
  logger?: boolean;
}

export interface ShipcheckApp {
  app: FastifyInstance;
  io: IoServer;
  live: LiveRuns;
}

export const buildApp = async (o: AppOptions = {}): Promise<ShipcheckApp> => {
  const runsDir = resolve(o.runsDir ?? SERVER_DEFAULTS.runsDir);
  const env = o.env ?? process.env;
  const app = Fastify({ logger: o.logger ?? false });
  const io = new IoServer(app.server, { allowRequest: (req, done) => done(null, isLocalOrigin(req.headers.origin)) });

  // JSON only: a cross-site form or text/plain POST would otherwise skip the browser's CORS preflight.
  app.removeContentTypeParser("text/plain");
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "GET" && !isLocalOrigin(req.headers.origin))
      return reply.code(403).send({ error: "Requests from other websites are not allowed." });
  });
  const live = new LiveRuns(io, o.createSession ?? ((s) => prepareSession({ ...s, env })), runsDir);

  io.on("connection", (socket) => {
    socket.emit(LIVE_EVENTS.status, live.status());
    const events = live.events();
    if (events.length) socket.emit(LIVE_EVENTS.replay, events);
  });

  registerRunRoutes(app, { reader: new RunReader(runsDir), live, runsDir, env });

  const webDir = o.webDir ? resolve(o.webDir) : undefined;
  if (webDir && existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir });
    // Client-side routes fall back to index.html; unknown API paths stay 404 JSON.
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith(API_PREFIX) ? reply.code(404).send({ error: "Not found" }) : reply.sendFile("index.html"),
    );
  }

  app.addHook("onClose", async () => {
    await new Promise<void>((done) => io.close(() => done()));
  });
  return { app, io, live };
};
