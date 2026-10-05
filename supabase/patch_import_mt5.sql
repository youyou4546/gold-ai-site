-- Trades fermés des comptes MT5 → Journal (comme l'import TradeLocker).
-- Le PC (site/sync_mt5.py) lit l'historique MT5 en lecture seule, regroupe les
-- positions d'un même signal (même instrument et sens, ouvertes à ≤ 2 min) et
-- envoie la liste ; chaque signal n'est importé qu'UNE fois (trades_importes_mt5),
-- même s'il est ensuite supprimé du Journal.

create table if not exists trades_importes_mt5 (
  ref text primary key,                 -- mt5|<login>|<1re position du signal>
  compte_id uuid not null references comptes(id) on delete cascade,
  trade_id uuid,
  cree_le timestamptz not null default now()
);
alter table trades_importes_mt5 enable row level security;

create or replace function importer_trades_mt5(p_secret text, p_utilisateur text, p_cle text, p_nom text, p_trades jsonb)
returns int language plpgsql security definer as $$
declare
  v_compte_id uuid; v_fuseau text; t jsonb; v_trade_id uuid; v_n int := 0;
begin
  if not exists (select 1 from secret_publication where secret_hash = crypt(p_secret, secret_hash)) then
    raise exception 'SECRET_INVALIDE';
  end if;
  select id into v_compte_id from comptes where nom = p_utilisateur;
  if v_compte_id is null then raise exception 'UTILISATEUR_INCONNU'; end if;
  if p_cle !~ '^mt5\|[0-9]+$' then raise exception 'CLE_INVALIDE'; end if;
  select coalesce(nullif(parametres_calculateur->>'fuseau', ''), 'America/Toronto') into v_fuseau
    from parametres_trading where compte_id = v_compte_id;
  v_fuseau := coalesce(v_fuseau, 'America/Toronto');

  for t in select * from jsonb_array_elements(coalesce(p_trades, '[]'::jsonb)) loop
    -- Réservé AVANT de créer le trade : deux passages simultanés ne l'importent pas deux fois.
    insert into trades_importes_mt5 (ref, compte_id) values (t->>'ref', v_compte_id) on conflict (ref) do nothing;
    if not found then continue; end if;
    insert into trades (compte_id, date_trade, resultat, frais, instrument, compte_tl, compte_tl_nom, ouvert_le, sens, prix_entree, prix_sortie, note)
    values (
      v_compte_id,
      ((t->>'ferme_le')::timestamptz at time zone v_fuseau)::date,
      (t->>'resultat')::numeric,
      nullif((t->>'frais')::numeric, 0),
      t->>'instrument', p_cle, p_nom,
      (t->>'ouvert_le')::timestamptz, t->>'sens',
      (t->>'prix_entree')::numeric, (t->>'prix_sortie')::numeric,
      t->>'note')
    returning id into v_trade_id;
    update trades_importes_mt5 set trade_id = v_trade_id where ref = t->>'ref';
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
