// The $1UP price over the last day, a sample a minute (see lib/server/oneupPrice.ts). Localnet only.

import { oneupPrices, startOneupPrice } from "@/lib/server/oneupPrice";
import { guard } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  startOneupPrice();
  return Response.json({ samples: oneupPrices() });
}
