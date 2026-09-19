-- Correctif de sécurité : la création de compte doit vérifier le code
-- d'accès du site, sinon quelqu'un qui découvre juste l'adresse Supabase
-- (visible dans le code public du site) pourrait créer un compte sans avoir
-- jamais vu/connu ce code. À coller dans Supabase → SQL Editor → Run,
-- APRÈS avoir déjà lancé schema.sql une première fois.

drop function if exists creer_compte(text, text);

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

grant execute on function creer_compte(text, text, text) to anon;
