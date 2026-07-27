import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getAdminSession } = vi.hoisted(() => ({ getAdminSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAdminSession }));

import { getRouletteOverlayLink } from "./overlay-link";

const ORIGINAL_TOKEN = process.env.ROULETTE_OVERLAY_TOKEN;
const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  getAdminSession.mockResolvedValue({ status: "authorized", identity: { discordId: "1" } });
  process.env.ROULETTE_OVERLAY_TOKEN = "  token-secreto  ";
  process.env.NEXT_PUBLIC_SITE_URL = "https://gwstore.vercel.app";
});

afterEach(() => {
  vi.clearAllMocks();
  restore("ROULETTE_OVERLAY_TOKEN", ORIGINAL_TOKEN);
  restore("NEXT_PUBLIC_SITE_URL", ORIGINAL_SITE_URL);
});

describe("link do overlay", () => {
  it("monta o endereço com o token já sem espaços", async () => {
    const link = await getRouletteOverlayLink();

    expect(link.status).toBe("ready");
    const url = new URL(link.status === "ready" ? link.url : "");
    expect(url.origin).toBe("https://gwstore.vercel.app");
    expect(url.pathname).toBe("/roleta/overlay");
    expect(url.searchParams.get("token")).toBe("token-secreto");
  });

  it("nunca monta o link sem sessão de administrador autorizada", async () => {
    // O redirect do layout não impede a página de renderizar: um GET anônimo a
    // uma rota (admin) responde 307 mas ainda carrega o corpo daquela página.
    // As outras páginas escapam porque os dados delas passam por RLS; este
    // token vem do ambiente, então a checagem tem que morar aqui.
    for (const status of ["unauthenticated", "unauthorized", "unconfigured", "error"]) {
      getAdminSession.mockResolvedValue({ status, identity: null });
      await expect(getRouletteOverlayLink()).resolves.toEqual({ status: "forbidden" });
    }
  });

  it("não lê o token do ambiente antes de checar a sessão", async () => {
    getAdminSession.mockResolvedValue({ status: "unauthenticated", identity: null });
    process.env.ROULETTE_OVERLAY_TOKEN = "nao-pode-vazar";

    const link = await getRouletteOverlayLink();

    expect(JSON.stringify(link)).not.toContain("nao-pode-vazar");
  });

  it("não inventa um link quando o token não está configurado", async () => {
    // A página do overlay devolve 404 sem token; o painel tem que dizer isso
    // em vez de entregar um endereço que nunca vai abrir.
    delete process.env.ROULETTE_OVERLAY_TOKEN;
    await expect(getRouletteOverlayLink()).resolves.toEqual({
      status: "unconfigured",
      missing: "token",
    });

    process.env.ROULETTE_OVERLAY_TOKEN = "   ";
    await expect(getRouletteOverlayLink()).resolves.toEqual({
      status: "unconfigured",
      missing: "token",
    });
  });

  it("sobrevive a uma origem ausente em produção", async () => {
    // getSiteUrl lança sem NEXT_PUBLIC_SITE_URL em produção, e isso não pode
    // derrubar a página inteira de métricas.
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_SITE_URL;

    await expect(getRouletteOverlayLink()).resolves.toEqual({
      status: "unconfigured",
      missing: "site-url",
    });

    vi.unstubAllEnvs();
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
