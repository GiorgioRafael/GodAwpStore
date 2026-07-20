-- PostgreSQL defers PL/pgSQL statement validation until first execution.
-- Recreate the two already-deployed functions with explicit enum casts while
-- keeping the first migration correct for fresh databases.

begin;

do $migration$
declare
  v_definition text;
  v_fixed text;
begin
  select pg_get_functiondef(
    'public.admin_create_giveaway(text,uuid,text,text,text,text,text,text,text,timestamptz,timestamptz,integer,integer,integer,jsonb)'::regprocedure
  ) into v_definition;
  v_fixed := replace(
    v_definition,
    'case when p_starts_at <= statement_timestamp() then ''active'' else ''scheduled'' end,',
    'case when p_starts_at <= statement_timestamp() then ''active''::public.giveaway_status else ''scheduled''::public.giveaway_status end,'
  );
  if v_fixed = v_definition
    and position('''active''::public.giveaway_status' in v_definition) = 0 then
    raise exception 'Could not patch admin_create_giveaway enum cast.';
  end if;
  execute v_fixed;

  select pg_get_functiondef(
    'public.register_giveaway_referral(uuid,uuid,text,text,text,timestamptz,boolean)'::regprocedure
  ) into v_definition;
  v_fixed := replace(
    v_definition,
    'case when p_initially_valid then ''valid'' else ''pending'' end,',
    'case when p_initially_valid then ''valid''::public.giveaway_referral_status else ''pending''::public.giveaway_referral_status end,'
  );
  if v_fixed = v_definition
    and position('''valid''::public.giveaway_referral_status' in v_definition) = 0 then
    raise exception 'Could not patch register_giveaway_referral enum cast.';
  end if;
  execute v_fixed;
end
$migration$;

commit;
