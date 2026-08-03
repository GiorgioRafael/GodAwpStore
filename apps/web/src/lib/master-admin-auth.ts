export const MASTER_ADMIN_ROOT = "/admin/discordbots";
export const MASTER_ADMIN_LOGIN = `${MASTER_ADMIN_ROOT}/login`;
export const MASTER_ADMIN_ACCESS_DENIED = `${MASTER_ADMIN_ROOT}/acesso-negado`;

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
