import type { Metadata } from "next";

import { MasterAuthShell } from "@/components/platform/master-auth-shell";

export const metadata: Metadata = {
  title: {
    absolute: "101Devs | Administração dos bots Discord",
  },
  description: "Acesso privado ao painel mestre de bots Discord da 101Devs.",
};

export default function MasterAuthenticationLayout({ children }: { children: React.ReactNode }) {
  return <MasterAuthShell>{children}</MasterAuthShell>;
}
