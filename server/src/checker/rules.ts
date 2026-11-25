// Code rules. A failed rule is final; an unknown one goes to the brand.

export type RuleStatus = "pass" | "fail" | "unknown";
export type AiStatus = "pass" | "fail" | "unclear";

export interface CheckResult {
  id: string;
  layer: "rule" | "ai";
  status: RuleStatus | AiStatus;
  label: string;
  quote: string | null;
  why: string | null;
  fix: string | null;
}

export interface Brief {
  platform: "tiktok" | "instagram";
  brandName: string;
  title: string;
  hashtags: string[];
  disclosure: string;
  avoidNames: string[];
  avoidClaims: string[];
  fundedAt: Date | null;
  postsDueAt: Date | null;
  creatorHandle: string | null;
}

export interface PostFacts {
  platform: "tiktok" | "instagram" | "other";
  caption: string;
  author: string | null;
  postedAt: Date | null;
  live: boolean | null;
  reused: boolean;
  draft: boolean; // "check before you post": skip the rules that need a real post
}

const ZW = /[\u200B-\u200D\u2060\uFEFF]/g;
const HASHTAG = /#[\p{L}\p{M}\p{N}_\u200B-\u200D\u2060\uFEFF]+/gu;

export const FIX: Record<string, string> = {
  PLATFORM: "Share a TikTok link for this deal.",
  POSTED_BY_YOU: "Share a post from your own TikTok, or fix your TikTok name in Kobolt settings.",
  NEW_POST: "Make a new post for this deal before the deadline, then share it.",
  STILL_UP: "Make sure the post is public, then share it again.",
  NOT_REUSED: "Make a new post for this deal.",
  HASHTAGS: "Add the hashtags exactly as written, then share again.",
  AD_LABEL: "Put the ad label in the first line, then share again.",
  NO_COMPETITOR: "Take out the name they asked you not to mention, then share again.",
  AD_IS_REAL: "Say it's an ad plainly, then share again.",
  ABOUT_PRODUCT: "Talk about what the brand is paying you to show, then share again.",
  NO_HINTS: "Don't point at other shops, even without naming them.",
  NO_CLAIMS: "Take out the claim they asked you not to make, then share again.",
};

export function hashtagTokens(text: string): { tag: string; index: number }[] {
  const s = text.normalize("NFC");
  const out: { tag: string; index: number }[] = [];
  for (const m of s.matchAll(HASHTAG)) out.push({ tag: m[0].toLowerCase(), index: m.index ?? 0 });
  return out;
}

export function normTag(t: string): string {
  const s = t.trim().normalize("NFC").toLowerCase();
  return s.startsWith("#") ? s : `#${s}`;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentions(caption: string, name: string): string | null {
  const text = caption.normalize("NFKC").replace(ZW, "");
  const n = name.normalize("NFKC").replace(ZW, "").trim();
  if (!n) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
  const m = text.match(re);
  return m ? m[0] : null;
}

const r = (id: string, status: RuleStatus, label: string, why: string | null = null, quote: string | null = null): CheckResult => ({
  id,
  layer: "rule",
  status,
  label,
  quote,
  why,
  fix: status === "fail" ? FIX[id] : null,
});

export function runRules(b: Brief, p: PostFacts): CheckResult[] {
  const out: CheckResult[] = [];
  const isTikTok = b.platform === "tiktok";
  const appName = isTikTok ? "TikTok" : "Instagram";

  if (!p.draft) {
    out.push(
      r("PLATFORM", p.platform === b.platform ? "pass" : "fail", `On ${appName}`,
        p.platform === b.platform ? null : `This link isn't a ${appName} post.`),
    );
    if (isTikTok && p.platform === "tiktok") {
      if (!b.creatorHandle || !p.author) {
        out.push(r("POSTED_BY_YOU", "unknown", "Posted from your account", "Kobolt couldn't read who posted it."));
      } else {
        const ok = p.author.toLowerCase() === b.creatorHandle.toLowerCase();
        out.push(r("POSTED_BY_YOU", ok ? "pass" : "fail", "Posted from your account",
          ok ? null : `Posted by @${p.author}, not @${b.creatorHandle}.`));
      }
      if (!p.postedAt || !b.fundedAt || !b.postsDueAt) {
        out.push(r("NEW_POST", "unknown", "Posted after the offer, before the deadline", "Kobolt couldn't read when it was posted."));
      } else {
        const early = p.postedAt.getTime() < b.fundedAt.getTime() - 5 * 60_000;
        const late = p.postedAt.getTime() > b.postsDueAt.getTime();
        out.push(r("NEW_POST", early || late ? "fail" : "pass", "Posted after the offer, before the deadline",
          early ? "This post went up before the deal started." : late ? "This post went up after the deadline." : null));
      }
      out.push(
        r("STILL_UP", p.live === null ? "unknown" : p.live ? "pass" : "fail", "Still up",
          p.live === null ? "Kobolt couldn't reach TikTok." : p.live ? null : "The post is deleted or private."),
      );
    }
    out.push(r("NOT_REUSED", p.reused ? "fail" : "pass", "Not used in another deal",
      p.reused ? "This post already got paid in another deal." : null));
  }

  if (b.hashtags.length) {
    const have = new Set(hashtagTokens(p.caption).map((t) => t.tag));
    const missing = b.hashtags.filter((t) => !have.has(normTag(t)));
    out.push(r("HASHTAGS", missing.length ? "fail" : "pass", `Has ${b.hashtags.join(" ")}`,
      missing.length ? `Missing ${missing.join(" ")} (written exactly like that).` : null));
  }

  if (b.disclosure.trim()) {
    const d = b.disclosure.trim();
    let ok: boolean;
    if (d.startsWith("#")) {
      ok = hashtagTokens(p.caption).some((t) => t.tag === normTag(d) && t.index < 125);
    } else {
      const head = p.caption.normalize("NFC").slice(0, 125 + d.length);
      ok = mentions(head, d) !== null;
    }
    out.push(r("AD_LABEL", ok ? "pass" : "fail", `Says ${d} near the start`,
      ok ? null : `${d} isn't in the first line.`));
  }

  for (const name of b.avoidNames) {
    const hit = mentions(p.caption, name);
    out.push(r("NO_COMPETITOR", hit ? "fail" : "pass", `Doesn't mention ${name}`,
      hit ? `Mentions ${name}.` : null, hit));
  }
  return out;
}
