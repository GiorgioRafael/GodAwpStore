-- Publish a distinct, idempotent result message in the original giveaway
-- channel. Editing the old announcement alone is easy to miss.

begin;

set local lock_timeout = '5s';

alter table public.giveaways
  add column if not exists result_message_id text,
  add column if not exists result_publication_error text;

alter table public.giveaways
  drop constraint if exists giveaways_result_message_format;
alter table public.giveaways
  add constraint giveaways_result_message_format check (
    result_message_id is null or result_message_id ~ '^[0-9]{15,22}$'
  );

create or replace function public.record_giveaway_result_publication(
  p_giveaway_id uuid,
  p_message_id text,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if p_message_id is not null and p_message_id !~ '^[0-9]{15,22}$' then
    raise exception using errcode = '22023', message = 'Discord result message is invalid.';
  end if;

  update public.giveaways
  set
    result_message_id = coalesce(p_message_id, result_message_id),
    result_publication_error = case
      when p_message_id is not null then null
      else left(nullif(btrim(coalesce(p_error, '')), ''), 500)
    end
  where id = p_giveaway_id
    and status = 'completed';
  return found;
end
$$;

revoke all on function public.record_giveaway_result_publication(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_giveaway_result_publication(uuid, text, text)
  to service_role;

commit;
