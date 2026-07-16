import "server-only";

import { getAdminSession, type AdminIdentity } from "@/lib/auth";

export type ApiAuthorization =
  | { ok: true; identity: AdminIdentity }
  | { ok: false; response: Response };

export async function authorizeAdminRequest(): Promise<ApiAuthorization> {
  const session = await getAdminSession();

  if (session.status === "unconfigured") {
    return {
      ok: false,
      response: Response.json(
        { error: "O Supabase e os administradores ainda não foram configurados." },
        { status: 503 },
      ),
    };
  }

  if (session.status === "error") {
    return {
      ok: false,
      response: Response.json(
        { error: "N\u00e3o foi poss\u00edvel validar o perfil administrativo." },
        { status: 503 },
      ),
    };
  }

  if (session.status === "unauthenticated") {
    return {
      ok: false,
      response: Response.json({ error: "Autenticação necessária." }, { status: 401 }),
    };
  }

  if (session.status === "unauthorized") {
    return {
      ok: false,
      response: Response.json({ error: "Seu Discord ID não possui acesso administrativo." }, { status: 403 }),
    };
  }

  return { ok: true, identity: session.identity };
}
