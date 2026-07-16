"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Plus, Search, SearchX } from "lucide-react";

import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form-field";
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";

type FilterOption = {
  value: string;
  label: string;
};

interface ResourceManagerShellProps {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  onCreate: () => void;
  createDisabled?: boolean;
  createDisabledReason?: string;
  search: string;
  onSearchChange: (value: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  filterOptions: FilterOption[];
  columns: string[];
  totalCount: number;
  visibleCount: number;
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  children: ReactNode;
}

export function ResourceManagerShell({
  eyebrow,
  title,
  description,
  actionLabel,
  onCreate,
  createDisabled = false,
  createDisabledReason,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  filterOptions,
  columns,
  totalCount,
  visibleCount,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  children,
}: ResourceManagerShellProps) {
  const hasQuery = Boolean(search.trim()) || filter !== "all";
  const countLabel = totalCount === 1 ? "1 registro" : `${totalCount} registros`;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <Button
            onClick={onCreate}
            disabled={createDisabled}
            title={createDisabled ? createDisabledReason : undefined}
          >
            <Plus aria-hidden="true" className="size-4" />
            {actionLabel}
          </Button>
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              type="search"
              aria-label={`Buscar em ${title.toLowerCase()}`}
              className="pl-10"
              placeholder={`Buscar em ${title.toLowerCase()}...`}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
          <Select
            aria-label={`Filtrar ${title.toLowerCase()} por estado`}
            className="sm:w-52"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
          >
            {filterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
          <span>
            {hasQuery
              ? `${visibleCount} de ${totalCount} encontrados`
              : "Dados carregados diretamente do banco"}
          </span>
          <span>{countLabel}</span>
        </div>
      </Card>

      <TableShell columns={columns} caption={`Tabela de ${title.toLowerCase()}`}>
        {visibleCount === 0 ? (
          <TableEmptyRow colSpan={columns.length}>
            <EmptyState
              icon={hasQuery ? SearchX : emptyIcon}
              title={hasQuery ? "Nenhum resultado encontrado" : emptyTitle}
              description={
                hasQuery
                  ? "Ajuste a busca ou o filtro de estado para ver outros registros."
                  : emptyDescription
              }
              compact
            />
          </TableEmptyRow>
        ) : (
          children
        )}
      </TableShell>
    </div>
  );
}

export const catalogStatusOptions: FilterOption[] = [
  { value: "all", label: "Todos os estados" },
  { value: "active", label: "Ativos" },
  { value: "inactive", label: "Inativos" },
  { value: "archived", label: "Arquivados" },
];
