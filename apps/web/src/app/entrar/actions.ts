"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_NEXT_COOKIE } from "@/lib/auth-next";
import { CUSTOMER_EMAIL_NEXT_MAX_AGE, CUSTOMER_RECOVERY_COOKIE, type CustomerEmailAuthMode, type CustomerEmailAuthState } from "@/lib/customer-auth-state";
import { getGwStoreLoginOrigin, getStoreAuthSiteUrl } from "@/lib/env";
import { safeGwStoreCustomerNext } from "@/lib/gwstore-customer-auth";
import { requireShopRequest } from "@/lib/shop/request";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODES: ReadonlySet<string> = new Set(["login", "signup", "forgot", "reset"]);
const UNAVAILABLE = "O acesso por e-mail está indisponível agora. Tente novamente em instantes.";

export async function customerEmailAuth(
  _previousState: CustomerEmailAuthState,
  formData: FormData,
): Promise<CustomerEmailAuthState> {
  const modeValue = textField(formData, "mode");
  if (!MODES.has(modeValue)) return failure("Escolha como deseja acessar sua conta.");
  const mode = modeValue as CustomerEmailAuthMode;
  const requestHeaders = await headers();
  let origin: string;
  try {
    // Next checks Origin/Host too. This check also restricts the action to the
    // storefront and applies the same narrow Railway bridge as its APIs.
    const submittedOrigin = requestHeaders.get("origin");
    const host = requestHeaders.get("host");
    if (!submittedOrigin || !host) return failure("Recarregue a página para continuar.");
    const protocol = new URL(submittedOrigin).protocol;
    if (protocol !== "https:" && protocol !== "http:") {
      return failure("Recarregue a página para continuar.");
    }
    origin = requireShopRequest(new Request(`${protocol}//${host}/entrar`, {
      method: "POST",
      headers: requestHeaders,
    }), true);
  } catch {
    return failure("Recarregue a página para continuar.");
  }
  const siteOrigin = getStoreAuthSiteUrl(origin);
  const next = safeGwStoreCustomerNext(textField(formData, "next"), siteOrigin);
  const loginOrigin = getGwStoreLoginOrigin();
  if (loginOrigin && origin !== loginOrigin) {
    const target = new URL("/entrar", loginOrigin);
    target.searchParams.set("mode", mode === "reset" ? "forgot" : mode);
    target.searchParams.set("next", next);
    // The verifier must belong to the same host that receives the email link.
    // Never forward credentials in a URL or create a session on the old host.
    redirect(target.toString());
  }

  const email = textField(formData, "email").trim().toLowerCase();
  const password = textField(formData, "password");
  const displayName = textField(formData, "displayName").trim();
  const confirmPassword = textField(formData, "confirmPassword");
  const fieldErrors: Record<string, string> = {};
  if (mode !== "reset" && (email.length > 254 || !EMAIL.test(email))) {
    fieldErrors.email = "Informe um e-mail válido.";
  }
  if (mode === "login" && (!password || password.length > 1_024)) {
    fieldErrors.password = "Informe sua senha.";
  }
  if (mode === "signup" || mode === "reset") {
    if (password.length < 8 || password.length > 128) {
      fieldErrors.password = "Use uma senha de 8 a 128 caracteres.";
    }
    if ((mode === "reset" || formData.has("confirmPassword")) && confirmPassword !== password) {
      fieldErrors.confirmPassword = "As senhas precisam ser iguais.";
    }
  }
  if (mode === "signup" && (displayName.length < 2 || displayName.length > 60
    || /[\u0000-\u001f\u007f]/.test(displayName))) {
    fieldErrors.displayName = "Informe um nome de 2 a 60 caracteres.";
  }
  if (Object.keys(fieldErrors).length) {
    return { status: "error", message: "Confira os campos indicados.", fieldErrors };
  }

  const client = await createServerSupabaseClient();
  if (!client) return failure(UNAVAILABLE);
  const cookieStore = await cookies();
  const callback = new URL("/auth/callback", siteOrigin).toString();
  const rememberNext = () => cookieStore.set(AUTH_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure: siteOrigin.startsWith("https:"),
    path: "/",
    maxAge: CUSTOMER_EMAIL_NEXT_MAX_AGE,
  });

  if (mode === "login") {
    let result;
    try {
      result = await client.auth.signInWithPassword({ email, password });
    } catch {
      return failure(UNAVAILABLE);
    }
    if (result.error) {
      return failure(result.error.code === "email_not_confirmed"
        ? "Confirme seu e-mail pelo link recebido antes de entrar."
        : result.error.status === 429
          ? "Muitas tentativas. Aguarde um pouco e tente novamente."
          : "Não foi possível entrar. Confira seu e-mail e sua senha.");
    }
    if (!result.data.session) return failure(UNAVAILABLE);
    cookieStore.delete(AUTH_NEXT_COOKIE);
    cookieStore.delete(CUSTOMER_RECOVERY_COOKIE);
    redirect(next);
  }

  if (mode === "signup") {
    let result;
    try {
      result = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callback, data: { full_name: displayName } },
      });
    } catch {
      return failure(UNAVAILABLE);
    }
    if (result.error && result.error.code !== "user_already_exists") {
      return failure(authFailure(result.error));
    }
    cookieStore.delete(CUSTOMER_RECOVERY_COOKIE);
    if (result.data?.session) {
      cookieStore.delete(AUTH_NEXT_COOKIE);
      redirect(next);
    }
    rememberNext();
    return {
      status: "success",
      message: "Confira seu e-mail para confirmar a conta. Abra o link neste mesmo navegador. Se você já tem uma conta, entre com sua senha.",
    };
  }

  if (mode === "forgot") {
    let result;
    try {
      result = await client.auth.resetPasswordForEmail(email, { redirectTo: callback });
    } catch {
      return failure(UNAVAILABLE);
    }
    if (result.error) return failure(authFailure(result.error));
    cookieStore.delete(CUSTOMER_RECOVERY_COOKIE);
    rememberNext();
    return {
      status: "success",
      message: "Se houver uma conta com esse e-mail, você receberá um link para criar uma nova senha. Abra o link neste mesmo navegador.",
    };
  }

  // A recovery URL or a submitted email never selects the account to update.
  // The authenticated session determines ownership, and the short-lived
  // workflow cookie must refer to that same user.
  let verifiedUser;
  try {
    verifiedUser = await client.auth.getUser();
  } catch {
    return failure(UNAVAILABLE);
  }
  const user = verifiedUser.data.user;
  if (verifiedUser.error || !user?.email || !user.email_confirmed_at
    || cookieStore.get(CUSTOMER_RECOVERY_COOKIE)?.value !== user.id) {
    return failure("O link de recuperação expirou. Solicite um novo link e abra-o neste navegador.");
  }
  let updated;
  try {
    updated = await client.auth.updateUser({ password });
  } catch {
    return failure(UNAVAILABLE);
  }
  if (updated.error) return failure(authFailure(updated.error));
  cookieStore.delete(CUSTOMER_RECOVERY_COOKIE);
  cookieStore.delete(AUTH_NEXT_COOKIE);
  redirect(next);
}

function textField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function failure(message: string): CustomerEmailAuthState {
  return { status: "error", message };
}

function authFailure(error: { code?: string; status?: number }): string {
  if (error.status === 429 || error.code === "over_email_send_rate_limit"
    || error.code === "over_request_rate_limit") {
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  }
  if (error.code === "weak_password") return "Escolha uma senha mais forte para sua conta.";
  if (error.code === "same_password") return "Escolha uma senha diferente da anterior.";
  return UNAVAILABLE;
}
