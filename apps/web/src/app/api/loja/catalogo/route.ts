import { loadShopCatalog } from "@/lib/shop/catalog";
import { requireShopRequest } from "@/lib/shop/request";
import { shopErrorResponse, shopJson } from "@/lib/shop/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireShopRequest(request);
    return shopJson({ ok: true, catalog: await loadShopCatalog() });
  } catch (error) { return shopErrorResponse(error); }
}
