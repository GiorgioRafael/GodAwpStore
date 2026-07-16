import type { Metadata } from "next";

import { WhitelistManager } from "@/components/admin/whitelist-manager";
import {
  getPlatformSettings,
  listOperationalRows,
  listWhitelist,
} from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Whitelist" };

export default async function WhitelistPage() {
  const [entries, settings, guildRows] = await Promise.all([
    listWhitelist(),
    getPlatformSettings(),
    listOperationalRows("guilds", 500),
  ]);
  const parsedCommission = Number(settings?.global_commission_bps ?? 3_000);
  const globalCommissionBps = Number.isInteger(parsedCommission) ? parsedCommission : 3_000;
  const guildCounts: Record<string, number> = {};

  for (const guild of guildRows) {
    const whitelistEntryId = guild.whitelist_entry_id;
    if (typeof whitelistEntryId === "string") {
      guildCounts[whitelistEntryId] = (guildCounts[whitelistEntryId] ?? 0) + 1;
    }
  }

  return (
    <WhitelistManager
      entries={entries}
      globalCommissionBps={globalCommissionBps}
      guildCounts={guildCounts}
    />
  );
}
