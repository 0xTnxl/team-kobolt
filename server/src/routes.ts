import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { sql, getDeal, getUser, logEvent, type DealRow, type UserRow } from "./db.js";
import { zend, getPrize, errText } from "./zend.js";
import { issueToken, requireUser } from "./session.js";
import { ApiError, limit } from "./errors.js";
import { createDeal, confirmFunded, confirmJoined, fundingTerms } from "./deals.js";
import { sharePosts, decide } from "./posts.js";
import { applyPrize } from "./result.js";
import { setState } from "./states.js";
import { precheck } from "./precheck.js";
import { dealView, dealSummary, creatorPage, publicCheck } from "./views.js";
import { rates } from "./fx.js";
import { env } from "./env.js";

const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "CAD", "GHS", "KES", "ZAR"];
const str = (max: number) => z.string().trim().max(max);
const list = (max: number) => z.array(str(max)).max(5);

const BriefBody = z.object({
  interactionId: z.string().min(4).max(80),
  brandName: str(40).min(1),
  title: str(60).min(1),
  platform: z.enum(["tiktok", "instagram"]),
  postCount: z.number().int().min(1).max(5),
  priceNgn: z.number().int().min(100).max(1_000_000).optional(),
  priceUsd: z.number().min(0.2).max(100).optional(),
  hashtags: list(30),
  disclosure: str(30),
  avoidNames: list(60),
  avoidClaims: list(60),
  acceptSecs: z.number().int(),
  postsDueAt: z.string().datetime(),
}).refine((b) => (b.priceNgn != null) !== (b.priceUsd != null), { message: "Set a price in Naira or dollars." });

async function me(req: FastifyRequest): Promise<UserRow> {
  const u = await getUser(req.userId);
  if (!u) throw new ApiError(401, "SIGNED_OUT", "Please open Kobolt again.");
  return u;
}

async function dealFor(req: FastifyRequest, id: string, role?: "brand" | "creator"): Promise<DealRow> {
  const d = await getDeal(id);
  if (!d || (d.brand_id !== req.userId && d.creator_id !== req.userId)) throw new ApiError(404, "NO_DEAL", "We couldn't find that deal.");
  if (role === "brand" && d.brand_id !== req.userId) throw new ApiError(403, "BRAND_ONLY", "Only the brand can do that.");
  if (role === "creator" && d.creator_id !== req.userId) throw new ApiError(403, "CREATOR_ONLY", "Only the creator can do that.");
  return d;
}

const meView = (u: UserRow) => ({
  appUserId: u.app_user_id,
  username: u.username,
  name: u.name,
  avatar: u.avatar,
  currency: u.currency,
  timeZone: u.time_zone,
  tiktokHandle: u.tiktok_handle,
  showEarnings: u.show_earnings,
});

export async function apiRoutes(app: FastifyInstance) {
  app.post("/api/session", async (req) => {
    limit(`session:${req.ip}`, 30);
    const b = z.object({ appSession: z.string().min(10).max(4000), timeZone: str(60).optional(), currency: z.string().length(3).optional() }).parse(req.body);
    let v;
    try {
      v = await zend.verifySession(b.appSession);
    } catch (e) {
      req.log.warn({ err: errText(e) }, "verifySession failed");
      throw new ApiError(401, "SESSION_FAILED", "Please open Kobolt again.");
    }
    const cur = b.currency && CURRENCIES.includes(b.currency.toUpperCase()) ? b.currency.toUpperCase() : "NGN";
    const [u] = await sql<UserRow[]>`
      INSERT INTO users (app_user_id, username, name, avatar, currency, time_zone)
      VALUES (${v.app_user_id}, ${v.username}, ${v.name || v.username || "Zend user"}, ${v.avatar}, ${cur}, ${b.timeZone ?? null})
      ON CONFLICT (app_user_id) DO UPDATE SET username = EXCLUDED.username, name = EXCLUDED.name, avatar = EXCLUDED.avatar,
        time_zone = COALESCE(EXCLUDED.time_zone, users.time_zone), last_seen_at = now()
      RETURNING *`;
    return { token: issueToken(u.app_user_id), me: meView(u) };
  });

  app.register(async (auth) => {
    auth.addHook("preHandler", requireUser);

    auth.get("/api/me", async (req) => {
      const u = await me(req);
      const [last] = await sql<DealRow[]>`SELECT * FROM deals WHERE brand_id = ${u.app_user_id} AND state <> 'new' ORDER BY created_at DESC LIMIT 1`;
      return {
        me: meView(u),
        demo: env.demo,
        lastBrief: last && {
          brandName: last.brand_name, title: last.title, platform: last.platform, postCount: last.post_count,
          priceNgn: last.price_ngn, priceUsd: last.price_usd_micro != null ? Number(last.price_usd_micro) / 1e6 : null,
          hashtags: last.hashtags, disclosure: last.disclosure, avoidNames: last.avoid_names, avoidClaims: last.avoid_claims,
          acceptSecs: last.accept_secs,
        },
      };
    });

    auth.patch("/api/me", async (req) => {
      const b = z.object({
        currency: z.enum(CURRENCIES as [string, ...string[]]).optional(),
        tiktokHandle: z.string().trim().max(40).regex(/^@?[\w.]+$/).optional(),
        showEarnings: z.boolean().optional(),
        timeZone: str(60).optional(),
      }).parse(req.body);
      const [u] = await sql<UserRow[]>`
        UPDATE users SET currency = COALESCE(${b.currency ?? null}, currency),
          tiktok_handle = COALESCE(${b.tiktokHandle?.replace(/^@/, "").toLowerCase() ?? null}, tiktok_handle),
          show_earnings = COALESCE(${b.showEarnings ?? null}, show_earnings),
          time_zone = COALESCE(${b.timeZone ?? null}, time_zone)
        WHERE app_user_id = ${req.userId} RETURNING *`;
      return { me: meView(u) };
    });

    auth.get("/api/deals", async (req) => {
      const u = await me(req);
      const rows = await sql<DealRow[]>`
        SELECT * FROM deals WHERE (brand_id = ${u.app_user_id} OR creator_id = ${u.app_user_id})
          AND NOT (state = 'new' AND creator_id = ${u.app_user_id}) ORDER BY updated_at DESC LIMIT 100`;
      return { deals: await Promise.all(rows.map((d) => dealSummary(d, u))) };
    });

    auth.post("/api/deals", async (req) => {
      const b = BriefBody.parse(req.body);
      const d = await createDeal(req.userId, b);
      return { id: d.id, terms: await fundingTerms(d), view: await dealView(d, await me(req)) };
    });

    auth.get("/api/deals/by-interaction/:iid", async (req) => {
      const { iid } = req.params as { iid: string };
      const [d] = await sql<DealRow[]>`SELECT * FROM deals WHERE interaction_id = ${iid}`;
      if (!d) return { id: null };
      if (d.brand_id !== req.userId && d.creator_id !== req.userId) throw new ApiError(404, "NO_DEAL", "We couldn't find that deal.");
      return { id: d.id, state: d.state, role: d.brand_id === req.userId ? "brand" : "creator" };
    });

    auth.get("/api/deals/:id", async (req) => {
      const d = await dealFor(req, (req.params as any).id);
      const view = await dealView(d, await me(req));
      return d.state === "new" && d.brand_id === req.userId ? { ...view, terms: await fundingTerms(d) } : view;
    });

    auth.post("/api/deals/:id/funded", async (req) => {
      const d = await dealFor(req, (req.params as any).id, "brand");
      const { prizeId } = z.object({ prizeId: z.string().min(4).max(100) }).parse(req.body);
      const moved = await confirmFunded(d, prizeId);
      return dealView(moved, await me(req));
    });

    auth.post("/api/deals/:id/card", async (req) => {
      const d = await dealFor(req, (req.params as any).id);
      const { placement } = z.object({ placement: z.enum(["chat", "feed"]) }).parse(req.body);
      await sql`UPDATE deals SET ${sql(placement === "chat" ? { card_posted: true } : { feed_posted: true })} WHERE id = ${d.id}`;
      await logEvent(d.id, `card_${placement}`, d.brand_id === req.userId ? "brand" : "creator");
      return { ok: true };
    });

    auth.post("/api/deals/:id/joined", async (req) => {
      const d = await dealFor(req, (req.params as any).id, "creator");
      const b = z.object({ tiktokHandle: z.string().trim().max(40).regex(/^@?[\w.]+$/).optional() }).parse(req.body ?? {});
      if (b.tiktokHandle) {
        await sql`UPDATE users SET tiktok_handle = ${b.tiktokHandle.replace(/^@/, "").toLowerCase()} WHERE app_user_id = ${req.userId}`;
      }
      const moved = await confirmJoined(d);
      return dealView(moved, await me(req));
    });

    auth.post("/api/deals/:id/refresh", async (req) => {
      const d = await dealFor(req, (req.params as any).id);
      if (d.prize_id) {
        const p = await getPrize(d.prize_id).catch(() => null);
        if (p && d.state === "offered") await confirmJoined(d, "zend");
        if (p && ["resolved", "paid", "refunded"].includes(p.status)) await applyPrize(p);
      }
      return dealView((await getDeal(d.id))!, await me(req));
    });

    auth.post("/api/deals/:id/posts", async (req) => {
      limit(`posts:${req.userId}`, 10);
      const d = await dealFor(req, (req.params as any).id, "creator");
      const b = z.object({ urls: z.array(z.string().trim().max(300)).min(1).max(5), captions: z.array(z.string().max(2200)).max(5).optional() }).parse(req.body);
      const u = await me(req);
      if (d.platform === "tiktok" && !u.tiktok_handle) throw new ApiError(400, "NEED_HANDLE", "Add your TikTok name first.");
      const moved = await sharePosts(d, b.urls, b.captions);
      return dealView(moved, u);
    });

    auth.post("/api/deals/:id/posts/:postId/decide", async (req) => {
      const { id, postId } = req.params as any;
      const d = await dealFor(req, id, "brand");
      const { ok } = z.object({ ok: z.boolean() }).parse(req.body);
      await decide(d, postId, ok);
      return dealView((await getDeal(d.id))!, await me(req));
    });

    auth.post("/api/deals/:id/cancel", async (req) => {
      const d = await dealFor(req, (req.params as any).id, "brand");
      if (d.state !== "new") throw new ApiError(409, "CANT_CANCEL", "The money is held until the accept time ends.");
      await sql`UPDATE deals SET close_reason = 'cancelled' WHERE id = ${d.id}`;
      const moved = await setState(d, "closed");
      return dealView(moved, await me(req));
    });

    auth.post("/api/deals/:id/stopped", async (req) => {
      const d = await dealFor(req, (req.params as any).id, "brand");
      await logEvent(d.id, "stop_requested", "brand");
      if (d.prize_id) {
        const p = await getPrize(d.prize_id);
        if (p.status === "refunded") await applyPrize(p, "vetoed");
      }
      return dealView((await getDeal(d.id))!, await me(req));
    });

    auth.post("/api/precheck", async (req) => {
      limit(`precheck:${req.userId}`, 20);
      const b = z.object({ dealId: z.string().max(20).optional(), caption: z.string().max(2200).optional(), url: z.string().max(300).optional() })
        .refine((x) => x.caption || x.url, { message: "Paste a caption or a link." }).parse(req.body);
      return precheck(req.userId, b);
    });
  });

  app.get("/api/c/:username", async (req) => {
    const { username } = req.params as { username: string };
    const cur = String((req.query as any)?.cur ?? "NGN").toUpperCase();
    const page = await creatorPage(username, CURRENCIES.includes(cur) ? cur : "NGN");
    if (!page) throw new ApiError(404, "NO_CREATOR", "We couldn't find that creator.");
    return page;
  });

  app.get("/api/check/:id", async (req) => {
    const r = await publicCheck((req.params as any).id);
    if (!r) throw new ApiError(404, "NO_DEAL", "We couldn't find that deal.");
    return r;
  });

  app.get("/api/fx", async () => ({ base: "USD", rates: await rates() }));
}
