import { useEffect, useState } from "preact/hooks";
import { api, zend, me, go } from "../api";
import { Top, Avatar, CheckLine, ErrorBox, Icon, Stamp, MarkedCaption, toast, type Check } from "../ui";

interface CreatorData {
  name: string; username: string; avatar: string | null; tiktok: string | null; dealsPaid: number; brands: number; earnings: string | null;
  deals: { id: string; brandName: string; title: string; posts: number; appName: string; paidAt: string; checkedBy: string; amount: string | null }[];
}

const day = (iso: string) => {
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString() ? "today" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
const initials = (s: string) => s.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export function CreatorPage({ username }: { username: string }) {
  const [c, setC] = useState<CreatorData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<CreatorData>(`/api/c/${encodeURIComponent(username)}?cur=${me?.currency ?? "NGN"}`).then(setC, (e) => setErr(e.message));
  }, [username]);

  async function share() {
    const url = `${location.origin}/c/${c!.username}`;
    const text = `${c!.name} on Kobolt: ${c!.dealsPaid} paid deals, every post checked.`;
    try {
      if (zend.environment !== "external") {
        const r = await zend.share({ text, url });
        if (r.status === "copied") toast("Link copied");
      } else if (navigator.share) await navigator.share({ text, url });
      else (await navigator.clipboard.writeText(url), toast("Link copied"));
    } catch {}
  }

  if (err) return <div class="page"><Top back={zend.environment !== "external" ? "/" : undefined} /><ErrorBox text={err} /></div>;
  if (!c) return <div class="loading">Loading…</div>;
  const mine = me?.username?.toLowerCase() === c.username?.toLowerCase();
  return (
    <div class="page">
      <Top back={zend.environment !== "external" ? "/" : undefined} />
      <div class="row">
        <div class="avatar" style={{ width: 64, height: 64, fontSize: 26 }}>{c.avatar ? <img src={c.avatar} alt="" /> : c.name.charAt(0)}</div>
        <div>
          <h1 style={{ margin: "0 0 2px" }}>{c.name}</h1>
          <div class="mono small muted">{c.tiktok ? `@${c.tiktok}` : `@${c.username}`}</div>
        </div>
      </div>
      <div class="stats">
        <div class="card"><div class="n">{c.dealsPaid}</div><div class="tiny muted">paid deals</div></div>
        <div class="card"><div class="n">{c.brands}</div><div class="tiny muted">brands</div></div>
        <div class="card"><div class="n" style={{ fontSize: c.earnings ? 20 : 26, fontStyle: c.earnings ? "normal" : "italic" }}>{c.earnings ? c.earnings.split(" (")[0] : "Hidden"}</div><div class="tiny muted">earnings</div></div>
      </div>
      <div class="section-label">Paid deals</div>
      {!c.deals.length && <p class="small muted">No paid deals yet.</p>}
      {c.deals.length > 0 && <div class="list">{c.deals.map((d) => (
        <div class="deal-row" onClick={() => go(`/check/${d.id}`)}>
          <div class="frame adire"><span>{initials(d.brandName)}</span></div>
          <div class="grow">
            <div style={{ fontWeight: 600 }}>{d.brandName}</div>
            <div class="small muted">{d.posts} {d.appName} · {day(d.paidAt)}{d.amount ? ` · ${d.amount.split(" (")[0]}` : ""}</div>
          </div>
          {d.checkedBy === "Checked by Kobolt" ? <Stamp small /> : <span class="chip grey">{d.checkedBy}</span>}
        </div>
      ))}</div>}
      <div class="dock">
        <div>
          <button class="btn ghost" style={{ background: "var(--card)" }} onClick={share}>{mine ? "Share my page" : "Share this page"}</button>
          <div class="fine">Only deals that were really paid appear here.{mine ? " " : ""}{mine && <a href="/settings" onClick={(e) => (e.preventDefault(), go("/settings"))}>Show or hide earnings</a>}</div>
        </div>
      </div>
    </div>
  );
}

export function PublicCheck({ id }: { id: string }) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api(`/api/check/${id}`).then(setR, (e) => setErr(e.message));
  }, [id]);
  if (err) return <div class="page"><Top back={true} /><ErrorBox text={err} /></div>;
  if (!r) return <div class="loading">Loading…</div>;
  return (
    <div class="page">
      <Top back={true} title="The check" />
      <h1>
        {r.creator.name} <i>for {r.deal.brandName}</i>
      </h1>
      <p class="small muted">
        {r.deal.title} · paid {day(r.deal.paidAt)} · deal <span class="mono">{r.deal.id}</span>
      </p>
      {r.posts.map((p: any) => (
        <div class="card">
          <div class="post-head">
            <div class="thumb adire"><Icon name="play" /></div>
            <div class="grow">
              <div style={{ fontWeight: 600 }}>Post {p.slot}</div>
              <a class="tiny mono" href={p.url} target="_blank" rel="noreferrer">{p.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 44)}</a>
            </div>
          </div>
          <div class="caption-wrap">
            {p.caption && <MarkedCaption caption={p.caption} checks={p.checks} reading={false} />}
            <Stamp by={p.status === "passed" ? undefined : r.deal.brandName} />
          </div>
          {(p.checks as Check[]).map((c) => <CheckLine c={c} inline={!!(p.caption && c.quote && p.caption.toLowerCase().includes(c.quote.toLowerCase()))} />)}
        </div>
      ))}
    </div>
  );
}
