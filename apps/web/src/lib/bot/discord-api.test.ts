import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DiscordApiError,
  assertConfiguredDiscordBotIdentity,
  assertDiscordBotGuildAccess,
  discordBotJson,
  isDiscordUnknownChannelResponse,
} from "./discord-api";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Discord API errors", () => {
  it.each([
    [404, { code: 10_003, message: "Unknown Channel" }, true],
    [404, { code: 10_008, message: "Unknown Message" }, false],
    [403, { code: 10_003, message: "Unknown Channel" }, false],
  ])(
    "reconhece Unknown Channel somente com status e código exatos",
    async (status, payload, expected) => {
      await expect(
        isDiscordUnknownChannelResponse(Response.json(payload, { status })),
      ).resolves.toBe(expected);
    },
  );

  it("não reconhece página HTML 404 como Unknown Channel", async () => {
    await expect(
      isDiscordUnknownChannelResponse(
        new Response("upstream not found", {
          status: 404,
          headers: { "content-type": "text/html" },
        }),
      ),
    ).resolves.toBe(false);
  });

  it("preserva status, caminho e método de respostas recusadas", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const fetcher = vi.fn(async () =>
      Response.json(
        { code: 10_008, message: "Unknown Message" },
        { status: 404 },
      )) as unknown as typeof fetch;

    const failure = discordBotJson(
      "/channels/423456789012345678/messages/523456789012345678",
      { method: "patch" },
      fetcher,
    );

    await expect(failure).rejects.toMatchObject({
      name: "DiscordApiError",
      status: 404,
      path: "/channels/423456789012345678/messages/523456789012345678",
      method: "PATCH",
      discordCode: 10_008,
    });
    await expect(failure).rejects.toBeInstanceOf(DiscordApiError);
  });

  it("não inventa código Discord para 404 sem JSON válido", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const fetcher = vi.fn(async () =>
      new Response("upstream not found", {
        status: 404,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    await expect(
      discordBotJson("/channels/423456789012345678", {}, fetcher),
    ).rejects.toMatchObject({
      status: 404,
      discordCode: null,
      path: "/channels/423456789012345678",
      method: "GET",
    });
  });

  it("valida a identidade do bot contra o aplicativo configurado", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const fetcher = vi.fn(async () =>
      Response.json({ id: "123456789012345678", bot: true }),
    ) as unknown as typeof fetch;

    await expect(assertConfiguredDiscordBotIdentity(fetcher)).resolves.toBe(
      "123456789012345678",
    );
  });

  it("rejeita um token Discord pertencente a outro bot", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubEnv("DISCORD_APPLICATION_ID", "123456789012345678");
    const fetcher = vi.fn(async () =>
      Response.json({ id: "623456789012345678", bot: true }),
    ) as unknown as typeof fetch;

    await expect(assertConfiguredDiscordBotIdentity(fetcher)).rejects.toThrow(
      "não corresponde ao aplicativo Discord",
    );
  });

  it("falha antes da rede quando o aplicativo Discord não está configurado", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    vi.stubEnv("DISCORD_APPLICATION_ID", "");
    const fetcher = vi.fn();

    await expect(assertConfiguredDiscordBotIdentity(fetcher)).rejects.toThrow(
      "DISCORD_APPLICATION_ID",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("confirma acesso autenticado do bot ao servidor exato", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const guildId = "223456789012345678";
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bot bot-token");
      return Response.json({ id: guildId, name: "GW Store" });
    }) as unknown as typeof fetch;

    await expect(assertDiscordBotGuildAccess(guildId, fetcher)).resolves.toBe(guildId);
    expect(fetcher).toHaveBeenCalledWith(
      `https://discord.com/api/v10/guilds/${guildId}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it.each([
    [403, { code: 50_001, message: "Missing Access" }],
    [404, { code: 10_003, message: "Unknown Channel" }],
  ])("nega acesso ao servidor quando Discord retorna %s", async (status, payload) => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const fetcher = vi.fn(async () => Response.json(payload, { status })) as unknown as typeof fetch;

    await expect(
      assertDiscordBotGuildAccess("223456789012345678", fetcher),
    ).rejects.toBeInstanceOf(DiscordApiError);
  });

  it("nega resposta 2xx de outro servidor e ID de entrada inválido", async () => {
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
    const fetcher = vi.fn(async () =>
      Response.json({ id: "923456789012345678" })) as unknown as typeof fetch;

    await expect(
      assertDiscordBotGuildAccess("223456789012345678", fetcher),
    ).rejects.toThrow("não confirmou o acesso");
    await expect(assertDiscordBotGuildAccess("invalid", fetcher)).rejects.toThrow(
      "ID do servidor Discord",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
