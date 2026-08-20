import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const openInteraction = {
  type: 3,
  data: { custom_id: "gwstore_robux:open" },
};

describe("native Discord Robux interactions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "GWStore");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("opens a quantity modal from the published button", async () => {
    const { createNativeDiscordRobuxResponse, parseNativeDiscordRobuxInteraction } =
      await import("./discord-robux");

    expect(parseNativeDiscordRobuxInteraction(openInteraction)).toEqual({ kind: "open" });
    expect(createNativeDiscordRobuxResponse()).toMatchObject({
      type: 9,
      data: {
        custom_id: "gwstore_robux:quantity",
        title: "Comprar Robux",
      },
    });
  });

  it("defers the modal submission privately", async () => {
    const { parseNativeDiscordRobuxInteraction } = await import("./discord-robux");

    expect(
      parseNativeDiscordRobuxInteraction({
        type: 5,
        data: { custom_id: "gwstore_robux:quantity" },
      }),
    ).toEqual({
      kind: "submit",
      response: { type: 5, data: { flags: 64 } },
    });
  });

  it("does not claim unrelated interactions", async () => {
    const { parseNativeDiscordRobuxInteraction } = await import("./discord-robux");
    expect(parseNativeDiscordRobuxInteraction({ type: 3, data: { custom_id: "other:open" } })).toBeNull();
  });

  it("does not expose the sale on THStore", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "THstore");
    vi.resetModules();
    const { createNativeDiscordRobuxResponse } = await import("./discord-robux");

    expect(createNativeDiscordRobuxResponse()).toMatchObject({
      type: 4,
      data: { flags: 64 },
    });
  });
});
