import { describe, expect, it } from "vitest";
import { orderStage } from "./orders.ts";
import type { OrderKind } from "./client.ts";

const params = { fill_window_s: 30, limit_expiry_s: 86_400 };
const open = (limit: string | null): OrderKind => ({
  Open: { side: "Long", margin: "1", leverage: 2, cut_ppm: "0", triggers: { take_profit: null, stop_loss: null }, limit },
});
const close: OrderKind = { Close: { position_id: 1, reason: "Close" } };

describe("orderStage", () => {
  it("a market open or a close waits through the fill window, then is expiring, as the contract's expire allows", () => {
    for (const kind of [open(null), close]) {
      expect(orderStage({ kind, placed_at: 100 }, 130, params)).toEqual({ stage: "waiting", expiresAt: 130 });
      expect(orderStage({ kind, placed_at: 100 }, 131, params)).toEqual({ stage: "expiring", expiredAt: 130 });
    }
  });

  it("a limit open rests until its own expiry", () => {
    expect(orderStage({ kind: open("500"), placed_at: 100 }, 131, params)).toEqual({ stage: "resting", expiresAt: 86_500 });
    expect(orderStage({ kind: open("500"), placed_at: 100 }, 86_501, params)).toEqual({ stage: "expiring", expiredAt: 86_500 });
  });
});
