import { readLimitedBody, RequestBodyTooLargeError } from "@/lib/http/limited-body";
import { createShopCheckout } from "@/lib/shop/checkout";
import { requireShopActor, requireShopRequest } from "@/lib/shop/request";
import { ShopError, shopErrorResponse, shopJson } from "@/lib/shop/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MAX_BODY_BYTES = 8_192;

export async function POST(request: Request) {
  try {
    requireShopRequest(request, true);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ShopError("invalid_request");
    const identity = await requireShopActor();
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBody(request, MAX_BODY_BYTES))); }
    catch (error) {
      if (error instanceof RequestBodyTooLargeError) return shopJson({ ok: false, error: { code: "invalid_request", message: "Carrinho muito grande." } }, 413);
      throw new ShopError("invalid_request");
    }
    return shopJson({ ok: true, ...await createShopCheckout(body, identity) });
  } catch (error) { return shopErrorResponse(error); }
}
