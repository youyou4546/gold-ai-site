// Gold AI — import automatique des trades TradeLocker FERMÉS dans le Journal.
//
// Pour chaque connexion (Profil › Mes comptes TradeLocker) et chacun de ses comptes :
//  1. historique des ordres (/ordersHistory) + positions encore ouvertes (/positions) ;
//  2. les positions d'un même SIGNAL (même instrument, même sens, ouvertes à
//     moins de 2 min d'écart : TP1, TP2, TP3…) deviennent UN trade du Journal
//     une fois toutes fermées : date de fermeture (fuseau de l'utilisateur),
//     entrée / sortie moyennes, lots, profit total (détail par position dans la note) ;
//  3. trades_importes_tl retient ce qui a été importé (jamais deux fois ; un trade
//     supprimé du Journal ne revient pas).
// Profit CALCULÉ : (sortie − entrée) × lots × taille du lot, dans la devise du prix.
// TradeLocker ne donne pas le profit réel par trade : commissions et swap ne sont
// pas inclus (écart possible de quelques $ avec le relevé du courtier).
// Appelé par « verifications » (toutes les ~20 s) et par « tradelocker » (ouverture de la page).

import { colonnes, comptesDuLogin, type Connexion, db, detailsInstrument, enObjet, instruments, nb, tl } from "./tradelocker.ts";

const FENETRE_OUVERTURE_MS = 7 * 86400000; // une position ouverte jusqu'à 7 jours avant peut être retrouvée
const MARGE_SYNCHRO_MS = 2 * 3600000;
const ECART_SIGNAL_MS = 2 * 60000; // positions ouvertes à moins de 2 min d'écart = même signal

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
  // Premier passage (derniere_synchro vide) : tout l'historique depuis import_depuis.
  // Ensuite : seulement les dernières heures (+ 7 jours pour retrouver l'ouverture des positions).
  const debut = (c.derniere_synchro ? Date.parse(c.derniere_synchro) - MARGE_SYNCHRO_MS : depuis) - FENETRE_OUVERTURE_MS;

  const cols = await colonnes(env, jeton, accNum);
  const histo = await tl(env, `/trade/accounts/${id}/ordersHistory`, jeton, { accNum, params: { from: debut, to: Date.now() } });
  const posJson = await tl(env, `/trade/accounts/${id}/positions`, jeton, { accNum });
  const colsPos = cols.positionsConfig || [];
  // Positions encore ouvertes (id, instrument, sens, heure d'ouverture).
  const ouvertes = (((posJson.d as Record<string, unknown>)?.positions as unknown[][]) || []).map((v) => {
    const o = enObjet(colsPos, v);
    return { id: String(o.id), instrumentId: Number(o.tradableInstrumentId), sens: String(o.side).toLowerCase(), ouvertLe: nb(o.openDate) || 0 };
  });
  const idsOuverts = new Set(ouvertes.map((o) => o.id));

  // Ordres exécutés, regroupés par position.
  const parPosition = new Map<string, Ordre[]>();
  for (const v of ((histo.d as Record<string, unknown>)?.ordersHistory as unknown[][]) || []) {
    const o = enObjet(cols.ordersHistoryConfig || [], v);
    const qty = nb(o.filledQty) || nb(o.qty) || 0, prix = nb(o.avgPrice) || 0;
    if (String(o.status).toLowerCase() !== "filled" || !o.positionId || !(qty > 0) || !(prix > 0)) continue;
    const ordre = { positionId: String(o.positionId), side: String(o.side).toLowerCase(), qty, prix, temps: nb(o.lastModified) || nb(o.createdDate) || 0, instrumentId: Number(o.tradableInstrumentId) };
    parPosition.set(ordre.positionId, [...(parPosition.get(ordre.positionId) || []), ordre]);
  }

  // Positions fermées complètes.
  type Position = { positionId: string; sens: string; entrees: Ordre[]; sorties: Ordre[]; lots: number; ouvertLe: number; fermeLe: number; instrumentId: number };
  const fermees: Position[] = [];
  for (const [positionId, ordres] of parPosition) {
    if (idsOuverts.has(positionId)) continue;
    ordres.sort((x, y) => x.temps - y.temps);
    const sens = ordres[0].side; // le premier ordre ouvre la position
    const entrees = ordres.filter((o) => o.side === sens), sorties = ordres.filter((o) => o.side !== sens);
    if (!sorties.length) continue;
    const lots = entrees.reduce((s, o) => s + o.qty, 0), fermes = sorties.reduce((s, o) => s + o.qty, 0);
    if (fermes + 1e-9 < lots) continue; // données incomplètes : on réessaiera au prochain passage
    fermees.push({ positionId, sens, entrees, sorties, lots, ouvertLe: entrees[0].temps, fermeLe: Math.max(...sorties.map((o) => o.temps)), instrumentId: ordres[0].instrumentId });
  }

  // Un SIGNAL = les positions du même instrument et du même sens, ouvertes à
  // moins de 2 min d'écart (TP1, TP2, TP3… d'un même signal) → UN trade du Journal.
  fermees.sort((x, y) => x.ouvertLe - y.ouvertLe);
  const signaux: Position[][] = [];
  for (const p of fermees) {
    const g = signaux.find((s) => s[0].instrumentId === p.instrumentId && s[0].sens === p.sens && p.ouvertLe - s[0].ouvertLe <= ECART_SIGNAL_MS);
    if (g) g.push(p); else signaux.push([p]);
  }

  const noms = await instruments(env, jeton, id, accNum);
  let importes = 0;
  for (const g of signaux) {
    const debutSignal = g[0].ouvertLe;
    const fermeLe = Math.max(...g.map((p) => p.fermeLe));
    if (fermeLe < depuis) continue; // signal terminé avant la connexion : pas importé
    // Une position du même signal est encore ouverte : on attend qu'elle se ferme.
    if (ouvertes.some((o) => o.instrumentId === g[0].instrumentId && o.sens === g[0].sens && Math.abs(o.ouvertLe - debutSignal) <= ECART_SIGNAL_MS)) continue;
    const cles = g.map((p) => `${env}|${id}|${p.positionId}`);
    const { data: deja } = await db.from("trades_importes_tl").select("cle").in("cle", cles);
    if ((deja || []).length) continue; // déjà importé

    const det = await detailsInstrument(env, jeton, id, accNum, g[0].instrumentId);
    if (!(det.lotSize > 0)) { console.error("taille de lot inconnue", g[0].instrumentId); continue; }
    const direction = g[0].sens === "buy" ? 1 : -1;
    const parPos = g.map((p) => {
      const entree = moyenne(p.entrees);
      return { p, resultat: arrondi(p.sorties.reduce((s, o) => s + (o.prix - entree) * o.qty * det.lotSize * direction, 0)) };
    }).sort((x, y) => x.p.fermeLe - y.p.fermeLe);
    const resultat = arrondi(parPos.reduce((s, x) => s + x.resultat, 0));
    const lots = arrondi(g.reduce((s, p) => s + p.lots, 0));
    const entree = moyenne(g.flatMap((p) => p.entrees)), sortie = moyenne(g.flatMap((p) => p.sorties));

    // Réservé AVANT de créer le trade : deux passages simultanés ne peuvent pas l'importer deux fois.
    const { error: dejaPris } = await db.from("trades_importes_tl").insert(parPos.map((x) => ({
      cle: `${env}|${id}|${x.p.positionId}`, compte_id: c.compte_id, connexion_id: c.id, resultat: x.resultat, ferme_le: new Date(x.p.fermeLe).toISOString(),
    })));
    if (dejaPris) continue;
    const symbole = noms.get(g[0].instrumentId)?.name || String(g[0].instrumentId);
    const autreDevise = det.devise && det.devise !== devise ? ` · profit en ${det.devise}, non converti` : "";
    const detail = g.length > 1 ? ` en ${g.length} positions (${parPos.map((x, i) => `${i + 1} : ${x.resultat >= 0 ? "+" : ""}${x.resultat}`).join(" · ")})` : "";
    const { data: trade, error } = await db.from("trades").insert({
      compte_id: c.compte_id, date_trade: jourDans(fermeLe, fuseau), resultat, instrument: symbole,
      compte_tl: `${env}|${id}`, compte_tl_nom: `${String(a.name || "Compte")} #${accNum}`,
      ouvert_le: new Date(debutSignal).toISOString(), sens: g[0].sens,
      prix_entree: arrondi(entree, 5), prix_sortie: arrondi(sortie, 5),
      note: `Importé de TradeLocker · ${String(a.name || "Compte")} #${accNum} · ${g[0].sens === "buy" ? "Achat" : "Vente"} ${lots} lot${detail} · profit calculé (sans commissions ni swap)${autreDevise}`,
    }).select("id").single();
    if (error) { await db.from("trades_importes_tl").delete().in("cle", cles); throw error; }
    await db.from("trades_importes_tl").update({ trade_id: trade.id }).in("cle", cles);
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
