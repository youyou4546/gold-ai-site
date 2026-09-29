// Gold AI — Garde-fou du jour + alerte d'annonce proche.
//
// 1. Règles du jour calculées en arrière-plan (trades du jour comptés en
//    SIGNAUX : 1 trade = 1, peu importe ses TP ou ses copies sur d'autres
//    comptes). Le bandeau du haut ne s'affiche que pour avertir (orange) ou
//    quand une règle est atteinte (rouge) ; plus de compteur affiché. Règles : Profil › Général (max trades, pertes
//    qui arrêtent la journée, gain qui arrête la journée) + limite de perte
//    journalière des comptes de Profil › Mes comptes (la plus stricte si
//    plusieurs comptes). Calcul : js/noyau.js › evaluerGardeFou.
// 2. Blocage du calculateur quand une règle est atteinte (« Journée terminée »).
// 3. Alerte dans le calculateur si une annonce USD à fort impact tombe dans
//    les 30 prochaines minutes.
(() => {
  const N = window.GoldAI.noyau;
  const U = window.GoldAI.utils;
  const { esc } = U;
  const FENETRE_ANNONCE_MS = 30 * 60000;

  let regles = null;     // { maxTrades, pertesArret, seuilGain }
  let limite = null;     // { montant, nomCompte } ou null
  let etat = null;       // résultat de evaluerGardeFou
  let chargement = null; // promesse en cours
  let jourCalcule = null;
  let tradesDuJour = [];
  let objectifAtteint = false; // objectif de profit (Profil › Général) atteint → plus de « X trades sur N »

  const $ = (id) => document.getElementById(id);
  const dollars = (v, signe = false) => U.montant(v, "USD", { signe });

  function cleAujourdhui() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function chargerRegles() {
    const { data, error } = await window.GoldAI.auth.client.rpc("obtenir_mes_parametres", { p_token: window.GoldAI.auth.getToken() });
    const p = error ? null : (Array.isArray(data) ? data[0] : data);
    regles = { maxTrades: p?.max_trades_jour ?? null, pertesArret: p?.nombre_pertes_arret ?? null, seuilGain: p?.seuil_gain_arret ?? null };
  }

  async function chargerLimite() {
    const comptes = await window.GoldAI.comptesTrading.chargerComptes();
    // Plusieurs comptes : la limite la plus stricte (en $) sert de référence.
    limite = comptes
      .map((c) => ({ montant: window.GoldAI.comptesTrading.calculerLimites(c, 0).dailyLossLimit, nomCompte: c.nom }))
      .filter((x) => x.montant > 0)
      .sort((a, b) => a.montant - b.montant)[0] || null;
  }

  async function recalculer({ rechargerRegles = false } = {}) {
    if (!window.GoldAI.auth.getToken()) return null;
    const tache = (async () => {
      if (!regles || rechargerRegles) await Promise.all([chargerRegles(), chargerLimite()]);
      const parJour = await window.GoldAI.journal.chargerTousLesTrades();
      jourCalcule = cleAujourdhui();
      tradesDuJour = parJour[jourCalcule] || [];
      etat = N.evaluerGardeFou({ trades: tradesDuJour, regles, limitePerte: limite?.montant ?? null });
      await majObjectifAtteint(parJour);
      afficherBandeau();
      afficherBlocageCalculateur();
      window.dispatchEvent(new CustomEvent("goldai:garde-fou", { detail: etat })); // bloc Discipline de l'accueil
      return etat;
    })();
    chargement = tache;
    try { return await tache; } finally { if (chargement === tache) chargement = null; }
  }

  // Même calcul que la barre d'objectif (js/accueil-discipline.js) : compte maître seulement.
  async function majObjectifAtteint(parJour) {
    try {
      const reglages = await window.GoldAI.reglagesCalculateur.charger();
      if (!reglages.compteMaitre) { objectifAtteint = false; return; }
      const trades = Object.values(parJour || await window.GoldAI.journal.chargerTousLesTrades()).flat();
      objectifAtteint = N.progressionObjectif(trades, { ...(reglages.objectif || {}), compteId: "", compteTl: reglages.compteMaitre }, cleAujourdhui()).atteint;
    } catch { objectifAtteint = false; }
  }

  function texteAlerte(a) {
    if (a.cle === "gain") return `Objectif du jour atteint (${dollars(etat.net, true)}) : on protège le gain`;
    return a.texte;
  }

  function afficherBandeau() {
    const zone = $("garde-fou");
    if (!zone || !etat) return;
    // En haut, seule la barre d'objectif reste affichée en temps normal : plus de
    // compteur « X trades sur N » ni de « reste … avant ta limite ». Les règles
    // continuent de tourner : le rectangle réapparaît seulement pour AVERTIR
    // (orange) ou quand une règle BLOQUE la journée (rouge).
    const alertes = objectifAtteint ? etat.alertes.filter((a) => !(a.cle === "trades" && a.niveau !== "bloque")) : etat.alertes;
    const principale = alertes[0]; // alertes triées : la plus grave en premier
    if (!principale) { zone.hidden = true; zone.innerHTML = ""; return; }
    const niveau = principale.niveau;
    zone.className = `garde-fou ${niveau}`;
    zone.innerHTML = `
      <div class="ligne-garde-fou"><span class="icone-garde-fou" aria-hidden="true">${{ attention: "⚠️", bloque: "⛔" }[niveau]}</span>
        <span>${esc(texteAlerte(principale))}${niveau === "bloque" ? " — journée terminée" : ""}</span></div>`;
    zone.hidden = false;
  }

  // ---------------------------------------------------------------- Calculateur

  function afficherBlocageCalculateur() {
    const zone = $("blocage-calculateur");
    const carteSaisie = $("carte-saisie-signal");
    if (!zone || !carteSaisie) return;
    const bloque = etat?.niveau === "bloque";
    carteSaisie.classList.toggle("hidden", bloque);
    zone.classList.toggle("hidden", !bloque);
    if (bloque) {
      zone.innerHTML = `
        <div class="icone-blocage" aria-hidden="true">⛔</div>
        <h3>Journée terminée</h3>
        <ul>${etat.alertes.filter((a) => a.niveau === "bloque").map((a) => `<li>${esc(texteAlerte(a))}</li>`).join("")}</ul>
        <p class="texte-attenue petit">Le calculateur se rouvre demain. Le trade de trop pour « se refaire » est celui qui fait perdre les comptes.</p>`;
      $("zone-signal-interprete").innerHTML = "";
      $("zone-resultat-calcul").innerHTML = "";
    }
  }

  // Attend le calcul du jour avant de dire si le calculateur est autorisé.
  async function calculAutorise() {
    if (chargement) await chargement;
    if (!etat || jourCalcule !== cleAujourdhui()) await recalculer();
    return etat?.niveau !== "bloque";
  }

  // Un trade gagnant est-il déjà enregistré aujourd'hui (journée locale) ?
  async function gainDejaFaitAujourdhui() {
    if (chargement) await chargement;
    if (!etat || jourCalcule !== cleAujourdhui()) await recalculer();
    return N.aUnTradeGagnant(tradesDuJour);
  }

  function annonceProche(maintenant = Date.now()) {
    const evs = window.GoldAI.calendrier?.evenementsCalendrier?.() || [];
    return evs
      .filter((e) => e.horodatage_utc && e.devise === "USD" && e.impact === "high")
      .map((e) => ({ e, ms: Date.parse(e.horodatage_utc) }))
      .filter(({ ms }) => ms > maintenant && ms - maintenant <= FENETRE_ANNONCE_MS)
      .sort((a, b) => a.ms - b.ms)[0] || null;
  }

  function afficherAlerteAnnonce() {
    const zone = $("alerte-annonce-calcul");
    if (!zone) return;
    const p = annonceProche();
    zone.classList.toggle("hidden", !p);
    if (!p) { zone.innerHTML = ""; return; }
    const min = Math.max(1, Math.round((p.ms - Date.now()) / 60000));
    zone.innerHTML = `⚠️ <strong>${esc(p.e.titre)}</strong> (USD, fort impact) dans <strong>${min} min</strong> — à ${U.heure(p.ms)}. Le prix peut bouger très fort : attends la publication avant d'entrer.`;
  }

  // ---------------------------------------------------------------- Cycle de vie

  let minuterie = null;
  function demarrer() {
    recalculer({ rechargerRegles: true });
    clearInterval(minuterie);
    minuterie = setInterval(() => {
      // Changement de jour : le garde-fou repart à zéro à minuit.
      if (jourCalcule && jourCalcule !== cleAujourdhui()) recalculer();
      if ($("section-calculateur")?.classList.contains("actif")) afficherAlerteAnnonce();
    }, 30000);
  }

  function viderCache() {
    regles = null; limite = null; etat = null; jourCalcule = null; tradesDuJour = []; objectifAtteint = false;
    clearInterval(minuterie);
    const zone = $("garde-fou");
    if (zone) { zone.hidden = true; zone.innerHTML = ""; }
    const objectif = $("bloc-objectif"); // barre d'objectif, juste dessous
    if (objectif) { objectif.hidden = true; objectif.innerHTML = ""; }
  }

  window.addEventListener("goldai:trades", () => recalculer());
  window.addEventListener("goldai:regles", () => recalculer({ rechargerRegles: true }));
  // Objectif modifié dans Profil › Général.
  window.addEventListener("goldai:reglages-calculateur", async () => { if (etat) { await majObjectifAtteint(); afficherBandeau(); } });
  window.addEventListener("goldai:comptes", () => recalculer({ rechargerRegles: true }));
  window.addEventListener("goldai:donnees", () => { if ($("section-calculateur")?.classList.contains("actif")) afficherAlerteAnnonce(); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.gardeFou = { demarrer, viderCache, recalculer, calculAutorise, gainDejaFaitAujourdhui, afficherAlerteAnnonce, annonceProche, etat: () => etat, cleAujourdhui };
})();
