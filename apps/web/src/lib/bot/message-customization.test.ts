import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  interpolateBotMessage,
  normalizeBotMessageCustomization,
} from "./message-customization";
import { botMessageCustomizationSchema } from "./message-customization-validation";

describe("personalização das mensagens do bot", () => {
  it("mantém os padrões quando a configuração está ausente ou parcial", () => {
    expect(normalizeBotMessageCustomization(null)).toEqual(
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
    );

    const normalized = normalizeBotMessageCustomization({
      version: 1,
      storefront: { title: "Minha loja" },
    });
    expect(normalized.storefront.title).toBe("Minha loja");
    expect(normalized.storefront.subtitle).toBe(
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION.storefront.subtitle,
    );
    expect(normalized.ticket).toEqual(DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket);
  });

  it("interpola apenas tokens entregues e mantém desconhecidos literais", () => {
    expect(
      interpolateBotMessage("{product_name} custa {price}; {unknown}", {
        product_name: "Ghost Pepper",
        price: "R$ 1,00",
      }),
    ).toBe("Ghost Pepper custa R$ 1,00; {unknown}");
  });

  it("aceita os padrões completos e remove caracteres de controle", () => {
    const parsed = botMessageCustomizationSchema.safeParse({
      ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      storefront: {
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.storefront,
        welcome: "Olá\u0000 mundo",
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.storefront.welcome).toBe("Olá mundo");
  });

  it("rejeita campos extras, tokens desconhecidos e limites do Discord", () => {
    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        injected: true,
      }).success,
    ).toBe(false);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        product: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.product,
          title: "{PRODUCT_NAME}",
        },
      }).success,
    ).toBe(false);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        product: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.product,
          title: "{dangerous_token}",
        },
      }).success,
    ).toBe(false);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        quantity: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.quantity,
          modalTitle: "x".repeat(46),
        },
      }).success,
    ).toBe(false);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        quantity: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.quantity,
          modalTitle: " \u0000  ",
        },
      }).success,
    ).toBe(false);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        quantity: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.quantity,
          unavailableText: "",
        },
      }).success,
    ).toBe(false);
  });

  it("preserva markdown e menções como texto para o payload suprimi-las", () => {
    const parsed = botMessageCustomizationSchema.parse({
      ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      storefront: {
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.storefront,
        welcome: "**Oferta** @everyone <@&123456789012345678>",
      },
    });
    expect(parsed.storefront.welcome).toContain("@everyone");
    expect(parsed.storefront.welcome).toContain("<@&123456789012345678>");
  });
});
