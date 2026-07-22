import "server-only";

import {
  assertConfiguredDiscordBotIdentity,
  discordBotJson,
  discordBotRequest,
} from "./discord-api";
import type { CustomerRankLevel, CustomerRankProgress } from "./customer-rank";
import {
  SupabaseCustomerRankRepository,
  type CustomerRankRoleBinding,
} from "./customer-rank-repository";

const SNOWFLAKE_PATTERN = /^[0-9]{15,22}$/;

type DiscordRole = {
  id: string;
  name: string;
  color: number;
  hoist: boolean;
  managed: boolean;
  mentionable: boolean;
  permissions: string;
  position: number;
};

type DiscordGuildMember = {
  roles?: unknown;
};

export type CustomerRankRoleRepository = {
  findGuildId(discordGuildId: string): Promise<string | null>;
  getProgress(guildId: string, buyerDiscordId: string): Promise<CustomerRankProgress>;
  listLevels(): Promise<CustomerRankLevel[]>;
  listRoleBindings(guildId: string): Promise<CustomerRankRoleBinding[]>;
  saveRoleBinding(
    guildId: string,
    rankCode: string,
    discordRoleId: string,
  ): Promise<void>;
  claimRoleSync(guildId: string, claimToken: string): Promise<boolean>;
  releaseRoleSync(
    guildId: string,
    claimToken: string,
    succeeded: boolean,
    errorMessage: string | null,
  ): Promise<void>;
};

export async function synchronizeDiscordCustomerRankRole(
  input: {
    discordGuildId: string;
    buyerDiscordId: string;
    guildId?: string;
    progress?: CustomerRankProgress;
  },
  repository: CustomerRankRoleRepository = new SupabaseCustomerRankRepository(),
  fetcher: typeof fetch = fetch,
) {
  if (
    !SNOWFLAKE_PATTERN.test(input.discordGuildId) ||
    !SNOWFLAKE_PATTERN.test(input.buyerDiscordId)
  ) {
    throw new Error("Servidor ou usuário Discord inválido para sincronizar o ranking.");
  }

  const guildId = input.guildId ?? await repository.findGuildId(input.discordGuildId);
  if (!guildId) throw new Error("Servidor ativo não encontrado para sincronizar o ranking.");

  const [progress, roleIdsByRank] = await Promise.all([
    input.progress ?? repository.getProgress(guildId, input.buyerDiscordId),
    ensureDiscordCustomerRankRoles(
      input.discordGuildId,
      guildId,
      repository,
      fetcher,
    ),
  ]);

  const member = await discordBotJson<DiscordGuildMember>(
    `/guilds/${input.discordGuildId}/members/${input.buyerDiscordId}`,
    {},
    fetcher,
  );
  const memberRoleIds = new Set(
    Array.isArray(member.roles)
      ? member.roles.filter(
          (roleId): roleId is string =>
            typeof roleId === "string" && SNOWFLAKE_PATTERN.test(roleId),
        )
      : [],
  );
  const currentRoleId = progress.currentRank
    ? roleIdsByRank.get(progress.currentRank.code) ?? null
    : null;

  if (progress.currentRank && !currentRoleId) {
    throw new Error(`Cargo do ranking ${progress.currentRank.name} não foi provisionado.`);
  }

  // Add the new role before removing an older one, avoiding a visible gap.
  if (currentRoleId && !memberRoleIds.has(currentRoleId)) {
    await requireDiscordSuccess(
      `/guilds/${input.discordGuildId}/members/${input.buyerDiscordId}/roles/${currentRoleId}`,
      { method: "PUT" },
      fetcher,
    );
  }

  const obsoleteRoleIds = [...roleIdsByRank.values()].filter(
    (roleId) => roleId !== currentRoleId && memberRoleIds.has(roleId),
  );
  await Promise.all(
    obsoleteRoleIds.map((roleId) =>
      requireDiscordSuccess(
        `/guilds/${input.discordGuildId}/members/${input.buyerDiscordId}/roles/${roleId}`,
        { method: "DELETE" },
        fetcher,
      ),
    ),
  );

  return progress;
}

export async function ensureDiscordCustomerRankRoles(
  discordGuildId: string,
  guildId: string,
  repository: Pick<
    CustomerRankRoleRepository,
    | "listLevels"
    | "listRoleBindings"
    | "saveRoleBinding"
    | "claimRoleSync"
    | "releaseRoleSync"
  >,
  fetcher: typeof fetch = fetch,
) {
  if (!SNOWFLAKE_PATTERN.test(discordGuildId)) {
    throw new Error("Servidor Discord inválido para provisionar os cargos de ranking.");
  }

  const claimToken = crypto.randomUUID();
  let claimed = false;
  for (let attempt = 0; attempt < 9 && !claimed; attempt += 1) {
    claimed = await repository.claimRoleSync(guildId, claimToken);
    if (!claimed && attempt < 8) await wait(250);
  }
  if (!claimed) {
    throw new Error("A sincronização dos cargos de ranking já está em andamento.");
  }

  try {
    const roleIds = await provisionDiscordCustomerRankRoles(
      discordGuildId,
      guildId,
      repository,
      fetcher,
    );
    await repository.releaseRoleSync(guildId, claimToken, true, null);
    return roleIds;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido no Discord.";
    await repository
      .releaseRoleSync(guildId, claimToken, false, message)
      .catch(() => undefined);
    throw error;
  }
}

async function provisionDiscordCustomerRankRoles(
  discordGuildId: string,
  guildId: string,
  repository: Pick<
    CustomerRankRoleRepository,
    "listLevels" | "listRoleBindings" | "saveRoleBinding"
  >,
  fetcher: typeof fetch,
) {
  await assertConfiguredDiscordBotIdentity(fetcher);
  const [levels, bindings, discordRoles] = await Promise.all([
    repository.listLevels(),
    repository.listRoleBindings(guildId),
    discordBotJson<DiscordRole[]>(`/guilds/${discordGuildId}/roles`, {}, fetcher),
  ]);
  if (levels.length === 0) throw new Error("Nenhum nível de ranking foi configurado.");

  const roles = discordRoles.filter(isDiscordRole);
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const bindingByRank = new Map(bindings.map((binding) => [binding.rankCode, binding]));
  const roleIdsByRank = new Map<string, string>();

  // Provision from highest to lowest, then place only these roles in their
  // final contiguous order above @everyone.
  const provisioningOrder = [...levels].sort(
    (left, right) => right.sortOrder - left.sortOrder,
  );
  for (const level of provisioningOrder) {
    const boundRoleId = bindingByRank.get(level.code)?.discordRoleId;
    let role = boundRoleId ? roleById.get(boundRoleId) : undefined;
    role ??= roles.find((candidate) => !candidate.managed && candidate.name === level.roleName);

    if (!role) {
      role = await discordBotJson<DiscordRole>(
        `/guilds/${discordGuildId}/roles`,
        {
          method: "POST",
          body: JSON.stringify(roleConfiguration(level)),
        },
        fetcher,
      );
      if (!isDiscordRole(role)) {
        throw new Error(`Discord retornou um cargo inválido para ${level.name}.`);
      }
      roles.push(role);
      roleById.set(role.id, role);
    } else if (!roleMatchesLevel(role, level)) {
      role = await discordBotJson<DiscordRole>(
        `/guilds/${discordGuildId}/roles/${role.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(roleConfiguration(level)),
        },
        fetcher,
      );
      if (!isDiscordRole(role)) {
        throw new Error(`Discord retornou um cargo inválido para ${level.name}.`);
      }
      roleById.set(role.id, role);
    }

    await repository.saveRoleBinding(guildId, level.code, role.id);
    roleIdsByRank.set(level.code, role.id);
  }

  const hierarchy = [...levels]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((level, index) => ({
      id: roleIdsByRank.get(level.code)!,
      position: index + 1,
    }));
  if (
    hierarchy.some(
      (entry) => roleById.get(entry.id)?.position !== entry.position,
    )
  ) {
    await discordBotJson<DiscordRole[]>(
      `/guilds/${discordGuildId}/roles`,
      { method: "PATCH", body: JSON.stringify(hierarchy) },
      fetcher,
    );
  }

  return roleIdsByRank;
}

function roleConfiguration(level: CustomerRankLevel) {
  return {
    name: level.roleName,
    colors: {
      primary_color: level.color,
      secondary_color: null,
      tertiary_color: null,
    },
    hoist: true,
    mentionable: false,
    permissions: "0",
  };
}

function roleMatchesLevel(role: DiscordRole, level: CustomerRankLevel) {
  return (
    !role.managed &&
    role.name === level.roleName &&
    role.color === level.color &&
    role.hoist === true &&
    role.mentionable === false &&
    role.permissions === "0"
  );
}

function isDiscordRole(value: unknown): value is DiscordRole {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    SNOWFLAKE_PATTERN.test(value.id) &&
    typeof value.name === "string" &&
    typeof value.color === "number" &&
    Number.isSafeInteger(value.color) &&
    typeof value.hoist === "boolean" &&
    typeof value.managed === "boolean" &&
    typeof value.mentionable === "boolean" &&
    typeof value.permissions === "string" &&
    typeof value.position === "number" &&
    Number.isSafeInteger(value.position)
  );
}

async function requireDiscordSuccess(
  path: string,
  init: RequestInit,
  fetcher: typeof fetch,
) {
  const response = await discordBotRequest(path, init, fetcher);
  if (!response.ok) {
    throw new Error(`Discord recusou a sincronização do cargo (${response.status}).`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
