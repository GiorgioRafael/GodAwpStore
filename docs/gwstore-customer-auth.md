# Contas de clientes da GWStore

`/entrar` oferece Google, Discord e e-mail com senha. O cliente pode criar uma conta, confirmar o endereço e recuperar a senha. O retorno ao carrinho preserva apenas IDs e quantidades; a loja revalida os produtos, o estoque e os preços.

As senhas são gerenciadas pelo Supabase Auth. A aplicação não armazena senhas nem usa a chave administrativa para cadastrar usuários. As ações validam a origem GWStore, os campos e o destino de retorno. Pedidos e chat pertencem ao UUID real da conta. Dados de nome/avatar são apenas de exibição; o acesso administrativo continua exigindo a identidade e a autorização existentes.

## Estado da produção em 10/10/2026

Estado do projeto GWStore `athucowvfccegkzgcnli`, conferido durante a publicação autorizada:

- Google e Discord já estão habilitados.
- O provedor de e-mail está desabilitado e a confirmação automática está habilitada.
- Nenhum SMTP personalizado está configurado.
- O callback legado `https://gwstore.vercel.app/auth/callback` e o callback mestre `https://101devs.com/auth/callback` estão autorizados. Os callbacks do domínio novo ainda precisam ser adicionados pelo responsável do Supabase.
- Os templates atuais de confirmação e recuperação usam `{{ .ConfirmationURL }}`, compatível com o fluxo implementado.
- A migração isolada `20261010000100_gwstore_customer_auth_providers.sql` foi aplicada e registrada no histórico da GWStore antes da publicação do código. Os pré-requisitos `20261007000100` e `20261009000100` foram confirmados.

As configurações de autenticação do Supabase e todas as configurações do Resend permanecem preservadas. Os domínios existentes do Resend pertencem a outras integrações; a GWStore deve usar um remetente próprio verificado.

## Ativação

1. Confira a migração `20261010000100_gwstore_customer_auth_providers.sql` no histórico da GWStore; ela já foi aplicada neste projeto. Ela aceita Discord nulo apenas em pedidos com namespace web válido, valida a identidade do comprador no RPC e mantém os RPCs do bot/admin protegidos. Não execute novamente o arquivo, publique migrations históricas pendentes em massa ou aplique esta operação na THStore.
2. No projeto Supabase GWStore, habilite **Email** e **Confirm email**. Na Management API isso corresponde a `external_email_enabled=true` e `mailer_autoconfirm=false`. Preserve os provedores, o Site URL, os templates e a lista de redirects existentes.
3. Verifique um domínio próprio no Resend, por exemplo `gwstoreofc.com` ou um subdomínio exclusivo de autenticação. Adicione apenas os registros DNS retornados para esse domínio, sem substituir registros de outras integrações. Crie uma chave nova com permissão de envio restrita a esse domínio.
4. Configure **Authentication → Email → SMTP Settings** somente no projeto GWStore:

   | Campo | Valor |
   | --- | --- |
   | Sender name | GWStore |
   | Sender email | Endereço no domínio verificado escolhido para a loja |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | Nova chave de envio restrita da GWStore |

   Guarde a chave no campo SMTP do Supabase; ela não precisa de variável pública nem de alteração nos webhooks, campanhas, contatos ou chaves das outras integrações do Resend. Ajuste os limites de envio de autenticação ao volume da loja, respeitando os limites do plano Resend.
5. Publique o código web com o build Next direto, conforme `gwstore-railway.md`, sem executar o postbuild de sincronização Discord. Valide cadastro, confirmação, login, recuperação e compra com uma conta de teste e destinatário autorizado.

Configuração SMTP oficial: [Resend com Supabase](https://resend.com/docs/send-with-supabase-smtp). O SMTP padrão do Supabase tem restrições para destinatários e não serve como remetente da loja: [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Callbacks e recuperação

Google cliente usa `/auth/google/login?customer=1&next=...`; o Google do painel mestre preserva sua rota e suas regras. O fluxo de cliente restringe `next` à loja e às compras do usuário. Os callbacks Google e e-mail usam `/auth/callback` exato, sem query extra, para funcionar na allowlist atual.

Enquanto `GWSTORE_LOGIN_ORIGIN=https://gwstore.vercel.app` estiver configurado, a página de entrada e o OAuth cliente passam para esse host antes de criar o verifier PKCE. O link recebido por e-mail deve ser aberto no mesmo navegador que iniciou o cadastro/recuperação, conforme a orientação exibida na tela. O destino de retorno por e-mail é lembrado por uma hora; o cookie OAuth mantém seu prazo existente.

O callback só abre a criação de nova senha depois de trocar um código válido e receber uma sessão de recuperação. O formulário de nova senha exige esse usuário verificado e um cookie de recuperação de dez minutos vinculado ao seu UUID. Um e-mail, `next` ou parâmetro de URL enviado pelo navegador não escolhe a conta cuja senha será alterada.

Adicione os callbacks do domínio novo à allowlist preservando os atuais e só remova o bridge depois de validar. Consulte [Supabase Password Auth](https://supabase.com/docs/guides/auth/passwords) e [PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

## Desenvolvimento e verificação

`supabase/config.toml` habilita cadastro e confirmação por e-mail no banco local, com senha mínima de oito caracteres. Essa configuração local não deve ser enviada inteira ao projeto remoto: sobrescreveria outras opções de autenticação.

Os testes de aplicação cobrem os quatro modos de e-mail, retorno ao carrinho, falhas de configuração, redirects, Google cliente/mestre, privacidade e a continuidade do acesso administrativo. O fixture `supabase/tests/gwstore_customer_auth_verification.sql` valida compras Google/e-mail, idempotência, pagamento/chat, RLS, identidade não confirmada, tentativas de forjar Discord, entrega pela equipe e exclusão de conta com histórico. Execute-o em um banco de testes; ele usa transação com rollback e não deve gerar uma cobrança real.
