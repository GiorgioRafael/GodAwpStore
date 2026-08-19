export const MASTER_ADMIN_ROOT = "/admin";

/**
 * A URL original do painel, mantida viva.
 *
 * O 101devs roteia `/admin/discordbots/:path*` para esta aplicação, e o login e a
 * tela de acesso negado moram debaixo dela. Mover esses dois endereços exigiria
 * trocar o roteamento do microfrontend e o allow-list do Supabase ao mesmo tempo,
 * então eles ficam onde estão; só a home do painel passou para `/admin`.
 */
export const MASTER_ADMIN_LEGACY_ROOT = "/admin/discordbots";
export const MASTER_ADMIN_LOGIN = `${MASTER_ADMIN_LEGACY_ROOT}/login`;
export const MASTER_ADMIN_ACCESS_DENIED = `${MASTER_ADMIN_LEGACY_ROOT}/acesso-negado`;

export function isMasterAdminPath(value: string) {
  const pathname = value.split(/[?#]/, 1)[0] ?? "";
  return pathname === MASTER_ADMIN_ROOT || pathname.startsWith(`${MASTER_ADMIN_ROOT}/`);
}

export function masterAdminLoginHref(
  next = MASTER_ADMIN_ROOT,
  feedback?: { setup?: boolean; error?: string },
) {
  const query = new URLSearchParams({ next });
  if (feedback?.setup) query.set("setup", "1");
  if (feedback?.error) query.set("erro", feedback.error);
  return `${MASTER_ADMIN_LOGIN}?${query.toString()}`;
}
