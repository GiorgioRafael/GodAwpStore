import { describe, expect, it } from "vitest";

import { isPublicAdminPanelPath } from "./admin-routes";

// Toda rota do app, tirada da árvore de arquivos. Se uma página nova aparecer
// sem entrar nesta lista, o teste de cobertura abaixo não vai saber dela — mas
// o allow-list falha fechado, então ela nasce protegida.
const ADMIN_PATHS = [
  "/",
  "/auditoria",
  "/catalogo/jogos",
  "/catalogo/produtos",
  "/catalogo/sublojas",
  "/configuracoes",
  "/customizacao-bot",
  "/dashboard",
  "/estoque",
  "/metricas-roleta",
  "/pedidos",
  "/resgates",
  "/saldos",
  "/saques",
  "/servidores",
  "/sorteios",
  "/whitelist",
];

const PUBLIC_PATHS = [
  "/login",
  "/acesso-negado",
  "/roleta",
  "/roleta/overlay",
  "/pagamento/9c000000-0000-4000-8000-000000000001",
  "/sorteios/promo-de-julho",
  "/auth/callback",
  "/auth/login",
  "/auth/logout",
  "/api/webhooks/livepix",
  "/api/webhooks/discord",
  "/api/sorteios/oauth/iniciar",
  "/api/sorteios/oauth/retorno",
  "/api/cron/discord-ticket-close-reconciliation",
];

describe("portaria do painel", () => {
  it("protege toda página do grupo (admin)", () => {
    for (const path of ADMIN_PATHS) {
      expect(isPublicAdminPanelPath(path), path).toBe(false);
    }
  });

  it("deixa passar o que jogador, Discord e LivePix precisam alcançar", () => {
    for (const path of PUBLIC_PATHS) {
      expect(isPublicAdminPanelPath(path), path).toBe(true);
    }
  });

  it("separa a lista de sorteios da página pública de um sorteio", () => {
    // /sorteios é o painel; /sorteios/<slug> é o link que vai para o Discord.
    expect(isPublicAdminPanelPath("/sorteios")).toBe(false);
    expect(isPublicAdminPanelPath("/sorteios/")).toBe(false);
    expect(isPublicAdminPanelPath("/sorteios/qualquer-coisa")).toBe(true);
  });

  it("não cai em barra sobrando nem em barra dobrada", () => {
    expect(isPublicAdminPanelPath("/pedidos/")).toBe(false);
    expect(isPublicAdminPanelPath("//pedidos")).toBe(false);
    expect(isPublicAdminPanelPath("/configuracoes//")).toBe(false);
    expect(isPublicAdminPanelPath("/roleta/")).toBe(true);
  });

  it("não deixa um prefixo público cobrir uma rota parecida", () => {
    // "/roleta" libera "/roleta/overlay", mas não pode liberar uma página de
    // painel que só começa com as mesmas letras.
    expect(isPublicAdminPanelPath("/roletagem-secreta")).toBe(false);
    expect(isPublicAdminPanelPath("/loginhistorico")).toBe(false);
    expect(isPublicAdminPanelPath("/apisecreta")).toBe(false);
  });

  it("uma página de painel que ninguém lembrou de listar nasce protegida", () => {
    expect(isPublicAdminPanelPath("/relatorio-que-ainda-nao-existe")).toBe(false);
  });
});
