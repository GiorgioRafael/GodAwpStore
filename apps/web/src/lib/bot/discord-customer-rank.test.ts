import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ensureDiscordCustomerRankRoles,
  synchronizeDiscordCustomerRankRole,
  type CustomerRankRoleRepository,
} from "./discord-customer-rank";
import type { CustomerRankLevel, CustomerRankProgress } from "./customer-rank";

const guildId = "guild-row";
const discordGuildId = "123456789012345678";
const buyerDiscordId = "223456789012345678";
const botId = "323456789012345678";
const bronzeRoleId = "423456789012345678";
const silverRoleId = "523456789012345678";
const followerRoleId = "623456789012345678";

const levels: CustomerRankLevel[] = [
  {
    code: "bronze_i",
    name: "Bronze I",
    roleName: "🥉 Cliente Bronze I",
    minimumSpendCents: 500,
    discountBps: 100,
    color: 9_194_031,
    sortOrder: 1,
  },
  {
    code: "prata_i",
    name: "Prata I",
    roleName: "🥈 Cliente Prata I",
    minimumSpendCents: 5_000,
    discountBps: 200,
    color: 9_016_222,
    sortOrder: 4,
  },
];

const progress: CustomerRankProgress = {
  guildId,
  buyerDiscordId,
  totalSpentCents: 5_000,
  currentRank: levels[1]!,
  nextRank: null,
  amountToNextRankCents: 0,
};

beforeEach(() => {
  vi.stubEnv("DISCORD_APPLICATION_ID", botId);
  vi.stubEnv("DISCORD_BOT_TOKEN", "discord-token-for-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Discord customer rank roles", () => {
  it("cria cargos coloridos, destacados e sem permissões", async () => {
    const saved: Array<{ rankCode: string; roleId: string }> = [];
    const repository = roleRepository({
      listRoleBindings: vi.fn(async () => []),
      saveRoleBinding: vi.fn(async (_guildId, rankCode, roleId) => {
        saved.push({ rankCode, roleId });
      }),
    });
    const createdBodies: unknown[] = [];
    let roleSequence = 0;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/users/@me")) {
        return Response.json({ id: botId, bot: true });
      }
      if (url.endsWith(`/guilds/${discordGuildId}/roles`) && !init?.method) {
        return Response.json([]);
      }
      if (url.endsWith(`/guilds/${discordGuildId}/roles`) && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        createdBodies.push(body);
        const id = [silverRoleId, bronzeRoleId][roleSequence++]!;
        return Response.json({
          id,
          name: body.name,
          color: body.colors.primary_color,
          hoist: body.hoist,
          managed: false,
          mentionable: body.mentionable,
          permissions: body.permissions,
          position: roleSequence,
        });
      }
      if (url.endsWith(`/guilds/${discordGuildId}/roles`) && init?.method === "PATCH") {
        return Response.json([]);
      }
      return new Response(null, { status: 404 });
    });

    const result = await ensureDiscordCustomerRankRoles(
      discordGuildId,
      guildId,
      repository,
      fetcher,
    );

    expect(createdBodies).toEqual([
      {
        name: "🥈 Cliente Prata I",
        colors: {
          primary_color: 9_016_222,
          secondary_color: null,
          tertiary_color: null,
        },
        hoist: true,
        mentionable: false,
        permissions: "0",
      },
      {
        name: "🥉 Cliente Bronze I",
        colors: {
          primary_color: 9_194_031,
          secondary_color: null,
          tertiary_color: null,
        },
        hoist: true,
        mentionable: false,
        permissions: "0",
      },
    ]);
    expect(result.get("prata_i")).toBe(silverRoleId);
    expect(saved).toHaveLength(2);
  });

  it("mantém os rankings imediatamente acima do cargo Seguidor", async () => {
    const repository = roleRepository();
    let hierarchyBody: unknown;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/users/@me")) {
        return Response.json({ id: botId, bot: true });
      }
      if (url.endsWith(`/guilds/${discordGuildId}/roles`) && !init?.method) {
        return Response.json([
          discordRole(bronzeRoleId, levels[0]!),
          discordRole(silverRoleId, levels[1]!),
          {
            id: followerRoleId,
            name: "✔️┊Seguidor",
            color: 0,
            hoist: true,
            managed: false,
            mentionable: false,
            permissions: "0",
            position: 3,
          },
        ]);
      }
      if (
        url.endsWith(`/guilds/${discordGuildId}/roles`) &&
        init?.method === "PATCH"
      ) {
        hierarchyBody = JSON.parse(String(init.body));
        return Response.json([]);
      }
      return new Response(null, { status: 404 });
    });

    await ensureDiscordCustomerRankRoles(
      discordGuildId,
      guildId,
      repository,
      fetcher,
    );

    expect(hierarchyBody).toEqual([
      { id: bronzeRoleId, position: 4 },
      { id: silverRoleId, position: 5 },
    ]);
  });

  it("adiciona somente o nível atual e remove o cargo antigo", async () => {
    const repository = roleRepository();
    const requests: Array<{ url: string; method: string }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url.endsWith("/users/@me")) {
        return Response.json({ id: botId, bot: true });
      }
      if (url.endsWith(`/guilds/${discordGuildId}/roles`)) {
        return Response.json([
          discordRole(bronzeRoleId, levels[0]!),
          discordRole(silverRoleId, levels[1]!),
        ]);
      }
      if (url.endsWith(`/guilds/${discordGuildId}/members/${buyerDiscordId}`)) {
        return Response.json({ roles: [bronzeRoleId] });
      }
      if (method === "PUT" || method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });

    await synchronizeDiscordCustomerRankRole(
      { discordGuildId, buyerDiscordId, guildId, progress },
      repository,
      fetcher,
    );

    expect(
      requests.some(
        (request) =>
          request.method === "PUT" &&
          request.url.endsWith(
            `/guilds/${discordGuildId}/members/${buyerDiscordId}/roles/${silverRoleId}`,
          ),
      ),
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.method === "DELETE" &&
          request.url.endsWith(
            `/guilds/${discordGuildId}/members/${buyerDiscordId}/roles/${bronzeRoleId}`,
          ),
      ),
    ).toBe(true);
  });

  it("preserva o progresso de quem saiu sem provisionar ou atribuir cargos", async () => {
    const repository = roleRepository();
    const fetcher = memberFetcher({
      member: () => Response.json({ code: 10007, message: "Unknown Member" }, { status: 404 }),
    });

    await expect(synchronizeDiscordCustomerRankRole(
      { discordGuildId, buyerDiscordId, guildId }, repository, fetcher,
    )).resolves.toEqual(progress);

    expect(repository.getProgress).toHaveBeenCalledWith(guildId, buyerDiscordId);
    expect(repository.claimRoleSync).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("verifica a identidade do bot mesmo quando o comprador está ausente", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).endsWith("/users/@me")
      ? Response.json({ id: buyerDiscordId, bot: true })
      : Response.json({ code: 10007 }, { status: 404 }));

    await expect(synchronizeDiscordCustomerRankRole(
      { discordGuildId, buyerDiscordId, guildId }, roleRepository(), fetcher,
    )).rejects.toThrow("O bot autenticado não corresponde");
  });

  it.each(["PUT", "DELETE"])("tolera saída do membro durante %s do cargo", async (method) => {
    const fetcher = memberFetcher({
      mutation: (_url, actualMethod) => actualMethod === method
        ? Response.json({ code: 10007 }, { status: 404 })
        : new Response(null, { status: 204 }),
    });

    await expect(synchronizeDiscordCustomerRankRole(
      { discordGuildId, buyerDiscordId, guildId }, roleRepository(), fetcher,
    )).resolves.toEqual(progress);
    const mutations = fetcher.mock.calls.filter(([, init]) =>
      init?.method === "PUT" || init?.method === "DELETE");
    expect(mutations.map(([, init]) => init?.method)).toEqual(
      method === "PUT" ? ["PUT"] : ["PUT", "DELETE"],
    );
  });

  it.each([
    { status: 404, code: 10004 },
    { status: 404, code: 10011 },
    { status: 404, code: null },
    { status: 403, code: 10007 },
  ])("mantém falhas reais no lookup: $status / $code", async ({ status, code }) => {
    const fetcher = memberFetcher({ member: () => Response.json({ code }, { status }) });

    await expect(synchronizeDiscordCustomerRankRole(
      { discordGuildId, buyerDiscordId, guildId }, roleRepository(), fetcher,
    )).rejects.toMatchObject({ status, discordCode: code });
  });

  it.each(["PUT", "DELETE"])("mantém o 404 de cargo excluído durante %s", async (method) => {
    const fetcher = memberFetcher({
      mutation: (_url, actualMethod) => actualMethod === method
        ? Response.json({ code: 10011 }, { status: 404 })
        : new Response(null, { status: 204 }),
    });

    await expect(synchronizeDiscordCustomerRankRole(
      { discordGuildId, buyerDiscordId, guildId }, roleRepository(), fetcher,
    )).rejects.toMatchObject({ status: 404, discordCode: 10011, method });
  });

  it("não ignora erros de outra rota durante o provisionamento", async () => {
    const fetcher = memberFetcher({
      roles: () => Response.json({ code: 10007 }, { status: 404 }),
    });

    await expect(synchronizeDiscordCustomerRankRole(
      { discordGuildId, buyerDiscordId, guildId }, roleRepository(), fetcher,
    )).rejects.toMatchObject({ path: `/guilds/${discordGuildId}/roles`, discordCode: 10007 });
  });

  it("atribui o ranking salvo quando o comprador retorna ao servidor", async () => {
    const member = vi.fn()
      .mockImplementationOnce(() => Response.json({ code: 10007 }, { status: 404 }))
      .mockImplementation(() => Response.json({ roles: [bronzeRoleId] }));
    const fetcher = memberFetcher({ member });
    const repository = roleRepository();
    const input = { discordGuildId, buyerDiscordId, guildId };

    await synchronizeDiscordCustomerRankRole(input, repository, fetcher);
    await synchronizeDiscordCustomerRankRole(input, repository, fetcher);

    expect(repository.getProgress).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url, init]) =>
      init?.method === "PUT" && String(url).endsWith(`/roles/${silverRoleId}`),
    )).toBe(true);
  });
});

function memberFetcher(overrides: {
  member?: () => Response;
  roles?: () => Response;
  mutation?: (url: string, method: string) => Response;
} = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith(`/guilds/${discordGuildId}/members/${buyerDiscordId}`)) {
      return overrides.member?.() ?? Response.json({ roles: [bronzeRoleId] });
    }
    if (method === "PUT" || method === "DELETE") {
      return overrides.mutation?.(url, method) ?? new Response(null, { status: 204 });
    }
    if (url.endsWith("/users/@me")) return Response.json({ id: botId, bot: true });
    if (url.endsWith(`/guilds/${discordGuildId}/roles`)) {
      return overrides.roles?.() ?? Response.json([
        discordRole(bronzeRoleId, levels[0]!), discordRole(silverRoleId, levels[1]!),
      ]);
    }
    return new Response(null, { status: 404 });
  });
}

function roleRepository(
  overrides: Partial<CustomerRankRoleRepository> = {},
): CustomerRankRoleRepository {
  return {
    findGuildId: vi.fn(async () => guildId),
    getProgress: vi.fn(async () => progress),
    listLevels: vi.fn(async () => levels),
    listRoleBindings: vi.fn(async () => [
      { rankCode: "bronze_i", discordRoleId: bronzeRoleId },
      { rankCode: "prata_i", discordRoleId: silverRoleId },
    ]),
    saveRoleBinding: vi.fn(async () => undefined),
    claimRoleSync: vi.fn(async () => true),
    releaseRoleSync: vi.fn(async () => undefined),
    ...overrides,
  };
}

function discordRole(id: string, level: CustomerRankLevel) {
  return {
    id,
    name: level.roleName,
    color: level.color,
    hoist: true,
    managed: false,
    mentionable: false,
    permissions: "0",
    position: level.sortOrder === 1 ? 1 : 2,
  };
}
