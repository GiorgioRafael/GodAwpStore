import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Database, Plus, Search, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "./page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form-field";
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";

interface ResourcePageProps {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel?: string;
  columns: string[];
  emptyIcon?: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  readOnly?: boolean;
  toolbarHint?: string;
  rows?: ReactNode;
  recordCount?: number;
}

export function ResourcePage({
  eyebrow,
  title,
  description,
  actionLabel,
  columns,
  emptyIcon = Database,
  emptyTitle,
  emptyDescription,
  readOnly = false,
  toolbarHint,
  rows,
  recordCount = 0,
}: ResourcePageProps) {
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          actionLabel ? (
            <Button disabled title="Disponível após conectar o banco de dados">
              <Plus aria-hidden="true" className="size-4" />
              {actionLabel}
            </Button>
          ) : undefined
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              aria-label={`Buscar em ${title.toLowerCase()}`}
              className="pl-10"
              placeholder={`Buscar em ${title.toLowerCase()}...`}
              disabled
            />
          </div>
          <Button variant="secondary" disabled>
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            Filtros
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
          <span>{toolbarHint ?? "Os filtros serão ativados quando houver dados."}</span>
          <span>{readOnly ? `Somente leitura · ${recordCount} registros` : `${recordCount} registros`}</span>
        </div>
      </Card>

      <TableShell columns={columns} caption={`Tabela de ${title.toLowerCase()}`}>
        {recordCount > 0 && rows ? rows : (
          <TableEmptyRow colSpan={columns.length}>
            <EmptyState
              icon={emptyIcon}
              title={emptyTitle}
              description={emptyDescription}
              compact
            />
          </TableEmptyRow>
        )}
      </TableShell>
    </div>
  );
}
