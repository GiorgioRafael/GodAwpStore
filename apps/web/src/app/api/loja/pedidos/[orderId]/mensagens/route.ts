import { z } from "zod";
import { readShopMessages, sendShopMessage } from "@/lib/shop/chat";
import { readShopJson } from "@/lib/shop/http";
import { requireShopActor, requireShopRequest } from "@/lib/shop/request";
import { ShopError, shopErrorResponse, shopJson } from "@/lib/shop/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ orderId: string }> };
async function orderId(context: Context) {
  const params = await context.params;
  if (!z.uuid().safeParse(params.orderId).success) throw new ShopError("not_found");
  return params.orderId.toLowerCase();
}
export async function GET(request: Request, context: Context) {
  try {
    requireShopRequest(request);
    const actor = await requireShopActor();
    return shopJson({ ok: true, ...await readShopMessages(await orderId(context), actor) });
  } catch (error) { return shopErrorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    requireShopRequest(request, true);
    const actor = await requireShopActor();
    return shopJson({ ok: true, message: await sendShopMessage(await orderId(context), await readShopJson(request), actor) });
  } catch (error) { return shopErrorResponse(error); }
}
