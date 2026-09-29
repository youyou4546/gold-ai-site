-- Gold AI — Fiche de trade : enregistrer le trade DANS un compte TradeLocker
-- existant (colonnes trades.compte_tl / compte_tl_nom, déjà créées par
-- patch_trades_compte_tl.sql), au lieu de le laisser « sans compte ».
--
-- p_compte_tl : null = garder le compte déjà enregistré (ancienne version de
-- l'app, ou trade importé), '' = aucun compte, sinon la clé ("demo|2501723").

drop function if exists enregistrer_mon_trade(uuid, uuid, date, numeric, text, uuid, text, numeric, numeric, numeric, numeric);

create or replace function enregistrer_mon_trade(
  p_token uuid, p_trade_id uuid, p_date date, p_resultat numeric, p_note text,
  p_compte_trading_id uuid, p_instrument text, p_frais numeric,
  p_prix_entree numeric, p_prix_sortie numeric, p_rr numeric,
  p_compte_tl text default null, p_compte_tl_nom text default null
) returns uuid language plpgsql security definer as $$
declare v_compte_id uuid; v_id uuid;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;

  if p_compte_trading_id is not null and not exists (
    select 1 from comptes_trading where id = p_compte_trading_id and compte_id = v_compte_id
  ) then
    raise exception 'COMPTE_TRADING_INTROUVABLE';
  end if;

  if p_trade_id is null then
    insert into trades (compte_id, date_trade, resultat, note, compte_trading_id, instrument, frais, prix_entree, prix_sortie, rr, compte_tl, compte_tl_nom)
      values (v_compte_id, p_date, p_resultat, p_note, p_compte_trading_id,
              nullif(upper(trim(p_instrument)), ''), p_frais, p_prix_entree, p_prix_sortie, p_rr,
              nullif(p_compte_tl, ''), case when nullif(p_compte_tl, '') is null then null else p_compte_tl_nom end)
      returning id into v_id;
  else
    update trades set
      date_trade = p_date, resultat = p_resultat, note = p_note, compte_trading_id = p_compte_trading_id,
      instrument = nullif(upper(trim(p_instrument)), ''), frais = p_frais,
      prix_entree = p_prix_entree, prix_sortie = p_prix_sortie, rr = p_rr, modifie_le = now(),
      compte_tl = case when p_compte_tl is null then compte_tl else nullif(p_compte_tl, '') end,
      compte_tl_nom = case when p_compte_tl is null then compte_tl_nom
                           when p_compte_tl = '' then null else coalesce(p_compte_tl_nom, compte_tl_nom) end
    where id = p_trade_id and compte_id = v_compte_id
    returning id into v_id;
    if v_id is null then raise exception 'TRADE_INTROUVABLE'; end if;
  end if;
  return v_id;
end; $$;

grant execute on function enregistrer_mon_trade(uuid, uuid, date, numeric, text, uuid, text, numeric, numeric, numeric, numeric, text, text) to anon;

notify pgrst, 'reload schema';
