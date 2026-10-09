import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeliveryLogPage from "@/app/(admin)/entregas/page";

const routing = vi.hoisted(() => ({ isGwStore: true, redirect: vi.fn(), listDeliveryLog: vi.fn() }));
vi.mock("@/lib/brand", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/brand")>(),
  get IS_GWSTORE() { return routing.isGwStore; },
}));
vi.mock("@/lib/data/admin-repository", () => ({ listDeliveryLog: routing.listDeliveryLog }));
vi.mock("next/navigation", () => ({ redirect: routing.redirect }));

beforeEach(() => {
  vi.clearAllMocks();
  routing.redirect.mockImplementation(() => { throw new Error("redirect"); });
});

describe("navegação do registro de entregas", () => {
  it.each([[true, "/admin"], [false, ""]] as const)(
    "mantém a paginação no painel da loja (GW=%s)", async (isGwStore, prefix) => {
      routing.isGwStore = isGwStore;
      routing.listDeliveryLog.mockResolvedValue({ rows: [], total: 101, page: 2, pageSize: 50, totalPages: 3 });
      render(await DeliveryLogPage({ searchParams: Promise.resolve({ page: "2" }) }));
      expect(screen.getByRole("link", { name: "Anterior" })).toHaveAttribute("href", `${prefix}/entregas`);
      expect(screen.getByRole("link", { name: "Próxima" })).toHaveAttribute("href", `${prefix}/entregas?page=3`);
      expect(routing.listDeliveryLog).toHaveBeenCalledWith({ page: 2, pageSize: 50 });
    },
  );

  it.each([[true, "/admin"], [false, ""]] as const)(
    "corrige página fora do limite para a URL da loja (GW=%s)", async (isGwStore, prefix) => {
      routing.isGwStore = isGwStore;
      routing.listDeliveryLog.mockResolvedValue({ rows: [], total: 51, page: 99, pageSize: 50, totalPages: 2 });
      await expect(DeliveryLogPage({ searchParams: Promise.resolve({ page: "99" }) })).rejects.toThrow("redirect");
      expect(routing.redirect).toHaveBeenCalledWith(`${prefix}/entregas?page=2`);
    },
  );
});
