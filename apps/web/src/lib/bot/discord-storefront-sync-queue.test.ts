import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  drainDiscordStorefrontSyncQueue,
  requestDiscordStorefrontSync,
  type DiscordStorefrontSyncQueueRepository,
} from "./discord-storefront-sync-queue";

const orderId = "9a845b40-7c4e-4d25-9f3f-3cbd27f050c9";

describe("fila de sincronização da vitrine Discord", () => {
  it("registra uma solicitação idempotente por pedido pago", async () => {
    const repository = queueRepository();
    repository.request.mockResolvedValue(true);

    await expect(
      requestDiscordStorefrontSync(orderId, repository),
    ).resolves.toBe(true);
    expect(repository.request).toHaveBeenCalledWith(orderId);
  });

  it("coalesce vários pagamentos em uma única atualização global", async () => {
    const repository = queueRepository();
    repository.claim.mockResolvedValueOnce(12).mockResolvedValueOnce(0);
    repository.complete.mockResolvedValue(true);
    const synchronize = vi.fn(async () => ({
      published: 2,
      failed: 0,
      productEmojiFailures: 0,
    }));

    await expect(
      drainDiscordStorefrontSyncQueue({ repository, synchronize }),
    ).resolves.toEqual({ claimed: 12, passes: 1, published: 2 });

    expect(synchronize).toHaveBeenCalledOnce();
    expect(repository.complete).toHaveBeenCalledWith({
      claimToken: expect.any(String),
      success: true,
      error: null,
    });
  });

  it("devolve o lote à fila quando alguma vitrine falha", async () => {
    const repository = queueRepository();
    repository.claim.mockResolvedValueOnce(3);
    repository.complete.mockResolvedValue(true);
    const synchronize = vi.fn(async () => ({
      published: 1,
      failed: 1,
      productEmojiFailures: 0,
    }));

    await expect(
      drainDiscordStorefrontSyncQueue({ repository, synchronize }),
    ).rejects.toThrow("1 vitrine(s) não foram sincronizadas");

    expect(repository.complete).toHaveBeenCalledWith({
      claimToken: expect.any(String),
      success: false,
      error: "1 vitrine(s) não foram sincronizadas.",
    });
    expect(repository.claim).toHaveBeenCalledOnce();
  });

  it("não executa fanout quando outro worker já possui o lease", async () => {
    const repository = queueRepository();
    repository.claim.mockResolvedValue(0);
    const synchronize = vi.fn();

    await expect(
      drainDiscordStorefrontSyncQueue({ repository, synchronize }),
    ).resolves.toEqual({ claimed: 0, passes: 0, published: 0 });
    expect(synchronize).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });
});

function queueRepository() {
  return {
    request:
      vi.fn<DiscordStorefrontSyncQueueRepository["request"]>(),
    claim:
      vi.fn<DiscordStorefrontSyncQueueRepository["claim"]>(),
    complete:
      vi.fn<DiscordStorefrontSyncQueueRepository["complete"]>(),
  };
}
