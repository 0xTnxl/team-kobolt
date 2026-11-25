// @kobolt: sends queued deal updates and answers "check before you post". It never moves money.
import { ZendBot } from "@zendfi/appkit/bot";
import { env, appLink, dealLink } from "../server/src/env.js";
import { sql, migrate, type UserRow, type DealRow } from "../server/src/db.js";
import { precheck, type PrecheckResult } from "../server/src/precheck.js";

const log = (o: object) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));

// Until @kobolt exists, idle instead of crash-looping (hosts restart workers that exit).
if (!process.env.ZEND_BOT_API_KEY) {
  log({ event: "bot_waiting", reason: "ZEND_BOT_API_KEY not set" });
  setInterval(() => {}, 1 << 30);
  await new Promise(() => {});
}

const bot = ZendBot.fromEnv(process.env, env.zendApi);

// ── Outbox: once-only messages queued by the server ─────────────────────────
async function drain() {
  const rows = await sql<{ id: string; to_username: string; text: string; attempts: number }[]>`
    SELECT id, to_username, text, attempts FROM bot_outbox WHERE sent_at IS NULL AND next_at <= now() ORDER BY created_at LIMIT 10`;
  for (const r of rows) {
    try {
      await bot.say(r.to_username, r.text, r.id.slice(0, 100));
      await sql`UPDATE bot_outbox SET sent_at = now(), error = NULL WHERE id = ${r.id}`;
      log({ event: "outbox_sent", id: r.id });
    } catch (e: any) {
      const code = String(e?.code ?? "NETWORK");
      if (code === "FIRST_CONTACT_OFF" || code === "NOT_FOUND" || r.attempts >= 8) {
        await sql`UPDATE bot_outbox SET sent_at = now(), error = ${code} WHERE id = ${r.id}`;
      } else {
        const wait = code === "RATE_LIMITED" ? 60 : Math.min(600, 5 * 2 ** r.attempts);
        await sql`UPDATE bot_outbox SET attempts = attempts + 1, error = ${code}, next_at = now() + make_interval(secs => ${wait}) WHERE id = ${r.id}`;
      }
      log({ event: "outbox_error", id: r.id, code });
    }
  }
}

// ── Replies ─────────────────────────────────────────────────────────────────
const TIKTOK = /\b(?:https?:\/\/)?(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/i;
const lastReply = new Map<string, number>();

function render(r: PrecheckResult): string {
  const head = r.deal ? `Preview for ${r.deal.brandName}: ${r.deal.title}` : "Preview";
  if (!r.checks.length) return `${head}\n${r.note ?? "Kobolt couldn't check that just now. Try again in a minute."}`;
  const order = (s: string) => (s === "fail" ? 0 : s === "unclear" || s === "unknown" ? 1 : 2);
  const lines = [...r.checks].sort((a, b) => order(a.status) - order(b.status)).map((c) => {
    const mark = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "?";
    let line = `${mark} ${c.label}`;
    if (c.status !== "pass" && c.quote) line += `  “${c.quote}”`;
    if (c.status !== "pass" && c.why) line += `\n   ${c.why}`;
    if (c.fix) line += `\n   Fix: ${c.fix}`;
    return line;
  });
  const verdict =
    r.status === "passed" ? "Looks good." : r.status === "failed" ? "This one wouldn't pass yet." : "The brand would need to look at this one.";
  const foot = "This is a preview. Your real check runs when you share the link in Kobolt.";
  return [head, verdict, "", ...lines, "", r.note && r.deal ? r.note : r.note ?? "", foot, r.deal ? dealLink(r.deal.id) : appLink()]
    .filter((x, i, a) => x !== "" || a[i - 1] !== "")
    .join("\n");
}

bot.onMessage(async (msg, ctx) => {
  const text = (msg.text ?? "").trim();
  if (!text) return;
  const prev = lastReply.get(msg.roomId) ?? 0;
  if (Date.now() - prev < 2000) await new Promise((r) => setTimeout(r, 2000 - (Date.now() - prev)));
  lastReply.set(msg.roomId, Date.now());

  const [u] = await sql<UserRow[]>`SELECT * FROM users WHERE lower(username) = lower(${msg.from.handle})`;
  if (!u) return ctx.reply(`Hi! I'm Kobolt's automated account. Open Kobolt to start: ${appLink()}`);

  if (/\b(pay|approve|release|refund|send (me )?(the )?money|cancel|stop the payout)\b/i.test(text) && text.length < 120 && !TIKTOK.test(text)) {
    return ctx.reply(`I can't move money or change deals. Open Kobolt: ${appLink()}`);
  }
  if (/^(help|hi|hello|hey|hiya|good (morning|afternoon|evening)|start|menu|bawo|how far)\b[!. ]*$/i.test(text)) {
    return ctx.reply(
      `I check your caption against your deal before you post, and tell you how your deals are going.\nSend me a TikTok link or paste your draft caption. Say "deals" to see your open deals.`,
    );
  }
  if (/^(my )?deals\??$/i.test(text)) {
    const deals = await sql<DealRow[]>`
      SELECT * FROM deals WHERE (brand_id = ${u.app_user_id} OR creator_id = ${u.app_user_id})
        AND state IN ('offered', 'accepted', 'checking', 'needs_brand', 'approved') ORDER BY updated_at DESC LIMIT 5`;
    if (!deals.length) return ctx.reply(`You have no open deals. Start one: ${appLink()}`);
    return ctx.reply(deals.map((d) => `${d.brand_name}: ${d.title} (${d.state.replace("_", " ")})\n${dealLink(d.id)}`).join("\n\n"));
  }
  const url = text.match(TIKTOK)?.[0];
  try {
    const r = await precheck(u.app_user_id, url ? { url } : { caption: text });
    await ctx.reply(render(r));
    log({ event: "precheck", user: u.username, status: r.status });
  } catch (e) {
    log({ event: "precheck_error", error: String(e) });
    await ctx.reply("That didn't go through. Try again.");
  }
});

bot.onError((e: any) => log({ event: "bot_error", code: e?.code, error: String(e?.message ?? e) }));

await migrate();
const me = await bot.me();
log({ event: "bot_up", handle: me.handle, app: (me as any).app?.slug ?? null });
setInterval(() => drain().catch((e) => log({ event: "drain_error", error: String(e) })), 2500);
await bot.start({ mode: "stream" });
