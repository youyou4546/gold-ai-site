-- Gold AI — mise en place de la base Supabase (comptes + journal privé par utilisateur)
-- À coller dans Supabase → SQL Editor → New query → Run (une seule fois).
--
-- Personne ne peut lire ou modifier ces tables directement (RLS activé, aucune
-- règle d'accès). Seules les fonctions ci-dessous (contrôlées une par une) y
-- ont accès — c'est elles que le site appelle, jamais les tables directement.

create extension if not exists pgcrypto;

-- ============ TABLES ============

create table acces_site (
  id int primary key default 1,
  code_hash text not null,
  constraint un_seul_code check (id = 1)
);

-- ⚠️ REMPLACE "MON_CODE_ACCES_SECRET" PAR LE CODE QUE TU VEUX DONNER À TON AMI
-- avant de cliquer sur "Run". Une fois exécuté, seule la version hachée
-- (illisible) reste dans la base — mais si tu relances ce script plus tard,
-- pense à remettre un vrai code à ce moment-là aussi.
insert into acces_site (id, code_hash) values (1, crypt('MON_CODE_ACCES_SECRET', gen_salt('bf')));

create table comptes (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  code_hash text not null,
  cree_le timestamptz not null default now()
);

create table sessions (
  token uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id) on delete cascade,
  cree_le timestamptz not null default now()
);

create table trades (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id) on delete cascade,
  date_trade date not null,
  resultat numeric not null,
  note text,
  cree_le timestamptz not null default now()
);

alter table acces_site enable row level security;
alter table comptes enable row level security;
alter table sessions enable row level security;
alter table trades enable row level security;

-- ============ FONCTIONS (seul point d'entrée depuis le site) ============

create or replace function verifier_code_acces(p_code text)
returns boolean language plpgsql security definer as $$
begin
  return exists (select 1 from acces_site where code_hash = crypt(p_code, code_hash));
end; $$;

create or replace function creer_compte(p_nom text, p_code text, p_code_acces text)
returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_token uuid;
begin
  if not exists (select 1 from acces_site where code_hash = crypt(p_code_acces, code_hash)) then
    raise exception 'CODE_ACCES_INVALIDE';
  end if;
  if p_nom is null or length(trim(p_nom)) = 0 then
    raise exception 'NOM_VIDE';
  end if;
  if p_code is null or length(p_code) < 4 then
    raise exception 'CODE_TROP_COURT';
  end if;
  if exists (select 1 from comptes where lower(nom) = lower(p_nom)) then
    raise exception 'NOM_DEJA_PRIS';
  end if;
  insert into comptes (nom, code_hash) values (trim(p_nom), crypt(p_code, gen_salt('bf')))
    returning id into v_compte_id;
  insert into sessions (compte_id) values (v_compte_id) returning token into v_token;
  return v_token;
end; $$;

create or replace function se_connecter(p_nom text, p_code text)
returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_token uuid;
begin
  select id into v_compte_id from comptes
    where lower(nom) = lower(p_nom) and code_hash = crypt(p_code, code_hash);
  if v_compte_id is null then
    raise exception 'IDENTIFIANTS_INVALIDES';
  end if;
  insert into sessions (compte_id) values (v_compte_id) returning token into v_token;
  return v_token;
end; $$;

create or replace function nom_depuis_session(p_token uuid)
returns text language plpgsql security definer as $$
declare v_nom text;
begin
  select c.nom into v_nom from sessions s join comptes c on c.id = s.compte_id
    where s.token = p_token;
  return v_nom;
end; $$;

create or replace function se_deconnecter(p_token uuid)
returns void language plpgsql security definer as $$
begin
  delete from sessions where token = p_token;
end; $$;

create or replace function lister_mes_trades(p_token uuid)
returns setof trades language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query select * from trades where compte_id = v_compte_id order by date_trade;
end; $$;

create or replace function ajouter_mon_trade(p_token uuid, p_date date, p_resultat numeric, p_note text)
returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  insert into trades (compte_id, date_trade, resultat, note)
    values (v_compte_id, p_date, p_resultat, p_note) returning id into v_id;
  return v_id;
end; $$;

create or replace function supprimer_mon_trade(p_token uuid, p_trade_id uuid)
returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  delete from trades where id = p_trade_id and compte_id = v_compte_id;
end; $$;

-- Autorise le site public (rôle "anon", la clé publique) à appeler ces
-- fonctions précises — jamais un accès direct aux tables.
grant execute on function verifier_code_acces to anon;
grant execute on function creer_compte(text, text, text) to anon;
grant execute on function se_connecter to anon;
grant execute on function nom_depuis_session to anon;
grant execute on function se_deconnecter to anon;
grant execute on function lister_mes_trades to anon;
grant execute on function ajouter_mon_trade to anon;
grant execute on function supprimer_mon_trade to anon;
