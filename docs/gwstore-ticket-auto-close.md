# Fechamento automático de tickets da GWStore

Ao usar **Marcar entrega concluída**, o bot confirma no banco a entrega e o prazo
de fechamento. Na GWStore (`1401264061101899820`), tickets de itens e Robux entram
na fila cinco minutos depois desse registro. Nos tickets de venda de itens para
a loja, **Concluir ticket** registra `completedAt` no tópico e inicia o mesmo
prazo de cinco minutos. A categoria do canal não interfere no agendamento.
Tickets de bots externos não entram nessas filas.

O job `/api/cron/discord-ticket-auto-close` roda a cada três minutos na GWStore.
O canal é fechado na primeira verificação depois do prazo: normalmente entre
cinco e oito minutos, acrescidos do tempo das APIs. As demais filas e o job de
recuperação de compras mantêm o agendamento de cinco minutos em
`/api/cron/discord-ticket-close-reconciliation`.

O fechamento mantém as validações de identidade do bot, servidor, ID do canal e
marcador do pedido. As reservas persistentes evitam exclusão duplicada e permitem
retomar falhas. A origem `orders` ou `robux` determina a tabela e o RPC de
conclusão; a fila de Robux e sua recuperação automática são restritas à GWStore.
Os demais servidores mantêm os trinta minutos anteriores para itens.

Vendas usam o estado persistido no tópico, sem criar pedidos ou registros de
pagamento. Antes de fechar, o bot verifica o servidor, o marcador da oferta, o
estado concluído, a data e sua própria mensagem inicial. O canal é relido antes
da exclusão. Uma falha mantém o ticket para a próxima execução. Tickets antigos
recebem o botão manual no deploy; a data da conclusão vem do aviso original do
bot e, quando esse aviso não existe, um novo prazo conservador começa na migração.
A mesma checagem recupera controles ausentes dos tickets de venda abertos ou
concluídos, sem editar novamente os botões que já estão corretos.
**Fechar ticket** exige confirmação privada e a mesma autorização do GodAwp ou
equipe configurada, tanto antes quanto depois da conclusão.

Aplicar `20261003000100_fix_gwstore_purchase_ticket_auto_close.sql` no banco da
GWStore. Publicar primeiro a versão compatível do bot, que aceita tanto o prazo
antigo quanto o novo durante a transição, e então aplicar a migração. Após o
deploy, conferir também o alias legado `gwstore.vercel.app`.

Na Vercel, verificar que o cron está ativo a cada três minutos e que os logs
mostram fechamento sem falhas. O endpoint retorna apenas contadores e exige
`Bearer CRON_SECRET`; falhas individuais retornam 503 para não parecerem sucesso.
