import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  RouletteSpinPaymentService,
  type RouletteSpinPaymentRepository,
} from "./spin-payment";

const chargeId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const payment = {
  id: "61021c7bdabe5e001225b65c",
  proof: "61021c7bdabe5e001225b65e",
  reference: "61021c7bdabe5e001225b65d",
  amountCents: 100,
  currency: "BRL",
  createdAt: "2026-07-26T12:00:00.000Z",
};

function repository(
  overrides: Partial<RouletteSpinPaymentRepository> = {},
): RouletteSpinPaymentRepository {
  return {
    findCheckoutByReference: vi.fn(async () => ({
      chargeId,
      providerReference: payment.reference,
      checkoutUrl: "https://checkout.livepix.gg/abc",
    })),
    findCheckoutByCharge: vi.fn(async () => ({
      chargeId,
      providerReference: payment.reference,
      checkoutUrl: "https://checkout.livepix.gg/abc",
    })),
    claimCheckout: vi.fn(async () => ({ claimed: true, amountCents: 100, checkout: null })),
    registerCheckout: vi.fn(async (input) => ({
      chargeId: input.chargeId,
      providerReference: input.providerReference,
      checkoutUrl: input.checkoutUrl,
    })),
    releaseCheckoutClaim: vi.fn(async () => undefined),
    claimProviderCheck: vi.fn(async () => true),
    confirmPayment: vi.fn(async () => ({
      chargeId,
      status: "paid" as const,
      paidAmountCents: 100,
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

describe("RouletteSpinPaymentService", () => {
  it("cria a cobrança de R$ 1,00 com retorno para a roleta", async () => {
    const paymentClient = client();
    const service = new RouletteSpinPaymentService(repository(), paymentClient);

    await expect(
      service.createCheckout(chargeId, "https://gwstore.vercel.app/roleta"),
    ).resolves.toEqual({
      chargeId,
      providerReference: payment.reference,
      checkoutUrl: "https://checkout.livepix.gg/abc",
    });
    expect(paymentClient.createPayment).toHaveBeenCalledWith({
      amountCents: 100,
      redirectUrl: `https://gwstore.vercel.app/roleta?giro=${chargeId}`,
    });
  });

  it("reaproveita o checkout já registrado sem chamar a LivePix", async () => {
    const existing = {
      chargeId,
      providerReference: payment.reference,
      checkoutUrl: "https://checkout.livepix.gg/abc",
    };
    const paymentClient = client();
    const service = new RouletteSpinPaymentService(
      repository({
        claimCheckout: vi.fn(async () => ({
          claimed: false,
          amountCents: 100,
          checkout: existing,
        })),
      }),
      paymentClient,
    );

    await expect(
      service.createCheckout(chargeId, "https://gwstore.vercel.app"),
    ).resolves.toEqual(existing);
    expect(paymentClient.createPayment).not.toHaveBeenCalled();
  });

  it("libera a reserva quando a LivePix recusa a cobrança", async () => {
    const releaseCheckoutClaim = vi.fn(async () => undefined);
    const paymentClient = client();
    paymentClient.createPayment.mockRejectedValue(
      new Error("A LivePix recusou criar a cobrança (HTTP 502)."),
    );
    const service = new RouletteSpinPaymentService(
      repository({ releaseCheckoutClaim }),
      paymentClient,
    );

    await expect(
      service.createCheckout(chargeId, "https://gwstore.vercel.app"),
    ).rejects.toThrow("A LivePix recusou criar a cobrança (HTTP 502).");
    expect(releaseCheckoutClaim).toHaveBeenCalledTimes(1);
  });

  it("ignora a referência que não pertence a nenhum giro", async () => {
    const service = new RouletteSpinPaymentService(
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

  it("confirma o giro pago com o hash de reconciliação", async () => {
    const confirmPayment = vi.fn(async () => ({
      chargeId,
      status: "paid" as const,
      paidAmountCents: 100,
      firstConfirmation: true,
    }));
    const service = new RouletteSpinPaymentService(
      repository({ confirmPayment }),
      client(),
    );

    await expect(
      service.reconcilePayment({
        providerPaymentId: payment.id,
        providerReference: payment.reference,
      }),
    ).resolves.toEqual({
      chargeId,
      status: "paid",
      paidAmountCents: 100,
      firstConfirmation: true,
    });
    expect(confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: payment.id,
        providerReference: payment.reference,
        amountCents: 100,
        reconciliationSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("recusa o pagamento que não corresponde ao checkout registrado", async () => {
    const service = new RouletteSpinPaymentService(repository(), client());

    await expect(
      service.reconcilePayment({
        providerPaymentId: "61021c7bdabe5e001225b999",
        providerReference: payment.reference,
      }),
    ).rejects.toThrow("O pagamento LivePix não corresponde ao giro registrado.");
  });

  it("respeita o limite de consultas diretas à LivePix", async () => {
    const paymentClient = client();
    const service = new RouletteSpinPaymentService(
      repository({ claimProviderCheck: vi.fn(async () => false) }),
      paymentClient,
    );

    await expect(service.pullPendingPayment(chargeId)).resolves.toBeNull();
    expect(paymentClient.getPaymentByReference).not.toHaveBeenCalled();
  });

  it("confirma pelo polling quando o webhook atrasa", async () => {
    const service = new RouletteSpinPaymentService(repository(), client());

    await expect(service.pullPendingPayment(chargeId)).resolves.toMatchObject({
      chargeId,
      status: "paid",
    });
  });

  it("segue aguardando quando a LivePix ainda não tem o pagamento", async () => {
    const paymentClient = client();
    paymentClient.getPaymentByReference.mockRejectedValue(
      new Error("A LivePix não retornou um pagamento único para a referência."),
    );
    const service = new RouletteSpinPaymentService(repository(), paymentClient);

    await expect(service.pullPendingPayment(chargeId)).resolves.toBeNull();
  });
});
