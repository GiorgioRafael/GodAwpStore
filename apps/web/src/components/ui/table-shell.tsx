import type { ReactNode } from "react";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "./cn";

interface TableShellProps {
  columns: string[];
  children: ReactNode;
  caption: string;
  className?: string;
}

export function TableShell({
  columns,
  children,
  caption,
  className,
}: TableShellProps) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-surface", className)}>
      <div className="flex items-center gap-2 border-b border-border bg-surface-elevated px-4 py-2.5 text-xs text-muted sm:hidden">
        <ArrowLeftRight aria-hidden="true" className="size-3.5 shrink-0" />
        Deslize a tabela para ver todas as colunas
      </div>
      <div className="overflow-x-auto overscroll-x-contain focus-visible:outline-offset-[-3px]" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full min-w-[720px] border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-white/[0.018]">
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-5 py-3.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&>tr]:transition-colors [&>tr:hover]:bg-white/[0.025]">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}
