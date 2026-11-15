/**
 * Client-side requests-per-minute limiter (sliding 60 s window).
 * Keeps us under a free-tier RPM quota proactively instead of hammering into
 * 429s. Shared by all concurrent investigations through one LlmClient.
 */
export class RateLimiter {
  private readonly stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly rpm: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
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
      while (this.stamps.length && t - this.stamps[0]! >= 60_000) this.stamps.shift();
      if (this.stamps.length < this.rpm) {
        this.stamps.push(t);
        return waited;
      }
      const wait = 60_000 - (t - this.stamps[0]!) + 50;
      waited += wait;
      await this.sleep(wait);
    }
  }
}
