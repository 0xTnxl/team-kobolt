import { runRules, type Brief, type CheckResult, type PostFacts } from "./rules.js";
import { runAi } from "./ai.js";

export * from "./rules.js";
export * from "./tiktok.js";
export { runAi } from "./ai.js";

export type PostDecision = "passed" | "failed" | "needs_brand";

export interface CheckOutcome {
  checks: CheckResult[];
  status: PostDecision;
  note: string | null; // why it went to the brand
}

/**
 * Rules first (a failed rule is final and skips the AI), then the AI. `onProgress` gets the
 * lines as they finish so pages can draw them while the AI runs.
 */
export async function checkPost(
  b: Brief,
  p: PostFacts,
  opts: { typed?: boolean; onProgress?: (checks: CheckResult[]) => Promise<void> } = {},
): Promise<CheckOutcome> {
  const rules = runRules(b, p);
  await opts.onProgress?.(rules);
  if (rules.some((c) => c.status === "fail")) return { checks: rules, status: "failed", note: null };

  const ai = await runAi(b, p.caption);
  const checks = [...rules, ...ai.checks];
  if (ai.injectionQuote !== null || ai.reason?.startsWith("The caption tried")) {
    checks.push({
      id: "INJECTION",
      layer: "ai",
      status: "unclear",
      label: "The caption tried to tell Kobolt what to do",
      quote: ai.injectionQuote,
      why: "The brand will look at this one.",
      fix: null,
    });
  }
  if (ai.decision === "fail") return { checks, status: "failed", note: null };
  if (rules.some((c) => c.status === "unknown")) return { checks, status: "needs_brand", note: "Kobolt couldn't read everything from the post." };
  if (opts.typed) return { checks, status: "needs_brand", note: "Kobolt can't read this app yet, so the brand checks it." };
  if (ai.decision === "unsure") return { checks, status: "needs_brand", note: ai.reason };
  return { checks, status: "passed", note: null };
}
