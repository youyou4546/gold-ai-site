// Gold AI — Analyse › Analyse de graphique par l'IA (payant à l'usage).
//
// Le téléphone envoie une capture de graphique (JPEG réduit) ; cette fonction :
//  1. vérifie la session et les limites du jour (Toronto) : 5 analyses par
//     personne, 10 au total pour tous les utilisateurs (table analyses_graphique,
//     supabase/patch_analyse_graphique.sql) — la place est réservée AVANT l'appel ;
//  2. rassemble le CONTEXTE DE MARCHÉ : prix corrélés à l'or de la page Marché
//     (dollar, taux 10 ans, argent + corrélations mesurées), annonces
//     économiques DU JOUR seulement (journée de Toronto), actualités importantes,
//     tendance de l'or sur plusieurs unités de temps (envoyée par l'app si la page
//     Marché l'a calculée, sinon calculée ici avec les bougies 1 h et 4 h) ;
//  3. demande à Claude Sonnet 5.5 une analyse qui combine la capture ET ce
//     contexte (clé ANTHROPIC_API_KEY dans les secrets Supabase), en JSON structuré ;
//  4. enregistre la réponse et son coût, et les renvoie.
// Une analyse en erreur ne compte pas dans les limites.

import Anthropic from "npm:@anthropic-ai/sdk";
import { db } from "../_shared/tradelocker.ts";

const MODELE = "claude-sonnet-5-5";
const LIMITE_PAR_PERSONNE = 5;
const LIMITE_TOTALE = 10;
const FUSEAU = "America/Toronto";
// Prix en $ US par million de tokens (entrée, sortie) — coût enregistré pour chaque analyse.
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

// ------------------------------------------------------------------ Réponse attendue (JSON)

const texte = { type: "string" };
const effetOr = { type: "string", enum: ["haussier pour l'or", "baissier pour l'or", "neutre"] };
const scenario = {
  type: "object", additionalProperties: false,
  required: ["conditions", "entree", "stop", "objectifs"],
  properties: { conditions: texte, entree: texte, stop: texte, objectifs: texte },
};
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["lisible", "instrument", "unite_de_temps", "prix_actuel", "biais", "resume", "tendance", "contexte", "annonces",
    "zones", "scenario_achat", "scenario_vente", "invalidation", "prudence"],
  properties: {
    lisible: { type: "boolean" },
    instrument: texte,
    unite_de_temps: texte,
    prix_actuel: { type: "number" },
    biais: {
      type: "object", additionalProperties: false, required: ["direction", "confiance", "raison"],
      properties: {
        direction: { type: "string", enum: ["achat", "vente", "attendre"] },
        confiance: { type: "string", enum: ["faible", "moyenne", "élevée"] },
        raison: texte,
      },
    },
    resume: texte,
    tendance: {
      type: "object", additionalProperties: false, required: ["direction", "explication"],
      properties: { direction: { type: "string", enum: ["haussière", "baissière", "neutre"] }, explication: texte },
    },
    contexte: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["facteur", "effet", "detail"],
        properties: { facteur: texte, effet: effetOr, detail: texte },
      },
    },
    annonces: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["quand", "titre", "conseil"],
        properties: { quand: texte, titre: texte, conseil: texte },
      },
    },
    zones: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["type", "prix", "prix_num", "commentaire"],
        properties: {
          type: { type: "string", enum: ["résistance", "support", "zone d'offre", "zone de demande", "autre"] },
          prix: texte, prix_num: { type: "number" }, commentaire: texte,
        },
      },
    },
    scenario_achat: scenario,
    scenario_vente: scenario,
    invalidation: texte,
    prudence: texte,
  },
};

const CONSIGNES = `Tu es un analyste expérimenté qui aide un trader particulier (surtout l'or, XAUUSD) à décider quoi faire MAINTENANT.
On t'envoie une capture d'écran de son graphique ET le contexte de marché du moment (prix corrélés à l'or, annonces économiques, actualités, tendance sur plusieurs unités de temps). Combine TOUT : ne te limite jamais à la capture.
Réponds en français simple, sans jargon inutile, et SOIS BREF : une phrase courte par champ (20 mots maximum), sauf "resume" (2 phrases). Pas plus de 5 éléments de contexte, 4 annonces et 6 zones.
- Lis les prix sur l'axe de droite de la capture : ne donne que des niveaux que tu vois réellement ; s'ils sont illisibles, dis-le. "prix_num" = valeur centrale du niveau (nombre), "prix_actuel" = dernier prix visible (0 si illisible).
- Tendance : celle de la capture, confrontée aux tendances multi-unités de temps du contexte (dis s'il y a accord ou désaccord).
- Contexte : un élément par facteur utile (dollar, taux 10 ans, argent, tendance de fond, actualité importante…), avec son effet sur l'or selon le mouvement du jour et la corrélation mesurée.
- Annonces : UNIQUEMENT celles d'aujourd'hui (liste du contexte) qui comptent pour l'or (surtout USD à fort impact), heure de Toronto et quoi faire (ex. ne pas entrer dans les 30 min avant, attendre la publication). Jamais d'annonce d'un autre jour ; liste vide s'il n'y en a pas.
- Biais final : "achat", "vente" ou "attendre", avec une confiance. Choisis "attendre" si les signaux se contredisent ou si une annonce USD à fort impact tombe dans l'heure.
- Un scénario d'achat ET un scénario de vente : conditions, entrée, stop, objectifs. Invalidation : ce qui rendrait l'analyse fausse.
- "resume" : 2 phrases qui disent quoi faire. "prudence" : une phrase (pas un conseil financier).
Si l'image n'est pas un graphique de prix lisible, mets "lisible" à false et explique pourquoi dans "resume" (les autres champs peuvent rester vides).`;

// ------------------------------------------------------------------ Outils

function jourToronto(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const quandToronto = (ms: number) => new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(ms));
const r2 = (x: number) => Math.round(x * 100) / 100;

async function compter(compteId: string) {
  const debut = new Date(Date.now() - 36 * 3600000).toISOString(); // assez large, puis filtre sur la journée de Toronto
  const { data } = await db.from("analyses_graphique").select("compte_id, cree_le, statut").gte("cree_le", debut).neq("statut", "erreur");
  const aujourdhui = jourToronto();
  const duJour = (data || []).filter((x) => jourToronto(new Date(x.cree_le as string)) === aujourdhui);
  return { moi: duJour.filter((x) => x.compte_id === compteId).length, total: duJour.length };
}

// Même calcul que js/noyau.js › calculerTendance (EMA 20, ATR 14, bougies clôturées).
type Bougie = { haut: number; bas: number; cloture: number };
function tendance(b: Bougie[]) {
  if (b.length < 30) return null;
  const c = b.map((x) => x.cloture);
  const k = 2 / 21;
  const e: number[] = [];
  c.forEach((v, i) => e.push(i === 0 ? v : v * k + e[i - 1] * (1 - k)));
  const tr = b.slice(1).map((x, i) => Math.max(x.haut - x.bas, Math.abs(x.haut - b[i].cloture), Math.abs(x.bas - b[i].cloture)));
  const atr = tr.slice(-14).reduce((s, x) => s + x, 0) / Math.min(14, tr.length);
  const n = b.length - 1;
  const sg = (x: number, seuil: number) => (x > seuil ? 1 : x < -seuil ? -1 : 0);
  const score = sg(c[n] - e[n], 0.25 * atr) + sg(e[n] - e[n - 5], 0.1 * atr) + sg(c[n] - c[n - 10], 0.5 * atr);
  return {
    etat: score >= 2 ? "haussier" : score <= -2 ? "baissier" : "neutre", ema20: r2(e[n]), atr14: r2(atr),
    plusHaut10: r2(Math.max(...b.slice(-10).map((x) => x.haut))), plusBas10: r2(Math.min(...b.slice(-10).map((x) => x.bas))),
  };
}

// Tendance calculée ici (bougies 1 h et 4 h de Twelve Data) quand l'app n'en a pas envoyé.
async function tendancesServeur() {
  const { data } = await db.from("config_cotations").select("cle_twelvedata").eq("id", 1).maybeSingle();
  const cle = data?.cle_twelvedata as string | undefined;
  if (!cle) return {};
  const sortie: Record<string, unknown> = {};
  for (const tf of ["1h", "4h"]) {
    try {
      const r = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${tf}&outputsize=80&apikey=${encodeURIComponent(cle)}`);
      const j = await r.json();
      // deno-lint-ignore no-explicit-any
      const liste = ((j.values || []) as any[]).reverse().map((v) => ({ haut: Number(v.high), bas: Number(v.low), cloture: Number(v.close) }));
      const t = tendance(liste.slice(0, -1)); // la dernière bougie est encore en cours
      if (t) sortie[tf] = t;
    } catch (e) { console.error("bougies", tf, String(e)); }
  }
  return sortie;
}

// Contexte de marché (données publiées par le PC toutes les 15 min + tendances).
// deno-lint-ignore no-explicit-any
async function contexteMarche(tendancesApp: any) {
  const { data } = await db.from("donnees_publiees").select("nom, contenu, publie_le").in("nom", ["marche", "calendrier", "actualites"]);
  // deno-lint-ignore no-explicit-any
  const par: Record<string, any> = Object.fromEntries((data || []).map((d) => [d.nom, d.contenu]));
  const lignes: string[] = [`Maintenant : ${quandToronto(Date.now())} (heure de Toronto).`];
  const resumeApp: Record<string, unknown> = {};

  // 1. Prix corrélés (page Marché)
  const m = par.marche;
  if (m?.actifs) {
    const coef = m.correlations_observees?.valeurs || {};
    lignes.push("", "PRIX (page Marché) :");
    // deno-lint-ignore no-explicit-any
    for (const a of m.actifs as any[]) {
      const c = coef[a.cle]?.coefficient;
      lignes.push(`- ${a.nom} : ${a.prix} (${a.variation_pct >= 0 ? "+" : ""}${a.variation_pct} % aujourd'hui)${a.correlation ? ` · corrélation avec l'or : ${a.correlation}${c !== undefined ? ` (coefficient ${c} sur ${coef[a.cle].seances} séances)` : ""}` : ""}${a.differe ? " · cours différé" : ""}`);
    }
    resumeApp.prix = (m.actifs as { nom: string; prix: number; variation_pct: number }[]).map((a) => ({ nom: a.nom, prix: a.prix, variation_pct: a.variation_pct }));
  }

  // 2. Tendance multi-unités de temps
  const tend = tendancesApp && Object.keys(tendancesApp).length ? tendancesApp : await tendancesServeur();
  if (Object.keys(tend).length) {
    lignes.push("", "TENDANCE DE L'OR (EMA 20 / ATR 14, bougies clôturées) :");
    // deno-lint-ignore no-explicit-any
    for (const [tf, t] of Object.entries(tend) as [string, any][]) {
      if (!t?.etat || t.etat === "insuffisant") continue;
      lignes.push(`- ${tf} : ${t.etat} (EMA20 ${r2(Number(t.ema20))}, ATR ${r2(Number(t.atr14))}, plus haut / bas des 10 dernières bougies : ${r2(Number(t.plusHaut10))} / ${r2(Number(t.plusBas10))})`);
    }
    // deno-lint-ignore no-explicit-any
    resumeApp.tendances = Object.fromEntries(Object.entries(tend).map(([tf, t]: [string, any]) => [tf, t?.etat]));
  }

  // 3. Annonces du jour seulement (journée de Toronto) : USD, ou fort impact
  const cal = par.calendrier?.evenements || [];
  const maintenant = Date.now();
  // deno-lint-ignore no-explicit-any
  const annonces = (cal as any[])
    .filter((e) => e.horodatage_utc && (e.impact === "high" || (e.impact === "medium" && e.devise === "USD")))
    .map((e) => ({ e, ms: Date.parse(e.horodatage_utc) }))
    .filter(({ ms }) => jourToronto(new Date(ms)) === jourToronto())
    .sort((a, b) => a.ms - b.ms).slice(0, 15);
  lignes.push("", "ANNONCES ÉCONOMIQUES D'AUJOURD'HUI :");
  if (!annonces.length) lignes.push("- aucune annonce importante aujourd'hui");
  for (const { e, ms } of annonces) {
    const v = e.valeurs?.[0] || {};
    const reste = ms > maintenant ? `dans ${Math.round((ms - maintenant) / 60000)} min` : "déjà publiée";
    lignes.push(`- ${quandToronto(ms)} (${reste}) · ${e.devise} · impact ${e.impact === "high" ? "FORT" : "moyen"} · ${e.titre}` +
      `${v.prevision ? ` · prévision ${v.prevision}` : ""}${v.precedent ? ` · précédent ${v.precedent}` : ""}${v.resultat ? ` · RÉSULTAT ${v.resultat}` : ""}`);
  }

  // 4. Actualités importantes des dernières 24 h (concernant l'or)
  const act = par.actualites?.evenements || [];
  const rang: Record<string, number> = { haute: 0, moyenne: 1, faible: 2 };
  // deno-lint-ignore no-explicit-any
  const news = (act as any[])
    .filter((n) => (n.actifs || []).includes("XAUUSD") && n.importance !== "faible" && Date.parse(n.publie_le) > maintenant - 24 * 3600000)
    .sort((a, b) => (rang[a.importance] ?? 3) - (rang[b.importance] ?? 3) || Date.parse(b.publie_le) - Date.parse(a.publie_le))
    .slice(0, 6);
  if (news.length) {
    lignes.push("", "ACTUALITÉS IMPORTANTES (24 h) :");
    for (const n of news) {
      lignes.push(`- [${n.importance}${n.statut ? `, ${n.statut}` : ""}] ${n.titre_fr}${n.interpretation?.direction_or ? ` → ${n.interpretation.direction_or} pour l'or` : ""}${n.interpretation?.texte ? ` : ${n.interpretation.texte}` : ""}`);
    }
  }
  return { texte: lignes.join("\n"), resume: resumeApp };
}

// ------------------------------------------------------------------ Point d'entrée

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
        : `Les analyses du jour sont toutes utilisées. Reviens demain.` }, 429);
    }

    const contexte = await contexteMarche(corps.tendances && typeof corps.tendances === "object" ? corps.tendances : null);

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
          { type: "text", text: `CONTEXTE DE MARCHÉ :\n${contexte.texte}\n\n${question ? `Ma question : ${question}` : "Analyse ce graphique en tenant compte de tout ce contexte."}` },
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
    // deno-lint-ignore no-explicit-any
    let analyse: any;
    try { analyse = JSON.parse(brut); } catch { analyse = { lisible: true, resume: brut, zones: [] }; }
    analyse.marche = contexte.resume; // prix et tendances utilisés, affichés avec l'analyse

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
