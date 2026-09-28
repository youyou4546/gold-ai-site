-- Alertes sur Supabase, même PC éteint (2026-09-28).
-- MODÈLE : la version à coller (avec le vrai mot de passe) est générée par
-- preparer_alertes_cloud.py dans supabase/_A_EXECUTER_alertes_cloud.sql.
-- À coller dans Supabase → SQL Editor → Run, APRÈS le déploiement de la
-- fonction "verifications". Peut être relancé sans risque.

-- Mémoire des alertes déjà envoyées (une seule notification par annonce).
create table if not exists notifications_envoyees (
  cle text primary key,
  envoye_le timestamptz not null default now()
);
alter table notifications_envoyees enable row level security;

-- Horloge : appelle la fonction chaque minute.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'alertes-chaque-minute';
select cron.schedule(
  'alertes-chaque-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'URL_DE_LA_FONCTION',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'COLLE_ICI_LE_CRON_SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
