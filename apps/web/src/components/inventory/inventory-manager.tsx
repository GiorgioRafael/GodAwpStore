"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Check,
  Clipboard,
  Eye,
  FileUp,
  PackageCheck,
  Plus,
  Search,
  ShieldAlert,
  Clock3,
} from "lucide-react";

import { changeInventoryStatusAction } from "@/app/actions/admin";
import { MetricCard } from "@/components/admin/metric-card";
import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/form-field";
import { TableEmptyRow, TableShell } from "@/components/ui/table-shell";

type UnitStatus = "available" | "reserved" | "delivered" | "quarantined" | "revoked";

export type InventoryProduct = { id: string; name: string; status: string };
export type InventoryStock = {
  productId: string;
  available: number;
  reserved: number;
  low: boolean;
};
export type InventoryUnit = {
  id: string;
  productId: string;
  productName: string;
  batchId: string | null;
  batchSource: string | null;
  status: UnitStatus;
  createdAt: string;
  updatedAt: string;
};
export type InventoryBatch = {
  id: string;
  productId: string;
  productName: string;
  source: string;
  importMethod: "manual" | "txt" | "csv";
  unitCount: number;
  createdAt: string;
};

type PreviewEntry = {
  lineNumber: number;
  maskedSecret: string;
  duplicateInStock: boolean;
};
type Preview = {
  valid: boolean;
  count: number;
  entries: PreviewEntry[];
  issues: Array<{ message?: string }>;
};

const statusLabels: Record<UnitStatus, string> = {
  available: "Disponível",
  reserved: "Reservada",
  delivered: "Entregue",
  quarantined: "Quarentena",
  revoked: "Revogada",
};

const statusTones: Record<UnitStatus, "success" | "warning" | "gold" | "danger" | "neutral"> = {
  available: "success",
  reserved: "warning",
  delivered: "gold",
  quarantined: "warning",
  revoked: "danger",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function compactId(value: string | null) {
  if (!value) return "—";
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function InventoryManager({
  products,
  stock,
  units,
  batches,
}: {
  products: InventoryProduct[];
  stock: InventoryStock[];
  units: InventoryUnit[];
  batches: InventoryBatch[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<"units" | "batches">("units");
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [importMethod, setImportMethod] = useState<"manual" | "txt" | "csv">("manual");
  const [productId, setProductId] = useState(products.find((product) => product.status !== "archived")?.id ?? "");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealUnit, setRevealUnit] = useState<InventoryUnit | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const available = stock.reduce((total, row) => total + row.available, 0);
  const reserved = stock.reduce((total, row) => total + row.reserved, 0);
  const low = stock.filter((row) => row.low).length;

  const filteredUnits = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return units.filter((unit) => {
      const matchesSearch =
        !term ||
        [unit.id, unit.productName, unit.batchId, unit.batchSource]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(term));
      return (
        matchesSearch &&
        (!productFilter || unit.productId === productFilter) &&
        (!statusFilter || unit.status === statusFilter)
      );
    });
  }, [productFilter, search, statusFilter, units]);

  const filteredBatches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return batches.filter((batch) => {
      const matchesSearch =
        !term ||
        [batch.id, batch.productName, batch.source]
          .some((value) => value.toLocaleLowerCase("pt-BR").includes(term));
      return matchesSearch && (!productFilter || batch.productId === productFilter);
    });
  }, [batches, productFilter, search]);

  function beginImport(method: "manual" | "txt") {
    setImportMethod(method);
    setContent("");
    setSource("");
    setPreview(null);
    setFeedback(null);
    setRequestId(crypto.randomUUID());
    setImportOpen(true);
  }

  function closeImport() {
    setImportOpen(false);
    setContent("");
    setPreview(null);
    setFeedback(null);
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension !== "txt" && extension !== "csv") {
      setFeedback("Selecione um arquivo TXT ou CSV.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setFeedback("O arquivo deve ter no máximo 2 MB.");
      return;
    }
    setImportMethod(extension);
    setSource(file.name);
    setContent(await file.text());
    setPreview(null);
    setFeedback(null);
  }

  async function requestImport(mode: "preview" | "commit") {
    if (!productId || !content.trim()) {
      setFeedback("Escolha um produto e informe pelo menos uma unidade.");
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/inventory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          productId,
          requestId,
          format: importMethod === "csv" ? "csv" : "txt",
          importMethod,
          content,
          source: source.trim() || null,
        }),
      });
      const result = (await response.json()) as Preview & { error?: string; importedCount?: number };

      if (mode === "preview") {
        setPreview({
          valid: Boolean(result.valid),
          count: Number(result.count ?? 0),
          entries: Array.isArray(result.entries) ? result.entries : [],
          issues: Array.isArray(result.issues) ? result.issues : [],
        });
        if (!response.ok || !result.valid) {
          setFeedback(result.error ?? result.issues?.[0]?.message ?? "Resolva os problemas da prévia.");
        }
        return;
      }

      if (!response.ok) {
        setFeedback(result.error ?? "Não foi possível importar o lote.");
        return;
      }
      closeImport();
      startTransition(() => router.refresh());
    } catch {
      setFeedback("Não foi possível comunicar com o servidor.");
    } finally {
      setBusy(false);
    }
  }

  async function reveal(unit: InventoryUnit) {
    setRevealUnit(unit);
    setRevealedSecret(null);
    setCopied(false);
    try {
      const response = await fetch(`/api/admin/inventory/${unit.id}/reveal`, {
        method: "POST",
        cache: "no-store",
      });
      const result = (await response.json()) as { secret?: string; error?: string };
      setRevealedSecret(response.ok && result.secret ? result.secret : result.error ?? "Falha ao revelar a unidade.");
    } catch {
      setRevealedSecret("Falha ao revelar a unidade.");
    }
  }

  function closeReveal() {
    setRevealUnit(null);
    setRevealedSecret(null);
    setCopied(false);
  }

  function updateStatus(unitId: string, status: "available" | "quarantined" | "revoked") {
    const confirmed = status !== "revoked" || window.confirm("Revogar esta unidade? Ela deixará de ficar disponível.");
    if (!confirmed) return;
    startTransition(async () => {
      const result = await changeInventoryStatusAction({ unitId, status, reason: null });
      if (!result.ok) window.alert(result.message);
      router.refresh();
    });
  }

  const metrics = [
    { label: "Disponíveis", value: String(available), detail: "Unidades prontas para reserva", icon: PackageCheck },
    { label: "Reservadas", value: String(reserved), detail: "Aguardando conclusão do pedido", icon: Clock3 },
    { label: "Em alerta", value: String(low), detail: "Produtos abaixo do limite", icon: ShieldAlert },
  ];

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Catálogo"
        title="Estoque seguro"
        description="Gerencie unidades por produto e lote. Quantidades são sempre calculadas pelo estado de cada unidade."
        actions={
          <>
            <Button variant="secondary" onClick={() => beginImport("manual")} disabled={!products.length}>
              <Plus aria-hidden="true" className="size-4" />
              Unidade manual
            </Button>
            <Button onClick={() => beginImport("txt")} disabled={!products.length}>
              <FileUp aria-hidden="true" className="size-4" />
              Importar lote
            </Button>
          </>
        }
      />

      <Notice>
        Conteúdos permanecem mascarados. Revelar uma unidade exige uma ação explícita, não usa cache e gera auditoria.
      </Notice>

      <section aria-label="Resumo do estoque" className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </section>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              aria-label="Buscar unidade ou lote"
              className="pl-10"
              placeholder="Buscar por produto, lote ou UUID..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select aria-label="Filtrar por produto" value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
            <option value="">Todos os produtos</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </Select>
          {tab === "units" ? (
            <Select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos os estados</option>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          ) : null}
        </div>
        <p className="mt-3 border-t border-border pt-3 text-right text-xs text-muted">
          {tab === "units" ? filteredUnits.length : filteredBatches.length} registros
        </p>
      </Card>

      <div>
        <div className="mb-3 flex items-center gap-1 rounded-xl border border-border bg-surface-muted p-1 sm:w-fit">
          <Button variant={tab === "units" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("units")}>Unidades</Button>
          <Button variant={tab === "batches" ? "secondary" : "ghost"} size="sm" onClick={() => setTab("batches")}>Lotes</Button>
        </div>

        {tab === "units" ? (
          <TableShell columns={["UUID", "Produto", "Lote", "Estado", "Incluída em", "Ações"]} caption="Unidades do estoque">
            {filteredUnits.length ? filteredUnits.map((unit) => (
              <tr key={unit.id} className="border-b border-border/70 last:border-b-0">
                <td className="px-5 py-4 font-mono text-xs text-muted-strong" title={unit.id}>{compactId(unit.id)}</td>
                <td className="px-5 py-4 text-sm font-medium">{unit.productName}</td>
                <td className="px-5 py-4 text-xs text-muted" title={unit.batchId ?? undefined}>{unit.batchSource ?? compactId(unit.batchId)}</td>
                <td className="px-5 py-4"><Badge tone={statusTones[unit.status]}>{statusLabels[unit.status]}</Badge></td>
                <td className="px-5 py-4 text-xs text-muted">{formatDate(unit.createdAt)}</td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => reveal(unit)}>
                      <Eye aria-hidden="true" className="size-4" /> Revelar
                    </Button>
                    {unit.status === "available" ? (
                      <Button variant="secondary" size="sm" disabled={isPending} onClick={() => updateStatus(unit.id, "quarantined")}>Quarentena</Button>
                    ) : unit.status === "quarantined" ? (
                      <Button variant="secondary" size="sm" disabled={isPending} onClick={() => updateStatus(unit.id, "available")}>Disponibilizar</Button>
                    ) : null}
                    {(unit.status === "available" || unit.status === "quarantined") ? (
                      <Button variant="danger" size="sm" disabled={isPending} onClick={() => updateStatus(unit.id, "revoked")}>Revogar</Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )) : (
              <TableEmptyRow colSpan={6}>
                <EmptyState icon={Boxes} title="Nenhuma unidade encontrada" description={units.length ? "Ajuste os filtros para ver outras unidades." : "Adicione uma unidade manual ou importe um arquivo TXT/CSV."} compact />
              </TableEmptyRow>
            )}
          </TableShell>
        ) : (
          <TableShell columns={["Lote", "Produto", "Origem", "Método", "Unidades", "Criado em"]} caption="Lotes de estoque">
            {filteredBatches.length ? filteredBatches.map((batch) => (
              <tr key={batch.id} className="border-b border-border/70 last:border-b-0">
                <td className="px-5 py-4 font-mono text-xs text-muted-strong" title={batch.id}>{compactId(batch.id)}</td>
                <td className="px-5 py-4 text-sm font-medium">{batch.productName}</td>
                <td className="px-5 py-4 text-sm text-muted-strong">{batch.source}</td>
                <td className="px-5 py-4"><Badge>{batch.importMethod.toUpperCase()}</Badge></td>
                <td className="px-5 py-4 text-sm">{batch.unitCount}</td>
                <td className="px-5 py-4 text-xs text-muted">{formatDate(batch.createdAt)}</td>
              </tr>
            )) : (
              <TableEmptyRow colSpan={6}>
                <EmptyState icon={Boxes} title="Nenhum lote encontrado" description="Os lotes aparecerão aqui após uma importação confirmada." compact />
              </TableEmptyRow>
            )}
          </TableShell>
        )}
      </div>

      <Dialog
        open={importOpen}
        onClose={closeImport}
        title={importMethod === "manual" ? "Adicionar unidade" : "Importar lote"}
        description="A prévia mascara os conteúdos e bloqueia duplicidades antes da gravação atômica."
        footer={
          <>
            <Button variant="ghost" onClick={closeImport}>Cancelar</Button>
            <Button variant="secondary" onClick={() => requestImport("preview")} disabled={busy}>Gerar prévia</Button>
            <Button onClick={() => requestImport("commit")} disabled={busy || !preview?.valid}>Confirmar {preview?.count ? `(${preview.count})` : ""}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Produto" htmlFor="inventory-product">
            <Select id="inventory-product" value={productId} onChange={(event) => { setProductId(event.target.value); setPreview(null); }}>
              <option value="">Selecione...</option>
              {products.filter((product) => product.status !== "archived").map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </Select>
          </Field>

          {importMethod === "manual" ? (
            <Field label="Conteúdo secreto" htmlFor="manual-secret" hint="Uma unidade">
              <Textarea id="manual-secret" value={content} onChange={(event) => { setContent(event.target.value); setPreview(null); }} autoComplete="off" spellCheck={false} />
            </Field>
          ) : (
            <Field label="Arquivo" htmlFor="inventory-file" hint="TXT ou CSV, até 2 MB">
              <Input id="inventory-file" type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(event) => readFile(event.target.files?.[0])} />
            </Field>
          )}

          <Field label="Origem do lote" htmlFor="inventory-source" hint="Opcional">
            <Input id="inventory-source" value={source} onChange={(event) => setSource(event.target.value)} maxLength={255} placeholder="Ex.: fornecedor-julho" />
          </Field>

          {feedback ? <p role="alert" className="rounded-xl border border-danger/25 bg-danger/10 p-3 text-sm text-[#ffaaa7]">{feedback}</p> : null}
          {preview ? (
            <Card className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">Prévia do lote</p>
                <Badge tone={preview.valid ? "success" : "danger"}>{preview.count} unidades</Badge>
              </div>
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto font-mono text-xs text-muted">
                {preview.entries.slice(0, 100).map((entry) => (
                  <div key={entry.lineNumber} className="flex justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2">
                    <span>Linha {entry.lineNumber}</span>
                    <span>{entry.maskedSecret}</span>
                    {entry.duplicateInStock ? <span className="text-danger">Duplicada</span> : <Check className="size-3.5 text-success" />}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(revealUnit)}
        onClose={closeReveal}
        title="Conteúdo revelado"
        description="Esta ação já foi registrada na auditoria. Feche a janela assim que terminar."
        footer={
          <>
            <Button variant="ghost" onClick={closeReveal}>Fechar e ocultar</Button>
            <Button
              onClick={async () => {
                if (!revealedSecret) return;
                await navigator.clipboard.writeText(revealedSecret);
                setCopied(true);
              }}
              disabled={!revealedSecret}
            >
              {copied ? <Check aria-hidden="true" className="size-4" /> : <Clipboard aria-hidden="true" className="size-4" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-warning/25 bg-warning/[0.06] p-4">
          <p className="break-all font-mono text-sm leading-6 text-foreground">{revealedSecret ?? "Descriptografando…"}</p>
        </div>
      </Dialog>
    </div>
  );
}
