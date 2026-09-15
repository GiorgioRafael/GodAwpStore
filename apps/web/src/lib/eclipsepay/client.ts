import "server-only";

import { z } from "zod";

// Keep credentials on the documented origin, including on redirects.
const API_ORIGIN = "https://eclipsepaybr.com";
const uuid = z.uuid();
const chargeInput = z.object({
  amountCents: z.number().int().min(80).max(100_000),
  description: z.string().max(200).optional(),
  expectedFeeCents: z.number().int().nonnegative().optional(),
}).strict();
const operation = z.object({
  id: uuid,
  kind: z.literal("deposit"),
  status: z.enum(["pending", "completed", "failed", "refunded"]),
  amountCents: z.number().int().positive(),
  feeCents: z.number().int().nonnegative().nullable().optional(),
  netCents: z.number().int().nonnegative().nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  brCode: z.string().min(1).max(4096).optional(),
});

export type EclipseCharge = z.infer<typeof operation>;
export type EclipseChargeInput = z.infer<typeof chargeInput>;

export class EclipsePayError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null = null) {
    // Do not expose provider response bodies, bearer tokens or customer data.
    super(`EclipsePay indisponível (HTTP ${status}).`);
    this.name = "EclipsePayError";
  }
}

export class EclipsePayClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) throw new Error("Chave da EclipsePay não configurada.");
  }

  /** Persist this UUID with the order BEFORE calling; reuse it after any timeout. */
  async createCharge(idempotencyKey: string, input: EclipseChargeInput): Promise<EclipseCharge> {
    uuid.parse(idempotencyKey);
    const payload = chargeInput.safeParse(input);
    if (!payload.success) {
      throw new Error("A EclipsePay aceita cobranças de R$ 0,80 a R$ 1.000,00, sujeitas à tarifa da conta.");
    }
    const charge = await this.request("/v1/charges", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload.data),
    });
    if (charge.amountCents !== payload.data.amountCents) {
      throw new Error("Valor da cobrança EclipsePay divergente do pedido.");
    }
    return charge; // HTTP 200/202 is NOT proof of payment.
  }

  async getCharge(id: string): Promise<EclipseCharge> {
    uuid.parse(id);
    const charge = await this.request(`/v1/charges/${encodeURIComponent(id)}`, { method: "GET" });
    if (charge.id !== id) throw new Error("Identificador da cobrança EclipsePay divergente.");
    return charge;
  }

  private async request(path: string, init: RequestInit): Promise<EclipseCharge> {
    let response: Response;
    try {
      response = await this.fetcher(`${API_ORIGIN}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.apiKey.trim()}`, Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      // Outcome may be unknown. Never create a new idempotency key here.
      throw new Error("Não foi possível consultar a EclipsePay. Repita a mesma solicitação em instantes.");
    }
    if (response.status !== 200 && response.status !== 202) {
      throw new EclipsePayError(response.status, response.headers.get("retry-after"));
    }
    const parsed = operation.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new Error("Resposta inválida da EclipsePay.");
    return parsed.data;
  }
}
