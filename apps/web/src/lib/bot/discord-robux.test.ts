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

  it("defers the quantity modal privately to show the purchase preview", async () => {
    const { parseNativeDiscordRobuxInteraction } = await import("./discord-robux");

    expect(
      parseNativeDiscordRobuxInteraction({
        type: 5,
        data: { custom_id: "gwstore_robux:quantity" },
      }),
    ).toEqual({
      kind: "preview",
      response: { type: 5, data: { flags: 64 } },
    });
  });

  it("defers the explicit finalization button with its validated quantity", async () => {
    const { parseNativeDiscordRobuxInteraction } = await import("./discord-robux");

    expect(
      parseNativeDiscordRobuxInteraction({
        type: 3,
        data: { custom_id: "gwstore_robux:finalize:1000" },
      }),
    ).toEqual({
      kind: "finalize",
      quantity: 1000,
      response: { type: 5, data: { flags: 64 } },
    });
  });

  it("rejects an invalid quantity in a finalization button", async () => {
    const { parseNativeDiscordRobuxInteraction } = await import("./discord-robux");

    expect(
      parseNativeDiscordRobuxInteraction({
        type: 3,
        data: { custom_id: "gwstore_robux:finalize:1" },
      }),
    ).toBeNull();
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

  it("keeps Robux available for the legacy GodAwp Store brand", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "GodAwp Store");
    vi.resetModules();
    const { createNativeDiscordRobuxResponse } = await import("./discord-robux");

    expect(createNativeDiscordRobuxResponse()).toMatchObject({ type: 9 });
  });
});
