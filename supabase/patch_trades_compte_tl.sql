-- Compte TradeLocker de chaque trade importé (filtre « Compte » du Calendrier
-- et de la Performance) — 2026-09-28. Les trades saisis à la main restent vides.
-- lister_mes_trades renvoie « setof trades » : les nouvelles colonnes arrivent
-- toutes seules dans l'app. Peut être relancé sans risque.

alter table trades add column if not exists compte_tl text;      -- "live|<id du compte TradeLocker>"
alter table trades add column if not exists compte_tl_nom text;  -- ex. "NOVA 50K #123456"

-- Trades déjà importés avant ce patch : compte retrouvé grâce à la mémoire d'import et à la note.
update trades t
set compte_tl = split_part(i.cle, '|', 1) || '|' || split_part(i.cle, '|', 2),
    compte_tl_nom = substring(t.note from 'Importé de TradeLocker · (.+? #[0-9]+) ·')
from trades_importes_tl i
where i.trade_id = t.id and t.compte_tl is null;
