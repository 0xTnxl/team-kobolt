import { randomBytes } from "node:crypto";
import { sql, logEvent, getUser, getDeal, type DealRow, type UserRow } from "./db.js";
import { zend, getPrize } from "./zend.js";
import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { setState } from "./states.js";
import { queue } from "./outbox.js";
import { dealAmount, timeOnly } from "./money.js";
import { ngnToUsdMicro } from "./fx.js";
import type { Brief } from "./checker/index.js";

const B32 = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const newId = () => "KB-" + Array.from(randomBytes(6), (b) => B32[b % B32.length]).join("");

export interface BriefInput {
  interactionId: string;
  brandName: string;
  title: string;
  platform: "tiktok" | "instagram";
  postCount: number;
  priceNgn?: number;
  priceUsd?: number;
  hashtags: string[];
  disclosure: string;
  avoidNames: string[];
  avoidClaims: string[];
  acceptSecs: number;
  postsDueAt: string;
}

export function briefOf(d: DealRow, creator?: UserRow): Brief {
  return {
    platform: d.platform,
    brandName: d.brand_name,
    title: d.title,
    hashtags: d.hashtags,
    disclosure: d.disclosure,
    avoidNames: d.avoid_names,
    avoidClaims: d.avoid_claims,
    fundedAt: d.funded_at,
    postsDueAt: d.posts_due_at,
    creatorHandle: creator?.tiktok_handle ?? null,
  };
}

export async function upsertParticipant(p: { app_user_id: string; username: string | null; name: string; avatar: string | null }) {
  await sql`
    INSERT INTO users (app_user_id, username, name, avatar) VALUES (${p.app_user_id}, ${p.username}, ${p.name || p.username || "Someone"}, ${p.avatar})
    ON CONFLICT (app_user_id) DO UPDATE SET username = COALESCE(EXCLUDED.username, users.username), name = EXCLUDED.name,
      avatar = COALESCE(EXCLUDED.avatar, users.avatar)`;
}

export async function createDeal(userId: string, b: BriefInput): Promise<DealRow> {
  const [existing] = await sql<DealRow[]>`SELECT * FROM deals WHERE interaction_id = ${b.interactionId}`;
  if (existing) {
    if (existing.brand_id !== userId) throw new ApiError(409, "TAKEN", "The other person already started this deal.");
    if (existing.state !== "new") return existing;
  }
  const it: any = await zend.getInteraction(b.interactionId).catch(() => null);
  if (!it || it.app !== env.slug || it.type !== "deal") throw new ApiError(400, "NOT_A_DEAL", "Start the deal from your chat with the creator.");
  if (it.state !== "new") throw new ApiError(409, "NOT_NEW", "This deal has already started.");
  const people: any[] = it.participants ?? [];
  if (!people.some((p) => p.app_user_id === userId)) throw new ApiError(403, "NOT_IN_DEAL", "You're not part of this chat.");
  if (people.length !== 2) throw new ApiError(400, "NEEDS_TWO", "A deal is between you and one creator.");
  const other = people.find((p) => p.app_user_id !== userId)!;
  await upsertParticipant(other);

  const due = new Date(b.postsDueAt);
  const minDue = Date.now() + (b.acceptSecs + 600) * 1000;
  if (!(due.getTime() >= minDue - 60_000)) throw new ApiError(400, "DUE_TOO_SOON", "Give the creator at least 10 minutes after they accept.");
  if (due.getTime() > Date.now() + 28 * 86400_000) throw new ApiError(400, "DUE_TOO_LATE", "Posts can be due at most 28 days from now.");
  const allowed = env.demo ? [90, 3600, 10800, 86400] : [3600, 10800, 86400];
  if (!allowed.includes(b.acceptSecs)) throw new ApiError(400, "BAD_WINDOW", "Pick how long the creator has to accept.");
  const tags = b.hashtags.map((t) => (t.trim().startsWith("#") ? t.trim() : `#${t.trim()}`)).filter((t) => t.length > 1);
  const disclosure = b.disclosure.trim();
  const priceUsdMicro = b.priceUsd != null ? BigInt(Math.round(b.priceUsd * 1e6)) : null;

  const fields = {
    brand_name: b.brandName.trim(),
    title: b.title.trim(),
    platform: b.platform,
    post_count: b.postCount,
    price_ngn: b.priceNgn ?? null,
    price_usd_micro: priceUsdMicro,
    hashtags: tags,
    disclosure,
    avoid_names: b.avoidNames.map((s) => s.trim()).filter(Boolean),
    avoid_claims: b.avoidClaims.map((s) => s.trim()).filter(Boolean),
    accept_secs: b.acceptSecs,
    posts_due_at: due,
  };
  if (existing) {
    const [row] = await sql<DealRow[]>`UPDATE deals SET ${sql(fields)}, updated_at = now() WHERE id = ${existing.id} RETURNING *`;
    return row;
  }
  const [row] = await sql<DealRow[]>`
    INSERT INTO deals ${sql({ id: newId(), interaction_id: b.interactionId, brand_id: userId, creator_id: other.app_user_id, ...fields })}
    RETURNING *`;
  await logEvent(row.id, "created", "brand");
  return row;
}

/** The amount Zend should hold, in the shape `zend.prize.create` takes. */
export async function fundingTerms(d: DealRow) {
  const resolveInSecs = Math.ceil((d.posts_due_at.getTime() - Date.now()) / 1000) + 25 * 3600;
  const base = {
    joinInSecs: d.accept_secs,
    resolveInSecs,
    disputeSecs: 600,
    maxPlayers: 3,
    interactionId: d.interaction_id,
    reference: d.id,
  };
  if (d.price_ngn != null) return { ...base, price: { ngn: d.price_ngn * d.post_count } };
  const usd = Number(d.price_usd_micro ?? 0n) * d.post_count / 1e6;
  return { ...base, amount: Math.round(usd * 100) / 100 };
}

export async function estimateTotalMicro(d: DealRow): Promise<bigint> {
  if (d.pot_usd_micro) return d.pot_usd_micro;
  if (d.price_usd_micro) return d.price_usd_micro * BigInt(d.post_count);
  return ngnToUsdMicro((d.price_ngn ?? 0) * d.post_count);
}

/** Confirms funding with Zend (never trusts the page). Safe to call twice. */
export async function confirmFunded(d: DealRow, prizeId: string, actor: "brand" | "zend" = "brand"): Promise<DealRow> {
  if (d.prize_id && d.prize_id !== prizeId) throw new ApiError(409, "ALREADY_FUNDED", "This deal is already funded.");
  if (d.state !== "new" && d.prize_id === prizeId) return d;
  const p = await getPrize(prizeId);
  if (p.reference !== d.id || p.host !== d.brand_id) throw new ApiError(400, "WRONG_PRIZE", "That didn't go through. Try again.");
  if (p.status !== "open") throw new ApiError(409, "NOT_OPEN", "That didn't go through. Try again.");
  const pot = BigInt(Math.round(p.pot_usd * 1e6));
  const [row] = await sql<DealRow[]>`
    UPDATE deals SET prize_id = ${prizeId}, pot_usd_micro = ${pot}, pot_ngn = ${p.pot_ngn ?? null},
      per_post_usd_micro = ${pot / BigInt(d.post_count)}, funded_at = COALESCE(funded_at, now()),
      accept_deadline = ${new Date(p.join_deadline)}, result_deadline = ${new Date(p.resolve_deadline)}, updated_at = now()
    WHERE id = ${d.id} AND (prize_id IS NULL OR prize_id = ${prizeId}) RETURNING *`;
  if (!row) return (await getDeal(d.id))!;
  const moved = await setState(row, "offered");
  await logEvent(d.id, "funded", actor, { prizeId, pot_usd: p.pot_usd });
  const creator = await getUser(d.creator_id);
  const amount = await dealAmount(moved, pot, creator);
  await queue(`${d.id}:funded:creator`, d.creator_id,
    `${d.brand_name} sent you a deal: ${d.post_count} ${d.platform === "tiktok" ? "TikTok" : "Instagram"} post${d.post_count > 1 ? "s" : ""}, ${amount}. Accept by ${timeOnly(moved.accept_deadline!, creator?.time_zone)}.`,
    d.id);
  return moved;
}

/** Confirms the creator joined the prize. Other joiners are ignored (they can never be paid). */
export async function confirmJoined(d: DealRow, actor: "creator" | "zend" = "creator"): Promise<DealRow> {
  if (d.state !== "offered" || !d.prize_id) return d;
  const p = await getPrize(d.prize_id);
  if (!p.players?.some((x) => x.app_user_id === d.creator_id)) {
    if (p.players?.length) await logEvent(d.id, "stranger_joined", "zend", { players: p.players.length });
    return d;
  }
  await sql`UPDATE deals SET accepted_at = COALESCE(accepted_at, now()) WHERE id = ${d.id}`;
  const moved = await setState((await getDeal(d.id))!, "accepted");
  await logEvent(d.id, "accepted", actor);
  const creator = await getUser(d.creator_id);
  await queue(`${d.id}:accepted:brand`, d.brand_id, `${creator?.name ?? "The creator"} accepted your deal.`, d.id);
  return moved;
}
