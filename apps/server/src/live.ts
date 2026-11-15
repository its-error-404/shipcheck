/**
 * Live runs: starts one assessment at a time and broadcasts its trace events
 * over Socket.io, so the web UI shows the same progress the CLI prints.
 *
 * One run at a time is deliberate: free-tier and local models are rate- or
 * GPU-bound, and two runs would share one quota and slow each other down.
 */
import {
  CallbackTrace,
  type PreparedSession,
  type SessionInfo,
  type SessionOptions,
  type SessionOutcome,
  type TraceEvent,
} from "@shipcheck/core";
import type { Server as IoServer } from "socket.io";
import { LIVE_EVENTS, REPLAY_LIMIT } from "./constants";

export interface StartRunInput {
  only?: string[];
  resume?: SessionOptions["resume"];
}

export interface ActiveRun {
  info: SessionInfo;
  startedAt: string;
}

export interface LiveStatus {
  active?: ActiveRun;
  last?: { runId: string; ok: boolean; error?: string; finishedAt: string };
}

/** Builds a prepared session. Injected so tests can use fake Jira and a scripted model. */
export type SessionFactory = (o: SessionOptions) => Promise<PreparedSession>;

export class RunBusyError extends Error {
  constructor(readonly runId: string) {
    super(`A run is already in progress (${runId}). Wait for it to finish.`);
    this.name = "RunBusyError";
  }
}

export class LiveRuns {
  private active?: ActiveRun;
  private last?: LiveStatus["last"];
  private pending?: Promise<SessionOutcome | undefined>;
  private replay: (TraceEvent & { ts: string })[] = [];

  constructor(
    private readonly io: IoServer,
    private readonly createSession: SessionFactory,
    private readonly runsDir: string,
  ) {}

  status = (): LiveStatus => ({ active: this.active, last: this.last });

  /** Events of the active run so far (empty when idle), for clients that connect mid-run. */
  events = (): readonly (TraceEvent & { ts: string })[] => (this.active ? this.replay : []);

  private broadcastStatus = () => this.io.emit(LIVE_EVENTS.status, this.status());

  /** Validates config and creates the run folder, then runs in the background. Returns the run info at once. */
  start = async (input: StartRunInput): Promise<SessionInfo> => {
    if (this.active) throw new RunBusyError(this.active.info.runId);
    const sink = new CallbackTrace((event: TraceEvent & { ts: string }) => {
      this.replay.push(event);
      if (this.replay.length > REPLAY_LIMIT) this.replay.splice(0, this.replay.length - REPLAY_LIMIT);
      this.io.emit(LIVE_EVENTS.trace, event);
    });
    const session = await this.createSession({
      only: input.only?.length ? input.only : undefined,
      resume: input.resume,
      outDir: this.runsDir,
      sinks: [sink],
    });
    const active: ActiveRun = { info: session.info, startedAt: new Date().toISOString() };
    this.replay = [];
    this.active = active;
    this.io.emit(LIVE_EVENTS.started, active);
    this.broadcastStatus();

    this.pending = session
      .run()
      .then((outcome) => {
        this.last = { runId: active.info.runId, ok: true, finishedAt: new Date().toISOString() };
        this.io.emit(LIVE_EVENTS.finished, {
          runId: active.info.runId,
          status: outcome.result.status,
          overall: outcome.result.overall,
        });
        return outcome;
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        this.last = { runId: active.info.runId, ok: false, error, finishedAt: new Date().toISOString() };
        this.io.emit(LIVE_EVENTS.failed, { runId: active.info.runId, error });
        return undefined;
      })
      .finally(() => {
        this.active = undefined;
        this.broadcastStatus();
      });
    return session.info;
  };

  /** Resolves when the current run (if any) has finished. Used by tests and graceful shutdown. */
  settled = async (): Promise<void> => {
    await this.pending;
  };
}
