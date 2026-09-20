-- Ajoute la possibilité de changer sa photo de profil, son nom et son mot de
-- passe. La photo est stockée directement dans la base (petite image en
-- base64, pas de service de stockage séparé) pour rester protégée par le
-- même système de session que le reste — pas de nouvelle faille de sécurité
-- à surveiller. À coller dans Supabase → SQL Editor → Run, après les
-- correctifs précédents.

alter table comptes add column if not exists photo_data text;

create or replace function obtenir_mon_profil(p_token uuid)
returns table(nom text, photo_data text) language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query select c.nom, c.photo_data from comptes c where c.id = v_compte_id;
end; $$;

create or replace function modifier_ma_photo(p_token uuid, p_photo_data text)
returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  update comptes set photo_data = p_photo_data where id = v_compte_id;
end; $$;

create or replace function modifier_mon_nom(p_token uuid, p_nouveau_nom text)
returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  if p_nouveau_nom is null or length(trim(p_nouveau_nom)) = 0 then
    raise exception 'NOM_VIDE';
  end if;
  if exists (select 1 from comptes where lower(nom) = lower(p_nouveau_nom) and id != v_compte_id) then
    raise exception 'NOM_DEJA_PRIS';
  end if;
  update comptes set nom = trim(p_nouveau_nom) where id = v_compte_id;
end; $$;

create or replace function modifier_mon_mot_de_passe(p_token uuid, p_ancien_mot_de_passe text, p_nouveau_mot_de_passe text)
returns void language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;

  if not exists (select 1 from comptes where id = v_compte_id and code_hash = crypt(p_ancien_mot_de_passe, code_hash)) then
    raise exception 'ANCIEN_MOT_DE_PASSE_INCORRECT';
  end if;
  if p_nouveau_mot_de_passe is null or length(p_nouveau_mot_de_passe) < 4 then
    raise exception 'CODE_TROP_COURT';
  end if;

  update comptes set code_hash = crypt(p_nouveau_mot_de_passe, gen_salt('bf')) where id = v_compte_id;
end; $$;

grant execute on function obtenir_mon_profil to anon;
grant execute on function modifier_ma_photo to anon;
grant execute on function modifier_mon_nom to anon;
grant execute on function modifier_mon_mot_de_passe to anon;
