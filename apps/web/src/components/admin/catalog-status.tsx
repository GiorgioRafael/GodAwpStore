import { Badge } from "@/components/ui/badge";

type CatalogStatus = "active" | "inactive" | "archived";

const labels: Record<CatalogStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
  archived: "Arquivado",
};

export function CatalogStatusBadge({ status }: { status: CatalogStatus }) {
  return (
    <Badge tone={status === "active" ? "success" : status === "archived" ? "danger" : "warning"}>
      {labels[status]}
    </Badge>
  );
}

export const editableCatalogStatuses = [
  { value: "active", label: "Ativo" },
  { value: "inactive", label: "Inativo" },
  { value: "archived", label: "Arquivado" },
] as const;
