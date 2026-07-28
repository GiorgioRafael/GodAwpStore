import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { rpc, createAdminSupabaseClient } = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc, createAdminSupabaseClient: vi.fn(() => ({ rpc })) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient }));

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "@/lib/bot/message-customization";
import {
  ROULETTE_DELIVERY_INTERACTION_PREFIX,
  ROULETTE_NICKNAME_INTERACTION_PREFIX,
  buildRouletteTicketControlComponents,
  completeRouletteNicknameSubmission,
  completeRouletteRedemptionDelivery,
  createNativeRouletteDeliveryResponse,
  createNativeRouletteNicknameResponse,
  parseNativeRouletteDeliveryInteraction,
  parseNativeRouletteNicknameInteraction,
  rouletteDeliveryInteractionId,
  rouletteNicknameInteractionId,
} from "./discord-controls";

const REDEMPTION_ID = "9b000000-0000-4000-8000-000000000001";
const ORDER_ID = "9b000000-0000-4000-8000-0000000000ff";
const GUILD_ID = "900000000000000010";
const CHANNEL_ID = "900000000000000011";
const ADMIN_ID = "900000000000000012";
const PLAYER_ID = "900000000000000013";
const TOKEN = "a".repeat(40);

const SETTINGS = {
  customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  ticketCloseAdminDiscordUserIds: [ADMIN_ID],
  ticketNotificationDiscordUserIds: [] as string[],
};

function interaction(overrides: Record<string, unknown> = {}) {
  return {
    type: 3,
    application_id: "900000000000000099",
    token: TOKEN,
    guild_id: GUILD_ID,
    channel_id: CHANNEL_ID,
    member: { user: { id: ADMIN_ID } },
    data: { custom_id: rouletteDeliveryInteractionId(REDEMPTION_ID) },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DISCORD_APPLICATION_ID", "900000000000000099");
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("botões do ticket de resgate", () => {
  it("usa prefixos próprios, que não colidem com os do pedido", () => {
    // Reaproveitar gwstore_ticket_delivery: falharia em silêncio: o id do
    // resgate é um UUID, então seria aceito e depois procurado em `orders`.
    expect(ROULETTE_DELIVERY_INTERACTION_PREFIX).toBe("gwstore_roulette_delivery:");
    expect(ROULETTE_NICKNAME_INTERACTION_PREFIX).toBe("gwstore_roulette_nickname:");
    expect(ROULETTE_DELIVERY_INTERACTION_PREFIX.startsWith("gwstore_ticket_delivery:")).toBe(false);
    expect(ROULETTE_NICKNAME_INTERACTION_PREFIX.startsWith("gwstore_game_nickname:")).toBe(false);
    // Nenhum pode ser prefixo do outro, senão o parser errado casa primeiro.
    expect(
      ROULETTE_DELIVERY_INTERACTION_PREFIX.startsWith(ROULETTE_NICKNAME_INTERACTION_PREFIX),
    ).toBe(false);
    expect(
      ROULETTE_NICKNAME_INTERACTION_PREFIX.startsWith(ROULETTE_DELIVERY_INTERACTION_PREFIX),
    ).toBe(false);
  });

  it("monta os dois botões com o rótulo configurado", () => {
    expect(
      buildRouletteTicketControlComponents(REDEMPTION_ID, DEFAULT_BOT_MESSAGE_CUSTOMIZATION),
    ).toEqual([
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: `gwstore_roulette_nickname:${REDEMPTION_ID}`,
            label: DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.nicknameButtonLabel,
          },
          {
            type: 2,
            style: 3,
            custom_id: `gwstore_roulette_delivery:${REDEMPTION_ID}`,
            label: DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.deliveryButtonLabel,
          },
        ],
      },
    ]);
  });

  it("cabe no limite de 100 caracteres do custom_id", () => {
    expect(rouletteDeliveryInteractionId(REDEMPTION_ID).length).toBeLessThanOrEqual(100);
    expect(rouletteNicknameInteractionId(REDEMPTION_ID).length).toBeLessThanOrEqual(100);
  });

  it("recusa um id que não seja UUID", () => {
    expect(() => rouletteDeliveryInteractionId("premio_1")).toThrow();
    expect(() => rouletteNicknameInteractionId("")).toThrow();
  });

  it("ignora os botões do pedido pago", () => {
    for (const customId of [
      `gwstore_ticket_delivery:${ORDER_ID}`,
      `gwstore_game_nickname:${ORDER_ID}`,
      `gwstore_ticket_close:${ORDER_ID}`,
    ]) {
      expect(parseNativeRouletteDeliveryInteraction(interaction({ data: { custom_id: customId } }))).toBeNull();
      expect(parseNativeRouletteNicknameInteraction(interaction({ data: { custom_id: customId } }))).toBeNull();
    }
  });

  it("separa o clique do botão do envio do modal", () => {
    const customId = rouletteNicknameInteractionId(REDEMPTION_ID);
    expect(
      parseNativeRouletteNicknameInteraction(interaction({ type: 3, data: { custom_id: customId } })),
    ).toEqual({ kind: "open", redemptionId: REDEMPTION_ID });
    expect(
      parseNativeRouletteNicknameInteraction(interaction({ type: 5, data: { custom_id: customId } }))?.kind,
    ).toBe("submit");
  });
});

describe("entrega pelo ticket", () => {
  it("só a equipe que fecha ticket pode concluir", () => {
    const authorized = createNativeRouletteDeliveryResponse(interaction(), SETTINGS);
    expect(authorized.authorized).toBe(true);
    expect(authorized.response).toEqual({ type: 5, data: { flags: 64 } });

    const stranger = createNativeRouletteDeliveryResponse(
      interaction({ member: { user: { id: PLAYER_ID } } }),
      SETTINGS,
    );
    expect(stranger.authorized).toBe(false);
    expect(stranger.response.type).toBe(4);
  });

  it("passa o canal para a RPC, que amarra o botão ao ticket dele", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          settled_redemption_id: REDEMPTION_ID,
          settled_status: "delivered",
          player_discord_id: PLAYER_ID,
          item_summary: "1x Bamboo Seed",
          delivered_nickname: "jogador123",
        },
      ],
      error: null,
    });
    const fetcher = stubFetcher();

    const result = await completeRouletteRedemptionDelivery(interaction(), SETTINGS, { fetcher });

    expect(result.status).toBe("sent");
    expect(rpc).toHaveBeenCalledWith("complete_roulette_redemption_discord_delivery", {
      p_redemption_id: REDEMPTION_ID,
      p_admin_discord_id: ADMIN_ID,
      p_channel_id: CHANNEL_ID,
    });
  });

  it("não chama a RPC quando quem clicou não é da equipe", async () => {
    const fetcher = stubFetcher();
    const result = await completeRouletteRedemptionDelivery(
      interaction({ member: { user: { id: PLAYER_ID } } }),
      SETTINGS,
      { fetcher },
    );

    expect(result.status).toBe("unauthorized");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("avisa que já foi entregue em vez de repetir", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0013", message: "already" } });
    const fetcher = stubFetcher();

    const result = await completeRouletteRedemptionDelivery(interaction(), SETTINGS, { fetcher });

    expect(result.status).toBe("already_sent");
  });
});

describe("nick pelo ticket", () => {
  it("abre um modal com o campo que o pedido pago já usa", async () => {
    const modal = await createNativeRouletteNicknameResponse(
      REDEMPTION_ID,
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
    );

    expect(modal.type).toBe(9);
    expect(modal.data.custom_id).toBe(`gwstore_roulette_nickname:${REDEMPTION_ID}`);
    expect(modal.data.components[0].component.custom_id).toBe("game_nickname");
    expect(modal.data.components[0].component.min_length).toBe(2);
  });

  it("grava o nick de quem clicou, nunca o de outro usuário", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          updated_redemption_id: REDEMPTION_ID,
          updated_nickname: "jogador123",
          updated_player_discord_id: PLAYER_ID,
        },
      ],
      error: null,
    });
    const fetcher = stubFetcher();

    const result = await completeRouletteNicknameSubmission(
      submitInteraction("  jogador123  "),
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      { fetcher },
    );

    expect(result.status).toBe("saved");
    expect(rpc).toHaveBeenCalledWith("submit_roulette_redemption_nickname", {
      p_redemption_id: REDEMPTION_ID,
      p_player_discord_id: PLAYER_ID,
      p_nickname: "jogador123",
    });
  });

  it("recusa um nick que quebraria o bloco de código da confirmação", async () => {
    const fetcher = stubFetcher();
    const result = await completeRouletteNicknameSubmission(
      submitInteraction("jog`ador"),
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      { fetcher },
    );

    expect(result.status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("devolve não autorizado quando o resgate é de outro jogador", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const fetcher = stubFetcher();

    const result = await completeRouletteNicknameSubmission(
      submitInteraction("jogador123"),
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      { fetcher },
    );

    expect(result.status).toBe("unauthorized");
  });
});

function submitInteraction(value: string) {
  return interaction({
    type: 5,
    member: { user: { id: PLAYER_ID } },
    data: {
      custom_id: rouletteNicknameInteractionId(REDEMPTION_ID),
      components: [
        { type: 18, component: { type: 4, custom_id: "game_nickname", value } },
      ],
    },
  });
}

function stubFetcher() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/users/@me")) {
      return Response.json({ id: "900000000000000099", bot: true });
    }
    if (url.includes("/guilds/")) return Response.json({ id: GUILD_ID });
    return Response.json({ id: "900000000000000020" });
  }) as unknown as typeof fetch;
}

describe("defeitos que a revisão encontrou", () => {
  it("avisa quando a entrega foi registrada mas o aviso não foi postado", async () => {
    // O resgate já está liquidado neste ponto — o estoque saiu do catálogo. Dizer
    // "entrega concluída" mandaria o operador embora sem o jogador saber de nada.
    rpc.mockResolvedValue({
      data: [
        {
          settled_redemption_id: REDEMPTION_ID,
          settled_status: "delivered",
          player_discord_id: PLAYER_ID,
          item_summary: "1x Bamboo Seed",
          delivered_nickname: null,
        },
      ],
      error: null,
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/users/@me")) return Response.json({ id: "900000000000000099", bot: true });
      if (url.includes("/guilds/")) return Response.json({ id: GUILD_ID });
      // O Discord recusa a mensagem no canal.
      if (url.includes("/messages") && (init?.method ?? "GET") === "POST") {
        return new Response("{}", { status: 403 });
      }
      return Response.json({ id: "900000000000000020" });
    }) as unknown as typeof fetch;

    const result = await completeRouletteRedemptionDelivery(interaction(), SETTINGS, { fetcher });

    expect(result.status).toBe("settled_unannounced");
  });

  it("distingue um resgate cancelado de um já entregue", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0019", message: "cancelled" } });
    const fetcher = stubFetcher();

    const result = await completeRouletteRedemptionDelivery(interaction(), SETTINGS, { fetcher });

    expect(result.status).toBe("cancelled");
  });
});
