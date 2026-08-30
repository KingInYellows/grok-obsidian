import { RateLimitError } from "./errors.js";

export class SubjectRateLimiter {
  readonly #limit: number;
  readonly #events = new Map<string, number[]>();
  readonly #now: () => number;

  constructor(limit: number, now: () => number = Date.now) {
    this.#limit = limit;
    this.#now = now;
  }

  consume(subject: string): void {
    const now = this.#now();
    const cutoff = now - 60_000;
    const recent = (this.#events.get(subject) ?? []).filter((value) => value > cutoff);
    if (recent.length >= this.#limit) {
      throw new RateLimitError("request rate limit exceeded");
    }
    recent.push(now);
    this.#events.set(subject, recent);
  }
}
