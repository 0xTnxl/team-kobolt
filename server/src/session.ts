import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";

const TTL_MS = 12 * 3600_000;

function sign(payload: string) {
  return createHmac("sha256", env.sessionSecret).update(payload).digest("base64url");
}

export function issueToken(appUserId: string): string {
  const payload = Buffer.from(JSON.stringify({ u: appUserId, t: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { u, t } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof u !== "string" || Date.now() - t > TTL_MS) return null;
    return u;
  } catch {
    return null;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const u = readToken((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  if (!u) return reply.code(401).send({ error: "SIGNED_OUT", message: "Please open Kobolt again." });
  req.userId = u;
}
