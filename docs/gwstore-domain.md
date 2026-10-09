# Domínio e painel da GWStore

O projeto Vercel `gwstore`, na equipe `ydps915s-projects`, atende
`gwstoreofc.com` e `www.gwstoreofc.com`. A GoDaddy mantém os nameservers
`ns51.domaincontrol.com` e `ns52.domaincontrol.com`.

A aplicação da GWStore roda no serviço `gwstore-web` da Railway. A Vercel
encaminha estes domínios e `gwstore.vercel.app` para esse serviço, mantendo
os links e webhooks antigos. Veja [a configuração da migração](gwstore-railway.md).

Registros indicados e verificados pela Vercel em 09/10/2026:

| Tipo | Nome | Valor |
| --- | --- | --- |
| A | @ | 216.150.1.1 |
| A | @ | 216.150.16.1 |
| CNAME | www | 60154334c82bd0a7.vercel-dns-016.com. |

Ao trocar de projeto, consulte novamente a configuração de DNS na Vercel.
Não substitua os registros por valores genéricos. Os registros de e-mail,
`_domainconnect`, SOA e nameservers não precisam mudar.

`NEXT_PUBLIC_SITE_URL` de produção usa `https://gwstoreofc.com`. A página `/`
é pública e apresenta a futura loja. O painel usa `/admin` e suas subrotas,
por exemplo `/admin/pedidos` e `/admin/catalogo/produtos`. O Proxy autentica
o usuário antes de reescrever essas URLs para as páginas existentes. Links
antigos de painel redirecionam para as novas rotas; requisições POST e suas
Server Actions continuam preservadas. A invalidação de cache usa a rota
interna que foi reescrita.

A THStore continua com seu painel na raiz. O painel mestre da 101Devs
continua em `/admin` no seu domínio, com autenticação Google. Apenas as
rotas conhecidas do painel da GWStore são reescritas; caminhos desconhecidos
ou de administração mestre continuam protegidos pelo gate mestre.

## Autenticação

Enquanto a conta Owner do Supabase não liberar os novos callbacks, a variável
`GWSTORE_LOGIN_ORIGIN=https://gwstore.vercel.app` inicia o login no endereço
legado antes de criar cookies PKCE. O painel fica nesse endereço durante a
sessão; o domínio novo continua disponível para a página pública e pagamentos.

O callback da aplicação precisa permanecer na origem onde foram criados os
cookies de PKCE e de estado. `getStoreAuthSiteUrl` aceita somente origens da
GWStore reconhecidas e exige HTTPS em produção. A URL canônica continua
sendo usada para novos links de pagamentos e outros links públicos.

No Supabase `athucowvfccegkzgcnli`, Authentication → URL Configuration deve
preservar os callbacks existentes, incluindo `101devs.com`, e incluir:

- `https://gwstoreofc.com/auth/callback`
- `https://www.gwstoreofc.com/auth/callback`
- `https://gwstoreofc.com/auth/callback?**`
- `https://www.gwstoreofc.com/auth/callback?**`
- `https://gwstore.vercel.app/auth/callback?**`
- `https://gwstoreofc.com/api/sorteios/oauth/retorno?**`
- `https://www.gwstoreofc.com/api/sorteios/oauth/retorno?**`
- `https://gwstore.vercel.app/api/sorteios/oauth/retorno?**`

O callback configurado no provedor Discord continua sendo
`https://athucowvfccegkzgcnli.supabase.co/auth/v1/callback`.
As consultas `next` e `state` continuam validadas pela aplicação; os padrões
da allowlist limitam os retornos às rotas de callback desses hosts.

## Publicação

O alias legado `gwstore.vercel.app` precisa apontar para o mesmo deployment
de produção dos domínios novos, conforme `eclipsepay-gwstore.md`. Isso mantém
webhooks do bot e links de pagamento já enviados funcionando. Não remova
esse alias ao conectar o domínio próprio.

Depois de publicar, confira HTTPS, a página pública, `/admin`, login Discord,
uma subrota do painel, compatibilidade dos links antigos e ausência de
redirecionamento para o painel Google da 101Devs no acesso comum da loja.
