import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(() => null),
}));

import {
  DiscordTicketCloseError,
  completeDiscordTicketClose,
  createNativeDiscordTicketCloseCancelResponse,
  createNativeDiscordTicketClosePrompt,
  parseNativeDiscordTicketCloseInteraction,
  ticketCloseCancelInteractionId,
  ticketCloseConfirmInteractionId,
  ticketCloseInteractionId,
  type DiscordTicketCloseRepository,
} from "./discord-ticket-close";
import { DEFAULT_BOT_MESSAGE_CUSTOMIZATION } from "./message-customization";
import type { BotRuntimeSettings } from "./message-customization-server";

const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";
const applicationId = "123456789012345678";
const guildId = "223456789012345678";
const channelId = "323456789012345678";
const interactionId = "423456789012345678";
const authorizedUserId = "385924725332901909";
const unauthorizedUserId = "523456789012345678";
const interactionToken = "abcdefghijklmnopqrstuvwxyz0123456789";
const claimToken = "6bc34461-3e2d-4af2-bd2d-b42150704897";

const settings: BotRuntimeSettings = {
  customization: {
    ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
    ticket: {
      ...DEFAULT_BOT_MESSAGE_CUSTOMIZATION.ticket,
      closeButtonLabel: "Encerrar atendimento",
      closeConfirmationText: "Confirma o fechamento?",
      closeConfirmButtonLabel: "Sim, fechar",
      closeCancelButtonLabel: "Voltar",
      closeUnauthorizedText: "Sem permissao.",
      closeInProgressText: "Fechando...",
      closeSuccessText: "Fechado.",
      closeUnavailableText: "Indisponivel.",
    },
  },
  ticketNotificationDiscordUserIds: [],
  ticketCloseAdminDiscordUserIds: [authorizedUserId],
};

beforeEach(() => {
  vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
  vi.stubEnv("DISCORD_BOT_TOKEN", "discord-bot-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Discord ticket close interactions", () => {
  it("gera IDs restritos ao pedido e reconhece cada etapa", () => {
    expect(ticketCloseInteractionId(orderId)).toBe(`gwstore_ticket_close:${orderId}`);
    expect(ticketCloseConfirmInteractionId(orderId)).toBe(
      `gwstore_ticket_close_confirm:${orderId}`,
    );
    expect(ticketCloseCancelInteractionId(orderId)).toBe(
      `gwstore_ticket_close_cancel:${orderId}`,
    );

    expect(parseNativeDiscordTicketCloseInteraction(interaction("request"))).toEqual({
      kind: "request",
      orderId,
    });
    expect(parseNativeDiscordTicketCloseInteraction(interaction("confirm"))).toMatchObject({
      kind: "confirm",
      orderId,
      response: { type: 5, data: { flags: 64 } },
    });
    expect(parseNativeDiscordTicketCloseInteraction(interaction("cancel"))).toEqual({
      kind: "cancel",
      orderId,
    });
    expect(
      parseNativeDiscordTicketCloseInteraction({
        ...interaction("request"),
        data: { custom_id: "gwstore_ticket_close:not-an-order" },
      }),
    ).toBeNull();
  });

  it("mostra a confirmacao apenas para quem esta na allowlist carregada", () => {
    expect(createNativeDiscordTicketClosePrompt(interaction("request"), settings)).toEqual({
      type: 4,
      data: {
        content: "Confirma o fechamento?",
        flags: 64,
        allowed_mentions: { parse: [] },
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 4,
                custom_id: `gwstore_ticket_close_confirm:${orderId}`,
                label: "Sim, fechar",
              },
              {
                type: 2,
                style: 2,
                custom_id: `gwstore_ticket_close_cancel:${orderId}`,
                label: "Voltar",
              },
            ],
          },
        ],
      },
    });

    expect(
      createNativeDiscordTicketClosePrompt(
        interaction("request", unauthorizedUserId),
        settings,
      ),
    ).toMatchObject({
      type: 4,
      data: { content: "Sem permissao.", flags: 64, components: [] },
    });
  });

  it("remove os controles da confirmacao ao cancelar", () => {
    expect(
      createNativeDiscordTicketCloseCancelResponse(interaction("cancel"), settings),
    ).toEqual({
      type: 7,
      data: {
        content: "Fechamento cancelado.",
        components: [],
        allowed_mentions: { parse: [] },
      },
    });
  });

  it("revalida no banco, confere o canal e so entao o exclui e conclui", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher = discordFetcher(requests);

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher,
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "closed", channelId });

    expect(repository.claim).toHaveBeenCalledWith({
      orderId,
      discordGuildId: guildId,
      ticketChannelId: channelId,
      closedByDiscordUserId: authorizedUserId,
      claimToken,
    });
    expect(repository.complete).toHaveBeenCalledWith({ orderId, ticketChannelId: channelId, claimToken });
    expect(repository.release).not.toHaveBeenCalled();
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringMatching(new RegExp(`/channels/${channelId}$`)),
          method: "GET",
        }),
        expect.objectContaining({
          url: expect.stringMatching(new RegExp(`/channels/${channelId}$`)),
          method: "DELETE",
        }),
      ]),
    );
    expect(
      requests.filter((request) => request.url.includes("/webhooks/")).at(-1)?.body,
    ).toMatchObject({ content: "Fechado.", components: [] });
  });

  it("nao exclui um canal cujo servidor ou topico nao corresponde ao pedido", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher = discordFetcher(requests, {
      channel: {
        id: channelId,
        guild_id: guildId,
        type: 0,
        topic: "gwstore-order:7b5c3643-6a3f-4a2b-8f27-4cf06dd2eb4f;welcome=1",
      },
    });

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher,
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.release).toHaveBeenCalledWith({ orderId, claimToken });
    expect(repository.complete).not.toHaveBeenCalled();
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("faz a autorizacao definitiva no RPC antes de chamar a API do bot", async () => {
    const repository = fakeRepository({
      claim: async () => {
        throw new DiscordTicketCloseError("unauthorized", "not allowed");
      },
    });
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher = discordFetcher(requests);

    await expect(
      completeDiscordTicketClose(interaction("confirm", unauthorizedUserId), settings, {
        repository,
        fetcher,
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unauthorized" });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
    expect(requests.every((request) => request.url.includes("/webhooks/"))).toBe(true);
    expect(requests.at(-1)?.body).toMatchObject({ content: "Sem permissao." });
  });

  it("trata uma reserva concorrente sem excluir nem liberar a reserva alheia", async () => {
    const repository = fakeRepository({
      claim: async () => ({
        orderId,
        claimed: false,
        alreadyClosed: false,
        ticketStatus: "open",
        ticketChannelId: channelId,
        claimToken: null,
      }),
    });
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "in_progress" });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
    expect(requests.every((request) => request.url.includes("/webhooks/"))).toBe(true);
  });

  it("conclui de forma idempotente quando o canal ja nao existe", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, { channelStatus: 404 }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "closed", channelId });

    expect(repository.complete).toHaveBeenCalledOnce();
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it.each([
    ["HTML", "html" as const],
    ["outro código Discord", { code: 10_008, message: "Unknown Message" }],
  ])("preserva a reserva diante de 404 %s no GET", async (_label, channelErrorBody) => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, { channelStatus: 404, channelErrorBody }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("preserva a reserva diante de 404 sem Unknown Channel no DELETE", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, {
          deleteStatus: 404,
          deleteErrorBody: { code: 10_008, message: "Unknown Message" },
        }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
  });

  it("conclui quando o DELETE confirma Unknown Channel após o GET validado", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, { deleteStatus: 404 }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "closed", channelId });

    expect(repository.complete).toHaveBeenCalledOnce();
    expect(repository.release).not.toHaveBeenCalled();
  });

  it("preserva a reserva quando DELETE 2xx não confirma o ID do canal", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, { deleteSuccessBody: {} }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
  });

  it("não consulta nem apaga o canal quando o token pertence a outro bot", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, {
          botUser: { id: "623456789012345678", bot: true },
        }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledWith({ orderId, claimToken });
    expect(
      requests.some((request) => request.url.endsWith(`/channels/${channelId}`)),
    ).toBe(false);
  });

  it.each([
    [403, { code: 50_001, message: "Missing Access" }],
    [404, { code: 10_003, message: "Unknown Channel" }],
  ])("não fecha nem consulta o canal quando o guild retorna %s", async (status, guildErrorBody) => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, { guildStatus: status, guildErrorBody }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledWith({ orderId, claimToken });
    expect(
      requests.some((request) => request.url.endsWith(`/channels/${channelId}`)),
    ).toBe(false);
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("não fecha nem consulta o Discord sem application ID configurado", async () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", "");
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.claim).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it("revalida o guild após Unknown Channel no GET antes de concluir", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, {
          channelStatus: 404,
          guildResponses: [
            { status: 200, body: { id: guildId } },
            { status: 403, body: { code: 50_001, message: "Missing Access" } },
          ],
        }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledWith({ orderId, claimToken });
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("revalida o guild após Unknown Channel no DELETE antes de concluir", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, {
          deleteStatus: 404,
          guildResponses: [
            { status: 200, body: { id: guildId } },
            { status: 403, body: { code: 50_001, message: "Missing Access" } },
          ],
        }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
    expect(requests.some((request) => request.method === "DELETE")).toBe(true);
  });

  it("preserva a reserva quando a resposta da exclusao e ambigua", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, { deleteStatus: 503 }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.release).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("libera a reserva quando o Discord confirma que nao removeu o canal", async () => {
    const repository = fakeRepository();
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests, { deleteStatus: 403 }),
        createClaimToken: () => claimToken,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.release).toHaveBeenCalledWith({ orderId, claimToken });
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("repete a conclusao idempotente depois que o canal foi removido", async () => {
    let completionAttempts = 0;
    const repository = fakeRepository({
      complete: async () => {
        completionAttempts += 1;
        if (completionAttempts < 3) throw new Error("temporary database failure");
      },
    });
    const wait = vi.fn(async () => undefined);
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests),
        createClaimToken: () => claimToken,
        wait,
      }),
    ).resolves.toEqual({ status: "closed", channelId });

    expect(repository.complete).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 250);
    expect(wait).toHaveBeenNthCalledWith(2, 750);
    expect(repository.release).not.toHaveBeenCalled();
  });

  it("usa o orcamento de retry do after sem apagar a evidencia da reserva", async () => {
    const repository = fakeRepository({
      complete: async () => {
        throw new Error("database unavailable");
      },
    });
    let clock = 0;
    const wait = vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    });
    const requests: Array<{ url: string; method: string; body: unknown }> = [];

    await expect(
      completeDiscordTicketClose(interaction("confirm"), settings, {
        repository,
        fetcher: discordFetcher(requests),
        createClaimToken: () => claimToken,
        wait,
        now: () => clock,
      }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(repository.complete).toHaveBeenCalledTimes(8);
    expect(wait.mock.calls.flat().reduce((total, value) => total + value, 0)).toBeLessThanOrEqual(
      23_000,
    );
    expect(clock).toBe(22_000);
    expect(repository.release).not.toHaveBeenCalled();
  });
});

function interaction(
  kind: "request" | "confirm" | "cancel",
  userId = authorizedUserId,
) {
  const prefix = {
    request: "gwstore_ticket_close:",
    confirm: "gwstore_ticket_close_confirm:",
    cancel: "gwstore_ticket_close_cancel:",
  }[kind];
  return {
    type: 3,
    id: interactionId,
    application_id: applicationId,
    token: interactionToken,
    guild_id: guildId,
    channel_id: channelId,
    member: { user: { id: userId } },
    data: { component_type: 2, custom_id: `${prefix}${orderId}` },
  };
}

function fakeRepository(
  overrides: Partial<DiscordTicketCloseRepository> = {},
): DiscordTicketCloseRepository & {
  claim: ReturnType<typeof vi.fn<DiscordTicketCloseRepository["claim"]>>;
  complete: ReturnType<typeof vi.fn<DiscordTicketCloseRepository["complete"]>>;
  release: ReturnType<typeof vi.fn<DiscordTicketCloseRepository["release"]>>;
} {
  const claim = vi.fn<DiscordTicketCloseRepository["claim"]>(
    overrides.claim ??
      (async () => ({
        orderId,
        claimed: true,
        alreadyClosed: false,
        ticketStatus: "open",
        ticketChannelId: channelId,
        claimToken,
      })),
  );
  const complete = vi.fn<DiscordTicketCloseRepository["complete"]>(
    overrides.complete ?? (async () => undefined),
  );
  const release = vi.fn<DiscordTicketCloseRepository["release"]>(
    overrides.release ?? (async () => undefined),
  );
  return { claim, complete, release };
}

function discordFetcher(
  requests: Array<{ url: string; method: string; body: unknown }>,
  options: {
    botUser?: { id: string; bot: boolean };
    guild?: { id: string };
    guildStatus?: number;
    guildErrorBody?: { code: number; message: string };
    guildResponses?: Array<{ status: number; body: unknown }>;
    channel?: { id: string; guild_id: string; type: number; topic: string };
    channelStatus?: number;
    channelErrorBody?: "html" | { code: number; message: string };
    deleteStatus?: number;
    deleteErrorBody?: "html" | { code: number; message: string };
    deleteSuccessBody?: unknown;
  } = {},
) {
  let guildResponseIndex = 0;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ url, method, body });

    if (url.includes("/webhooks/")) return Response.json({ id: interactionId });
    if (url.endsWith("/users/@me")) {
      return Response.json(options.botUser ?? { id: applicationId, bot: true });
    }
    if (url.endsWith(`/guilds/${guildId}`)) {
      const sequencedResponse = options.guildResponses?.[guildResponseIndex++];
      if (sequencedResponse) {
        return Response.json(sequencedResponse.body, {
          status: sequencedResponse.status,
        });
      }
      const status = options.guildStatus ?? 200;
      return Response.json(
        status === 200
          ? (options.guild ?? { id: guildId })
          : (options.guildErrorBody ?? { message: "Discord guild unavailable" }),
        { status },
      );
    }
    if (url.endsWith(`/channels/${channelId}`) && method === "GET") {
      const status = options.channelStatus ?? 200;
      if (status === 404) {
        if (options.channelErrorBody === "html") {
          return new Response("upstream not found", {
            status,
            headers: { "content-type": "text/html" },
          });
        }
        return Response.json(
          options.channelErrorBody ?? { code: 10_003, message: "Unknown Channel" },
          { status },
        );
      }
      return Response.json(
        options.channel ?? {
          id: channelId,
          guild_id: guildId,
          type: 0,
          topic: `gwstore-order:${orderId};welcome=1`,
        },
        { status },
      );
    }
    if (url.endsWith(`/channels/${channelId}`) && method === "DELETE") {
      const status = options.deleteStatus ?? 200;
      if (options.deleteErrorBody === "html") {
        return new Response("upstream not found", {
          status,
          headers: { "content-type": "text/html" },
        });
      }
      return Response.json(
        status === 200
          ? (options.deleteSuccessBody ?? { id: channelId })
          : (options.deleteErrorBody ??
            (status === 404
              ? { code: 10_003, message: "Unknown Channel" }
              : { message: "Discord unavailable" })),
        { status },
      );
    }
    throw new Error(`unexpected request ${method} ${url}`);
  }) as unknown as typeof fetch;
}
