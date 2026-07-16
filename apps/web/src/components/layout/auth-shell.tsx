import type { ReactNode } from "react";
import { Brand } from "./brand";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-4 py-10 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(212,166,74,.13),transparent_34%),radial-gradient(circle_at_100%_100%,rgba(212,166,74,.055),transparent_30%)]"
      />
      <div aria-hidden="true" className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.5)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Brand prominent />
        </div>
        {children}
        <p className="mt-6 text-center text-xs leading-5 text-muted/75">
          Área restrita. Toda atividade administrativa pode ser registrada para auditoria.
        </p>
      </div>
    </main>
  );
}
