/**
 * Web server entry point: `npm run serve`, then open http://127.0.0.1:4000
 *
 * Binds to 127.0.0.1 by default: the server can start real runs with your Jira
 * token and model, so it is a local tool, not something to expose publicly.
 */
import "dotenv/config";
import { buildApp } from "./app";
import { SERVER_DEFAULTS } from "./constants";

const host = process.env.SERVER_HOST ?? SERVER_DEFAULTS.host;
const port = Number(process.env.SERVER_PORT ?? SERVER_DEFAULTS.port);

const { app, live } = await buildApp({
  runsDir: process.env.SERVER_RUNS_DIR ?? SERVER_DEFAULTS.runsDir,
  webDir: SERVER_DEFAULTS.webDir,
});

await app.listen({ host, port });
console.log(`\n  Shipcheck UI   http://${host}:${port}`);
console.log(`  API            http://${host}:${port}/api/runs\n`);

// Ctrl+C stops at once. A run in progress keeps what it saved so far
// (one file per finished requirement) and can be resumed from the UI or CLI.
const shutdown = async () => {
  if (live.status().active) console.log("  Stopping: the active run can be resumed later.");
  await app.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
