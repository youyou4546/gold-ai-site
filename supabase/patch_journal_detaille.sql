-- Journal : fiche détaillée pour chaque trade (2026-09-28).
-- Ajoute prix d'entrée, prix de sortie, RR obtenu, et des captures d'écran
-- (images) rattachées au trade. Les notes utilisent la colonne "note" déjà
-- existante. À coller dans Supabase → SQL Editor → Run, après les correctifs
-- précédents. Peut être relancé sans risque.
--
-- Les images sont stockées dans la base (petites images compressées par le
-- téléphone avant l'envoi), dans une table à part pour que la liste des
-- trades reste légère : elles ne sont chargées qu'à l'ouverture d'un trade.
-- Même protection que le reste : tout passe par des fonctions qui vérifient
-- la session, la table n'est pas lisible directement.

-- ============ 1. NOUVELLES COLONNES DU TRADE ============

alter table trades add column if not exists prix_entree numeric;
alter table trades add column if not exists prix_sortie numeric;
alter table trades add column if not exists rr numeric;
alter table trades add column if not exists modifie_le timestamptz;

-- ============ 2. IMAGES DES TRADES ============

create table if not exists trades_images (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references trades(id) on delete cascade,
  compte_id uuid not null references comptes(id) on delete cascade,
  image_data text not null,
  cree_le timestamptz not null default now()
);
create index if not exists trades_images_trade_idx on trades_images(trade_id);
alter table trades_images enable row level security;

-- ============ 3. AJOUTER OU MODIFIER UN TRADE (fiche complète) ============
-- p_trade_id vide → nouveau trade ; sinon → modification de ce trade
-- (seulement s'il appartient au compte connecté).

create or replace function enregistrer_mon_trade(
  p_token uuid, p_trade_id uuid, p_date date, p_resultat numeric, p_note text,
  p_compte_trading_id uuid, p_instrument text, p_frais numeric,
  p_prix_entree numeric, p_prix_sortie numeric, p_rr numeric
) returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;

  if p_compte_trading_id is not null and not exists (
    select 1 from comptes_trading where id = p_compte_trading_id and compte_id = v_compte_id
  ) then
    raise exception 'COMPTE_TRADING_INTROUVABLE';
  end if;

  if p_trade_id is null then
    insert into trades (compte_id, date_trade, resultat, note, compte_trading_id, instrument, frais, prix_entree, prix_sortie, rr)
      values (v_compte_id, p_date, p_resultat, p_note, p_compte_trading_id,
              nullif(upper(trim(p_instrument)), ''), p_frais, p_prix_entree, p_prix_sortie, p_rr)
      returning id into v_id;
  else
    update trades set
      date_trade = p_date, resultat = p_resultat, note = p_note, compte_trading_id = p_compte_trading_id,
      instrument = nullif(upper(trim(p_instrument)), ''), frais = p_frais,
      prix_entree = p_prix_entree, prix_sortie = p_prix_sortie, rr = p_rr, modifie_le = now()
    where id = p_trade_id and compte_id = v_compte_id
    returning id into v_id;
    if v_id is null then raise exception 'TRADE_INTROUVABLE'; end if;
  end if;
  return v_id;
end; $$;

-- ============ 4. IMAGES : lister / ajouter / supprimer ============

create or replace function lister_images_trade(p_token uuid, p_trade_id uuid)
returns table(id uuid, image_data text) language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query select i.id, i.image_data from trades_images i
    where i.trade_id = p_trade_id and i.compte_id = v_compte_id order by i.cree_le;
end; $$;

create or replace function ajouter_image_trade(p_token uuid, p_trade_id uuid, p_image_data text)
returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  if not exists (select 1 from trades where id = p_trade_id and compte_id = v_compte_id) then
    raise exception 'TRADE_INTROUVABLE';
  end if;
  -- Garde-fous : uniquement une image, et pas plus de ~3 Mo de texte.
  if p_image_data is null or p_image_data not like 'data:image/%' or length(p_image_data) > 3000000 then
    raise exception 'IMAGE_INVALIDE';
  end if;
  if (select count(*) from trades_images where trade_id = p_trade_id) >= 10 then
    raise exception 'TROP_D_IMAGES';
  end if;
  insert into trades_images (trade_id, compte_id, image_data) values (p_trade_id, v_compte_id, p_image_data)
    returning id into v_id;
  return v_id;
end; $$;

create or replace function supprimer_image_trade(p_token uuid, p_image_id uuid)
returns boolean language plpgsql security definer as $$
declare v_compte_id uuid; v_n int;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  delete from trades_images where id = p_image_id and compte_id = v_compte_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end; $$;

-- Nombre d'images par trade (pour afficher 📷 dans la liste sans tout charger).
create or replace function compter_images_mes_trades(p_token uuid)
returns table(trade_id uuid, nombre int) language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query select i.trade_id, count(*)::int from trades_images i
    where i.compte_id = v_compte_id group by i.trade_id;
end; $$;

grant execute on function enregistrer_mon_trade(uuid, uuid, date, numeric, text, uuid, text, numeric, numeric, numeric, numeric) to anon;
grant execute on function lister_images_trade(uuid, uuid) to anon;
grant execute on function ajouter_image_trade(uuid, uuid, text) to anon;
grant execute on function supprimer_image_trade(uuid, uuid) to anon;
grant execute on function compter_images_mes_trades(uuid) to anon;

-- lister_mes_trades renvoie "select * from trades" : les nouvelles colonnes
-- (prix_entree, prix_sortie, rr) y apparaissent automatiquement.
