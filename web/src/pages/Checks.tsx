import { useState } from "preact/hooks";
import { api, zendMessage } from "../api";
import { CheckLine, Running, ErrorBox, Icon, Stamp, MarkedCaption, when, type Check } from "../ui";
import type { View, PostView } from "./Deal";

const STATUS_CHIP: Record<string, [string, string]> = {
  checking: ["Reading", "wait"],
  passed: ["Checked out", "pass"],
  failed: ["1 to fix", "fail"],
  needs_brand: ["Brand checks this", "wait"],
  brand_ok: ["Approved by brand", "pass"],
  brand_no: ["Not approved", "fail"],
  pending: ["Waiting", "grey"],
};

function shortUrl(u: string) {
  return u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 44) + (u.length > 50 ? "…" : "");
}

export function PostCard({ p, v, onDecide }: { p: PostView; v: View; onDecide?: (ok: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const fails = p.checks.filter((c) => c.status === "fail").length;
  const [label, cls] = STATUS_CHIP[p.status] ?? [p.status, "grey"];
  const chipText = p.status === "failed" ? `${fails || 1} to fix` : label;
  const rules = p.checks.filter((c) => c.layer === "rule");
  const ai = p.checks.filter((c) => c.layer === "ai");
  const order = (c: Check) => (c.status === "fail" ? 0 : c.status === "pass" ? 2 : 1);
  const anyFail = fails > 0;
  const reading = p.status === "checking";
  const stamped = p.status === "passed" || p.status === "brand_ok";
  const low = (p.caption ?? "").toLowerCase();
  const inCaption = (c: Check) => !!(c.quote && low.includes(c.quote.trim().replace(/^[“"]|[”"]$/g, "").toLowerCase()));
  return (
    <div class={`card post ${p.status}`}>
      <div class="post-head">
        <div class="thumb adire"><Icon name="play" /></div>
        <div class="grow">
          <div style={{ fontWeight: 600 }}>Post {p.slot}{p.author ? <span class="muted" style={{ fontWeight: 400 }}> · @{p.author}</span> : null}</div>
          <a class="tiny" href={p.url} target="_blank" rel="noreferrer">{shortUrl(p.url)}</a>
        </div>
        {!stamped && <span class={`chip ${cls}`}>{chipText}</span>}
      </div>
      <div class="caption-wrap">
        {p.caption ? (
          <MarkedCaption caption={p.caption} checks={p.checks} reading={reading} />
        ) : reading ? (
          <div class="caption-skel" aria-label={`Reading the post from ${v.deal.appName}`}><i /><i /><i /></div>
        ) : null}
        {stamped && <Stamp by={p.status === "brand_ok" ? v.deal.brandName : undefined} />}
      </div>
      {!reading && (rules.length > 0 || ai.length > 0) && <div class="section-label" style={{ marginTop: 6 }}>Kobolt's notes</div>}
      {!reading && [...rules, ...ai].sort((a, b) => order(a) - order(b)).map((c) => <CheckLine c={c} inline={inCaption(c)} />)}
      {reading && rules.sort((a, b) => order(a) - order(b)).map((c) => <CheckLine c={c} inline={inCaption(c)} />)}
      {reading && (rules.length ? <Running label="Kobolt is reading the caption" /> : <Running label={`Kobolt is opening the post on ${v.deal.appName}`} />)}
      {p.status === "needs_brand" && v.role === "creator" && (
        <div class="note-box" style={{ marginTop: 10 }}>
          {v.deal.brandName} is checking this one.{" "}
          {!anyFail && p.brandDecideBy ? `If they don't decide by ${when(p.brandDecideBy, v.other.timeZone)}, you get paid for it.` : ""}
        </div>
      )}
      {p.status === "needs_brand" && v.role === "brand" && onDecide && (
        <div style={{ marginTop: 12 }}>
          <div class="small muted" style={{ margin: "8px 0" }}>
            Kobolt couldn't be sure about this post.{" "}
            {p.brandDecideBy && (anyFail ? `If you don't decide by ${when(p.brandDecideBy)}, it isn't paid.` : `If you don't decide by ${when(p.brandDecideBy)}, ${v.creator.name} gets paid for this post.`)}
          </div>
          <div class="row">
            <button class="btn small" disabled={busy} onClick={async () => (setBusy(true), await onDecide(true), setBusy(false))}>It's good, pay for it</button>
            <button class="btn small ghost" disabled={busy} onClick={async () => (setBusy(true), await onDecide(false), setBusy(false))}>It's not right</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ShareForm({ v, onDone }: { v: View; onDone: (nv: View) => void }) {
  const slots = Array.from({ length: v.deal.postCount }, (_, i) => v.posts.find((p) => p.slot === i + 1));
  const [urls, setUrls] = useState<string[]>(slots.map((p) => (p && p.status !== "failed" ? p.url : "")));
  const [captions, setCaptions] = useState<string[]>(slots.map(() => ""));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const typed = v.deal.platform !== "tiktok";

  async function send() {
    setErr(null);
    setBusy(true);
    try {
      const nv = await api<View>(`/api/deals/${v.deal.id}/posts`, { body: { urls, ...(typed ? { captions } : {}) } });
      onDone(nv);
    } catch (e) {
      setErr(zendMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>
        Posted it?
        <br />
        <i>Paste the link.</i>
      </h2>
      <p class="small muted">
        {typed ? "Paste the link and the caption exactly as posted. The brand checks it with Kobolt's checklist." : `Kobolt reads the caption from ${v.deal.appName} itself. You don't type anything else.`}
      </p>
      <ErrorBox text={err} />
      {slots.map((p, i) => (
        <div class="card">
          <div class="tiny muted">Post {i + 1} of {v.deal.postCount} {p && p.status === "passed" ? "· checked out ✓" : ""}</div>
          <input
            class="input boxed"
            style={{ marginTop: 6 }}
            value={urls[i]}
            placeholder={typed ? "instagram.com/p/…" : "tiktok.com/@you/video/…"}
            maxLength={300}
            onInput={(e) => setUrls(urls.map((u, j) => (j === i ? (e.target as HTMLInputElement).value : u)))}
          />
          {typed && (
            <textarea
              class="input boxed"
              style={{ marginTop: 6 }}
              value={captions[i]}
              placeholder="The caption, exactly as posted"
              maxLength={2200}
              onInput={(e) => setCaptions(captions.map((c, j) => (j === i ? (e.target as HTMLTextAreaElement).value : c)))}
            />
          )}
        </div>
      ))}
      <button class="btn" style={{ marginTop: 14 }} disabled={busy || !urls.some((u) => u.trim())} onClick={send}>
        {busy ? "Sending…" : v.posts.length ? "Check again" : v.deal.postCount > 1 ? "Check my posts" : "Check my post"}
      </button>
      <div class="tiny muted center" style={{ marginTop: 6 }}>
        You can fix and share again until {when(v.deal.postsDueAt, v.other.timeZone)}.
      </div>
    </div>
  );
}

export function Precheck({ v }: { v: View }) {
  const [text, setText] = useState("");
  const [res, setRes] = useState<{ checks: Check[]; status: string; note: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const isUrl = /tiktok\.com\//i.test(text);
      setRes(await api(`/api/precheck`, { body: { dealId: v.deal.id, ...(isUrl ? { url: text.trim() } : { caption: text }) } }));
    } catch (e) {
      setErr(zendMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const order = (c: Check) => (c.status === "fail" ? 0 : c.status === "pass" ? 2 : 1);
  return (
    <div class="sunk" style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 600, color: "var(--indigo)" }}>Not posted yet?</div>
      <div class="small" style={{ color: "var(--indigo)", margin: "2px 0 8px" }}>
        Paste your draft caption and see the checks first. You can also send it to @kobolt in Zend.
      </div>
      <textarea class="input boxed" value={text} placeholder="Your caption…" maxLength={2200} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
      <button class="btn small" style={{ marginTop: 8 }} disabled={busy || !text.trim()} onClick={run}>
        {busy ? "Checking…" : "Check before I post"}
      </button>
      <ErrorBox text={err} />
      {res && (
        <div class="card" style={{ marginTop: 10 }}>
          <div class={res.status === "passed" ? "ok-box" : res.status === "failed" ? "err" : "note-box"} style={{ margin: "0 0 6px" }}>
            {res.status === "passed" ? "Looks good. Post it, then share the link." : res.status === "failed" ? "This one wouldn't pass yet." : "The brand would need to look at this one."}
          </div>
          {[...res.checks].sort((a, b) => order(a) - order(b)).map((c) => <CheckLine c={c} />)}
          <div class="tiny muted" style={{ marginTop: 6 }}>This is a preview. Your real check runs when you share the link.</div>
        </div>
      )}
    </div>
  );
}
