import type { Metadata } from "next";

import { BotCustomizationEditor } from "@/components/admin/bot-customization-editor";
import { Notice } from "@/components/admin/notice";
import { PageHeader } from "@/components/admin/page-header";
import {
  DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  normalizeBotMessageCustomization,
} from "@/lib/bot/message-customization";
import { normalizeTicketNotificationDiscordUserIds } from "@/lib/bot/ticket-notifications";
import { getPlatformSettings } from "@/lib/data/admin-repository";

export const metadata: Metadata = { title: "Customização do bot" };

export default async function BotCustomizationPage() {
  const settings = await getPlatformSettings();
  const customization = normalizeBotMessageCustomization(
    settings?.bot_message_config ?? DEFAULT_BOT_MESSAGE_CUSTOMIZATION,
  );
  const notificationDiscordUserIds = normalizeTicketNotificationDiscordUserIds(
    settings?.ticket_notification_discord_user_ids,
  );

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Discord"
        title="Customização do bot"
        description="Edite os textos das mensagens enviadas pelo bot e acompanhe o resultado em uma prévia ao vivo."
      />

      <Notice>
        Esta personalização é global e será usada em todos os servidores. Os campos aceitam emojis,
        Markdown do Discord e as variáveis indicadas em cada mensagem.
      </Notice>

      <BotCustomizationEditor
        initialConfig={customization}
        initialNotificationDiscordUserIds={notificationDiscordUserIds}
        updatedAt={settings?.updated_at ?? null}
      />
    </div>
  );
}
