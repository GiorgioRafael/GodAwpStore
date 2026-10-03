# Categorias de tickets da GWStore

O bot organiza seus tickets do servidor `1401264061101899820` em duas categorias
no início da lista de categorias: `🛒┊COMPRA` e `📦┊VENDA`. A THStore e os
tickets do Ticket King mantêm sua organização anterior.

Compra recebe pedidos de itens, carrinhos, Robux, pagamentos tardios e
atendimentos para entrega de resgates da roleta e prêmios de sorteios.
Venda recebe as ofertas abertas pelo botão **Vender um item**.

Cada fonte resolve a categoria ao criar ou recuperar seu ticket. Na produção,
o postbuild cria as categorias quando faltam, preserva a ordem relativa das
demais e move os tickets existentes reconhecidos pelo marcador do bot no
tópico. Canais públicos e tickets de outros bots não são classificados por nome.

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
