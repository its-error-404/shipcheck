/** Server-wide constants: one place for ports, routes and Socket.io event names. */
export const SERVER_DEFAULTS = {
  host: "127.0.0.1",
  port: 4000,
  runsDir: "runs",
  webDir: "apps/web/dist",
} as const;

/** Socket.io events (server → client). The payload types live in live.ts. */
export const LIVE_EVENTS = {
  /** Sent on connect and whenever the active run changes. */
  status: "run:status",
  /** One trace event of the active run. */
  trace: "run:trace",
  /** All events of the active run so far, sent to a client that connects mid-run. */
  replay: "run:replay",
  started: "run:started",
  finished: "run:finished",
  failed: "run:failed",
} as const;

export const API_PREFIX = "/api";

/** Events kept for replay to late-joining clients (a full 12-requirement run emits ~1,500). */
export const REPLAY_LIMIT = 3000;
