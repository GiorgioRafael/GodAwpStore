import "server-only";

import { getLivePixClient } from "./client";
import { LivePixPaymentService } from "./payment-service";
import { SupabaseLivePixPaymentRepository } from "./supabase-repository";

let paymentService: LivePixPaymentService | undefined;

export function getLivePixPaymentService() {
  paymentService ??= new LivePixPaymentService(
    new SupabaseLivePixPaymentRepository(),
    getLivePixClient(),
  );
  return paymentService;
}
