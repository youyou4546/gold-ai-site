// Gold AI — Analyse › Pose ta question (assistant trading GRATUIT).
//
// Le téléphone envoie la conversation (les derniers messages) ; cette fonction :
//  1. vérifie la session (table sessions, comme analyse-graphique) ;
//  2. demande la réponse à Google Gemini avec la clé GEMINI_API_KEY gardée dans
//     les secrets Supabase (offre gratuite de Google AI Studio : pas de carte,
//     Google bloque simplement au-delà de son quota gratuit, sans rien facturer) ;
//  3. renvoie le texte de la réponse. Rien n'est enregistré en base : la
//     conversation reste sur le téléphone (js/assistant-ia.js).
// Déploiement + clé : scripts/deployer_assistant_ia.bat.

import { db } from "../_shared/tradelocker.ts";

// Modèles essayés dans l'ordre : si Google en retire un (404), on passe au suivant.
const MODELES = [
  Deno.env.get("GEMINI_MODELE"),
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
].filter(Boolean) as string[];
const MAX_MESSAGES = 12;
const MAX_CARACTERES = 1500;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const repondre = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const CONSIGNES = `Tu es l'assistant de "Trading Tool", une appli de trading de l'or (XAUUSD) utilisée par un trader débutant qui passe des challenges de prop firm (TopOne, FundedNext).
Réponds en français simple, comme à quelqu'un qui n'est pas expert : phrases courtes, exemples concrets avec l'or quand c'est utile (1 pip = 0,10 $ sur XAUUSD, 1 lot = 100 onces).
Sujets : bases du trading, vocabulaire (lot, pip, spread, levier, marge, stop loss, take profit, drawdown), gestion du risque, psychologie, analyse technique et fondamentale, annonces économiques, règles habituelles des prop firms.
Format : réponse courte (10 lignes maximum sauf si on te demande plus), listes avec "- " si besoin, **gras** pour les mots importants, pas de titres ni de tableaux.
Tu n'as PAS accès aux prix en direct ni aux graphiques : si on te demande le prix actuel ou s'il faut acheter/vendre maintenant, dis-le et renvoie vers l'onglet Marché ou vers "Analyse de graphique par l'IA".
Ne promets jamais de gains ; rappelle le risque quand c'est pertinent, sans faire la morale à chaque message.`;

type Message = { role: "user" | "assistant"; texte: string };

async function demanderGemini(cle: string, messages: Message[]) {
  const corps = JSON.stringify({
    systemInstruction: { parts: [{ text: CONSIGNES }] },
    contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.texte }] })),
    generationConfig: { temperature: 0.5, maxOutputTokens: 4096 },
  });
  let derniere = { status: 0, detail: "" };
  for (const modele of MODELES) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
      body: corps,
    });
    if (r.ok) {
      const data = await r.json();
      const texte = (data.candidates?.[0]?.content?.parts || [])
        .filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought)
        .map((p: { text: string }) => p.text).join("").trim();
      return { texte, modele };
    }
    derniere = { status: r.status, detail: (await r.text()).slice(0, 300) };
    if (r.status !== 404) break; // 404 = modèle inconnu → on essaie le suivant ; le reste est une vraie erreur
  }
  throw Object.assign(new Error(`Gemini ${derniere.status} ${derniere.detail}`), { status: derniere.status });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const corps = await req.json().catch(() => ({}));
    const token = String(corps.token || "");
    if (!/^[0-9a-f-]{36}$/i.test(token)) return repondre({ erreur: "SESSION_INVALIDE" }, 401);
    const { data: session } = await db.from("sessions").select("compte_id").eq("token", token).maybeSingle();
    if (!session) return repondre({ erreur: "SESSION_INVALIDE" }, 401);

    const messages: Message[] = (Array.isArray(corps.messages) ? corps.messages : [])
      .filter((m: Message) => m && (m.role === "user" || m.role === "assistant") && String(m.texte || "").trim())
      .slice(-MAX_MESSAGES)
      .map((m: Message) => ({ role: m.role, texte: String(m.texte).trim().slice(0, MAX_CARACTERES) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") return repondre({ erreur: "Écris d'abord ta question." }, 400);

    const cle = Deno.env.get("GEMINI_API_KEY");
    if (!cle) return repondre({ erreur: "L'assistant n'est pas encore configuré (clé gratuite manquante)." }, 503);

    const { texte, modele } = await demanderGemini(cle, messages);
    if (!texte) return repondre({ erreur: "L'assistant n'a pas su répondre. Reformule ta question." }, 422);
    return repondre({ ok: true, reponse: texte, modele });
  } catch (e) {
    console.error("assistant-trading", e);
    const status = (e as { status?: number })?.status;
    return repondre({ erreur: status === 429
      ? "Limite gratuite atteinte pour le moment. Réessaie dans une minute."
      : status === 400 || status === 403
      ? "La clé gratuite de l'assistant est refusée : elle doit être vérifiée."
      : "L'assistant ne répond pas. Réessaie dans un moment." }, 500);
  }
});
