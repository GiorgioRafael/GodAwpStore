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

    const legacyTicket = normalizeBotMessageCustomization({
      version: 1,
      ticket: { title: "Pagamento aprovado" },
    });
    expect(legacyTicket.ticket.title).toBe("Pagamento aprovado");
    expect(legacyTicket.ticket.nicknameButtonLabel).toBe(
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.nicknameButtonLabel,
    );
    expect(legacyTicket.ticket.nicknameSavedText).toBe(
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.nicknameSavedText,
    );
    expect(legacyTicket.ticket.closeButtonLabel).toBe(
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.closeButtonLabel,
    );
    expect(legacyTicket.ticket.closeUnauthorizedText).toBe(
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.closeUnauthorizedText,
    );
    expect(legacyTicket.ticket.deliveryMessageText).toBe(
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.deliveryMessageText,
    );
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

  it("valida os textos e tokens do fluxo de nick no ticket", () => {
    const parsed = botMessageCustomizationSchema.safeParse({
      ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      ticket: {
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
        nicknameSavedText: "Nick **{game_nickname}** recebido.",
        nicknameUpdatedText: "Nick alterado para **{game_nickname}**.",
      },
    });
    expect(parsed.success).toBe(true);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
          nicknameButtonLabel: "x".repeat(81),
        },
      }).success,
    ).toBe(false);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
          nicknameInvalidText: "Nick inválido: {game_nickname}",
        },
      }).success,
    ).toBe(false);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
          nicknameSavedText: "Nick {unknown_token}",
        },
      }).success,
    ).toBe(false);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
          nicknameUpdatedText: "Nick atualizado com sucesso.",
        },
      }).success,
    ).toBe(false);
  });

  it("valida todos os textos do fluxo de fechamento do ticket", () => {
    const parsed = botMessageCustomizationSchema.safeParse({
      ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      ticket: {
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
        closeButtonLabel: "Encerrar atendimento",
        closeConfirmationText: "Confirma o encerramento?",
        closeConfirmButtonLabel: "Sim, fechar",
        closeCancelButtonLabel: "Voltar",
        closeUnauthorizedText: "Sem permissão.",
        closeInProgressText: "Encerrando...",
        closeSuccessText: "Encerrado.",
        closeUnavailableText: "Tente novamente.",
      },
    });
    expect(parsed.success).toBe(true);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
          closeButtonLabel: "x".repeat(81),
        },
      }).success,
    ).toBe(false);
    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
          closeUnauthorizedText: "",
        },
      }).success,
    ).toBe(false);
  });

  it("valida os textos administrativos da conclusao da entrega", () => {
    const parsed = botMessageCustomizationSchema.safeParse({
      ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      ticket: {
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
        deliveryButtonLabel: "Finalizar entrega",
        deliveryMessageText: "Entrega pronta. Obrigado pela preferencia!",
        deliverySuccessText: "Mensagem enviada.",
        deliveryAlreadySentText: "Mensagem ja enviada.",
        deliveryUnauthorizedText: "Sem permissao.",
        deliveryUnavailableText: "Tente novamente.",
      },
    });
    expect(parsed.success).toBe(true);

    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
          deliveryButtonLabel: "x".repeat(81),
        },
      }).success,
    ).toBe(false);
    expect(
      botMessageCustomizationSchema.safeParse({
        ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        ticket: {
          ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
          deliveryMessageText: "",
        },
      }).success,
    ).toBe(false);
  });
});
