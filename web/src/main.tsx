import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./style.css";
import { zend, signIn, api, go } from "./api";
import { Toaster } from "./ui";
import { Home } from "./pages/Home";
import { NewDeal } from "./pages/NewDeal";
import { DealPage } from "./pages/Deal";
import { CreatorPage, PublicCheck } from "./pages/Public";
import { Settings } from "./pages/Settings";

const PUBLIC = /^\/(c|check)\//;

function usePath() {
  const [p, set] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => set(location.pathname + location.search);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return p;
}

/** Where to go when Zend opened us on an interaction (card button, /i/ link, chat action). */
async function routeInteraction(iid: string, fallbackNew: boolean) {
  const r = await api<{ id: string | null }>(`/api/deals/by-interaction/${iid}`);
  if (r.id) return go(`/d/${r.id}`);
  if (fallbackNew) return go(`/new?interaction=${iid}`);
  go("/");
}

function Router() {
  const full = usePath();
  const [path, query] = full.split("?");
  const q = new URLSearchParams(query ?? "");
  const iid = q.get("interaction") ?? zend.launch.interaction;

  useEffect(() => {
    if (path === "/" && q.get("deal")) go(`/d/${q.get("deal")}`);
    else if ((path === "/" || path === "/d") && iid) routeInteraction(iid, true).catch(() => go("/"));
  }, [full]);

  if (path.startsWith("/c/")) return <CreatorPage username={decodeURIComponent(path.slice(3))} />;
  if (path.startsWith("/check/")) return <PublicCheck id={path.slice(7)} />;
  if (path === "/new") return <NewDeal interactionId={iid} />;
  if (path.startsWith("/d/")) return <DealPage id={path.slice(3).split("/")[0]} />;
  if (path === "/settings") return <Settings />;
  if ((path === "/" && q.get("deal")) || ((path === "/" || path === "/d") && iid)) return <div class="loading">Opening your deal…</div>;
  return <Home />;
}

function App() {
  const [ready, setReady] = useState<"wait" | "ok" | "outside" | "fail">("wait");
  const publicPage = PUBLIC.test(location.pathname);
  useEffect(() => {
    if (zend.environment === "external") return setReady(publicPage ? "ok" : "outside");
    signIn().then(
      () => setReady("ok"),
      () => setReady(publicPage ? "ok" : "fail"),
    );
  }, []);
  if (ready === "wait") return <div class="loading" aria-label="Loading" />;
  if (ready === "outside")
    return (
      <div class="page center" style={{ paddingTop: 120 }}>
        <h1>Open Kobolt from Zend.</h1>
        <p class="muted">Kobolt runs inside Zend, so brands and creators sign in and get paid there.</p>
        <a class="btn" href="https://app.usezend.app/apps/kobolt">
          Open in Zend
        </a>
      </div>
    );
  if (ready === "fail")
    return (
      <div class="page center" style={{ paddingTop: 120 }}>
        <h1>That didn't go through.</h1>
        <button class="btn" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  return (
    <>
      <Router />
      <Toaster />
    </>
  );
}

render(<App />, document.getElementById("app")!);
