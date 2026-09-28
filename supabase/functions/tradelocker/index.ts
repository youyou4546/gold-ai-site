// Gold AI — lecture des comptes TradeLocker de l'utilisateur (Journal › Mes comptes TradeLocker).
//
// Appelée par le site avec le jeton de session de l'app. Actions :
//  - "ajouter"   : vérifie email / mot de passe / serveur auprès de TradeLocker,
//                  puis les enregistre (mot de passe CHIFFRÉ, AES-GCM, clé
//                  TL_CLE_CHIFFREMENT gardée dans les secrets de la fonction).
//  - "lister"    : pour chaque connexion enregistrée, tous les comptes TradeLocker
//                  (solde, équité, résultat du jour, trades ouverts avec leur P&L).
//  - "supprimer" : oublie une connexion (et son mot de passe chiffré).
// LECTURE SEULE : aucune route d'ordre n'est appelée ici.
// Routes TradeLocker : les mêmes que la bibliothèque officielle « tradelocker » (Python).

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const repondre = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class ErreurUtilisateur extends Error {}

// ------------------------------------------------------------------ Chiffrement

let cle: CryptoKey | null = null;
async function cleChiffrement() {
  if (!cle) {
    const brute = Uint8Array.from(atob(Deno.env.get("TL_CLE_CHIFFREMENT")!), (c) => c.charCodeAt(0));
    cle = await crypto.subtle.importKey("raw", brute, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  return cle;
}
const b64 = (o: Uint8Array) => btoa(String.fromCharCode(...o));
const deB64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

async function chiffrer(texte: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cleChiffrement(), new TextEncoder().encode(texte)));
  return `${b64(iv)}:${b64(chiffre)}`;
}
async function dechiffrer(valeur: string) {
  const [iv, chiffre] = valeur.split(":");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(iv) }, await cleChiffrement(), deB64(chiffre)));
}

// ------------------------------------------------------------------ TradeLocker

type Connexion = { id: string; compte_id: string; environnement: "demo" | "live"; email: string; serveur: string; mot_de_passe_chiffre: string; jeton_acces: string | null; jeton_expire_le: string | null };

const base = (env: string) => `https://${env === "live" ? "live" : "demo"}.tradelocker.com/backend-api`;

async function tl(env: string, chemin: string, jeton: string | null, { methode = "GET", corps, accNum }: { methode?: string; corps?: unknown; accNum?: number } = {}) {
  const entetes: Record<string, string> = { "Content-Type": "application/json" };
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  if (accNum !== undefined) entetes.accNum = String(accNum);
  const r = await fetch(base(env) + chemin, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined, signal: AbortSignal.timeout(15000) });
  const texte = await r.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(texte); } catch { /* réponse non JSON */ }
  if (!r.ok) {
    const e = new Error(`TradeLocker ${r.status} ${chemin} ${texte.slice(0, 200)}`) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return json;
}

function expiration(jeton: string) {
  try { return new Date(JSON.parse(atob(jeton.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000); } catch { return new Date(Date.now() + 10 * 60000); }
}

async function seConnecter(env: string, email: string, motDePasse: string, serveur: string) {
  try {
    const r = await tl(env, "/auth/jwt/token", null, { methode: "POST", corps: { email, password: motDePasse, server: serveur } });
    if (!r.accessToken) throw new Error("pas de jeton");
    return String(r.accessToken);
  } catch (e) {
    const s = (e as { status?: number }).status;
    if (s && s >= 400 && s < 500) throw new ErreurUtilisateur("TradeLocker refuse ces identifiants : vérifie l'email, le mot de passe, le serveur et Démo / Réel.");
    throw e;
  }
}

// Jeton d'accès gardé (chiffré) tant qu'il est valide : évite une connexion à chaque rafraîchissement.
async function jetonValide(c: Connexion, forcer = false) {
  if (!forcer && c.jeton_acces && c.jeton_expire_le && Date.parse(c.jeton_expire_le) - Date.now() > 60000) {
    return await dechiffrer(c.jeton_acces);
  }
  const jeton = await seConnecter(c.environnement, c.email, await dechiffrer(c.mot_de_passe_chiffre), c.serveur);
  c.jeton_acces = await chiffrer(jeton);
  c.jeton_expire_le = expiration(jeton).toISOString();
  await db.from("comptes_tradelocker").update({ jeton_acces: c.jeton_acces, jeton_expire_le: c.jeton_expire_le }).eq("id", c.id);
  return jeton;
}

// Noms des colonnes (TradeLocker renvoie des tableaux de valeurs, dans l'ordre de /trade/config).
const colonnesCache = new Map<string, Record<string, string[]>>();
async function colonnes(env: string, jeton: string, accNum: number) {
  const k = `${env}|${accNum}`;
  if (!colonnesCache.has(k)) {
    const d = (await tl(env, "/trade/config", jeton, { accNum })).d as Record<string, { columns?: { id: string }[] }>;
    const res: Record<string, string[]> = {};
    for (const [nom, v] of Object.entries(d || {})) if (v?.columns) res[nom] = v.columns.map((c) => c.id);
    colonnesCache.set(k, res);
  }
  return colonnesCache.get(k)!;
}
const enObjet = (noms: string[], valeurs: unknown[]) => Object.fromEntries(noms.map((n, i) => [n, valeurs[i]]));

const symbolesCache = new Map<string, Map<number, string>>();
async function symboles(env: string, jeton: string, compteId: number, accNum: number) {
  const k = `${env}|${compteId}`;
  if (!symbolesCache.has(k)) {
    const liste = ((await tl(env, `/trade/accounts/${compteId}/instruments`, jeton, { accNum })).d as { instruments?: { tradableInstrumentId: number; name: string }[] })?.instruments || [];
    symbolesCache.set(k, new Map(liste.map((i) => [Number(i.tradableInstrumentId), i.name])));
  }
  return symbolesCache.get(k)!;
}

const nb = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

async function detailsCompte(env: string, jeton: string, a: Record<string, unknown>) {
  const id = Number(a.id), accNum = Number(a.accNum);
  const base = { id, accNum, nom: String(a.name ?? ""), devise: String(a.currency ?? "USD"), statut: String(a.status ?? ""), solde: nb(a.accountBalance) };
  try {
    const cols = await colonnes(env, jeton, accNum);
    const [etatJson, posJson] = await Promise.all([
      tl(env, `/trade/accounts/${id}/state`, jeton, { accNum }),
      tl(env, `/trade/accounts/${id}/positions`, jeton, { accNum }),
    ]);
    const etat = enObjet(cols.accountDetailsConfig || [], ((etatJson.d as Record<string, unknown>)?.accountDetailsData as unknown[]) || []);
    const brutes = ((posJson.d as Record<string, unknown>)?.positions as unknown[][]) || [];
    const noms = brutes.length ? await symboles(env, jeton, id, accNum) : new Map();
    const positions = brutes.map((v) => enObjet(cols.positionsConfig || [], v)).map((p) => ({
      id: String(p.id), symbole: noms.get(Number(p.tradableInstrumentId)) || String(p.tradableInstrumentId),
      sens: String(p.side), lots: nb(p.qty), prixEntree: nb(p.avgPrice), pnl: nb(p.unrealizedPl), ouvertLe: nb(p.openDate),
    }));
    return {
      ...base,
      solde: nb(etat.balance) ?? base.solde,
      equite: nb(etat.projectedBalance),
      jourNet: nb(etat.todayNet), jourBrut: nb(etat.todayGross), jourFrais: nb(etat.todayFees), jourTrades: nb(etat.todayTradesCount),
      ouvertNet: nb(etat.openNetPnL),
      positions,
    };
  } catch (e) {
    console.error("compte", accNum, String(e));
    return { ...base, erreur: "Détails indisponibles pour ce compte pour l'instant." };
  }
}

async function lireConnexion(c: Connexion) {
  const resume = { id: c.id, email: c.email, serveur: c.serveur, environnement: c.environnement };
  try {
    let jeton = await jetonValide(c);
    let comptes: Record<string, unknown>[];
    try {
      comptes = ((await tl(c.environnement, "/auth/jwt/all-accounts", jeton)).accounts as Record<string, unknown>[]) || [];
    } catch (e) {
      if ((e as { status?: number }).status !== 401) throw e;
      jeton = await jetonValide(c, true); // jeton révoqué : nouvelle connexion
      comptes = ((await tl(c.environnement, "/auth/jwt/all-accounts", jeton)).accounts as Record<string, unknown>[]) || [];
    }
    return { ...resume, comptes: await Promise.all(comptes.map((a) => detailsCompte(c.environnement, jeton, a))) };
  } catch (e) {
    console.error("connexion", c.id, String(e));
    return { ...resume, erreur: e instanceof ErreurUtilisateur ? e.message : "TradeLocker ne répond pas pour l'instant. Réessaie dans un moment.", comptes: [] };
  }
}

// ------------------------------------------------------------------ Point d'entrée

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const corps = await req.json().catch(() => ({}));
    const token = String(corps.token || "");
    if (!/^[0-9a-f-]{36}$/i.test(token)) return repondre({ erreur: "SESSION_INVALIDE" }, 401);
    const { data: session } = await db.from("sessions").select("compte_id").eq("token", token).maybeSingle();
    if (!session) return repondre({ erreur: "SESSION_INVALIDE" }, 401);
    const compteId = session.compte_id as string;

    if (corps.action === "ajouter") {
      const env = corps.environnement === "live" ? "live" : "demo";
      const email = String(corps.email || "").trim(), serveur = String(corps.serveur || "").trim(), mdp = String(corps.motDePasse || "");
      if (!email || !serveur || !mdp) throw new ErreurUtilisateur("Remplis l'email, le mot de passe et le serveur.");
      const { count } = await db.from("comptes_tradelocker").select("id", { count: "exact", head: true }).eq("compte_id", compteId);
      if ((count || 0) >= 10) throw new ErreurUtilisateur("Maximum 10 connexions TradeLocker.");
      const jeton = await seConnecter(env, email, mdp, serveur); // vérifie avant d'enregistrer
      const { error } = await db.from("comptes_tradelocker").upsert({
        compte_id: compteId, environnement: env, email, serveur,
        mot_de_passe_chiffre: await chiffrer(mdp), jeton_acces: await chiffrer(jeton), jeton_expire_le: expiration(jeton).toISOString(),
      }, { onConflict: "compte_id,environnement,email,serveur" });
      if (error) throw error;
      return repondre({ ok: true });
    }

    if (corps.action === "supprimer") {
      await db.from("comptes_tradelocker").delete().eq("id", String(corps.id || "")).eq("compte_id", compteId);
      return repondre({ ok: true });
    }

    const { data, error } = await db.from("comptes_tradelocker").select("*").eq("compte_id", compteId).order("cree_le");
    if (error) throw error;
    const connexions = await Promise.all(((data || []) as Connexion[]).map(lireConnexion));
    return repondre({ connexions, lu_le: new Date().toISOString() });
  } catch (e) {
    if (e instanceof ErreurUtilisateur) return repondre({ erreur: e.message }, 400);
    console.error(e);
    const absente = /comptes_tradelocker/.test(String((e as { message?: string }).message || ""));
    return repondre({ erreur: absente ? "PATCH_ABSENT" : "Erreur du serveur. Réessaie dans un moment." }, 500);
  }
});
