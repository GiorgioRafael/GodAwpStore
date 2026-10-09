import { readLimitedBody, RequestBodyTooLargeError } from "@/lib/http/limited-body";
import { ShopError } from "./errors";
export async function readShopJson(request: Request, limit = 8192): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ShopError("invalid_request");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBody(request, limit))); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw new ShopError("invalid_request");
    throw new ShopError("invalid_request");
  }
}
