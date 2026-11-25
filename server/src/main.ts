import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { verifyWebhook } from "@zendfi/appkit/server";
import { env } from "./env.js";
import { sql, migrate } from "./db.js";
import { ApiError, FAIL_COPY } from "./errors.js";
import { apiRoutes } from "./routes.js";
import { opsRoutes } from "./ops.js";
import { handleEvent } from "./webhook.js";
import { startScheduler } from "./result.js";
import { errText } from "./zend.js";

const app = Fastify({ logger: { level: "info" }, trustProxy: true, bodyLimit: 256 * 1024 });

// Keep the raw body: webhook signatures are over the exact bytes.
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  (req as any).rawBody = body;
  try {
    done(null, body ? JSON.parse(String(body)) : {});
  } catch {
    done(new ApiError(400, "BAD_JSON", FAIL_COPY), undefined);
  }
});

// BigInt → number in JSON answers.
app.setReplySerializer((p) => JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));

app.addHook("onSend", async (req, reply, payload) => {
  reply.header("Content-Security-Policy", "frame-ancestors 'self' https://app.usezend.app");
  reply.header("X-Content-Type-Options", "nosniff");
  return payload;
});

app.setErrorHandler((err: any, req, reply) => {
  if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code, message: err.message });
  if (err instanceof ZodError) {
    const msg = err.issues.find((i) => i.code === "custom")?.message ?? "Some fields need fixing.";
    return reply.code(400).send({ error: "INVALID", message: msg, issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: "BAD_REQUEST", message: FAIL_COPY });
  req.log.error({ err: errText(err) }, "unhandled");
  return reply.code(500).send({ error: "SERVER", message: FAIL_COPY });
});

app.get("/.well-known/zend-app.json", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  return { app: env.slug };
});

// Liveness for the host's health check: this process and its database only. /healthz also checks
// Zend, and a Zend outage shouldn't make a host restart or roll back Kobolt.
app.get("/livez", async () => {
  await sql`SELECT 1`;
  return { ok: true };
});

app.get("/healthz", async (req, reply) => {
  const out: Record<string, unknown> = {};
  try {
    await sql`SELECT 1`;
    out.db = "ok";
  } catch (e) {
    out.db = String(e);
  }
  try {
    const r = await fetch(`${env.zendApi}/api/zend/v2/apps/attest/key`, { signal: AbortSignal.timeout(4000) });
    out.zend = r.ok ? "ok" : `status ${r.status}`;
  } catch (e) {
    out.zend = String(e);
  }
  const ok = out.db === "ok" && out.zend === "ok";
  return reply.code(ok ? 200 : 503).send({ ok, ...out });
});

app.post("/zend/webhook", async (req, reply) => {
  const raw = String((req as any).rawBody ?? "");
  if (!verifyWebhook(raw, String(req.headers["x-zend-signature"] ?? ""), env.webhookSecret)) {
    return reply.code(401).send({ error: "BAD_SIGNATURE" });
  }
  const e = req.body as any;
  const id = String(req.headers["x-zend-event-id"] ?? e.id ?? "");
  const [{ fresh }] = await sql<{ fresh: boolean }[]>`
    WITH ins AS (INSERT INTO zend_events (event_id, type) VALUES (${id}, ${String(e.type)}) ON CONFLICT DO NOTHING RETURNING 1)
    SELECT EXISTS (SELECT 1 FROM ins) AS fresh`;
  reply.code(200).send({ ok: true });
  if (fresh) {
    setImmediate(() =>
      handleEvent(e.type, e.data).catch((err) => req.log.error({ event: e.type, err: errText(err) }, "webhook handler failed")),
    );
  }
});

await app.register(apiRoutes);
await app.register(opsRoutes);

// Pages: the built Vite app, with every unknown GET falling back to index.html.
const dist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist, wildcard: false });
  const index = readFileSync(`${dist}/index.html`);
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api/")) return reply.code(404).send({ error: "NOT_FOUND", message: "Not found." });
    reply.type("text/html").header("cache-control", "no-store").send(index);
  });
}

await migrate();
startScheduler();
await app.listen({ port: env.port, host: "0.0.0.0" });
