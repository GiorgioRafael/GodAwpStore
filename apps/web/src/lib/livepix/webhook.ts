import { z } from "zod";

const objectId = z.string().trim().regex(/^[0-9a-f]{24}$/i);
// The current OpenAPI marks clientId as an ObjectId, while application
// credentials issued by the dashboard are UUIDs. Accept both documented/live
// shapes, then compare the value exactly with LIVEPIX_CLIENT_ID in the route.
const clientIdentifier = z.string().trim().refine(
  (value) =>
    /^[0-9a-f]{24}$/i.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
);

const livePixWebhookSchema = z.object({
  userId: objectId,
  clientId: clientIdentifier,
  event: z.literal("new"),
  resource: z.object({
    id: objectId,
    reference: objectId,
    type: z.literal("payment"),
  }),
});

export type LivePixPaymentWebhook = z.infer<typeof livePixWebhookSchema>;

export function parseLivePixPaymentWebhook(body: Uint8Array): LivePixPaymentWebhook {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new Error("Webhook LivePix contém JSON inválido.");
  }

  const result = livePixWebhookSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Webhook LivePix contém dados inválidos.");
  }
  return result.data;
}
