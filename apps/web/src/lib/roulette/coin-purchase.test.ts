import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  RouletteCoinPurchaseService,
  type RouletteCoinPurchaseRepository,
} from "./coin-purchase";

const purchaseId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const payment = {
  id: "61021c7bdabe5e001225b65c",
  proof: "61021c7bdabe5e001225b65e",
  reference: "61021c7bdabe5e001225b65d",
  amountCents: 300,
  currency: "BRL",
  createdAt: "2026-07-27T12:00:00.000Z",
};

function repository(
  overrides: Partial<RouletteCoinPurchaseRepository> = {},
): RouletteCoinPurchaseRepository {
  return {
    findCheckoutByReference: vi.fn(async () => ({
      purchaseId,
      providerReference: payment.reference,
      checkoutUrl: "https://checkout.livepix.gg/abc",
    })),
    findCheckoutByPurchase: vi.fn(async () => ({
      purchaseId,
      providerReference: payment.reference,
      checkoutUrl: "https://checkout.livepix.gg/abc",
    })),
    claimCheckout: vi.fn(async () => ({ claimed: true, amountCents: 300, checkout: null })),
    registerCheckout: vi.fn(async (input) => ({
      purchaseId: input.purchaseId,
      providerReference: input.providerReference,
      checkoutUrl: input.checkoutUrl,
    })),
    releaseCheckoutClaim: vi.fn(async () => undefined),
    claimProviderCheck: vi.fn(async () => true),
    creditPurchase: vi.fn(async () => ({
      purchaseId,
      status: "credited" as const,
      creditedAmountCents: 300,
      coinBalanceCents: 300,
      firstConfirmation: true,
    })),
    ...overrides,
  };
}

function client() {
  return {
    createPayment: vi.fn(async () => ({
      reference: payment.reference,
      checkoutUrl: "https://checkout.livepix.gg/abc",
    })),
    getPaymentByReference: vi.fn(async () => payment),
  };
}

describe("RouletteCoinPurchaseService", () => {
  it("cobra o valor das moedas e volta para a roleta", async () => {
    const paymentClient = client();
    const service = new RouletteCoinPurchaseService(repository(), paymentClient);

    await expect(
      service.createCheckout(purchaseId, "https://gwstore.vercel.app/roleta"),
    ).resolves.toEqual({
      purchaseId,
      providerReference: payment.reference,
      checkoutUrl: "https://checkout.livepix.gg/abc",
    });
    expect(paymentClient.createPayment).toHaveBeenCalledWith({
      amountCents: 300,
      redirectUrl: `https://gwstore.vercel.app/roleta?compra=${purchaseId}`,
    });
  });

  it("reaproveita o checkout já registrado sem chamar a LivePix", async () => {
    const existing = {
      purchaseId,
      providerReference: payment.reference,
      checkoutUrl: "https://checkout.livepix.gg/abc",
    };
    const paymentClient = client();
    const service = new RouletteCoinPurchaseService(
      repository({
        claimCheckout: vi.fn(async () => ({
          claimed: false,
          amountCents: 300,
          checkout: existing,
        })),
      }),
      paymentClient,
    );

    await expect(
      service.createCheckout(purchaseId, "https://gwstore.vercel.app"),
    ).resolves.toEqual(existing);
    expect(paymentClient.createPayment).not.toHaveBeenCalled();
  });

  it("libera a reserva quando a LivePix recusa a cobrança", async () => {
    const releaseCheckoutClaim = vi.fn(async () => undefined);
    const paymentClient = client();
    paymentClient.createPayment.mockRejectedValue(
      new Error("A LivePix recusou criar a cobrança (HTTP 502)."),
    );
    const service = new RouletteCoinPurchaseService(
      repository({ releaseCheckoutClaim }),
      paymentClient,
    );

    await expect(
      service.createCheckout(purchaseId, "https://gwstore.vercel.app"),
    ).rejects.toThrow("A LivePix recusou criar a cobrança (HTTP 502).");
    expect(releaseCheckoutClaim).toHaveBeenCalledTimes(1);
  });

  it("ignora a referência que não pertence a nenhuma compra", async () => {
    const service = new RouletteCoinPurchaseService(
      repository({ findCheckoutByReference: vi.fn(async () => null) }),
      client(),
    );

    await expect(
      service.reconcilePayment({
        providerPaymentId: payment.id,
        providerReference: payment.reference,
      }),
    ).resolves.toBeNull();
  });

  it("credita as moedas com o hash de reconciliação", async () => {
    const creditPurchase = vi.fn(async () => ({
      purchaseId,
      status: "credited" as const,
      creditedAmountCents: 300,
      coinBalanceCents: 300,
      firstConfirmation: true,
    }));
    const service = new RouletteCoinPurchaseService(repository({ creditPurchase }), client());

    await expect(
      service.reconcilePayment({
        providerPaymentId: payment.id,
        providerReference: payment.reference,
      }),
    ).resolves.toEqual({
      purchaseId,
      status: "credited",
      creditedAmountCents: 300,
      coinBalanceCents: 300,
      firstConfirmation: true,
    });
    expect(creditPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: payment.id,
        providerReference: payment.reference,
        amountCents: 300,
        reconciliationSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("recusa o pagamento que não corresponde ao checkout registrado", async () => {
    const service = new RouletteCoinPurchaseService(repository(), client());

    await expect(
      service.reconcilePayment({
        providerPaymentId: "61021c7bdabe5e001225b999",
        providerReference: payment.reference,
      }),
    ).rejects.toThrow("O pagamento LivePix não corresponde à compra registrada.");
  });

  it("respeita o limite de consultas diretas à LivePix", async () => {
    const paymentClient = client();
    const service = new RouletteCoinPurchaseService(
      repository({ claimProviderCheck: vi.fn(async () => false) }),
      paymentClient,
    );

    await expect(service.pullPendingPayment(purchaseId)).resolves.toBeNull();
    expect(paymentClient.getPaymentByReference).not.toHaveBeenCalled();
  });

  it("credita pelo polling quando o webhook atrasa", async () => {
    const service = new RouletteCoinPurchaseService(repository(), client());

    await expect(service.pullPendingPayment(purchaseId)).resolves.toMatchObject({
      purchaseId,
      status: "credited",
      coinBalanceCents: 300,
    });
  });

  it("segue aguardando quando a LivePix ainda não tem o pagamento", async () => {
    const paymentClient = client();
    paymentClient.getPaymentByReference.mockRejectedValue(
      new Error("A LivePix não retornou um pagamento único para a referência."),
    );
    const service = new RouletteCoinPurchaseService(repository(), paymentClient);

    await expect(service.pullPendingPayment(purchaseId)).resolves.toBeNull();
  });
});
