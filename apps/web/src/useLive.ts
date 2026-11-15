/**
 * Live run state over Socket.io: the active run, its trace events, and a
 * callback when a run ends so the run list can refresh.
 */
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { LiveEvent, LiveStatus } from "./types";

const LIVE_EVENTS = {
  status: "run:status",
  trace: "run:trace",
  replay: "run:replay",
  started: "run:started",
  finished: "run:finished",
  failed: "run:failed",
} as const;

const MAX_EVENTS = 3000;

export interface LiveState {
  connected: boolean;
  status: LiveStatus;
  events: LiveEvent[];
}

export const useLive = (onRunEnded: () => void): LiveState => {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<LiveStatus>({});
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const ended = useRef(onRunEnded);
  useEffect(() => {
    ended.current = onRunEnded;
  });

  useEffect(() => {
    const socket = io({ transports: ["websocket", "polling"] });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on(LIVE_EVENTS.status, (s: LiveStatus) => setStatus(s));
    socket.on(LIVE_EVENTS.started, () => setEvents([]));
    socket.on(LIVE_EVENTS.replay, (list: LiveEvent[]) => setEvents(list.slice(-MAX_EVENTS)));
    socket.on(LIVE_EVENTS.trace, (e: LiveEvent) => setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), e]));
    socket.on(LIVE_EVENTS.finished, () => ended.current());
    socket.on(LIVE_EVENTS.failed, () => ended.current());
    return () => {
      socket.disconnect();
    };
  }, []);

  return { connected, status, events };
};
