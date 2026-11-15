/**
 * Client-side requests-per-minute limiter (sliding 60 s window).
 * Keeps us under a free-tier RPM quota proactively instead of hammering into
 * 429s. Shared by all concurrent investigations through one LlmClient.
 */
import { LLM_DEFAULTS } from "../constants/llm";
import { sleep as defaultSleep, type Sleep } from "../utils/async";

export class RateLimiter {
  private readonly stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly rpm: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = defaultSleep,
  ) {}

  /** Resolves when a request may be sent; returns how long the caller waited. */
  acquire(): Promise<number> {
    const result = this.chain.then(() => this.take());
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async take(): Promise<number> {
    if (this.rpm <= 0) return 0;
    let waited = 0;
    for (;;) {
      const t = this.now();
      while (this.stamps.length && t - this.stamps[0]! >= LLM_DEFAULTS.rateWindowMs) this.stamps.shift();
      if (this.stamps.length < this.rpm) {
        this.stamps.push(t);
        return waited;
      }
      const wait = LLM_DEFAULTS.rateWindowMs - (t - this.stamps[0]!) + 50;
      waited += wait;
      await this.sleep(wait);
    }
  }
}
