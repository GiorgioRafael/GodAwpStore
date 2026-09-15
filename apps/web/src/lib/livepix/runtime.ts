import "server-only";

import { getPaymentClient as getLivePixClient } from "@/lib/payments/client";
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
