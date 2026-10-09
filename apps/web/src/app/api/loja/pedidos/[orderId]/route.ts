import { z } from "zod";
import { readShopOrder } from "@/lib/shop/repository";
import { requireShopActor, requireShopRequest } from "@/lib/shop/request";
import { ShopError, shopErrorResponse, shopJson } from "@/lib/shop/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    requireShopRequest(request);
    const identity = await requireShopActor();
    const { orderId } = await context.params;
    if (!z.uuid().safeParse(orderId).success) throw new ShopError("not_found");
    return shopJson({ ok: true, ...await readShopOrder(orderId.toLowerCase(), identity) });
  } catch (error) { return shopErrorResponse(error); }
}
