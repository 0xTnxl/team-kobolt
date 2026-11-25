import { sql, logEvent, getUser, getDeal, livePosts, type DealRow, type PostRow } from "./db.js";
import { ApiError } from "./errors.js";
import { setState } from "./states.js";
import { queue } from "./outbox.js";
import { briefOf } from "./deals.js";
import { timeOnly } from "./money.js";
import { checkPost, expandTikTok, parseUrl, readTikTok, type ParsedUrl, type PostFacts } from "./checker/index.js";
import { maybeSendResult } from "./result.js";

const TAKING_POSTS = ["accepted", "checking", "needs_brand"];

export async function sharePosts(d: DealRow, urls: string[], captions: string[] = []): Promise<DealRow> {
  if (!TAKING_POSTS.includes(d.state) || d.result_sent_at) {
    throw new ApiError(409, "NOT_TAKING_POSTS", "This deal isn't taking posts right now.");
  }
  if (Date.now() > d.posts_due_at.getTime()) throw new ApiError(409, "PAST_DEADLINE", "The deadline for posts has passed.");
  const jobs: { post: PostRow; parsed: ParsedUrl; caption: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.min(urls.length, d.post_count); i++) {
    const raw = urls[i]?.trim();
    if (!raw) continue;
    let parsed = parseUrl(raw);
    if (!parsed) throw new ApiError(400, "BAD_LINK", `Link ${i + 1} doesn't look like a post link.`);
    if (parsed.platform === "tiktok") parsed = await expandTikTok(parsed).catch(() => parsed!);
    if (seen.has(parsed.canonical)) continue;
    seen.add(parsed.canonical);
    const slot = i + 1;
    const old = await sql<PostRow[]>`
      SELECT * FROM posts WHERE deal_id = ${d.id} AND NOT replaced AND (slot = ${slot} OR canonical_url = ${parsed.canonical})`;
    const keep = old.find((o) => o.slot === slot && o.canonical_url === parsed!.canonical && ["passed", "brand_ok"].includes(o.status));
    if (keep && !captions[i]) continue; // already passed; nothing to re-check
    if (old.length) await sql`UPDATE posts SET replaced = true WHERE id IN ${sql(old.map((o) => o.id))}`;
    const source = parsed.platform === "tiktok" ? "tiktok_oembed" : "typed";
    const [post] = await sql<PostRow[]>`
      INSERT INTO posts (deal_id, slot, url, canonical_url, caption, source, status)
      VALUES (${d.id}, ${slot}, ${raw}, ${parsed.canonical}, ${captions[i] ?? ""}, ${source}, 'checking') RETURNING *`;
    jobs.push({ post, parsed, caption: captions[i] ?? "" });
  }
  if (!jobs.length) {
    if (seen.size) return d;
    throw new ApiError(400, "NO_LINKS", "Paste at least one post link.");
  }
  const moved = await setState(d, "checking");
  await logEvent(d.id, "shared", "creator", { count: jobs.length });
  for (const j of jobs) {
    runCheck(d.id, j.post.id, j.parsed, j.caption).catch(async (e) => {
      console.error(JSON.stringify({ deal: d.id, event: "check_error", error: String(e) }));
      await sql`UPDATE posts SET status = 'needs_brand', brand_decide_by = now() + interval '24 hours', checked_at = now()
        WHERE id = ${j.post.id} AND status = 'checking'`;
      await refreshState(d.id);
    });
  }
  return moved;
}

async function runCheck(dealId: string, postId: string, parsed: ParsedUrl, typedCaption: string) {
  const d = (await getDeal(dealId))!;
  const creator = await getUser(d.creator_id);
  const [{ reused }] = await sql<{ reused: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM posts WHERE canonical_url = ${parsed.canonical} AND deal_id <> ${dealId}
      AND status IN ('passed', 'brand_ok') AND NOT replaced) AS reused`;
  let facts: PostFacts;
  if (parsed.platform === "tiktok") {
    const t = await readTikTok(parsed);
    await sql`UPDATE posts SET caption = ${t.caption}, author = ${t.author}, posted_at = ${t.postedAt}, live = ${t.live} WHERE id = ${postId}`;
    if (t.live === null) {
      // TikTok unreachable: never fail a post for that. The brand decides.
      const checks = [{ id: "STILL_UP", layer: "rule", status: "unknown", label: "Still up", quote: null, why: "Kobolt couldn't reach TikTok.", fix: null }];
      await finish(d, postId, "needs_brand", checks);
      return;
    }
    facts = { platform: "tiktok", caption: t.caption, author: t.author, postedAt: t.postedAt, live: t.live, reused, draft: false };
  } else {
    facts = { platform: parsed.platform, caption: typedCaption, author: null, postedAt: null, live: null, reused, draft: false };
  }
  const out = await checkPost(briefOf(d, creator), facts, {
    typed: parsed.platform !== "tiktok",
    onProgress: async (checks) => {
      await sql`UPDATE posts SET checks = ${sql.json(checks as any)} WHERE id = ${postId}`;
    },
  });
  await finish(d, postId, out.status, out.checks, out.note);
}

async function finish(d: DealRow, postId: string, status: string, checks: any[], note?: string | null) {
  const decideBy = status === "needs_brand" ? new Date(Date.now() + 24 * 3600_000) : null;
  try {
    await sql`UPDATE posts SET status = ${status}, checks = ${sql.json(checks)}, checked_at = now(), brand_decide_by = ${decideBy}
      WHERE id = ${postId}`;
  } catch {
    // The same post passed in another deal in the meantime.
    await sql`UPDATE posts SET status = 'failed', checked_at = now(),
      checks = ${sql.json([...checks, { id: "NOT_REUSED", layer: "rule", status: "fail", label: "Not used in another deal", quote: null, why: "This post already got paid in another deal.", fix: "Make a new post for this deal." }])}
      WHERE id = ${postId}`;
    status = "failed";
  }
  await logEvent(d.id, "post_checked", "kobolt", { postId, status, note });
  if (status === "needs_brand") {
    const creator = await getUser(d.creator_id);
    const brand = await getUser(d.brand_id);
    await queue(`${postId}:needs_brand`, d.brand_id,
      `${creator?.name ?? "The creator"} shared a post Kobolt couldn't check. Decide by ${timeOnly(decideBy!, brand?.time_zone)} tomorrow, or they get paid for it.`,
      d.id);
  }
  await refreshState(d.id);
  await maybeSendResult(d.id);
}

/** checking ↔ needs_brand, from the posts. */
export async function refreshState(dealId: string) {
  const d = await getDeal(dealId);
  if (!d || !["checking", "needs_brand"].includes(d.state)) return;
  const posts = await livePosts(dealId);
  const want = posts.some((p) => p.status === "needs_brand") ? "needs_brand" : "checking";
  await setState(d, want);
}

export async function decide(d: DealRow, postId: string, ok: boolean) {
  const [p] = await sql<PostRow[]>`SELECT * FROM posts WHERE id = ${postId} AND deal_id = ${d.id} AND NOT replaced`;
  if (!p) throw new ApiError(404, "NO_POST", "That post isn't in this deal.");
  if (p.status !== "needs_brand") throw new ApiError(409, "ALREADY_DECIDED", "This post has already been decided.");
  if (d.result_sent_at) throw new ApiError(409, "RESULT_SENT", "This deal already has a result.");
  await sql`UPDATE posts SET status = ${ok ? "brand_ok" : "brand_no"} WHERE id = ${postId}`;
  await logEvent(d.id, ok ? "brand_ok" : "brand_no", "brand", { postId });
  await refreshState(d.id);
  await maybeSendResult(d.id);
}
