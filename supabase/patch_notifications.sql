-- Notifications sur le téléphone avant les annonces (2026-09-28).
-- Garde la liste des téléphones qui ont accepté les notifications
-- ("abonnements"). Le site enregistre l'abonnement avec la session de
-- l'utilisateur ; le PC (notifier_annonces.py) lit la liste avec le secret de
-- publication, comme pour publier les prix. Aucune donnée personnelle : un
-- abonnement n'est qu'une adresse technique fournie par le navigateur.
-- À coller dans Supabase → SQL Editor → Run. Peut être relancé sans risque.

create table if not exists abonnements_push (
  endpoint text primary key,
  compte_id uuid not null references comptes(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  cree_le timestamptz not null default now()
);
alter table abonnements_push enable row level security;

-- Depuis le site : activer / désactiver les notifications sur ce téléphone.
create or replace function enregistrer_abonnement_push(p_token uuid, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or length(p_endpoint) > 1000 then
    raise exception 'ABONNEMENT_INVALIDE';
  end if;
  insert into abonnements_push (endpoint, compte_id, p256dh, auth) values (p_endpoint, v_compte_id, p_p256dh, p_auth)
  on conflict (endpoint) do update set compte_id = excluded.compte_id, p256dh = excluded.p256dh, auth = excluded.auth;
end; $$;

create or replace function supprimer_mon_abonnement_push(p_token uuid, p_endpoint text)
returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  delete from abonnements_push where endpoint = p_endpoint and compte_id = v_compte_id;
end; $$;

-- Depuis le PC (secret de publication) : lire la liste, oublier un téléphone désabonné.
create or replace function lister_abonnements_push(p_secret text)
returns table(endpoint text, p256dh text, auth text) language plpgsql security definer as $$
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  return query select a.endpoint, a.p256dh, a.auth from abonnements_push a;
end; $$;

create or replace function retirer_abonnement_push(p_secret text, p_endpoint text)
returns void language plpgsql security definer as $$
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  delete from abonnements_push where endpoint = p_endpoint;
end; $$;

grant execute on function enregistrer_abonnement_push(uuid, text, text, text) to anon;
grant execute on function supprimer_mon_abonnement_push(uuid, text) to anon;
grant execute on function lister_abonnements_push(text) to anon;
grant execute on function retirer_abonnement_push(text, text) to anon;

notify pgrst, 'reload schema';
