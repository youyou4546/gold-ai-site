-- Import automatique des trades TradeLocker dans le Journal — 2026-09-28.
-- Chaque position FERMÉE sur un compte TradeLocker connecté (Profil › Mes
-- comptes TradeLocker) devient un trade du Journal, modifiable comme les autres.
-- Cette table retient ce qui a déjà été importé : un trade n'est jamais importé
-- deux fois, et un trade supprimé du Journal ne revient pas.
-- Seules les positions fermées APRÈS l'ajout de la connexion sont importées.
-- Peut être relancé sans risque.

alter table comptes_tradelocker add column if not exists import_depuis timestamptz not null default now();
alter table comptes_tradelocker add column if not exists derniere_synchro timestamptz;

create table if not exists trades_importes_tl (
  cle text primary key,                 -- environnement|compte TradeLocker|position
  compte_id uuid not null references comptes(id) on delete cascade,
  connexion_id uuid references comptes_tradelocker(id) on delete set null,
  trade_id uuid,                        -- trade créé dans le Journal (peut avoir été supprimé depuis)
  resultat numeric,
  ferme_le timestamptz,
  cree_le timestamptz not null default now()
);
create index if not exists trades_importes_tl_compte on trades_importes_tl (compte_id, cree_le desc);
alter table trades_importes_tl enable row level security;
revoke all on trades_importes_tl from anon, authenticated;
