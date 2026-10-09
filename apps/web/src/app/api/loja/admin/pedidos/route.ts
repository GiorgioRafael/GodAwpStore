import { listShopOrders } from "@/lib/shop/orders";
import { requireShopActor, requireShopRequest } from "@/lib/shop/request";
import { shopErrorResponse, shopJson } from "@/lib/shop/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    requireShopRequest(request);
    return shopJson({ ok: true, orders: await listShopOrders(await requireShopActor(true), true) });
  } catch (error) { return shopErrorResponse(error); }
}
