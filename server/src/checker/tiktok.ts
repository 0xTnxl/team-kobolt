import { execFile, execFileSync } from "node:child_process";
// Reads a public TikTok post through TikTok's oEmbed. Only *.tiktok.com is ever fetched.

export interface ParsedUrl {
  platform: "tiktok" | "instagram" | "other";
  canonical: string; // host without www./m., path without trailing slash, no query
  fetchUrl: string | null;
  videoId: string | null;
  handle: string | null;
}

export interface TikTokRead {
  caption: string;
  author: string | null;
  postedAt: Date | null;
  live: boolean | null; // null = couldn't tell
}

const isTikTokHost = (h: string) => h === "tiktok.com" || h.endsWith(".tiktok.com");

export function parseUrl(raw: string): ParsedUrl | null {
  let u: URL;
  try {
    u = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const path = u.pathname.replace(/\/+$/, "");
  const canonical = `${host}${path}`;
  if (isTikTokHost(host)) {
    const m = path.match(/^\/@([\w.]+)\/(?:video|photo)\/(\d{8,25})$/);
    return {
      platform: "tiktok",
      canonical,
      fetchUrl: `https://www.tiktok.com${path}`,
      videoId: m?.[2] ?? null,
      handle: m?.[1]?.toLowerCase() ?? null,
    };
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    return { platform: "instagram", canonical, fetchUrl: null, videoId: null, handle: null };
  }
  return { platform: "other", canonical, fetchUrl: null, videoId: null, handle: null };
}

/** Short links (vm./vt.tiktok.com, /t/...) → the full video URL. At most 3 hops, TikTok only. */
export async function expandTikTok(p: ParsedUrl): Promise<ParsedUrl> {
  if (p.platform !== "tiktok" || p.videoId) return p;
  let url = p.fetchUrl!.replace("https://www.tiktok.com", `https://${p.canonical.split("/")[0]}`);
  for (let hop = 0; hop < 3; hop++) {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "user-agent": UA } });
    const loc = r.headers.get("location");
    if (!loc) break;
    const next = new URL(loc, url);
    if (!isTikTokHost(next.hostname.toLowerCase())) break;
    const parsed = parseUrl(next.toString());
    if (parsed?.videoId) return parsed;
    url = next.toString();
  }
  return p;
}

const UA = "Mozilla/5.0 (compatible; KoboltChecker/1.0; +https://usezend.app)";
const cache = new Map<string, { at: number; v: TikTokRead }>();

export function postedAtFromId(id: string | null): Date | null {
  if (!id) return null;
  try {
    const secs = Number(BigInt(id) >> 32n);
    const d = new Date(secs * 1000);
    const y = d.getUTCFullYear();
    return y >= 2014 && y <= 2050 ? d : null;
  } catch {
    return null;
  }
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** The public post page embeds the post as JSON: caption, author, time and a status code. */
let cookies = "";
const hasCurl = (() => {
  try {
    execFileSync("curl", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** The URL is always our own https://www.tiktok.com/@handle/video/<id>; execFile never uses a shell. */
function viaCurl(url: string): Promise<string | 404 | null> {
  return new Promise((resolve) => {
    execFile(
      "curl",
      ["-s", "--max-time", "8", "-A", BROWSER_UA, "-H", "accept-language: en", "-w", "\n%{http_code}", url],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, out) => {
        if (err) return resolve(null);
        const cut = out.lastIndexOf("\n");
        const code = Number(out.slice(cut + 1));
        resolve(code === 404 ? 404 : code === 200 ? out.slice(0, cut) : null);
      },
    );
  });
}

async function viaFetch(url: string): Promise<string | 404 | null> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": BROWSER_UA, "accept-language": "en", ...(cookies ? { cookie: cookies } : {}) },
    });
    if (r.status === 404) return 404;
    const set = r.headers.getSetCookie?.() ?? [];
    if (set.length) {
      const jar = new Map(cookies.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c] as [string, string]));
      for (const c of set) jar.set(c.split("=")[0], c.split(";")[0]);
      cookies = [...jar.values()].join("; ");
    }
    return r.ok ? await r.text() : null;
  } catch {
    return null;
  }
}

const DATA = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

async function readFromPage(p: ParsedUrl): Promise<TikTokRead | null> {
  let m: RegExpMatchArray | null = null;
  // TikTok answers a cookieless first visit with a short challenge page and sets cookies; the second visit gets the post.
  // TikTok sometimes answers with a short "please wait" page instead; a few spaced retries usually get the post.
  // TikTok often answers with a short "please wait" page, and blocks Node's HTTP client outright on
  // some hosts. curl gets through far more often, so use it when present, with spaced retries.
  for (let i = 0; i < 10 && !m; i++) {
    if (i) await new Promise((r) => setTimeout(r, 250 + 150 * i));
    const html = await (hasCurl ? viaCurl(p.fetchUrl!) : viaFetch(p.fetchUrl!));
    if (html === 404) return { caption: "", author: p.handle, postedAt: postedAtFromId(p.videoId), live: false };
    if (html) m = html.match(DATA);
  }
  if (!m) return null;
  const detail = JSON.parse(m[1])?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
  if (!detail) return null;
  const item = detail.itemInfo?.itemStruct;
  if (detail.statusCode === 0 && item) {
    const created = Number(item.createTime);
    return {
      caption: String(item.desc ?? ""),
      author: String(item.author?.uniqueId ?? p.handle ?? "").toLowerCase() || null,
      postedAt: created ? new Date(created * 1000) : postedAtFromId(p.videoId),
      live: true,
    };
  }
  // 10204 "item doesn't exist", 10216/10222 private or removed.
  if ([10204, 10216, 10222, 10221].includes(Number(detail.statusCode))) {
    return { caption: "", author: p.handle, postedAt: postedAtFromId(p.videoId), live: false };
  }
  return null;
}

export async function readTikTok(p: ParsedUrl): Promise<TikTokRead> {
  const hit = cache.get(p.canonical);
  if (hit && Date.now() - hit.at < 120_000) return hit.v;
  for (let attempt = 0; attempt < 1; attempt++) {
    try {
      const v = await readFromPage(p);
      if (v) {
        cache.set(p.canonical, { at: Date.now(), v });
        return v;
      }
    } catch (e) {
      console.error(JSON.stringify({ event: "tiktok_read_error", url: p.canonical, error: String(e) }));
    }
  }
  const oembed = `https://www.tiktok.com/oembed?url=${encodeURIComponent(p.fetchUrl!)}`;
  let res: TikTokRead = { caption: "", author: p.handle, postedAt: postedAtFromId(p.videoId), live: null };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(oembed, { signal: AbortSignal.timeout(8000), headers: { "user-agent": UA } });
      if (r.status === 200) {
        const j: any = await r.json();
        // oEmbed no longer always carries the caption; without one we can't judge it.
        if (!j.title) break;
        const author = String(j.author_url ?? "").match(/@([\w.]+)/)?.[1]?.toLowerCase() ?? p.handle;
        res = { caption: String(j.title ?? ""), author, postedAt: postedAtFromId(p.videoId), live: true };
        break;
      }
      if (r.status === 400 || r.status === 404) {
        res = { ...res, live: false };
        break;
      }
    } catch {}
  }
  if (res.live !== null) cache.set(p.canonical, { at: Date.now(), v: res });
  return res;
}
