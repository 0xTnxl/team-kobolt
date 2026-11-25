const e = process.env;

function need(k: string): string {
  const v = e[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}

export const env = {
  port: Number(e.PORT ?? 3000),
  // PUBLIC_ORIGIN wins; Render sets RENDER_EXTERNAL_URL on its own.
  origin: (e.PUBLIC_ORIGIN || e.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, ""),
  databaseUrl: e.DATABASE_URL ?? "postgres://kobolt:kobolt@localhost:5432/kobolt",
  sessionSecret: e.SESSION_SECRET ?? "dev-only-secret-change-me",
  zendApi: e.ZEND_API ?? "https://api.usezend.app",
  slug: e.ZEND_APP_SLUG ?? "kobolt",
  appKey: e.ZEND_APP_KEY ?? "",
  webhookSecret: e.ZEND_WEBHOOK_SECRET ?? "",
  resolverSeed: e.ZEND_RESOLVER_SEED ?? "",
  llmBase: (e.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, ""),
  llmKey: e.LLM_API_KEY ?? "",
  llmModel: e.LLM_MODEL ?? "gemini-flash-lite-latest",
  llmFallbacks: (e.LLM_FALLBACK_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  samples: Number(e.CHECK_SAMPLES ?? 3),
  fxUrl: e.FX_URL ?? "https://open.er-api.com/v6/latest/USD",
  demo: e.DEMO_MODE === "1",
  opsToken: e.OPS_TOKEN ?? "",
  need,
};

export const appLink = (params = "") => `https://app.usezend.app/apps/${env.slug}${params}`;
export const dealLink = (id: string) => appLink(`?deal=${id}`);
