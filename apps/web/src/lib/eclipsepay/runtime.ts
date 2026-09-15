import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IS_GWSTORE } from "@/lib/brand";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { EclipsePayClient } from "./client";
import { z } from "zod";

export const eclipseCheckoutSchema = z.object({
  order_id: z.uuid(),
  order_kind: z.enum(["items", "robux", "coins"]),
  amount_cents: z.coerce.number().int().positive(),
  checkout_token: z.string().regex(/^[a-f0-9]{64}$/),
  operation_id: z.uuid().nullable(),
});

export function eclipsePayEnabled() {
  return IS_GWSTORE && process.env.PAYMENT_PROVIDER === "eclipsepay";
}

export function eclipseDatabase(): SupabaseClient {
  const client = createAdminSupabaseClient();
  if (!client || !IS_GWSTORE) throw new Error("EclipsePay não disponível nesta loja.");
  // Additive migration; the generated legacy schema doesn't yet include these tables.
  return client as unknown as SupabaseClient;
}

export function getEclipsePayClient() {
  if (!IS_GWSTORE) throw new Error("EclipsePay não disponível nesta loja.");
  return new EclipsePayClient(process.env.ECLIPSEPAY_API_KEY ?? "");
}
