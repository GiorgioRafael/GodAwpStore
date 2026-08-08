import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  publishRoulettePromotion,
  roulettePromotionBannerPath,
  roulettePromotionPayload,
} from "./promotion";
import { rouletteBrandingFor } from "./branding";

const GUILD_ID = "123456789012345678";
const CHANNEL_ID = "223456789012345678";
const MESSAGE_ID = "323456789012345678";
const BOT_ID = "423456789012345678";
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
    const payload = roulettePromotionPayload(
      copy,
      "https://gwstore.vercel.app",
    );

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

  it("usa a arte solicitada somente na roleta da THStore", () => {
    expect(roulettePromotionBannerPath("thstore")).toBe(
      "/brands/thstore-roulette-banner.png",
    );
    expect(roulettePromotionBannerPath("gwstore")).toBe(
      "/brands/gwstore-storefront-banner.png",
    );
  });

  it("publica a identidade completa da THStore sem herdar domínio ou cor da GWStore", () => {
    const branding = rouletteBrandingFor(
      "thstore",
      "THStore",
      "Grow a Garden 2",
    );
    const payload = roulettePromotionPayload(
      branding.promotion,
      branding.canonicalSiteUrl,
      branding,
    );

    expect(payload.embeds[0]).toMatchObject({
      color: 0x2f7bf0,
      title: "A Roleta Giro da THStore chegou",
      url: "https://thstoreadm.vercel.app/roleta",
      image: {
        url: "https://thstoreadm.vercel.app/brands/thstore-roulette-banner.png",
      },
      footer: { text: "THStore • Grow a Garden 2 • roleta" },
    });
    expect(payload.embeds[0].description).not.toContain("GWStore");
    expect(payload.components[0].components[0].url).toBe(
      "https://thstoreadm.vercel.app/roleta",
    );
  });

  it("edita a publicação vinculada sem criar uma mensagem duplicada", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubEnv("DISCORD_APPLICATION_ID", BOT_ID);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: BOT_ID, bot: true }))
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

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3]?.[0]).toBe(
      `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`,
    );
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ method: "PATCH" });
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
