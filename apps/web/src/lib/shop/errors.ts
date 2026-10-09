import type { ShopErrorCode } from "./types";

const ERRORS: Record<ShopErrorCode, { status: number; message: string }> = {
  unavailable: { status: 503, message: "A loja está temporariamente indisponível. Tente novamente." },
  invalid_request: { status: 422, message: "Confira os produtos, as quantidades e seu nick do Roblox." },
  unauthenticated: { status: 401, message: "Entre com o Discord para continuar sua compra." },
  forbidden: { status: 403, message: "Abra a loja novamente para continuar." },
  product_unavailable: { status: 409, message: "Um produto foi pausado ou ficou indisponível. Atualize seu carrinho." },
  out_of_stock: { status: 409, message: "Não há estoque suficiente. Atualize seu carrinho." },
  total_below_minimum: { status: 422, message: "O valor final da compra deve ser de pelo menos R$ 1,00." },
  requirements_required: { status: 422, message: "Confira e confirme os requisitos dos serviços de UP antes de continuar." },
  request_conflict: { status: 409, message: "Este checkout pertence a outra seleção. Atualize seu carrinho para criar um novo pedido." },
  rate_limited: { status: 429, message: "Você tentou várias vezes seguidas. Aguarde um minuto e tente novamente." },
  not_found: { status: 404, message: "Pedido não encontrado." },
  checkout_pending: { status: 503, message: "Seu pedido foi salvo, mas o Pix ainda está sendo preparado. Tente novamente com o mesmo carrinho; não pague duas vezes." },
  delivery_not_allowed: { status: 409, message: "Este pedido ainda não está pronto para ser marcado como entregue." },
};

export class ShopError extends Error {
  readonly status: number;
  constructor(readonly code: ShopErrorCode) {
    super(ERRORS[code].message);
    this.name = "ShopError";
    this.status = ERRORS[code].status;
  }
}

export function shopErrorResponse(error: unknown) {
  const safe = error instanceof ShopError ? error : new ShopError("unavailable");
  return Response.json({ ok: false, error: { code: safe.code, message: safe.message } }, {
    status: safe.status, headers: { "Cache-Control": "no-store" },
  });
}

export function shopJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
