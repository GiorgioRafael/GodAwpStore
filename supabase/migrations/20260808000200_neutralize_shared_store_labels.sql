-- Shared migrations run in both stores. Historical commerce fixtures used the
-- GWStore name, which leaked into THStore product cards and financial entries.

begin;

set local lock_timeout = '5s';

update public.products
set description = replace(description, ' da GWStore', ' da loja')
where slug in (
    '10x-super-watering-can',
    '10x-super-sprinkler',
    '1x-sunbloom',
    '1x-dragon-breath',
    'ghost-pepper'
  )
  and description like '% da GWStore%';

update public.ledger_entries
set description = case description
  when 'Lucro liquido da venda GWStore' then 'Lucro líquido da venda'
  when 'Comissao da plataforma GWStore' then 'Comissão da plataforma'
  else description
end
where description in (
  'Lucro liquido da venda GWStore',
  'Comissao da plataforma GWStore'
);

create or replace function private.normalize_shared_ledger_description()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.description := case new.description
    when 'Lucro liquido da venda GWStore' then 'Lucro líquido da venda'
    when 'Comissao da plataforma GWStore' then 'Comissão da plataforma'
    else new.description
  end;
  return new;
end;
$$;

revoke all on function private.normalize_shared_ledger_description()
  from public, anon, authenticated, service_role;

drop trigger if exists ledger_entries_normalize_shared_description
  on public.ledger_entries;
create trigger ledger_entries_normalize_shared_description
before insert or update of description on public.ledger_entries
for each row execute function private.normalize_shared_ledger_description();

comment on function private.normalize_shared_ledger_description() is
  'Prevents the shared commerce function from persisting a tenant name in cross-store ledger entries.';

commit;
