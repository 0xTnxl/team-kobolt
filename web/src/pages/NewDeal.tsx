import { useEffect, useMemo, useState } from "preact/hooks";
import { api, go, zend, zendMessage, me, type Me } from "../api";
import { Top, Sheet, ErrorBox, when, toast } from "../ui";

type Platform = "tiktok" | "instagram";
interface LastBrief {
  brandName: string; title: string; platform: Platform; postCount: number; priceNgn: number | null; priceUsd: number | null;
  hashtags: string[]; disclosure: string; avoidNames: string[]; avoidClaims: string[]; acceptSecs: number;
}

const fmtMoney = (cur: string, v: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: cur, maximumFractionDigits: cur === "NGN" ? 0 : 2 }).format(v);

function Tags({ items, set, kind, placeholder }: { items: string[]; set: (x: string[]) => void; kind: "must" | "not"; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && items.length < 5 && !items.includes(v)) set([...items, v]);
    setDraft("");
  };
  return (
    <div class="choices">
      {items.map((t) => (
        <span class={`tag ${kind}`}>
          {t}
          <button aria-label={`Remove ${t}`} onClick={() => set(items.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      {items.length < 5 && (
        <span class="tag-add">
          <input
            value={draft}
            placeholder={placeholder}
            maxLength={kind === "must" ? 30 : 60}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            onBlur={add}
          />
        </span>
      )}
    </div>
  );
}

function dueOptions(acceptSecs: number) {
  const now = Date.now();
  const at6 = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(18, 0, 0, 0);
    return d;
  };
  const opts = [
    new Date(now + 20 * 60_000),
    new Date(now + 2 * 3600_000),
    at6(1),
    at6(3),
    at6(7),
  ];
  const min = now + (acceptSecs + 11 * 60) * 1000;
  return opts.filter((d) => d.getTime() >= min && d.getTime() <= now + 28 * 86400_000);
}

export function NewDeal({ interactionId }: { interactionId: string | null }) {
  const [other, setOther] = useState<string>("the creator");
  const [demo, setDemo] = useState(false);
  const [last, setLast] = useState<LastBrief | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [brandName, setBrandName] = useState("");
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>("tiktok");
  const [postCount, setPostCount] = useState(1);
  const [cur, setCur] = useState<"NGN" | "USD">((me as Me | null)?.currency === "NGN" || !me ? "NGN" : "USD");
  const [price, setPrice] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [adOn, setAdOn] = useState(true);
  const [disclosure, setDisclosure] = useState("#ad");
  const [avoidNames, setAvoidNames] = useState<string[]>([]);
  const [avoidClaims, setAvoidClaims] = useState<string[]>([]);
  const [acceptSecs, setAcceptSecs] = useState(10800);
  const [due, setDue] = useState<Date | null>(null);

  const [sheet, setSheet] = useState<null | { id: string; terms: any; total: string }>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!interactionId) return;
        const existing = await api<{ id: string | null; state?: string; role?: string }>(`/api/deals/by-interaction/${interactionId}`);
        if (existing.id && (existing.state !== "new" || existing.role !== "brand")) return go(`/d/${existing.id}`);
        const [it, m, fx] = await Promise.all([
          zend.interaction.get(interactionId),
          api<{ me: Me; demo: boolean; lastBrief: LastBrief | null }>("/api/me"),
          api<{ rates: Record<string, number> }>("/api/fx"),
        ]);
        const o = it.participants.find((p) => p.appUserId !== m.me.appUserId);
        if (o) setOther(o.name || o.username || "the creator");
        setDemo(m.demo);
        setLast(m.lastBrief);
        setRates(fx.rates);
        if (m.lastBrief) setBrandName(m.lastBrief.brandName);
      } catch (e) {
        setErr(zendMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [interactionId]);

  const dues = useMemo(() => dueOptions(acceptSecs), [acceptSecs]);
  useEffect(() => {
    if (!due || !dues.some((d) => d.getTime() === due.getTime())) setDue(dues.find((d) => d.getTime() - Date.now() > 86400_000) ?? dues[dues.length - 1] ?? null);
  }, [dues]);

  function repeat(b: LastBrief) {
    setBrandName(b.brandName);
    setTitle(b.title);
    setPlatform(b.platform);
    setPostCount(b.postCount);
    if (b.priceNgn != null) (setCur("NGN"), setPrice(String(b.priceNgn)));
    else if (b.priceUsd != null) (setCur("USD"), setPrice(String(b.priceUsd)));
    setHashtags(b.hashtags);
    setAdOn(!!b.disclosure);
    setDisclosure(b.disclosure || "#ad");
    setAvoidNames(b.avoidNames);
    setAvoidClaims(b.avoidClaims);
    setAcceptSecs(demo || b.acceptSecs !== 90 ? b.acceptSecs : 10800);
    toast("Filled in from your last deal");
  }

  const per = Number(price) || 0;
  const total = per * postCount;
  const usdTotal = rates ? (cur === "NGN" ? total / rates.NGN : total) : 0;
  const maxLabel = rates ? (cur === "NGN" ? fmtMoney("NGN", Math.floor((20 * rates.NGN) / 100) * 100) : "$20") : "$20";
  const viewerCur = me?.currency ?? "NGN";
  const about = rates && viewerCur !== cur && rates[viewerCur] && per ? `about ${fmtMoney(viewerCur, (cur === "NGN" ? per / rates.NGN : per) * rates[viewerCur])} a post` : null;
  const perLabel = per ? fmtMoney(cur, per) : cur === "NGN" ? "₦0" : "$0";
  const totalLabel = fmtMoney(cur, total);
  const tooBig = usdTotal > 20.0001;
  const tooSmall = total > 0 && usdTotal < 1;
  const ready = brandName.trim() && title.trim() && per > 0 && due && !tooBig && !tooSmall;

  async function submit() {
    if (!interactionId || !ready) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ id: string; terms: any }>("/api/deals", {
        body: {
          interactionId,
          brandName: brandName.trim(),
          title: title.trim(),
          platform,
          postCount,
          ...(cur === "NGN" ? { priceNgn: Math.round(per) } : { priceUsd: Math.round(per * 100) / 100 }),
          hashtags,
          disclosure: adOn ? disclosure.trim() : "",
          avoidNames,
          avoidClaims,
          acceptSecs,
          postsDueAt: due!.toISOString(),
        },
      });
      setSheet({ id: r.id, terms: r.terms, total: totalLabel });
    } catch (e) {
      setErr(zendMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function fund() {
    if (!sheet) return;
    setBusy(true);
    setErr(null);
    try {
      const prize = await zend.prize.create(sheet.terms);
      await api(`/api/deals/${sheet.id}/funded`, { body: { prizeId: prize.id } });
      const appName = platform === "tiktok" ? "TikTok" : "Instagram post";
      try {
        await zend.postCard({
          interactionId: interactionId!,
          template: "status",
          placement: "chat",
          idempotencyKey: `${sheet.id}:chat`,
          slots: {
            title: `${brandName.trim()} wants ${postCount} ${appName}${postCount > 1 ? "s" : ""}`.slice(0, 80),
            subtitle: `${sheet.total} held safely until the rules say who gets it`.slice(0, 140),
            emoji: "🧵",
            buttons: [{ label: "See the deal", action: "open_sheet", path: "/d" }],
          },
        });
        await api(`/api/deals/${sheet.id}/card`, { body: { placement: "chat" } });
      } catch {
        // Posting turned off or daily cap: @kobolt still tells the creator.
      }
      go(`/d/${sheet.id}`);
    } catch (e) {
      const msg = zendMessage(e, { max: maxLabel });
      setSheet(null);
      if (msg) setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!interactionId)
    return (
      <div class="page narrow">
        <Top back="/" title="New deal" />
        <h1>Start from a chat.</h1>
        <p class="muted">Open your chat with the creator and tap + → Apps → Kobolt → Start a deal, or pick them from Kobolt's home.</p>
      </div>
    );
  if (loading) return <div class="loading">Loading…</div>;

  const acceptChoices = demo ? [90, 3600, 10800, 86400] : [3600, 10800, 86400];
  const acceptLabel = (s: number) => (s === 90 ? "90 s" : `${s / 3600} h`);

  return (
    <div class="page narrow">
      <Top back="/" title="New deal" />
      <h1>
        A deal with <i>{other}</i>
      </h1>
      {last && (
        <button class="link" onClick={() => repeat(last)}>
          ↺ Repeat last deal
        </button>
      )}
      <ErrorBox text={err} />

      <div class="field">
        <label>Your business name</label>
        <input class="input" value={brandName} maxLength={40} placeholder="Itoku Adire House" onInput={(e) => setBrandName((e.target as HTMLInputElement).value)} />
      </div>
      <div class="field">
        <label>What's it for</label>
        <input class="input" value={title} maxLength={60} placeholder="New adire collection" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </div>
      <div class="field">
        <span class="lab">App</span>
        <div class="choices">
          <button class={`choice ${platform === "tiktok" ? "on" : ""}`} onClick={() => setPlatform("tiktok")}>TikTok</button>
          <button class={`choice ${platform === "instagram" ? "on" : ""}`} onClick={() => setPlatform("instagram")}>Instagram · you check</button>
        </div>
        {platform === "instagram" && <div class="tiny muted" style={{ marginTop: 6 }}>Kobolt can't read Instagram yet. You'll check these posts with Kobolt's checklist.</div>}
      </div>
      <div class="field">
        <div class="row between">
          <span class="lab" style={{ margin: 0 }}>Posts · pay per post</span>
          <div class="stepper">
            <button onClick={() => setPostCount(Math.max(1, postCount - 1))}>−</button>
            <span>{postCount}</span>
            <button onClick={() => setPostCount(Math.min(5, postCount + 1))}>+</button>
          </div>
        </div>
        <div class="price">
          <button class="link cur" onClick={() => setCur(cur === "NGN" ? "USD" : "NGN")} title="Switch currency">
            {cur === "NGN" ? "₦" : "$"}
          </button>
          <input inputMode="decimal" value={price} placeholder="0" onInput={(e) => setPrice((e.target as HTMLInputElement).value.replace(/[^\d.]/g, ""))} />
        </div>
        <div class="tiny muted">
          {about ? `${about} · ` : ""}Total {totalLabel} · up to about {maxLabel} per deal
        </div>
        {tooBig && <div class="tiny" style={{ color: "var(--fail)" }}>That's more than a deal can hold today: up to about {maxLabel}.</div>}
        {tooSmall && <div class="tiny" style={{ color: "var(--fail)" }}>A deal needs to hold at least about $1.</div>}
      </div>
      <div class="field">
        <span class="lab">Must include (exact hashtags)</span>
        <Tags items={hashtags} set={setHashtags} kind="must" placeholder="#ItokuAdire" />
      </div>
      <div class="field">
        <div class="row between">
          <span class="lab" style={{ margin: 0 }}>Say it's an ad, near the start</span>
          <button class={`toggle ${adOn ? "on" : ""}`} aria-label="Say it's an ad" onClick={() => setAdOn(!adOn)} />
        </div>
        {adOn && <input class="input mono" style={{ marginTop: 6, fontSize: 14, color: "var(--indigo)" }} value={disclosure} maxLength={30} onInput={(e) => setDisclosure((e.target as HTMLInputElement).value)} />}
      </div>
      <div class="field">
        <span class="lab">Don't mention (competitors)</span>
        <Tags items={avoidNames} set={setAvoidNames} kind="not" placeholder="Kemi's Fabrics" />
        <span class="lab" style={{ marginTop: 10 }}>Don't claim</span>
        <Tags items={avoidClaims} set={setAvoidClaims} kind="not" placeholder="cheapest in Abeokuta" />
      </div>
      <div class="field">
        <span class="lab">{other} accepts within</span>
        <div class="choices">
          {acceptChoices.map((s) => (
            <button class={`choice ${acceptSecs === s ? "on" : ""}`} onClick={() => setAcceptSecs(s)}>{acceptLabel(s)}</button>
          ))}
        </div>
        <span class="lab" style={{ marginTop: 10 }}>Posts due</span>
        <div class="choices">
          {dues.map((d) => (
            <button class={`choice ${due?.getTime() === d.getTime() ? "on" : ""}`} onClick={() => setDue(d)}>{when(d)}</button>
          ))}
        </div>
      </div>
      <p class="small muted">
        Posts must go up after {other} accepts. You pay {perLabel} for each post that checks out. Anything unearned comes back to you.
      </p>

      <div class="dock">
        <div>
          <button class="btn" disabled={!ready || busy} onClick={submit}>
            Hold {totalLabel} for {other}
          </button>
        </div>
      </div>

      {sheet && (
        <Sheet onClose={() => !busy && setSheet(null)}>
          <h2>
            Hold {sheet.total}
            <br />
            <i>for {other}</i>
          </h2>
          <ol class="steps">
            <li><span class="n">1</span><div>Make sure you have {sheet.total} in your Zend.<div class="tiny muted">Zend will ask you to confirm next.</div></div></li>
            <li><span class="n">2</span><div>Zend's screen calls this a prize.<div class="tiny muted">For Kobolt it's your deal's money.</div></div></li>
            <li><span class="n">3</span><div>Held safely until the rules say who gets it.<div class="tiny muted">The money stays held until the posts check out, the deadline passes, or you stop the payout. Anything unearned comes back to you, even if Kobolt is down.</div></div></li>
          </ol>
          <button class="btn" disabled={busy} onClick={fund}>{busy ? "Waiting for Zend…" : "Continue to Zend"}</button>
          <button class="link" style={{ width: "100%", marginTop: 6 }} disabled={busy} onClick={() => setSheet(null)}>Not now</button>
        </Sheet>
      )}
    </div>
  );
}
