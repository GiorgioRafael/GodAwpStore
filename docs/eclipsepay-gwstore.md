# EclipsePay — GWStore

Integração dos checkouts de itens, Robux e moedas. THStore continua exclusivamente no
LivePix. O corte é controlado por `PAYMENT_PROVIDER=eclipsepay`, apenas na GWStore;
referências antigas continuam conciliadas no LivePix, independentemente dessa flag.

## Configuração do destino

- URL: `https://gwstore.vercel.app/api/webhooks/eclipsepay`
- Eventos: `charge.paid`, `charge.failed`, `charge.refunded`.
- Não selecionar eventos de `payout` ou `transfer`.
- Chave API com `charges:create` e `charges:read`, apenas no servidor.
- Variáveis apenas no projeto GWStore: `ECLIPSEPAY_API_KEY` e `ECLIPSEPAY_WEBHOOK_SECRET`.
- O segredo do webhook é distinto da chave API e aparece na criação/rotação do destino.
- Depois de configurar o segredo e publicar, usar **Testar** para emitir novo challenge.

O endpoint verifica HMAC-SHA256 dos bytes originais, timestamp, identificador e estrutura.
Challenges válidos retornam o desafio; testes não geram efeitos financeiros. Notificações
financeiras recebem 200 somente depois de persistidas. Falha de persistência retorna 503.

## Garantias e operação

- UUID da intenção e token privado persistidos antes de chamar o gateway; retries mantêm UUID e corpo.
- Checkout próprio `/pagamento/pix/<token>` com QR gerado localmente e copia-e-cola.
- Referência `ep:<uuid>` identifica EclipsePay; o campo `payment_provider` e o ledger registram o provedor real.
- RPCs históricas com nomes `livepix` permanecem por compatibilidade; seus predicados aceitam ambos os gateways.
- `GET /v1/charges/<id>` verifica estado e valor bruto antes de liberar pedido. A hora confirmada é derivada
  do snapshot `completed`, nunca da criação da cobrança, e é persistida para conciliação imutável.
- Fila persistente com lease, prioridade para notificações e retry no cron já existente, a cada cinco minutos.
- Falha no Discord não perde o pagamento: a página deixa de exibir QR pago e a fila repete a abertura do ticket.
- Estornos ficam em `/pagamentos-pix` com revisão obrigatória. Não há estorno automático de estoque,
  comissão ou moedas; a equipe confere a entrega antes de qualquer ajuste. Falhas não liberam entregas.
- Nunca remover as credenciais/webhook LivePix enquanto houver cobranças antigas pendentes.
- Validar o destino com **Testar** no painel EclipsePay e manter os três eventos indicados.

## Deploy

Somente projeto Vercel `gwstore` (`prj_NYK8rkr7K3NXU1uSls7x9oTLlmws`). Após publicar,
conferir também o alias `gwstore.vercel.app`: ele é um alias legado e precisou de
`vercel alias set <deployment> gwstore.vercel.app` para acompanhar a nova produção.
Não publicar o projeto THStore nem copiar as credenciais para ele.

As migrations `20260915000100` e `20260915000200` foram aplicadas somente no banco
GWStore, após verificações transacionais de itens, Robux e moedas com rollback.
Não usar `db push --include-all`: existem migrations históricas locais fora desta troca.

Validação: testes de assinatura/isolamento/idempotência/estornos/retentativa de ticket,
testes transacionais dos três fluxos e build Next.js. Nenhum Pix real foi pago nos testes.

Limites documentados: R$ 0,80–R$ 1.000,00 por cobrança; valor também deve superar a tarifa.
O valor líquido (`netCents`) não substitui `amountCents` na conferência do pedido.
Não dividir pedidos ou criar tentativas com UUID novo automaticamente para contornar limites.

Fontes oficiais:
- https://eclipsepaybr-com.mintlify.app/guias/receber-pix
- https://eclipsepaybr-com.mintlify.app/guias/idempotencia
- https://eclipsepaybr-com.mintlify.app/webhooks/assinatura
- https://eclipsepaybr-com.mintlify.app/webhooks/configuracao
- https://eclipsepaybr-com.mintlify.app/webhooks/eventos
