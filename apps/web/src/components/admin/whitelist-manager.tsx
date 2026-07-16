"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Archive, LoaderCircle, Pencil, ShieldCheck } from "lucide-react";

import { saveWhitelistAction } from "@/app/actions/admin";
import { ActionFeedback, fieldError, initialAdminActionState } from "@/components/admin/action-feedback";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { formatCommission, formatCommissionForInput, formatDateTime } from "@/components/admin/admin-format";
import { ArchiveDialog } from "@/components/admin/archive-dialog";
import { ResourceManagerShell } from "@/components/admin/resource-manager-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form-field";
import type { WhitelistRow } from "@/lib/data/admin-repository";

interface WhitelistManagerProps {
  entries: WhitelistRow[];
  globalCommissionBps: number;
  guildCounts: Record<string, number>;
}

const whitelistFilters = [
  { value: "all", label: "Todos os estados" },
  { value: "active", label: "Autorizados" },
  { value: "archived", label: "Arquivados" },
];

function WhitelistForm({
  entry,
  globalCommissionBps,
  onClose,
}: {
  entry: WhitelistRow | null;
  globalCommissionBps: number;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveWhitelistAction, initialAdminActionState);
  const formId = useId();

  return (
    <AdminDialog
      open
      onClose={onClose}
      title={entry ? "Editar whitelist" : "Adicionar Discord ID"}
      description="Autorize o responsável e, se necessário, substitua a comissão global."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {pending ? "Salvando..." : "Salvar autorização"}
          </Button>
        </>
      }
    >
      <form id={formId} action={formAction} className="space-y-5">
        <input type="hidden" name="id" value={entry?.id ?? ""} />
        <ActionFeedback state={state} />

        <Field
          label="Discord ID"
          htmlFor={`${formId}-discord-id`}
          hint="17 a 20 dígitos"
          error={fieldError(state, "discordId")}
        >
          <Input
            id={`${formId}-discord-id`}
            name="discordId"
            inputMode="numeric"
            defaultValue={entry?.discord_id ?? ""}
            minLength={17}
            maxLength={20}
            pattern="[0-9]{17,20}"
            required
            autoFocus
            autoComplete="off"
          />
        </Field>

        <Field
          label="Identificação"
          htmlFor={`${formId}-label`}
          hint="Opcional"
          error={fieldError(state, "label") ?? fieldError(state, "form")}
        >
          <Input
            id={`${formId}-label`}
            name="label"
            defaultValue={entry?.label ?? ""}
            maxLength={120}
            placeholder="Nome do responsável ou da operação"
          />
        </Field>

        <Field
          label="Exceção de comissão"
          htmlFor={`${formId}-commission`}
          hint={`Global: ${formatCommission(globalCommissionBps)}`}
          error={fieldError(state, "commissionOverrideBps")}
        >
          <div className="relative">
            <Input
              id={`${formId}-commission`}
              name="commissionOverridePercent"
              inputMode="decimal"
              defaultValue={
                entry?.commission_override_bps == null
                  ? ""
                  : formatCommissionForInput(entry.commission_override_bps)
              }
              placeholder="Usar comissão global"
              className="pr-10"
            />
            <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
          </div>
        </Field>

        <Field label="Notas internas" htmlFor={`${formId}-notes`} hint="Opcional" error={fieldError(state, "notes")}>
          <Textarea
            id={`${formId}-notes`}
            name="notes"
            defaultValue={entry?.notes ?? ""}
            maxLength={2_000}
          />
        </Field>

        <label
          htmlFor={`${formId}-active`}
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-muted p-4"
        >
          <input
            id={`${formId}-active`}
            name="active"
            type="checkbox"
            defaultChecked={entry?.is_active ?? true}
            className="mt-0.5 size-4 accent-gold"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">Autorização ativa</span>
            <span className="mt-1 block text-xs leading-5 text-muted">
              Ao reativar, este Discord ID volta a poder ser associado a servidores.
            </span>
          </span>
        </label>
      </form>
    </AdminDialog>
  );
}

export function WhitelistManager({ entries, globalCommissionBps, guildCounts }: WhitelistManagerProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<
    { mode: "create" } | { mode: "edit"; entry: WhitelistRow } | null
  >(null);
  const [archiveRecord, setArchiveRecord] = useState<{ id: string; label: string } | null>(null);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return entries.filter((entry) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "active" ? entry.is_active : !entry.is_active || Boolean(entry.archived_at));
      const matchesSearch =
        !query ||
        entry.discord_id.includes(query) ||
        entry.label?.toLocaleLowerCase("pt-BR").includes(query) ||
        entry.notes?.toLocaleLowerCase("pt-BR").includes(query);
      return matchesFilter && Boolean(matchesSearch);
    });
  }, [entries, filter, search]);

  const editingEntry = editor?.mode === "edit" ? editor.entry : null;

  return (
    <>
      <ResourceManagerShell
        eyebrow="Gestão"
        title="Whitelist"
        description="Autorize responsáveis por servidor e defina exceções individuais de comissão quando necessário."
        actionLabel="Adicionar Discord ID"
        onCreate={() => setEditor({ mode: "create" })}
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        filterOptions={whitelistFilters}
        columns={["Discord ID", "Responsável", "Comissão efetiva", "Servidores", "Status", "Atualizado em", "Ações"]}
        totalCount={entries.length}
        visibleCount={filteredEntries.length}
        emptyIcon={ShieldCheck}
        emptyTitle="Whitelist vazia"
        emptyDescription="Nenhum Discord ID foi autorizado. O bot não deve permanecer em servidores sem um responsável ativo."
      >
        {filteredEntries.map((entry) => {
          const commission = entry.commission_override_bps ?? globalCommissionBps;
          return (
            <tr key={entry.id} className="border-b border-border/80 last:border-0">
              <td className="whitespace-nowrap px-5 py-4 font-mono text-sm text-foreground">{entry.discord_id}</td>
              <td className="px-5 py-4">
                <p className="text-sm font-medium text-foreground">{entry.label || "Sem identificação"}</p>
                {entry.notes ? <p className="mt-1 max-w-52 truncate text-xs text-muted">{entry.notes}</p> : null}
              </td>
              <td className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{formatCommission(commission)}</span>
                  {entry.commission_override_bps != null ? <Badge tone="gold">Exceção</Badge> : <Badge tone="neutral">Global</Badge>}
                </div>
              </td>
              <td className="px-5 py-4 text-sm text-muted-strong">{(guildCounts[entry.id] ?? 0).toLocaleString("pt-BR")}</td>
              <td className="px-5 py-4">
                <Badge tone={entry.is_active ? "success" : "danger"}>{entry.is_active ? "Autorizado" : "Arquivado"}</Badge>
              </td>
              <td className="whitespace-nowrap px-5 py-4 text-xs text-muted">
                <time dateTime={entry.updated_at}>{formatDateTime(entry.updated_at)}</time>
              </td>
              <td className="px-5 py-4">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditor({ mode: "edit", entry })}>
                    <Pencil aria-hidden="true" className="size-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-danger"
                    aria-label={`Arquivar ${entry.label || entry.discord_id}`}
                    title={!entry.is_active ? "Discord ID já arquivado" : "Arquivar Discord ID"}
                    disabled={!entry.is_active}
                    onClick={() => setArchiveRecord({ id: entry.id, label: entry.label || entry.discord_id })}
                  >
                    <Archive aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
      </ResourceManagerShell>

      {editor ? (
        <WhitelistForm
          key={editingEntry?.id ?? "new-whitelist-entry"}
          entry={editingEntry}
          globalCommissionBps={globalCommissionBps}
          onClose={() => setEditor(null)}
        />
      ) : null}
      <ArchiveDialog
        key={archiveRecord?.id ?? "archive-whitelist"}
        target="whitelist"
        record={archiveRecord}
        noun="Discord ID"
        onClose={() => setArchiveRecord(null)}
      />
    </>
  );
}
