-- Gold AI — Analyse › Mes trades : résultat de chaque position d'un trade
-- importé (TP1, TP2, TP3… dans l'ordre de fermeture), pour compter combien
-- de fois chaque TP est atteint. Lecture seule, trades de l'utilisateur connecté.

create or replace function lister_positions_importees(p_token uuid)
returns table(trade_id uuid, resultat numeric, ferme_le timestamptz)
language plpgsql security definer as $$
declare v_compte_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return query
    select i.trade_id, i.resultat, i.ferme_le
    from trades_importes_tl i
    join trades t on t.id = i.trade_id and t.compte_id = v_compte_id
    where i.compte_id = v_compte_id
    order by i.trade_id, i.ferme_le;
end; $$;

grant execute on function lister_positions_importees(uuid) to anon;

notify pgrst, 'reload schema';
