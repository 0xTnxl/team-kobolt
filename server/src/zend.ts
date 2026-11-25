import { ZendServer } from "@zendfi/appkit/server";
import { env } from "./env.js";

export const zend = new ZendServer(env.appKey, env.zendApi);

export interface PrizePlayer {
  address: string;
  app_user_id: string | null;
}

export interface ServerPrize {
  id: string;
  app: string;
  host: string;
  pot_usd: number;
  pot_ngn: number | null;
  max_players: number;
  player_count: number;
  join_deadline: string;
  resolve_deadline: string;
  dispute_secs: number;
  dispute_ends: string | null;
  status: "open" | "resolved" | "paid" | "refunded";
  winners: { address: string; amount_usd?: number; amount?: number; app_user_id?: string | null }[] | null;
  reference: string | null;
  interaction_id: string | null;
  players: PrizePlayer[];
}

export const getPrize = (id: string) => zend.getPrize(id) as Promise<ServerPrize>;

/** Missed webhooks, for catch-up after downtime. */
export async function recentEvents(): Promise<any[]> {
  const r = await fetch(`${env.zendApi}/api/zend/v2/apps/server/events`, {
    headers: { authorization: `Bearer ${env.appKey}` },
  });
  if (!r.ok) throw new Error(`events ${r.status}`);
  const j: any = await r.json();
  return Array.isArray(j) ? j : j.events ?? [];
}

export function errCode(e: any): string {
  return String(e?.code ?? e?.body?.error ?? e?.error ?? "UNKNOWN");
}

export function errText(e: any): string {
  return `${errCode(e)} ${e?.status ?? ""} ${e?.message ?? e}`.trim();
}
