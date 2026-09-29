// Gold AI — Analyse › Analyse de graphique par l'IA (payant à l'usage).
//
// Le téléphone envoie une capture de graphique (JPEG réduit) ; cette fonction :
//  1. vérifie la session et les limites du jour (Toronto) : 5 analyses par
//     personne, 10 au total pour tous les utilisateurs (table analyses_graphique,
//     supabase/patch_analyse_graphique.sql) — la place est réservée AVANT l'appel ;
//  2. demande l'analyse à Claude Sonnet 5.5 (clé ANTHROPIC_API_KEY dans les
//     secrets Supabase, jamais dans le site), réponse en JSON structuré ;
//  3. enregistre la réponse et son coût, et les renvoie.
// Une analyse en erreur ne compte pas dans les limites.

import Anthropic from "npm:@anthropic-ai/sdk";
import { db } from "../_shared/tradelocker.ts";

const MODELE = "claude-sonnet-5-5";
const LIMITE_PAR_PERSONNE = 5;
const LIMITE_TOTALE = 10;
// Prix en $ US par million de tokens (entrée, sortie) — pour afficher le coût de chaque analyse.
const PRIX: Record<string, [number, number]> = {
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-opus-4-8": [5, 25],
  "claude-haiku-4-5": [1, 5],
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const repondre = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const texte = { type: "string" };
const scenario = {
  type: "object", additionalProperties: false,
  required: ["conditions", "entree", "stop", "objectifs"],
  properties: { conditions: texte, entree: texte, stop: texte, objectifs: texte },
};
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["lisible", "instrument", "unite_de_temps", "tendance", "zones", "scenario_achat", "scenario_vente", "invalidation", "resume", "prudence"],
  properties: {
    lisible: { type: "boolean" },
    instrument: texte,
    unite_de_temps: texte,
    tendance: {
      type: "object", additionalProperties: false, required: ["direction", "explication"],
      properties: { direction: { type: "string", enum: ["haussière", "baissière", "neutre"] }, explication: texte },
    },
    zones: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["type", "prix", "commentaire"],
        properties: { type: { type: "string", enum: ["résistance", "support", "zone d'offre", "zone de demande", "autre"] }, prix: texte, commentaire: texte },
      },
    },
    scenario_achat: scenario,
    scenario_vente: scenario,
    invalidation: texte,
    resume: texte,
    prudence: texte,
  },
};

const CONSIGNES = `Tu es un analyste technique expérimenté qui aide un trader particulier (surtout l'or, XAUUSD) à lire SON graphique.
On t'envoie une capture d'écran (TradingView ou TradeLocker). Réponds en français simple, sans jargon inutile.
- Lis les prix sur l'axe de droite : ne donne que des niveaux que tu vois réellement sur la capture ; s'ils sont illisibles, dis-le.
- Tendance : direction et pourquoi (structure des sommets / creux, moyennes mobiles visibles…).
- Zones clés : supports, résistances, zones d'offre / de demande, avec leur prix approximatif.
- Un scénario d'achat ET un scénario de vente : conditions pour entrer, entrée, stop, objectifs.
- Invalidation : ce qui rendrait ton analyse fausse.
- Résumé en 2 phrases, puis une phrase de prudence (ce n'est pas un conseil financier, attention aux annonces économiques).
Si l'image n'est pas un graphique de prix lisible, mets "lisible" à false et explique pourquoi dans "resume".`;

function jourToronto(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function compter(compteId: string) {
  const debut = new Date(Date.now() - 36 * 3600000).toISOString(); // assez large, puis filtre sur la journée de Toronto
  const { data } = await db.from("analyses_graphique").select("compte_id, cree_le, statut").gte("cree_le", debut).neq("statut", "erreur");
  const aujourdhui = jourToronto();
  const duJour = (data || []).filter((x) => jourToronto(new Date(x.cree_le as string)) === aujourdhui);
  return { moi: duJour.filter((x) => x.compte_id === compteId).length, total: duJour.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let reservation: string | null = null;
  try {
    const corps = await req.json().catch(() => ({}));
    const token = String(corps.token || "");
    if (!/^[0-9a-f-]{36}$/i.test(token)) return repondre({ erreur: "SESSION_INVALIDE" }, 401);
    const { data: session } = await db.from("sessions").select("compte_id").eq("token", token).maybeSingle();
    if (!session) return repondre({ erreur: "SESSION_INVALIDE" }, 401);
    const compteId = session.compte_id as string;

    const image = String(corps.image || "");
    const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return repondre({ erreur: "Image manquante ou illisible." }, 400);
    if (m[2].length > 5_000_000) return repondre({ erreur: "Image trop lourde." }, 400);
    const question = String(corps.question || "").trim().slice(0, 500);

    // Place réservée avant l'appel payant, puis limites vérifiées (5 par personne, 10 au total).
    const { data: ligne, error: errRes } = await db.from("analyses_graphique")
      .insert({ compte_id: compteId, question: question || null, modele: MODELE }).select("id").single();
    if (errRes) throw errRes;
    reservation = ligne.id as string;
    const n = await compter(compteId);
    if (n.moi > LIMITE_PAR_PERSONNE || n.total > LIMITE_TOTALE) {
      await db.from("analyses_graphique").delete().eq("id", reservation);
      reservation = null;
      return repondre({ erreur: n.moi > LIMITE_PAR_PERSONNE
        ? `Tu as déjà utilisé tes ${LIMITE_PAR_PERSONNE} analyses d'aujourd'hui. Reviens demain.`
        : `Les ${LIMITE_TOTALE} analyses du jour (tous les utilisateurs) sont déjà utilisées. Reviens demain.` }, 429);
    }

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
    // deno-lint-ignore no-explicit-any
    const reponse: any = await client.beta.messages.create({
      model: MODELE,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // si l'IA refuse pour une raison de sécurité, un autre modèle prend le relais
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: CONSIGNES,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
          { type: "text", text: question ? `Ma question : ${question}` : "Analyse ce graphique." },
        ],
      // deno-lint-ignore no-explicit-any
      }] as any,
    // deno-lint-ignore no-explicit-any
    } as any);

    const u = reponse.usage || {};
    const entree = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    const sortie = u.output_tokens || 0;
    const [pe, ps] = PRIX[reponse.model] || PRIX[MODELE];
    const cout = Math.round(((entree * pe + sortie * ps) / 1e6) * 10000) / 10000;

    if (reponse.stop_reason === "refusal") {
      await db.from("analyses_graphique").update({ statut: "erreur", erreur: "refus", tokens_entree: entree, tokens_sortie: sortie, cout_usd: cout }).eq("id", reservation);
      return repondre({ erreur: "L'IA a refusé d'analyser cette image. Essaie avec une autre capture." }, 422);
    }
    // deno-lint-ignore no-explicit-any
    const brut = (reponse.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let analyse: unknown;
    try { analyse = JSON.parse(brut); } catch { analyse = { lisible: true, resume: brut, zones: [] }; }

    await db.from("analyses_graphique").update({
      statut: "ok", modele: reponse.model, tokens_entree: entree, tokens_sortie: sortie, cout_usd: cout, reponse: analyse,
    }).eq("id", reservation);
    const apres = await compter(compteId);
    return repondre({ ok: true, analyse, cout_usd: cout, modele: reponse.model, moi: apres.moi, total: apres.total,
      limite_moi: LIMITE_PAR_PERSONNE, limite_total: LIMITE_TOTALE });
  } catch (e) {
    console.error("analyse-graphique", e);
    if (reservation) await db.from("analyses_graphique").update({ statut: "erreur", erreur: String((e as Error)?.message || e).slice(0, 500) }).eq("id", reservation);
    const status = (e as { status?: number })?.status;
    return repondre({ erreur: status === 401
      ? "La clé de l'IA est refusée : elle doit être renouvelée."
      : status === 429 || status === 529 ? "L'IA est surchargée pour l'instant. Réessaie dans une minute (cette tentative ne compte pas)."
      : "L'analyse a échoué (cette tentative ne compte pas). Réessaie dans un moment." }, 500);
  }
});
