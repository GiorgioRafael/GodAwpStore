import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: { auth: { signInWithOAuth: vi.fn(), exchangeCodeForSession: vi.fn(), signOut: vi.fn() } },
  createServerSupabaseClient: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/layout/brand-mark", () => ({ BrandMark: () => <span aria-hidden="true">GW</span> }));

const ORDER_ID = "10000000-0000-4000-8000-000000000001";
const CART_NEXT = `/?${new URLSearchParams({ checkout: "1", cart: JSON.stringify([{ productId: ORDER_ID, quantity: 2 }]) })}`;

async function routes(storeName = "GWStore") {
  vi.stubEnv("NEXT_PUBLIC_STORE_NAME", storeName);
  vi.resetModules();
  return {
    login: (await import("./login/route")).GET,
    callback: (await import("./callback/route")).GET,
    logout: (await import("./logout/route")).POST,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gwstoreofc.com");
  vi.stubEnv("MASTER_ADMIN_SITE_URL", "https://101devs.com");
  vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  mocks.createServerSupabaseClient.mockResolvedValue(mocks.client);
  mocks.client.auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://discord.com/oauth2/authorize" }, error: null });
  mocks.client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.client.auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("login do comprador GWStore", () => {
  it("preserva carrinho custom → legacy → Discord → loja sem exigir administrador", async () => {
    const { login, callback } = await routes();
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
    const start = await login(new NextRequest(`https://gwstoreofc.com/auth/login?${new URLSearchParams({ next: CART_NEXT })}`));
    const legacy = new URL(start.headers.get("location")!);
    expect(legacy.origin).toBe("https://gwstore.vercel.app");
    expect(legacy.searchParams.get("next")).toBe(CART_NEXT);
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();

    const oauth = await login(new NextRequest(legacy));
    const callbackUrl = new URL(mocks.client.auth.signInWithOAuth.mock.calls[0][0].options.redirectTo);
    expect(callbackUrl.origin).toBe(legacy.origin);
    expect(callbackUrl.searchParams.get("next")).toBe(CART_NEXT);
    expect(oauth.cookies.get("gw_auth_next")?.value).toBe(CART_NEXT);
    callbackUrl.searchParams.set("code", "valid");
    const finish = await callback(new NextRequest(callbackUrl));
    expect(finish.headers.get("location")).toBe(`${legacy.origin}${CART_NEXT}`);
    expect(mocks.client.auth.exchangeCodeForSession).toHaveBeenCalledWith("valid");
    expect(finish.cookies.get("gw_auth_next")?.value).toBe("");
  });

  it.each([CART_NEXT, "/minhas-compras", `/minhas-compras/${ORDER_ID}`])("preserva %s no cookie e em todas as falhas de autenticação", async next => {
    const { login, callback } = await routes();
    const request = () => new NextRequest(`https://gwstore.vercel.app/auth/login?${new URLSearchParams({ next })}`);
    mocks.createServerSupabaseClient.mockResolvedValue(null);
    const setup = new URL((await login(request())).headers.get("location")!);
    expect(setup.pathname).toBe("/entrar");
    expect(setup.searchParams.get("setup")).toBe("1");
    expect(setup.searchParams.get("next")).toBe(next);

    mocks.createServerSupabaseClient.mockResolvedValue(mocks.client);
    mocks.client.auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "failed" } });
    const oauth = new URL((await login(request())).headers.get("location")!);
    expect(oauth.pathname).toBe("/entrar");
    expect(oauth.searchParams.get("erro")).toBe("oauth");
    expect(oauth.searchParams.get("next")).toBe(next);

    const cookieHeaders = { cookie: `gw_auth_next=${encodeURIComponent(next)}` };
    const noCode = new URL((await callback(new NextRequest("https://gwstore.vercel.app/auth/callback", { headers: cookieHeaders }))).headers.get("location")!);
    expect(noCode.pathname).toBe("/entrar");
    expect(noCode.searchParams.get("erro")).toBe("callback");
    expect(noCode.searchParams.get("next")).toBe(next);
    mocks.client.auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "failed" } });
    const failed = new URL((await callback(new NextRequest("https://gwstore.vercel.app/auth/callback?code=expired", { headers: cookieHeaders }))).headers.get("location")!);
    expect(failed.pathname).toBe("/entrar");
    expect(failed.searchParams.get("next")).toBe(next);
  });

  it("logout explícito do comprador volta à loja; logout administrativo permanece separado", async () => {
    const { logout } = await routes();
    const customer = await logout(new NextRequest("https://gwstoreofc.com/auth/logout?next=%2F", { method: "POST" }));
    expect(customer.status).toBe(303);
    expect(customer.headers.get("location")).toBe("https://gwstoreofc.com/");
    const admin = await logout(new NextRequest("https://gwstoreofc.com/auth/logout", { method: "POST" }));
    expect(admin.headers.get("location")).toBe("https://gwstoreofc.com/login");
    const invalid = await logout(new NextRequest("https://gwstoreofc.com/auth/logout?next=https%3A%2F%2Fevil.example", { method: "POST" }));
    expect(invalid.headers.get("location")).toBe("https://gwstoreofc.com/login");
    expect(mocks.client.auth.signOut).toHaveBeenCalledTimes(3);
  });

  it("mantém falhas e logout TH no login anterior, e a identidade mestre em 101Devs", async () => {
    const th = await routes("THStore");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://thstore.vercel.app");
    mocks.client.auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "failed" } });
    expect((await th.login(new NextRequest("https://thstore.vercel.app/auth/login?next=%2F"))).headers.get("location")).toBe("https://thstore.vercel.app/login?erro=oauth");
    expect((await th.logout(new NextRequest("https://thstore.vercel.app/auth/logout?next=%2F", { method: "POST" }))).headers.get("location")).toBe("https://thstore.vercel.app/login");
    const gw = await routes();
    expect((await gw.callback(new NextRequest("https://101devs.com/auth/callback?next=%2Fadmin"))).headers.get("location")).toBe("https://101devs.com/admin/discordbots/login?next=%2Fadmin&erro=callback");
  });

  it("a página cliente mantém next e não oferece rotas administrativas ou destinos externos", async () => {
    await routes();
    const { default: CustomerLoginPage } = await import("@/app/entrar/page");
    render(await CustomerLoginPage({ searchParams: Promise.resolve({ next: CART_NEXT, erro: "callback" }) }));
    const authUrl = new URL(screen.getByRole("link", { name: "Continuar com Discord" }).getAttribute("href")!, "https://gwstoreofc.com");
    expect(authUrl.pathname).toBe("/auth/login");
    expect(authUrl.searchParams.get("next")).toBe(CART_NEXT);
    expect(screen.getByRole("link", { name: "Voltar à loja" })).toHaveAttribute("href", CART_NEXT);
    expect(screen.getByRole("alert")).toHaveTextContent("Seu carrinho foi preservado");
    expect(screen.queryByText(/administrador|ticket|membro do servidor/i)).not.toBeInTheDocument();
    const { safeGwStoreCustomerNext } = await import("@/lib/gwstore-customer-auth");
    for (const invalid of ["//evil.example", "/\\evil.example", "/admin", "/pedidos", "/minhas-compras/not-an-order", "/entrar"]) {
      expect(safeGwStoreCustomerNext(invalid, "https://gwstoreofc.com")).toBe("/");
    }
  });

  it("a nova página de cliente não se abre na THStore", async () => {
    await routes("THStore");
    const { default: CustomerLoginPage } = await import("@/app/entrar/page");
    await expect(CustomerLoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("o acesso a compras anteriores mantém o pedido e usa a entrada da conta", async () => {
    await routes();
    const { default: CustomerLoginPage } = await import("@/app/entrar/page");
    const next = `/minhas-compras/${ORDER_ID}`;
    render(await CustomerLoginPage({ searchParams: Promise.resolve({ next, erro: "callback" }) }));
    expect(screen.getByRole("heading", { name: "Entre na sua conta" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("carrinho");
    expect(new URL(screen.getByRole("link", { name: "Continuar com Discord" }).getAttribute("href")!, "https://gwstoreofc.com").searchParams.get("next")).toBe(next);
  });
});
