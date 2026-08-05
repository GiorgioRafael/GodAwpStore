-- A roda da THStore, uma vez.
--
-- Rodar DEPOIS de as migrations da roleta estarem aplicadas no banco da
-- THStore, e só lá:
--   psql "$THSTORE_DATABASE_URL" --set ON_ERROR_STOP=1 \
--     --file supabase/seeds/thstore_roulette_wheel.sql
--
-- Os produtos são procurados pelo NOME, não por id: os ids são do banco da
-- THStore e não existem neste repositório. Se algum nome não casar, a
-- transação inteira é recusada em vez de montar meia roda — uma fatia faltando
-- muda a chance de todas as outras, e portanto o RTP.
--
-- RTP 64,2%. Prêmio médio R$ 0,642 por giro, custo R$ 0,378 com markup de 70%,
-- sobra R$ 0,572 — 60% da receita líquida, contra os 41% que uma venda normal
-- rende. Seguro com recompra de 50% e de 100%: a 100% cada giro devolve 64% de
-- uma moeda, abaixo do teto de 100% em que o saldo do jogador pararia de
-- encolher e um depósito viraria giros sem fim.
--
-- A #10 tem estoque 1. É o chamariz da roda, e depois de sair uma vez a fatia
-- precisa ser trocada no painel: o resgate seguinte falharia por falta de
-- estoque, e quem descobre isso é o jogador.

begin;

set local lock_timeout = '5s';

create temporary table wheel_seed (
  prize_key text primary key,
  product_name text not null,
  prize_quantity integer not null,
  draw_weight integer not null
) on commit drop;

insert into wheel_seed (prize_key, product_name, prize_quantity, draw_weight) values
  ('premio_1',  'Super Sprinkler',                           6, 3200),
  ('premio_2',  'Mega Seed',                                10, 2400),
  ('premio_3',  'Super Watering Can',                        5, 1600),
  ('premio_4',  'Ghost Pepper',                              1, 1200),
  ('premio_5',  '1000x Maple Bambo',                         1,  900),
  ('premio_6',  '1b Sheckles',                               1,  500),
  ('premio_7',  '5x Star Fruit (Promoção)',                  1,  180),
  ('premio_8',  '50x Super Watering + 50x Super Sprinkler',  1,   90),
  ('premio_9',  '100m Fall Sheckels',                        1,   26),
  ('premio_10', 'Black Dragon (Top 25)',                     1,    2);

-- Um nome que não casa, ou que casa com dois produtos, para tudo aqui.
do $$
declare
  v_seed record;
  v_matches integer;
begin
  for v_seed in select * from wheel_seed loop
    select count(*)
    into v_matches
    from public.products as product
    where product.name = v_seed.product_name
      and product.status = 'active'
      and product.archived_at is null;

    if v_matches <> 1 then
      raise exception using
        errcode = '22023',
        message = format(
          'A fatia %s procura "%s" e encontrou %s produto(s) ativo(s).',
          v_seed.prize_key, v_seed.product_name, v_matches
        );
    end if;
  end loop;
end
$$;

delete from public.roulette_prize_products;

insert into public.roulette_prize_products (prize_key, product_id, prize_quantity, draw_weight)
select
  seed.prize_key,
  product.id,
  seed.prize_quantity,
  seed.draw_weight
from wheel_seed as seed
join public.products as product
  on product.name = seed.product_name
  and product.status = 'active'
  and product.archived_at is null;

-- O que foi montado, em números, para conferir antes do commit.
select
  slot.prize_key,
  product.name,
  slot.prize_quantity as qtd,
  (product.minimum_price_cents * slot.prize_quantity) as valor_centavos,
  round(
    slot.draw_weight * 10000.0 / sum(slot.draw_weight) over (),
    1
  ) as chance_bps,
  product.stock_quantity as estoque
from public.roulette_prize_products as slot
join public.products as product on product.id = slot.product_id
order by (substring(slot.prize_key from '\d+'))::integer;

select
  round(
    sum(slot.draw_weight * product.minimum_price_cents * slot.prize_quantity)::numeric
      / sum(slot.draw_weight) / 100,
    2
  ) as rtp_percentual
from public.roulette_prize_products as slot
join public.products as product on product.id = slot.product_id;

commit;
