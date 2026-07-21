import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  completeDiscordGiveawayParticipation,
  GiveawayParticipationError,
  giveawayParticipationInteractionId,
  parseNativeDiscordGiveawayParticipation,
  type GiveawayParticipationRepository,
} from "./discord-participation";

const giveawayId = "11111111-1111-4111-8111-111111111111";
const applicationId = "123456789012345678";
const guildId = "223456789012345678";
const userId = "323456789012345678";
const interactionToken = "valid_interaction_token_1234567890";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Discord giveaway participation", () => {
  it("gera e reconhece somente o botão associado a um UUID", () => {
    expect(giveawayParticipationInteractionId(giveawayId)).toBe(
      `gwstore_giveaway_join:${giveawayId}`,
    );
    expect(parseNativeDiscordGiveawayParticipation({
      type: 3,
      data: { custom_id: `gwstore_giveaway_join:${giveawayId}` },
    })).toEqual({
      giveawayId,
      response: { type: 5, data: { flags: 64 } },
    });
    expect(parseNativeDiscordGiveawayParticipation({
      type: 3,
      data: { custom_id: "gwstore_giveaway_join:invalido" },
    })).toBeNull();
    expect(() => giveawayParticipationInteractionId("invalido")).toThrow(
      "ID de sorteio inválido",
    );
  });

  it("cadastra pelo usuário autenticado da interação e responde em privado", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    const repository = participationRepository({
      wasCreated: true,
      validInviteCount: 0,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));

    await expect(completeDiscordGiveawayParticipation(
      interaction(),
      { repository, fetcher: fetchMock as unknown as typeof fetch },
    )).resolves.toEqual({ status: "created" });

    expect(repository.register).toHaveBeenCalledWith({
      giveawayId,
      discordGuildId: guildId,
      discordUserId: userId,
      displayName: "Apelido no servidor",
      avatarUrl: `https://cdn.discordapp.com/avatars/${userId}/a_1234567890abcdef1234567890abcdef.gif?size=128`,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      components: [],
      allowed_mentions: { parse: [] },
    });
    expect(body.content).toContain("Participação cadastrada");
  });

  it("avisa em privado quando a participação já existia", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    const repository = participationRepository({
      wasCreated: false,
      validInviteCount: 2,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));

    await expect(completeDiscordGiveawayParticipation(
      interaction(),
      { repository, fetcher: fetchMock as unknown as typeof fetch },
    )).resolves.toEqual({ status: "existing" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.content).toContain("já está cadastrado");
  });

  it("informa quando o sorteio não aceita mais participações", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    const repository: GiveawayParticipationRepository = {
      register: vi.fn().mockRejectedValue(new GiveawayParticipationError(
        "closed",
        "Giveaway is not accepting participants.",
      )),
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));

    await expect(completeDiscordGiveawayParticipation(
      interaction(),
      { repository, fetcher: fetchMock as unknown as typeof fetch },
    )).resolves.toEqual({ status: "closed" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.content).toContain("não está aceitando participações");
  });

  it("recusa interação sem identidade de membro do servidor", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    const raw = interaction();
    const interactionWithoutMember = {
      ...raw,
      member: undefined,
      user: raw.member.user,
    };
    const repository = participationRepository({ wasCreated: true, validInviteCount: 0 });

    await expect(completeDiscordGiveawayParticipation(
      interactionWithoutMember,
      { repository, fetcher: vi.fn() as unknown as typeof fetch },
    )).rejects.toThrow("sem contexto válido");
    expect(repository.register).not.toHaveBeenCalled();
  });
});

function participationRepository(
  result: Awaited<ReturnType<GiveawayParticipationRepository["register"]>>,
) {
  return {
    register: vi.fn().mockResolvedValue(result),
  } satisfies GiveawayParticipationRepository;
}

function interaction() {
  return {
    id: "423456789012345678",
    application_id: applicationId,
    token: interactionToken,
    type: 3,
    guild_id: guildId,
    member: {
      nick: "Apelido no servidor",
      user: {
        id: userId,
        username: "usuario",
        global_name: "Nome global",
        avatar: "a_1234567890abcdef1234567890abcdef",
      },
    },
    data: { custom_id: `gwstore_giveaway_join:${giveawayId}` },
  };
}
