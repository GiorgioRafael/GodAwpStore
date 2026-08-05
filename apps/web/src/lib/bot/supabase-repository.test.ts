import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseBotCommerceRepository } from "./supabase-repository";

function queryReturning(result: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    update: vi.fn(() => query),
  };
  return query;
}

function queryReturningSequence(results: unknown[]) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    maybeSingle: vi.fn(async () => results.shift()),
    update: vi.fn(() => query),
  };
  return query;
}

describe("SupabaseBotCommerceRepository.ensureGuild", () => {
  it("reutiliza o cadastro ativo quando a identidade do servidor não mudou", async () => {
    const whitelistQuery = queryReturning({
      data: { id: "15c5caff-a349-4ca8-9955-f5a069caa956" },
      error: null,
    });
    const guildQuery = queryReturning({
      data: {
        id: "6b272381-d0c0-46bd-83da-71061770549f",
        owner_discord_id: "949355341353721868",
        whitelist_entry_id: "15c5caff-a349-4ca8-9955-f5a069caa956",
        name: "THStore",
        status: "active",
        configuration: {},
        archived_at: null,
        left_at: null,
        last_bot_seen_at: "2999-01-01T00:00:00.000Z",
      },
      error: null,
    });
    const client = {
      from: vi.fn((table: string) =>
        table === "whitelist_entries" ? whitelistQuery : guildQuery,
      ),
    };
    const repository = new SupabaseBotCommerceRepository(client as never);

    await expect(
      repository.ensureGuild({
        discordGuildId: "1319006069611302932",
        ownerDiscordId: "949355341353721868",
        name: "THStore",
      }),
    ).resolves.toMatchObject({
      id: "6b272381-d0c0-46bd-83da-71061770549f",
      whitelistEntryId: "15c5caff-a349-4ca8-9955-f5a069caa956",
    });
    expect(guildQuery.update).not.toHaveBeenCalled();
  });

  it("mantém o checkout funcionando quando a base ainda não possui a coluna de heartbeat", async () => {
    const whitelistQuery = queryReturning({
      data: { id: "15c5caff-a349-4ca8-9955-f5a069caa956" },
      error: null,
    });
    const guildQuery = queryReturningSequence([
      {
        data: null,
        error: {
          code: "42703",
          message: "column guilds.last_bot_seen_at does not exist",
        },
      },
      {
        data: {
          id: "6b272381-d0c0-46bd-83da-71061770549f",
          owner_discord_id: "949355341353721868",
          whitelist_entry_id: "15c5caff-a349-4ca8-9955-f5a069caa956",
          name: "THStore",
          status: "active",
          configuration: {},
          archived_at: null,
          left_at: null,
        },
        error: null,
      },
    ]);
    const client = {
      from: vi.fn((table: string) =>
        table === "whitelist_entries" ? whitelistQuery : guildQuery,
      ),
    };
    const repository = new SupabaseBotCommerceRepository(client as never);

    await expect(
      repository.ensureGuild({
        discordGuildId: "1319006069611302932",
        ownerDiscordId: "949355341353721868",
        name: "THStore",
      }),
    ).resolves.toMatchObject({
      id: "6b272381-d0c0-46bd-83da-71061770549f",
      whitelistEntryId: "15c5caff-a349-4ca8-9955-f5a069caa956",
    });
    expect(guildQuery.update).not.toHaveBeenCalled();
  });
});
