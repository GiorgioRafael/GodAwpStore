import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Database, Plus } from "lucide-react";
import { PageHeader } from "./page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ResourceTable } from "./resource-table";

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
  rows?: ReactNode[];
  searchValues?: string[];
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
  searchValues,
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

      <ResourceTable
        title={title}
        columns={columns}
        rows={recordCount > 0 ? rows ?? [] : []}
        searchValues={searchValues}
        readOnly={readOnly}
        hint={toolbarHint}
        emptyState={<EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} compact />}
      />
    </div>
  );
}
