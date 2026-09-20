-- Ajoute un chat partagé entre TOUS les utilisateurs de l'app (contrairement
-- au reste, qui est toujours privé par compte). N'importe quel compte connecté
-- peut lire tous les messages et en envoyer — mais il faut quand même être
-- connecté (session valide) pour y accéder, comme partout ailleurs.
-- À coller dans Supabase → SQL Editor → Run, après les correctifs précédents.

create table messages_chat (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id) on delete cascade,
  texte text not null,
  cree_le timestamptz not null default now()
);

alter table messages_chat enable row level security;

create or replace function envoyer_message_chat(p_token uuid, p_texte text)
returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid; v_texte text;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;

  v_texte := trim(p_texte);
  if v_texte is null or length(v_texte) = 0 then
    raise exception 'MESSAGE_VIDE';
  end if;
  if length(v_texte) > 2000 then
    raise exception 'MESSAGE_TROP_LONG';
  end if;

  insert into messages_chat (compte_id, texte) values (v_compte_id, v_texte) returning id into v_id;
  return v_id;
end; $$;

create or replace function lister_messages_chat(p_token uuid, p_limite int default 50)
returns table(id uuid, nom text, photo_data text, texte text, cree_le timestamptz)
language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  -- Il faut être connecté (n'importe quel compte) pour lire le chat, mais pas
  -- besoin que ce soit SON message : c'est un chat partagé, pas un journal privé.
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;

  return query
    select m.id, c.nom, c.photo_data, m.texte, m.cree_le
    from (
      select * from messages_chat order by cree_le desc limit p_limite
    ) m
    join comptes c on c.id = m.compte_id
    order by m.cree_le asc;
end; $$;

grant execute on function envoyer_message_chat to anon;
grant execute on function lister_messages_chat to anon;
