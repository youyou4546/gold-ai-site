// Gold AI — Trade en cours (bouton « J'entre » du calculateur).
//
// - Carte en haut du Calculateur : prix de l'or en direct, gain/perte estimé,
//   SL actuel (qui suit ton plan de Profil › Général) et distance aux TP.
// - Le trade est enregistré sur ton profil (supabase/patch_trade_en_cours.sql) :
//   le PC (site/suivre_trades.py) le surveille chaque minute et t'envoie une
//   notification quand un TP ou le SL est touché, même app fermée.
// - « Clôturer et enregistrer » ouvre la fiche du Journal déjà remplie.
// Calculs : js/noyau.js (slCourant, evaluerTouches, pnlEstime).
// Les montants sont des ESTIMATIONS (prix spot, sans spread ni exécution réelle).
(() => {
  const N = window.GoldAI.noyau;
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const cleLocale = () => `goldai_trade_en_cours_${window.GoldAI.auth.getNom() || "anonyme"}`;

  let courant = null;        // trade suivi (ou null)
  let surServeur = true;     // false si le patch SQL n'est pas installé (suivi sur l'appareil seulement)
  let minuterieSync = null;
  let rendu = null;

  const rpc = (nom, params) => window.GoldAI.auth.client.rpc(nom, { p_token: window.GoldAI.auth.getToken(), ...params });
  const fonctionAbsente = (error) => error && (error.code === "PGRST202" || /could not find the function/i.test(error.message || ""));
  const prixTxt = (p) => (p === null || p === undefined ? "—" : Number(p).toFixed(2));

  // ---------------------------------------------------------------- Stockage

  async function enregistrer(trade) {
    try { if (trade) localStorage.setItem(cleLocale(), JSON.stringify(trade)); else localStorage.removeItem(cleLocale()); } catch { /* ignoré */ }
    const { error } = await rpc("definir_mon_trade_en_cours", { p_contenu: trade });
    surServeur = !error;
    return !error || fonctionAbsente(error) ? { ok: true, local: Boolean(error) } : { ok: false };
  }

  async function charger() {
    const { data, error } = await rpc("obtenir_mon_trade_en_cours", {});
    if (!error) {
      surServeur = true;
      // Garde les TP déjà vus par l'app et ceux vus par le PC.
      if (data && courant && data.id === courant.id) {
        data.touches = [...new Set([...(data.touches || []), ...(courant.touches || [])])];
      }
      courant = data || null;
    } else {
      surServeur = false;
      try { courant = JSON.parse(localStorage.getItem(cleLocale()) || "null"); } catch { courant = null; }
    }
    afficher();
  }

  // ---------------------------------------------------------------- Création

  function construire(signal, r, reglages) {
    const ecartSl = Math.abs(signal.entree - signal.sl);
    return {
      id: crypto.randomUUID?.() || String(Date.now()),
      debutMs: Date.now(),
      derniereVerifMs: Date.now(),
      sens: signal.sens,
      instrument: signal.instrument || "XAUUSD",
      entree: signal.entree,
      sl: signal.sl,
      tps: signal.tps.map((t) => ({ numero: t.numero, prix: t.prix })),
      plan: N.planSlRunner(signal, reglages.slRunner).map((p) => ({ apres: p.apres, sl: p.sl, libelle: p.libelle, bouge: p.bouge })),
      portions: r.portions.map((p) => ({ objectif: p.objectif, type: p.type, prix: p.prix, lot: p.lot })),
      lotTotal: r.lotTotal,
      valeurPoint: r.lotTotal > 0 && ecartSl > 0 ? r.perteTotaleSl / (r.lotTotal * ecartSl) : 0,
      devise: r.devise,
      touches: [],
      slTouche: false,
      statut: "ouvert",
    };
  }

  async function entrer(signal, r, reglages) {
    courant = construire(signal, r, reglages);
    const res = await enregistrer(courant);
    afficher(res.local ? "Suivi sur cet appareil seulement : installe supabase/patch_trade_en_cours.sql pour recevoir les notifications TP / SL." : "");
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function arreter() {
    courant = null;
    await enregistrer(null);
    afficher();
  }

  // ---------------------------------------------------------------- Suivi en direct

  function surCotation() {
    if (!courant || courant.statut !== "ouvert") return;
    const c = window.GoldAI.cotations.instantane();
    if (c.prix === null || !(c.fraicheur === "direct" || c.fraicheur === "retard")) return planifierRendu();
    // Détection sur l'appareil (affichage seulement : les notifications viennent du PC).
    const r = N.evaluerTouches(courant, c.prix, c.prix);
    if (r.nouveauxTps.length || r.slTouche) {
      courant = r.trade;
      try { localStorage.setItem(cleLocale(), JSON.stringify(courant)); } catch { /* ignoré */ }
      if (!surServeur) enregistrer(courant);
    }
    planifierRendu();
  }

  function planifierRendu() {
    if (rendu) return;
    rendu = requestAnimationFrame(() => { rendu = null; afficher(); });
  }

  function afficher(message = "") {
    const zone = $("carte-trade-en-cours");
    if (!zone) return;
    if (!courant) { zone.classList.add("hidden"); zone.innerHTML = ""; return; }
    const c = window.GoldAI.cotations.instantane();
    const prixOk = c.prix !== null && (c.fraicheur === "direct" || c.fraicheur === "retard");
    const vente = courant.sens === "SELL";
    const pnl = prixOk ? N.pnlEstime(courant, c.prix) : null;
    const sl = N.slCourant(courant);
    const distance = (niveau) => (prixOk ? Math.abs(c.prix - niveau).toFixed(2) : "—");
    const m = (v) => U.montant(v, courant.devise || "USD", { signe: true });
    const etat = { ouvert: ["", "En cours"], sl: ["rouge", "SL touché"], termine: ["vert", "Dernier TP touché"], expire: ["", "Suivi arrêté (6 h)"] }[courant.statut] || ["", courant.statut];

    zone.className = `carte carte-trade-en-cours ${etat[0]}`;
    zone.innerHTML = `
      <div class="entete-trade-en-cours">
        <span><strong>${vente ? "🔻 Vente" : "🔺 Achat"} or</strong> · entrée ${prixTxt(courant.entree)} · ${U.nombre(courant.lotTotal, 2)} lot</span>
        <span class="statut-trade">${etat[1]}</span>
      </div>
      <div class="chiffres-trade">
        <div><span class="lib">Prix actuel</span><span class="val">${prixOk ? prixTxt(c.prix) : "—"}</span></div>
        <div><span class="lib">Gain / perte estimé</span><span class="val ${pnl > 0 ? "positif" : pnl < 0 ? "negatif" : ""}">${pnl === null ? "—" : m(pnl)}</span></div>
      </div>
      <ul class="niveaux-trade">
        <li class="niveau-sl${courant.slTouche ? " touche" : ""}"><span>🛑 SL ${sl !== courant.sl ? "(déplacé)" : ""}</span><span>${prixTxt(sl)}</span><span class="dist">${courant.slTouche ? "touché" : `à ${distance(sl)}`}</span></li>
        ${courant.tps.map((tp) => {
          const nom = `TP${tp.numero}`;
          const fait = (courant.touches || []).includes(nom);
          const plan = (courant.plan || []).find((p) => p.apres === nom);
          return `<li class="${fait ? "touche" : ""}"><span>${fait ? "✅" : "🎯"} ${nom}</span><span>${prixTxt(tp.prix)}</span><span class="dist">${fait ? `SL → ${prixTxt(plan?.sl)}` : `à ${distance(tp.prix)}`}</span></li>`;
        }).join("")}
      </ul>
      ${!prixOk ? `<p class="texte-attenue petit">Prix en direct indisponible (${esc(c.fraicheur)}) : distances et estimation en pause.</p>` : ""}
      ${message ? `<p class="alerte-donnees">${esc(message)}</p>` : !surServeur ? `<p class="texte-attenue petit">Suivi sur cet appareil seulement (pas de notification app fermée).</p>` : `<p class="texte-attenue petit">🔔 Notification sur ton téléphone quand un TP ou le SL est touché (PC allumé).</p>`}
      <div class="actions-trade">
        <button type="button" class="bouton" id="trade-cloturer">Clôturer et enregistrer</button>
        <button type="button" class="bouton secondaire bouton-petit" id="trade-arreter">Arrêter le suivi</button>
      </div>
      <div class="confirmation-arret hidden" id="confirmation-arret">
        <span>Arrêter le suivi sans enregistrer de trade ?</span>
        <div class="boutons-confirmation">
          <button type="button" class="bouton secondaire bouton-petit" data-action="non">Non</button>
          <button type="button" class="bouton danger bouton-petit" data-action="oui">Oui, arrêter</button>
        </div>
      </div>`;
  }

  function cloturer() {
    const c = window.GoldAI.cotations.instantane();
    const prixOk = c.prix !== null && (c.fraicheur === "direct" || c.fraicheur === "retard");
    const t = courant;
    const note = `${t.sens === "SELL" ? "Vente" : "Achat"} · entrée ${prixTxt(t.entree)} · SL ${prixTxt(t.sl)} · ${t.tps.map((x) => `TP${x.numero} ${prixTxt(x.prix)}`).join(" · ")}${(t.touches || []).length ? ` · touchés : ${t.touches.join(", ")}` : ""}\n`;
    const aujourdhui = window.GoldAI.gardeFou?.cleAujourdhui?.() || U.cleJour(Date.now());
    window.GoldAI.ficheTrade.ouvrir(null, aujourdhui, {
      prixEntree: t.entree,
      prixSortie: prixOk ? Number(c.prix.toFixed(2)) : null,
      resultat: prixOk ? N.pnlEstime(t, c.prix) : null,
      note,
    }, async () => { if (courant?.id === t.id) await arreter(); });
  }

  // ---------------------------------------------------------------- Cycle de vie

  function demarrer() {
    charger();
    clearInterval(minuterieSync);
    // Récupère les TP / SL détectés par le PC, toutes les minutes.
    minuterieSync = setInterval(() => { if (courant && !document.hidden) charger(); }, 60000);
  }

  function viderCache() {
    courant = null;
    clearInterval(minuterieSync);
    afficher();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("carte-trade-en-cours")?.addEventListener("click", (e) => {
      const id = e.target.id || e.target.dataset.action;
      if (id === "trade-cloturer") cloturer();
      else if (id === "trade-arreter") $("confirmation-arret").classList.remove("hidden");
      else if (id === "non") $("confirmation-arret").classList.add("hidden");
      else if (id === "oui") arreter();
    });
  });
  window.addEventListener("goldai:cotation", surCotation);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && courant) charger(); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.tradeEnCours = { demarrer, viderCache, entrer, cloturer, actif: () => courant };
})();
