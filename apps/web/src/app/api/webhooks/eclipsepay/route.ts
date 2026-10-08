import { IS_GWSTORE } from "@/lib/brand";
import { readLimitedBody, RequestBodyTooLargeError } from "@/lib/http/limited-body";
import { ECLIPSE_WEBHOOK_MAX_BYTES, verifyEclipseWebhook } from "@/lib/eclipsepay/webhook";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { eclipseDatabase } from "@/lib/eclipsepay/runtime";
import { reconcileEclipsePayments } from "@/lib/eclipsepay/reconciliation";
import { reconcileEclipsePaymentLinks } from "@/lib/eclipsepay/payment-link-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Persist before acknowledging; Discord work runs after the response. */
export async function POST(request: Request) {
  if (!IS_GWSTORE) return new Response(null, { status: 404 });
  const secret = process.env.ECLIPSEPAY_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook não configurado." }, { status: 503 });

  let event;
  let digest: string;
  try {
    const raw = await readLimitedBody(request, ECLIPSE_WEBHOOK_MAX_BYTES);
    event = verifyEclipseWebhook(secret, request.headers, raw);
    digest = createHash("sha256").update(raw).digest("hex");
  } catch (error) {
    return Response.json({ error: "Webhook inválido." }, {
      status: error instanceof RequestBodyTooLargeError ? 413 : 401,
    });
  }
  if (event.type === "webhook.endpoint_verification") {
    console.info("[eclipsepay:webhook] endpoint_verification validada");
    return Response.json({ challenge: event.data.challenge });
  }
  if (event.type === "webhook.test") return Response.json({ received: true });

  try {
    const db = eclipseDatabase();
    const { error } = await db.from("eclipsepay_webhook_inbox").upsert({
      event_id: event.id, operation_id: event.data.operationId, event_type: event.type,
      resource_version: event.resourceVersion, amount_cents: event.data.amountCents, body_sha256: digest,
    }, { onConflict: "event_id", ignoreDuplicates: true });
    if (error) throw new Error("Event persistence failed");
    const { data: existing, error: readError } = await db.from("eclipsepay_webhook_inbox")
      .select("body_sha256").eq("event_id", event.id).single();
    if (readError || existing?.body_sha256 !== digest) throw new Error("Event identity conflict");
    const { error: wakeError } = await db.from("eclipsepay_checkouts").update({ next_check_at: new Date().toISOString() })
      .eq("operation_id", event.data.operationId);
    if (wakeError) throw new Error("Queue wake failed");
    const { error: linkWakeError } = await db.from("eclipsepay_payment_links")
      .update({ next_check_at: new Date().toISOString() })
      .eq("operation_id", event.data.operationId);
    if (linkWakeError) throw new Error("Payment link queue wake failed");
    after(async () => {
      const results = await Promise.allSettled([reconcileEclipsePayments(), reconcileEclipsePaymentLinks()]);
      if (results.some((result) => result.status === "rejected")) {
        console.error("[eclipsepay] Reconciliação pendente no cron.");
      }
    });
    return Response.json({ received: true });
  } catch {
    return Response.json({ error: "Notificação será repetida." }, { status: 503, headers: { "Retry-After": "60" } });
  }
}
