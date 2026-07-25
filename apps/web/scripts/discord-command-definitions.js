const storeName = (
  process.env.NEXT_PUBLIC_STORE_NAME?.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  || "GWStore"
).slice(0, 40);

export const discordCommands = Object.freeze([
  Object.freeze({
    name: "loja",
    description: `Mostra o catálogo, os preços e o estoque da ${storeName}`.slice(0, 100),
    type: 1,
    dm_permission: false,
  }),
  Object.freeze({
    name: "ajuda",
    description: `Explica como comprar na ${storeName}`.slice(0, 100),
    type: 1,
    dm_permission: false,
  }),
  Object.freeze({
    name: "rank",
    description: "Mostra seu total gasto e o progresso até o próximo ranking",
    type: 1,
    dm_permission: false,
  }),
]);
