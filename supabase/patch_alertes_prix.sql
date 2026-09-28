-- Alertes de prix (Journal › Suivre le prix) — 2026-09-28.
-- Un prix (bas = haut) ou une zone (bas < haut) sur l'or. La fonction
-- « verifications » (Supabase, chaque minute) regarde les bougies 1 min et
-- envoie une notification au(x) téléphone(s) de l'utilisateur quand le prix
-- touche le niveau / entre dans la zone. Chaque alerte ne sonne qu'une fois.
-- À coller dans Supabase → SQL Editor → Run. Peut être relancé sans risque.

create table if not exists alertes_prix (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id) on delete cascade,
  bas numeric not null,
  haut numeric not null,
  note text,
  prix_creation numeric,
  cree_le timestamptz not null default now(),
  derniere_verif timestamptz,
  touchee_le timestamptz,
  prix_touche numeric,
  check (bas > 0 and haut >= bas)
);
create index if not exists alertes_prix_actives on alertes_prix (compte_id) where touchee_le is null;
alter table alertes_prix enable row level security;

create or replace function lister_mes_alertes_prix(p_token uuid)
returns setof alertes_prix language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query select * from alertes_prix where compte_id = v_compte_id
    order by (touchee_le is null) desc, coalesce(touchee_le, cree_le) desc;
end; $$;

create or replace function ajouter_alerte_prix(p_token uuid, p_bas numeric, p_haut numeric, p_note text, p_prix_creation numeric)
returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  if (select count(*) from alertes_prix where compte_id = v_compte_id and touchee_le is null) >= 20 then
    raise exception 'TROP_ALERTES';
  end if;
  insert into alertes_prix (compte_id, bas, haut, note, prix_creation)
    values (v_compte_id, least(p_bas, p_haut), greatest(p_bas, p_haut), nullif(left(trim(coalesce(p_note, '')), 120), ''), p_prix_creation)
    returning id into v_id;
  return v_id;
end; $$;

create or replace function supprimer_alerte_prix(p_token uuid, p_id uuid)
returns boolean language plpgsql security definer as $$
declare v_compte_id uuid; v_n int;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  delete from alertes_prix where id = p_id and compte_id = v_compte_id;
  get diagnostics v_n = row_count;
  return v_n > 0;
end; $$;

grant execute on function lister_mes_alertes_prix(uuid) to anon;
grant execute on function ajouter_alerte_prix(uuid, numeric, numeric, text, numeric) to anon;
grant execute on function supprimer_alerte_prix(uuid, uuid) to anon;

notify pgrst, 'reload schema';
