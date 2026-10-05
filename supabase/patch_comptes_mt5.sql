-- Comptes MT5 (ex. FundedNext) lus en LECTURE SEULE par le PC (site/sync_mt5.py,
-- mot de passe investisseur) et publiés ici toutes les 15 min. Chaque ligne
-- appartient à UN utilisateur de l'app : seul lui la relit (lire_mes_comptes_mt5).

create table if not exists comptes_mt5 (
  compte_id uuid not null references comptes(id) on delete cascade,
  cle text not null,              -- "mt5|<login>"
  contenu jsonb not null,
  maj_le timestamptz not null default now(),
  primary key (compte_id, cle)
);
alter table comptes_mt5 enable row level security;

-- Écriture : PC seulement (même secret que publier_donnees).
create or replace function publier_compte_mt5(p_secret text, p_utilisateur text, p_cle text, p_contenu jsonb)
returns timestamptz language plpgsql security definer as $$
declare v_compte_id uuid; v_maintenant timestamptz := now();
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  select id into v_compte_id from comptes where nom = p_utilisateur;
  if v_compte_id is null then raise exception 'UTILISATEUR_INCONNU'; end if;
  if p_cle !~ '^mt5\|[0-9]+$' then raise exception 'CLE_INVALIDE'; end if;
  insert into comptes_mt5 (compte_id, cle, contenu, maj_le) values (v_compte_id, p_cle, p_contenu, v_maintenant)
  on conflict (compte_id, cle) do update set contenu = excluded.contenu, maj_le = excluded.maj_le;
  return v_maintenant;
end; $$;

-- Lecture : la personne connectée, ses comptes seulement.
create or replace function lire_mes_comptes_mt5(p_token uuid)
returns table (cle text, contenu jsonb, maj_le timestamptz)
language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query select c.cle, c.contenu, c.maj_le from comptes_mt5 c where c.compte_id = v_compte_id order by c.cle;
end; $$;
