-- Gold AI — Analyse › Analyse de graphique par l'IA (Claude Sonnet 5.5, payant).
-- Chaque analyse est enregistrée (compteurs + historique). Limites (journée de
-- Toronto) : 5 par personne et 10 au total pour tous les utilisateurs —
-- vérifiées par la fonction Supabase « analyse-graphique » avant l'appel payant.

create table if not exists analyses_graphique (
  id uuid primary key default gen_random_uuid(),
  compte_id uuid not null references comptes(id) on delete cascade,
  cree_le timestamptz not null default now(),
  statut text not null default 'en_cours',   -- en_cours / ok / erreur
  question text,
  modele text,
  tokens_entree int,
  tokens_sortie int,
  cout_usd numeric,
  reponse jsonb,
  erreur text
);
create index if not exists analyses_graphique_jour on analyses_graphique (cree_le);
alter table analyses_graphique enable row level security; -- aucune règle : accès seulement par les fonctions

-- Compteurs du jour (Toronto) + mes dernières analyses réussies, pour l'écran.
create or replace function mes_analyses_graphique(p_token uuid)
returns jsonb language plpgsql security definer as $$
declare v_compte_id uuid; v_jour date := (now() at time zone 'America/Toronto')::date;
begin
  select compte_id into v_compte_id from sessions where token = p_token;
  if v_compte_id is null then raise exception 'SESSION_INVALIDE'; end if;
  return jsonb_build_object(
    'moi', (select count(*) from analyses_graphique where compte_id = v_compte_id and statut <> 'erreur'
             and (cree_le at time zone 'America/Toronto')::date = v_jour),
    'total', (select count(*) from analyses_graphique where statut <> 'erreur'
             and (cree_le at time zone 'America/Toronto')::date = v_jour),
    'limite_moi', 5, 'limite_total', 10,
    'historique', coalesce((select jsonb_agg(x order by x.cree_le desc) from (
        select id, cree_le, question, reponse, cout_usd from analyses_graphique
        where compte_id = v_compte_id and statut = 'ok' order by cree_le desc limit 10) x), '[]'::jsonb)
  );
end; $$;

grant execute on function mes_analyses_graphique(uuid) to anon;

notify pgrst, 'reload schema';
