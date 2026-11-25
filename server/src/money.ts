import { rates } from "./fx.js";
import type { DealRow, UserRow } from "./db.js";

const fmt = (cur: string, v: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: cur === "NGN" ? 0 : 2,
    minimumFractionDigits: cur === "NGN" ? 0 : 2,
  }).format(v);

/** "₦15,000" for a Naira viewer, "₦15,000 (about £7.80)" for anyone else. */
export async function label(usdMicro: bigint | number, viewerCurrency: string, ngnAsSet?: number | null): Promise<string> {
  const usd = Number(usdMicro) / 1e6;
  const r = await rates();
  const base = ngnAsSet != null ? fmt("NGN", ngnAsSet) : fmt("USD", usd);
  const baseCur = ngnAsSet != null ? "NGN" : "USD";
  if (viewerCurrency === baseCur || !r[viewerCurrency]) return base;
  return `${base} (about ${fmt(viewerCurrency, usd * r[viewerCurrency])})`;
}

/** The share of a deal's pot in the brand's own Naira, when it was priced in Naira. */
export function ngnShare(d: DealRow, usdMicro: bigint | number): number | null {
  if (d.pot_ngn == null || !d.pot_usd_micro) return null;
  const pot = Number(d.pot_usd_micro);
  return pot ? Math.round((Number(usdMicro) / pot) * Number(d.pot_ngn)) : null;
}

export async function dealAmount(d: DealRow, usdMicro: bigint | number, viewer: UserRow | undefined) {
  return label(usdMicro, viewer?.currency ?? "NGN", ngnShare(d, usdMicro));
}

/** "Fri 6:00pm" in the viewer's zone, plus the other person's when it differs. */
export function when(t: Date, tz: string | null | undefined, otherTz?: string | null, otherCity?: string): string {
  const f = (zone?: string | null) =>
    new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone || "Africa/Lagos" })
      .format(t)
      .replace(" am", "am")
      .replace(" pm", "pm");
  const mine = f(tz);
  if (otherTz && otherTz !== tz) {
    const theirs = f(otherTz);
    if (theirs !== mine) return `${mine} (${theirs.split(" ").slice(1).join(" ")} for ${otherCity ?? "them"})`;
  }
  return mine;
}

export function timeOnly(t: Date, tz: string | null | undefined): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz || "Africa/Lagos" })
    .format(t)
    .replace(" am", "am")
    .replace(" pm", "pm");
}
