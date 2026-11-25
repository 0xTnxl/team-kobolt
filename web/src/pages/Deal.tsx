import { useEffect, useRef, useState } from "preact/hooks";
import { api, go, zend, zendMessage, me, ApiFail } from "../api";
import { Top, Chip, Sheet, ErrorBox, Stamp, when, clock, useNow, countdown, toast, type Check } from "../ui";
import { PostCard, ShareForm, Precheck } from "./Checks";

export interface PostView {
  id: string; slot: number; url: string; caption: string; author: string | null; postedAt: string | null;
  status: string; checks: Check[]; brandDecideBy: string | null; source: string;
}
export interface View {
  role: "brand" | "creator";
  deal: {
    id: string; interactionId: string; prizeId: string | null; state: string; brandName: string; title: string; platform: string;
    appName: string; postCount: number; hashtags: string[]; disclosure: string; avoidNames: string[]; avoidClaims: string[];
    postsDueAt: string; fundedAt: string | null; acceptDeadline: string | null; acceptedAt: string | null; resultSentAt: string | null;
    resultEarned: number | null; disputeEndsAt: string | null; paysAt: string | null; closedAt: string | null; closeReason: string | null;
    feedPosted: boolean; earned: number;
  };
  amounts: { total: string; perPost: string; paid: string | null; back: string | null };
  brand: { name: string; username: string | null; timeZone: string | null };
  creator: { name: string; username: string | null; timeZone: string | null; tiktok: string | null; appUserId: string };
  other: { name: string; timeZone: string | null };
  posts: PostView[];
  events: { type: string; actor: string; at: string }[];
}

const main = (s: string) => s.split(" (")[0];
const aboutPart = (s: string) => (s.includes("(about") ? s.slice(s.indexOf("(") + 1, -1) : null);
const plural = (n: number, app: string) => `${n} ${app}${n > 1 ? (app === "TikTok" ? "s" : " posts") : app === "TikTok" ? "" : " post"}`;

function Timeline({ v }: { v: View }) {
  const s = v.deal.state;
  const idx =
    s === "offered" ? 0 : s === "accepted" ? 1 : s === "checking" ? (v.posts.some((p) => p.status === "checking") ? 2 : 3) : s === "needs_brand" || s === "approved" ? 3 : ["paid", "part_paid"].includes(s) ? 5 : -1;
  const steps = ["Held", "Accept", "Post", "Check", "Paid"];
  return (
    <div class="timeline">
      {steps.map((name, i) => (
        <div class={`step ${i < idx ? "done" : i === idx ? "now" : ""}`}>
          <div class="dot" />
          {name}
        </div>
      ))}
    </div>
  );
}

function Hero({ v }: { v: View }) {
  const about = aboutPart(v.amounts.total);
  const otherCity = v.other.timeZone && v.other.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? v.other.timeZone.split("/").pop() : null;
  return (
    <div class="hero adire">
      <div class="who">
        {v.role === "creator" ? "You" : v.creator.name} <span>post{v.role === "creator" ? "" : "s"}</span> {plural(v.deal.postCount, v.deal.appName)} <span>for</span> {v.role === "brand" ? "you" : v.deal.brandName}
      </div>
      <div class="money">
        <b>{main(v.amounts.total)}</b>
        {about && <span class="about"> · {about}{otherCity ? `, shown in ${otherCity === "Lagos" ? "Naira" : "your money"}` : ""}</span>}
      </div>
      <div class="small" style={{ opacity: 0.75 }}>{main(v.amounts.perPost)} for each post that checks out{aboutPart(v.amounts.perPost) ? ` (${aboutPart(v.amounts.perPost)})` : ""}</div>
      <div class="held">{v.role === "creator" ? "Held for you, safely, until the rules say who gets it" : `Held safely until the rules say who gets it`}</div>
    </div>
  );
}

function Brief({ v }: { v: View }) {
  const d = v.deal;
  const items = [
    `${plural(d.postCount, d.appName)}${v.creator.tiktok && d.platform === "tiktok" ? `, from @${v.creator.tiktok}` : ""}`,
    ...d.hashtags.map((h) => `Include ${h}`),
    ...(d.disclosure ? [`${d.disclosure} in the first line, and mean it`] : []),
    ...(d.avoidNames.length || d.avoidClaims.length
      ? [`Don't mention ${[...d.avoidNames].join(", ")}${d.avoidNames.length && d.avoidClaims.length ? " or say " : d.avoidClaims.length ? "Don't say " : ""}${d.avoidClaims.map((c) => `"${c}"`).join(", ")}`.replace("Don't mention Don't say", "Don't say")]
      : []),
    `Post by ${when(d.postsDueAt, v.other.timeZone)}`,
  ];
  return (
    <div class="card" style={{ marginTop: 12 }}>
      <ul class="brief">
        {items.map((t) => <li>{t}</li>)}
      </ul>
    </div>
  );
}

function Ring({ to, start, label }: { to: string; start: string | null; label: string }) {
  // Fills like cloth taking dye: the indigo deepens as the wait runs out.
  const now = useNow(1000);
  const end = new Date(to).getTime();
  const begin = start ? new Date(start).getTime() : end - 11 * 60_000;
  const frac = Math.min(1, Math.max(0, (now - begin) / (end - begin)));
  const r = 84;
  const c = 2 * Math.PI * r;
  return (
    <div class="ring" style={{ ["--dye" as any]: frac.toFixed(3) }}>
      <div class="vat adire" />
      <svg width="190" height="190">
        <circle cx="95" cy="95" r={r} stroke="var(--sunk)" stroke-width="10" fill="none" />
        <circle cx="95" cy="95" r={r} stroke="var(--indigo)" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray={c} stroke-dashoffset={c * (1 - frac)} />
      </svg>
      <div class="in">
        <div class="t">{now >= end ? "0:00" : countdown(to, now)}</div>
        <div class="tiny muted">{label}</div>
      </div>
    </div>
  );
}

function PaidScreen({ v, onFeed }: { v: View; onFeed: () => Promise<void> }) {
  useEffect(() => {
    document.body.classList.add("indigo");
    return () => document.body.classList.remove("indigo");
  }, []);
  const abroad = (me?.currency ?? "NGN") !== "NGN";
  return (
    <div class="paid-screen adire">
      <Stamp />
      <div class="big">{main(v.amounts.paid ?? v.amounts.total)}</div>
      {aboutPart(v.amounts.paid ?? "") && <div class="mono small" style={{ opacity: 0.75 }}>{aboutPart(v.amounts.paid!)}</div>}
      <div style={{ opacity: 0.9, marginTop: 6 }}>is in your Zend.</div>
      <div style={{ borderTop: "1px solid #ffffff22", marginTop: 28, paddingTop: 12 }}>
        <div class="kv"><span>From</span><span>{v.deal.brandName}</span></div>
        <div class="kv"><span>For</span><span>{plural(v.deal.resultEarned ?? v.deal.postCount, v.deal.appName)} · checked by Kobolt</span></div>
        {v.deal.state === "part_paid" && <div class="kv"><span>Went back</span><span>{main(v.amounts.back ?? "")}</span></div>}
        <div class="kv"><span>Deal</span><span class="mono">{v.deal.id}</span></div>
      </div>
      <div class="dock" style={{ background: "linear-gradient(to top, var(--indigo) 70%, transparent)" }}>
        <div>
          {!v.deal.feedPosted && <button class="btn white" onClick={onFeed}>Add to my page</button>}
          {v.deal.feedPosted && v.creator.username && (
            <button class="btn white" onClick={() => go(`/c/${v.creator.username}`)}>See my page</button>
          )}
          <button class="btn" style={{ marginTop: 8, background: "#ffffff1a" }} onClick={() => zend.close().catch(() => go("/"))}>Done</button>
          <div class="fine" style={{ color: "var(--on-indigo)", opacity: 0.75 }}>
            Send it to your bank from Zend: Send → Bank.
            {abroad && " Banks outside Nigeria need at least $5 (about £4), so a small deal can wait in your Zend until there's enough."}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DealPage({ id }: { id: string }) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "join" | "stop">(null);
  const [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState(me?.tiktokHandle ?? "");
  const [sharing, setSharing] = useState(false);
  const alive = useRef(true);

  const load = () => api<View>(`/api/deals/${id}`).then((nv) => alive.current && setV(nv));

  useEffect(() => {
    alive.current = true;
    load().catch((e) => setErr(e instanceof ApiFail ? e.message : "That didn't go through. Try again."));
    return () => void (alive.current = false);
  }, [id]);

  // Poll: fast while checking, so the lines appear on both phones.
  useEffect(() => {
    if (!v) return;
    const s = v.deal.state;
    const fast = s === "checking" || v.posts.some((p) => p.status === "checking");
    const ms = fast ? 2000 : ["offered", "accepted", "needs_brand"].includes(s) ? 4000 : s === "approved" ? 5000 : 0;
    if (!ms) return;
    const t = setTimeout(() => {
      const near = s === "approved" && v.deal.paysAt && Date.now() > new Date(v.deal.paysAt).getTime() - 30_000;
      (near || s === "offered" ? api<View>(`/api/deals/${id}/refresh`, { body: {} }) : api<View>(`/api/deals/${id}`)).then(
        (nv) => alive.current && setV(nv),
        () => {},
      );
    }, ms);
    return () => clearTimeout(t);
  }, [v]);

  if (err) return <div class="page"><Top back="/" /><ErrorBox text={err} /></div>;
  if (!v) return <div class="loading">Loading the deal…</div>;
  const d = v.deal;

  async function join() {
    setBusy(true);
    setErr(null);
    try {
      if (d.platform === "tiktok" && !v!.creator.tiktok) {
        if (!/^@?[\w.]{2,40}$/.test(handle.trim())) throw new ApiFail("HANDLE", "Add your TikTok name first.");
      }
      await zend.prize.join(d.prizeId!);
      setV(await api<View>(`/api/deals/${d.id}/joined`, { body: handle.trim() ? { tiktokHandle: handle.trim() } : {} }));
      setSheet(null);
      toast("You're in. Post, then share your links here.");
    } catch (e: any) {
      const m = zendMessage(e, { brand: d.brandName });
      if (e?.code === "JOIN_CLOSED") await api(`/api/deals/${d.id}/refresh`, { body: {} }).then(setV, () => {});
      setSheet(null);
      if (m) setErr(m);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    setErr(null);
    try {
      await zend.prize.cancel(d.prizeId!);
      setV(await api<View>(`/api/deals/${d.id}/stopped`, { body: {} }));
      setSheet(null);
      toast("Payout stopped. The money is coming back to you.");
    } catch (e) {
      setSheet(null);
      const m = zendMessage(e);
      if (m) setErr(m);
    } finally {
      setBusy(false);
    }
  }

  async function decide(postId: string, ok: boolean) {
    try {
      setV(await api<View>(`/api/deals/${d.id}/posts/${postId}/decide`, { body: { ok } }));
    } catch (e) {
      setErr(zendMessage(e));
    }
  }

  async function addToPage() {
    try {
      await zend.postCard({
        interactionId: d.interactionId,
        template: "result",
        placement: "feed",
        idempotencyKey: `${d.id}:feed`,
        slots: {
          title: `${v!.creator.name} got paid by ${d.brandName}`.slice(0, 80),
          subtitle: `${plural(d.resultEarned ?? d.postCount, d.appName)} checked by Kobolt`,
          emoji: "✅",
          buttons: [{ label: "See the check", action: "open_url", url: `${location.origin}/check/${d.id}` }],
        },
      });
      await api(`/api/deals/${d.id}/card`, { body: { placement: "feed" } });
      toast("Added to your page");
    } catch (e: any) {
      if (e?.code === "POSTING_NOT_ALLOWED") toast("Turn on posting for Kobolt in Zend's settings first.");
      else if (e?.code !== "USER_CANCELLED") toast("That didn't go through. Try again.");
    }
    load();
  }

  if (v.role === "creator" && (d.state === "paid" || d.state === "part_paid")) return <PaidScreen v={v} onFeed={addToPage} />;

  const isBrand = v.role === "brand";
  const cname = v.creator.name;
  const takingPosts = ["accepted", "checking", "needs_brand"].includes(d.state) && !d.resultSentAt;
  const acceptOpen = d.acceptDeadline && Date.now() < new Date(d.acceptDeadline).getTime();
  const showShare = !isBrand && takingPosts && (sharing || !v.posts.length || v.posts.some((p) => p.status === "failed"));

  return (
    <div class="page">
      <Top back="/">
        <div class="row" style={{ gap: 8 }}>
          <span class="title">{isBrand ? cname : d.brandName}</span>
          <Chip state={d.state} />
        </div>
      </Top>
      <ErrorBox text={err} />

      <div class="deal-grid"><div class="deal-side">
      {d.state === "approved" && d.paysAt ? (
        <div class="center">
          <Stamp />
          <div class="small muted" style={{ marginTop: 10 }}>{d.earned} of {d.postCount} {d.postCount > 1 ? "posts" : "post"} checked out</div>
          <Ring to={d.paysAt} start={d.resultSentAt} label={isBrand ? `until ${cname} is paid` : "until you're paid"} />
          <h2 style={{ marginTop: 0 }}>
            {isBrand ? `${cname} gets ${main(v.amounts.paid ?? v.amounts.total)}` : `You get ${main(v.amounts.paid ?? v.amounts.total)}`}
            <br />
            <i>at {clock(d.paysAt)}</i>
          </h2>
          <p class="small muted">{isBrand ? `Zend holds it for 10 minutes, so you can still say stop.` : `Zend holds it for 10 minutes, so ${d.brandName} can still say stop. That's what keeps brands honest with you too.`}</p>
        </div>
      ) : (
        <>
          <Hero v={v} />
          <Timeline v={v} />
        </>
      )}

      {/* State notes */}
      {d.state === "new" && isBrand && <div class="note-box" style={{ marginTop: 12 }}>This deal isn't funded yet. <a href={`/new?interaction=${d.interactionId}`} onClick={(e) => (e.preventDefault(), go(`/new?interaction=${d.interactionId}`))}>Finish it</a></div>}
      {d.state === "offered" && isBrand && <div class="sunk small" style={{ marginTop: 12, color: "var(--indigo)" }}>Waiting for {cname} to accept · by {when(d.acceptDeadline, v.other.timeZone)}. If they don't, the money comes back to you.</div>}
      {d.state === "offered" && !isBrand && !acceptOpen && <div class="note-box" style={{ marginTop: 12 }}>This offer has closed. The money went back to {d.brandName}.</div>}
      {d.state === "accepted" && isBrand && <div class="sunk small" style={{ marginTop: 12, color: "var(--indigo)" }}>{cname} accepted · {plural(d.postCount, d.appName)} due {when(d.postsDueAt, v.other.timeZone)}</div>}
      {d.state === "accepted" && !isBrand && !v.posts.length && <div class="ok-box" style={{ marginTop: 12 }}>You're in. Post, then share your links here.</div>}
      {takingPosts && v.posts.length > 0 && !v.posts.some((p) => p.status === "checking") && d.earned < d.postCount && (
        <div class="note-box" style={{ marginTop: 12 }}>
          {d.earned} of {d.postCount} posts passed. {isBrand ? `${cname} can fix and share again until ${when(d.postsDueAt, v.other.timeZone)}.` : `Fix the other${d.postCount - d.earned > 1 ? "s" : " one"} and share again by ${when(d.postsDueAt, v.other.timeZone)}.`}
        </div>
      )}
      {takingPosts && d.earned >= d.postCount && acceptOpen && (
        <div class="ok-box" style={{ marginTop: 12 }}>Every post checked out. Kobolt sends the result when the accept time closes at {clock(d.acceptDeadline)}.</div>
      )}
      {d.state === "returned" && <div class="note-box" style={{ marginTop: 12 }}>{d.closeReason === "not_accepted" ? `${cname} didn't accept in time.` : "No posts checked out by the deadline."} The money went back to {isBrand ? "you" : d.brandName}.</div>}
      {d.state === "closed" && <div class="note-box" style={{ marginTop: 12 }}>{d.closeReason === "cancelled" ? "This deal was cancelled before it started." : `This offer has closed. The money went back to ${isBrand ? "you" : d.brandName}.`}</div>}
      {d.state === "stopped" && <div class="note-box" style={{ marginTop: 12 }}>{isBrand ? "You stopped the payout. The posts had checked out. The money went back to you." : `${d.brandName} stopped the payout. The posts had checked out. The money went back to them.`}</div>}
      {isBrand && (d.state === "paid" || d.state === "part_paid") && (
        <div class="ok-box" style={{ marginTop: 12 }}>
          Paid {main(v.amounts.paid ?? "")} to {cname}. {d.state === "part_paid" ? `${d.resultEarned} of ${d.postCount} posts checked out. ${main(v.amounts.back ?? "")} went back to you.` : `${plural(d.postCount, d.appName)} for ${d.brandName}.`}
        </div>
      )}

      </div><div class="deal-main">
      {/* Posts and their checks */}
      {v.posts.length > 0 && <div class="section-label">{v.posts.some((p) => p.status === "checking") ? `Kobolt is reading ${isBrand ? `${cname}'s` : "your"} post${v.posts.length > 1 ? "s" : ""}` : "What Kobolt read"}</div>}
      {v.posts.map((p) => <PostCard p={p} v={v} onDecide={isBrand ? (ok) => decide(p.id, ok) : undefined} />)}
      {!isBrand && takingPosts && v.posts.length > 0 && !showShare && (
        <button class="link" onClick={() => setSharing(true)}>Share a different post</button>
      )}

      {showShare && (
        <div style={{ marginTop: 18 }}>
          <ShareForm v={v} onDone={(nv) => (setV(nv), setSharing(false))} />
        </div>
      )}

      {(d.state === "offered" || ["accepted", "checking", "needs_brand"].includes(d.state)) && (
        <>
          <div class="section-label">The brief</div>
          <Brief v={v} />
        </>
      )}
      {!isBrand && (d.state === "offered" || takingPosts) && <Precheck v={v} />}
      </div></div>

      {!isBrand && d.state === "offered" && acceptOpen && (
        <>
          {d.platform === "tiktok" && !v.creator.tiktok && (
            <div class="field">
              <label>Your TikTok name (so Kobolt knows the posts are yours)</label>
              <input class="input mono" value={handle} placeholder="@yourname" maxLength={40} onInput={(e) => setHandle((e.target as HTMLInputElement).value)} />
            </div>
          )}
          <div style={{ height: 90 }} />
          <div class="dock">
            <div>
              <button class="btn" onClick={() => setSheet("join")}>Accept the deal</button>
              <div class="fine">
                Accept by {when(d.acceptDeadline, v.other.timeZone)}. Earliest payout {clock(new Date(new Date(d.acceptDeadline!).getTime() + 11 * 60_000))}: after approval there's a 10-minute wait, during which {d.brandName} can stop it.
              </div>
            </div>
          </div>
        </>
      )}

      {isBrand && d.state === "approved" && (
        <div class="dock">
          <div>
            <button class="btn outline-fail" style={{ background: "var(--card)" }} onClick={() => setSheet("stop")}>Stop this payout</button>
            <div class="fine">Until {clock(d.paysAt)} you can stop it and get all {main(v.amounts.paid ?? v.amounts.total)} back. Stops show on your brand page.</div>
          </div>
        </div>
      )}

      {sheet === "join" && (
        <Sheet onClose={() => !busy && setSheet(null)}>
          <h2>Lock in the deal</h2>
          <ol class="steps">
            <li><span class="n">1</span><div>Zend will ask you to join. That's how you lock in the deal. It's free.</div></li>
            <li><span class="n">2</span><div>Zend's screen calls this a prize.<div class="tiny muted">For Kobolt it's this deal's money, held safely until the rules say who gets it.</div></div></li>
            <li><span class="n">3</span><div>Post after you accept, then share the links here.<div class="tiny muted">You get {main(v.amounts.perPost)} for each post that checks out.</div></div></li>
          </ol>
          <button class="btn" disabled={busy} onClick={join}>{busy ? "Waiting for Zend…" : "Continue to Zend"}</button>
          <button class="link" style={{ width: "100%", marginTop: 6 }} disabled={busy} onClick={() => setSheet(null)}>Not now</button>
        </Sheet>
      )}
      {sheet === "stop" && (
        <Sheet onClose={() => !busy && setSheet(null)}>
          <h2>Stop this payout?</h2>
          <p class="small muted">
            The posts checked out. If you stop it, all of it comes back to you, {cname} gets nothing, and your brand page shows "Stopped a payout after the posts were approved".
          </p>
          <button class="btn outline-fail" disabled={busy} onClick={stop}>{busy ? "Waiting for Zend…" : "Stop the payout"}</button>
          <button class="link" style={{ width: "100%", marginTop: 6 }} disabled={busy} onClick={() => setSheet(null)}>Keep paying {cname}</button>
        </Sheet>
      )}
    </div>
  );
}
