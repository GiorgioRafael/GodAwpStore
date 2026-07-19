import { z } from "zod";

import {
  DISCORD_USER_ID_PATTERN,
  MAX_TICKET_NOTIFICATION_DISCORD_USER_IDS,
} from "./ticket-notifications";

export const ticketNotificationDiscordUserIdSchema = z
  .string()
  .trim()
  .regex(DISCORD_USER_ID_PATTERN, "Informe um ID de usuário do Discord válido.");

export const ticketNotificationDiscordUserIdsSchema = z
  .array(ticketNotificationDiscordUserIdSchema)
  .max(
    MAX_TICKET_NOTIFICATION_DISCORD_USER_IDS,
    `Adicione no máximo ${MAX_TICKET_NOTIFICATION_DISCORD_USER_IDS} usuários para notificação.`,
  )
  .superRefine((userIds, context) => {
    const seen = new Set<string>();
    userIds.forEach((userId, index) => {
      if (seen.has(userId)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Este usuário já está na lista de notificações.",
        });
      }
      seen.add(userId);
    });
  });
