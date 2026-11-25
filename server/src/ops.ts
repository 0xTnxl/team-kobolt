import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sql, getDeal, type DealRow } from "./db.js";
import { env } from "./env.js";
import { maybeSendResult, resultReadiness, schedulerState } from "./result.js";

function authed(req: FastifyRequest, reply: FastifyReply): boolean {
  const t = String((req.query as any)?.token ?? req.headers["x-ops-token"] ?? "");
  if (!env.opsToken || t !== env.opsToken) {
    reply.code(401).send("no");
    return false;
  }
  return true;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const t = (d: Date | null) => (d ? new Date(d).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos" }) : "");

export async function opsRoutes(app: FastifyInstance) {
  app.get("/ops", async (req, reply) => {
    if (!authed(req, reply)) return;
    const deals = await sql<DealRow[]>`SELECT * FROM deals ORDER BY created_at DESC LIMIT 40`;
    const rows = [];
    for (const d of deals) {
      const open = ["accepted", "checking", "needs_brand"].includes(d.state) && !d.result_sent_at;
      const r = open ? await resultReadiness(d) : null;
      const ready = r ? (r.earned >= d.post_count && r.acceptClosed ? (d.hold_result ? "ready, held" : "ready") : `${r.earned}/${d.post_count} passed`) : "";
      rows.push(`<tr><td><b>${esc(d.id)}</b><br>${esc(d.brand_name)}</td><td>${esc(d.state)}</td><td>${esc(ready)}</td>
        <td>accept ${t(d.accept_deadline)}<br>due ${t(d.posts_due_at)}<br>${d.dispute_ends_at ? `wait ends ${t(d.dispute_ends_at)}` : ""}</td>
        <td>${open ? `<button onclick="act('${d.id}','hold',${!d.hold_result})">${d.hold_result ? "Release hold" : "Hold result"}</button>
        <button onclick="if(confirm('Send result for ${d.id}?'))act('${d.id}','send')">Send result now</button>` : ""}</td>
        <td style="color:#b00;max-width:280px">${esc(d.last_error)}</td></tr>`);
    }
    const s = schedulerState;
    reply.type("text/html").send(`<!doctype html><meta name=viewport content="width=device-width"><title>Kobolt ops</title>
      <style>body{font:14px system-ui;margin:16px}td,th{border-bottom:1px solid #ddd;padding:6px;vertical-align:top;text-align:left}button{margin:2px}</style>
      <h2>Kobolt ops</h2><p>Scheduler: ${s.runs} runs, last ${t(s.lastRun)} ${s.lastError ? `<span style="color:#b00">last error: ${esc(s.lastError)}</span>` : ""}</p>
      <table><tr><th>Deal</th><th>State</th><th>Result</th><th>Times (Lagos)</th><th></th><th>Last error</th></tr>${rows.join("")}</table>
      <script>const tok=new URLSearchParams(location.search).get('token');
      async function act(id,a,v){const r=await fetch('/ops/deals/'+id+'/'+a+'?token='+tok,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hold:v})});alert(await r.text());location.reload()}
      setTimeout(()=>location.reload(),15000)</script>`);
  });

  app.post("/ops/deals/:id/hold", async (req, reply) => {
    if (!authed(req, reply)) return;
    const hold = !!(req.body as any)?.hold;
    await sql`UPDATE deals SET hold_result = ${hold} WHERE id = ${(req.params as any).id}`;
    return { hold };
  });

  app.post("/ops/deals/:id/send", async (req, reply) => {
    if (!authed(req, reply)) return;
    const d = await getDeal((req.params as any).id);
    if (!d) return reply.code(404).send({ error: "no deal" });
    return maybeSendResult(d.id, { force: true });
  });
}
