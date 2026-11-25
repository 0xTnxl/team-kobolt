import type { ComponentChildren } from "preact";
import { Stamp } from "../ui";

/** Where people outside Zend go to open Kobolt. Same link as the "Open in Zend" screen. */
const OPEN = "https://app.usezend.app/apps/kobolt";

const OLD_WAY = [
  "Pay up front and hope the post goes up",
  "Or post first, then chase the money for weeks",
  "Screenshots as proof, and posts deleted the next day",
  "Missing hashtags or ad label, found out too late",
];

const KOBOLT_WAY = [
  "The money is held safely until the posts check out",
  "Kobolt reads every post: your account, posted on time, still up, right hashtags, ad label near the start",
  "Paid per post that passes. The rest goes back to the brand",
  "If the brand goes quiet for 24 hours, the creator is paid as long as no check failed",
];

const STEPS = [
  {
    title: "The brand holds the money",
    body: "In a chat with the creator, the brand writes the brief and holds the money. It's held safely until the rules say who gets it.",
  },
  {
    title: "The creator posts",
    body: "The creator accepts, posts on TikTok and pastes the links. Not sure about a caption? Send the draft to @kobolt first.",
  },
  {
    title: "Kobolt checks, then pays",
    body: "Each post is read and checked. After a 10-minute wait, when the brand can still stop it, the creator is paid in their own currency.",
  },
];

const SAMPLE_DEALS = [
  { brand: "Ade's Kitchen", initials: "AK", posts: "2 TikToks", day: "18 Nov" },
  { brand: "Lagos Juice Co.", initials: "LJ", posts: "1 TikTok", day: "9 Nov" },
  { brand: "Itoku Adire House", initials: "IA", posts: "3 TikToks", day: "27 Oct" },
];

const PROMISES = [
  { title: "Held safely", body: "Until the rules say who gets it" },
  { title: "10-minute wait", body: "The brand can stop a payout before it goes" },
  { title: "Read three times", body: "Every answer has to quote the caption" },
];

function Mark({ ok }: { ok: boolean }) {
  return (
    <span class={`lp-mark ${ok ? "ok" : "no"}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
        {ok ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7 7 17" />}
      </svg>
    </span>
  );
}

function Section({ id, children, class: cls }: { id?: string; children: ComponentChildren; class?: string }) {
  return (
    <section id={id} class={`lp-section ${cls ?? ""}`}>
      <div class="lp-wrap">{children}</div>
    </section>
  );
}

/** An example of a creator's public Kobolt page, drawn with the same parts as the real one. */
function SampleRecord() {
  return (
    <figure class="lp-record" aria-label="Example creator page on Kobolt">
      <div class="row">
        <div class="avatar" style={{ width: 48, height: 48, fontSize: 20 }}>A</div>
        <div class="grow">
          <div style={{ fontWeight: 650, fontSize: 17 }}>Amaka Okafor</div>
          <div class="mono tiny muted">@amakacooks</div>
        </div>
        <span class="chip pass">On Kobolt</span>
      </div>
      <div class="stats">
        <div class="card"><div class="n">12</div><div class="tiny muted">paid deals</div></div>
        <div class="card"><div class="n">7</div><div class="tiny muted">brands</div></div>
        <div class="card"><div class="n" style={{ fontSize: 20, fontStyle: "italic" }}>Hidden</div><div class="tiny muted">earnings</div></div>
      </div>
      <div class="section-label" style={{ margin: "0 2px 8px" }}>Paid deals</div>
      <div class="lp-record-list">
        {SAMPLE_DEALS.map((d) => (
          <div class="deal-row">
            <div class="frame adire"><span>{d.initials}</span></div>
            <div class="grow">
              <div style={{ fontWeight: 600 }}>{d.brand}</div>
              <div class="small muted">{d.posts} · {d.day}</div>
            </div>
            <Stamp small />
          </div>
        ))}
      </div>
    </figure>
  );
}

export function Landing() {
  return (
    <div class="lp">
      <header class="lp-nav-wrap">
        <nav class="lp-nav" aria-label="Main">
          <a class="brand" href="#top">
            <img src="/icon.svg" alt="" /> Kobolt
          </a>
          <div class="lp-links">
            <a href="#compare">Why Kobolt</a>
            <a href="#how">How it works</a>
            <a href="#record">For creators</a>
          </div>
          <a class="btn small" href={OPEN}>Open in Zend</a>
        </nav>
      </header>

      <main id="top">
        <Section class="lp-hero">
          <span class="lp-pill">Built at OgunInnovate 2026 · Runs inside Zend</span>
          <h1>
            Get paid for brand deals.
            <br />
            No more chasing.
          </h1>
          <p class="lp-lead">
            Kobolt holds a brand's money until the creator's posts check out, then pays the creator in their own currency.
            Every paid deal goes on the creator's record.
          </p>
          <div class="lp-ctas">
            <a class="btn" href={OPEN}>I'm a creator, get started</a>
            <a class="btn ghost" href={OPEN}>I'm a brand, start a deal</a>
          </div>
        </Section>

        <Section id="compare">
          <h2 class="lp-h2">
            The old way <span class="lp-vs">vs</span> Kobolt
          </h2>
          <div class="lp-compare">
            <div class="lp-col old">
              <div class="lp-col-title">Brand deals in DMs</div>
              <ul>
                {OLD_WAY.map((t) => (
                  <li><Mark ok={false} />{t}</li>
                ))}
              </ul>
            </div>
            <div class="lp-col new">
              <div class="lp-col-title">Brand deals on Kobolt</div>
              <ul>
                {KOBOLT_WAY.map((t) => (
                  <li><Mark ok />{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <Section id="how">
          <h2 class="lp-h2">How the money moves</h2>
          <ol class="lp-steps">
            {STEPS.map((s, i) => (
              <li class="lp-step">
                <div class="lp-step-n">0{i + 1}</div>
                <div class="lp-step-title">{s.title}</div>
                <p class="small muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="record">
          <div class="lp-record-grid">
            <div>
              <h2 class="lp-h2 left">
                Every paid deal goes on your record. <span class="lp-accent">Automatically.</span>
              </h2>
              <p class="muted">
                Your Kobolt page lists only the deals that were really paid, each with the check behind it. Share one link
                with the next brand instead of a folder of screenshots. You choose whether your earnings show.
              </p>
            </div>
            <SampleRecord />
          </div>
          <div class="lp-promises">
            {PROMISES.map((p) => (
              <div class="lp-promise">
                <Mark ok />
                <div>
                  <div class="lp-promise-title">{p.title}</div>
                  <div class="tiny muted">{p.body}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <section class="lp-cta">
          <div class="lp-wrap">
            <h2 class="lp-h2">Your next brand deal deserves better than a DM and a prayer.</h2>
            <a class="btn" href={OPEN}>Start your first deal on Kobolt</a>
          </div>
        </section>
      </main>

      <footer class="lp-foot">
        <div class="lp-wrap">
          <div class="lp-foot-grid">
            <div>
              <div class="brand">
                <img src="/icon.svg" alt="" /> Kobolt
              </div>
              <p class="small lp-foot-muted">
                Businesses in Ogun pay creators to post about them, at home or abroad. Kobolt checks the posts and pays.
              </p>
            </div>
            <div>
              <div class="lp-foot-head">Product</div>
              <a href="#how">How it works</a>
              <a href="#compare">Why Kobolt</a>
              <a href="#record">Creator pages</a>
            </div>
            <div>
              <div class="lp-foot-head">Kobolt</div>
              <a href={OPEN}>Open in Zend</a>
              <a href="https://usezend.app">About Zend</a>
            </div>
          </div>
          <div class="lp-foot-base small">© 2026 Kobolt · Built at OgunInnovate 2026</div>
        </div>
      </footer>
    </div>
  );
}
