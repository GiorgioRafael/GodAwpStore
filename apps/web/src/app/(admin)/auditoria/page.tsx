import type { Metadata } from "next";
import { ScrollText } from "lucide-react";

import { ResourcePage } from "@/components/admin/resource-page";
import { listAuditEvents } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Auditoria" };

function date(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

export default async function AuditPage() {
  const events = await listAuditEvents(500);
  return (
    <ResourcePage
      eyebrow="Sistema"
      title="Auditoria"
      description="Rastreie ações administrativas sensíveis por ator, recurso e momento, sem registrar conteúdo secreto."
      columns={["Data e hora", "Ator", "Ação", "Recurso", "Identificador", "Contexto"]}
      emptyIcon={ScrollText}
      emptyTitle="Nenhum evento de auditoria"
      emptyDescription="Entradas serão criadas quando administradores começarem a alterar recursos ou revelar unidades."
      readOnly
      toolbarHint="Datas exibidas no fuso de São Paulo."
      recordCount={events.length}
      rows={events.map((event) => (
        <tr key={event.id} className="border-b border-border/70 last:border-b-0">
          <td className="px-5 py-4 whitespace-nowrap text-xs text-muted">{date(event.created_at)}</td>
          <td className="px-5 py-4 font-mono text-xs text-muted-strong">{event.actor_discord_user_id ?? "Sistema"}</td>
          <td className="px-5 py-4 text-sm font-medium">{event.action}</td>
          <td className="px-5 py-4 text-sm text-muted-strong">{event.entity_type}</td>
          <td className="px-5 py-4 font-mono text-xs text-muted" title={event.entity_id ?? undefined}>{event.entity_id ? `${event.entity_id.slice(0, 8)}…` : "—"}</td>
          <td className="max-w-72 truncate px-5 py-4 font-mono text-xs text-muted" title={JSON.stringify(event.metadata)}>{Object.keys(event.metadata).length ? JSON.stringify(event.metadata) : "—"}</td>
        </tr>
      ))}
    />
  );
}
