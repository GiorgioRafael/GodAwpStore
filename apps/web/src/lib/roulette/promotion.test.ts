import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  publishRoulettePromotion,
  roulettePromotionPayload,
} from "./promotion";

const GUILD_ID = "123456789012345678";
const CHANNEL_ID = "223456789012345678";
const MESSAGE_ID = "323456789012345678";
const copy = {
  title: "A roleta da GWStore chegou",
  description:
    "Agora a GWStore tem uma roleta para você conseguir seus itens dentro do Grow a Garden 2.",
  buttonLabel: "Abrir a roleta",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("roulette Discord promotion", () => {
  it("usa o domínio canônico, o banner e um botão de link seguro", () => {
    const payload = roulettePromotionPayload(copy, "https://gwstore.vercel.app");

    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0]).toMatchObject({
      title: copy.title,
      description: copy.description,
      url: "https://gwstore.vercel.app/roleta",
      image: {
        url: "https://gwstore.vercel.app/brands/gwstore-storefront-banner.png",
      },
    });
    expect(payload.components[0].components[0]).toEqual({
      type: 2,
      style: 5,
      label: "Abrir a roleta",
      url: "https://gwstore.vercel.app/roleta",
    });
  });

  it("edita a publicação vinculada sem criar uma mensagem duplicada", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: GUILD_ID }))
      .mockResolvedValueOnce(
        jsonResponse({ id: CHANNEL_ID, guild_id: GUILD_ID, type: 0 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: MESSAGE_ID, channel_id: CHANNEL_ID }),
      );

    await expect(
      publishRoulettePromotion(
        {
          ...copy,
          guildId: GUILD_ID,
          channelId: CHANNEL_ID,
          messageId: MESSAGE_ID,
        },
        { fetcher, siteUrl: "https://gwstore.vercel.app" },
      ),
    ).resolves.toEqual({ channelId: CHANNEL_ID, messageId: MESSAGE_ID });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`,
    );
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: "PATCH" });
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
