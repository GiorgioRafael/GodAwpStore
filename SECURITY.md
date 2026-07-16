# Política de segurança

## Relato responsável

Não abra uma issue pública contendo credenciais, estoque, dados pessoais ou uma
forma reproduzível de contornar autenticação. Contate o mantenedor do repositório
por um canal privado e inclua apenas o mínimo necessário para reproduzir o risco.

## Segredos

- Nunca versione `.env.local`, chaves Supabase, Client Secret do Discord ou
  conteúdos de estoque.
- Use chaves independentes para criptografia e fingerprint.
- Restrinja o `service_role` a código server-only.
- Revogue e substitua imediatamente qualquer segredo exposto.

## Dados reais

Antes de operar comercialmente, configure retenção, backups, resposta a incidentes
e os documentos de privacidade aplicáveis. Não use dados de clientes em testes.
