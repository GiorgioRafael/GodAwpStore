# GWStore na Railway

A aplicação web roda como um serviço Node persistente a partir da raiz do monorepo. O serviço de convites em `apps/discord-worker` e sua configuração `railway.json` permanecem separados.

Configure o serviço web pela interface/API atual da Railway:

| Campo | Valor |
| --- | --- |
| Builder | Railpack, Node 24 |
| Diretório raiz | Raiz deste repositório |
| Build | `npm exec --workspace @godawp/web -- next build` |
| Start | `node apps/web/scripts/start-railway.mjs` |
| `RAILPACK_BUILD_CMD` no serviço web GWStore | `npm exec --workspace @godawp/web -- next build` |
| `RAILPACK_START_CMD` no serviço web GWStore | `node apps/web/scripts/start-railway.mjs` |
| Health check | `/api/health` |
| Startup health timeout | 120 segundos |
| Encerramento | Pelo menos 30 segundos de drain após SIGTERM |
| Réplicas | 1 |
| Sleep/serverless | Desativado |

Neste projeto, o gerador Railpack dos deploys conectados ao GitHub ainda lê o `railway.json` da raiz, mesmo com os comandos web configurados no painel do serviço. Defina também `RAILPACK_BUILD_CMD` e `RAILPACK_START_CMD` com os valores da tabela **somente no serviço web GWStore** para garantir que o plano compile e inicie o Next. Preserve o `railway.json` da raiz e a configuração do serviço de convites.

O build web invoca o Next diretamente, sem executar o `postbuild` da Vercel que publica alterações no Discord.

Use as mesmas credenciais de produção do Supabase, Discord e provedores de pagamento. `NODE_ENV=production`, `NEXT_PUBLIC_STORE_NAME=GWStore` e `NEXT_PUBLIC_SITE_URL=https://gwstoreofc.com` precisam estar configurados antes do build; as variáveis `NEXT_PUBLIC_*` são incorporadas à aplicação compilada. Não copie `VERCEL`/`VERCEL_ENV` para simular a plataforma. O serviço lê a porta entregue em `PORT` e escuta em `0.0.0.0`.

## Tarefas automáticas e troca da hospedagem

Mantenha `GW_CRON_ENABLED=false` durante a preparação. O servidor inicia normalmente com as tarefas desativadas. Depois de validar o domínio, webhooks e login na Railway, desative os três crons da antiga produção Vercel e configure `GW_CRON_ENABLED=true` na Railway. Preserve `CRON_SECRET` do ambiente de produção. A ativação valida a marca GWStore, `NODE_ENV`, o segredo e o servidor Discord, quando configurado.

O launcher espera o health check local e executa estes horários em UTC:

| Fila | Horário |
| --- | --- |
| Fechamento de tickets | A cada 3 minutos |
| Recuperação e reconciliação | A cada 5 minutos |
| Top 5 compradores | Minuto 2, a cada 3 horas |

As chamadas usam `127.0.0.1`, autenticam com `CRON_SECRET` e recusam redirects. Cada tarefa tem deadline de 240 segundos e não inicia outra execução enquanto a anterior estiver ativa. Conclusões bem-sucedidas registram apenas o nome da tarefa e o status HTTP em INFO; falhas também ficam no log, sem corpo da resposta ou credenciais. O próximo horário tenta novamente. As filas persistidas no Supabase e suas reservas continuam responsáveis pela recuperação de trabalho pendente. Horários perdidos durante reinícios não são reproduzidos em massa.

`GET /api/health` retorna somente `{ "ok": true }` com `Cache-Control: no-store`. É liveness do processo; indisponibilidade transitória do Discord ou Supabase não derruba a aplicação. SIGTERM/SIGINT encerra o agendador e é encaminhado ao Next, que conclui requisições e callbacks `after()`. Após 30 segundos o launcher força o encerramento de um processo que não saiu. Saída inesperada do Next retorna código 1 para a política de restart.

## Pausa de pagamentos e promoções

No serviço web GWStore, `PAYMENT_PROVIDER=livepix` direciona novas compras do site e do bot para LivePix e pausa a emissão de links manuais EclipsePay. Preserve as credenciais EclipsePay e o webhook para conciliar cobranças antigas. Uma intenção EclipsePay ainda incerta bloqueia a troca de provedor daquele pedido; confirme o estado da cobrança antes de solicitar outro Pix.

`GWSTORE_CUSTOMER_DISCOUNTS_ENABLED=false` pausa os descontos de booster e ranking em novos pedidos da GWStore. Os níveis, cargos, configurações de benefícios e valores de pedidos existentes permanecem registrados. Remova essa variável ou defina `true` para voltar a aplicar os benefícios configurados.

As ofertas automáticas são controladas por `platform_settings.upsell_enabled` e `lead_recovery_enabled` no banco isolado da GWStore. A operação em `supabase/operations/pause-gwstore-promotions.sql` desativa ambas e invalida somente ofertas abertas, com guardas de projeto/guild. Para retomá-las, reative os dois controles; o histórico invalidado permanece auditável. Confira novamente as ofertas abertas após a pausa para cobrir uma chamada iniciada antes dela.

## Ponte da Vercel e login temporário

A URL antiga `gwstore.vercel.app` permanece como ponte de compatibilidade para a Railway, inclusive links já enviados pelo bot. Configure `GWSTORE_RAILWAY_ORIGIN=https://gwstore-web-production.up.railway.app` **somente no deployment GWStore da Vercel**. O gate exige GWStore, execução Vercel e esse destino HTTPS exato. A ponte encaminha páginas, assets, cookies, query e POSTs sem alterar os bytes de webhooks assinados; a Railway aplica os gates de autenticação. Os hosts do painel mestre 101Devs e da THStore continuam fora da ponte.

Quando a ponte válida está ativa, os três handlers de cron da Vercel retornam `railway-managed` sem executar filas, e o wrapper `postbuild` pula os dez passos de publicação do Discord. Isso permite manter a compatibilidade do domínio antigo sem duplicar o agendador ou sobrescrever vitrines na Vercel.

Enquanto um **Owner do projeto Supabase** não liberar os callbacks do domínio novo, configure `GWSTORE_LOGIN_ORIGIN=https://gwstore.vercel.app` no serviço Railway. O login Discord e a entrada OAuth de sorteios redirecionam para esse host antes de criar o verifier PKCE e o cookie de estado. Callback, sessão e URL de retorno permanecem no host que iniciou esse fluxo; nesse período, a navegação autenticada usa a URL legada.

O Owner precisa adicionar os callbacks HTTPS de `gwstoreofc.com`/`www.gwstoreofc.com` para `/auth/callback` e `/api/sorteios/oauth/retorno`, com padrões de query compatíveis com `next` e `state`, preservando o callback legado e o painel mestre. Só remova `GWSTORE_LOGIN_ORIGIN` depois de validar esses fluxos no domínio novo. Se o alias público Railway também for usado para login direto, ele precisa de callbacks autorizados.

Antes do cutover, valide `/auth/login` e o OAuth de sorteios pela ponte real. O proxy Vercel sobrescreve `X-GWStore-Public-Host` com o hostname da origem GW validada antes do rewrite; esse header preserva a origem mesmo quando a edge Railway substitui `X-Forwarded-Host`. A aplicação interpreta o header dedicado somente com a identidade de ambiente Railway e um Host do próprio serviço confirmado, aceitando apenas `gwstore.vercel.app`, `gwstoreofc.com` e `www.gwstoreofc.com`, sem porta, esquema ou lista de hosts. Acessos diretos aos domínios da loja, ao painel mestre e à THStore ignoram esses headers. `X-Forwarded-Host` continua como fallback sujeito à mesma lista. Redirecionamentos repetidos para a própria entrada de login indicam que essa origem não foi preservada e precisam ser corrigidos antes de ativar o fluxo.

## Sincronização opcional do Discord

A mudança de hospedagem preserva o alias público existente e o Supabase com as configurações de vitrines e tickets. A sincronização abaixo é opcional, para quando for necessário republicar vitrines, comandos ou controles. Ela executa os dez passos de publicação; a troca de hospedagem por si só não exige essa republicação.

Quando houver necessidade de republicação, execute explicitamente após a troca da produção:

```sh
node apps/web/scripts/sync-railway-production.mjs --confirm-production
```

Execute com as variáveis do **serviço web GWStore** e `NODE_ENV=production`; `DISCORD_GUILD_ID=1401264061101899820` é obrigatório para este comando. O runner valida a confirmação/marca/guild, roda os mesmos passos de publicação em modo manual e para no primeiro erro. Não altera variáveis Vercel e nunca roda automaticamente no build ou start. Pode ser repetido após corrigir uma falha porque as sincronizações são idempotentes.

O comando precisa de `tsx` e `esbuild`. Se a imagem runtime remover dependências de desenvolvimento, execute a partir de um checkout completo usando as variáveis do serviço Railway, em vez de acrescentar publicações ao build.

Para rollback, desligue primeiro `GW_CRON_ENABLED` na Railway; só então reative os crons da Vercel e devolva o domínio. Evite duas instâncias de agendamento ativas durante a transição.

Referências: [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [Railway cron](https://docs.railway.com/cron-jobs). O cron nativo Railway tem intervalo mínimo de cinco minutos, por isso o fechamento de três minutos permanece no agendador do serviço web.
