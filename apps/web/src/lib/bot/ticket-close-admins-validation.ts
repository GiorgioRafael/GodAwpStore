import { z } from "zod";

import {
  MAX_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS,
} from "./ticket-close-admins";
import { DISCORD_USER_ID_PATTERN } from "./ticket-notifications";

export const ticketCloseAdminDiscordUserIdSchema = z
  .string()
  .trim()
  .regex(DISCORD_USER_ID_PATTERN, "Informe um ID de usuário do Discord válido.");

export const ticketCloseAdminDiscordUserIdsSchema = z
  .array(ticketCloseAdminDiscordUserIdSchema)
  .max(
    MAX_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS,
    `Adicione no máximo ${MAX_TICKET_CLOSE_ADMIN_DISCORD_USER_IDS} administradores para fechamento.`,
  )
  .superRefine((userIds, context) => {
    const seen = new Set<string>();
    userIds.forEach((userId, index) => {
      if (seen.has(userId)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Este administrador já está na lista de fechamento.",
        });
      }
      seen.add(userId);
    });
  });
