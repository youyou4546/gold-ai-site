// Gold AI — cotations centralisées de l'or spot (XAU/USD) + bougies.
//
// UNE seule source de vérité pour tout le site (Marché, Annonces, Impact
// probable) : les sections s'abonnent aux événements "goldai:cotation" et
// "goldai:bougies" au lieu d'aller chercher les prix chacune de leur côté.
//
// Fournisseur : Twelve Data (forfait gratuit : XAU/USD spot inclus, 8 requêtes
// par minute et 800 par jour, WebSocket disponible pour XAU/USD — testé).
//   1. À l'ouverture : 1 requête /quote (dernier prix + clôture précédente +
//      marché ouvert ou non).
//   2. Ensuite : WebSocket (prix poussé en continu, battement toutes les 10 s).
//   3. Si le WebSocket échoue : requêtes /quote espacées de 3 min (quota).
//   4. Coupure réseau, retour sur l'app, sortie de veille : reconnexion
//      automatique + nouvelle requête /quote pour rattraper.
// Une cotation plus ancienne (horodatage du fournisseur) n'écrase jamais une
// plus récente, quelle que soit l'ordre d'arrivée des réponses.
//
// La clé Twelve Data n'est pas dans ce code (site public) : elle est remise
// par Supabase aux utilisateurs connectés (fonction obtenir_cle_cotations).
(() => {
  const SYMBOLE = "XAU/USD";
  const FOURNISSEUR = "Twelve Data";
  const TYPE_PRIX = "prix agrégé (bid/ask non précisé par le fournisseur)";
  const INTERVALLE_REST_MS = 3 * 60 * 1000;
  const SEUIL_DIRECT_MS = 3 * 60 * 1000;
  const SEUIL_ANCIEN_MS = 15 * 60 * 1000;

  const DUREES = { "30min": 30 * 60000, "1h": 3600000, "4h": 4 * 3600000, "1week": 7 * 86400000 };

  let cle = null;
  let ws = null;
  let wsVoulu = false;
  let tentativesWs = 0;
  let minuterieBattement = null;
  let minuterieRest = null;
  let minuterieReconnexion = null;
  let minuterieFraicheur = null;
  let demarre = false;

  const cotation = {
    prix: null, horodatageMs: null, recuLeMs: null, cloturePrecedente: null,
    mode: "aucun",          // websocket | requêtes périodiques | instantané publié | aucun
    connexion: "hors ligne", // connecté | reconnexion | hors ligne
    marcheOuvertFournisseur: null,
    erreur: null,
  };

  const bougies = {}; // intervalle → { liste, recupereLeMs, erreur }

  // ---------------------------------------------------------------------
  // Horaires : XAU/USD spot cote du dimanche 18:00 au vendredi 17:00 (heure
  // de New York), avec une pause quotidienne 17:00–18:00. Les jours fériés ne
  // sont pas connus ici : un flux muet pendant les heures d'ouverture est
  // signalé "ancien" plutôt que présenté comme en direct.
  function marcheOuvertSelonHoraire(ms = Date.now()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const h = Number(p.hour) % 24 + Number(p.minute) / 60;
    if (p.weekday === "Sat") return false;
    if (p.weekday === "Sun") return h >= 18;
    if (p.weekday === "Fri") return h < 17;
    return !(h >= 17 && h < 18);
  }

  function fraicheur(ms = Date.now()) {
    if (cotation.prix === null) return cotation.erreur ? "indisponible" : "chargement";
    if (!marcheOuvertSelonHoraire(ms)) return "marché fermé";
    const age = ms - cotation.horodatageMs;
    if (age <= SEUIL_DIRECT_MS && cotation.mode !== "instantané publié") return "direct";
    if (age <= SEUIL_ANCIEN_MS) return "retard";
    return "ancien";
  }

  function instantane() {
    const f = fraicheur();
    return {
      ...cotation,
      symbole: SYMBOLE, fournisseur: FOURNISSEUR, typePrix: TYPE_PRIX, instrument: "spot",
      fraicheur: f,
      marcheOuvert: marcheOuvertSelonHoraire(),
      variationPct: cotation.prix !== null && cotation.cloturePrecedente ? ((cotation.prix - cotation.cloturePrecedente) / cotation.cloturePrecedente) * 100 : null,
    };
  }

  function emettre() {
    window.dispatchEvent(new CustomEvent("goldai:cotation", { detail: instantane() }));
  }

  // N'accepte une cotation que si elle est au moins aussi récente que l'actuelle.
  function appliquer(prix, horodatageMs, source) {
    if (!Number.isFinite(prix) || !Number.isFinite(horodatageMs)) return false;
    if (cotation.horodatageMs !== null && horodatageMs < cotation.horodatageMs) return false;
    cotation.prix = prix;
    cotation.horodatageMs = horodatageMs;
    cotation.recuLeMs = Date.now();
    cotation.erreur = null;
    if (source) cotation.mode = source;
    emettre();
    return true;
  }

  // ---------------------------------------------------------------------
  // REST
  async function requeteQuote() {
    if (!cle || Date.now() < pauseQuotaJusquaMs) return;
    try {
      const r = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(SYMBOLE)}&apikey=${encodeURIComponent(cle)}`, { cache: "no-store" });
      const d = await r.json();
      if (d.status === "error" || !d.close) throw new Error(d.message || "réponse inattendue");
      if (d.previous_close) cotation.cloturePrecedente = Number(d.previous_close);
      cotation.marcheOuvertFournisseur = d.is_market_open ?? null;
      const ts = Number(d.last_quote_at || d.timestamp) * 1000;
      if (!appliquer(Number(d.close), ts, ws && ws.readyState === 1 ? "websocket" : "requêtes périodiques")) emettre();
    } catch (e) {
      if (estErreurQuota(e.message)) {
        pauseQuotaJusquaMs = Date.now() + 65000;
        cotation.erreur = "Twelve Data : limite de requêtes atteinte (forfait gratuit partagé) — le flux WebSocket continue si connecté.";
      } else cotation.erreur = `Twelve Data : ${e.message}`;
      emettre();
    }
  }

  function demarrerRest() {
    if (minuterieRest) return;
    minuterieRest = setInterval(() => {
      if (document.visibilityState === "visible" && !(ws && ws.readyState === 1)) requeteQuote();
    }, INTERVALLE_REST_MS);
  }

  // ---------------------------------------------------------------------
  // WebSocket
  function ouvrirWs() {
    if (!cle || !wsVoulu) return;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return; // jamais deux abonnements
    clearTimeout(minuterieReconnexion);
    cotation.connexion = tentativesWs ? "reconnexion" : "connexion";
    emettre();

    const socket = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(cle)}`);
    ws = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ action: "subscribe", params: { symbols: SYMBOLE } }));
      clearInterval(minuterieBattement);
      minuterieBattement = setInterval(() => { if (socket.readyState === 1) socket.send(JSON.stringify({ action: "heartbeat" })); }, 10000);
    };
    socket.onmessage = (m) => {
      let d;
      try { d = JSON.parse(m.data); } catch { return; }
      if (d.event === "subscribe-status") {
        if (d.status === "ok" && (d.success || []).length) {
          tentativesWs = 0;
          cotation.connexion = "connecté";
          cotation.mode = "websocket";
          emettre();
        } else {
          cotation.erreur = "WebSocket refusé par le fournisseur (limite du forfait ?) — repli sur requêtes périodiques.";
          fermerWs(false);
          cotation.mode = "requêtes périodiques";
          emettre();
        }
      } else if (d.event === "price" && d.symbol === SYMBOLE) {
        appliquer(Number(d.price), Number(d.timestamp) * 1000, "websocket");
      }
    };
    socket.onclose = () => {
      clearInterval(minuterieBattement);
      if (ws === socket) ws = null;
      if (!wsVoulu) return;
      cotation.connexion = navigator.onLine ? "reconnexion" : "hors ligne";
      emettre();
      tentativesWs += 1;
      const delai = Math.min(30000, 1000 * 2 ** Math.min(tentativesWs, 5));
      minuterieReconnexion = setTimeout(() => { if (document.visibilityState === "visible") ouvrirWs(); }, delai);
    };
    socket.onerror = () => { /* onclose suit toujours : la reconnexion est gérée là */ };
  }

  function fermerWs(garderVoulu) {
    wsVoulu = !!garderVoulu && wsVoulu;
    clearTimeout(minuterieReconnexion);
    clearInterval(minuterieBattement);
    if (ws) { const s = ws; ws = null; try { s.close(); } catch { /* déjà fermé */ } }
  }

  // ---------------------------------------------------------------------
  // Bougies (Twelve Data time_series, heures en UTC)
  function parseDateUtc(texte) {
    return Date.parse(texte.length <= 10 ? `${texte}T00:00:00Z` : `${texte.replace(" ", "T")}Z`);
  }

  // Limite du forfait gratuit : 8 requêtes/min pour TOUS les appareils qui
  // partagent la clé. Quand elle est atteinte, plus aucune requête pendant
  // 65 s, et les bougies déjà connues (mémoire ou copie sur l'appareil) restent utilisées.
  let pauseQuotaJusquaMs = 0;
  const CLE_CACHE_BOUGIES = "goldai_bougies_xauusd";

  function estErreurQuota(message) {
    return /api credits|rate limit|too many/i.test(message || "");
  }

  function sauverCacheBougies() {
    try {
      const copie = {};
      Object.entries(bougies).forEach(([tf, b]) => { if (b.liste?.length) copie[tf] = { liste: b.liste, recupereLeMs: b.recupereLeMs }; });
      localStorage.setItem(CLE_CACHE_BOUGIES, JSON.stringify(copie));
    } catch { /* stockage plein ou indisponible */ }
  }

  function chargerCacheBougies() {
    try {
      const copie = JSON.parse(localStorage.getItem(CLE_CACHE_BOUGIES) || "{}");
      Object.entries(copie).forEach(([tf, b]) => {
        // Copie trop vieille (> 1 semaine) : ignorée.
        if (!bougies[tf] && b.liste?.length && Date.now() - b.recupereLeMs < 7 * 86400000) bougies[tf] = { ...b, demandeLeMs: 0, erreur: null };
      });
    } catch { /* ignoré */ }
  }

  async function chargerBougies(intervalle, { forcer = false } = {}) {
    if (!cle) return bougies[intervalle] || null;
    if (Date.now() < pauseQuotaJusquaMs) return bougies[intervalle] || null;
    const b = bougies[intervalle];
    const duree = DUREES[intervalle];
    const maintenant = Date.now();
    if (!forcer && b && b.liste?.length) {
      const derniere = b.liste[b.liste.length - 1];
      const nouvelleClotureAttendue = maintenant >= derniere.debut + duree;
      // Marché fermé : aucune nouvelle bougie ne viendra, on espace fortement.
      const espacement = marcheOuvertSelonHoraire(maintenant) ? 2 * 60000 : 30 * 60000;
      if (!nouvelleClotureAttendue && maintenant - b.recupereLeMs < 15 * 60000) return b;
      if (maintenant - b.recupereLeMs < espacement) return b;
    }
    const demandeLe = maintenant;
    try {
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(SYMBOLE)}&interval=${intervalle}&outputsize=120&timezone=UTC&apikey=${encodeURIComponent(cle)}`;
      const r = await fetch(url, { cache: "no-store" });
      const d = await r.json();
      if (d.status === "error" || !Array.isArray(d.values)) throw new Error(d.message || "réponse inattendue");
      const liste = d.values.map((v) => ({
        debut: parseDateUtc(v.datetime),
        ouverture: Number(v.open), haut: Number(v.high), bas: Number(v.low), cloture: Number(v.close),
      })).sort((a, c) => a.debut - c.debut);
      // Une réponse plus ancienne (demandée avant) n'écrase pas une plus récente.
      if (bougies[intervalle] && bougies[intervalle].demandeLeMs > demandeLe) return bougies[intervalle];
      bougies[intervalle] = { liste, recupereLeMs: Date.now(), demandeLeMs: demandeLe, erreur: null };
      sauverCacheBougies();
    } catch (e) {
      const quota = estErreurQuota(e.message);
      if (quota) pauseQuotaJusquaMs = Date.now() + 65000;
      bougies[intervalle] = {
        ...(b || { liste: [] }),
        erreur: quota ? "limite du fournisseur atteinte (8 requêtes/min, forfait gratuit partagé) — nouvel essai dans 1 min" : e.message,
        recupereLeMs: b?.recupereLeMs || null,
      };
    }
    return bougies[intervalle];
  }

  // Tendances sur bougies CLÔTURÉES uniquement ; la bougie en cours est gardée à part.
  function tendances() {
    const N = window.GoldAI.noyau;
    const maintenant = Date.now();
    const sortie = {};
    Object.keys(DUREES).forEach((tf) => {
      const b = bougies[tf];
      if (!b || !b.liste?.length) { sortie[tf] = { etat: "insuffisant", raison: b?.erreur || "bougies non chargées" }; return; }
      const { cloturees, enCours } = N.separerBougies(b.liste, DUREES[tf], maintenant);
      const t = N.calculerTendance(cloturees);
      const derniereCloture = cloturees.length ? cloturees[cloturees.length - 1].debut + DUREES[tf] : null;
      // Périmée si la dernière bougie clôturée est trop vieille alors que le marché est ouvert.
      const tolerance = tf === "1week" ? 10 * 86400000 : 3 * DUREES[tf];
      const perimee = marcheOuvertSelonHoraire(maintenant) && derniereCloture !== null && maintenant - derniereCloture > tolerance;
      sortie[tf] = { ...t, perimee, bougieEnCours: enCours, derniereClotureMs: derniereCloture, nbCloturees: cloturees.length, erreur: b.erreur };
    });
    return sortie;
  }

  async function actualiserBougies({ forcer = false } = {}) {
    for (const tf of Object.keys(DUREES)) {
      await chargerBougies(tf, { forcer });
    }
    window.dispatchEvent(new CustomEvent("goldai:bougies", { detail: tendances() }));
  }

  // Taux de change pour le calculateur (1 unité de `de` = ? unités de `vers`).
  async function tauxChange(de, vers) {
    if (!cle) throw new Error("fournisseur de cotations non disponible");
    const r = await fetch(`https://api.twelvedata.com/exchange_rate?symbol=${encodeURIComponent(`${de}/${vers}`)}&apikey=${encodeURIComponent(cle)}`, { cache: "no-store" });
    const d = await r.json();
    if (d.status === "error" || !d.rate) throw new Error(d.message || "taux indisponible");
    return { taux: Number(d.rate), horodatageMs: Number(d.timestamp) * 1000, source: FOURNISSEUR };
  }

  // ---------------------------------------------------------------------
  // Repli sans clé : dernier instantané publié par le PC (jamais présenté comme direct).
  function appliquerInstantanePublie() {
    const jeu = window.GoldAI.donnees?.obtenir("marche");
    const or = jeu?.contenu?.actifs?.find((a) => a.cle === "or" && !a.erreur);
    if (!or || !or.horodatage_cotation) return;
    if (or.cloture_precedente) cotation.cloturePrecedente = or.cloture_precedente;
    if (cotation.mode === "aucun" || cotation.mode === "instantané publié") {
      appliquer(Number(or.prix), Date.parse(or.horodatage_cotation), "instantané publié");
    }
  }

  // ---------------------------------------------------------------------
  let dernierReveilMs = 0;
  function surVisibilite() {
    if (!demarre) return;
    // "focus" / "pageshow" / "visibilitychange" peuvent arriver ensemble : une seule relance par minute.
    if (Date.now() - dernierReveilMs < 60000) return;
    if (document.visibilityState === "visible") {
      dernierReveilMs = Date.now();
      requeteQuote();
      if (wsVoulu) ouvrirWs();
      actualiserBougies();
    }
  }

  async function demarrer() {
    if (demarre) return;
    demarre = true;
    window.addEventListener("goldai:donnees", appliquerInstantanePublie);
    appliquerInstantanePublie();

    const { data, error, absente } = await window.GoldAI.utils.rpc("obtenir_cle_cotations", { p_token: window.GoldAI.auth.getToken() });
    if (error || !data) {
      cotation.erreur = absente
        ? "Cotations en direct non installées : exécute le patch Supabase (voir README)."
        : "Clé du fournisseur de cotations indisponible.";
      cotation.mode = cotation.prix !== null ? "instantané publié" : "aucun";
      emettre();
      return;
    }
    cle = data;
    wsVoulu = true;
    chargerCacheBougies();
    await requeteQuote();
    ouvrirWs();
    demarrerRest();
    actualiserBougies();

    clearInterval(minuterieFraicheur);
    // Réévalue la fraîcheur chaque 15 s (un prix devient "ancien" même sans nouvel événement)
    // et recharge les bougies quand une nouvelle bougie a dû se clôturer.
    minuterieFraicheur = setInterval(() => {
      emettre();
      if (document.visibilityState === "visible") actualiserBougies();
    }, 15000);
  }

  function arreter() {
    demarre = false;
    fermerWs(false);
    clearInterval(minuterieRest); minuterieRest = null;
    clearInterval(minuterieFraicheur);
    cle = null;
    Object.assign(cotation, { prix: null, horodatageMs: null, recuLeMs: null, cloturePrecedente: null, mode: "aucun", connexion: "hors ligne", erreur: null });
    Object.keys(bougies).forEach((k) => delete bougies[k]);
    window.removeEventListener("goldai:donnees", appliquerInstantanePublie);
  }

  document.addEventListener("visibilitychange", surVisibilite);
  window.addEventListener("online", () => { if (demarre) { requeteQuote(); if (wsVoulu) ouvrirWs(); } });
  window.addEventListener("offline", () => { cotation.connexion = "hors ligne"; emettre(); });
  // Retour de veille : les minuteries JavaScript sont suspendues pendant la veille ;
  // "pageshow" et "focus" arrivent au réveil.
  window.addEventListener("pageshow", surVisibilite);
  window.addEventListener("focus", surVisibilite);

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.cotations = {
    demarrer, arreter, instantane, tendances, tauxChange,
    bougies: (tf) => [...(bougies[tf]?.liste || [])], actualiserBougies, marcheOuvertSelonHoraire,
    DUREES, FOURNISSEUR, TYPE_PRIX,
    _testAppliquer: appliquer,
  };
})();
