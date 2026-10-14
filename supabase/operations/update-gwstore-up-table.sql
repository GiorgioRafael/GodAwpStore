-- Apply the owner-supplied UP table only in the isolated GWStore project.
-- This is an explicit maintenance operation, never a shared schema migration.
-- Confirm project athucowvfccegkzgcnli in the SAME database session first:
-- set app.gwstore_confirmed_project_ref = 'athucowvfccegkzgcnli';
-- Reviewed live identities and slugs on 2026-10-14. Existing stock, manual pauses,
-- photos, emoji and historical orders are preserved. Only missing rows are activated.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog;

create temporary table gwstore_up_category_targets (
  substore_id uuid primary key,
  category_key text not null unique,
  category_name text not null,
  category_title text not null,
  sort_order integer not null unique,
  existed_in_previous_table boolean not null
) on commit drop;

insert into pg_temp.gwstore_up_category_targets values
  ('bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'geral', 'UP · UP geral', '📈 UP geral', 100, true),
  ('33902a3c-9897-57ea-9f5b-ea9511b3937f', 'maestria', 'UP · Maestria', '⚡ Maestria', 101, false),
  ('1488a262-d174-542d-8a0a-a4ebdf39a13d', 'estilos', 'UP · Estilos de luta', '🥋 Estilos de luta', 102, true),
  ('ea27fea1-f4b1-5143-916b-8db6acf808f3', 'espadas', 'UP · Espadas', '⚔️ Espadas', 103, true),
  ('097ae642-68a1-5495-a716-6660d294801b', 'armas', 'UP · Armas', '🔫 Armas', 104, true),
  ('f6e82506-17c8-5daf-9ba1-049ea2ae8202', 'racas', 'UP · Raças até V3', '🧬 Raças até V3', 105, true),
  ('8466def7-6971-5d2a-8224-d910124345a4', 'v4', 'UP · Raças V4', '⚙️ Raças V4', 106, true),
  ('7390a86e-86d9-5bb5-8d93-686b713b35dc', 'draco', 'UP · Raça Draco', '🐉 Raça Draco', 107, true),
  ('248372a2-153b-5278-9dee-c9988529354d', 'pacotes-draco', 'UP · Pacotes Draco', '🔥 Pacotes Draco', 108, true),
  ('6f2fe74d-ad43-5871-9d88-b237c0b4eea8', 'ilhas', 'UP · Ilhas', '🏝️ Ilhas', 109, true),
  ('18fceb1e-91f0-5d90-a51f-534c68395d88', 'bosses', 'UP · Bosses', '👹 Bosses', 110, true),
  ('2e290afe-9a6b-5dc1-b84e-b23ab28591a8', 'leviata', 'UP · Leviatã', '🌊 Leviatã', 111, true),
  ('3bf1f0a1-14aa-5fc0-87c7-b7a86830998e', 'hakis', 'UP · Hakis', '✨ Hakis', 112, true),
  ('cdb0ec36-b566-5aa7-b41d-266453496fe7', 'observacao', 'UP · Haki da observação', '👁️ Haki da observação', 113, true);

create temporary table gwstore_up_service_targets (
  product_id uuid primary key,
  substore_id uuid not null references pg_temp.gwstore_up_category_targets(substore_id),
  reviewed_slug text not null unique,
  product_name text not null,
  price_cents bigint not null check (price_cents >= 0),
  description text not null,
  sort_order integer not null,
  existed_in_previous_table boolean not null
) on commit drop;

insert into pg_temp.gwstore_up_service_targets values
  ('46f59e12-1f3e-51c5-bc6d-27bb549637dc', 'bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'up-geral-level-0-700', 'Level 0–700', 2000, 'Serviço completo. Pacote do nível 0 ao 700. Informe o nível atual no atendimento.', 0, false),
  ('a0b8b359-100f-56e5-8b82-babcebb90629', 'bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'up-geral-level-700-1500', 'Level 700–1500', 2500, 'Serviço completo. Pacote do nível 700 ao 1500. Informe o nível atual no atendimento.', 1, false),
  ('cf588c1d-51cb-557a-8d0a-69090ec4180c', 'bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'up-geral-level-1500-2800', 'Level 1500–2800', 4500, 'Serviço completo. Pacote do nível 1500 ao 2800. Informe o nível atual no atendimento.', 2, false),
  ('847545e9-cb9b-50db-bffd-237334e865f4', 'bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'level-100-niveis', 'Level avulso · 100 níveis', 350, 'Quantidade = pacotes de 100 níveis. Informe o nível atual e o nível desejado no atendimento.', 3, true),
  ('018d56be-5532-5139-8cd6-708561fa2151', 'bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'up-geral-missoes-secretas', 'Missões Secretas', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 4, false),
  ('925e7523-2505-58af-9ed1-765f02f64a96', 'bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'up-geral-beli-1m', 'Beli · 1M', 250, 'Quantidade = pacotes de 1M de Beli. Confira com a equipe os detalhes de execução no atendimento.', 5, true),
  ('8c94592d-e2cb-5dea-ade4-e8c4444b3dde', 'bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'up-geral-fragmentos-1k', 'Fragmentos · 1K', 200, 'Quantidade = pacotes de 1K de fragmentos. Confira com a equipe os detalhes de execução no atendimento.', 6, true),
  ('e9f38e99-bb43-535d-8f35-5b3c4ae8ed8e', 'bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'up-geral-bounty-1m', 'Bounty · 1M', 1000, 'Quantidade = pacotes de 1M de bounty. Confira com a equipe os detalhes de execução no atendimento.', 7, true),
  ('1bd0c28c-54b0-5bca-866b-b7ccc4bc00ca', '33902a3c-9897-57ea-9f5b-ea9511b3937f', 'up-maestria-maestria-0-250', 'Maestria 0–250', 500, 'Serviço completo. Informe a arma, fruta ou estilo desejado no atendimento. Se possuir 2x Maestria, combine o desconto com a equipe antes do pedido.', 0, false),
  ('86c50433-d7af-59c0-87d5-4f0efb1a0064', '33902a3c-9897-57ea-9f5b-ea9511b3937f', 'up-maestria-maestria-250-400', 'Maestria 250–400', 1000, 'Serviço completo. Informe a arma, fruta ou estilo desejado no atendimento. Se possuir 2x Maestria, combine o desconto com a equipe antes do pedido.', 1, false),
  ('4a11a9ca-d873-5d14-84f0-57dee9a8b9d1', '33902a3c-9897-57ea-9f5b-ea9511b3937f', 'up-maestria-maestria-400-600', 'Maestria 400–600', 1500, 'Serviço completo. Informe a arma, fruta ou estilo desejado no atendimento. Se possuir 2x Maestria, combine o desconto com a equipe antes do pedido.', 2, false),
  ('fdfcc21b-004d-5f14-989c-7203c546c5b0', '33902a3c-9897-57ea-9f5b-ea9511b3937f', 'up-maestria-maestria-full-0-600', 'Maestria Full (0–600)', 2500, 'Serviço completo. Inclui maestria do 0 ao 600. Informe a arma, fruta ou estilo desejado no atendimento. Se possuir 2x Maestria, combine o desconto com a equipe antes do pedido.', 3, false),
  ('9e715cb9-b657-51d6-86ab-096810642dfb', '1488a262-d174-542d-8a0a-a4ebdf39a13d', 'up-estilos-superhuman', 'SuperHuman', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 0, true),
  ('ae326732-0e27-5378-b6e9-d241f986b330', '1488a262-d174-542d-8a0a-a4ebdf39a13d', 'up-estilos-death-step', 'Death Step', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 1, true),
  ('8cba30d1-fa77-5413-84f1-df2e84c078c5', '1488a262-d174-542d-8a0a-a4ebdf39a13d', 'up-estilos-sharkman-karate', 'Sharkman Karate', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 2, true),
  ('7f660a67-9d13-5905-8559-f7285d486b93', '1488a262-d174-542d-8a0a-a4ebdf39a13d', 'up-estilos-electric-claw', 'Electric Claw', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 3, true),
  ('5b14bd80-6aee-5fe7-be73-1f20bed7c209', '1488a262-d174-542d-8a0a-a4ebdf39a13d', 'up-estilos-dragon-talon', 'Dragon Talon', 1500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 4, true),
  ('077e81db-b898-5e41-a04b-3256e8e8c308', '1488a262-d174-542d-8a0a-a4ebdf39a13d', 'up-estilos-god-human', 'God Human', 5000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 5, true),
  ('143bd4fa-3132-59f3-8827-a01ce67a541f', '1488a262-d174-542d-8a0a-a4ebdf39a13d', 'up-estilos-sanguine-art-coracao-materiais', 'Sanguine Art · coração + materiais', 5000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 6, true),
  ('16c05fc4-ca55-5c25-b7de-1c304fc57075', '1488a262-d174-542d-8a0a-a4ebdf39a13d', 'up-estilos-somente-materiais-do-sanguine', 'Somente materiais Sanguine', 2500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 7, true),
  ('f3f37436-75cd-55cf-9de0-deef38afaa55', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-cdk', 'CDK', 1500, 'Serviço completo. É necessário possuir Yama + Tushita.', 0, true),
  ('498dd095-3c1b-5e32-adf4-6631572a5dcf', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-tushita', 'Tushita', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 1, true),
  ('164e7264-2558-5773-a7fc-acdfc0505c2c', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-yama', 'Yama', 500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 2, true),
  ('51420290-4666-5bff-afcc-7644f64c2b9f', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-ttk', 'TTK', 3000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 3, true),
  ('e474f9a3-ebd7-5d7e-a7da-3b7a85743af1', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-ttk-com-2x-maestria', 'TTK com 2x Maestria', 2000, 'Serviço completo. É necessário possuir 2x Maestria.', 4, true),
  ('039feeda-ce61-5501-a524-750d9e32df85', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-cada-espada-da-ttk', 'Cada espada TTK', 1000, 'Quantidade = pacotes de espada. Informe qual espada deseja no atendimento.', 5, true),
  ('3791123a-32c1-54f2-97de-b33a7af05dee', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-ttk-full-3-espadas', 'TTK Full (3 espadas)', 3000, 'Serviço completo. Inclui as 3 espadas da TTK.', 6, false),
  ('008f4353-7731-5f80-8431-8f0a699dfdfa', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-mini-yoru', 'Mini Yoru', 4000, 'Serviço completo. É obrigatório possuir os Hakis necessários.', 7, true),
  ('8e561b60-488d-55e7-99ec-1664655becdd', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-mini-yoru-com-2x-drop', 'Mini Yoru com 2x Drop', 2500, 'Serviço completo. É obrigatório possuir os Hakis necessários e 2x Drop.', 8, true),
  ('d17c09b1-4d9f-5e0f-9354-27736bdc613e', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-foice-sagrada', 'Foice Sagrada', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 9, true),
  ('3ee3d8ff-95aa-534d-9f59-c6b220362186', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-spikey-trident', 'Spikey Trident', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 10, true),
  ('444d4a62-9749-5082-90af-ddc6eec9668b', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-pole-v1-v2', 'Pole V1 + V2', 1500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 11, true),
  ('6fc1bcfa-619d-55a8-9b66-06790528d0de', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-shark-anchor', 'Shark Anchor', 2500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 12, true),
  ('9866833b-8807-5f80-8fc6-327bb62fe75a', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-fox-lamp', 'Fox Lamp', 2500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 13, true),
  ('e9aa09b2-2a82-543c-8d71-1116591f0a03', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-dragon-heart', 'Dragon Heart', 2000, 'Serviço completo. É obrigatório possuir Draco.', 14, true),
  ('d0cb1b75-131f-5eba-a932-173b28233454', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-yoru-v2', 'Yoru V2', 2000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 15, true),
  ('60081563-7917-56f3-9c7f-796866d79875', 'ea27fea1-f4b1-5143-916b-8db6acf808f3', 'up-espadas-yoru-v3', 'Yoru V3', 5000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 16, true),
  ('5e939a4b-dd6a-59e1-82ad-419bd6d8b9ba', '097ae642-68a1-5495-a716-6660d294801b', 'up-armas-dragon-storm', 'Dragon Storm', 2500, 'Serviço completo. É obrigatório possuir Draco.', 0, true),
  ('46e7eeb4-66b9-546e-8422-19b2c1a70e58', '097ae642-68a1-5495-a716-6660d294801b', 'up-armas-soul-guitar-completa', 'Soul Guitar completa', 2500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 1, true),
  ('29920d96-2260-5026-873e-993ecc410a7f', '097ae642-68a1-5495-a716-6660d294801b', 'up-armas-missao-da-soul-guitar', 'Missão Soul Guitar', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 2, true),
  ('4eadb43d-5419-5281-9a9e-c65f88a10d45', '097ae642-68a1-5495-a716-6660d294801b', 'up-armas-materiais-da-soul-guitar', 'Materiais da Soul Guitar', 1500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 3, true),
  ('33b44da1-0d22-5388-ab1c-c2c7ef0609bf', 'f6e82506-17c8-5daf-9ba1-049ea2ae8202', 'up-racas-desbloquear-ghoul', 'Desbloquear Ghoul', 2500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 0, true),
  ('43f36173-b3fc-5b12-bbe4-5f5aeef1aad3', 'f6e82506-17c8-5daf-9ba1-049ea2ae8202', 'up-racas-desbloquear-cyborg', 'Desbloquear Cyborg', 4000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 1, true),
  ('a22e7941-a571-56ce-aad1-25e177253a8a', 'f6e82506-17c8-5daf-9ba1-049ea2ae8202', 'up-racas-1-raca-ate-v3', '1 raça até V3', 1500, 'Serviço completo. Para evoluir Ghoul ou Cyborg até V3, é necessário já possuir a raça desbloqueada. Informe as raças no atendimento.', 2, true),
  ('50124bde-7100-5416-a2a4-9ed63b6c5559', 'f6e82506-17c8-5daf-9ba1-049ea2ae8202', 'up-racas-3-racas-ate-v3', '3 raças até V3', 2500, 'Serviço completo. Para evoluir Ghoul ou Cyborg até V3, é necessário já possuir a raça desbloqueada. Informe as raças no atendimento.', 3, true),
  ('53fc498e-6519-53f3-a243-b5b3534bffed', 'f6e82506-17c8-5daf-9ba1-049ea2ae8202', 'up-racas-6-racas-ate-v3', '6 raças até V3', 5000, 'Serviço completo. Para evoluir Ghoul ou Cyborg até V3, é necessário já possuir a raça desbloqueada. Informe as raças no atendimento.', 4, true),
  ('6b4a2f87-703a-53d6-9d80-9df1d6d5a952', '8466def7-6971-5d2a-8224-d910124345a4', 'up-v4-3-engrenagens-v4', '3 engrenagens V4', 3000, 'Quantidade = número de raças. Preço por raça, incluindo 3 engrenagens V4. Não inclui Draco. É necessário possuir as raças escolhidas no V3. Se faltarem fragmentos, combine um valor justo com a equipe antes do pedido.', 0, false),
  ('646ef3f9-ef00-5884-a90f-3e5dc64d02fb', '8466def7-6971-5d2a-8224-d910124345a4', 'up-v4-1-raca-v4-full', 'Raça V4 Full', 5000, 'Quantidade = número de raças. Preço por raça. Inclui 3 engrenagens + treino Full. Não inclui Draco. É necessário possuir as raças escolhidas no V3. Se faltarem fragmentos, combine um valor justo com a equipe antes do pedido.', 1, true),
  ('f1474558-b5af-5660-be8b-17eaa8830930', '8466def7-6971-5d2a-8224-d910124345a4', 'up-v4-6-racas-v4-full', '6 raças V4 Full', 28500, 'Serviço completo. Inclui 6 raças com 3 engrenagens + treino Full. Valor normal: R$ 300,00. Desconto de 5%: R$ 15,00. Total: R$ 285,00. Não inclui Draco. É necessário possuir as 6 raças no V3. Se faltarem fragmentos, combine um valor justo com a equipe antes do pedido.', 2, false),
  ('ace095f0-6617-5782-b796-1fe53237cd32', '7390a86e-86d9-5bb5-8d93-686b713b35dc', 'up-draco-faixa-preta', 'Faixa Preta', 2000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 0, true),
  ('f117f481-1e2c-5d18-9a48-f952936713ea', '7390a86e-86d9-5bb5-8d93-686b713b35dc', 'up-draco-todas-as-faixas-raca-draco', 'Todas as Faixas + Draco', 5000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 1, true),
  ('2840192e-cd80-5ca8-8d7a-8457f44c282c', '7390a86e-86d9-5bb5-8d93-686b713b35dc', 'up-draco-somente-desbloquear-draco', 'Desbloquear Draco', 2000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 2, true),
  ('a20c3516-9163-521b-a103-c0e4a5e7b236', '7390a86e-86d9-5bb5-8d93-686b713b35dc', 'up-draco-draco-v2', 'Draco V2', 1500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 3, true),
  ('2939e126-9d0c-5207-8013-ac625f244149', '7390a86e-86d9-5bb5-8d93-686b713b35dc', 'up-draco-draco-v3', 'Draco V3', 2000, 'Serviço completo. Rainbow Haki obrigatório para V3.', 4, true),
  ('d0d00913-2737-5cf4-9d13-735081f96492', '248372a2-153b-5278-9dee-c9988529354d', 'up-pacotes-draco-das-faixas-ate-v3', 'Faixas até V3', 7000, 'Serviço completo. Rainbow Haki obrigatório para V3.', 0, true),
  ('d3147f3a-f9e8-54a3-8343-ed97bcb4b98b', '248372a2-153b-5278-9dee-c9988529354d', 'up-pacotes-draco-da-raca-ate-v3', 'Raça até V3', 3500, 'Serviço completo. Rainbow Haki obrigatório para V3.', 1, true),
  ('b4f07c7a-338e-5e8c-92cf-a8b3bf96f369', '248372a2-153b-5278-9dee-c9988529354d', 'up-pacotes-draco-cada-engrenagem-draco-v4', 'Cada Engrenagem Draco V4', 1500, 'Quantidade = pacotes de engrenagem. Confira com a equipe os detalhes de execução no atendimento.', 2, true),
  ('13af7087-22c5-5efb-84f7-10e9b105cbed', '248372a2-153b-5278-9dee-c9988529354d', 'up-pacotes-draco-draco-v4-full-sem-hydra', 'Draco V4 Full · sem Hydra', 10000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 3, true),
  ('19f1bd75-ed46-517d-adc6-bf1f8663678c', '248372a2-153b-5278-9dee-c9988529354d', 'up-pacotes-draco-draco-v4-full-com-hydra', 'Draco V4 Full · com Hydra', 12000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 4, true),
  ('14802bde-e215-5a0a-b892-da7501c18a52', '248372a2-153b-5278-9dee-c9988529354d', 'up-pacotes-draco-v4-full-hydra-armas', 'V4 Full + Hydra + armas', 15000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 5, true),
  ('09ef5565-9e91-513f-abb8-fdba6dc6073c', '248372a2-153b-5278-9dee-c9988529354d', 'up-pacotes-draco-das-faixas-ate-v4-full', 'Faixas até V4 Full', 17000, 'Serviço completo. Inclui arma + espada Draco. Rainbow Haki obrigatório para V3.', 6, true),
  ('5a7d22ee-3f6e-58bb-b2bb-e016155533dd', '248372a2-153b-5278-9dee-c9988529354d', 'up-pacotes-draco-congelar-hydra', 'Congelar Hydra', 2500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 7, true),
  ('a63d92bd-3372-5428-ab10-111d454bb194', '6f2fe74d-ad43-5871-9d88-b237c0b4eea8', 'up-ilhas-mirage-island', 'Mirage Island', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 0, true),
  ('134b1ba6-5144-5f01-8d29-89ef59a1a696', '6f2fe74d-ad43-5871-9d88-b237c0b4eea8', 'up-ilhas-kitsune-island', 'Kitsune Island', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 1, true),
  ('f2f55e67-04fa-54a6-bb40-30a4b26bae15', '6f2fe74d-ad43-5871-9d88-b237c0b4eea8', 'up-ilhas-pre-historic-island', 'Pré-Historic Island', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 2, true),
  ('9dd88b58-7419-5ba3-b474-32659c5dacdd', '18fceb1e-91f0-5d90-a51f-534c68395d88', 'up-bosses-rip-indra-com-haki', 'Rip Indra com Haki', 1000, 'Serviço completo. É necessário possuir os Hakis.', 0, true),
  ('7c1f1d19-b5fa-5e56-a187-aaa7b579f7f6', '18fceb1e-91f0-5d90-a51f-534c68395d88', 'up-bosses-rip-indra-sem-haki', 'Rip Indra sem Haki', 1500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 1, true),
  ('277e2da7-2c51-52ff-afb2-dec3d672a228', '18fceb1e-91f0-5d90-a51f-534c68395d88', 'up-bosses-dough-king', 'Dough King', 1500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 2, true),
  ('a758f265-0551-5a65-80ea-c38c8e51758b', '18fceb1e-91f0-5d90-a51f-534c68395d88', 'up-bosses-1-fragmento-negro', '1 Fragmento Negro', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 3, true),
  ('bc36e045-e9b5-56d7-9bc3-521526314355', '18fceb1e-91f0-5d90-a51f-534c68395d88', 'up-bosses-2-fragmentos-negros', '2 Fragmentos Negros', 1500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 4, true),
  ('322196fd-f2c6-5a99-9ec9-f1c721623c03', '18fceb1e-91f0-5d90-a51f-534c68395d88', 'up-bosses-3-fragmentos-negros', '3 Fragmentos Negros', 2000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 5, true),
  ('b7c2b2be-05b6-5db4-b6da-0cbcb54a53d9', '2e290afe-9a6b-5dc1-b84e-b23ab28591a8', 'up-leviata-coroa-do-leviata', 'Coroa do Leviatã', 4000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 0, true),
  ('af9cf7a3-e393-5676-b2bc-715ae7928f97', '2e290afe-9a6b-5dc1-b84e-b23ab28591a8', 'up-leviata-escudo-do-leviata', 'Escudo do Leviatã', 5000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 1, true),
  ('38ade575-b1c7-5fd0-8eb7-b7d1b7848dc0', '2e290afe-9a6b-5dc1-b84e-b23ab28591a8', 'up-leviata-retirar-cooldown', 'Retirar Cooldown', 500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 2, true),
  ('9ea760a1-873a-57ec-bcc2-cbecc1e03219', '2e290afe-9a6b-5dc1-b84e-b23ab28591a8', 'up-leviata-barco-do-leviata', 'Barco do Leviatã', 3000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 3, true),
  ('69b0d785-3272-53dd-9883-64f76cf86637', '2e290afe-9a6b-5dc1-b84e-b23ab28591a8', 'up-leviata-congelar-hydra', 'Congelar Hydra', 2500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 4, true),
  ('d65e1c26-9b26-5e99-87ae-ba5d4c453b2d', '2e290afe-9a6b-5dc1-b84e-b23ab28591a8', 'up-leviata-coracao-do-leviata', 'Coração do Leviatã', 2500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 5, true),
  ('f1cec840-1f7b-53d4-b79e-90eb018b45e1', '2e290afe-9a6b-5dc1-b84e-b23ab28591a8', 'up-leviata-2-leviatas', '2 Leviatãs', 5000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 6, true),
  ('4f89ea34-2136-5b5f-afac-28932b746842', '2e290afe-9a6b-5dc1-b84e-b23ab28591a8', 'up-leviata-5-leviatas', '5 Leviatãs', 10000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 7, true),
  ('07ff2759-1eb5-57bc-9ac2-b5ff7d0411bd', '3bf1f0a1-14aa-5fc0-87c7-b7a86830998e', 'up-hakis-rainbow-haki', 'Rainbow Haki', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 0, true),
  ('4f2b8bcb-1bf9-50ce-bf8a-298a090933f9', '3bf1f0a1-14aa-5fc0-87c7-b7a86830998e', 'up-hakis-cada-haki-lendario', 'Cada Haki Lendário', 1500, 'Quantidade = pacotes de Haki. Informe a cor desejada no atendimento.', 1, true),
  ('848107a8-3ba7-5ce5-a3a2-963b86e06c17', 'cdb0ec36-b566-5aa7-b41d-266453496fe7', 'up-observacao-100-desvios', '100 Desvios', 200, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 0, true),
  ('a2d56e8c-7354-559e-92a6-e227338d70df', 'cdb0ec36-b566-5aa7-b41d-266453496fe7', 'up-observacao-500-desvios', '500 Desvios', 1000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 1, true),
  ('96129dc2-ec7f-554f-a863-cc4575c5018f', 'cdb0ec36-b566-5aa7-b41d-266453496fe7', 'up-observacao-1-000-desvios', '1.000 Desvios', 1500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 2, true),
  ('51a25c03-f03c-5c8c-b004-186cba2fafbf', 'cdb0ec36-b566-5aa7-b41d-266453496fe7', 'up-observacao-2-000-desvios', '2.000 Desvios', 2500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 3, true),
  ('3482a6f1-164d-5d8f-8b2d-d337708ea3f1', 'cdb0ec36-b566-5aa7-b41d-266453496fe7', 'up-observacao-3-000-desvios', '3.000 Desvios', 3500, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 4, true),
  ('8bc52e51-68c9-5646-98b5-bba5a363916b', 'cdb0ec36-b566-5aa7-b41d-266453496fe7', 'up-observacao-5-000-desvios', '5.000 Desvios', 4000, 'Serviço completo. Confira com a equipe os detalhes de execução no atendimento.', 5, true);

create temporary table gwstore_up_retired_services (
  product_id uuid primary key,
  substore_id uuid not null references pg_temp.gwstore_up_category_targets(substore_id),
  reviewed_slug text not null unique
) on commit drop;

insert into pg_temp.gwstore_up_retired_services values
  ('810d1ac3-e115-5797-b742-d0d7aa2163a9', 'bdc4b6f0-da98-58b6-9c33-ea16139723e8', 'up-geral-maestria-100-pontos'),
  ('e443ec71-d7e6-5d21-b327-8bc5e31b94b3', '8466def7-6971-5d2a-8224-d910124345a4', 'up-v4-1-engrenagem-v4'),
  ('89af8fde-4530-5366-a3b9-0ab8c704d506', '8466def7-6971-5d2a-8224-d910124345a4', 'up-v4-2-racas-v4-full'),
  ('437f3ce5-1abc-54cf-9be5-3d22346e6e9b', '8466def7-6971-5d2a-8224-d910124345a4', 'up-v4-3-racas-v4-full');

-- Snapshots contain catalog rows only; they never read order or customer data.
create temporary table gwstore_up_products_before (
  product_id uuid primary key,
  catalog_data jsonb not null
) on commit drop;
create temporary table gwstore_up_categories_before (
  substore_id uuid primary key,
  catalog_data jsonb not null
) on commit drop;

do $gw_up_table$
declare
  v_game_id constant uuid := '4ae2512f-a698-4f2c-976e-3719ff6b0299';
  v_store_id constant uuid := '0b0e91fe-d7ba-5257-845d-7e78a9187d4a';
  v_product_changes jsonb;
  v_category_changes jsonb;
begin
  if current_setting('app.gwstore_confirmed_project_ref', true)
       is distinct from 'athucowvfccegkzgcnli'
    or (select count(*) from public.guilds
        where discord_guild_id = '1401264061101899820'
          and status = 'active' and archived_at is null) <> 1
    or exists (select 1 from public.guilds
               where discord_guild_id is distinct from '1401264061101899820') then
    raise exception 'Confirm the isolated GWStore project before changing the UP table.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gwstore:blox-fruits:up-table', 0));

  if (select count(*) from pg_temp.gwstore_up_category_targets) <> 14
    or (select count(*) from pg_temp.gwstore_up_category_targets where existed_in_previous_table) <> 13
    or (select count(*) from pg_temp.gwstore_up_service_targets) <> 87
    or (select count(*) from pg_temp.gwstore_up_service_targets where existed_in_previous_table) <> 76
    or (select count(*) from pg_temp.gwstore_up_retired_services) <> 4
    or exists (select 1 from pg_temp.gwstore_up_service_targets as target
               join pg_temp.gwstore_up_retired_services as retired using (product_id)) then
    raise exception 'The UP table must contain 14 categories, 87 services (11 new) and 4 distinct retired services.';
  end if;

  -- Parent locks prevent concurrent archival/reassignment. Product locks also
  -- serialize staff edits so snapshots preserve their current stock and pauses.
  perform game.id from public.games as game where game.id = v_game_id for share;
  perform store.id from public.catalog_stores as store where store.id = v_store_id for share;
  perform substore.id from public.substores as substore
    join pg_temp.gwstore_up_category_targets as target on target.substore_id = substore.id
    order by substore.id for update of substore;
  perform product.id from public.products as product
    where product.id in (select product_id from pg_temp.gwstore_up_service_targets
                         union select product_id from pg_temp.gwstore_up_retired_services)
    order by product.id for update;

  if not exists (select 1 from public.games
                 where id = v_game_id and slug = 'blox-fruits'
                   and status = 'active' and archived_at is null)
    or not exists (select 1 from public.catalog_stores
                   where id = v_store_id and game_id = v_game_id
                     and slug = 'servicos-up' and status = 'active' and archived_at is null) then
    raise exception 'The reviewed GWStore Blox Fruits UP store is unavailable or changed scope.';
  end if;

  if (select count(*) from pg_temp.gwstore_up_category_targets as target
      join public.substores as substore on substore.id = target.substore_id
      where target.existed_in_previous_table
        and substore.game_id = v_game_id and substore.slug = 'up-' || target.category_key
        and substore.archived_at is null) <> 13
    or exists (select 1 from public.substores as substore
               join pg_temp.gwstore_up_category_targets as target on target.substore_id = substore.id
               where substore.game_id is distinct from v_game_id
                 or substore.slug is distinct from 'up-' || target.category_key
                 or substore.archived_at is not null)
    or exists (select 1 from public.substores as substore
               join pg_temp.gwstore_up_category_targets as target
                 on substore.game_id = v_game_id and lower(substore.slug) = 'up-' || target.category_key
               where substore.id <> target.substore_id and substore.archived_at is null) then
    raise exception 'An UP category is missing, moved, archived or conflicts with a reviewed slug.';
  end if;

  if (select count(*) from public.products as product
      join (select product_id, substore_id, reviewed_slug
            from pg_temp.gwstore_up_service_targets where existed_in_previous_table
            union all select product_id, substore_id, reviewed_slug
            from pg_temp.gwstore_up_retired_services) as target on product.id = target.product_id
      where product.catalog_store_id = v_store_id and product.substore_id = target.substore_id
        and product.slug = target.reviewed_slug and product.archived_at is null) <> 80
    or exists (select 1 from public.products as product
               join pg_temp.gwstore_up_service_targets as target on target.product_id = product.id
               where product.catalog_store_id is distinct from v_store_id
                 or product.substore_id is distinct from target.substore_id
                 or product.slug is distinct from target.reviewed_slug
                 or product.archived_at is not null)
    or exists (select 1 from public.products as product
               join pg_temp.gwstore_up_service_targets as target
                 on product.substore_id = target.substore_id and lower(product.slug) = target.reviewed_slug
               where product.id <> target.product_id and product.archived_at is null) then
    raise exception 'An UP product is missing, outside the reviewed scope, archived or has a conflicting slug.';
  end if;

  insert into pg_temp.gwstore_up_products_before
  select product.id, to_jsonb(product)
  from public.products as product
  where product.id in (select product_id from pg_temp.gwstore_up_service_targets
                       union select product_id from pg_temp.gwstore_up_retired_services);
  insert into pg_temp.gwstore_up_categories_before
  select substore.id, to_jsonb(substore)
  from public.substores as substore
  join pg_temp.gwstore_up_category_targets as target on target.substore_id = substore.id;

  -- Existing categories keep their names, titles, images, colors and status.
  insert into public.substores (id, game_id, name, slug, title, description, color_hex, status, sort_order)
  select target.substore_id, v_game_id, target.category_name, 'up-' || target.category_key,
         target.category_title, 'Serviços de Blox Fruits realizados pela equipe da GWStore.',
         '#b83cbf', 'active', target.sort_order
  from pg_temp.gwstore_up_category_targets as target
  where not exists (select 1 from public.substores where id = target.substore_id);

  update public.substores as substore
  set sort_order = target.sort_order
  from pg_temp.gwstore_up_category_targets as target
  where substore.id = target.substore_id and substore.game_id = v_game_id
    and substore.archived_at is null and substore.sort_order is distinct from target.sort_order;

  update public.products as product
  set name = target.product_name, minimum_price_cents = target.price_cents,
      description = target.description, sort_order = target.sort_order
  from pg_temp.gwstore_up_service_targets as target
  where product.id = target.product_id
    and product.catalog_store_id = v_store_id and product.substore_id = target.substore_id
    and product.archived_at is null
    and row(product.name, product.minimum_price_cents, product.description, product.sort_order)
        is distinct from row(target.product_name, target.price_cents, target.description, target.sort_order);

  insert into public.products (
    id, substore_id, catalog_store_id, name, slug, description, minimum_price_cents,
    stock_quantity, unlimited_stock, low_stock_threshold, status, sort_order
  )
  select target.product_id, target.substore_id, v_store_id, target.product_name,
         target.reviewed_slug, target.description, target.price_cents, 0, true, 0, 'active', target.sort_order
  from pg_temp.gwstore_up_service_targets as target
  where not exists (select 1 from public.products where id = target.product_id);

  -- Keep all four immutable product identities for historical orders.
  update public.products as product set status = 'inactive'
  from pg_temp.gwstore_up_retired_services as retired
  where product.id = retired.product_id and product.catalog_store_id = v_store_id
    and product.substore_id = retired.substore_id and product.archived_at is null
    and product.status is distinct from 'inactive';

  if (select count(*) from public.products as product
      join pg_temp.gwstore_up_service_targets as target on target.product_id = product.id
      where product.catalog_store_id = v_store_id and product.substore_id = target.substore_id
        and product.slug = target.reviewed_slug and product.archived_at is null
        and product.name = target.product_name and product.minimum_price_cents = target.price_cents
        and product.description = target.description and product.sort_order = target.sort_order) <> 87
    or (select count(*) from public.products as product
        join pg_temp.gwstore_up_retired_services as retired on retired.product_id = product.id
        where product.catalog_store_id = v_store_id and product.substore_id = retired.substore_id
          and product.slug = retired.reviewed_slug and product.archived_at is null
          and product.status = 'inactive') <> 4
    or (select count(*) from public.substores as substore
        join pg_temp.gwstore_up_category_targets as target on target.substore_id = substore.id
        where substore.game_id = v_game_id and substore.archived_at is null
          and substore.slug = 'up-' || target.category_key and substore.sort_order = target.sort_order) <> 14 then
    raise exception 'UP table verification failed; the entire operation is rolled back.';
  end if;

  -- Verify every pre-existing field outside the explicit edits stayed unchanged,
  -- including stock, unlimited availability, active/paused status and emoji.
  if exists (select 1 from pg_temp.gwstore_up_products_before as previous
             join public.products as product on product.id = previous.product_id
             join pg_temp.gwstore_up_service_targets as target on target.product_id = product.id
             where (to_jsonb(product) - array['name', 'minimum_price_cents', 'description', 'sort_order', 'updated_at'])
               is distinct from (previous.catalog_data - array['name', 'minimum_price_cents', 'description', 'sort_order', 'updated_at']))
    or exists (select 1 from pg_temp.gwstore_up_products_before as previous
               join public.products as product on product.id = previous.product_id
               join pg_temp.gwstore_up_retired_services as retired on retired.product_id = product.id
               where (to_jsonb(product) - array['status', 'updated_at'])
                 is distinct from (previous.catalog_data - array['status', 'updated_at']))
    or exists (select 1 from pg_temp.gwstore_up_categories_before as previous
               join public.substores as substore on substore.id = previous.substore_id
               where (to_jsonb(substore) - array['sort_order', 'updated_at'])
                 is distinct from (previous.catalog_data - array['sort_order', 'updated_at']))
    or exists (select 1 from public.products as product
               join pg_temp.gwstore_up_service_targets as target on target.product_id = product.id
               left join pg_temp.gwstore_up_products_before as previous on previous.product_id = product.id
               where previous.product_id is null
                 and (product.status <> 'active' or not product.unlimited_stock or product.stock_quantity <> 0)) then
    raise exception 'Protected catalog fields changed; the entire operation is rolled back.';
  end if;

  -- Audit only changed fields of changed catalog rows, including first inserts.
  -- A no-op rerun creates no event and does not update any product timestamp.
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id', product.id, 'slug', product.slug,
    'kind', case when previous.product_id is null then 'inserted' else 'updated' end,
    'changes', changes.fields
  ) order by product.id), '[]'::jsonb) into v_product_changes
  from public.products as product
  left join pg_temp.gwstore_up_products_before as previous on previous.product_id = product.id
  cross join lateral (
    select jsonb_object_agg(field.key, jsonb_build_object(
      'before', previous.catalog_data -> field.key, 'after', field.value
    )) as fields
    from jsonb_each(jsonb_build_object(
      'name', product.name, 'minimum_price_cents', product.minimum_price_cents,
      'description', product.description, 'sort_order', product.sort_order, 'status', product.status
    )) as field
    where previous.product_id is null or previous.catalog_data -> field.key is distinct from field.value
  ) as changes
  where product.id in (select product_id from pg_temp.gwstore_up_service_targets
                       union select product_id from pg_temp.gwstore_up_retired_services)
    and changes.fields is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'substore_id', substore.id, 'slug', substore.slug,
    'kind', case when previous.substore_id is null then 'inserted' else 'updated' end,
    'changes', changes.fields
  ) order by substore.id), '[]'::jsonb) into v_category_changes
  from public.substores as substore
  join pg_temp.gwstore_up_category_targets as target on target.substore_id = substore.id
  left join pg_temp.gwstore_up_categories_before as previous on previous.substore_id = substore.id
  cross join lateral (
    select jsonb_object_agg(field.key, jsonb_build_object(
      'before', previous.catalog_data -> field.key, 'after', field.value
    )) as fields
    from jsonb_each(jsonb_build_object(
      'name', substore.name, 'title', substore.title, 'description', substore.description,
      'sort_order', substore.sort_order, 'status', substore.status
    )) as field
    where previous.substore_id is null or previous.catalog_data -> field.key is distinct from field.value
  ) as changes
  where changes.fields is not null;

  if jsonb_array_length(v_product_changes) > 0 or jsonb_array_length(v_category_changes) > 0 then
    insert into public.audit_events (action, entity_type, entity_id, metadata)
    values ('catalog.gwstore.up_table_updated', 'catalog_store', v_store_id,
      jsonb_build_object('project_ref', 'athucowvfccegkzgcnli', 'requested_services', 87,
        'requested_categories', 14, 'retired_services', 4,
        'products', v_product_changes, 'categories', v_category_changes));
  end if;
  raise notice 'All 87 UP services, 14 categories and 4 inactive legacy services verified; % product and % category rows changed.',
    jsonb_array_length(v_product_changes), jsonb_array_length(v_category_changes);
end
$gw_up_table$;

select count(*)::integer as requested_services,
       count(*) filter (where product.minimum_price_cents = target.price_cents
                         and product.name = target.product_name
                         and product.description = target.description
                         and product.sort_order = target.sort_order)::integer as verified_services
from pg_temp.gwstore_up_service_targets as target
join public.products as product on product.id = target.product_id;
commit;
