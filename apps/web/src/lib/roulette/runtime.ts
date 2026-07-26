import "server-only";

import { getLivePixClient } from "@/lib/livepix/client";

import { SupabaseRouletteCoinPurchaseRepository } from "./coin-purchase-repository";
import { RouletteCoinPurchaseService } from "./coin-purchase";

let coinPurchaseService: RouletteCoinPurchaseService | undefined;

export function getRouletteCoinPurchaseService() {
  coinPurchaseService ??= new RouletteCoinPurchaseService(
    new SupabaseRouletteCoinPurchaseRepository(),
    getLivePixClient(),
  );
  return coinPurchaseService;
}
