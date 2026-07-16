import { AuthShell } from "@/components/layout/auth-shell";

export default function AuthenticationLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
