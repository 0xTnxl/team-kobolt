// "Check before you post": same checks, never changes a deal. Used by the page and @kobolt.
import { sql, getUser, type DealRow } from "./db.js";
import { briefOf } from "./deals.js";
import { checkPost, expandTikTok, parseUrl, readTikTok, runRules, type Brief, type CheckResult, type PostFacts } from "./checker/index.js";

export interface PrecheckResult {
  deal: { id: string; brandName: string; title: string } | null;
  checks: CheckResult[];
  status: "passed" | "failed" | "needs_brand";
  note: string | null;
}

export async function openDealAsCreator(userId: string, dealId?: string): Promise<DealRow | undefined> {
  const [d] = dealId
    ? await sql<DealRow[]>`SELECT * FROM deals WHERE id = ${dealId} AND creator_id = ${userId}`
    : await sql<DealRow[]>`SELECT * FROM deals WHERE creator_id = ${userId}
        AND state IN ('offered', 'accepted', 'checking', 'needs_brand') ORDER BY created_at DESC LIMIT 1`;
  return d;
}

export async function precheck(userId: string, input: { dealId?: string; caption?: string; url?: string }): Promise<PrecheckResult> {
  const d = await openDealAsCreator(userId, input.dealId);
  const creator = await getUser(userId);
  const brief: Brief = d
    ? briefOf(d, creator)
    : { platform: "tiktok", brandName: "", title: "", hashtags: [], disclosure: "#ad", avoidNames: [], avoidClaims: [], fundedAt: null, postsDueAt: null, creatorHandle: null };

  let facts: PostFacts = { platform: "tiktok", caption: input.caption ?? "", author: null, postedAt: null, live: null, reused: false, draft: true };
  if (input.url) {
    let p = parseUrl(input.url);
    if (p?.platform === "tiktok") {
      p = await expandTikTok(p).catch(() => p!);
      const t = await readTikTok(p);
      if (t.live === null) {
        return { deal: d ? { id: d.id, brandName: d.brand_name, title: d.title } : null, checks: [], status: "needs_brand", note: "Kobolt couldn't reach TikTok just now. Try again in a minute." };
      }
      facts = { platform: "tiktok", caption: t.caption, author: t.author, postedAt: t.postedAt, live: t.live, reused: false, draft: !d };
    }
  }
  const dealInfo = d ? { id: d.id, brandName: d.brand_name, title: d.title } : null;
  if (!d) {
    // No open deal: only the generic rules (ad label near the start).
    const checks = runRules(brief, facts);
    return { deal: null, checks, status: checks.some((c) => c.status === "fail") ? "failed" : "passed", note: "You have no open deal, so Kobolt only checked the ad label." };
  }
  const out = await checkPost(brief, facts);
  return { deal: dealInfo, checks: out.checks, status: out.status, note: out.note };
}
