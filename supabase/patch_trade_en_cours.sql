-- Trade en cours (bouton « J'entre » du calculateur) — 2026-09-28.
-- Un trade suivi à la fois par utilisateur. Le site le crée / le retire avec
-- la session ; le PC (site/suivre_trades.py) le lit chaque minute avec le
-- secret de publication, détecte les TP / SL touchés et envoie les
-- notifications au(x) téléphone(s) de CET utilisateur seulement.
-- À coller dans Supabase → SQL Editor → Run. Peut être relancé sans risque.

create table if not exists trades_en_cours (
  compte_id uuid primary key references comptes(id) on delete cascade,
  contenu jsonb not null,
  maj_le timestamptz not null default now()
);
alter table trades_en_cours enable row level security;

-- Depuis le site : définir (ou retirer avec p_contenu = null) / lire son trade en cours.
create or replace function definir_mon_trade_en_cours(p_token uuid, p_contenu jsonb)
returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  if p_contenu is null then
    delete from trades_en_cours where compte_id = v_compte_id;
  else
    insert into trades_en_cours (compte_id, contenu, maj_le) values (v_compte_id, p_contenu, now())
    on conflict (compte_id) do update set contenu = excluded.contenu, maj_le = now();
  end if;
end; $$;

create or replace function obtenir_mon_trade_en_cours(p_token uuid)
returns jsonb language plpgsql security definer as $$
declare v_compte_id uuid; v_contenu jsonb;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  select contenu into v_contenu from trades_en_cours where compte_id = v_compte_id;
  return v_contenu;
end; $$;

-- Depuis le PC (secret de publication).
create or replace function lister_trades_en_cours(p_secret text)
returns table(compte_id uuid, contenu jsonb) language plpgsql security definer as $$
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  return query select t.compte_id, t.contenu from trades_en_cours t;
end; $$;

-- Mise à jour par le PC seulement si c'est toujours le même trade (p_id),
-- pour ne jamais écraser un nouveau trade créé entre-temps.
create or replace function maj_trade_en_cours(p_secret text, p_compte_id uuid, p_id text, p_contenu jsonb)
returns boolean language plpgsql security definer as $$
declare v_n int;
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  update trades_en_cours set contenu = p_contenu, maj_le = now()
    where compte_id = p_compte_id and contenu->>'id' = p_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end; $$;

create or replace function lister_abonnements_push_compte(p_secret text, p_compte_id uuid)
returns table(endpoint text, p256dh text, auth text) language plpgsql security definer as $$
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  return query select a.endpoint, a.p256dh, a.auth from abonnements_push a where a.compte_id = p_compte_id;
end; $$;

grant execute on function definir_mon_trade_en_cours(uuid, jsonb) to anon;
grant execute on function obtenir_mon_trade_en_cours(uuid) to anon;
grant execute on function lister_trades_en_cours(text) to anon;
grant execute on function maj_trade_en_cours(text, uuid, text, jsonb) to anon;
grant execute on function lister_abonnements_push_compte(text, uuid) to anon;

notify pgrst, 'reload schema';
