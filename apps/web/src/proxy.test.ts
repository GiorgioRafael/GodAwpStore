import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  gwStore: true,
  refreshCookies: false,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (cookies: Array<{ name: string; value: string }>) => void } }) => ({ auth: {
    getUser: async () => {
      if (mocks.refreshCookies) options.cookies.setAll([{ name: "sb-refreshed", value: "session" }]);
      return mocks.getUser();
    },
  } }),
}));

vi.mock("@/lib/brand", () => ({ get IS_GWSTORE() { return mocks.gwStore; } }));
vi.mock("@/lib/auth-identity", () => ({
  extractDiscordIdentity: (user: { id: string }) => ({ discordId: user.id }),
  extractGoogleIdentity: (user: { provider?: string }) => user.provider === "google" ? { email: "admin@example.com" } : null,
  parseAdminDiscordIds: () => new Set(["admin"]),
  parseMasterAdminGoogleEmails: () => new Set(["admin@example.com"]),
}));

import { proxy } from "./proxy";

describe("link de pagamento compartilhado com compradores", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
    vi.stubEnv("RAILWAY_SERVICE_ID", "");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "");
    mocks.getUser.mockReset();
    mocks.gwStore = true;
    mocks.refreshCookies = false;
  });

  afterEach(() => vi.unstubAllEnvs());

  it("delega sessão e rotas legadas à Railway sem alterar o URL na ponte Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "https://gwstore-web-production.up.railway.app");
    for (const host of ["gwstore.vercel.app", "gwstoreofc.com", "www.gwstoreofc.com"]) {
      for (const method of ["GET", "POST"]) {
        for (const path of ["/admin/pedidos?status=paid", "/pedidos", "/auth/callback?code=oauth-code", "/api/webhooks/discord"]) {
          const response = await proxy(new NextRequest(`https://${host}${path}`, { method, headers: {
            "x-gwstore-public-host": "101devs.com", "x-forwarded-host": "evil.example",
            authorization: "Bearer original", "content-type": "application/json",
          } }));
          expect(response.headers.get("x-middleware-next")).toBe("1");
          expect(response.headers.get("location")).toBeNull();
          expect(response.headers.get("x-middleware-rewrite")).toBeNull();
          expect(response.headers.get("x-middleware-request-x-gwstore-public-host")).toBe(host);
          expect(response.headers.get("x-middleware-request-authorization")).toBe("Bearer original");
          expect(response.headers.get("x-middleware-request-content-type")).toBe("application/json");
        }
      }
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("não consome nem altera o corpo assinado ou a query ao fixar a origem pública", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "https://gwstore-web-production.up.railway.app");
    const body = '{ "paid": true, "value": 5.00, "item": "🍎" }\n';
    const url = "https://gwstore.vercel.app/api/webhooks/payment?code=a%2Bb&tag=one&tag=two";
    const request = new NextRequest(url, {
      method: "POST", body, headers: {
        "x-gwstore-public-host": "evil.example",
        "x-signature": "signed-original-bytes",
        "content-length": String(new TextEncoder().encode(body).length),
      },
    });
    const response = await proxy(request);
    expect(request.url).toBe(url);
    expect(request.bodyUsed).toBe(false);
    expect(await request.text()).toBe(body);
    expect(response.headers.get("x-middleware-request-x-gwstore-public-host")).toBe("gwstore.vercel.app");
    expect(response.headers.get("x-middleware-request-x-signature")).toBe("signed-original-bytes");
    expect(response.headers.get("x-middleware-request-content-length")).toBe(String(new TextEncoder().encode(body).length));
  });

  it("preserva os gates mestre, TH e hosts desconhecidos com a ponte ativa", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "https://gwstore-web-production.up.railway.app");
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    for (const host of ["101devs.com", "thstore.vercel.app", "evil.example"]) {
      const response = await proxy(new NextRequest(`https://${host}/admin`, {
        headers: { "x-forwarded-host": "gwstoreofc.com", "x-gwstore-public-host": "gwstoreofc.com" },
      }));
      expect(response.headers.get("location")).not.toBeNull();
      expect(response.headers.get("x-middleware-next")).toBeNull();
      expect(response.headers.get("x-middleware-request-x-gwstore-public-host")).toBeNull();
    }
    expect(mocks.getUser).toHaveBeenCalledTimes(3);
    mocks.gwStore = false;
    const th = await proxy(new NextRequest("https://gwstoreofc.com/pedidos"));
    expect(new URL(th.headers.get("location")!).pathname).toBe("/login");
  });

  it("mantém o cron local e não aplica a ponte a uma origem inválida", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "https://gwstore-web-production.up.railway.app");
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const cron = await proxy(new NextRequest("https://gwstore.vercel.app/api/cron/discord-top-spenders"));
    expect(cron.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.getUser).toHaveBeenCalledOnce();
    vi.stubEnv("GWSTORE_RAILWAY_ORIGIN", "https://other-store.up.railway.app");
    const panel = await proxy(new NextRequest("https://gwstoreofc.com/admin/pedidos"));
    expect(new URL(panel.headers.get("location")!).pathname).toBe("/login");
  });

  it("usa o host público nos redirects Railway e mantém as reescritas no backend", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "railway-environment");
    vi.stubEnv("RAILWAY_SERVICE_ID", "railway-service");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "gwstore-web-production.up.railway.app");
    const railway = "https://gwstore-web-production.up.railway.app";
    const headers = { host: "gwstore-web-production.up.railway.app", "x-forwarded-host": "gwstore.vercel.app", "x-forwarded-proto": "https" };
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const legacy = await proxy(new NextRequest(`${railway}/pedidos?status=paid&page=2`, { headers }));
    expect(legacy.headers.get("location")).toBe("https://gwstore.vercel.app/admin/pedidos?status=paid&page=2");
    const login = await proxy(new NextRequest(`${railway}/admin/pedidos?status=paid`, { headers }));
    const target = new URL(login.headers.get("location")!);
    expect(target.origin).toBe("https://gwstore.vercel.app");
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("next")).toBe("/admin/pedidos?status=paid");
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
    const internal = await proxy(new NextRequest(`${railway}/admin/pedidos?status=paid`, { headers }));
    expect(internal.headers.get("location")).toBeNull();
    expect(internal.headers.get("x-middleware-rewrite")).toBe(`${railway}/pedidos?status=paid`);
  });

  it("leva visitante sem sessão do relatório ao formulário público", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await proxy(new NextRequest("https://gwstore.vercel.app/pagamentos-pix"));
    expect(response.headers.get("location")).toBe("https://gwstore.vercel.app/pagar");
  });

  it("leva comprador autenticado ao formulário público, sem liberar o painel", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "buyer" } } });
    const response = await proxy(new NextRequest("https://gwstore.vercel.app/pagamentos-pix"));
    expect(response.headers.get("location")).toBe("https://gwstore.vercel.app/pagar");

    const otherAdminPage = await proxy(new NextRequest("https://gwstore.vercel.app/pedidos"));
    expect(otherAdminPage.headers.get("location")).toBe("https://gwstore.vercel.app/admin/pedidos");
    const canonicalPage = await proxy(new NextRequest("https://gwstore.vercel.app/admin/pedidos"));
    expect(canonicalPage.headers.get("location")).toBe("https://gwstore.vercel.app/acesso-negado");
  });

  it("mantém o relatório disponível para administradores", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
    const response = await proxy(new NextRequest("https://gwstore.vercel.app/pagamentos-pix"));
    expect(response.headers.get("location")).toBe("https://gwstore.vercel.app/admin/pagamentos-pix");
    const canonicalPage = await proxy(new NextRequest("https://gwstore.vercel.app/admin/pagamentos-pix"));
    expect(canonicalPage.headers.get("location")).toBeNull();
    expect(canonicalPage.headers.get("x-middleware-rewrite")).toBe("https://gwstore.vercel.app/pagamentos-pix");
  });

  it("protege /admin da GWStore com Discord antes de reescrever a página", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await proxy(new NextRequest("https://gwstoreofc.com/admin/pedidos?status=paid"));
    const login = new URL(response.headers.get("location")!);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("next")).toBe("/admin/pedidos?status=paid");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("reescreve o painel autenticado e preserva a sessão renovada", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
    mocks.refreshCookies = true;
    const response = await proxy(new NextRequest("https://gwstoreofc.com/admin/pedidos?status=paid"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://gwstoreofc.com/pedidos?status=paid");
    expect(response.cookies.get("sb-refreshed")?.value).toBe("session");
  });

  it("preserva filtros dos links antigos sem redirecionar POSTs de Server Actions", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
    const get = await proxy(new NextRequest("https://gwstoreofc.com/pedidos?status=paid&page=2"));
    expect(get.headers.get("location")).toBe("https://gwstoreofc.com/admin/pedidos?status=paid&page=2");
    const post = await proxy(new NextRequest("https://gwstoreofc.com/pedidos", { method: "POST" }));
    expect(post.headers.get("location")).toBeNull();
    expect(post.headers.get("x-middleware-rewrite")).toBeNull();
    const newPost = await proxy(new NextRequest("https://gwstoreofc.com/admin/pedidos", { method: "POST" }));
    expect(newPost.headers.get("location")).toBeNull();
    expect(newPost.headers.get("x-middleware-rewrite")).toBe("https://gwstoreofc.com/pedidos");
  });

  it("deixa a nova raiz GW e os sorteios públicos acessíveis sem sessão", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    for (const path of ["/", "/sorteios/promo", "/pagar", "/roleta"]) {
      const response = await proxy(new NextRequest(`https://gwstoreofc.com${path}`));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("libera só as páginas do comprador GW e preserva a sessão de usuários sem permissão admin", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "buyer" } } });
    mocks.refreshCookies = true;
    const orderId = "10000000-0000-4000-8000-000000000001";
    for (const path of ["/entrar", "/entrar/", "/minhas-compras", `/minhas-compras/${orderId}`]) {
      const response = await proxy(new NextRequest(`https://gwstoreofc.com${path}`));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.cookies.get("sb-refreshed")?.value).toBe("session");
    }
    for (const path of ["/entrar/admin", "/minhas-compras/admin", "/admin/pedidos", "/admin/atendimento-loja", `/admin/atendimento-loja/${orderId}`]) {
      const response = await proxy(new NextRequest(`https://gwstoreofc.com${path}`));
      expect(new URL(response.headers.get("location")!).pathname).toBe("/acesso-negado");
    }
    mocks.gwStore = false;
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const th = await proxy(new NextRequest("https://thstore.vercel.app/entrar"));
    expect(new URL(th.headers.get("location")!).pathname).toBe("/login");
    mocks.gwStore = true;
    const master = await proxy(new NextRequest("https://101devs.com/entrar"));
    expect(new URL(master.headers.get("location")!).pathname).toBe("/login");
  });

  it("preserva o login Google do painel mestre em 101Devs e nas abas mestre", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
    for (const href of ["https://101devs.com/admin", "https://gwstoreofc.com/admin/gwstore", "https://gwstoreofc.com/admin/discordbots", "https://gwstoreofc.com/admin/aba-nova"]) {
      const response = await proxy(new NextRequest(href));
      expect(new URL(response.headers.get("location")!).pathname).toBe("/admin/discordbots/login");
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
    mocks.getUser.mockResolvedValue({ data: { user: { id: "master", provider: "google" } } });
    const master = await proxy(new NextRequest("https://101devs.com/admin"));
    expect(master.headers.get("location")).toBeNull();
    expect(master.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("não usa headers de host forjados para trocar o tipo de autenticação", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
    const shop = await proxy(new NextRequest("https://gwstoreofc.com/admin", {
      headers: { host: "101devs.com", "x-forwarded-host": "101devs.com" },
    }));
    expect(shop.headers.get("x-middleware-rewrite")).toBe("https://gwstoreofc.com/dashboard");
    const master = await proxy(new NextRequest("https://101devs.com/admin", {
      headers: { host: "gwstoreofc.com", "x-forwarded-host": "gwstoreofc.com" },
    }));
    expect(new URL(master.headers.get("location")!).pathname).toBe("/admin/discordbots/login");
  });

  it("mantém raiz e rotas antigas da THStore", async () => {
    mocks.gwStore = false;
    mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
    for (const path of ["/", "/pedidos"]) {
      const response = await proxy(new NextRequest(`https://thstore.vercel.app${path}`));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const home = await proxy(new NextRequest("https://thstore.vercel.app/"));
    expect(new URL(home.headers.get("location")!).pathname).toBe("/login");
  });

  it("falha fechado no painel se o Supabase estiver sem configuração", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await proxy(new NextRequest("https://gwstoreofc.com/admin"));
    const login = new URL(response.headers.get("location")!);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("setup")).toBe("1");
    expect(login.searchParams.get("next")).toBe("/admin");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    const home = await proxy(new NextRequest("https://gwstoreofc.com/"));
    expect(home.headers.get("location")).toBeNull();
  });
});
