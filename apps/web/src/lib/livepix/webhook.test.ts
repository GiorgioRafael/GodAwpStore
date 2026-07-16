import { describe, expect, it } from "vitest";

import { parseLivePixPaymentWebhook } from "./webhook";

const encoder = new TextEncoder();

describe("parseLivePixPaymentWebhook", () => {
  it("aceita o evento oficial de pagamento e ignora extensões futuras", () => {
    expect(
      parseLivePixPaymentWebhook(
        encoder.encode(
          JSON.stringify({
            userId: "61021c7bdabe5e001225b65b",
            clientId: "11111111-1111-4111-8111-111111111111",
            event: "new",
            resource: {
              id: "61021c7bdabe5e001225b65c",
              reference: "61021c7bdabe5e001225b65d",
              type: "payment",
              futureField: true,
            },
            futureField: true,
          }),
        ),
      ),
    ).toEqual({
      userId: "61021c7bdabe5e001225b65b",
      clientId: "11111111-1111-4111-8111-111111111111",
      event: "new",
      resource: {
        id: "61021c7bdabe5e001225b65c",
        reference: "61021c7bdabe5e001225b65d",
        type: "payment",
      },
    });
  });

  it("rejeita eventos que não sejam pagamento novo", () => {
    expect(() =>
      parseLivePixPaymentWebhook(
        encoder.encode(
          JSON.stringify({
            userId: "user",
            clientId: "11111111-1111-4111-8111-111111111111",
            event: "cancelled",
            resource: { id: "id", reference: "reference", type: "subscription" },
          }),
        ),
      ),
    ).toThrow("dados inválidos");
  });

  it("aceita clientId ObjectId conforme o OpenAPI oficial", () => {
    expect(
      parseLivePixPaymentWebhook(
        encoder.encode(
          JSON.stringify({
            userId: "61021c7bdabe5e001225b65b",
            clientId: "61021c7bdabe5e001225b65c",
            event: "new",
            resource: {
              id: "61021c7bdabe5e001225b65d",
              reference: "61021c7bdabe5e001225b65e",
              type: "payment",
            },
          }),
        ),
      ).clientId,
    ).toBe("61021c7bdabe5e001225b65c");
  });

  it("rejeita JSON inválido", () => {
    expect(() => parseLivePixPaymentWebhook(encoder.encode("{"))).toThrow("JSON inválido");
  });
});
