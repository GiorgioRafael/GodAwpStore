import { describe, expect, it, vi } from "vitest";

import { retryWorkerTask } from "./worker.js";

describe("retryWorkerTask", () => {
  it("repete uma falha transitória sem executar tentativas extras", async () => {
    const task = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Supabase indisponível"))
      .mockResolvedValue(undefined);
    const wait = vi.fn(async () => undefined);

    await retryWorkerTask(task, { wait });

    expect(task).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(350);
  });

  it("propaga a falha permanente depois do limite", async () => {
    const task = vi.fn(async () => {
      throw new Error("falha permanente");
    });
    const wait = vi.fn(async () => undefined);

    await expect(retryWorkerTask(task, { attempts: 3, wait })).rejects.toThrow(
      "falha permanente",
    );
    expect(task).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
