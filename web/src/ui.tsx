import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { go, myTz } from "./api";

export function Top({ title, back, children }: { title?: string; back?: string | true; children?: ComponentChildren }) {
  return (
    <div class="top">
      {back && (
        <button class="back" aria-label="Back" onClick={() => (back === true ? history.back() : go(back))}>
          ←
        </button>
      )}
      {title ? <div class="title">{title}</div> : children}
    </div>
  );
}

export function Brand() {
  return (
    <div class="brand">
      <img src="/icon.svg" alt="" /> Kobolt
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
  offered: ["Held · waiting", "held"],
  accepted: ["Accepted", "held"],
  checking: ["Checking", "wait"],
  needs_brand: ["Needs the brand", "wait"],
  approved: ["Approved", "pass"],
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

export function CheckLine({ c }: { c: Check }) {
  const mark = c.status === "pass" ? "✓" : c.status === "fail" ? "!" : "?";
  const showQuote = c.quote && (c.status !== "pass" || c.layer === "ai");
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
