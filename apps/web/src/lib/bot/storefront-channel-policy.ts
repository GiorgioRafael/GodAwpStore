/** Operational chats and private order tickets must not become sales channels. */
export function isOperationalStorefrontChannel(name: string): boolean {
  const normalized = name.normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return /(^|-)ticket(-|$)|(^|-)chat-admin(-|$)/.test(normalized);
}
