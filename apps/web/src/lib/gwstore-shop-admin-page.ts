import "server-only";

import { notFound, redirect } from "next/navigation";

import { getAdminSession } from "./auth";
import { IS_GWSTORE } from "./brand";

/** Gate the page itself, before a child can load private shop data. */
export async function requireGwStoreShopAdminPage(next: string) {
  if (!IS_GWSTORE) notFound();
  const session = await getAdminSession();
  if (session.status === "unauthorized") redirect("/acesso-negado");
  if (session.status !== "authorized") {
    const query = new URLSearchParams({ next });
    if (session.status === "unconfigured") query.set("setup", "1");
    if (session.status === "error") query.set("erro", "configuracao");
    redirect(`/login?${query.toString()}`);
  }
  return session.identity;
}
