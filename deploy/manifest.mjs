// Writes zapp.json from the template: node deploy/manifest.mjs <origin> <resolverPublicKeyHex> [botHandle]
import { readFileSync, writeFileSync } from "node:fs";

const [origin, key, bot] = process.argv.slice(2);
if (!origin?.startsWith("https://") || !/^[0-9a-f]{64}$/i.test(key ?? "")) {
  console.error("usage: node deploy/manifest.mjs https://<origin> <64-hex resolver public key> [bot handle]");
  process.exit(1);
}
const t = readFileSync(new URL("../zapp.template.json", import.meta.url), "utf8")
  .replaceAll("__ORIGIN__", origin.replace(/\/$/, ""))
  .replaceAll("__RESOLVER_KEY__", key);
const m = JSON.parse(t);
if (bot) m.bot = bot.replace(/^@/, "");
writeFileSync(new URL("../zapp.json", import.meta.url), JSON.stringify(m, null, 2) + "\n");
console.log(`zapp.json written for ${m.origins[0]}${bot ? ` with bot @${m.bot}` : ""}`);
