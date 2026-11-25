import { init, ZendError, type Zend } from "@zendfi/appkit";

export const zend: Zend = init();
export { ZendError };

export interface Me {
  appUserId: string;
  username: string | null;
  name: string;
  avatar: string | null;
  currency: string;
  timeZone: string | null;
  tiktokHandle: string | null;
  showEarnings: boolean;
}

let token: string | null = sessionStorage.getItem("kb_token");
export let me: Me | null = null;
export const setMe = (m: Me) => (me = m);

const EURO = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ");
export function guessCurrency(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const region = (navigator.language.split("-")[1] ?? "").toUpperCase();
  if (tz === "Europe/London" || region === "GB") return "GBP";
  if (tz === "Africa/Lagos" || region === "NG") return "NGN";
  if (region === "US" || tz.startsWith("America/New_York") || tz.startsWith("America/Los_Angeles") || tz.startsWith("America/Chicago")) return "USD";
  if (region === "CA" || tz === "America/Toronto") return "CAD";
  if (region === "GH" || tz === "Africa/Accra") return "GHS";
  if (region === "KE" || tz === "Africa/Nairobi") return "KES";
  if (region === "ZA" || tz === "Africa/Johannesburg") return "ZAR";
  if (EURO.includes(region) || tz.startsWith("Europe/")) return "EUR";
  return "NGN";
}
export const myTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Africa/Lagos";

export class ApiFail extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function signIn(): Promise<Me> {
  const id = await zend.identity.get();
  const r = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appSession: id.appSession, timeZone: myTz(), currency: guessCurrency() }),
  });
  const j = await r.json();
  if (!r.ok) throw new ApiFail(j.error, j.message);
  token = j.token;
  sessionStorage.setItem("kb_token", j.token);
  me = j.me;
  return j.me;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}, retried = false): Promise<T> {
  const r = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { ...(opts.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401 && !retried && zend.environment !== "external") {
    await signIn();
    return api(path, opts, true);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFail(j.error ?? "SERVER", j.message ?? "That didn't go through. Try again.");
  return j as T;
}

export const go = (path: string) => {
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
};

export function zendMessage(e: any, ctx: { creator?: string; brand?: string; max?: string } = {}): string | null {
  const code = e?.code ?? e?.error;
  switch (code) {
    case "USER_CANCELLED":
      return null;
    case "APP_LIMIT_AMOUNT":
      return `That's more than a deal can hold today: up to about ${ctx.max ?? "$20"}.`;
    case "BELOW_MINIMUM":
    case "INVALID_AMOUNT":
      return "A deal needs to hold at least about $1.";
    case "APP_GAS_BUDGET":
    case "SPONSOR_PAUSED":
      return "Kobolt can't start deals right now. Try again later.";
    case "JOIN_CLOSED":
      return `This offer has closed. The money went back to ${ctx.brand ?? "the brand"}.`;
    case "NOT_CONNECTED":
      return "Open Kobolt once from Zend, then try again.";
    case "BUSY":
      return "Zend is showing another screen. Finish that first.";
    default:
      return e instanceof ApiFail ? e.message : "That didn't go through. Try again.";
  }
}
