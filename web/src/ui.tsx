import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { go, myTz } from "./api";

const ICONS = {
  back: <path d="M15 5.5 8.5 12l6.5 6.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: <path d="M12 6.5v7M12 17.5v.01" />,
  question: <path d="M9.3 9.2a2.8 2.8 0 1 1 3.9 2.6c-.7.3-1.2.9-1.2 1.7v.4M12 17.5v.01" />,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
};
export function Icon({ name, size }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width={2.6} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function Top({ title, back, children }: { title?: string; back?: string | true; children?: ComponentChildren }) {
  return (
    <div class="top">
      {back && (
        <button class="back" aria-label="Back" onClick={() => (back === true ? history.back() : go(back))}>
          <Icon name="back" />
        </button>
      )}
      {title ? <div class="title">{title}</div> : children}
    </div>
  );
}

export function Brand() {
  return (
    <div class="brand">
      <img class="wordmark" src="/kobolt.svg" alt="Kobolt" width="388" height="84" />
    </div>
  );
}

const city = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");

function fmt(d: Date, tz: string, withDay: boolean) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...(withDay ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(d);
  return parts.replace(/\s?(am|pm)/i, (m) => m.trim().toLowerCase()).replace(":00", "");
}

function sameDay(d: Date, tz: string) {
  const f = (x: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeZone: tz }).format(x);
  return f(d) === f(new Date());
}

/** "Fri 6pm (5pm in London)" — local time, plus the other person's when it differs. */
export function when(iso: string | Date | null | undefined, otherTz?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const tz = myTz();
  const mine = sameDay(d, tz) ? `today ${fmt(d, tz, false)}` : fmt(d, tz, true);
  if (otherTz && otherTz !== tz) {
    const theirs = fmt(d, otherTz, false);
    if (theirs !== fmt(d, tz, false)) return `${mine} (${theirs} in ${city(otherTz)})`;
  }
  return mine;
}
export const clock = (iso: string | Date | null | undefined) => (iso ? fmt(new Date(iso), myTz(), false) : "");

export function useNow(ms = 1000) {
  const [now, set] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => set(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function countdown(to: string | Date, now: number) {
  const s = Math.max(0, Math.round((new Date(to).getTime() - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${ss}`;
}

export const STATE_CHIP: Record<string, [string, string]> = {
  new: ["Not sent yet", "grey"],
  offered: ["Waiting to accept", "held"],
  accepted: ["Posting", "held"],
  checking: ["Kobolt is reading", "wait"],
  needs_brand: ["Brand decides", "wait"],
  approved: ["Paying soon", "pass"],
  paid: ["Paid", "pass"],
  part_paid: ["Part paid", "pass"],
  returned: ["Returned", "grey"],
  stopped: ["Stopped", "grey"],
  closed: ["Closed", "grey"],
  expired: ["Returned", "grey"],
};

export function Chip({ state, label }: { state: string; label?: string }) {
  const [text, cls] = STATE_CHIP[state] ?? [state, "grey"];
  return <span class={`chip ${cls}`}>{label ?? text}</span>;
}

export function Avatar({ name, src, blue }: { name?: string | null; src?: string | null; blue?: boolean }) {
  return <div class={`avatar ${blue ? "blue" : ""}`}>{src ? <img src={src} alt="" /> : (name ?? "?").trim().charAt(0).toUpperCase()}</div>;
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet">
        <div class="grab" />
        {children}
      </div>
    </div>
  );
}

let toastSet: ((s: string | null) => void) | null = null;
export function toast(s: string) {
  toastSet?.(s);
  setTimeout(() => toastSet?.(null), 2600);
}
export function Toaster() {
  const [t, set] = useState<string | null>(null);
  toastSet = set;
  return t ? <div class="toast">{t}</div> : null;
}

export interface Check {
  id: string;
  layer: "rule" | "ai";
  status: "pass" | "fail" | "unknown" | "unclear";
  label: string;
  quote: string | null;
  why: string | null;
  fix: string | null;
}

export function CheckLine({ c, inline }: { c: Check; inline?: boolean }) {
  const mark = <Icon name={c.status === "pass" ? "check" : c.status === "fail" ? "alert" : "question"} />;
  const showQuote = !inline && c.quote && (c.status !== "pass" || c.layer === "ai");
  return (
    <div class="check">
      <div class={`ic ${c.status}`}>{mark}</div>
      <div class="grow">
        <div>{c.label}</div>
        {showQuote && <div class={`quote ${c.status}`}>“{c.quote}”</div>}
        {c.status !== "pass" && c.why && <div class="small muted">{c.why}</div>}
        {c.fix && <div class="fix">Fix: {c.fix}</div>}
      </div>
    </div>
  );
}

export function Running({ label }: { label: string }) {
  return (
    <div class="check">
      <div class="ic run" />
      <div class="grow">
        <div>{label}</div>
        <div class="tiny muted">reading…</div>
      </div>
    </div>
  );
}

export function ErrorBox({ text }: { text: string | null }) {
  return text ? <div class="err">{text}</div> : null;
}

/** Rubber stamp. Pass `by` for a brand's own approval; default is Kobolt's. */
export function Stamp({ by, small }: { by?: string; small?: boolean }) {
  return (
    <span class={`stamp ${by ? "brand" : ""} ${small ? "small" : ""}`} aria-label={by ? `Approved by ${by}` : "Checked by Kobolt"}>
      <span class="stamp-in">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="3" /><path d="M12 2.5v4M12 17.5v4" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
        <span>{by ? <>Approved<small>by {by}</small></> : <>Checked<small>by Kobolt</small></>}</span>
      </span>
    </span>
  );
}

type Mark = { start: number; end: number; status: Check["status"]; id: string };

/** Where each check's quote sits in the caption. Overlaps keep the earlier, worse mark. */
function findMarks(caption: string, checks: Check[]): Mark[] {
  const low = caption.toLowerCase();
  const rank = (s: string) => (s === "fail" ? 0 : s === "pass" ? 2 : 1);
  const found: Mark[] = [];
  for (const c of [...checks].sort((a, b) => rank(a.status) - rank(b.status))) {
    const q = c.quote?.trim().replace(/^[“"]|[”"]$/g, "");
    if (!q || q.length < 2) continue;
    const at = low.indexOf(q.toLowerCase());
    if (at < 0) continue;
    const m = { start: at, end: at + q.length, status: c.status, id: c.id };
    if (!found.some((f) => m.start < f.end && f.start < m.end)) found.push(m);
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The creator's caption, as Kobolt read it. While checking, the words light up one by one; once
 * the checks are in, each quoted phrase is marked where it was found.
 */
export function MarkedCaption({ caption, checks, reading }: { caption: string; checks: Check[]; reading: boolean }) {
  if (reading) {
    const words = caption.split(/(\s+)/);
    let n = 0;
    return (
      <p class="caption reading">
        {words.map((w) => (/^\s+$/.test(w) ? w : <span style={{ animationDelay: `${Math.min(n++, 60) * 55}ms` }}>{w}</span>))}
      </p>
    );
  }
  const marks = findMarks(caption, checks);
  const out: ComponentChildren[] = [];
  let at = 0;
  marks.forEach((m, i) => {
    if (m.start > at) out.push(caption.slice(at, m.start));
    out.push(<mark class={`m-${m.status}`} style={{ animationDelay: `${120 + i * 160}ms` }}>{caption.slice(m.start, m.end)}</mark>);
    at = m.end;
  });
  out.push(caption.slice(at));
  return <p class="caption">{out}</p>;
}
