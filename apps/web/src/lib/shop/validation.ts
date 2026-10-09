import { z } from "zod";
import { MAXIMUM_CART_ITEMS } from "@/lib/bot/types";
import { MAXIMUM_ORDER_QUANTITY } from "@/lib/livepix/limits";

export const shopCheckoutSchema = z.object({
  requestId: z.uuid().transform(value => value.toLowerCase()),
  items: z.array(z.object({
    productId: z.uuid().transform(value => value.toLowerCase()),
    quantity: z.number().int().min(1).max(MAXIMUM_ORDER_QUANTITY),
  }).strict()).min(1).max(MAXIMUM_CART_ITEMS),
  gameNickname: z.string().trim().regex(/^[A-Za-z0-9_]{3,20}$/),
  serviceRequirementsConfirmed: z.boolean().optional(),
}).strict().refine(value => new Set(value.items.map(item => item.productId)).size === value.items.length);
