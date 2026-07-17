import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDiscordGuildIdentity, readDiscordInteraction } from "./discord-context";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Discord interaction context", () => {
  it("lê somente snowflakes válidos e prioriza o usuário normalizado", () => {
    expect(
      readDiscordInteraction(
        {
          id: "123456789012345678",
          guild_id: "223456789012345678",
          member: { user: { id: "323456789012345678" } },
        },
        "423456789012345678",
      ),
    ).toEqual({
      interactionId: "123456789012345678",
      guildId: "223456789012345678",
      userId: "423456789012345678",
      isServerBooster: false,
    });
  });

  it("não aceita payload arbitrário como contexto", () => {
    expect(readDiscordInteraction({ id: "x", guild_id: "../../etc" }, "admin")).toEqual({
      interactionId: null,
      guildId: null,
      userId: null,
      isServerBooster: false,
    });
  });

  it("reconhece o Nitro Booster pelo premium_since assinado pelo Discord", () => {
    expect(
      readDiscordInteraction(
        {
          id: "123456789012345678",
          guild_id: "223456789012345678",
          member: {
            user: { id: "323456789012345678" },
            premium_since: "2026-07-01T12:00:00.000Z",
          },
        },
        "",
      ).isServerBooster,
    ).toBe(true);
  });

  it("busca nome e proprietário do servidor sem expor o token", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "token-super-secreto");
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual({ Authorization: "Bot token-super-secreto" });
      return Response.json({
        id: "223456789012345678",
        owner_id: "323456789012345678",
        name: "Grow a Garden",
      });
    }) as unknown as typeof fetch;

    await expect(fetchDiscordGuildIdentity("223456789012345678", fetcher)).resolves.toEqual({
      discordGuildId: "223456789012345678",
      ownerDiscordId: "323456789012345678",
      name: "Grow a Garden",
    });
  });
});
