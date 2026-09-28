// Gold AI — code TradeLocker partagé entre les fonctions « tradelocker »
// (affichage des comptes) et « verifications » (import automatique des trades).
// Lecture seule : aucune route d'ordre n'est appelée.
// Routes : https://public-api.tradelocker.com (mêmes que la bibliothèque officielle Python).

import { createClient } from "npm:@supabase/supabase-js@2";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

export class ErreurUtilisateur extends Error {}

// ------------------------------------------------------------------ Chiffrement (AES-GCM, clé TL_CLE_CHIFFREMENT)

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

export async function chiffrer(texte: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cleChiffrement(), new TextEncoder().encode(texte)));
  return `${b64(iv)}:${b64(chiffre)}`;
}
export async function dechiffrer(valeur: string) {
  const [iv, chiffre] = valeur.split(":");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(iv) }, await cleChiffrement(), deB64(chiffre)));
}

// ------------------------------------------------------------------ Requêtes

export type Connexion = {
  id: string; compte_id: string; environnement: "demo" | "live"; email: string; serveur: string;
  mot_de_passe_chiffre: string; jeton_acces: string | null; jeton_expire_le: string | null;
  import_depuis?: string; derniere_synchro?: string | null;
};

const base = (env: string) => `https://${env === "live" ? "live" : "demo"}.tradelocker.com/backend-api`;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Requête TradeLocker ; si TradeLocker répond « trop de requêtes » (429), on attend et on réessaie (3 fois max).
export async function tl(env: string, chemin: string, jeton: string | null, options: { methode?: string; corps?: unknown; accNum?: number; params?: Record<string, string | number> } = {}) {
  for (let essai = 0; ; essai++) {
    try { return await tlUneFois(env, chemin, jeton, options); } catch (e) {
      if ((e as { status?: number }).status !== 429 || essai >= 3) throw e;
      await pause(1200 * (essai + 1));
    }
  }
}

async function tlUneFois(env: string, chemin: string, jeton: string | null,
  { methode = "GET", corps, accNum, params }: { methode?: string; corps?: unknown; accNum?: number; params?: Record<string, string | number> } = {}) {
  const entetes: Record<string, string> = { "Content-Type": "application/json" };
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  if (accNum !== undefined) entetes.accNum = String(accNum);
  const qs = params ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : "";
  const r = await fetch(base(env) + chemin + qs, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined, signal: AbortSignal.timeout(15000) });
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

export function expiration(jeton: string) {
  try { return new Date(JSON.parse(atob(jeton.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000); } catch { return new Date(Date.now() + 10 * 60000); }
}

export async function seConnecter(env: string, email: string, motDePasse: string, serveur: string) {
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

// Jeton d'accès gardé (chiffré) tant qu'il est valide : évite une connexion à chaque appel.
export async function jetonValide(c: Connexion, forcer = false) {
  if (!forcer && c.jeton_acces && c.jeton_expire_le && Date.parse(c.jeton_expire_le) - Date.now() > 60000) {
    return await dechiffrer(c.jeton_acces);
  }
  const jeton = await seConnecter(c.environnement, c.email, await dechiffrer(c.mot_de_passe_chiffre), c.serveur);
  c.jeton_acces = await chiffrer(jeton);
  c.jeton_expire_le = expiration(jeton).toISOString();
  await db.from("comptes_tradelocker").update({ jeton_acces: c.jeton_acces, jeton_expire_le: c.jeton_expire_le }).eq("id", c.id);
  return jeton;
}

// Liste des comptes du login, avec une reconnexion si le jeton a été révoqué.
export async function comptesDuLogin(c: Connexion) {
  let jeton = await jetonValide(c);
  try {
    return { jeton, comptes: ((await tl(c.environnement, "/auth/jwt/all-accounts", jeton)).accounts as Record<string, unknown>[]) || [] };
  } catch (e) {
    if ((e as { status?: number }).status !== 401) throw e;
    jeton = await jetonValide(c, true);
    return { jeton, comptes: ((await tl(c.environnement, "/auth/jwt/all-accounts", jeton)).accounts as Record<string, unknown>[]) || [] };
  }
}

// Noms des colonnes (TradeLocker renvoie des tableaux de valeurs, dans l'ordre de /trade/config).
const colonnesCache = new Map<string, Record<string, string[]>>();
export async function colonnes(env: string, jeton: string, accNum: number) {
  const k = `${env}|${accNum}`;
  if (!colonnesCache.has(k)) {
    const d = (await tl(env, "/trade/config", jeton, { accNum })).d as Record<string, { columns?: { id: string }[] }>;
    const res: Record<string, string[]> = {};
    for (const [nom, v] of Object.entries(d || {})) if (v?.columns) res[nom] = v.columns.map((c) => c.id);
    colonnesCache.set(k, res);
  }
  return colonnesCache.get(k)!;
}
export const enObjet = (noms: string[], valeurs: unknown[]) => Object.fromEntries(noms.map((n, i) => [n, valeurs[i]]));

type Instrument = { tradableInstrumentId: number; name: string; routes?: { id: number; type: string }[] };
const instrumentsCache = new Map<string, Map<number, Instrument>>();
export async function instruments(env: string, jeton: string, compteId: number, accNum: number) {
  const k = `${env}|${compteId}`;
  if (!instrumentsCache.has(k)) {
    const liste = ((await tl(env, `/trade/accounts/${compteId}/instruments`, jeton, { accNum })).d as { instruments?: Instrument[] })?.instruments || [];
    instrumentsCache.set(k, new Map(liste.map((i) => [Number(i.tradableInstrumentId), i])));
  }
  return instrumentsCache.get(k)!;
}

// Taille d'un lot (ex. 100 onces pour XAUUSD) et devise du prix, pour calculer un profit.
const detailsCache = new Map<string, { lotSize: number; devise: string }>();
export async function detailsInstrument(env: string, jeton: string, compteId: number, accNum: number, instrumentId: number) {
  const k = `${env}|${instrumentId}`;
  if (!detailsCache.has(k)) {
    const inst = (await instruments(env, jeton, compteId, accNum)).get(instrumentId);
    const route = inst?.routes?.find((r) => r.type === "INFO")?.id;
    const d = (await tl(env, `/trade/instruments/${instrumentId}`, jeton, { accNum, params: { ...(route ? { routeId: route } : {}), locale: "en" } })).d as Record<string, unknown>;
    detailsCache.set(k, { lotSize: Number(d?.lotSize) || 0, devise: String(d?.quotingCurrency || "") });
  }
  return detailsCache.get(k)!;
}

export const nb = (v: unknown) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
