import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const brand = vi.hoisted(() => ({ isGwStore: true }));
vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return brand.isGwStore; }, STORE_NAME: "GWStore" }));

import { LivePixPaymentService, type LivePixPaymentRepository, type PaymentCreationOptions } from "./payment-service";

const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";

function repository(overrides: Partial<LivePixPaymentRepository> = {}): LivePixPaymentRepository {
  return {
    findCheckoutByOrder: vi.fn(async () => null),
    findCheckoutByReference: vi.fn(async () => ({
      orderId,
      providerReference: "provider-ref",
      checkoutUrl: "https://checkout.livepix.gg/provider-ref",
    })),
    findPayableOrder: vi.fn(async () => ({
      id: orderId,
      status: "awaiting_payment",
      amountCents: 500,
      currency: "BRL",
      paymentExpiresAt: "2099-07-16T15:00:00.000Z",
      paymentReference: "discord:123456789012345678",
    })),
    claimCheckout: vi.fn(async () => ({ claimed: true, checkout: null })),
    preserveCheckoutClaim: vi.fn(async () => undefined),
    registerCheckout: vi.fn(async (input) => ({
      orderId: input.orderId,
      providerReference: input.providerReference,
      checkoutUrl: input.checkoutUrl,
    })),
    releaseCheckoutClaim: vi.fn(async () => undefined),
    confirmPayment: vi.fn(async () => ({
      orderId,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
      productName: "Unicórnio",
      paidAmountCents: 500,
      orderStatus: "paid",
      firstConfirmation: true,
      ticketChannelId: null,
      ticketStatus: "pending",
    })),
    claimTicket: vi.fn(async () => ({
      orderId,
      claimed: true,
      discordGuildId: "123456789012345678",
      buyerDiscordId: "223456789012345678",
      productName: "Unicórnio",
      quantity: 2,
      paidAmountCents: 500,
      ticketStatus: "creating",
      existingChannelId: null,
    })),
    completeTicket: vi.fn(async () => undefined),
    failTicket: vi.fn(async () => undefined),
    ...overrides,
  };
}

function client() {
  return {
    createPayment: vi.fn(async () => ({
      reference: "provider-ref",
      checkoutUrl: "https://checkout.livepix.gg/provider-ref",
    })),
    getPaymentByReference: vi.fn(async () => ({
      id: "provider-payment-id",
      proof: "pix-proof",
      reference: "provider-ref",
      amountCents: 500,
      currency: "BRL",
      createdAt: "2026-07-16T12:00:00-03:00",
    })),
  };
}

describe("LivePixPaymentService", () => {
  beforeEach(() => { brand.isGwStore = true; });

  it("cria checkout com retorno exclusivo do pedido e o persiste", async () => {
    const repo = repository();
    const api = client();
    const service = new LivePixPaymentService(repo, api);

    await expect(service.createCheckout(orderId, "https://gwstore.vercel.app/foo")).resolves.toEqual({
      orderId,
      providerReference: "provider-ref",
      checkoutUrl: "https://checkout.livepix.gg/provider-ref",
    });
    expect(api.createPayment).toHaveBeenCalledWith({
      amountCents: 500,
      redirectUrl: `https://gwstore.vercel.app/pagamento/${orderId}`,
    });
  });

  it("retorna a compra web persistida ao pedido privado no site", async () => {
    const repo = repository();
    vi.mocked(repo.findPayableOrder).mockResolvedValueOnce({
      id: orderId, status: "awaiting_payment", amountCents: 500, currency: "BRL",
      paymentExpiresAt: "2099-07-16T15:00:00.000Z", paymentReference: `web:${crypto.randomUUID()}`,
    });
    const api = client();
    await new LivePixPaymentService(repo, api).createCheckout(orderId, "https://gwstoreofc.com");
    expect(api.createPayment).toHaveBeenCalledWith({ amountCents: 500,
      redirectUrl: `https://gwstoreofc.com/minhas-compras/${orderId}` },
    { beforeNonIdempotentCreate: expect.any(Function) });
  });

  it.each([null, "discord:123456789012345678"])("mantém retorno do bot quando a fonte persistida é %s", async paymentReference => {
    const repo = repository();
    vi.mocked(repo.findPayableOrder).mockResolvedValueOnce({
      id: orderId, status: "awaiting_payment", amountCents: 500, currency: "BRL",
      paymentExpiresAt: "2099-07-16T15:00:00.000Z", paymentReference,
    });
    const api = client();
    await new LivePixPaymentService(repo, api).createCheckout(orderId, "https://gwstoreofc.com");
    expect(api.createPayment).toHaveBeenCalledWith({ amountCents: 500,
      redirectUrl: `https://gwstoreofc.com/pagamento/${orderId}` });
  });

  it("preserva o retorno da THStore mesmo diante de uma referência web", async () => {
    brand.isGwStore = false;
    const repo = repository();
    vi.mocked(repo.findPayableOrder).mockResolvedValueOnce({
      id: orderId, status: "awaiting_payment", amountCents: 500, currency: "BRL",
      paymentExpiresAt: "2099-07-16T15:00:00.000Z", paymentReference: `web:${crypto.randomUUID()}`,
    });
    const api = client();
    await new LivePixPaymentService(repo, api).createCheckout(orderId, "https://thstore.vercel.app");
    expect(api.createPayment).toHaveBeenCalledWith({ amountCents: 500,
      redirectUrl: `https://thstore.vercel.app/pagamento/${orderId}` });
  });

  it("reutiliza checkout existente sem criar outra cobrança", async () => {
    const existing = {
      orderId,
      providerReference: "provider-ref",
      checkoutUrl: "https://checkout.livepix.gg/provider-ref",
    };
    const repo = repository({ findCheckoutByOrder: vi.fn(async () => existing) });
    const api = client();
    const service = new LivePixPaymentService(repo, api);

    await expect(service.createCheckout(orderId, "https://gwstore.vercel.app")).resolves.toEqual(existing);
    expect(api.createPayment).not.toHaveBeenCalled();
  });

  it("não reutiliza checkout depois do prazo de trinta minutos", async () => {
    const existing = {
      orderId,
      providerReference: "provider-ref",
      checkoutUrl: "https://checkout.livepix.gg/provider-ref",
    };
    const repo = repository({
      findCheckoutByOrder: vi.fn(async () => existing),
      findPayableOrder: vi.fn(async () => ({
        id: orderId,
        status: "awaiting_payment",
        amountCents: 500,
        currency: "BRL",
        paymentExpiresAt: "2026-07-16T15:00:00.000Z",
        paymentReference: "discord:123456789012345678",
      })),
    });
    const api = client();
    const service = new LivePixPaymentService(
      repo,
      api,
      () => Date.parse("2026-07-16T15:00:00.000Z"),
    );

    await expect(service.createCheckout(orderId, "https://gwstore.vercel.app")).rejects.toThrow(
      "não está disponível",
    );
    expect(repo.findCheckoutByOrder).not.toHaveBeenCalled();
    expect(api.createPayment).not.toHaveBeenCalled();
  });

  it("não cria cobrança concorrente quando outro processo possui a reserva", async () => {
    const repo = repository({
      claimCheckout: vi.fn(async () => ({ claimed: false, checkout: null })),
    });
    const api = client();
    const service = new LivePixPaymentService(repo, api);

    await expect(service.createCheckout(orderId, "https://gwstore.vercel.app")).rejects.toThrow(
      "já está sendo preparado",
    );
    expect(api.createPayment).not.toHaveBeenCalled();
  });

  it("não emite outro Pix web após resposta LivePix perdida, novo processo e lease de cinco minutos", async () => {
    let now = Date.parse("2026-10-15T12:00:00Z");
    const deadline = new Date(now + 30 * 60_000).toISOString();
    let claimedAt: number | null = null;
    const repo = repository({
      findPayableOrder: vi.fn(async () => ({ id: orderId, status: "awaiting_payment", amountCents: 500,
        currency: "BRL", paymentExpiresAt: deadline, paymentReference: `web:${orderId}` })),
      claimCheckout: vi.fn(async () => {
        if (claimedAt !== null && claimedAt > now - 5 * 60_000) return { claimed: false, checkout: null };
        claimedAt = now;
        return { claimed: true, checkout: null };
      }),
      preserveCheckoutClaim: vi.fn(async (_id, _token, until) => { claimedAt = Date.parse(until); }),
      releaseCheckoutClaim: vi.fn(async () => { claimedAt = null; }),
    });
    const api = { ...client(), createPayment: vi.fn(async (_input, options?: PaymentCreationOptions) => {
      await options?.beforeNonIdempotentCreate();
      // The provider issued a payment, but its HTTP response never reached us.
      throw new Error("response lost");
    }) };
    await expect(new LivePixPaymentService(repo, api, () => now).createCheckout(orderId, "https://gwstoreofc.com"))
      .rejects.toThrow("response lost");
    expect(repo.preserveCheckoutClaim).toHaveBeenCalledWith(orderId, expect.any(String), deadline);
    expect(repo.releaseCheckoutClaim).not.toHaveBeenCalled();
    now += 6 * 60_000;
    await expect(new LivePixPaymentService(repo, api, () => now).createCheckout(orderId, "https://gwstoreofc.com"))
      .rejects.toThrow("já está sendo preparado");
    expect(api.createPayment).toHaveBeenCalledTimes(1);
    now = Date.parse(deadline);
    await expect(new LivePixPaymentService(repo, api, () => now).createCheckout(orderId, "https://gwstoreofc.com"))
      .rejects.toThrow("não está disponível");
    expect(api.createPayment).toHaveBeenCalledTimes(1);
  });

  it("não libera a reserva web se a confirmação da proteção persistida for incerta", async () => {
    const repo = repository({
      findPayableOrder: vi.fn(async () => ({ id: orderId, status: "awaiting_payment", amountCents: 500,
        currency: "BRL", paymentExpiresAt: "2099-07-16T15:00:00Z", paymentReference: `web:${orderId}` })),
      preserveCheckoutClaim: vi.fn(async () => { throw new Error("database response lost"); }),
    });
    const provider = vi.fn();
    const api = { ...client(), createPayment: vi.fn(async (_input, options?: PaymentCreationOptions) => {
      await options?.beforeNonIdempotentCreate();
      return provider();
    }) };
    await expect(new LivePixPaymentService(repo, api).createCheckout(orderId, "https://gwstoreofc.com"))
      .rejects.toThrow("database response lost");
    expect(provider).not.toHaveBeenCalled();
    expect(repo.releaseCheckoutClaim).not.toHaveBeenCalled();
  });

  it("mantém a repetição segura de Eclipse web sem reter a reserva LivePix", async () => {
    const repo = repository({ findPayableOrder: vi.fn(async () => ({ id: orderId, status: "awaiting_payment",
      amountCents: 4000, currency: "BRL", paymentExpiresAt: "2099-07-16T15:00:00Z", paymentReference: `web:${orderId}` })) });
    const api = client();
    api.createPayment.mockRejectedValueOnce(new Error("Eclipse response lost"));
    const service = new LivePixPaymentService(repo, api);
    await expect(service.createCheckout(orderId, "https://gwstoreofc.com")).rejects.toThrow("Eclipse response lost");
    await expect(service.createCheckout(orderId, "https://gwstoreofc.com")).resolves.toMatchObject({ orderId });
    expect(repo.releaseCheckoutClaim).toHaveBeenCalledTimes(1);
    expect(repo.preserveCheckoutClaim).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserva a liberação do checkout legado (GW=%s)", async isGwStore => {
    brand.isGwStore = isGwStore;
    const repo = repository();
    const api = client();
    api.createPayment.mockRejectedValueOnce(new Error("legacy error"));
    await expect(new LivePixPaymentService(repo, api).createCheckout(orderId, "https://thstore.vercel.app"))
      .rejects.toThrow("legacy error");
    expect(repo.releaseCheckoutClaim).toHaveBeenCalledWith(orderId, expect.any(String));
    expect(repo.preserveCheckoutClaim).not.toHaveBeenCalled();
  });

  it("consulta a LivePix antes de confirmar e envia digest de reconciliação", async () => {
    const repo = repository();
    const api = client();
    const service = new LivePixPaymentService(repo, api);

    await expect(
      service.reconcilePayment({ providerPaymentId: "provider-payment-id", providerReference: "provider-ref" }),
    ).resolves.toMatchObject({ firstConfirmation: true, ticketStatus: "pending" });
    expect(repo.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: "provider-payment-id",
        providerProof: "pix-proof",
        providerReference: "provider-ref",
        amountCents: 500,
        currency: "BRL",
        reconciliationSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(api.getPaymentByReference).toHaveBeenCalledWith("provider-ref");
  });

  it("ignora webhook de referência que não pertence à loja", async () => {
    const repo = repository({ findCheckoutByReference: vi.fn(async () => null) });
    const api = client();
    const service = new LivePixPaymentService(repo, api);

    await expect(
      service.reconcilePayment({ providerPaymentId: "unknown", providerReference: "unknown" }),
    ).resolves.toBeNull();
    expect(api.getPaymentByReference).not.toHaveBeenCalled();
  });
});
