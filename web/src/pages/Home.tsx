import { useEffect, useState } from "preact/hooks";
import { api, go, zend, zendMessage, me } from "../api";
import { Brand, Chip, ErrorBox, when } from "../ui";

interface Summary {
  id: string;
  role: "brand" | "creator";
  state: string;
  title: string;
  brandName: string;
  otherName: string;
  otherTimeZone: string | null;
  postCount: number;
  appName: string;
  total: string;
  paid: string | null;
  postsDueAt: string;
}

const DONE = ["paid", "part_paid", "returned", "stopped", "closed", "expired"];

export function Home() {
  const [deals, setDeals] = useState<Summary[] | null>(null);
  const [tab, setTab] = useState<"open" | "done">("open");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ deals: Summary[] }>("/api/deals").then((r) => setDeals(r.deals), (e) => setErr(e.message));
  }, []);

  async function start() {
    setErr(null);
    setBusy(true);
    try {
      const picked = await zend.people.pick({ max: 1, title: "Who's posting for you?" });
      if (!picked.length) return;
      const it = await zend.interaction.create({ type: "deal", participants: [picked[0].pick], expiresInSecs: 31 * 86400 });
      go(`/new?interaction=${it.id}`);
    } catch (e) {
      setErr(zendMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const open = (deals ?? []).filter((d) => !DONE.includes(d.state));
  const done = (deals ?? []).filter((d) => DONE.includes(d.state));
  const list = tab === "open" ? open : done;

  return (
    <div class="page">
      <div class="top between">
        <Brand />
      </div>
      <h1>
        Pay for posts
        <br />
        <i>that went up.</i>
      </h1>
      <div class="tabs">
        <button class={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>
          Open{open.length ? ` ${open.length}` : ""}
        </button>
        <button class={tab === "done" ? "on" : ""} onClick={() => setTab("done")}>
          Done{done.length ? ` ${done.length}` : ""}
        </button>
      </div>
      <ErrorBox text={err} />
      {deals === null && <div class="loading" style={{ minHeight: 240 }}>Loading your deals</div>}
      {deals && !list.length && (
        <div class="sunk">
          <div style={{ fontWeight: 600, color: "var(--indigo)" }}>{tab === "open" ? "No open deals yet" : "Nothing finished yet"}</div>
          <div class="small muted" style={{ marginTop: 4 }}>
            Start a deal with a creator. The money is held safely until the rules say who gets it, and paid per post that checks out.
          </div>
        </div>
      )}
      {list.length > 0 && <div class="list">{list.map((d) => (
        <div class="deal-row" onClick={() => go(`/d/${d.id}`)}>
          <div class="frame adire"><span>{(d.otherName ?? "?").trim().charAt(0).toUpperCase()}</span></div>
          <div class="grow">
            <div style={{ fontWeight: 600 }}>{d.role === "brand" ? d.otherName : d.brandName}</div>
            <div class="small muted">
              {d.title} · {d.postCount} {d.appName}{d.postCount > 1 && d.appName === "TikTok" ? "s" : ""}
            </div>
            {d.state === "accepted" && <div class="tiny faint">Due {when(d.postsDueAt, d.otherTimeZone)}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div class="amount">{(d.paid && DONE.includes(d.state) ? d.paid : d.total).split(" (")[0]}</div>
            <Chip state={d.state} label={d.role === "creator" && d.state === "offered" ? "Waiting for you" : d.role === "brand" && d.state === "needs_brand" ? "Needs you" : undefined} />
          </div>
        </div>
      ))}</div>}
      <div class="dock">
        <div>
          <button class="btn" disabled={busy} onClick={start}>
            Start a deal
          </button>
          <div class="fine">
            Or tap + → Apps → Kobolt in any chat ·{" "}
            <a href="/settings" onClick={(e) => (e.preventDefault(), go("/settings"))}>
              Settings
            </a>
            {me?.username && (
              <>
                {" · "}
                <a href={`/c/${me.username}`} onClick={(e) => (e.preventDefault(), go(`/c/${me!.username}`))}>
                  My page
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
