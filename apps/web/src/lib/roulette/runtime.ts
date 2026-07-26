import "server-only";

import { getLivePixClient } from "@/lib/livepix/client";

import { SupabaseRouletteSpinPaymentRepository } from "./spin-payment-repository";
import { RouletteSpinPaymentService } from "./spin-payment";

let spinPaymentService: RouletteSpinPaymentService | undefined;

export function getRouletteSpinPaymentService() {
  spinPaymentService ??= new RouletteSpinPaymentService(
    new SupabaseRouletteSpinPaymentRepository(),
    getLivePixClient(),
  );
  return spinPaymentService;
}
