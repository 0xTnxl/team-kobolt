export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const FAIL_COPY = "That didn't go through. Try again.";

const hits = new Map<string, number[]>();
/** Simple in-memory limiter: at most `n` calls per `windowMs` for `key`. */
export function limit(key: string, n: number, windowMs = 60_000) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= n) throw new ApiError(429, "SLOW_DOWN", "Too many tries. Wait a minute and try again.");
  list.push(now);
  hits.set(key, list);
}
