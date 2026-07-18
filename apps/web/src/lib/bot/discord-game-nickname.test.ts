import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import {
  completeDiscordGameNicknameSubmission,
  createNativeDiscordGameNicknameResponse,
  GameNicknameSubmissionError,
  normalizeGameNickname,
  parseNativeDiscordGameNicknameInteraction,
  type GameNicknameRepository,
} from "./discord-game-nickname";

const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const applicationId = "123456789012345678";
const guildId = "223456789012345678";
const buyerId = "323456789012345678";
const channelId = "423456789012345678";
const interactionToken = "valid_interaction_token_1234567890";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Discord game nickname interactions", () => {
  it("reconhece somente o botão e o modal vinculados a um UUID de pedido", () => {
    expect(
      parseNativeDiscordGameNicknameInteraction({
        type: 3,
        data: { custom_id: `gwstore_game_nickname:${orderId}` },
      }),
    ).toEqual({ kind: "open", orderId });

    expect(
      parseNativeDiscordGameNicknameInteraction({
        type: 5,
        data: { custom_id: `gwstore_game_nickname:${orderId}`, components: [] },
      }),
    ).toEqual({
      kind: "submit",
      orderId,
      response: { type: 5, data: { flags: 64 } },
    });

    expect(
      parseNativeDiscordGameNicknameInteraction({
        type: 3,
        data: { custom_id: "gwstore_game_nickname:not-an-order" },
      }),
    ).toBeNull();
  });

  it("abre um modal nativo curto com os limites aceitos pelo banco", async () => {
    await expect(
      createNativeDiscordGameNicknameResponse(
        orderId,
        DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      ),
    ).resolves.toMatchObject({
      type: 9,
      data: {
        custom_id: `gwstore_game_nickname:${orderId}`,
        components: [
          {
            type: 18,
            component: {
              type: 4,
              custom_id: "game_nickname",
              style: 1,
              min_length: 2,
              max_length: 64,
              required: true,
            },
          },
        ],
      },
    });
  });

  it("salva o nick com o contexto exato e confirma sem liberar menções", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    vi.stubEnv("DISCORD_BOT_TOKEN", "secret-bot-token");
    const repository = submissionRepository({
      orderId,
      nickname: "Player_One",
      wasChanged: true,
      wasCreated: true,
    });
    const requests: Array<{
      url: string;
      method: string;
      body: Record<string, unknown>;
      headers: Headers;
    }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: new Headers(init?.headers),
      });
      return Response.json({ id: "523456789012345678" });
    }) as unknown as typeof fetch;

    await completeDiscordGameNicknameSubmission(
      modalSubmission("  Player_One  "),
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      { repository, fetcher },
    );

    expect(repository.submit).toHaveBeenCalledWith({
      orderId,
      buyerDiscordId: buyerId,
      discordGuildId: guildId,
      ticketChannelId: channelId,
      nickname: "Player_One",
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      method: "PATCH",
      body: { allowed_mentions: { parse: [] } },
    });
    expect(
      requests[0]?.url.endsWith(
        `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      ),
    ).toBe(true);
    expect(requests[1]).toMatchObject({
      method: "POST",
      body: { allowed_mentions: { parse: [] }, enforce_nonce: true },
    });
    expect(requests[1]?.url.endsWith(`/channels/${channelId}/messages`)).toBe(true);
    expect(requests[1]?.headers.get("authorization")).toBe("Bot secret-bot-token");
    expect(String(requests[1]?.body.nonce)).toHaveLength(25);
    expect(String(requests[1]?.body.content)).toContain("Player\\_One");
  });

  it("repete a confirmação com nonce determinístico quando o mesmo nick já estava salvo", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    vi.stubEnv("DISCORD_BOT_TOKEN", "secret-bot-token");
    const repository = submissionRepository({
      orderId,
      nickname: "PlayerOne",
      wasChanged: false,
      wasCreated: false,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const fetcher = fetchMock as unknown as typeof fetch;

    await completeDiscordGameNicknameSubmission(
      modalSubmission("PlayerOne"),
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      { repository, fetcher },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/messages/@original");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`/channels/${channelId}/messages`);
    const publicPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      nonce: string;
      enforce_nonce: boolean;
    };
    expect(publicPayload).toMatchObject({ enforce_nonce: true });
    expect(publicPayload.nonce).toHaveLength(25);
  });

  it("ainda publica no ticket quando a confirmação privada falha depois da gravação", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    vi.stubEnv("DISCORD_BOT_TOKEN", "secret-bot-token");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = submissionRepository({
      orderId,
      nickname: "PlayerOne",
      wasChanged: true,
      wasCreated: true,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    fetchMock
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: "523456789012345678" }));

    await expect(
      completeDiscordGameNicknameSubmission(
        modalSubmission("PlayerOne"),
        DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
        { repository, fetcher: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toThrow("confirmação privada");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`/channels/${channelId}/messages`);
  });

  it("recusa outro usuário e não expõe detalhes do pedido", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository: GameNicknameRepository = {
      submit: vi.fn(async () => {
        throw new GameNicknameSubmissionError("unauthorized", "context mismatch");
      }),
    };
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({});
    }) as unknown as typeof fetch;

    await completeDiscordGameNicknameSubmission(
      modalSubmission("Intruder"),
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      { repository, fetcher },
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(bodies[0]?.content).toBe(
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.nicknameUnauthorizedText,
    );
    expect(JSON.stringify(bodies[0])).not.toContain(orderId);
  });

  it("rejeita nick vazio, longo ou com controles antes do banco", async () => {
    expect(normalizeGameNickname(" A ")).toBeNull();
    expect(normalizeGameNickname("x".repeat(65))).toBeNull();
    expect(normalizeGameNickname("Player\nOne")).toBeNull();
    expect(normalizeGameNickname("  Player One  ")).toBe("Player One");

    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    const repository = submissionRepository({
      orderId,
      nickname: "unused",
      wasChanged: false,
      wasCreated: false,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const fetcher = fetchMock as unknown as typeof fetch;

    await completeDiscordGameNicknameSubmission(
      modalSubmission("Player\nOne"),
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      { repository, fetcher },
    );

    expect(repository.submit).not.toHaveBeenCalled();
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      content: string;
    };
    expect(payload.content).toBe(DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.nicknameInvalidText);
  });

  it("rejeita payload de modal ambíguo ou com tipo de campo incorreto", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    const repository = submissionRepository({
      orderId,
      nickname: "unused",
      wasChanged: false,
      wasCreated: false,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const duplicate = modalSubmission("FirstNick");
    duplicate.data.components.push({
      type: 1,
      component: { type: 4, custom_id: "game_nickname", value: "SecondNick" },
    });
    const wrongType = modalSubmission("PlayerOne");
    wrongType.data.components[0]!.component.type = 3;

    await completeDiscordGameNicknameSubmission(
      duplicate,
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      { repository, fetcher: fetchMock as unknown as typeof fetch },
    );
    await completeDiscordGameNicknameSubmission(
      wrongType,
      DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
      { repository, fetcher: fetchMock as unknown as typeof fetch },
    );

    expect(repository.submit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      const payload = JSON.parse(String(init?.body)) as { content: string };
      expect(payload.content).toBe(
        DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket.nicknameInvalidText,
      );
    }
  });
});

function modalSubmission(nickname: string) {
  return {
    type: 5,
    id: "623456789012345678",
    application_id: applicationId,
    token: interactionToken,
    guild_id: guildId,
    channel_id: channelId,
    member: { user: { id: buyerId } },
    data: {
      custom_id: `gwstore_game_nickname:${orderId}`,
      components: [
        {
          type: 18,
          component: { type: 4, custom_id: "game_nickname", value: nickname },
        },
      ],
    },
  };
}

function submissionRepository(
  result: Awaited<ReturnType<GameNicknameRepository["submit"]>>,
): GameNicknameRepository & { submit: ReturnType<typeof vi.fn> } {
  return { submit: vi.fn(async () => result) };
}
