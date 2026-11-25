import { sql, getUser, livePosts, type DealRow, type UserRow } from "./db.js";
import { label, dealAmount } from "./money.js";
import { estimateTotalMicro } from "./deals.js";
import { earnedCount } from "./result.js";

const appName = (p: string) => (p === "tiktok" ? "TikTok" : "Instagram");

async function amounts(d: DealRow, viewer: UserRow | undefined) {
  const cur = viewer?.currency ?? "NGN";
  if (d.pot_usd_micro) {
    const per = d.per_post_usd_micro!;
    return {
      total: await dealAmount(d, d.pot_usd_micro, viewer),
      perPost: await dealAmount(d, per, viewer),
      paid: d.paid_amount_micro != null ? await dealAmount(d, d.paid_amount_micro, viewer) : null,
      back: d.paid_amount_micro != null ? await dealAmount(d, d.pot_usd_micro - d.paid_amount_micro, viewer) : null,
    };
  }
  const total = await estimateTotalMicro(d);
  const ngnTotal = d.price_ngn != null ? d.price_ngn * d.post_count : null;
  return {
    total: await label(total, cur, ngnTotal),
    perPost: await label(total / BigInt(d.post_count), cur, d.price_ngn),
    paid: null,
    back: null,
  };
}

export async function dealView(d: DealRow, viewer: UserRow) {
  const role = viewer.app_user_id === d.brand_id ? "brand" : "creator";
  const [brand, creator] = await Promise.all([getUser(d.brand_id), getUser(d.creator_id)]);
  const other = role === "brand" ? creator : brand;
  const posts = await livePosts(d.id);
  const events = await sql`SELECT type, actor, created_at FROM events WHERE deal_id = ${d.id} ORDER BY id`;
  return {
    role,
    deal: {
      id: d.id,
      interactionId: d.interaction_id,
      prizeId: d.prize_id,
      state: d.state,
      brandName: d.brand_name,
      title: d.title,
      platform: d.platform,
      appName: appName(d.platform),
      postCount: d.post_count,
      priceNgn: d.price_ngn,
      priceUsd: d.price_usd_micro != null ? Number(d.price_usd_micro) / 1e6 : null,
      hashtags: d.hashtags,
      disclosure: d.disclosure,
      avoidNames: d.avoid_names,
      avoidClaims: d.avoid_claims,
      acceptSecs: d.accept_secs,
      postsDueAt: d.posts_due_at,
      fundedAt: d.funded_at,
      acceptDeadline: d.accept_deadline,
      acceptedAt: d.accepted_at,
      resultSentAt: d.result_sent_at,
      resultEarned: d.result_earned,
      disputeEndsAt: d.dispute_ends_at,
      paysAt: d.dispute_ends_at ? new Date(d.dispute_ends_at.getTime() + 60_000) : null,
      closedAt: d.closed_at,
      closeReason: d.close_reason,
      cardPosted: d.card_posted,
      feedPosted: d.feed_posted,
      earned: earnedCount(d, posts),
    },
    amounts: await amounts(d, viewer),
    brand: { name: brand?.name, username: brand?.username, timeZone: brand?.time_zone },
    creator: { name: creator?.name, username: creator?.username, timeZone: creator?.time_zone, tiktok: creator?.tiktok_handle, appUserId: d.creator_id },
    other: { name: other?.name, timeZone: other?.time_zone },
    posts: posts.map((p) => ({
      id: p.id,
      slot: p.slot,
      url: p.url,
      caption: p.caption,
      author: p.author,
      postedAt: p.posted_at,
      status: p.status,
      checks: p.checks,
      brandDecideBy: p.brand_decide_by,
      source: p.source,
    })),
    events: events.map((e: any) => ({ type: e.type, actor: e.actor, at: e.created_at })),
  };
}

export async function dealSummary(d: DealRow, viewer: UserRow) {
  const role = viewer.app_user_id === d.brand_id ? "brand" : "creator";
  const other = await getUser(role === "brand" ? d.creator_id : d.brand_id);
  const a = await amounts(d, viewer);
  return {
    id: d.id,
    role,
    state: d.state,
    title: d.title,
    brandName: d.brand_name,
    otherName: role === "brand" ? other?.name : d.brand_name,
    otherTimeZone: other?.time_zone,
    postCount: d.post_count,
    appName: appName(d.platform),
    total: a.total,
    paid: a.paid,
    postsDueAt: d.posts_due_at,
    updatedAt: d.updated_at,
  };
}

/** Public creator page: paid deals only; earnings only if the creator chose to show them. */
export async function creatorPage(username: string, viewerCurrency: string) {
  const [u] = await sql<UserRow[]>`SELECT * FROM users WHERE lower(username) = lower(${username})`;
  if (!u) return null;
  const deals = await sql<DealRow[]>`SELECT * FROM deals WHERE creator_id = ${u.app_user_id} AND state IN ('paid', 'part_paid') ORDER BY closed_at DESC`;
  const items = [];
  let total = 0n;
  for (const d of deals) {
    const [{ brandok }] = await sql<{ brandok: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM posts WHERE deal_id = ${d.id} AND status = 'brand_ok' AND NOT replaced) AS brandok`;
    total += d.paid_amount_micro ?? 0n;
    items.push({
      id: d.id,
      brandName: d.brand_name,
      title: d.title,
      posts: d.result_earned ?? d.post_count,
      appName: appName(d.platform),
      paidAt: d.closed_at,
      checkedBy: brandok ? `Approved by ${d.brand_name}` : "Checked by Kobolt",
      amount: u.show_earnings ? await label(d.paid_amount_micro ?? 0n, viewerCurrency) : null,
    });
  }
  return {
    name: u.name,
    username: u.username,
    avatar: u.avatar,
    tiktok: u.tiktok_handle,
    dealsPaid: deals.length,
    brands: new Set(deals.map((d) => d.brand_name.toLowerCase())).size,
    earnings: u.show_earnings ? await label(total, viewerCurrency) : null,
    deals: items,
  };
}

/** The check for a paid deal, public so the creator page can link to it. */
export async function publicCheck(id: string) {
  const [d] = await sql<DealRow[]>`SELECT * FROM deals WHERE id = ${id} AND state IN ('paid', 'part_paid')`;
  if (!d) return null;
  const creator = await getUser(d.creator_id);
  const posts = await livePosts(d.id);
  return {
    deal: { id: d.id, brandName: d.brand_name, title: d.title, appName: appName(d.platform), postCount: d.post_count, paidAt: d.closed_at, hashtags: d.hashtags, disclosure: d.disclosure },
    creator: { name: creator?.name, username: creator?.username },
    posts: posts.filter((p) => ["passed", "brand_ok"].includes(p.status)).map((p) => ({ slot: p.slot, url: p.url, caption: p.caption, status: p.status, checks: p.checks })),
  };
}
