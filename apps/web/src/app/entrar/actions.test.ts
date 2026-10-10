// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  cookieValues: new Map<string, string>(),
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
  createClient: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => mocks.requestHeaders,
  cookies: async () => ({
    get: (name: string) => mocks.cookieValues.has(name) ? { value: mocks.cookieValues.get(name) } : undefined,
    set: mocks.setCookie,
    delete: mocks.deleteCookie,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => { throw new Error(`NEXT_REDIRECT:${target}`); },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createClient }));

import { customerEmailAuth } from "./actions";
import { CUSTOMER_RECOVERY_COOKIE, INITIAL_CUSTOMER_AUTH_STATE } from "@/lib/customer-auth-state";

const CART_NEXT = "/?checkout=1&cart=%5B%5D";
const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const BAD_ORIGIN_HEADERS: Record<string, string>[] = [
  { origin: "https://evil.example", host: "gwstoreofc.com" },
  { origin: "https://101devs.com", host: "101devs.com" },
  { origin: "https://untrusted.example", host: "untrusted.example", "x-forwarded-host": "gwstoreofc.com" },
  { origin: "https://gwstoreofc.com", host: "gwstoreofc.com", "sec-fetch-site": "cross-site" },
];
const client = { auth: {
  signInWithPassword: mocks.signInWithPassword,
  signUp: mocks.signUp,
  resetPasswordForEmail: mocks.resetPasswordForEmail,
  getUser: mocks.getUser,
  updateUser: mocks.updateUser,
} };

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function submit(values: Record<string, string>) {
  return customerEmailAuth(INITIAL_CUSTOMER_AUTH_STATE, form(values));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_STORE_NAME", "GWStore");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://gwstoreofc.com");
  vi.stubEnv("MASTER_ADMIN_SITE_URL", "https://101devs.com");
  vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "");
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  mocks.requestHeaders = new Headers({ host: "gwstoreofc.com", origin: "https://gwstoreofc.com", "sec-fetch-site": "same-origin" });
  mocks.cookieValues.clear();
  mocks.createClient.mockResolvedValue(client);
  mocks.signInWithPassword.mockResolvedValue({ data: { session: { user: { id: ACCOUNT_ID } } }, error: null });
  mocks.signUp.mockResolvedValue({ data: { session: null, user: { id: ACCOUNT_ID } }, error: null });
  mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: ACCOUNT_ID, email: "player@example.com", email_confirmed_at: "2026-10-10T12:00:00Z" } }, error: null });
  mocks.updateUser.mockResolvedValue({ data: { user: { id: ACCOUNT_ID } }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("conta do comprador por e-mail", () => {
  it("entra com senha, normaliza e-mail e retorna ao carrinho validado", async () => {
    await expect(submit({ mode: "login", email: " PLAYER@Example.com ", password: "existing", next: CART_NEXT }))
      .rejects.toThrow(`NEXT_REDIRECT:${CART_NEXT}`);
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "player@example.com", password: "existing" });
    expect(mocks.deleteCookie).toHaveBeenCalledWith(CUSTOMER_RECOVERY_COOKIE);
  });

  it.each(["//evil.example", "/admin", "/pedidos", "/entrar"]) ("restringe retorno %s à loja", async next => {
    await expect(submit({ mode: "login", email: "player@example.com", password: "existing", next }))
      .rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("rejeita campos inválidos antes de acessar o provedor", async () => {
    const state = await submit({ mode: "signup", email: "invalid", password: "short", displayName: "A", confirmPassword: "different" });
    expect(state.fieldErrors).toEqual({
      email: "Informe um e-mail válido.",
      password: "Use uma senha de 8 a 128 caracteres.",
      displayName: "Informe um nome de 2 a 60 caracteres.",
      confirmPassword: "As senhas precisam ser iguais.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("cadastra com o callback exato e guarda apenas o destino no cookie HttpOnly", async () => {
    const state = await submit({ mode: "signup", email: "player@example.com", password: "new-password", displayName: " Jogador ", next: CART_NEXT });
    expect(mocks.signUp).toHaveBeenCalledWith({ email: "player@example.com", password: "new-password", options: {
      emailRedirectTo: "https://gwstoreofc.com/auth/callback", data: { full_name: "Jogador" },
    } });
    expect(mocks.setCookie).toHaveBeenCalledWith("gw_auth_next", CART_NEXT, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 3_600,
    });
    expect(state.status).toBe("success");
    expect(state.message).toContain("mesmo navegador");
    expect(JSON.stringify(state)).not.toContain(ACCOUNT_ID);
  });

  it("mantém a mesma resposta pública para endereços já cadastrados", async () => {
    const values = { mode: "signup", email: "player@example.com", password: "new-password", displayName: "Jogador" };
    const created = await submit(values);
    mocks.signUp.mockResolvedValue({ data: { session: null, user: null }, error: { code: "user_already_exists", message: "registered address" } });
    expect(await submit(values)).toEqual(created);
  });

  it("também conclui cadastro quando Supabase entrega sessão imediatamente", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: { user: { id: ACCOUNT_ID } } }, error: null });
    await expect(submit({ mode: "signup", email: "player@example.com", password: "new-password", displayName: "Jogador", next: "/minhas-compras" }))
      .rejects.toThrow("NEXT_REDIRECT:/minhas-compras");
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("recuperação não revela se o endereço tem conta", async () => {
    const state = await submit({ mode: "forgot", email: "unknown@example.com", next: CART_NEXT });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("unknown@example.com", { redirectTo: "https://gwstoreofc.com/auth/callback" });
    expect(state.status).toBe("success");
    expect(state.message).toContain("Se houver uma conta");
    expect(mocks.setCookie).toHaveBeenCalledWith("gw_auth_next", CART_NEXT, expect.objectContaining({ httpOnly: true }));
  });

  it.each([null, "another-account"]) ("não troca senha sem recuperação vinculada à sessão (%s)", async recovery => {
    if (recovery) mocks.cookieValues.set(CUSTOMER_RECOVERY_COOKIE, recovery);
    const state = await submit({ mode: "reset", password: "new-password", confirmPassword: "new-password" });
    expect(state.status).toBe("error");
    expect(state.message).toContain("expirou");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("recuperação não troca senha com uma sessão ausente ou não validada", async () => {
    mocks.cookieValues.set(CUSTOMER_RECOVERY_COOKIE, ACCOUNT_ID);
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid jwt" } });
    expect((await submit({ mode: "reset", password: "new-password", confirmPassword: "new-password" })).status).toBe("error");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("troca apenas a senha da sessão validada e limpa a recuperação", async () => {
    mocks.cookieValues.set(CUSTOMER_RECOVERY_COOKIE, ACCOUNT_ID);
    await expect(submit({ mode: "reset", email: "victim@example.com", password: "new-password", confirmPassword: "new-password", next: CART_NEXT }))
      .rejects.toThrow(`NEXT_REDIRECT:${CART_NEXT}`);
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "new-password" });
    expect(mocks.deleteCookie).toHaveBeenCalledWith(CUSTOMER_RECOVERY_COOKIE);
  });

  it.each(BAD_ORIGIN_HEADERS)("rejeita POST fora da origem pública GW (%j)", async headers => {
    mocks.requestHeaders = new Headers(headers);
    expect((await submit({ mode: "login", email: "player@example.com", password: "existing" })).status).toBe("error");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("entra no host legado antes de criar verifier ou enviar credenciais ao Supabase", async () => {
    vi.stubEnv("GWSTORE_LOGIN_ORIGIN", "https://gwstore.vercel.app");
    await expect(submit({ mode: "signup", email: "player@example.com", password: "secret-password", displayName: "Jogador", next: CART_NEXT }))
      .rejects.toThrow(`NEXT_REDIRECT:https://gwstore.vercel.app/entrar?mode=signup&next=${encodeURIComponent(CART_NEXT)}`);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("não expõe mensagens internas do provedor", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { status: 400, message: "internal credentials: private-detail" } });
    const state = await submit({ mode: "login", email: "player@example.com", password: "existing" });
    expect(state.message).toBe("Não foi possível entrar. Confira seu e-mail e sua senha.");
    expect(JSON.stringify(state)).not.toContain("private-detail");
  });
});
