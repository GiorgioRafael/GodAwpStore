import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDiscordRobuxStorefrontPayload,
  readRobuxStorefrontConfiguration,
  withRobuxStorefrontConfiguration,
} from "./discord-robux-storefront";

describe("Discord Robux storefront", () => {
  it("builds a standalone Robux message with a purchase button", () => {
    expect(createDiscordRobuxStorefrontPayload()).toMatchObject({
      embeds: [{ title: "Robux" }],
      components: [
        {
          components: [{ custom_id: "gwstore_robux:open", label: "Comprar Robux" }],
        },
      ],
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
