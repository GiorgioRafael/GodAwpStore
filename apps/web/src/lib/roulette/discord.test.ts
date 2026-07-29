import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { loadBotRuntimeSettings } = vi.hoisted(() => ({ loadBotRuntimeSettings: vi.fn() }));
vi.mock("@/lib/bot/message-customization-server", () => ({ loadBotRuntimeSettings }));

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "@/lib/bot/message-customization";
import {
  ensureRouletteRedemptionTicket,
  rouletteRedemptionTicketMarker,
  rouletteWelcomeMessageMarker,
} from "./discord";

const REDEMPTION_ID = "9b000000-0000-4000-8000-000000000001";
const GUILD_ID = "900000000000000010";
const PLAYER_ID = "900000000000000013";
const BOT_ID = "900000000000000099";
const STORED_CHANNEL = "900000000000000020";

const INPUT = {
  redemptionId: REDEMPTION_ID,
  guildDiscordId: GUILD_ID,
  playerDiscordId: PLAYER_ID,
  itemSummary: "1x Bamboo Seed",
  totalValueCents: 100,
};

function stub(channels: unknown[], messages: unknown[] = []) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body });
    if (url.endsWith("/users/@me")) return Response.json({ id: BOT_ID, bot: true });
    if (url.endsWith(`/guilds/${GUILD_ID}`)) return Response.json({ id: GUILD_ID });
    if (url.includes(`/guilds/${GUILD_ID}/channels`)) {
      return method === "GET"
        ? Response.json(channels)
        : Response.json({ id: "900000000000000077", type: 0 });
    }
    if (url.includes("/messages?")) return Response.json(messages);
    // O PATCH de permissões devolve o próprio canal, como o Discord faz.
    if (url.endsWith(`/channels/${STORED_CHANNEL}`)) {
      return Response.json({ id: STORED_CHANNEL, type: 0 });
    }
    return Response.json({ id: "900000000000000078" });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubEnv("DISCORD_APPLICATION_ID", BOT_ID);
  loadBotRuntimeSettings.mockResolvedValue({
    customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
    ticketCloseAdminDiscordUserIds: [],
    ticketNotificationDiscordUserIds: [],
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("ticket do resgate", () => {
  it("marca a equipe de verdade ao abrir o ticket", async () => {
    // O Discord renderiza uma menção que não está em allowed_mentions e não
    // notifica ninguém: o ticket parecia chamar a equipe e não chamava.
    loadBotRuntimeSettings.mockResolvedValue({
      customization: DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      ticketCloseAdminDiscordUserIds: [],
      ticketNotificationDiscordUserIds: ["900000000000000042", "900000000000000043"],
    });
    const { fetcher, calls } = stub([]);

    const result = await ensureRouletteRedemptionTicket(INPUT, { fetcher });
    expect(result.synchronized).toBe(true);

    const post = calls.find(
      (call) => call.method === "POST" && call.url.includes("/messages"),
    );
    expect(post).toBeDefined();
    const body = JSON.parse(post!.body as string);

    expect(body.content).toContain("<@900000000000000042>");
    expect(body.content).toContain("<@900000000000000043>");
    // O texto sozinho não notifica: os ids precisam estar aqui.
    expect(body.allowed_mentions.users).toEqual([
      INPUT.playerDiscordId,
      "900000000000000042",
      "900000000000000043",
    ]);
    expect(body.allowed_mentions.parse).toEqual([]);
  });

  it("nunca abre um canal novo quando só era para atualizar os botões", async () => {
    // O botão de entrega é amarrado ao canal guardado (P0017). Um canal novo
    // daria ao jogador e à equipe um botão que nunca funciona.
    const { fetcher, calls } = stub([]);

    const result = await ensureRouletteRedemptionTicket(INPUT, {
      fetcher,
      existingChannelId: STORED_CHANNEL,
      refuseCreate: true,
    });

    expect(result).toEqual({ synchronized: false, reason: "channel-gone" });
    expect(calls.some((c) => c.method === "POST" && c.url.includes("/channels"))).toBe(false);
  });

  it("encontra o canal pelo id guardado mesmo se o tópico foi editado", async () => {
    const { fetcher } = stub(
      [{ id: STORED_CHANNEL, type: 0, topic: "alguém editou isso", permission_overwrites: [] }],
      [
        {
          id: "900000000000000030",
          author: { id: BOT_ID },
          embeds: [{ footer: { text: rouletteWelcomeMessageMarker(REDEMPTION_ID) } }],
          components: [],
        },
      ],
    );

    const result = await ensureRouletteRedemptionTicket(INPUT, {
      fetcher,
      existingChannelId: STORED_CHANNEL,
      refuseCreate: true,
    });

    expect(result).toEqual({ synchronized: true, channelId: STORED_CHANNEL, created: false });
  });

  it("não diz que atualizou quando a mensagem inicial sumiu", async () => {
    const { fetcher } = stub(
      [{ id: STORED_CHANNEL, type: 0, topic: rouletteRedemptionTicketMarker(REDEMPTION_ID), permission_overwrites: [] }],
      [],
    );

    const result = await ensureRouletteRedemptionTicket(INPUT, {
      fetcher,
      existingChannelId: STORED_CHANNEL,
      refuseCreate: true,
    });

    expect(result).toEqual({ synchronized: false, reason: "welcome-missing" });
  });
});
