# Categorias de tickets da GWStore

O bot organiza seus tickets do servidor `1401264061101899820` em três categorias
no início da lista de categorias, nesta ordem: `🛒┊COMPRA`, `🆙┊UPPER` e `📦┊VENDA`. A THStore e os
tickets do Ticket King mantêm sua organização anterior.

Compra recebe pedidos de itens, carrinhos, Robux, pagamentos tardios e
atendimentos para entrega de resgates da roleta e prêmios de sorteios.
Upper recebe pedidos compostos apenas por serviços de UP, incluindo pagamentos
tardios e tickets recuperados. A classificação consulta todas as linhas do
pedido e o catálogo UP; os IDs dos serviços originais também identificam UP se
o produto tiver sido movido de catálogo. Produtos pausados ou arquivados ainda
recebem atendimento. Estoque ilimitado, nome do canal e nome do produto não
determinam a categoria: frutas permanentes e carrinhos mistos ficam em Compra.
Pedidos antigos sem linhas usam o produto principal como identificação.
Venda recebe as ofertas abertas pelo botão **Vender um item**.

Cada fonte resolve a categoria ao criar ou recuperar seu ticket. Na produção,
o postbuild cria as categorias quando faltam, preserva a ordem relativa das
demais e move os tickets existentes reconhecidos pelo marcador do bot no
tópico. Canais públicos e tickets de outros bots não são classificados por nome.
A categoria manual `UP DE CONTAS` e seus tickets continuam separados. Se a
consulta dos pedidos falhar, a sincronização não reordena nem move tickets.
Na criação de um ticket pago, essa falha é registrada e o atendimento continua
em Compra, podendo ser organizado pela próxima sincronização.

A movimentação altera apenas `parent_id`: não sincroniza permissões com a
categoria, não muda nomes ou tópicos, não reabre tickets concluídos e não altera
mensagens. Ao final, o sincronizador verifica os destinos, a ordem das categorias
e a preservação das permissões e do estado de cada ticket.

Para sincronizar manualmente com as variáveis do bot configuradas:

```sh
npm run discord:categories:sync --workspace @godawp/web
```

Após publicar, conferir o alias legado `gwstore.vercel.app`, usado pelo Discord,
conforme `eclipsepay-gwstore.md`.
