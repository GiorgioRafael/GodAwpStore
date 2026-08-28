-- A loja principal segue o jogo dela.
--
-- O gatilho copiava o status do jogo para a loja principal na CRIAÇÃO e nunca
-- mais. Um jogo criado como Inativo nascia com a loja principal inativa, e
-- nenhuma migration, RPC ou ação do painel jamais escreve status='active' em
-- catalog_stores: reativar o jogo pelo formulário não alcançava a loja. O jogo
-- virava um beco sem saída permanente — a loja não aparecia em Configurações
-- para ser corrigida, e nenhum produto podia ser cadastrado nela.
--
-- A loja principal não é uma entidade que o operador administra à parte: ela é
-- o próprio jogo visto pelo catálogo. Então ela acompanha o jogo, sempre. As
-- lojas secundárias continuam independentes.

begin;

set local lock_timeout = '5s';

create or replace function public.ensure_default_catalog_store()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.catalog_stores (
    game_id, name, slug, status, is_default, sort_order, archived_at, created_by
  ) values (
    new.id,
    new.name,
    'loja-principal',
    new.status,
    true,
    0,
    new.archived_at,
    new.created_by
  )
  on conflict do nothing;

  -- Em UPDATE o insert acima não faz nada (on conflict), então a sincronização
  -- precisa ser explícita: é o que faltava para reativar um jogo devolver a
  -- loja principal dele.
  if tg_op = 'UPDATE' then
    update public.catalog_stores as store
    set status = new.status,
        archived_at = new.archived_at
    where store.game_id = new.id
      and store.is_default
      and (store.status is distinct from new.status
        or store.archived_at is distinct from new.archived_at);
  end if;

  return new;
end
$$;

revoke all on function public.ensure_default_catalog_store() from public;

drop trigger if exists games_ensure_default_catalog_store on public.games;
create trigger games_ensure_default_catalog_store
after insert or update on public.games
for each row execute function public.ensure_default_catalog_store();

-- Conserta quem já está preso: loja principal parada num estado que o painel
-- não alcança, com o jogo dela viva.
update public.catalog_stores as store
set status = game.status,
    archived_at = game.archived_at
from public.games as game
where game.id = store.game_id
  and store.is_default
  and (store.status is distinct from game.status
    or store.archived_at is distinct from game.archived_at);

commit;
