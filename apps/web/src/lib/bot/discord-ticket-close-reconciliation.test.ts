import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(() => null),
}));

import {
  reconcileDiscordTicketCloseClaims,
  type DiscordTicketCloseReconciliationCandidate,
  type DiscordTicketCloseReconciliationRepository,
} from "./discord-ticket-close-reconciliation";

const now = Date.parse("2026-07-19T18:00:00.000Z");
const candidate: DiscordTicketCloseReconciliationCandidate = {
  orderId: "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9",
  ticketChannelId: "323456789012345678",
  claimToken: "6bc34461-3e2d-4af2-bd2d-b42150704897",
  claimedAt: new Date(now - 6 * 60 * 1_000).toISOString(),
};

beforeEach(() => {
  vi.stubEnv("DISCORD_BOT_TOKEN", "discord-bot-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Discord ticket close reconciliation", () => {
  it("conclui com o mesmo token quando o canal retorna 404", async () => {
    const repository = fakeRepository([candidate]);
    const fetcher = vi.fn(async () =>
      Response.json({ code: 10003, message: "Unknown Channel" }, { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toEqual({
      scanned: 1,
      completed: 1,
      alreadyClosed: 0,
      released: 0,
      superseded: 0,
      active: 0,
      failed: 0,
    });

    expect(repository.complete).toHaveBeenCalledWith(candidate);
    expect(repository.release).not.toHaveBeenCalled();
  });

  it("libera somente uma reserva expirada quando o canal ainda existe", async () => {
    const repository = fakeRepository([candidate]);
    const fetcher = channelFetcher();

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({ scanned: 1, released: 1, active: 0, failed: 0 });

    expect(repository.release).toHaveBeenCalledWith({
      orderId: candidate.orderId,
      claimToken: candidate.claimToken,
    });
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("preserva uma reserva ativa quando o canal ainda existe", async () => {
    const activeCandidate = {
      ...candidate,
      claimedAt: new Date(now - 4 * 60 * 1_000).toISOString(),
    };
    const repository = fakeRepository([activeCandidate]);

    await expect(
      reconcileDiscordTicketCloseClaims({
        repository,
        fetcher: channelFetcher(),
        now: () => now,
      }),
    ).resolves.toMatchObject({ scanned: 1, active: 1, released: 0, failed: 0 });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
  });

  it("e idempotente depois que a primeira execucao conclui o pedido", async () => {
    let pending = true;
    const repository = fakeRepository([]);
    repository.listClaims.mockImplementation(async () => (pending ? [candidate] : []));
    repository.complete.mockImplementation(async () => {
      pending = false;
      return true;
    });
    const fetcher = vi.fn(async () =>
      Response.json({ code: 10003, message: "Unknown Channel" }, { status: 404 }),
    ) as unknown as typeof fetch;

    const first = await reconcileDiscordTicketCloseClaims({
      repository,
      fetcher,
      now: () => now,
    });
    const second = await reconcileDiscordTicketCloseClaims({
      repository,
      fetcher,
      now: () => now,
    });

    expect(first).toMatchObject({ scanned: 1, completed: 1, failed: 0 });
    expect(second).toMatchObject({ scanned: 0, completed: 0, failed: 0 });
    expect(repository.complete).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("isola falhas do Discord sem liberar a evidencia da reserva", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const repository = fakeRepository([candidate]);
    const fetcher = vi.fn(async () =>
      Response.json({ message: "Discord unavailable" }, { status: 503 }),
    ) as unknown as typeof fetch;

    await expect(
      reconcileDiscordTicketCloseClaims({ repository, fetcher, now: () => now }),
    ).resolves.toMatchObject({ scanned: 1, failed: 1, completed: 0, released: 0 });

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.release).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(candidate.orderId));
  });
});

function fakeRepository(
  claims: DiscordTicketCloseReconciliationCandidate[],
): DiscordTicketCloseReconciliationRepository & {
  listClaims: ReturnType<
    typeof vi.fn<DiscordTicketCloseReconciliationRepository["listClaims"]>
  >;
  complete: ReturnType<
    typeof vi.fn<DiscordTicketCloseReconciliationRepository["complete"]>
  >;
  release: ReturnType<
    typeof vi.fn<DiscordTicketCloseReconciliationRepository["release"]>
  >;
} {
  return {
    listClaims: vi.fn(async () => claims),
    complete: vi.fn(async () => true),
    release: vi.fn(async () => true),
  };
}

function channelFetcher() {
  return vi.fn(async () =>
    Response.json({ id: candidate.ticketChannelId, type: 0 }),
  ) as unknown as typeof fetch;
}
