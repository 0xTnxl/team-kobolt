import { sql, logEvent, getUser, getDeal, livePosts, type DealRow, type PostRow } from "./db.js";
import { zend, getPrize, errCode, errText, recentEvents, type ServerPrize } from "./zend.js";
import { env } from "./env.js";
import { setState, TERMINAL } from "./states.js";
import { queue } from "./outbox.js";
import { dealAmount, timeOnly } from "./money.js";
import { confirmJoined } from "./deals.js";
import { readTikTok, parseUrl } from "./checker/index.js";

const EARNED = ["passed", "brand_ok"];

export function earnedCount(d: DealRow, posts: PostRow[]): number {
  const distinct = new Set(posts.filter((p) => EARNED.includes(p.status)).map((p) => p.canonical_url));
  return Math.min(distinct.size, d.post_count);
}

/** Ready for a result? Used by the scheduler, after every check, and by /ops. */
export async function resultReadiness(d: DealRow) {
  const now = Date.now();
  // Brand didn't decide in 24 h: paid if nothing failed, otherwise not.
  for (const p of await livePosts(d.id)) {
    if (p.status === "needs_brand" && p.brand_decide_by && p.brand_decide_by.getTime() <= now) {
      const anyFail = (p.checks ?? []).some((c: any) => c.status === "fail");
      await sql`UPDATE posts SET status = ${anyFail ? "brand_no" : "brand_ok"} WHERE id = ${p.id} AND status = 'needs_brand'`;
      await logEvent(d.id, anyFail ? "auto_brand_no" : "auto_brand_ok", "kobolt", { postId: p.id });
    }
  }
  const posts = await livePosts(d.id);
  const earned = earnedCount(d, posts);
  const waitingBrand = posts.some((p) => p.status === "needs_brand");
  const checking = posts.some((p) => p.status === "checking" && now - p.created_at.getTime() < 120_000);
  const acceptClosed = !!d.accept_deadline && now >= d.accept_deadline.getTime();
  const safety = !!d.result_deadline && now >= d.result_deadline.getTime() - 30 * 60_000;
  let ready = false;
  if (earned >= d.post_count && acceptClosed) ready = true;
  else if (now >= d.posts_due_at.getTime() && !waitingBrand && !checking && acceptClosed) ready = true;
  if (safety) ready = true;
  return { ready, earned, safety, acceptClosed };
}

export async function maybeSendResult(dealId: string, opts: { force?: boolean } = {}) {
  const d = await getDeal(dealId);
  if (!d || !d.prize_id || d.result_sent_at) return { sent: false, why: "not open" };
  if (!["accepted", "checking", "needs_brand"].includes(d.state)) return { sent: false, why: `state ${d.state}` };
  const r = await resultReadiness(d);
  if (!opts.force && !r.ready) return { sent: false, why: "not ready" };
  if (!opts.force && d.hold_result && !r.safety) return { sent: false, why: "held" };
  return sendResult(d, r.earned);
}

async function sendResult(d: DealRow, earned: number) {
  let p = await getPrize(d.prize_id!);
  if (p.status !== "open") {
    await applyPrize(p);
    return { sent: false, why: `prize ${p.status}` };
  }
  const player = p.players?.find((x) => x.app_user_id === d.creator_id);
  const n = player ? earned : 0;
  const amount = n === 0 ? 0n : n >= d.post_count ? d.pot_usd_micro! : BigInt(n) * d.per_post_usd_micro!;
  try {
    await zend.resolvePrize(d.prize_id!, n ? [player!.address] : [], n ? [Number(amount) / 1e6] : [], env.resolverSeed);
  } catch (e) {
    const code = errCode(e);
    await sql`UPDATE deals SET last_error = ${`resolve: ${errText(e)}`} WHERE id = ${d.id}`;
    if (code === "TOO_EARLY") return { sent: false, why: "too early" };
    // Never send twice without checking: re-read first.
    p = await getPrize(d.prize_id!);
    if (p.status === "open") return { sent: false, why: code };
  }
  p = await getPrize(d.prize_id!);
  const [row] = await sql<DealRow[]>`
    UPDATE deals SET result_sent_at = now(), result_earned = ${n}, paid_amount_micro = ${amount}, hold_result = false,
      dispute_ends_at = ${p.dispute_ends ? new Date(p.dispute_ends) : null}, updated_at = now()
    WHERE id = ${d.id} AND result_sent_at IS NULL RETURNING *`;
  if (!row) return { sent: false, why: "already sent" };
  await logEvent(d.id, "result_sent", "kobolt", { earned: n, amount_usd: Number(amount) / 1e6 });
  const moved = await setState(row, n > 0 ? "approved" : "returned");
  await resultMessages(moved, n, amount);
  return { sent: true, why: null };
}

async function resultMessages(d: DealRow, n: number, amount: bigint) {
  const brand = await getUser(d.brand_id);
  const creator = await getUser(d.creator_id);
  const cname = creator?.name ?? "The creator";
  if (n === 0) {
    await queue(`${d.id}:result:brand`, d.brand_id, `No posts checked out. Your money comes back to you after a 10-minute wait.`, d.id);
    await queue(`${d.id}:result:creator`, d.creator_id, `No posts checked out for ${d.brand_name}, so the money goes back to them.`, d.id);
    return;
  }
  const payAt = d.dispute_ends_at ? new Date(d.dispute_ends_at.getTime() + 60_000) : new Date(Date.now() + 11 * 60_000);
  const back = d.pot_usd_micro! - amount;
  if (n >= d.post_count) {
    await queue(`${d.id}:result:creator`, d.creator_id, `Approved. You'll get ${await dealAmount(d, amount, creator)} at ${timeOnly(payAt, creator?.time_zone)}.`, d.id);
    await queue(`${d.id}:result:brand`, d.brand_id,
      `Approved. ${cname} gets ${await dealAmount(d, amount, brand)} at ${timeOnly(payAt, brand?.time_zone)}. You can stop this payout until then.`, d.id);
  } else {
    await queue(`${d.id}:result:creator`, d.creator_id,
      `${n} of ${d.post_count} posts passed. You'll get ${await dealAmount(d, amount, creator)} at ${timeOnly(payAt, creator?.time_zone)}.`, d.id);
    await queue(`${d.id}:result:brand`, d.brand_id,
      `${n} of ${d.post_count} posts passed. ${await dealAmount(d, amount, brand)} goes to ${cname}, ${await dealAmount(d, back, brand)} back to you.`, d.id);
  }
}

/** Nobody accepted: send "no winners" right away so the brand gets the money after the wait. */
export async function closeUnaccepted(d: DealRow) {
  const p = await getPrize(d.prize_id!);
  if (p.players?.some((x) => x.app_user_id === d.creator_id)) {
    await confirmJoined(d, "zend");
    return;
  }
  if (p.status === "open") {
    try {
      await zend.resolvePrize(d.prize_id!, [], [], env.resolverSeed);
    } catch (e) {
      if (errCode(e) === "TOO_EARLY") return;
      const again = await getPrize(d.prize_id!);
      if (again.status === "open") {
        await sql`UPDATE deals SET last_error = ${`close: ${errText(e)}`} WHERE id = ${d.id}`;
        return;
      }
    }
  }
  const [row] = await sql<DealRow[]>`
    UPDATE deals SET result_sent_at = COALESCE(result_sent_at, now()), result_earned = 0, paid_amount_micro = 0,
      close_reason = 'not_accepted', updated_at = now() WHERE id = ${d.id} RETURNING *`;
  await setState(row, "closed");
  const creator = await getUser(d.creator_id);
  await queue(`${d.id}:closed:brand`, d.brand_id,
    `${creator?.name ?? "The creator"} didn't accept in time. Your money comes back to you after a 10-minute wait.`, d.id);
}

/** Brings a deal in line with what Zend says about its prize (webhook, stop, or sync). */
export async function applyPrize(prize: Pick<ServerPrize, "id" | "status" | "winners" | "dispute_ends">, reason?: string) {
  const [d] = await sql<DealRow[]>`SELECT * FROM deals WHERE prize_id = ${prize.id}`;
  if (!d || TERMINAL.has(d.state)) return;
  if (prize.status === "resolved") {
    if (prize.dispute_ends) await sql`UPDATE deals SET dispute_ends_at = ${new Date(prize.dispute_ends)} WHERE id = ${d.id}`;
    const paying = (prize.winners ?? []).length > 0;
    if (paying && d.state !== "approved") await setState(d, "approved", "zend");
    return;
  }
  if (prize.status !== "paid" && prize.status !== "refunded") return;
  const brand = await getUser(d.brand_id);
  const creator = await getUser(d.creator_id);
  const paid = BigInt(Math.round((prize.winners ?? []).reduce((s, w: any) => s + Number(w.amount_usd ?? 0), 0) * 1e6));
  let to: string;
  let why: string;
  if (prize.status === "refunded") {
    const vetoed = reason ? reason === "vetoed" : d.state === "approved";
    to = vetoed ? "stopped" : "returned";
    why = vetoed ? "vetoed" : "no_result";
  } else {
    to = paid === 0n ? "returned" : paid >= (d.pot_usd_micro ?? 0n) - 1n ? "paid" : "part_paid";
    why = "finalized";
  }
  if (prize.status === "paid" && paid === 0n && !d.result_sent_at) why = "no_result";
  await sql`UPDATE deals SET close_reason = ${why}, paid_amount_micro = ${to === "paid" || to === "part_paid" ? paid : 0n},
    updated_at = now() WHERE id = ${d.id}`;
  const moved = await setState((await getDeal(d.id))!, to, "zend");
  await logEvent(d.id, `closed:${to}`, "zend", { reason: why });
  const pot = d.pot_usd_micro ?? 0n;
  if (to === "paid" || to === "part_paid") {
    await queue(`${d.id}:paid:creator`, d.creator_id,
      `${await dealAmount(moved, paid, creator)} is in your Zend. Send it to your bank from Zend: Send → Bank.`, d.id);
    await queue(`${d.id}:paid:brand`, d.brand_id,
      to === "paid"
        ? `Paid ${await dealAmount(moved, paid, brand)} to ${creator?.name ?? "the creator"}.`
        : `Paid ${await dealAmount(moved, paid, brand)} to ${creator?.name ?? "the creator"}. ${await dealAmount(moved, pot - paid, brand)} is back in your Zend.`,
      d.id);
  } else if (to === "stopped") {
    await queue(`${d.id}:stopped:creator`, d.creator_id, `${d.brand_name} stopped the payout. The money went back to them.`, d.id);
  } else {
    await queue(`${d.id}:returned:brand`, d.brand_id, `No posts checked out. ${await dealAmount(moved, pot, brand)} is back in your Zend.`, d.id);
  }
}

// ── Scheduler: every 30 s, one container at a time ──────────────────────────
let lastLiveness = 0;
let lastCatchUp = 0;
export const schedulerState = { lastRun: null as Date | null, lastError: null as string | null, runs: 0 };

async function tick() {
  const now = Date.now();
  for (const d of await sql<DealRow[]>`SELECT * FROM deals WHERE state = 'offered' AND accept_deadline <= now()`) {
    await closeUnaccepted(d).catch((e) => note(d.id, "close", e));
  }
  for (const d of await sql<DealRow[]>`
    SELECT * FROM deals WHERE state IN ('accepted', 'checking', 'needs_brand') AND prize_id IS NOT NULL AND result_sent_at IS NULL`) {
    await maybeSendResult(d.id).catch((e) => note(d.id, "result", e));
    if (d.posts_due_at.getTime() - now < 3600_000 && d.posts_due_at.getTime() > now) {
      const n = (await livePosts(d.id)).filter((p) => EARNED.includes(p.status)).length;
      if (n < d.post_count) await queue(`${d.id}:due1h`, d.creator_id, `Your posts for ${d.brand_name} are due in 1 hour.`, d.id);
    }
  }
  for (const p of await sql<(PostRow & { brand_id: string })[]>`
    SELECT p.*, d.brand_id FROM posts p JOIN deals d ON d.id = p.deal_id
    WHERE p.status = 'needs_brand' AND NOT p.replaced AND p.brand_decide_by < now() + interval '1 hour'`) {
    await queue(`${p.id}:remind1h`, p.brand_id, `A post is waiting for you. Decide within the hour, or the creator gets paid for it.`, p.deal_id);
  }
  // Payout sync: webhook missing a little after the wait.
  for (const d of await sql<DealRow[]>`
    SELECT * FROM deals WHERE state IN ('approved', 'returned') AND prize_id IS NOT NULL AND dispute_ends_at < now() - interval '70 seconds'
      AND close_reason IS NULL`) {
    const p = await getPrize(d.prize_id!).catch(() => null);
    if (p) await applyPrize(p).catch((e) => note(d.id, "sync", e));
    if (p && d.state === "returned" && (p.status === "paid" || p.status === "refunded")) {
      await sql`UPDATE deals SET close_reason = 'finalized' WHERE id = ${d.id} AND close_reason IS NULL`;
    }
  }
  if (now - lastLiveness > 10 * 60_000) {
    lastLiveness = now;
    for (const p of await sql<PostRow[]>`
      SELECT p.* FROM posts p JOIN deals d ON d.id = p.deal_id
      WHERE p.status = 'passed' AND NOT p.replaced AND p.source = 'tiktok_oembed' AND d.result_sent_at IS NULL`) {
      const parsed = parseUrl(p.url);
      if (!parsed) continue;
      const t = await readTikTok(parsed).catch(() => null);
      if (t?.live === false) {
        const checks = [...p.checks.filter((c: any) => c.id !== "STILL_UP"),
          { id: "STILL_UP", layer: "rule", status: "fail", label: "Still up", quote: null, why: "The post was taken down.", fix: "Make sure the post is public, then share it again." }];
        await sql`UPDATE posts SET status = 'failed', live = false, checks = ${sql.json(checks)} WHERE id = ${p.id}`;
        await logEvent(p.deal_id, "post_taken_down", "kobolt", { postId: p.id });
      }
    }
  }
  if (now - lastCatchUp > 5 * 60_000) {
    lastCatchUp = now;
    await catchUp().catch((e) => note(null, "catchup", e));
  }
}

function note(deal: string | null, job: string, e: unknown) {
  schedulerState.lastError = `${job} ${deal ?? ""}: ${errText(e)}`;
  console.error(JSON.stringify({ deal, event: `scheduler_${job}`, error: errText(e) }));
}

export function startScheduler() {
  const run = async () => {
    try {
      await sql.begin(async (tx) => {
        const [{ ok }] = await tx<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(4242) AS ok`;
        if (!ok) return;
        await tick();
      });
      schedulerState.lastRun = new Date();
      schedulerState.runs++;
    } catch (e) {
      note(null, "tick", e);
    } finally {
      setTimeout(run, 30_000);
    }
  };
  setTimeout(run, 3000);
}

// Webhook replay is wired in webhook.ts; imported lazily to avoid a cycle at load.
async function catchUp() {
  const { handleEvent } = await import("./webhook.js");
  for (const e of await recentEvents()) {
    const id = String(e.id ?? e.event_id ?? "");
    if (!id) continue;
    const [{ fresh }] = await sql<{ fresh: boolean }[]>`
      WITH ins AS (INSERT INTO zend_events (event_id, type) VALUES (${id}, ${String(e.type)}) ON CONFLICT DO NOTHING RETURNING 1)
      SELECT EXISTS (SELECT 1 FROM ins) AS fresh`;
    if (fresh) await handleEvent(e.type, e.data ?? e.payload ?? {});
  }
}
