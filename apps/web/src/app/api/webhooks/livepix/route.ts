import { readLimitedBody, RequestBodyTooLargeError } from "@/lib/http/limited-body";
import { parseLivePixPaymentWebhook } from "@/lib/livepix/webhook";
import { fulfillVerifiedPayment } from "@/lib/payments/fulfillment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAXIMUM_WEBHOOK_BYTES = 16 * 1024;

export async function POST(request: Request) {
  let event;
  try {
    const body = await readLimitedBody(request, MAXIMUM_WEBHOOK_BYTES);
    event = parseLivePixPaymentWebhook(body);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Payload muito grande." }, { status: 413 });
    }
    return Response.json({ error: "Webhook inválido." }, { status: 400 });
  }

  const configuredClientId = process.env.LIVEPIX_CLIENT_ID?.trim();
  if (!configuredClientId || event.clientId !== configuredClientId) {
    return Response.json({ error: "Cliente LivePix inválido." }, { status: 401 });
  }

  return fulfillVerifiedPayment({ providerPaymentId: event.resource.id, providerReference: event.resource.reference });
}
