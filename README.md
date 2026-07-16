# GWStore Admin

Painel administrativo da GWStore para gerenciar catálogo, estoque digital,
whitelist, comissão e a base operacional das futuras lojas no Discord.

Esta primeira versão inclui a aplicação web e o modelo de dados. O bot, o PIX, a
entrega pelo Discord e o deploy na Vercel não fazem parte desta etapa.

## Tecnologias

- Next.js 16, React 19 e TypeScript;
- Tailwind CSS para a interface;
- Supabase PostgreSQL, Auth e Storage;
- OAuth do Discord;
- Zod e Vitest;
- npm workspaces.

## Estrutura

```text
apps/web/         painel Next.js
packages/domain/ regras, tipos, validações e criptografia compartilháveis
supabase/         configuração, migrações e testes do banco
```

## Pré-requisitos

- Node.js 24 LTS;
- npm 11 ou mais recente;
- um projeto Supabase;
- uma aplicação no Discord Developer Portal.

Docker é necessário somente para executar a pilha Supabase inteiramente local.
Também é possível aplicar as migrações diretamente a um projeto Supabase remoto.

## 1. Criar o projeto Supabase

1. Crie um projeto vazio no Supabase.
2. Copie a URL do projeto, a chave publicável e a chave `service_role`.
3. Não compartilhe nem versione a chave `service_role`.
4. Na raiz do repositório, autentique e vincule a CLI:

```powershell
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

O `--dry-run` deve ser revisado antes da aplicação. Não use `db reset --linked`:
esse comando apaga os dados do projeto remoto.

## 2. Configurar o login Discord

1. Crie uma aplicação em <https://discord.com/developers/applications>.
2. No OAuth2 da aplicação, adicione o callback informado pelo Supabase:

```text
https://SEU_PROJECT_REF.supabase.co/auth/v1/callback
```

3. No Supabase, abra **Authentication > Providers > Discord**.
4. Ative o provedor e informe o Client ID e Client Secret do Discord.
5. Em **Authentication > URL Configuration**, use:

```text
Site URL: http://localhost:3000
Redirect URL: http://localhost:3000/auth/callback
```

No deploy futuro, acrescente a URL HTTPS da Vercel sem remover o callback local.

## 3. Configurar variáveis locais

Copie `apps/web/.env.example` para `apps/web/.env.local` e preencha os valores.
Os segredos devem ser inseridos diretamente no arquivo local, nunca enviados por
chat ou commitados.

O `ADMIN_DISCORD_IDS` recebe uma lista separada por vírgulas. Ative o modo
desenvolvedor do Discord e use **Copiar ID do usuário** para obter o seu snowflake.

Gere duas chaves independentes para o estoque:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

A primeira saída vai em `INVENTORY_ENCRYPTION_KEY` e a segunda em
`INVENTORY_FINGERPRINT_KEY`. Trocar a chave de criptografia sem uma migração de
rotação torna unidades já cadastradas ilegíveis.

## 4. Executar

No Windows PowerShell com política restrita, use `npm.cmd`:

```powershell
npm.cmd install
npm.cmd run dev
```

Abra <http://localhost:3000>. O catálogo começa vazio; o projeto não possui seed
de demonstração.

## Importação de estoque

- Cadastro manual: um conteúdo secreto por unidade.
- TXT: uma unidade por linha.
- CSV: cabeçalho obrigatório `secret`.
- A prévia valida o lote antes da confirmação.
- A confirmação é transacional: um erro ou uma duplicidade impede todo o lote.
- Repetir a mesma confirmação após uma falha de rede reutiliza o resultado anterior.
- A quantidade de um produto é calculada pelas unidades no estado `available`.

O conteúdo é criptografado com AES-256-GCM antes de ser enviado ao banco. Um HMAC
independente permite detectar duplicidades sem persistir o texto aberto. A
revelação posterior é mascarada por padrão e sempre gera auditoria.

## Verificações

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Com Docker disponível, valide também as migrações e políticas no PostgreSQL local:

```powershell
npx supabase db start
$env:PGPASSWORD = "postgres"
psql postgresql://postgres@127.0.0.1:54322/postgres --set ON_ERROR_STOP=1 --file supabase/tests/schema_verification.sql
psql postgresql://postgres@127.0.0.1:54322/postgres --set ON_ERROR_STOP=1 --file supabase/tests/integration.sql
```

O GitHub Actions executa as verificações da aplicação e os testes transacionais
do banco a cada push para `main` e em pull requests.

## Segurança

- IDs Discord são strings; não são convertidos para `number`.
- Dinheiro é armazenado em centavos e taxas em pontos-base.
- Todas as mutações verificam autenticação e autorização no servidor.
- A lista `ADMIN_DISCORD_IDS` renova uma autorização curta no banco a cada
  requisição; remover um ID impede novas renovações e faz sessões antigas expirarem.
- A chave `service_role` e as chaves de estoque nunca entram no bundle do navegador.
- RLS bloqueia acesso anônimo e restringe dados administrativos.
- Exclusões operacionais arquivam ou revogam registros em vez de apagar histórico.
- O ID aleatório de uma unidade não funciona como credencial de acesso.

Consulte também [SECURITY.md](SECURITY.md) antes de tratar dados reais.

## Deploy futuro na Vercel

O projeto é compatível com Vercel, mas nenhum deploy é realizado nesta versão.
Quando chegar essa etapa:

1. configure o diretório raiz do projeto para o monorepo;
2. replique todas as variáveis de ambiente;
3. atualize `NEXT_PUBLIC_SITE_URL`;
4. adicione o callback HTTPS à lista do Supabase;
5. mantenha as chaves server-only fora de ambientes de Preview não confiáveis.

## Integração futura com o bot

O bot deverá reutilizar `packages/domain` e o mesmo PostgreSQL. O cliente Discord
nunca receberá a chave de criptografia nem consultará unidades em texto aberto.
Pedidos, ledger e saques já possuem uma fundação de dados, mas não executam
pagamentos ou entregas nesta etapa.
