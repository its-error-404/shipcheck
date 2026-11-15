/**
 * Builds the Fastify app with Socket.io attached (docs/16-server.md).
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
  const io = new IoServer(app.server);
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
