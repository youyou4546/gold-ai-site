-- Un trade importé = un SIGNAL (TP1/TP2/TP3… regroupés) — 2026-09-28.
-- Heure d'ouverture et sens, pour que le garde-fou compte un signal copié sur
-- plusieurs comptes comme 1 seul trade. Peut être relancé sans risque.
alter table trades add column if not exists ouvert_le timestamptz;
alter table trades add column if not exists sens text;
