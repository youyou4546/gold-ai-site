// Gold AI — import automatique des trades TradeLocker FERMÉS dans le Journal.
//
// Pour chaque connexion (Profil › Mes comptes TradeLocker) et chacun de ses comptes :
//  1. historique des ordres (/ordersHistory) + positions encore ouvertes (/positions) ;
//  2. une position absente des positions ouvertes, fermée après l'ajout de la
//     connexion (import_depuis), devient UN trade du Journal : date de fermeture
//     (fuseau de l'utilisateur), entrée / sortie moyennes, lots, profit ;
//  3. trades_importes_tl retient ce qui a été importé (jamais deux fois ; un trade
//     supprimé du Journal ne revient pas).
// Profit CALCULÉ : (sortie − entrée) × lots × taille du lot, dans la devise du prix.
// TradeLocker ne donne pas le profit réel par trade : commissions et swap ne sont
// pas inclus (écart possible de quelques $ avec le relevé du courtier).
// Appelé par « verifications » (toutes les 5 min) et par « tradelocker » (ouverture de la page).

import { colonnes, comptesDuLogin, type Connexion, db, detailsInstrument, enObjet, instruments, nb, tl } from "./tradelocker.ts";

const FENETRE_OUVERTURE_MS = 7 * 86400000; // une position ouverte jusqu'à 7 jours avant peut être retrouvée
const MARGE_SYNCHRO_MS = 2 * 3600000;

type Ordre = { positionId: string; side: string; qty: number; prix: number; temps: number; instrumentId: number };

async function fuseauUtilisateur(compteId: string) {
  const { data } = await db.from("parametres_trading").select("parametres_calculateur").eq("compte_id", compteId).maybeSingle();
  return (data?.parametres_calculateur as { fuseau?: string } | null)?.fuseau || "America/Toronto";
}

const jourDans = (ms: number, fuseau: string) => new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const moyenne = (liste: Ordre[]) => {
  const q = liste.reduce((s, o) => s + o.qty, 0);
  return q > 0 ? liste.reduce((s, o) => s + o.prix * o.qty, 0) / q : 0;
};
const arrondi = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

async function importerCompte(c: Connexion, jeton: string, a: Record<string, unknown>, fuseau: string) {
  const env = c.environnement, id = Number(a.id), accNum = Number(a.accNum);
  const devise = String(a.currency || "USD");
  const depuis = Date.parse(c.import_depuis || new Date().toISOString());
  const derniere = c.derniere_synchro ? Date.parse(c.derniere_synchro) - MARGE_SYNCHRO_MS : depuis;
  const debut = Math.min(depuis, derniere) - FENETRE_OUVERTURE_MS;

  const cols = await colonnes(env, jeton, accNum);
  const histo = await tl(env, `/trade/accounts/${id}/ordersHistory`, jeton, { accNum, params: { from: debut, to: Date.now() } });
  const posJson = await tl(env, `/trade/accounts/${id}/positions`, jeton, { accNum });
  const colsPos = cols.positionsConfig || [];
  const ouvertes = new Set((((posJson.d as Record<string, unknown>)?.positions as unknown[][]) || []).map((v) => String(enObjet(colsPos, v).id)));

  // Ordres exécutés, regroupés par position.
  const parPosition = new Map<string, Ordre[]>();
  for (const v of ((histo.d as Record<string, unknown>)?.ordersHistory as unknown[][]) || []) {
    const o = enObjet(cols.ordersHistoryConfig || [], v);
    const qty = nb(o.filledQty) || nb(o.qty) || 0, prix = nb(o.avgPrice) || 0;
    if (String(o.status).toLowerCase() !== "filled" || !o.positionId || !(qty > 0) || !(prix > 0)) continue;
    const ordre = { positionId: String(o.positionId), side: String(o.side).toLowerCase(), qty, prix, temps: nb(o.lastModified) || nb(o.createdDate) || 0, instrumentId: Number(o.tradableInstrumentId) };
    parPosition.set(ordre.positionId, [...(parPosition.get(ordre.positionId) || []), ordre]);
  }

  const candidats = [];
  for (const [positionId, ordres] of parPosition) {
    if (ouvertes.has(positionId)) continue;
    ordres.sort((x, y) => x.temps - y.temps);
    const sens = ordres[0].side; // le premier ordre ouvre la position
    const entrees = ordres.filter((o) => o.side === sens), sorties = ordres.filter((o) => o.side !== sens);
    if (!sorties.length) continue;
    const lots = entrees.reduce((s, o) => s + o.qty, 0), fermes = sorties.reduce((s, o) => s + o.qty, 0);
    if (fermes + 1e-9 < lots) continue; // données incomplètes : on réessaiera au prochain passage
    const fermeLe = Math.max(...sorties.map((o) => o.temps));
    if (fermeLe < depuis) continue; // fermée avant la connexion : pas importée
    candidats.push({ positionId, sens, entrees, sorties, lots, fermeLe, instrumentId: ordres[0].instrumentId });
  }
  if (!candidats.length) return 0;

  const cles = candidats.map((p) => `${env}|${id}|${p.positionId}`);
  const { data: deja } = await db.from("trades_importes_tl").select("cle").in("cle", cles);
  const connues = new Set((deja || []).map((d) => d.cle));
  const noms = await instruments(env, jeton, id, accNum);

  let importes = 0;
  for (const p of candidats) {
    const cle = `${env}|${id}|${p.positionId}`;
    if (connues.has(cle)) continue;
    const det = await detailsInstrument(env, jeton, id, accNum, p.instrumentId);
    if (!(det.lotSize > 0)) { console.error("taille de lot inconnue", p.instrumentId); continue; }
    const entree = moyenne(p.entrees), sortie = moyenne(p.sorties);
    const direction = p.sens === "buy" ? 1 : -1;
    const resultat = arrondi(p.sorties.reduce((s, o) => s + (o.prix - entree) * o.qty * det.lotSize * direction, 0));
    // Réservé AVANT de créer le trade : deux passages simultanés ne peuvent pas l'importer deux fois.
    const { error: dejaPris } = await db.from("trades_importes_tl").insert({ cle, compte_id: c.compte_id, connexion_id: c.id, resultat, ferme_le: new Date(p.fermeLe).toISOString() });
    if (dejaPris) continue;
    const symbole = noms.get(p.instrumentId)?.name || String(p.instrumentId);
    const autreDevise = det.devise && det.devise !== devise ? ` · profit en ${det.devise}, non converti` : "";
    const { data: trade, error } = await db.from("trades").insert({
      compte_id: c.compte_id, date_trade: jourDans(p.fermeLe, fuseau), resultat, instrument: symbole,
      compte_tl: `${env}|${id}`, compte_tl_nom: `${String(a.name || "Compte")} #${accNum}`,
      prix_entree: arrondi(entree, 5), prix_sortie: arrondi(sortie, 5),
      note: `Importé de TradeLocker · ${String(a.name || "Compte")} #${accNum} · ${p.sens === "buy" ? "Achat" : "Vente"} ${arrondi(p.lots)} lot · profit calculé (sans commissions ni swap)${autreDevise}`,
    }).select("id").single();
    if (error) { await db.from("trades_importes_tl").delete().eq("cle", cle); throw error; }
    await db.from("trades_importes_tl").update({ trade_id: trade.id }).eq("cle", cle);
    importes++;
  }
  return importes;
}

export async function importerConnexion(c: Connexion) {
  const { jeton, comptes } = await comptesDuLogin(c);
  const fuseau = await fuseauUtilisateur(c.compte_id);
  let total = 0;
  for (const a of comptes) {
    try { total += await importerCompte(c, jeton, a, fuseau); } catch (e) { console.error("import compte", a.accNum, String(e)); }
  }
  await db.from("comptes_tradelocker").update({ derniere_synchro: new Date().toISOString() }).eq("id", c.id);
  return total;
}

export async function importerTout(compteId?: string) {
  let requete = db.from("comptes_tradelocker").select("*");
  if (compteId) requete = requete.eq("compte_id", compteId);
  const { data, error } = await requete;
  if (error) throw error;
  let total = 0;
  for (const c of (data || []) as Connexion[]) {
    try { total += await importerConnexion(c); } catch (e) { console.error("import connexion", c.id, String(e)); }
  }
  return total;
}
