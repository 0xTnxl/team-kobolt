import { sql, getUser } from "./db.js";
import { dealLink } from "./env.js";

/** Queue a once-only @kobolt message. The key makes repeats harmless. */
export async function queue(key: string, toUserId: string, text: string, dealId?: string) {
  const u = await getUser(toUserId);
  if (!u?.username) return; // placeholder accounts can't get DMs; the card and pages cover them
  const body = dealId ? `${text}\n${dealLink(dealId)}` : text;
  await sql`INSERT INTO bot_outbox (id, to_username, text) VALUES (${key}, ${u.username}, ${body}) ON CONFLICT (id) DO NOTHING`;
}
