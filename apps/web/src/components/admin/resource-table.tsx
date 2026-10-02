"use client";

import { useState, type ReactNode } from "react";
import { Search, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form-field";
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";

interface ResourceTableProps {
  title: string;
  columns: string[];
  rows: ReactNode[];
  searchValues?: string[];
  emptyState: ReactNode;
  hint?: string;
  readOnly: boolean;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function ResourceTable({ title, columns, rows, searchValues, emptyState, hint, readOnly }: ResourceTableProps) {
  const [search, setSearch] = useState("");
  const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
  const visible = rows.filter((_, index) => {
    const value = normalize(searchValues?.[index] ?? "");
    return terms.every((term) => value.includes(term));
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {searchValues ? (
            <div className="relative flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                type="search"
                aria-label={`Buscar em ${title.toLowerCase()}`}
                className="pl-10"
                placeholder="Buscar nome, ID ou termo..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          ) : null}
          {search ? <Button variant="ghost" onClick={() => setSearch("")}>Limpar busca</Button> : null}
          {readOnly ? <span className="self-start rounded-lg border border-border px-3 py-2 text-xs text-muted-strong sm:self-auto">Somente consulta</span> : null}
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted">
          <span role="status" aria-live="polite" aria-atomic="true">
            {terms.length ? `${visible.length} de ${rows.length} registros encontrados` : `${rows.length} registros carregados`}
          </span>
          <span>{hint ?? "Busca nos registros carregados nesta página."}</span>
        </div>
      </Card>
      <TableShell columns={columns} caption={`Tabela de ${title.toLowerCase()}`}>
        {visible.length ? visible : (
          <TableEmptyRow colSpan={columns.length}>
            {terms.length ? (
              <EmptyState
                icon={SearchX}
                title="Nenhum resultado encontrado"
                description="Tente outro nome, ID ou termo de busca."
                action={<Button variant="secondary" onClick={() => setSearch("")}>Limpar busca</Button>}
                compact
              />
            ) : emptyState}
          </TableEmptyRow>
        )}
      </TableShell>
    </div>
  );
}
