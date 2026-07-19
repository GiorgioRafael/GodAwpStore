import { synchronizeAllOpenDiscordTicketControls } from "../src/lib/bot/discord-ticket-controls-sync";

async function main() {
  if (process.env.CONFIRM_TICKET_CONTROL_SYNC !== "1") {
    throw new Error(
      "Defina CONFIRM_TICKET_CONTROL_SYNC=1 para confirmar a atualização dos tickets Discord abertos.",
    );
  }

  const result = await synchronizeAllOpenDiscordTicketControls();

  console.log(
    [
      `Tickets processados: ${result.processed}`,
      `sincronizados: ${result.synchronized}`,
      `falhas: ${result.failed}`,
      `permissões atualizadas: ${result.permissionsUpdated}`,
      `mensagens atualizadas: ${result.welcomeMessagesUpdated}`,
    ].join("; "),
  );

  if (result.failed > 0) process.exitCode = 1;
}

void main();
