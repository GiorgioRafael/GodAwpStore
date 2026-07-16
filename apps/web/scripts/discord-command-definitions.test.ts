import { describe, expect, it } from "vitest";

import { discordCommands } from "./discord-command-definitions.js";

describe("Discord slash commands", () => {
  it("registra somente /loja e /ajuda, desabilitados em DM", () => {
    expect(discordCommands.map((command) => command.name)).toEqual(["loja", "ajuda"]);
    expect(new Set(discordCommands.map((command) => command.name)).size).toBe(discordCommands.length);
    expect(discordCommands.every((command) => command.type === 1 && command.dm_permission === false)).toBe(true);
  });
});
