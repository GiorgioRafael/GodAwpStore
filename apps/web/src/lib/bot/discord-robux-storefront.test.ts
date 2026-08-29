import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDiscordRobuxStorefrontPayload,
  readRobuxStorefrontConfiguration,
  withRobuxStorefrontConfiguration,
} from "./discord-robux-storefront";

describe("Discord Robux storefront", () => {
  it("builds a standalone Robux message with a purchase button", () => {
    const payload = createDiscordRobuxStorefrontPayload();
    expect(payload).toMatchObject({
      embeds: [{ title: "Robux" }],
      components: [
        {
          components: [{ custom_id: "gwstore_robux:open", label: "Comprar Robux" }],
        },
      ],
    });
    expect(payload.embeds[0]?.description).toContain("confira o valor antes de gerar o Pix");
    expect(payload.embeds[0]?.fields?.[0]?.value).toBe("**1.000 Robux = R$ 40,00**");
    expect(payload.embeds[0]?.image).toEqual({
      url: "https://gwstore.vercel.app/brands/gwstore-storefront-banner.png",
    });
  });

  it("preserves unrelated guild settings when storing the message", () => {
    const merged = withRobuxStorefrontConfiguration(
      { tickets: { category_id: "123456789012345678" } },
      {
        channel_id: "123456789012345678",
        channel_name: "robux",
        message_id: "223456789012345678",
        published_at: "2026-08-20T12:00:00.000Z",
      },
    );
    expect(merged).toMatchObject({
      tickets: { category_id: "123456789012345678" },
      robux_storefront: { channel_name: "robux" },
    });
    expect(readRobuxStorefrontConfiguration(merged)).toEqual(merged.robux_storefront);
  });
});
