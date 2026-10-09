import { z } from "zod";
import { completeShopDelivery } from "@/lib/shop/chat";
import { readShopJson } from "@/lib/shop/http";
import { requireShopActor, requireShopRequest } from "@/lib/shop/request";
import { ShopError, shopErrorResponse, shopJson } from "@/lib/shop/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    requireShopRequest(request, true);
    const actor = await requireShopActor(true);
    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) throw new ShopError("not_found");
    if (!z.object({}).strict().safeParse(await readShopJson(request, 1024)).success) throw new ShopError("invalid_request");
    return shopJson({ ok: true, ...await completeShopDelivery(orderId.toLowerCase(), actor) });
  } catch (error) { return shopErrorResponse(error); }
}
