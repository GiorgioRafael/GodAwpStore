# Loja e atendimento da GWStore no site

A página inicial da GWStore apresenta as categorias com capas e abre os produtos dentro de cada categoria, com busca, ordenação, estoque e carrinho. O cliente entra com Google, Discord ou e-mail/senha, informa o usuário Roblox e paga pelo Pix. O atendimento e a entrega acontecem no chat privado do pedido, em `/minhas-compras`; a equipe acompanha os pedidos em `/admin/atendimento-loja`.

## Pedido e pagamento

- O carrinho armazena apenas IDs e quantidades. Preços, disponibilidade e descontos são calculados no servidor e novamente na transação do banco.
- A conta autenticada é a proprietária do pedido. Clientes Google/e-mail não precisam de um ID Discord; descontos vinculados ao Discord exigem uma identidade Discord válida.
- Cada checkout tem uma chave de repetição vinculada ao comprador e aos itens. A mesma chave permanece após uma resposta incerta do provedor, evitando outra cobrança na tentativa seguinte.
- Produtos sem limite de estoque mantêm o comportamento configurado no painel. Os requisitos dos serviços de UP precisam ser confirmados antes do checkout.
- A origem persistida `web:<UUID>` diferencia estes pedidos dos pedidos antigos do bot. Os webhooks abrem o chat do site e preservam a atualização do estoque compartilhado. Eles não criam tickets nem concedem cargos do Discord ao comprador web.
- O retorno do LivePix e do Pix Eclipse leva o pedido web à página da compra. Pedidos e pagamentos antigos continuam com seus fluxos originais.

## Chat e entrega

- Cada conversa pertence a um pedido pago e ao usuário autenticado que o comprou. Administradores ativos podem atender pela página do painel.
- Tabelas de chat usam RLS forçada. Acesso anônimo e escrita direta pelo navegador são negados. Escritas passam por RPCs do servidor que verificam identidade, propriedade e autorização.
- Mensagens são texto, têm limite de 2.000 caracteres, limitação de frequência e chave de repetição. O histórico continua disponível após a entrega e após alterações posteriores no pagamento.
- Concluir a entrega registra a mensagem do sistema e a auditoria de forma idempotente. Não repete a baixa de estoque nem altera o lançamento financeiro.
- Pagamentos que necessitam análise continuam visíveis para a equipe. A recuperação de tickets do Discord exclui pedidos web no banco e na aplicação.

## Migração e roleta

`supabase/migrations/20261009000100_gwstore_web_shop_private_chat.sql` cria o armazenamento e os RPCs da loja. A migração verifica as funções atuais de compra e preserva seu comportamento de preços e estoque. A lista de pagamentos tardios aceita as duas versões previamente publicadas e exclui pedidos web antes do limite do lote.

`supabase/operations/disable-gwstore-roulette.sql` é uma operação específica para o projeto Supabase isolado da GWStore, com confirmação explícita do projeto e preflight do servidor. Desativa a roleta e revoga acesso do navegador aos RPCs de novas participações. Os prêmios e pagamentos antigos continuam preservados para resolução pela equipe.

Na GWStore, `/roleta` e `/roleta/overlay` retornam 404, não há configurações nem navegação da roleta no painel, e novas ações de participação são negadas. A THStore continua usando sua roleta.

## Hospedagem e login

A produção continua na Railway com a ponte de domínio já documentada em `gwstore-railway.md`. O build web não executa o postbuild que publica mensagens no Discord.

O fluxo e a ativação de e-mail com SMTP próprio estão documentados em `gwstore-customer-auth.md`.

Enquanto um Owner do Supabase não autorizar os callbacks do domínio novo, `GWSTORE_LOGIN_ORIGIN=https://gwstore.vercel.app` mantém o login na ponte legada. O carrinho atravessa esse retorno com IDs e quantidades revalidados; nenhuma informação de preço é confiada à URL. Remova a configuração temporária somente depois de liberar e verificar os callbacks de `gwstoreofc.com`.

## Verificação

Os testes cobrem checkout, repetição segura, preços autoritativos, limites de estoque, retorno dos provedores, autorização, privacidade do chat, conclusão da entrega, recuperação de pagamentos, indisponibilidade da roleta GW e preservação da THStore. O fixture `supabase/tests/gwstore_web_shop_verification.sql` valida o ciclo completo com dados locais, incluindo leitura privada e bloqueio de tickets Discord para pedidos web.

A revisão visual no Chrome usou 1483 × 1061 no computador e 390 × 844 no celular. Foram verificados busca, produto, quantidade, carrinho, login com retorno ao carrinho e ausência de overflow horizontal. A validação em produção usa apenas consultas e requisições rejeitadas antes da compra; não gera cobrança nem pedido de teste no banco da loja.
