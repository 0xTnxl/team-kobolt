import postgres from "postgres";
import { readFileSync } from "node:fs";
import { env } from "./env.js";

export const sql = postgres(env.databaseUrl, {
  max: 10,
  onnotice: () => {},
  types: { bigint: postgres.BigInt },
});

export async function migrate() {
  const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
  // A fresh managed database (Render, Nobus) can come up after the app: wait up to ~2 minutes.
  for (let i = 0; ; i++) {
    try {
      await sql`SELECT 1`;
      break;
    } catch (e) {
      if (i >= 40) throw e;
      console.error(JSON.stringify({ event: "db_waiting", attempt: i + 1, error: String(e) }));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  // The web and bot processes both migrate on boot; the lock stops them racing on a fresh database.
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(4241)`;
    await tx.unsafe(schema);
  });
}

export type Actor = "brand" | "creator" | "kobolt" | "zend" | "bot";

export async function logEvent(dealId: string | null, type: string, actor: Actor, data: object = {}) {
  await sql`INSERT INTO events (deal_id, type, actor, data) VALUES (${dealId}, ${type}, ${actor}, ${sql.json(data as any)})`;
}

export interface UserRow {
  app_user_id: string;
  username: string | null;
  name: string;
  avatar: string | null;
  currency: string;
  time_zone: string | null;
  tiktok_handle: string | null;
  show_earnings: boolean;
}

export interface DealRow {
  id: string;
  interaction_id: string;
  brand_id: string;
  creator_id: string;
  brand_name: string;
  title: string;
  platform: "tiktok" | "instagram";
  post_count: number;
  price_ngn: number | null;
  price_usd_micro: bigint | null;
  hashtags: string[];
  disclosure: string;
  avoid_names: string[];
  avoid_claims: string[];
  accept_secs: number;
  hold_result: boolean;
  posts_due_at: Date;
  state: string;
  interaction_version: number;
  prize_id: string | null;
  pot_usd_micro: bigint | null;
  pot_ngn: string | null;
  per_post_usd_micro: bigint | null;
  funded_at: Date | null;
  accept_deadline: Date | null;
  accepted_at: Date | null;
  result_deadline: Date | null;
  result_sent_at: Date | null;
  result_earned: number | null;
  paid_amount_micro: bigint | null;
  dispute_ends_at: Date | null;
  closed_at: Date | null;
  close_reason: string | null;
  card_posted: boolean;
  feed_posted: boolean;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PostRow {
  id: string;
  deal_id: string;
  slot: number;
  url: string;
  canonical_url: string;
  caption: string;
  author: string | null;
  posted_at: Date | null;
  live: boolean | null;
  source: "tiktok_oembed" | "typed";
  status: "pending" | "checking" | "passed" | "failed" | "needs_brand" | "brand_ok" | "brand_no";
  checks: any[];
  brand_decide_by: Date | null;
  replaced: boolean;
  checked_at: Date | null;
  created_at: Date;
}

export async function getDeal(id: string): Promise<DealRow | undefined> {
  const [d] = await sql<DealRow[]>`SELECT * FROM deals WHERE id = ${id}`;
  return d;
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  const [u] = await sql<UserRow[]>`SELECT * FROM users WHERE app_user_id = ${id}`;
  return u;
}

export async function livePosts(dealId: string): Promise<PostRow[]> {
  return sql<PostRow[]>`SELECT * FROM posts WHERE deal_id = ${dealId} AND NOT replaced ORDER BY slot, created_at`;
}
