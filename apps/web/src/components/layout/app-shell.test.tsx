import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/pedidos" }));
vi.mock("@/components/admin/admin-live-refresh", () => ({ AdminLiveRefresh: () => null }));
vi.mock("./brand", () => ({ Brand: () => <span>GWStore</span> }));
import { AppShell } from "./app-shell";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("menu do painel", () => {
  it("abre como diálogo, permite buscar uma área e fecha ao pressionar Escape", async () => {
    const user = userEvent.setup();
    render(<AppShell identity={{ displayName: "Admin de teste", discordId: "111111111111111111" }}><h1>Pedidos</h1></AppShell>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    const dialog = screen.getByRole("dialog", { name: "Menu móvel" });
    await user.type(within(dialog).getByRole("searchbox"), "estoque");
    expect(within(dialog).getByRole("link", { name: "Estoque por loja" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Pedidos" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });
});
