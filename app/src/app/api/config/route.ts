// Serves the browser's part of localnet.json (publicConfig: no root, keeper or solver key). Localnet only:
// it carries the demo trader's and the bots' throwaway dev keys, which is what lets the app sign as them
// without a wallet.

import { deployment, guard, publicConfig } from "@/lib/server/localnet";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const no = guard(req);
  if (no) return no;
  try {
    return Response.json(publicConfig(deployment()));
  } catch {
    return Response.json({ error: "No localnet.json. Run `pnpm localnet` first." }, { status: 503 });
  }
}
