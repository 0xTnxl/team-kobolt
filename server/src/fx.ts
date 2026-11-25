import { env } from "./env.js";

// USD-based rates, cached for an hour. Used only for "about" figures; Zend's sheets show the exact amount.
let cache: { at: number; rates: Record<string, number> } | null = null;
const FALLBACK: Record<string, number> = { USD: 1, NGN: 1550, GBP: 0.79, EUR: 0.92, CAD: 1.39, GHS: 15.5, KES: 129 };

export async function rates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < 3600_000) return cache.rates;
  try {
    const r = await fetch(env.fxUrl, { signal: AbortSignal.timeout(5000) });
    const j: any = await r.json();
    if (j?.rates?.NGN) {
      cache = { at: Date.now(), rates: j.rates };
      return j.rates;
    }
  } catch {}
  return cache?.rates ?? FALLBACK;
}

export async function ngnToUsdMicro(ngn: number): Promise<bigint> {
  const r = await rates();
  return BigInt(Math.floor((ngn / r.NGN) * 1e6));
}
