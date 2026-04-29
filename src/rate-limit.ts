import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW } from "./config.js";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private maxTokens: number;
  private windowMs: number;

  constructor(maxTokens?: number, windowMs?: number) {
    this.maxTokens = maxTokens ?? RATE_LIMIT_MAX;
    this.windowMs = windowMs ?? RATE_LIMIT_WINDOW;
  }

  check(jid: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(jid);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(jid, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refillAmount = (elapsed / this.windowMs) * this.maxTokens;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + refillAmount);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      // Clean up stale entries periodically
      if (this.buckets.size > 1000) this.prune();
      return true;
    }

    return false;
  }

  remaining(jid: string): number {
    const bucket = this.buckets.get(jid);
    if (!bucket) return this.maxTokens;
    return Math.floor(bucket.tokens);
  }

  private prune(): void {
    const now = Date.now();
    for (const [jid, bucket] of this.buckets) {
      if (now - bucket.lastRefill > this.windowMs * 2) {
        this.buckets.delete(jid);
      }
    }
  }
}

export const defaultLimiter = new RateLimiter();
