import { sql, logEvent, getDeal, type DealRow } from "./db.js";
import { zend, errText } from "./zend.js";

// Mirrors the manifest's `deal` interaction. Every move is serverOnly.
export const TRANSITIONS: Record<string, string[]> = {
  new: ["offered", "closed", "expired"],
  offered: ["accepted", "closed", "expired"],
  accepted: ["checking", "approved", "returned", "expired"],
  checking: ["needs_brand", "approved", "returned", "expired"],
  needs_brand: ["checking", "approved", "returned", "expired"],
  approved: ["paid", "part_paid", "returned", "stopped", "expired"],
};
export const TERMINAL = new Set(["paid", "part_paid", "returned", "stopped", "closed", "expired"]);
export const OPEN_STATES = ["new", "offered", "accepted", "checking", "needs_brand", "approved"];

function route(from: string, to: string): string[] | null {
  const q: string[][] = [[from]];
  const seen = new Set([from]);
  while (q.length) {
    const path = q.shift()!;
    for (const n of TRANSITIONS[path[path.length - 1]] ?? []) {
      if (n === to) return [...path.slice(1), n];
      if (!seen.has(n) && n !== "expired") {
        seen.add(n);
        q.push([...path, n]);
      }
    }
  }
  return null;
}

/** Moves the deal (ours and Zend's interaction) to `to`, through allowed steps. */
export async function setState(d: DealRow, to: string, actor: "kobolt" | "zend" = "kobolt"): Promise<DealRow> {
  if (d.state === to) return d;
  const steps = route(d.state, to);
  if (!steps) {
    await sql`UPDATE deals SET last_error = ${`no route ${d.state} -> ${to}`}, updated_at = now() WHERE id = ${d.id}`;
    return d;
  }
  let cur = d;
  for (const step of steps) {
    let version = cur.interaction_version;
    try {
      const it: any = await zend.updateInteraction(cur.interaction_id, { state: step, idempotency_key: `${cur.id}:${step}` });
      version = Number(it?.version ?? version);
    } catch (e) {
      // The card label lags; our database stays the source of truth for the deal.
      await sql`UPDATE deals SET last_error = ${`interaction ${step}: ${errText(e)}`} WHERE id = ${cur.id}`;
    }
    const [row] = await sql<DealRow[]>`
      UPDATE deals SET state = ${step}, interaction_version = GREATEST(interaction_version, ${version}),
        closed_at = CASE WHEN ${TERMINAL.has(step)} THEN now() ELSE closed_at END, updated_at = now()
      WHERE id = ${cur.id} AND state = ${cur.state} RETURNING *`;
    if (!row) return (await getDeal(cur.id))!; // someone else moved it first
    await logEvent(cur.id, `state:${step}`, actor);
    cur = row;
  }
  return cur;
}
