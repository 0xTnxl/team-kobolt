import { useState } from "preact/hooks";
import { api, me, setMe, go, zendMessage, type Me } from "../api";
import { Top, ErrorBox, toast } from "../ui";

const CURRENCIES: [string, string][] = [
  ["NGN", "Naira (₦)"], ["GBP", "Pounds (£)"], ["USD", "Dollars ($)"], ["EUR", "Euros (€)"],
  ["CAD", "Canadian dollars"], ["GHS", "Cedis"], ["KES", "Kenyan shillings"], ["ZAR", "Rand"],
];

export function Settings() {
  const [cur, setCur] = useState(me?.currency ?? "NGN");
  const [handle, setHandle] = useState(me?.tiktokHandle ? `@${me.tiktokHandle}` : "");
  const [show, setShow] = useState(!!me?.showEarnings);
  const [err, setErr] = useState<string | null>(null);

  async function save(p: Partial<{ currency: string; tiktokHandle: string; showEarnings: boolean }>) {
    setErr(null);
    try {
      const r = await api<{ me: Me }>("/api/me", { method: "PATCH", body: p });
      setMe(r.me);
      toast("Saved");
    } catch (e) {
      setErr(zendMessage(e));
    }
  }

  return (
    <div class="page">
      <Top back="/" title="Settings" />
      <ErrorBox text={err} />
      <div class="field">
        <label>Show amounts in</label>
        <select class="input" value={cur} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setCur(v); save({ currency: v }); }}>
          {CURRENCIES.map(([k, l]) => <option value={k}>{l}</option>)}
        </select>
        <div class="tiny muted" style={{ marginTop: 4 }}>Prices show as the brand set them, plus "about" your money. Zend's own screens show the exact amount.</div>
      </div>
      <div class="field">
        <label>Your TikTok name</label>
        <div class="row">
          <input class="input mono grow" value={handle} placeholder="@yourname" maxLength={40} onInput={(e) => setHandle((e.target as HTMLInputElement).value)} />
          <button class="btn small" disabled={!/^@?[\w.]{2,40}$/.test(handle.trim())} onClick={() => save({ tiktokHandle: handle.trim() })}>Save</button>
        </div>
        <div class="tiny muted" style={{ marginTop: 4 }}>Kobolt checks your posts came from this account.</div>
      </div>
      <div class="field">
        <div class="row between">
          <div>
            <div>Show my earnings on my page</div>
            <div class="tiny muted">Off by default. Brands see your paid deals either way.</div>
          </div>
          <button class={`toggle ${show ? "on" : ""}`} aria-label="Show earnings" onClick={() => { setShow(!show); save({ showEarnings: !show }); }} />
        </div>
      </div>
      {me?.username && <button class="btn ghost" style={{ marginTop: 20 }} onClick={() => go(`/c/${me!.username}`)}>See my page</button>}
    </div>
  );
}
