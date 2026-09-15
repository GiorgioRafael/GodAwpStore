import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const brand = vi.hoisted(() => ({ IS_GWSTORE: true }));
vi.mock("@/lib/brand", () => brand);
import { currentPaymentCopy, paymentProviderLabel } from "./label";

beforeEach(() => { brand.IS_GWSTORE = true; vi.stubEnv("PAYMENT_PROVIDER", "eclipsepay"); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("hybrid payment copy", () => {
  it("informa os dois provedores sem duplicar ao atualizar mensagens", () => {
    expect(paymentProviderLabel()).toBe("LivePix ou EclipsePay");
    for (const old of ["Pagamento via LivePix", "Pagamento via EclipsePay", "Pagamento via LivePix ou EclipsePay"]) {
      const updated = currentPaymentCopy(old);
      expect(updated).toBe("Pagamento via LivePix ou EclipsePay");
      expect(currentPaymentCopy(updated)).toBe(updated);
    }
  });
  it("não muda os textos da THStore", () => {
    brand.IS_GWSTORE = false;
    expect(paymentProviderLabel()).toBe("LivePix");
    expect(currentPaymentCopy("Pagamento via LivePix")).toBe("Pagamento via LivePix");
  });
  it("mantém LivePix quando a integração está desabilitada", () => {
    vi.stubEnv("PAYMENT_PROVIDER", "livepix");
    expect(paymentProviderLabel()).toBe("LivePix");
  });
});
