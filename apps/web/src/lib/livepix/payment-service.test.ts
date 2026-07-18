import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LivePixPaymentService, type LivePixPaymentRepository } from "./payment-service";

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
    })),
    claimCheckout: vi.fn(async () => ({ claimed: true, checkout: null })),
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

  it("não reutiliza checkout depois do prazo de duas horas", async () => {
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
