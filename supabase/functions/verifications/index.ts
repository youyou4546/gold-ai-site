// Gold AI — vérifications automatiques chez Supabase (chaque minute), SANS le PC.
//
// Déclenchée par pg_cron (voir supabase/patch_alertes_cloud.sql). Fait le
// travail qu'assuraient avant site/notifier_annonces.py et site/suivre_trades.py :
//  1. Annonces : notification ~15 min avant chaque annonce USD à fort impact.
//     Si le PC n'a pas publié le calendrier depuis 3 h, il est téléchargé ici
//     (Forex Factory) et publié pour le site aussi.
//  2. Trade en cours (« J'entre ») : TP / SL touchés → notification avec le SL
//     à déplacer (même logique que js/noyau.js › evaluerTouches).
//  3. Alertes de prix (Journal › Suivre le prix) : prix ou zone touché →
//     notification (même règle que js/noyau.js › alerteTouchee). Pour ménager
//     le quota Twelve Data (800/jour), vérifiées toutes les 3 min seulement
//     s'il n'y a pas de trade en cours ; les bougies 1 min ne ratent aucune mèche.
// Secrets de la fonction : VAPID_KEYS_B64 (clés de signature JWK, en base64) et
// CRON_SECRET (seul pg_cron peut la déclencher).

import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const CONTACT = "https://youyou4546.github.io";
const AVANCE_MS = 16 * 60000;          // alerte d'annonce : 16 min ou moins avant
const DUREE_MAX_TRADE_MS = 6 * 3600000; // suivi arrêté 6 h après l'entrée
const CALENDRIER_PERIME_MS = 3 * 3600000;

let serveurPush: webpush.ApplicationServer | null = null;
async function serveur() {
  if (!serveurPush) {
    // Clés stockées en base64 (JSON des clés JWK) pour éviter les soucis de guillemets.
    const cles = await webpush.importVapidKeys(JSON.parse(atob(Deno.env.get("VAPID_KEYS_B64")!)), { extractable: false });
    serveurPush = await webpush.ApplicationServer.new({ contactInformation: CONTACT, vapidKeys: cles });
  }
  return serveurPush;
}

// ------------------------------------------------------------------ Notifications

type Abonnement = { endpoint: string; p256dh: string; auth: string };

async function envoyer(titre: string, texte: string, { url = "./index.html#calendrier", tag = "", compteId = "" } = {}) {
  let requete = db.from("abonnements_push").select("endpoint, p256dh, auth");
  if (compteId) requete = requete.eq("compte_id", compteId);
  const { data: abonnes, error } = await requete;
  if (error) throw error;
  const as = await serveur();
  let envoyes = 0;
  for (const ab of (abonnes || []) as Abonnement[]) {
    try {
      await as.subscribe({ endpoint: ab.endpoint, keys: { p256dh: ab.p256dh, auth: ab.auth } })
        .pushTextMessage(JSON.stringify({ titre, texte, url, tag }), { ttl: 15 * 60, urgency: webpush.Urgency.High });
      envoyes++;
    } catch (e) {
      const statut = (e as { response?: Response }).response?.status;
      if (statut === 404 || statut === 410) await db.from("abonnements_push").delete().eq("endpoint", ab.endpoint);
      else console.error("envoi impossible", statut, String(e));
    }
  }
  return envoyes;
}

// Mémoire des alertes déjà envoyées (une seule fois par annonce).
async function dejaEnvoye(cle: string) {
  const { data } = await db.from("notifications_envoyees").select("cle").eq("cle", cle).maybeSingle();
  return Boolean(data);
}
async function memoriser(cle: string) {
  await db.from("notifications_envoyees").upsert({ cle, envoye_le: new Date().toISOString() });
}

// ------------------------------------------------------------------ 1. Annonces

type Evenement = { id: string; titre: string; devise: string; pays: string; horodatage_utc: string | null; impact: string; valeurs: { prevision?: string; precedent?: string }[] };

const PAYS: Record<string, string> = { USD: "États-Unis", EUR: "Zone euro", GBP: "Royaume-Uni", JPY: "Japon", CHF: "Suisse", CAD: "Canada", AUD: "Australie", NZD: "Nouvelle-Zélande", CNY: "Chine" };

async function calendrier(): Promise<Evenement[]> {
  const { data } = await db.from("donnees_publiees").select("contenu, publie_le").eq("nom", "calendrier").maybeSingle();
  if (data && Date.now() - Date.parse(data.publie_le) < CALENDRIER_PERIME_MS) return data.contenu?.evenements || [];

  // PC éteint depuis un moment : on récupère le calendrier ici et on le publie pour le site.
  try {
    const r = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { headers: { "User-Agent": "gold-ai-site" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const brut = await r.json() as { title: string; country: string; date: string; impact: string; forecast: string; previous: string }[];
    const evenements: Evenement[] = brut.map((e) => {
      const ms = Date.parse(e.date);
      const iso = Number.isNaN(ms) ? null : new Date(ms).toISOString().replace(".000Z", "Z");
      return {
        id: `${e.country}|${iso}|${e.title}`,
        titre: e.title, devise: e.country, pays: PAYS[e.country] || e.country,
        horodatage_utc: iso, date_utc: iso?.slice(0, 10), precision_heure: "heure",
        impact: ({ High: "high", Medium: "medium", Low: "low", Holiday: "holiday" } as Record<string, string>)[e.impact] || "low",
        valeurs: [{ source: "Forex Factory", prevision: e.forecast || "", precedent: e.previous || "", resultat: null, url: null }],
        unite: "", sources: ["Forex Factory"],
      } as Evenement;
    });
    const contenu = { genere_le: new Date().toISOString(), fuseau_source: "UTC", origine: "supabase (PC éteint)", sources: [{ source: "Forex Factory", statut: "ok", note: "récupéré par Supabase" }], evenements };
    await db.from("donnees_publiees").upsert({ nom: "calendrier", contenu, publie_le: new Date().toISOString() });
    return evenements;
  } catch (e) {
    console.error("calendrier indisponible", String(e));
    return data?.contenu?.evenements || [];
  }
}

async function alertesAnnonces() {
  const maintenant = Date.now();
  const proches = (await calendrier()).filter((e) => {
    if (e.devise !== "USD" || e.impact !== "high" || !e.horodatage_utc) return false;
    const dt = Date.parse(e.horodatage_utc) - maintenant;
    return dt > 0 && dt <= AVANCE_MS;
  });
  // Plusieurs annonces à la même heure → une seule notification.
  const parHeure = new Map<string, Evenement[]>();
  for (const e of proches) parHeure.set(e.horodatage_utc!, [...(parHeure.get(e.horodatage_utc!) || []), e]);

  for (const [heure, groupe] of parHeure) {
    const nouveaux = [];
    for (const e of groupe) if (!(await dejaEnvoye(`annonce|${e.devise}|${heure}|${e.titre}`))) nouveaux.push(e);
    if (!nouveaux.length) continue;
    const minutes = Math.max(1, Math.round((Date.parse(heure) - maintenant) / 60000));
    const heureLocale = new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" }).format(new Date(heure));
    let titre: string, texte: string;
    if (nouveaux.length === 1) {
      const e = nouveaux[0], v = e.valeurs?.[0] || {};
      const details = [v.prevision ? `prévision ${v.prevision}` : "", v.precedent ? `précédent ${v.precedent}` : ""].filter(Boolean).join(" · ");
      titre = `⚠️ Annonce USD dans ${minutes} min`;
      texte = `${e.titre} à ${heureLocale}${details ? ` — ${details}` : ""}`;
    } else {
      titre = `⚠️ ${nouveaux.length} annonces USD dans ${minutes} min`;
      texte = `À ${heureLocale} : ${nouveaux.map((e) => e.titre).join(", ")}`;
    }
    await envoyer(titre, `${texte}. Attends la publication avant d'entrer.`, { tag: `annonce-${heure}` });
    for (const e of nouveaux) await memoriser(`annonce|${e.devise}|${heure}|${e.titre}`);
  }
}

// ------------------------------------------------------------------ 2. Trade en cours

type Trade = {
  id: string; sens: string; entree: number; sl: number; debutMs: number; derniereVerifMs?: number;
  tps: { numero: number; prix: number }[]; plan: { apres: string; sl: number }[];
  portions: { type: string }[]; touches: string[]; slTouche: boolean; statut: string;
};

function slCourant(t: Trade) {
  let sl = t.sl;
  for (const p of t.plan || []) if ((t.touches || []).includes(p.apres)) sl = p.sl;
  return sl;
}

function evaluerTouches(t: Trade, haut: number, bas: number) {
  const vente = t.sens === "SELL";
  const touches = [...(t.touches || [])];
  const nouveaux: string[] = [];
  const slAvant = slCourant(t);
  const slTouche = !t.slTouche && (vente ? haut >= slAvant : bas <= slAvant);
  for (const tp of t.tps || []) {
    const nom = `TP${tp.numero}`;
    if (!touches.includes(nom) && (vente ? bas <= tp.prix : haut >= tp.prix)) { touches.push(nom); nouveaux.push(nom); }
  }
  const suivant: Trade = { ...t, touches, slTouche: t.slTouche || slTouche };
  const tous = (t.tps || []).length > 0 && t.tps.every((tp) => touches.includes(`TP${tp.numero}`));
  const runner = (t.portions || []).some((p) => p.type !== "tp");
  suivant.statut = suivant.slTouche ? "sl" : tous && !runner ? "termine" : "ouvert";
  return { trade: suivant, nouveaux, slTouche, slAvant };
}

function marcheFerme(d: Date) {
  const j = d.getUTCDay(), h = d.getUTCHours(); // 0 = dimanche
  return j === 6 || (j === 5 && h >= 21) || (j === 0 && h < 22);
}

const px = (x: number) => Number(x.toFixed(2)).toString();

type Bougie = { debut: number; haut: number; bas: number; cloture: number };

// Une seule requête Twelve Data par passage, partagée entre trades et alertes.
let bougiesDuPassage: Promise<Bougie[]> | null = null;
function bougies1min() {
  if (!bougiesDuPassage) bougiesDuPassage = telechargerBougies();
  return bougiesDuPassage;
}

async function telechargerBougies(): Promise<Bougie[]> {
  const { data } = await db.from("config_cotations").select("cle_twelvedata").eq("id", 1).maybeSingle();
  const cle = data?.cle_twelvedata;
  if (!cle) throw new Error("clé Twelve Data absente");
  const r = await fetch(`https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1min&outputsize=15&timezone=UTC&apikey=${cle}`);
  const d = await r.json();
  if (d.status === "error") throw new Error(d.message);
  return (d.values || []).map((v: Record<string, string>) => ({
    debut: Date.parse(v.datetime.replace(" ", "T") + "Z"), haut: Number(v.high), bas: Number(v.low), cloture: Number(v.close),
  }));
}

async function suiviTrades() {
  const { data: lignes } = await db.from("trades_en_cours").select("compte_id, contenu");
  const ouverts = (lignes || []).filter((l) => (l.contenu?.statut || "ouvert") === "ouvert");
  if (!ouverts.length) return; // rien à suivre : aucune requête Twelve Data

  const maintenant = Date.now();
  let bougies: Bougie[] | null = null;
  if (!marcheFerme(new Date())) {
    try { bougies = await bougies1min(); } catch (e) { console.error("prix indisponibles", String(e)); }
  }

  for (const { compte_id: compteId, contenu } of ouverts) {
    let t = contenu as Trade;
    const messages: [string, string][] = [];
    if (maintenant - (t.debutMs || maintenant) > DUREE_MAX_TRADE_MS) {
      t = { ...t, statut: "expire" };
      messages.push(["⏱️ Suivi du trade arrêté", "6 h après l'entrée, le suivi s'arrête. Pense à enregistrer ton trade dans le Journal."]);
    } else if (bougies) {
      const depuis = Math.max(t.debutMs || 0, t.derniereVerifMs || 0);
      const utiles = bougies.filter((b) => b.debut + 60000 > depuis);
      if (utiles.length) {
        const r = evaluerTouches(t, Math.max(...utiles.map((b) => b.haut)), Math.min(...utiles.map((b) => b.bas)));
        t = r.trade;
        const slApres = slCourant(t);
        if (r.nouveaux.length) {
          const prixTp = Object.fromEntries(t.tps.map((tp) => [`TP${tp.numero}`, tp.prix]));
          const titre = `🎯 ${r.nouveaux.map((n) => `${n} (${px(prixTp[n])})`).join(" et ")} touché${r.nouveaux.length > 1 ? "s" : ""}`;
          const texte = t.statut === "termine" ? "Dernier TP atteint : trade terminé. Enregistre-le dans le Journal."
            : slApres !== r.slAvant ? `${t.sens === "BUY" ? "Remonte" : "Descends"} ton SL à ${px(slApres)}.`
            : `SL inchangé à ${px(slApres)} (selon ton plan).`;
          messages.push([titre, texte]);
        }
        if (r.slTouche) messages.push([`🛑 SL touché (${px(r.slAvant)})`, "Ton trade est sans doute fermé. Ouvre l'app pour l'enregistrer dans le Journal."]);
      }
    }
    t = { ...t, derniereVerifMs: maintenant };
    for (const [titre, texte] of messages) await envoyer(titre, texte, { url: "./index.html#calculateur", tag: `trade-${t.id}`, compteId });
    // Mise à jour seulement si c'est toujours le même trade (jamais écraser un nouveau).
    await db.from("trades_en_cours").update({ contenu: t, maj_le: new Date().toISOString() }).eq("compte_id", compteId).eq("contenu->>id", t.id);
  }
}

// ------------------------------------------------------------------ 3. Alertes de prix

type AlertePrix = { id: string; compte_id: string; bas: number; haut: number; note: string | null; prix_creation: number | null; cree_le: string; derniere_verif: string | null };

async function alertesPrix() {
  const { data, error } = await db.from("alertes_prix").select("id, compte_id, bas, haut, note, prix_creation, cree_le, derniere_verif").is("touchee_le", null);
  if (error) throw error;
  const actives = (data || []) as AlertePrix[];
  if (!actives.length || marcheFerme(new Date())) return;
  // Pas de trade en cours (bougies pas encore téléchargées) : une vérification toutes les 3 min.
  if (!bougiesDuPassage && new Date().getUTCMinutes() % 3 !== 0) return;

  const bougies = await bougies1min();
  if (!bougies.length) return;
  const maintenant = new Date().toISOString();
  const dernier = bougies.reduce((a, b) => (b.debut > a.debut ? b : a));

  for (const a of actives) {
    const bas = Number(a.bas), haut = Number(a.haut);
    // Bougies depuis la création (minute de création incluse) ou la dernière vérification.
    const depuis = Math.max(Date.parse(a.cree_le), a.derniere_verif ? Date.parse(a.derniere_verif) : 0);
    const utiles = bougies.filter((b) => b.debut + 60000 > depuis);
    const touchee = utiles.some((b) => b.haut >= bas && b.bas <= haut);
    if (!touchee) {
      await db.from("alertes_prix").update({ derniere_verif: maintenant }).eq("id", a.id);
      continue;
    }
    const zone = bas === haut ? `Prix ${px(bas)}` : `Zone ${px(bas)} – ${px(haut)}`;
    const venue = a.prix_creation ? (Number(a.prix_creation) > haut ? " par le haut" : Number(a.prix_creation) < bas ? " par le bas" : "") : "";
    // Marquée AVANT l'envoi : jamais deux notifications pour la même alerte.
    const { data: maj } = await db.from("alertes_prix").update({ touchee_le: maintenant, derniere_verif: maintenant, prix_touche: dernier.cloture })
      .eq("id", a.id).is("touchee_le", null).select("id");
    if (!maj?.length) continue;
    await envoyer(`🎯 ${zone} touché${bas === haut ? "" : "e"}`, `L'or y est arrivé${venue} — il est à ${px(dernier.cloture)} maintenant.${a.note ? ` (${a.note})` : ""}`,
      { url: "./index.html#alertes", tag: `alerte-${a.id}`, compteId: a.compte_id });
  }
  // Alertes touchées gardées 7 jours dans la liste, puis effacées.
  await db.from("alertes_prix").delete().lt("touchee_le", new Date(Date.now() - 7 * 86400000).toISOString());
}

// ------------------------------------------------------------------ Point d'entrée

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("interdit", { status: 403 });
  const url = new URL(req.url);
  if (url.searchParams.get("test") === "1") {
    const n = await envoyer("🔔 Test Trading Tool (Supabase)", "Les alertes fonctionnent maintenant sans ton PC.", { tag: "test" });
    return Response.json({ ok: true, envoyes: n });
  }
  const resultat: Record<string, string> = {};
  bougiesDuPassage = null;
  for (const [nom, tache] of [["annonces", alertesAnnonces], ["trades", suiviTrades], ["alertes_prix", alertesPrix]] as const) {
    try { await tache(); resultat[nom] = "ok"; } catch (e) { resultat[nom] = String(e); console.error(nom, e); }
  }
  // Nettoyage de la mémoire des alertes (plus de 3 jours).
  await db.from("notifications_envoyees").delete().lt("envoye_le", new Date(Date.now() - 3 * 86400000).toISOString());
  return Response.json(resultat);
});
