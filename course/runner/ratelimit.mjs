// Sliding-window rate limits: one per key, and one across all keys.
export class RateLimiter {
  constructor({ perKey, global, windowMs = 60_000, now = () => Date.now() }) {
    this.perKey = perKey;
    this.global = global;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map(); // key -> timestamps
    this.all = [];
  }

  #prune(list, cutoff) {
    while (list.length && list[0] <= cutoff) list.shift();
  }

  // Records a hit and returns { ok: true }, or { ok: false, retryAfterSeconds, scope }.
  take(key) {
    const now = this.now();
    const cutoff = now - this.windowMs;
    this.#prune(this.all, cutoff);
    const mine = this.hits.get(key) ?? [];
    this.#prune(mine, cutoff);
    const retry = (list) => Math.max(1, Math.ceil((list[0] + this.windowMs - now) / 1000));
    if (mine.length >= this.perKey) return { ok: false, retryAfterSeconds: retry(mine), scope: "sandbox" };
    if (this.all.length >= this.global) return { ok: false, retryAfterSeconds: retry(this.all), scope: "global" };
    mine.push(now);
    this.all.push(now);
    this.hits.set(key, mine);
    if (this.hits.size > 10_000) {
      for (const [k, list] of this.hits) if (!list.length || list[list.length - 1] <= cutoff) this.hits.delete(k);
    }
    return { ok: true };
  }
}
