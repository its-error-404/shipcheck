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

/** Collects events in memory: handy for tests and for building metrics. */
export class MemoryTrace implements TraceSink {
  readonly events: (TraceEvent & { ts: string })[] = [];
  emit(event: TraceEvent): void {
    this.events.push({ ts: new Date().toISOString(), ...event });
  }
}
