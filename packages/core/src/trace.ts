/**
 * Minimal trace interface. Every layer (Jira HTTP, tools, agent loop) emits
 * structured events through a TraceSink. Module 14 adds JSONL and live
 * (Socket.io) sinks; the core only depends on this interface.
 */
export interface TraceEvent {
  type: string;
  [key: string]: unknown;
}

export interface TraceSink {
  emit(event: TraceEvent): void;
}

export const noopTrace: TraceSink = { emit: () => {} };

/** Fans one event out to several sinks (e.g. JSONL file + memory for metrics + live UI). */
export class TeeTrace implements TraceSink {
  constructor(private readonly sinks: readonly TraceSink[]) {}
  emit(event: TraceEvent): void {
    for (const sink of this.sinks) sink.emit(event);
  }
}

/** Calls a function for every event (e.g. console progress, Socket.io broadcast). */
export class CallbackTrace implements TraceSink {
  constructor(private readonly onEvent: (event: TraceEvent & { ts: string }) => void) {}
  emit(event: TraceEvent): void {
    this.onEvent({ ts: new Date().toISOString(), ...event });
  }
}

/** Collects events in memory: handy for tests and for building metrics. */
export class MemoryTrace implements TraceSink {
  readonly events: (TraceEvent & { ts: string })[] = [];
  emit(event: TraceEvent): void {
    this.events.push({ ts: new Date().toISOString(), ...event });
  }
}
