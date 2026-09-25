-- Gold AI — patch "Calculateur, cotations en direct, annonces, analyses".
-- À coller dans Supabase → SQL Editor → New query → Run, APRÈS les patchs
-- précédents (schema.sql, patch_securite_creation_compte.sql,
-- patch_performance_profil.sql, patch_mon_compte.sql, patch_chat.sql).
--
-- ⚠️ Deux valeurs à remplacer avant de cliquer sur "Run" (tout en bas) :
--   COLLE_ICI_LA_CLE_TWELVE_DATA  → la clé de config/config.ini, section [api]
--   COLLE_ICI_LE_SECRET_PUBLICATION → le secret de config/config.ini, section [site_supabase]
-- (Une version déjà remplie est générée localement par site/preparer_patch_local.py,
-- dans un fichier ignoré par git — ne jamais committer les vraies valeurs.)
--
-- Comme pour les patchs précédents : aucune table n'est lisible directement,
-- tout passe par des fonctions qui vérifient la session.

-- ============ 1. PARAMÈTRES DU CALCULATEUR (Profil > Général) ============
-- Un seul objet JSON (solde, devise, mode de risque, répartition des TP,
-- spécifications par instrument) : permet d'ajouter un instrument sans
-- modifier la structure de la table.

alter table parametres_trading add column if not exists parametres_calculateur jsonb;

create or replace function obtenir_parametres_calculateur(p_token uuid)
returns jsonb language plpgsql security definer as $$
declare v_compte_id uuid; v_json jsonb;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  select parametres_calculateur into v_json from parametres_trading where compte_id = v_compte_id;
  return v_json;
end; $$;

create or replace function sauvegarder_parametres_calculateur(p_token uuid, p_parametres jsonb)
returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  insert into parametres_trading (compte_id, parametres_calculateur, maj_le)
    values (v_compte_id, p_parametres, now())
  on conflict (compte_id) do update set
    parametres_calculateur = excluded.parametres_calculateur,
    maj_le = now();
end; $$;

-- ============ 2. SUPPRESSION D'UN TRADE CONFIRMÉE PAR LE SERVEUR ============
-- L'ancienne version renvoyait "succès" même si aucune ligne n'était
-- supprimée : le site ne pouvait pas savoir si la suppression avait eu lieu.
-- Renvoie maintenant true seulement si le trade existait et a été supprimé.

drop function if exists supprimer_mon_trade(uuid, uuid);

create function supprimer_mon_trade(p_token uuid, p_trade_id uuid)
returns boolean language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  delete from trades where id = p_trade_id and compte_id = v_compte_id;
  return found;
end; $$;

-- ============ 3. TRADES : INSTRUMENT + FRAIS (optionnels) ============
-- Le résultat saisi reste le résultat du trade en $. Les frais, s'ils sont
-- renseignés, sont déduits dans Performance (résultat net = résultat - frais).

alter table trades add column if not exists instrument text;
alter table trades add column if not exists frais numeric;

drop function if exists ajouter_mon_trade(uuid, date, numeric, text, uuid);

create or replace function ajouter_mon_trade(
  p_token uuid, p_date date, p_resultat numeric, p_note text,
  p_compte_trading_id uuid default null, p_instrument text default null, p_frais numeric default null
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

  insert into trades (compte_id, date_trade, resultat, note, compte_trading_id, instrument, frais)
    values (v_compte_id, p_date, p_resultat, p_note, p_compte_trading_id,
            nullif(upper(trim(p_instrument)), ''), p_frais)
    returning id into v_id;
  return v_id;
end; $$;

-- ============ 4. DONNÉES PUBLIÉES PAR LE PC (marché, calendrier, actualités) ============
-- Avant : les scripts Python écrivaient des fichiers JSON sur le PC, mais
-- rien ne les envoyait sur le site en ligne → prix et calendrier figés.
-- Maintenant : les scripts publient ici (protégé par un secret), le site lit
-- ici (réservé aux utilisateurs connectés).

create table if not exists donnees_publiees (
  nom text primary key,
  contenu jsonb not null,
  publie_le timestamptz not null default now()
);
alter table donnees_publiees enable row level security;

create table if not exists secret_publication (
  id int primary key default 1,
  secret_hash text not null,
  constraint un_seul_secret check (id = 1)
);
alter table secret_publication enable row level security;

create or replace function publier_donnees(p_secret text, p_nom text, p_contenu jsonb)
returns timestamptz language plpgsql security definer as $$
declare v_maintenant timestamptz := now();
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  if p_nom not in ('marche', 'calendrier', 'actualites') then
    raise exception 'NOM_INVALIDE';
  end if;
  insert into donnees_publiees (nom, contenu, publie_le) values (p_nom, p_contenu, v_maintenant)
  on conflict (nom) do update set contenu = excluded.contenu, publie_le = excluded.publie_le;
  return v_maintenant;
end; $$;

create or replace function lire_donnees(p_token uuid)
returns table (nom text, contenu jsonb, publie_le timestamptz)
language plpgsql security definer as $$
begin
  if not exists (select 1 from sessions where token = p_token) then
    raise exception 'SESSION_INVALIDE';
  end if;
  return query select d.nom, d.contenu, d.publie_le from donnees_publiees d;
end; $$;

-- ============ 5. CLÉ DU FOURNISSEUR DE COTATIONS (Twelve Data) ============
-- Le site est public sur GitHub : la clé n'est jamais écrite dans son code.
-- Elle est remise uniquement à un utilisateur connecté.

create table if not exists config_cotations (
  id int primary key default 1,
  cle_twelvedata text not null,
  constraint une_seule_config check (id = 1)
);
alter table config_cotations enable row level security;

create or replace function obtenir_cle_cotations(p_token uuid)
returns text language plpgsql security definer as $$
declare v_cle text;
begin
  if not exists (select 1 from sessions where token = p_token) then
    raise exception 'SESSION_INVALIDE';
  end if;
  select cle_twelvedata into v_cle from config_cotations where id = 1;
  return v_cle;
end; $$;

-- ============ 6. HISTORIQUE DES ANALYSES "IMPACT PROBABLE" ============
-- Uniquement ajout + lecture : aucune fonction de modification ou de
-- suppression n'existe, une analyse enregistrée ne peut pas être réécrite.

create table if not exists analyses_impact (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id) on delete cascade,
  cree_le timestamptz not null default now(),
  actif text not null,
  horizon text not null,
  direction text not null,
  confiance text not null,
  prix_reference numeric,
  prix_reference_horodatage timestamptz,
  contenu jsonb not null
);
alter table analyses_impact enable row level security;

create or replace function enregistrer_analyse(
  p_token uuid, p_actif text, p_horizon text, p_direction text, p_confiance text,
  p_prix_reference numeric, p_prix_reference_horodatage timestamptz, p_contenu jsonb
) returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  insert into analyses_impact (compte_id, actif, horizon, direction, confiance,
                               prix_reference, prix_reference_horodatage, contenu)
    values (v_compte_id, p_actif, p_horizon, p_direction, p_confiance,
            p_prix_reference, p_prix_reference_horodatage, p_contenu)
    returning id into v_id;
  return v_id;
end; $$;

create or replace function lister_mes_analyses(p_token uuid, p_limite int default 20)
returns setof analyses_impact language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query select * from analyses_impact where compte_id = v_compte_id
    order by cree_le desc limit least(greatest(p_limite, 1), 200);
end; $$;

-- ============ Droits d'appel pour le site (rôle "anon") ============

grant execute on function obtenir_parametres_calculateur(uuid) to anon;
grant execute on function sauvegarder_parametres_calculateur(uuid, jsonb) to anon;
grant execute on function supprimer_mon_trade(uuid, uuid) to anon;
grant execute on function ajouter_mon_trade(uuid, date, numeric, text, uuid, text, numeric) to anon;
grant execute on function publier_donnees(text, text, jsonb) to anon;
grant execute on function lire_donnees(uuid) to anon;
grant execute on function obtenir_cle_cotations(uuid) to anon;
grant execute on function enregistrer_analyse(uuid, text, text, text, text, numeric, timestamptz, jsonb) to anon;
grant execute on function lister_mes_analyses(uuid, int) to anon;

-- ============ Valeurs secrètes (à remplacer, voir en haut) ============

insert into config_cotations (id, cle_twelvedata) values (1, 'COLLE_ICI_LA_CLE_TWELVE_DATA')
on conflict (id) do update set cle_twelvedata = excluded.cle_twelvedata;

insert into secret_publication (id, secret_hash) values (1, crypt('COLLE_ICI_LE_SECRET_PUBLICATION', gen_salt('bf')))
on conflict (id) do update set secret_hash = excluded.secret_hash;

-- Recharge la liste des fonctions côté API (sinon les nouvelles fonctions
-- peuvent mettre quelques minutes à apparaître).
notify pgrst, 'reload schema';
