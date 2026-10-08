// Gold AI — Garde-fou du jour + alerte d'annonce proche.
//
// 1. Règles du jour calculées en arrière-plan (trades du jour comptés en
//    SIGNAUX : 1 trade = 1, peu importe ses TP ou ses copies sur d'autres
//    comptes). Le bandeau du haut ne s'affiche que pour avertir (orange) ou
//    quand une règle est atteinte (rouge) ; plus de compteur affiché. Règles :
//    Profil › Général (max trades, pertes qui arrêtent la journée, gain qui
//    arrête la journée) + « Perte max par jour » de CHAQUE compte TradeLocker
//    (Journal › Performance › Règles), comparée aux trades du jour de ce
//    compte. Calcul : js/noyau.js › evaluerGardeFou.
// 2. Blocage du calculateur quand une règle est atteinte (« Journée terminée »).
// 3. Alerte dans le calculateur si une annonce USD à fort impact tombe dans
//    les 30 prochaines minutes.
(() => {
  const N = window.GoldAI.noyau;
  const U = window.GoldAI.utils;
  const { esc } = U;
  const FENETRE_ANNONCE_MS = 30 * 60000;

  let regles = null;     // { maxTrades, pertesArret, seuilGain }
  let limitesJour = [];  // [{ cle, nom, limite }] : perte max par jour de chaque compte
  let etat = null;       // résultat de evaluerGardeFou
  let chargement = null; // promesse en cours
  let jourCalcule = null;
  let tradesDuJour = [];
  let tradesMaitre = [];   // trades du jour du compte maître (règles du garde-fou)

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

  // Perte max par jour réglée sur chaque compte (Performance › Règles).
  // (L'ancien écran « Mes comptes », vide depuis TradeLocker, n'est plus lu.)
  async function chargerLimite() {
    const r = await window.GoldAI.reglagesCalculateur.charger();
    const surnoms = r.surnomsComptes || {};
    limitesJour = Object.entries(r.reglesComptes || {})
      .filter(([, rg]) => Number(rg?.perteJour) > 0)
      .map(([cle, rg]) => ({ cle, nom: surnoms[cle] || cle, limite: Number(rg.perteJour) }));
  }

  // Perte nette (positive) des trades du jour de chaque compte réglé.
  function limitesDuJour() {
    return limitesJour.map((l) => {
      const net = tradesDuJour.filter((t) => t.compteTl === l.cle).reduce((s, t) => s + Number(t.resultat) - (Number(t.frais) || 0), 0);
      const nom = l.nom !== l.cle ? l.nom
        : (window.GoldAI.journal.obtenirTradesBruts().find((t) => t.compteTl === l.cle)?.compteTlNom || "Compte");
      return { ...l, nom, perte: Math.max(0, -net) };
    });
  }

  async function recalculer({ rechargerRegles = false } = {}) {
    if (!window.GoldAI.auth.getToken()) return null;
    const tache = (async () => {
      if (!regles || rechargerRegles) await Promise.all([chargerRegles(), chargerLimite()]);
      const [parJour, reglages] = await Promise.all([window.GoldAI.journal.chargerTousLesTrades(), window.GoldAI.reglagesCalculateur.charger().catch(() => ({}))]);
      jourCalcule = cleAujourdhui();
      tradesDuJour = parJour[jourCalcule] || [];
      // Règles (trades max, pertes, arrêt après un gain) : compte maître seulement, comme
      // l'objectif et le calculateur (+ trades saisis à la main sans compte). Sans compte
      // maître : tous les comptes. Les pertes max PAR COMPTE gardent les trades de chaque compte.
      const maitre = reglages?.compteMaitre;
      tradesMaitre = maitre ? tradesDuJour.filter((t) => t.compteTl === maitre || !t.compteTl) : tradesDuJour;
      etat = N.evaluerGardeFou({ trades: tradesMaitre, regles, limitesComptes: limitesDuJour() });
      afficherBandeau();
      afficherBlocageCalculateur();
      window.dispatchEvent(new CustomEvent("goldai:garde-fou", { detail: etat })); // bloc Discipline de l'accueil
      return etat;
    })();
    chargement = tache;
    try { return await tache; } finally { if (chargement === tache) chargement = null; }
  }

  function texteAlerte(a) {
    if (a.cle === "gain") return `Seuil de gain qui arrête la journée atteint (${dollars(etat.net, true)}) : on protège le gain`;
    return a.texte;
  }

  function afficherBandeau() {
    const zone = $("garde-fou");
    if (!zone || !etat) return;
    // En haut, seule la barre d'objectif reste affichée en temps normal : plus de
    // compteur « X trades sur N » ni de « reste … avant ta limite ». Les règles
    // continuent de tourner : le rectangle réapparaît seulement pour AVERTIR
    // (orange) ou quand une règle BLOQUE la journée (rouge).
    // « Plus qu'un seul trade autorisé » n'est jamais affiché en haut (demande de
    // l'utilisateur) : seul le blocage « nombre max de trades atteint » y apparaît.
    const alertes = etat.alertes.filter((a) => !(a.cle === "trades" && a.niveau !== "bloque"));
    const principale = alertes[0]; // alertes triées : la plus grave en premier
    if (!principale) { zone.hidden = true; zone.innerHTML = ""; return; }
    const niveau = principale.niveau;
    zone.className = `garde-fou ${niveau}`;
    zone.innerHTML = `
      <div class="ligne-garde-fou"><span class="icone-garde-fou" aria-hidden="true">${{ attention: "!", bloque: "!" }[niveau]}</span>
        <span>${esc(texteAlerte(principale))}${niveau === "bloque" ? " — journée terminée" : ""}</span></div>`;
    zone.hidden = false;
  }

  // ---------------------------------------------------------------- Calculateur

  // Règle atteinte : le calculateur affiche « Journée terminée », mais un bouton
  // permet de le débloquer pour une occasion exceptionnelle (valable jusqu'à
  // la fin de la journée, sur cet appareil). Un rappel rouge reste affiché.
  const CLE_FORCE = "goldai_garde_fou_force";
  function forceAujourdhui() {
    try { return localStorage.getItem(CLE_FORCE) === cleAujourdhui(); } catch { return false; }
  }

  function afficherBlocageCalculateur() {
    const zone = $("blocage-calculateur");
    const carteSaisie = $("carte-saisie-signal");
    if (!zone || !carteSaisie) return;
    const bloque = etat?.niveau === "bloque";
    const force = bloque && forceAujourdhui();
    carteSaisie.classList.toggle("hidden", bloque && !force);
    zone.classList.toggle("hidden", !bloque);
    zone.classList.toggle("debloque", force);
    if (!bloque) return;
    const regles = etat.alertes.filter((a) => a.niveau === "bloque").map((a) => esc(texteAlerte(a)));
    if (force) {
      zone.innerHTML = `<p class="rappel-debloque">${regles.join(" · ")}<br><span class="texte-attenue petit">Calculateur débloqué exceptionnellement pour aujourd'hui.</span></p>`;
      return;
    }
    zone.innerHTML = `
      <div class="icone-blocage" aria-hidden="true">!</div>
      <h3>Journée terminée</h3>
      <ul>${regles.map((r) => `<li>${r}</li>`).join("")}</ul>
      <p class="texte-attenue petit">Le trade de trop pour « se refaire » est celui qui fait perdre les comptes.</p>
      <button type="button" class="bouton secondaire" id="garde-fou-forcer">Calculer quand même (occasion exceptionnelle)</button>`;
    $("zone-signal-interprete").innerHTML = "";
    $("zone-resultat-calcul").innerHTML = "";
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("#garde-fou-forcer")) {
      try { localStorage.setItem(CLE_FORCE, cleAujourdhui()); } catch { /* ignoré */ }
      afficherBlocageCalculateur();
    }
  });

  // Attend le calcul du jour avant de dire si le calculateur est autorisé.
  async function calculAutorise() {
    if (chargement) await chargement;
    if (!etat || jourCalcule !== cleAujourdhui()) await recalculer();
    return etat?.niveau !== "bloque" || forceAujourdhui();
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
    zone.innerHTML = `<strong>${esc(p.e.titre)}</strong> (USD, fort impact) dans <strong>${min} min</strong> — à ${U.heure(p.ms)}. Le prix peut bouger très fort : attends la publication avant d'entrer.`;
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
    regles = null; limitesJour = []; etat = null; jourCalcule = null; tradesDuJour = []; tradesMaitre = [];
    window.GoldAI.compteMaitre?.oublier();
    clearInterval(minuterie);
    const zone = $("garde-fou");
    if (zone) { zone.hidden = true; zone.innerHTML = ""; }
    const objectif = $("bloc-objectif"); // barre d'objectif, juste dessous
    if (objectif) { objectif.hidden = true; objectif.innerHTML = ""; }
  }

  window.addEventListener("goldai:trades", () => recalculer());
  window.addEventListener("goldai:regles", () => recalculer({ rechargerRegles: true }));
  // Objectif modifié dans Profil › Général.
  // Objectif, perte max par jour d'un compte… modifiés : tout est recalculé.
  window.addEventListener("goldai:reglages-calculateur", () => { if (etat) recalculer({ rechargerRegles: true }); });
  window.addEventListener("goldai:comptes", () => recalculer({ rechargerRegles: true }));
  window.addEventListener("goldai:donnees", () => { if ($("section-calculateur")?.classList.contains("actif")) afficherAlerteAnnonce(); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.gardeFou = { demarrer, viderCache, recalculer, calculAutorise, afficherAlerteAnnonce, annonceProche, etat: () => etat, cleAujourdhui,
    // Pour le calculateur : marge restante aujourd'hui sur chaque compte réglé.
    margesJour: async () => { if (chargement) await chargement; if (!etat || jourCalcule !== cleAujourdhui()) await recalculer(); return etat?.limitesComptes || []; } };
})();
