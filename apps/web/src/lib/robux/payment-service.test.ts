import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { robuxPaymentReturnUrl } from "./payment-service";

describe("Robux payment return URL", () => {
  it("always returns paid Robux buyers to the GWStore payment page", () => {
    expect(robuxPaymentReturnUrl("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "https://gwstore.vercel.app/pagamento/550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("refuses malformed order identifiers", () => {
    expect(() => robuxPaymentReturnUrl("not-an-order")).toThrow("ID de pedido de Robux inválido.");
  });
});
