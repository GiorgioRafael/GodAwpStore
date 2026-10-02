import type { Metadata } from "next";
import { ServerCog } from "lucide-react";

import { ResourcePage } from "@/components/admin/resource-page";
import { Badge } from "@/components/ui/badge";
import { listOperationalRows } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Servidores" };

const statusLabels: Record<string, string> = {
  active: "Ativo", suspended: "Suspenso", left: "Desconectado", archived: "Arquivado",
};

export default async function GuildsPage() {
  const rows = await listOperationalRows("guilds", 500);
  return (
    <ResourcePage
      eyebrow="Gestão"
      title="Servidores"
      description="Consulte os servidores conectados ao bot, seus responsáveis e a última atualização."
      columns={["Servidor", "Discord ID", "Responsável", "Status", "Entrada", "Última atividade"]}
      emptyIcon={ServerCog}
      emptyTitle="Nenhum servidor conectado"
      emptyDescription="Os servidores aparecem aqui quando o bot registra a primeira interação."
      readOnly
      recordCount={rows.length}
      searchValues={rows.map((row) => `${row.name} ${row.discord_guild_id} ${row.owner_discord_id} ${statusLabels[String(row.status)] ?? row.status}`)}
      rows={rows.map((row) => (
        <tr key={String(row.id)} className="border-b border-border/70 last:border-b-0">
          <td className="px-5 py-4 text-sm font-medium">{String(row.name)}</td>
          <td className="px-5 py-4 font-mono text-xs text-muted">{String(row.discord_guild_id)}</td>
          <td className="px-5 py-4 font-mono text-xs text-muted-strong">{String(row.owner_discord_id)}</td>
          <td className="px-5 py-4"><Badge tone={row.status === "active" ? "success" : "neutral"}>{statusLabels[String(row.status)] ?? String(row.status)}</Badge></td>
          <td className="px-5 py-4 text-xs text-muted">{row.joined_at ? new Date(String(row.joined_at)).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</td>
          <td className="px-5 py-4 text-xs text-muted">{new Date(String(row.updated_at)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
        </tr>
      ))}
    />
  );
}
