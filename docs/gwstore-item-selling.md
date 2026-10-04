# Vender itens para a GWStore

O deployment de produção da GWStore publica `📦┊vender-itens` no servidor
`1401264061101899820`, preservando a categoria do canal público existente. O canal público
nega mensagens, tópicos e comandos aos membros; só o bot publica o formulário.
Essa mesma mensagem exibe as tabelas de preços de compra informados pelo GodAwp,
separadas em frutas físicas e skins, com itens e valores alinhados.

**Vender um item** abre um formulário com o nome do item. A confirmação cria um
ticket privado na categoria `📦┊VENDA` para o vendedor, GodAwp (`385924725332901909`), bot e responsáveis
já configurados em `ticket_close_admin_discord_user_ids`. A primeira mensagem
marca somente o GodAwp e o vendedor. Um vendedor com atendimento aberto recebe
o link do mesmo ticket, sem duplicar canais ou menções.

**Concluir ticket** está restrito ao GodAwp e aos mesmos responsáveis dos outros
tickets. A conclusão muda o nome para `✅・concluido-…`, bloqueia novas mensagens
do vendedor, desativa o botão de conclusão e registra a data no tópico do canal.
O ticket fica programado para fechar após cinco minutos. A checagem ocorre a
cada três minutos, então o fechamento normalmente ocorre entre cinco e oito
minutos após concluir. Repetir a conclusão não reinicia esse prazo.

**Fechar ticket** fica disponível nos tickets abertos e concluídos. Apenas
GodAwp e a equipe autorizada podem confirmar o fechamento, em uma mensagem
privada. O backend verifica novamente a autorização e o ticket antes de apagar
o canal. A oferta não cria pedido, cobrança, estoque ou entrada no ranking de
compradores.

O estado é persistido no tópico do canal, com marcador `gwstore-item-offer:`.
Repetições e timeouts recuperam o canal e a mensagem inicial. O sincronizador
recupera o canal público pela descrição do atendimento e migra o marcador
antigo `gwstore-item-selling:v1` sem criar outro canal.
O deploy também atualiza os botões das mensagens iniciais dos tickets de venda
existentes, sem duplicar mensagens ou menções. Conclusões antigas usam a data
do aviso de conclusão do próprio bot; sem esse aviso, o prazo de cinco minutos
começa na atualização do estado.
Não há migração de banco. A THStore não executa esse fluxo.

Após o deploy, conferir o alias legado `gwstore.vercel.app`, usado pelas
interações do Discord. Ele precisa apontar para o novo deployment de produção,
conforme documentado em `eclipsepay-gwstore.md`.

Para republicar manualmente com as variáveis do bot configuradas:

```sh
npm run discord:selling:sync --workspace @godawp/web
```
