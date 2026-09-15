import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const ECLIPSE_WEBHOOK_MAX_BYTES = 65_536;
const base = {
  id: z.uuid(),
  apiVersion: z.literal("v1"),
  createdAt: z.iso.datetime({ offset: true }),
};
const chargeEvent = z.object({
  ...base,
  type: z.enum(["charge.created", "charge.paid", "charge.failed", "charge.refunded"]),
  resourceVersion: z.number().int().nonnegative(),
  data: z.object({
    operationId: z.uuid(),
    kind: z.literal("deposit"),
    status: z.enum(["pending", "completed", "failed", "refunded"]),
    amountCents: z.number().int().positive(),
    currency: z.literal("BRL"),
  }),
});
const eventSchema = z.union([
  z.object({
    ...base,
    type: z.literal("webhook.endpoint_verification"),
    resourceVersion: z.null(),
    data: z.object({ challenge: z.string().min(1).max(4096) }),
  }),
  z.object({
    ...base,
    type: z.literal("webhook.test"),
    resourceVersion: z.null(),
    data: z.object({ test: z.literal(true) }),
  }),
  chargeEvent,
]);
export type EclipseWebhookEvent = z.infer<typeof eventSchema>;
export type EclipseChargeEvent = z.infer<typeof chargeEvent>;

export function verifyEclipseWebhook(
  secret: string,
  headers: Headers,
  body: Uint8Array,
  now = Date.now(),
): EclipseWebhookEvent {
  const id = headers.get("x-eclipse-event-id");
  const timestamp = headers.get("x-eclipse-timestamp");
  const signature = headers.get("x-eclipse-signature");
  if (!secret || body.byteLength > ECLIPSE_WEBHOOK_MAX_BYTES || !z.uuid().safeParse(id).success
    || !timestamp || !/^\d{10,11}$/.test(timestamp)
    || Math.abs(now / 1000 - Number(timestamp)) > 300
    || !signature || !/^v1=[0-9a-f]{64}$/.test(signature)) {
    throw new Error("Webhook EclipsePay inválido.");
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${id}.`).update(body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex"))) {
    throw new Error("Assinatura EclipsePay inválida.");
  }
  // Parse only AFTER validating the untouched body bytes.
  const event = eventSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
  if (event.id !== id) throw new Error("Identificador de evento EclipsePay divergente.");
  if (event.type.startsWith("charge.")) {
    const charge = event as EclipseChargeEvent;
    const statuses = { "charge.created": "pending", "charge.paid": "completed", "charge.failed": "failed", "charge.refunded": "refunded" };
    if (charge.data.status !== statuses[charge.type]) throw new Error("Estado de evento EclipsePay divergente.");
  }
  return event;
}
