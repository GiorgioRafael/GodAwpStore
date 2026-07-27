import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RouletteOverlayLink } from "./roulette-overlay-link";

const TOKEN = "0123456789abcdef0123456789abcdef";
const OVERLAY = `https://gwstore.vercel.app/roleta/overlay?token=${TOKEN}`;

function field() {
  return screen.getByLabelText("Endereço do overlay") as HTMLInputElement;
}

/** jsdom exposes navigator.clipboard through a getter only. */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("link do overlay no painel", () => {
  it("esconde o token até o administrador pedir para ver", async () => {
    const user = userEvent.setup();
    render(<RouletteOverlayLink overlayUrl={OVERLAY} />);

    expect(field().value).not.toContain(TOKEN);
    expect(field().value).toContain("/roleta/overlay");

    await user.click(screen.getByRole("button", { name: "Mostrar o token" }));
    expect(field().value).toBe(OVERLAY);
  });

  it("mascara sem revelar o tamanho do token, mesmo se ele for curto", () => {
    const { rerender } = render(<RouletteOverlayLink overlayUrl={OVERLAY} />);
    const long = field().value;

    rerender(
      <RouletteOverlayLink overlayUrl="https://gwstore.vercel.app/roleta/overlay?token=ab" />,
    );
    const short = field().value;

    // Um token curto não pode aparecer inteiro na tela.
    expect(short).not.toContain("token=ab&");
    expect(short.endsWith("ab")).toBe(false);
    // E as duas máscaras têm o mesmo comprimento de pontos.
    expect(short.match(/•+/)?.[0]).toBe(long.match(/•+/)?.[0]);
  });

  it("copia o endereço de verdade, nunca a máscara", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    stubClipboard(writeText);

    render(<RouletteOverlayLink overlayUrl={OVERLAY} />);
    await user.click(screen.getByRole("button", { name: /Copiar/ }));

    expect(writeText).toHaveBeenCalledWith(OVERLAY);
    await waitFor(() => expect(screen.getByRole("button", { name: /Copiado/ })).toBeTruthy());
  });

  it("escreve a fila no link e some com ela no valor padrão", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    stubClipboard(writeText);

    render(<RouletteOverlayLink overlayUrl={OVERLAY} />);
    await user.selectOptions(screen.getByLabelText("Fila de animações"), "20");
    await user.click(screen.getByRole("button", { name: /Copiar/ }));

    expect(writeText).toHaveBeenCalledWith(`${OVERLAY}&fila=20`);

    await user.selectOptions(screen.getByLabelText("Fila de animações"), "8");
    await user.click(screen.getByRole("button", { name: /Copiar|Copiado/ }));
    expect(writeText).toHaveBeenLastCalledWith(OVERLAY);
  });

  it("revela o endereço quando a área de transferência é negada", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const user = userEvent.setup();
    stubClipboard(writeText);

    render(<RouletteOverlayLink overlayUrl={OVERLAY} />);
    await user.click(screen.getByRole("button", { name: /Copiar/ }));

    // Sem cópia automática, o operador precisa conseguir selecionar à mão.
    await waitFor(() => expect(field().value).toBe(OVERLAY));
  });
});
