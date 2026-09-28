// Gold AI — lecture des comptes TradeLocker de l'utilisateur (Journal › Mes comptes TradeLocker).
//
// Appelée par le site avec le jeton de session de l'app. Actions :
//  - "ajouter"   : vérifie email / mot de passe / serveur auprès de TradeLocker,
//                  puis les enregistre (mot de passe CHIFFRÉ, AES-GCM, clé
//                  TL_CLE_CHIFFREMENT gardée dans les secrets de la fonction).
//  - "lister"    : importe d'abord les trades fermés dans le Journal
//                  (_shared/import-tradelocker.ts), puis pour chaque connexion
//                  tous les comptes TradeLocker (solde, équité, résultat du jour,
//                  trades ouverts avec leur P&L).
//  - "supprimer" : oublie une connexion (et son mot de passe chiffré).
// LECTURE SEULE : aucune route d'ordre n'est appelée ici.
// Routes TradeLocker : les mêmes que la bibliothèque officielle « tradelocker » (Python).

import { chiffrer, colonnes, comptesDuLogin, type Connexion, db, ErreurUtilisateur, expiration, enObjet, instruments, nb, seConnecter, tl } from "../_shared/tradelocker.ts";
import { importerTout } from "../_shared/import-tradelocker.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const repondre = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function symboles(env: string, jeton: string, compteId: number, accNum: number) {
  return new Map([...(await instruments(env, jeton, compteId, accNum))].map(([k, v]) => [k, v.name]));
}

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
  const resume = { id: c.id, email: c.email, serveur: c.serveur, environnement: c.environnement, derniere_synchro: c.derniere_synchro ?? null };
  try {
    const { jeton, comptes } = await comptesDuLogin(c);
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

    // Import des trades fermés depuis le dernier passage (l'import automatique tourne aussi toutes les 5 min).
    if (corps.action === "lister" && corps.importer !== false) {
      try { await importerTout(compteId); } catch (e) { console.error("import", String(e)); }
    }
    const { data, error } = await db.from("comptes_tradelocker").select("*").eq("compte_id", compteId).order("cree_le");
    if (error) throw error;
    const connexions = await Promise.all(((data || []) as Connexion[]).map(lireConnexion));
    const { count: importes24h } = await db.from("trades_importes_tl").select("cle", { count: "exact", head: true })
      .eq("compte_id", compteId).gte("cree_le", new Date(Date.now() - 86400000).toISOString());
    return repondre({ connexions, importes24h: importes24h || 0, lu_le: new Date().toISOString() });
  } catch (e) {
    if (e instanceof ErreurUtilisateur) return repondre({ erreur: e.message }, 400);
    console.error(e);
    const absente = /comptes_tradelocker/.test(String((e as { message?: string }).message || ""));
    return repondre({ erreur: absente ? "PATCH_ABSENT" : "Erreur du serveur. Réessaie dans un moment." }, 500);
  }
});
