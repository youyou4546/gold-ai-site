-- Comptes TradeLocker (Journal › Mes comptes TradeLocker) — 2026-09-28.
-- Identifiants TradeLocker de l'utilisateur, pour afficher dans l'app le solde,
-- le résultat du jour et les trades ouverts de TOUS ses comptes.
-- Le mot de passe est CHIFFRÉ par la fonction Supabase « tradelocker » (clé
-- secrète TL_CLE_CHIFFREMENT, jamais dans la base ni dans le site) : ce
-- tableau n'est lisible que par cette fonction (RLS activé, aucune règle).
-- À coller dans Supabase → SQL Editor → Run. Peut être relancé sans risque.

create table if not exists comptes_tradelocker (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id) on delete cascade,
  environnement text not null check (environnement in ('demo', 'live')),
  email text not null,
  serveur text not null,
  mot_de_passe_chiffre text not null,
  jeton_acces text,
  jeton_expire_le timestamptz,
  cree_le timestamptz not null default now(),
  unique (compte_id, environnement, email, serveur)
);
alter table comptes_tradelocker enable row level security;
revoke all on comptes_tradelocker from anon, authenticated;
