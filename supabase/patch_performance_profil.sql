-- Ajoute : réglages de trading personnels, plusieurs comptes de trading par
-- utilisateur (avec calcul Daily Loss Limit / Max Drawdown), et la possibilité
-- de lier chaque trade à un compte précis. À coller dans Supabase → SQL
-- Editor → Run, APRÈS schema.sql et patch_securite_creation_compte.sql.

-- ============ RÉGLAGES DE TRADING (Profil > Paramètres) ============

create table parametres_trading (
  compte_id uuid primary key references comptes(id) on delete cascade,
  solde_compte numeric,
  pourcentage_risque numeric,
  repartition_tp1 numeric,
  repartition_tp2 numeric,
  repartition_runner numeric,
  max_trades_jour int,
  seuil_gain_arret numeric,
  nombre_pertes_arret int,
  heure_debut_session text,
  heure_fin_session text,
  maj_le timestamptz not null default now()
);

alter table parametres_trading enable row level security;

create or replace function obtenir_mes_parametres(p_token uuid)
returns parametres_trading language plpgsql security definer as $$
declare v_compte_id uuid; v_ligne parametres_trading;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  select * into v_ligne from parametres_trading where compte_id = v_compte_id;
  return v_ligne;
end; $$;

create or replace function sauvegarder_mes_parametres(
  p_token uuid, p_solde_compte numeric, p_pourcentage_risque numeric,
  p_repartition_tp1 numeric, p_repartition_tp2 numeric, p_repartition_runner numeric,
  p_max_trades_jour int, p_seuil_gain_arret numeric, p_nombre_pertes_arret int,
  p_heure_debut_session text, p_heure_fin_session text
) returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;

  insert into parametres_trading (
    compte_id, solde_compte, pourcentage_risque, repartition_tp1, repartition_tp2,
    repartition_runner, max_trades_jour, seuil_gain_arret, nombre_pertes_arret,
    heure_debut_session, heure_fin_session, maj_le
  ) values (
    v_compte_id, p_solde_compte, p_pourcentage_risque, p_repartition_tp1, p_repartition_tp2,
    p_repartition_runner, p_max_trades_jour, p_seuil_gain_arret, p_nombre_pertes_arret,
    p_heure_debut_session, p_heure_fin_session, now()
  )
  on conflict (compte_id) do update set
    solde_compte = excluded.solde_compte,
    pourcentage_risque = excluded.pourcentage_risque,
    repartition_tp1 = excluded.repartition_tp1,
    repartition_tp2 = excluded.repartition_tp2,
    repartition_runner = excluded.repartition_runner,
    max_trades_jour = excluded.max_trades_jour,
    seuil_gain_arret = excluded.seuil_gain_arret,
    nombre_pertes_arret = excluded.nombre_pertes_arret,
    heure_debut_session = excluded.heure_debut_session,
    heure_fin_session = excluded.heure_fin_session,
    maj_le = now();
end; $$;

-- ============ COMPTES DE TRADING (Profil > Mes comptes) ============

create table comptes_trading (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id) on delete cascade,
  nom text not null,
  taille numeric not null,
  solde_actuel numeric not null,
  statut text not null check (statut in ('challenge', 'finance')),
  date_activation date,
  limite_perte_quotidienne_pct numeric not null default 5,
  limite_drawdown_max_pct numeric not null default 10,
  cree_le timestamptz not null default now()
);

alter table comptes_trading enable row level security;

create or replace function lister_mes_comptes_trading(p_token uuid)
returns setof comptes_trading language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query select * from comptes_trading where compte_id = v_compte_id order by cree_le;
end; $$;

create or replace function creer_compte_trading(
  p_token uuid, p_nom text, p_taille numeric, p_solde_actuel numeric, p_statut text,
  p_date_activation date, p_limite_perte_quotidienne_pct numeric default 5,
  p_limite_drawdown_max_pct numeric default 10
) returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  if p_statut not in ('challenge', 'finance') then raise exception 'STATUT_INVALIDE'; end if;

  insert into comptes_trading (
    compte_id, nom, taille, solde_actuel, statut, date_activation,
    limite_perte_quotidienne_pct, limite_drawdown_max_pct
  ) values (
    v_compte_id, p_nom, p_taille, p_solde_actuel, p_statut, p_date_activation,
    p_limite_perte_quotidienne_pct, p_limite_drawdown_max_pct
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function modifier_compte_trading(
  p_token uuid, p_id uuid, p_nom text, p_taille numeric, p_solde_actuel numeric,
  p_statut text, p_date_activation date, p_limite_perte_quotidienne_pct numeric,
  p_limite_drawdown_max_pct numeric
) returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  if p_statut not in ('challenge', 'finance') then raise exception 'STATUT_INVALIDE'; end if;

  update comptes_trading set
    nom = p_nom, taille = p_taille, solde_actuel = p_solde_actuel, statut = p_statut,
    date_activation = p_date_activation, limite_perte_quotidienne_pct = p_limite_perte_quotidienne_pct,
    limite_drawdown_max_pct = p_limite_drawdown_max_pct
  where id = p_id and compte_id = v_compte_id;

  if not found then raise exception 'COMPTE_TRADING_INTROUVABLE'; end if;
end; $$;

create or replace function supprimer_compte_trading(p_token uuid, p_id uuid)
returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  delete from comptes_trading where id = p_id and compte_id = v_compte_id;
end; $$;

-- ============ LIER CHAQUE TRADE À UN COMPTE DE TRADING ============

alter table trades add column if not exists compte_trading_id uuid references comptes_trading(id) on delete set null;

drop function if exists ajouter_mon_trade(uuid, date, numeric, text);

create or replace function ajouter_mon_trade(
  p_token uuid, p_date date, p_resultat numeric, p_note text,
  p_compte_trading_id uuid default null
) returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;

  -- Vérifie que le compte de trading appartient bien à cet utilisateur (si fourni)
  if p_compte_trading_id is not null and not exists (
    select 1 from comptes_trading where id = p_compte_trading_id and compte_id = v_compte_id
  ) then
    raise exception 'COMPTE_TRADING_INTROUVABLE';
  end if;

  insert into trades (compte_id, date_trade, resultat, note, compte_trading_id)
    values (v_compte_id, p_date, p_resultat, p_note, p_compte_trading_id) returning id into v_id;
  return v_id;
end; $$;

-- ============ Autorise le site (rôle "anon") à appeler ces fonctions ============

grant execute on function obtenir_mes_parametres to anon;
grant execute on function sauvegarder_mes_parametres to anon;
grant execute on function lister_mes_comptes_trading to anon;
grant execute on function creer_compte_trading to anon;
grant execute on function modifier_compte_trading to anon;
grant execute on function supprimer_compte_trading to anon;
grant execute on function ajouter_mon_trade(uuid, date, numeric, text, uuid) to anon;
