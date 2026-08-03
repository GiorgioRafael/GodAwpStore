import type { ReactNode } from "react";
import Link from "next/link";

export function MasterAuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#070b12] px-4 py-10 text-slate-50 [color-scheme:dark] sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(139,92,246,.2),transparent_38%),radial-gradient(circle_at_100%_100%,rgba(99,102,241,.08),transparent_30%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.45)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.45)_1px,transparent_1px)] [background-size:44px_44px]"
      />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link
            href="/admin/discordbots"
            aria-label="101Devs — painel mestre dos bots"
            className="rounded-xl text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            <span className="block text-[28px] font-semibold tracking-tight text-white">
              <span className="font-mono font-bold tracking-[0.08em] text-violet-400">101</span>
              Devs
            </span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-300">
              Discord bots control center
            </span>
          </Link>
        </div>
        {children}
        <p className="mt-6 text-center text-xs leading-5 text-slate-500">
          Área privada da 101Devs. Clientes e empresas monitoradas não possuem acesso.
        </p>
      </div>
    </main>
  );
}
