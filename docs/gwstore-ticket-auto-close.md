# Fechamento automático de compras da GWStore

Ao usar **Marcar entrega concluída**, o bot confirma no banco a entrega e o prazo
de fechamento. Na GWStore (`1401264061101899820`), tickets de itens e Robux entram
na fila cinco minutos depois desse registro. A categoria do canal não interfere
no agendamento. Ofertas de itens para a loja e tickets de bots externos não
entram nessa fila.

O job `/api/cron/discord-ticket-auto-close` roda a cada minuto na GWStore. O canal
é fechado na primeira verificação depois do prazo: normalmente entre cinco e
seis minutos, acrescidos do tempo das APIs. As demais filas mantêm o agendamento
de cinco minutos em `/api/cron/discord-ticket-close-reconciliation`.

O fechamento mantém as validações de identidade do bot, servidor, ID do canal e
marcador do pedido. As reservas persistentes evitam exclusão duplicada e permitem
retomar falhas. A origem `orders` ou `robux` determina a tabela e o RPC de
conclusão; a fila de Robux e sua recuperação automática são restritas à GWStore.
Os demais servidores mantêm os trinta minutos anteriores para itens.

Aplicar `20261003000100_fix_gwstore_purchase_ticket_auto_close.sql` no banco da
GWStore. Publicar primeiro a versão compatível do bot, que aceita tanto o prazo
antigo quanto o novo durante a transição, e então aplicar a migração. Após o
deploy, conferir também o alias legado `gwstore.vercel.app`.

Na Vercel, verificar que o novo cron está ativo a cada minuto e que os logs
mostram fechamento sem falhas. O endpoint retorna apenas contadores e exige
`Bearer CRON_SECRET`; falhas individuais retornam 503 para não parecerem sucesso.
