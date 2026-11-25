import { sql, type DealRow } from "./db.js";
import { confirmFunded, confirmJoined } from "./deals.js";
import { applyPrize } from "./result.js";

async function dealFor(prize: any): Promise<DealRow | undefined> {
  const [d] = await sql<DealRow[]>`
    SELECT * FROM deals WHERE prize_id = ${prize?.id ?? ""} OR id = ${prize?.reference ?? ""} LIMIT 1`;
  return d;
}

export async function handleEvent(type: string, data: any) {
  const prize = data?.prize;
  switch (type) {
    case "prize.created": {
      const d = await dealFor(prize);
      if (d && d.state === "new") await confirmFunded(d, prize.id, "zend");
      break;
    }
    case "prize.joined": {
      const d = await dealFor(prize);
      if (d) await confirmJoined(d, "zend");
      break;
    }
    case "prize.resolved":
    case "prize.paid":
    case "prize.refunded":
      if (prize) await applyPrize(prize, data.reason);
      break;
    case "interaction.updated":
      if (data?.id && typeof data.version === "number") {
        await sql`UPDATE deals SET interaction_version = GREATEST(interaction_version, ${data.version}) WHERE interaction_id = ${data.id}`;
      }
      break;
    default:
      break;
  }
}
