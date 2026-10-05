-- Comptes MT5 ajoutés DEPUIS L'APP par chaque utilisateur (mot de passe INVESTISSEUR :
-- lecture seule). Le PC (site/sync_mt5.py) récupère la liste avec le secret de
-- publication, lit chaque compte avec MetaTrader 5 et publie ses chiffres dans
-- comptes_mt5 (patch_comptes_mt5.sql). Le mot de passe est chiffré (pgcrypto) avec
-- une clé gardée dans une table sans accès public ; il n'est jamais renvoyé à l'app.

create table if not exists secret_mt5 (
  id int primary key default 1,
  cle text not null,
  constraint un_seul_secret_mt5 check (id = 1)
);
alter table secret_mt5 enable row level security;
insert into secret_mt5 (id, cle) values (1, encode(gen_random_bytes(32), 'hex')) on conflict (id) do nothing;

create table if not exists connexions_mt5 (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id) on delete cascade,
  login bigint not null,
  serveur text not null,
  nom text,
  mdp_chiffre bytea not null,
  depart numeric, perte_max numeric, perte_jour numeric, objectif_pct numeric,
  erreur text,
  cree_le timestamptz not null default now(),
  unique (compte_id, login)
);
alter table connexions_mt5 enable row level security;

create or replace function ajouter_connexion_mt5(p_token uuid, p_login bigint, p_serveur text, p_mdp text, p_nom text,
  p_depart numeric, p_perte_max numeric, p_perte_jour numeric, p_objectif_pct numeric)
returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  if p_login is null or p_login <= 0 or coalesce(trim(p_serveur), '') = '' or coalesce(p_mdp, '') = '' then
    raise exception 'CHAMPS_MANQUANTS';
  end if;
  insert into connexions_mt5 (compte_id, login, serveur, nom, mdp_chiffre, depart, perte_max, perte_jour, objectif_pct)
  values (v_compte_id, p_login, trim(p_serveur), nullif(trim(p_nom), ''),
          pgp_sym_encrypt(p_mdp, (select s.cle from secret_mt5 s where s.id = 1)),
          p_depart, p_perte_max, p_perte_jour, p_objectif_pct)
  on conflict (compte_id, login) do update set serveur = excluded.serveur, nom = excluded.nom, mdp_chiffre = excluded.mdp_chiffre,
    depart = excluded.depart, perte_max = excluded.perte_max, perte_jour = excluded.perte_jour, objectif_pct = excluded.objectif_pct, erreur = null
  returning id into v_id;
  return v_id;
end; $$;

-- Liste pour l'app : jamais le mot de passe.
create or replace function lister_mes_connexions_mt5(p_token uuid)
returns table (id uuid, login bigint, serveur text, nom text, erreur text, cree_le timestamptz)
language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query select c.id, c.login, c.serveur, c.nom, c.erreur, c.cree_le from connexions_mt5 c where c.compte_id = v_compte_id order by c.cree_le;
end; $$;

create or replace function supprimer_connexion_mt5(p_token uuid, p_id uuid)
returns void language plpgsql security definer as $$
declare v_compte_id uuid; v_login bigint;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  delete from connexions_mt5 where id = p_id and compte_id = v_compte_id returning login into v_login;
  if v_login is not null then
    delete from comptes_mt5 where compte_id = v_compte_id and cle = 'mt5|' || v_login;
  end if;
end; $$;

-- Pour le PC seulement (secret de publication) : comptes à lire, mot de passe déchiffré.
create or replace function connexions_mt5_a_lire(p_secret text)
returns table (id uuid, utilisateur text, login bigint, serveur text, mdp text, nom text,
  depart numeric, perte_max numeric, perte_jour numeric, objectif_pct numeric)
language plpgsql security definer as $$
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  return query select c.id, u.nom, c.login, c.serveur, pgp_sym_decrypt(c.mdp_chiffre, (select s.cle from secret_mt5 s where s.id = 1)),
    c.nom, c.depart, c.perte_max, c.perte_jour, c.objectif_pct
  from connexions_mt5 c join comptes u on u.id = c.compte_id;
end; $$;

-- Le PC signale si la lecture échoue (mauvais mot de passe, serveur inconnu…), null = OK.
create or replace function signaler_connexion_mt5(p_secret text, p_id uuid, p_erreur text)
returns void language plpgsql security definer as $$
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  update connexions_mt5 set erreur = p_erreur where id = p_id;
end; $$;
