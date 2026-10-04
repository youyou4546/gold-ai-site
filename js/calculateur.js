// Gold AI — section Calculateur : colle un signal, obtiens la taille de position.
//
// Le texte est lu par js/noyau.js (lireSignal), le calcul fait par
// calculerPosition avec les paramètres de Profil › Général. Le signal
// interprété est masqué, sauf quand une valeur est ambiguë ou manquante :
// il apparaît alors pour être corrigé sur place. Aucun ordre n'est envoyé nulle part : c'est un
// calcul affiché à l'écran, rien de plus.
(() => {
  const { esc, montant, nombre } = window.GoldAI.utils;
  const N = window.GoldAI.noyau;

  let signalCourant = null;     // signal (éventuellement corrigé à la main)
  let lectureCourante = null;   // résultat brut de lireSignal (ambiguïtés, lignes ignorées)
  let repartitionForcee = null; // répartition au prorata choisie pour CE calcul uniquement
  let taux = null;              // { taux, horodatageMs, source, manuel }
  let dernierCalcul = null;     // { r, reglages, signal } du dernier calcul réussi
  // Règle « arrêt après le premier trade gagnant » (Profil › Général) :
  let calculConfirme = false;     // « Continuer quand même » choisi pour le signal en cours
  let avertissementGain = null;   // { depuisTexte } tant que l'avertissement attend une réponse
  let texteCalcule = null;        // signal collé déjà calculé : reste dans le champ, effacé au prochain toucher

  // Le dernier calcul reste affiché (même après avoir changé d'onglet, fermé ou
  // rechargé l'app) jusqu'au bouton « Retour » en bas du calculateur : il est
  // mémorisé sur cet appareil, pour la personne connectée.
  const cleMemoire = () => `goldai_dernier_calcul_${window.GoldAI.auth?.getNom?.() || "anonyme"}`;
  function memoriserCalcul() {
    try {
      localStorage.setItem(cleMemoire(), JSON.stringify({ signal: signalCourant, lecture: lectureCourante, repartitionForcee, taux, texte: texteCalcule }));
    } catch { /* stockage indisponible : le calcul reste affiché tant que l'app est ouverte */ }
  }
  function lireCalculMemorise() {
    try { return JSON.parse(localStorage.getItem(cleMemoire()) || "null"); } catch { return null; }
  }
  function oublierCalcul() {
    try { localStorage.removeItem(cleMemoire()); } catch { /* ignoré */ }
  }

  function champ(id, label, valeur, { type = "number", manquant = false, options = null } = {}) {
    const classe = manquant ? "champ a-preciser" : "champ";
    if (options) {
      return `<div class="${classe}"><label for="${id}">${label}${manquant ? " — à préciser" : ""}</label>
        <select id="${id}"><option value="">—</option>${options.map((o) => `<option ${o === valeur ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
    }
    return `<div class="${classe}"><label for="${id}">${label}${manquant ? " — à préciser" : ""}</label>
      <input id="${id}" type="${type}" ${type === "number" ? 'inputmode="decimal" step="any"' : ""} value="${valeur ?? ""}" /></div>`;
  }

  function afficherSignalEditable(s, lecture) {
    const manque = (c) => lecture.aPreciser.includes(c) || lecture.ambiguites.some((a) => a.champ === c);
    const tps = s.tps.length ? s.tps : [{ numero: 1, prix: null }];
    return `
      <div class="carte bloc-signal">
        <h3 class="titre-bloc">Signal interprété <span class="aide-inline">vérifie et corrige si besoin</span></h3>
        ${lecture.ambiguites.map((a) => `
          <div class="alerte-donnees">${esc(a.message)}
            ${a.options ? `<div class="choix-ambiguite">${a.options.map((o) => `<button type="button" class="puce-choix" data-champ="${esc(a.champ)}" data-valeur="${esc(o)}">${esc(o)}</button>`).join("")}</div>` : ""}
          </div>`).join("")}
        <div class="ligne-champs">
          ${champ("sig-instrument", "Instrument", s.instrument, { type: "text", manquant: manque("instrument") })}
          ${champ("sig-sens", "Sens", s.sens, { manquant: manque("sens"), options: ["BUY", "SELL"] })}
        </div>
        <div class="ligne-champs">
          ${champ("sig-entree", "Entrée", s.entree, { manquant: manque("entree") })}
          ${champ("sig-sl", "Stop-loss (SL)", s.sl, { manquant: manque("sl") })}
        </div>
        <div id="sig-liste-tps" class="grille-tps">
          ${tps.map((t, i) => champ(`sig-tp-${i}`, `TP${t.numero ?? i + 1}`, t.prix, { manquant: manque("tps") && t.prix === null })).join("")}
        </div>
        <div class="ligne-actions">
          <button type="button" class="bouton secondaire bouton-petit" id="sig-ajouter-tp">+ TP</button>
          <label class="case-a-cocher"><input type="checkbox" id="sig-tp-ouvert" ${s.tpOuverts ? "checked" : ""}/> Le signal a un TP runner (TP sans chiffre)</label>
        </div>
        ${lecture.lignesIgnorees.length ? `<details class="details-discrets"><summary>${lecture.lignesIgnorees.length} ligne(s) ignorée(s) (commentaires)</summary><ul>${lecture.lignesIgnorees.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>` : ""}
      </div>`;
  }

  function lireSignalEditable() {
    const v = (id) => document.getElementById(id)?.value.trim() ?? "";
    const num = (id) => { const x = v(id); return x === "" ? null : N.versNombre(x); };
    const tps = [...document.querySelectorAll("#sig-liste-tps input")]
      .map((c, i) => ({ numero: i + 1, prix: c.value.trim() === "" ? null : N.versNombre(c.value) }))
      .filter((t) => t.prix !== null);
    return {
      instrument: v("sig-instrument").toUpperCase().replace(/[^A-Z0-9]/g, "") || null,
      sens: v("sig-sens") || null,
      entree: num("sig-entree"),
      sl: num("sig-sl"),
      tps,
      tpOuverts: document.getElementById("sig-tp-ouvert")?.checked ? 1 : 0,
    };
  }

  function carteChiffre(label, valeur, sous = "", classe = "") {
    return `<div class="carte-stat ${classe}"><div class="label-stat">${label}</div><div class="valeur-stat">${valeur}</div>${sous ? `<div class="sous-valeur-stat">${sous}</div>` : ""}</div>`;
  }

  const prixAffiche = (p) => nombre(p, Math.max(2, (String(p).split(".")[1] || "").length));

  // Plan du SL de la portion « TP ouvert » selon les paliers de Profil › Général.
  function afficherPlanSlRunner(signal, reglages) {
    const plan = N.planSlRunner(signal, reglages.slRunner);
    if (!plan.length) return "";
    return `
      <div class="carte">
        <h3 class="titre-bloc">SL du TP runner</h3>
        <ul class="liste-plan-sl">${plan.map((p) => `
          <li><strong>${esc(p.apres)} touché</strong> → SL à <strong>${prixAffiche(p.sl)}</strong> <span class="texte-attenue">${esc(p.libelle)}</span></li>`).join("")}
        </ul>
      </div>`;
  }

  // Bouton « Retour » en bas du calculateur : SEUL moyen de remettre le calculateur à zéro.
  const boutonRetour = `<button type="button" class="bouton-retour bouton-retour-calcul" id="calc-retour"><span aria-hidden="true">←</span> Retour (nouveau calcul)</button>`;

  // Encadré « Total » sous le détail : risque total au SL, gain total si tous les TP sont touchés.
  function afficherTotal(r) {
    const d = r.devise;
    const runner = r.portions.some((p) => p.type === "ouvert");
    return `
      <div class="carte encadre-total-calcul">
        <h3 class="titre-bloc">Total</h3>
        <div class="ligne-total-calcul">
          <span>Risque total si le SL est touché</span>
          <strong class="negatif">▼ ${montant(r.perteTotaleSl, d)}</strong>
        </div>
        <div class="ligne-total-calcul">
          <span>Gain total si tous les TP sont touchés</span>
          <strong class="positif">▲ ${montant(r.gainTotalSiTousTps, d)}</strong>
        </div>
        ${runner ? `<p class="texte-attenue petit">+ le gain du TP runner, qui n'a pas de prix fixe (il laisse courir) : il n'est pas compté dans ce total.</p>` : ""}
      </div>`;
  }

  function ligneEssTous(ctx, gainTp1, risque, gainTous) {
    if (!ctx) return "";
    const t = N.essDuTrade({ trades: ctx.tradesCompte, aujourdhui: ctx.aujourdhui, seuil: ctx.seuil, gainTp1, risque, gainTous }).siTous;
    return `<p class="petit">ESS requis : ≤ ${nombre(t.seuil, 0)} % · si tous les TP sont touchés : <strong class="${t.calculable ? (t.eligible ? "positif" : "negatif") : ""}">${t.calculable ? `${nombre(t.ess, 2)} % ${t.eligible ? "✅" : "❌"}` : "—"}</strong></p>`;
  }

  function afficherResultat(r, reglages, spec, ctx = null) {
    const d = r.devise;
    const lignes = r.portions.map((p) => `
      <tr>
        <th scope="row">${esc(p.objectif)}</th>
        <td>${p.prix === null ? "<span class=\"texte-attenue\">sans prix</span>" : prixAffiche(p.prix)}</td>
        <td>${nombre(p.pctConfigure, 0)} %${!p.limiteEss && Math.abs(p.pctReel - p.pctConfigure) >= 0.5 ? `<br><span class="texte-attenue">réel ${nombre(p.pctReel, 1)} %</span>` : ""}</td>
        <td><strong>${nombre(p.lot, 2)}</strong>${p.limiteEss ? `<br><span class="texte-attenue">coupé ESS</span>` : ""}</td>
        <td class="positif">${p.type === "ouvert" ? (p.limiteEss ? "—" : "<span class=\"texte-attenue\">laisse courir</span>") : p.gainAuTp === null ? "<span class=\"texte-attenue\">non calculable</span>" : p.limiteEss && !(p.lot > 0) ? "—" : `▲ ${montant(p.gainAuTp, d)}`}</td>
      </tr>`).join("");

    return `
      <div class="grille-stats-perf">
        ${r.modeLot === "objectif" ? carteChiffre("Objectif restant", montant(r.objectifRestant, d)) : carteChiffre("Risque demandé", montant(r.risqueDemande, d))}
        ${carteChiffre("Lot utilisé", `${nombre(r.lotTotal, 2)} lot`, "", "carte-mise-en-avant")}
      </div>

      <div class="carte">
        <h3 class="titre-bloc">Répartition des objectifs</h3>
        <div class="tableau-defilant">
          <table class="tableau-portions compact">
            <thead><tr><th scope="col">Obj.</th><th scope="col">Prix</th><th scope="col">%</th><th scope="col">Lot</th><th scope="col">Résultat</th></tr></thead>
            <tbody>${lignes}
              <tr class="ligne-sl">
                <th scope="row">SL</th>
                <td>${prixAffiche(signalCourant.sl)}</td>
                <td>100 %</td>
                <td><strong>${nombre(r.lotTotal, 2)}</strong></td>
                <td class="negatif">▼ ${montant(r.perteTotaleSl, d)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${r.modeLot === "objectif" ? ligneEssTous(ctx, r.portions.find((p) => p.type === "tp")?.gainAuTp || 0, r.perteTotaleSl, r.gainTotalSiTousTps) : ""}
      </div>

      ${afficherTotal(r)}

      ${r.contientTpOuvert ? afficherPlanSlRunner(signalCourant, reglages) : ""}

      ${r.avertissements.length ? `<div class="carte">${r.avertissements.map((a) => `<div class="alerte-donnees">${esc(a)}</div>`).join("")}</div>` : ""}

      ${r.tauxConversion !== 1 && taux ? `<p class="note-source">Conversion ${esc(spec.deviseProfit)} → ${esc(d)} au taux ${taux.taux} (${taux.manuel ? "saisi manuellement" : `${esc(taux.source)}, ${window.GoldAI.utils.jourHeure(taux.horodatageMs)}`}).</p>` : ""}

      ${boutonRetour}`;
  }

  // ---------------------------------------------------------------- Objectif du jour + ESS
  // Contexte lu dans les réglages et le Journal : objectif (Profil › Général), compte
  // maître (Mes comptes TradeLocker), seuil ESS, trades du compte. null si indisponible
  // (le lot est alors calculé selon le risque, comme avant).
  // Contexte lu dans les réglages et le Journal : compte maître (Mes comptes TradeLocker),
  // résultat déjà fait aujourd'hui sur ce compte, trades du compte pour l'ESS, seuil ESS.
  // null si le Journal est illisible (le lot est alors calculé selon le risque, comme avant).
  async function contexteObjectif(reglages) {
    try {
      const J = window.GoldAI.journal;
      if (!J) return null;
      const trades = Object.values((await J.chargerTousLesTrades()) || {}).flat();
      const aujourdhui = window.GoldAI.gardeFou?.cleAujourdhui?.() || window.GoldAI.utils.cleJour(Date.now());
      const compte = reglages.compteMaitre || "";
      const duCompte = trades.filter((t) => !compte || t.compteTl === compte);
      const profitJour = Math.round(duCompte.filter((t) => t.date === aujourdhui).reduce((s, t) => s + Number(t.resultat) - (Number(t.frais) || 0), 0) * 100) / 100;
      const st = (reglages.statutsComptes || {})[compte] || {};
      const depuis = st.statut === "finance" ? st.depuis : null;
      // Objectif : le même que la barre du haut (Profil › Général › 🎯 Objectif de profit),
      // compte maître seulement, sur sa période (jour / semaine / mois).
      const p = N.progressionObjectif(trades, { ...(reglages.objectif || {}), compteId: "", compteTl: compte }, aujourdhui);
      return {
        compte, aujourdhui, profitJour, seuil: reglages.seuilEss,
        objectif: p.montant, periode: p.periode || "jour", realise: p.realise,
        objectifRestant: Math.max(0, Math.round((p.montant - p.realise) * 100) / 100),
        tradesCompte: duCompte.filter((t) => !depuis || t.date >= depuis),
        nomCompte: compte ? (reglages.surnomsComptes?.[compte] || trades.find((t) => t.compteTl === compte)?.compteTlNom || "compte maître") : "tous les comptes",
      };
    } catch { return null; }
  }

  // Switch ESS (Journal › ESS) : la journée ne dépasse pas l'objectif quotidien, pour que
  // toutes les journées gagnantes se ressemblent (c'est ce qui fait passer l'ESS).
  // Renvoie le gain maximal de CE trade (objectif − déjà fait aujourd'hui), ou null.
  function plafondEss(reglages, ctx) {
    if (!reglages.essDansCalcul) return null;
    return ctx.objectifRestant;
  }

  const LIBELLE_PERIODE = { jour: "du jour", semaine: "de la semaine", mois: "du mois" };
  function afficherObjectifAtteint(r, ctx) {
    return `
      <div class="carte encadre-total-calcul">
        <h3 class="titre-bloc">🎯 Objectif ${LIBELLE_PERIODE[ctx.periode] || "du jour"} atteint</h3>
        <p>Déjà <strong class="positif">${montant(r.profitJour, "USD")}</strong> sur ${montant(r.objectif, "USD")} (${esc(ctx.nomCompte)}) : pas de lot proposé.</p>
      </div>${boutonRetour}`;
  }

  // Résultat « lots par TP » (une position par TP), présenté comme l'ancien calcul :
  // tableau des objectifs + ligne SL, une ligne ESS, encadré Total.
  function afficherLotsParTp(r, reglages, ctx) {
    const d = r.devise;
    const lot = (x) => `${nombre(x, r.decimalesLot)}`;
    const lignes = r.lignes.map((l) => `
      <tr>
        <th scope="row">TP${l.numero}</th>
        <td>${prixAffiche(l.prix)}</td>
        <td><strong>${lot(l.lot)}</strong>${l.sousMin ? `<br><span class="texte-attenue">sous le min.</span>` : l.limiteEss ? `<br><span class="texte-attenue">limite ESS</span>` : l.plafonne ? `<br><span class="texte-attenue">plafond</span>` : ""}</td>
        <td class="positif">${l.gain > 0 ? `▲ ${montant(l.gain, d)}` : "—"}</td>
      </tr>`).join("");

    const ligneEss = ligneEssTous(ctx, r.gainTp1, r.risqueAvantTp1, r.cumulTotal);
    const avertissements = r.avertissements.filter((a) => !a.startsWith("Plafond") && !a.startsWith("TP runner"));

    return `
      <div class="grille-stats-perf">
        ${carteChiffre("Objectif restant", montant(r.objectifRestant, d))}
        ${carteChiffre("Lot utilisé", `${lot(r.lotTotal)} lot`, "", "carte-mise-en-avant")}
      </div>

      <div class="carte">
        <h3 class="titre-bloc">Répartition des objectifs</h3>
        <div class="tableau-defilant">
          <table class="tableau-portions compact">
            <thead><tr><th scope="col">Obj.</th><th scope="col">Prix</th><th scope="col">Lot</th><th scope="col">Résultat</th></tr></thead>
            <tbody>${lignes}
              <tr class="ligne-sl">
                <th scope="row">SL</th>
                <td>${prixAffiche(signalCourant.sl)}</td>
                <td><strong>${lot(r.lotTotal)}</strong></td>
                <td class="negatif">▼ ${montant(r.risqueAvantTp1, d)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${ligneEss}
        <button type="button" class="bouton secondaire bouton-petit" id="calc-copier-lots">📋 Copier les lots</button>
        <p class="texte-attenue petit" id="calc-copie-message" aria-live="polite"></p>
      </div>

      <div class="carte encadre-total-calcul">
        <h3 class="titre-bloc">Total</h3>
        <div class="ligne-total-calcul">
          <span>Risque total si le SL est touché</span>
          <strong class="negatif">▼ ${montant(r.risqueAvantTp1, d)}</strong>
        </div>
        <div class="ligne-total-calcul">
          <span>Gain total si tous les TP sont touchés</span>
          <strong class="positif">▲ ${montant(r.cumulTotal, d)}</strong>
        </div>
        ${r.slEntreeApresTp1 ? `<p class="texte-attenue petit">Après TP1 : SL à l'entrée, plus de risque.</p>` : ""}
      </div>

      ${avertissements.length ? `<div class="carte">${avertissements.map((a) => `<div class="alerte-donnees">${esc(a)}</div>`).join("")}</div>` : ""}

      ${boutonRetour}`;
  }

  // Texte copié par « Copier les lots » : une ligne par TP.
  function texteLots(r, signal) {
    return [`${signal.instrument} ${signal.sens} ${signal.entree} — SL ${signal.sl}`]
      .concat(r.lignes.map((l) => `TP${l.numero} ${l.prix} : ${nombre(l.lot, r.decimalesLot)} lot`))
      .concat([`Total : ${nombre(r.lotTotal, r.decimalesLot)} lot`]).join("\n");
  }

  function afficherBlocage(r, reglages, spec) {
    let html = "";
    if (r.aConfigurer.length) {
      html += `<div class="carte alerte-bloc"><h3 class="titre-bloc">À configurer avant de calculer</h3><ul>${r.aConfigurer.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
        <button type="button" class="bouton secondaire bouton-petit" id="aller-general">Ouvrir Profil › Général</button></div>`;
      const besoinTaux = r.aConfigurer.some((a) => a.startsWith("Taux de conversion"));
      if (besoinTaux && spec) {
        html += `<div class="carte"><div class="champ"><label for="calc-taux">1 ${esc(spec.deviseProfit)} = ? ${esc(reglages.devise)}</label>
          <input id="calc-taux" type="number" inputmode="decimal" step="any" value="${taux?.manuel ? taux.taux : ""}" /></div>
          <button type="button" class="bouton secondaire bouton-petit" id="calc-recuperer-taux">Récupérer le taux actuel (Twelve Data)</button>
          <p class="aide">Le taux saisi ou récupéré est affiché avec le résultat.</p></div>`;
      }
    }
    if (r.erreurs.length) {
      html += `<div class="carte alerte-bloc"><h3 class="titre-bloc">Calcul impossible</h3><ul>${r.erreurs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        ${r.choixRepartition ? `<button type="button" class="bouton secondaire bouton-petit" id="calc-prorata">Répartir au prorata sur les TP chiffrés (ce calcul seulement)</button>` : ""}</div>`;
    }
    if (r.avertissements.length) html += `<div class="carte">${r.avertissements.map((a) => `<div class="alerte-donnees">${esc(a)}</div>`).join("")}</div>`;
    return html + boutonRetour;
  }

  // Avertissement (pas un blocage) si un trade gagnant est déjà enregistré aujourd'hui
  // et que l'option est activée (activée par défaut).
  async function doitAvertirApresGain() {
    const reglages = await window.GoldAI.reglagesCalculateur.charger();
    if (reglages.arretPremierGain === false) return false;
    return (await window.GoldAI.gardeFou?.gainDejaFaitAujourdhui?.()) || false;
  }

  function afficherAvertissementGain(depuisTexte) {
    avertissementGain = { depuisTexte };
    dernierCalcul = null;
    const zoneSignal = document.getElementById("zone-signal-interprete");
    zoneSignal.innerHTML = "";
    zoneSignal.classList.add("hidden");
    window.GoldAI.discipline?.masquer();
    document.getElementById("zone-resultat-calcul").innerHTML = `
      <div class="carte avertissement-gain" role="alertdialog" aria-labelledby="titre-avertissement-gain">
        <div class="icone-blocage" aria-hidden="true">🏆</div>
        <p id="titre-avertissement-gain"><strong>Tu as déjà un trade gagnant aujourd'hui. Es-tu sûr de vouloir continuer ?</strong></p>
        <div class="boutons-confirmation">
          <button type="button" class="bouton secondaire" id="gain-annuler">Annuler</button>
          <button type="button" class="bouton" id="gain-continuer">Continuer quand même</button>
        </div>
      </div>`;
    document.getElementById("gain-annuler").focus();
  }

  // Perte au SL comparée à la marge avant rupture de chaque compte TradeLocker
  // (règles de Journal › Performance). Affiché en haut du résultat, sans bloquer.
  async function verifierMarges(r) {
    const calcul = dernierCalcul;
    let marges = [], jour = [];
    try { marges = (await window.GoldAI.challenge?.margesComptes?.()) || []; } catch { /* pas de règles */ }
    try { jour = (await window.GoldAI.gardeFou?.margesJour?.()) || []; } catch { /* pas de règles */ }
    if (calcul !== dernierCalcul || !r.ok || !(r.perteTotaleSl > 0)) return; // un autre calcul a pris la place
    const lignes = [];
    // Lot réduit qui tient dans la marge restante (arrondi vers le bas au pas du courtier).
    const spec = calcul?.reglages?.instruments?.[calcul?.signal?.instrument];
    const perteParLot = r.lotTotal > 0 ? r.perteTotaleSl / r.lotTotal : 0;
    const lotReduit = (reste) => {
      if (r.modeLot === "parTp") {
        if (!(reste > 0)) return "";
        const red = N.reduireLotsParTp(r, reste);
        return red.possible
          ? ` Lots réduits proposés : <strong>${red.lots.map((x, i) => `TP${r.lignes[i].numero} ${nombre(x, r.decimalesLot)}`).join(" · ")}</strong> (total ${nombre(red.lotTotal, r.decimalesLot)} lot, perte au SL ≈ ${montant(red.risque, r.devise)}).`
          : " Aucun lot possible : même le lot minimum dépasserait la limite.";
      }
      if (!spec || !(perteParLot > 0) || !(reste > 0)) return "";
      const pas = Number(spec.pasLot);
      let lot = Math.floor(reste / perteParLot / pas + 1e-9) * pas;
      if (lot * perteParLot >= reste) lot -= pas; // strictement sous la limite
      lot = Math.round(lot / pas) * pas;
      return lot >= Number(spec.lotMin)
        ? ` Lot réduit proposé : <strong>${nombre(lot, 2)} lot</strong> (perte au SL ≈ ${montant(lot * perteParLot, r.devise)}).`
        : " Aucun lot possible : même le lot minimum dépasserait la limite.";
    };
    // Perte max par jour (Performance › ⚙️ Règles) : ce trade au SL la dépasserait-il ?
    for (const j of jour) {
      if (j.reste <= 0) lignes.push(["rouge", `⛔ <strong>${esc(j.nom)}</strong> : perte max du jour déjà atteinte.`]);
      else if (r.perteTotaleSl >= j.reste) lignes.push(["rouge", `⛔ Au SL, ce trade dépasse la perte max du jour de <strong>${esc(j.nom)}</strong> : perte ${montant(r.perteTotaleSl, r.devise)}, il ne reste que ${montant(j.reste, r.devise)} aujourd'hui.${lotReduit(j.reste)}`]);
      else if (r.perteTotaleSl >= 0.5 * j.reste) lignes.push(["orange", `⚠️ Sur <strong>${esc(j.nom)}</strong>, ce trade utilise ${nombre((r.perteTotaleSl / j.reste) * 100, 0)} % de ce qui reste de ta perte max du jour (${montant(j.reste, r.devise)}).`]);
    }
    for (const m of marges) {
      if (m.devise !== r.devise) continue;
      const marge = m.etat.perte.marge;
      if (marge <= 0) lignes.push(["rouge", `⛔ <strong>${esc(m.nom)}</strong> : la perte max est déjà atteinte.`]);
      else if (r.perteTotaleSl >= marge) lignes.push(["rouge", `⛔ Ce trade peut faire sauter <strong>${esc(m.nom)}</strong> : perte au SL ${montant(r.perteTotaleSl, r.devise)}, il ne reste que ${montant(marge, r.devise)} avant le niveau de rupture.${lotReduit(marge)}`]);
      else if (r.perteTotaleSl >= 0.5 * marge) lignes.push(["orange", `⚠️ Sur <strong>${esc(m.nom)}</strong>, ce trade utilise ${nombre((r.perteTotaleSl / marge) * 100, 0)} % de ta marge avant rupture (${montant(marge, r.devise)}).`]);
    }
    const zone = document.getElementById("zone-resultat-calcul");
    zone.querySelector("#alerte-marges")?.remove();
    if (!lignes.length) return;
    zone.insertAdjacentHTML("afterbegin", `<div class="carte alerte-marges ${lignes.some((l) => l[0] === "rouge") ? "rouge" : "orange"}" id="alerte-marges">
      ${lignes.map((l) => `<p>${l[1]}</p>`).join("")}
      <p class="texte-attenue petit">Calculé avec le solde TradeLocker, les trades du jour du journal et les règles de Journal › Performance (lot de ce calcul).</p></div>`);
  }

  async function calculer({ depuisTexte, confirme = false }) {
    const zoneSignal = document.getElementById("zone-signal-interprete");
    const zoneResultat = document.getElementById("zone-resultat-calcul");

    // Garde-fou : règle du jour atteinte → pas de calcul (« Journée terminée »).
    if (window.GoldAI.gardeFou && !(await window.GoldAI.gardeFou.calculAutorise())) return;

    // Arrêt après le premier trade gagnant : chaque nouveau calcul redemande
    // confirmation ; les corrections du même signal, non.
    if (confirme) calculConfirme = true;
    else if (depuisTexte) calculConfirme = false;
    if (avertissementGain && !confirme && !depuisTexte) return; // on attend la réponse
    // « Calculer » retouché sans changer le signal resté dans le champ : le calcul affiché reste.
    if (depuisTexte && !confirme && signalCourant && texteCalcule !== null && document.getElementById("champ-signal").value === texteCalcule) return;
    avertissementGain = null;
    if (!calculConfirme && (await doitAvertirApresGain())) {
      if (depuisTexte && !document.getElementById("champ-signal").value.trim()) {
        zoneSignal.innerHTML = "";
        zoneResultat.innerHTML = `<p class="etat-vide">Colle d'abord un signal dans le champ ci-dessus.</p>`;
        return;
      }
      afficherAvertissementGain(depuisTexte);
      return;
    }
    window.GoldAI.gardeFou?.afficherAlerteAnnonce();

    if (depuisTexte) {
      const texte = document.getElementById("champ-signal").value;
      if (!texte.trim()) {
        // Un calcul est affiché : on le garde (seul « Retour » l'efface).
        if (signalCourant) { document.getElementById("champ-signal").focus(); return; }
        zoneSignal.innerHTML = "";
        zoneResultat.innerHTML = `<p class="etat-vide">Colle d'abord un signal dans le champ ci-dessus.</p>`;
        return;
      }
      lectureCourante = N.lireSignal(texte);
      // Le signal collé reste visible dans le champ ; il s'efface quand on
      // touche de nouveau le champ (pour coller le trade suivant).
      texteCalcule = texte;
      document.getElementById("champ-signal").blur();
      signalCourant = { instrument: lectureCourante.instrument, sens: lectureCourante.sens, entree: lectureCourante.entree, sl: lectureCourante.sl, tps: lectureCourante.tps, tpOuverts: lectureCourante.tpOuverts };
      repartitionForcee = null;
      // Le signal interprété reste construit (le calcul le relit) mais n'est
      // montré que si le texte n'a pas pu être lu entièrement.
      zoneSignal.innerHTML = afficherSignalEditable(signalCourant, lectureCourante);
      const aCorriger = lectureCourante.ambiguites.length > 0 || lectureCourante.aPreciser.length > 0;
      zoneSignal.classList.toggle("hidden", !aCorriger);
    } else {
      signalCourant = lireSignalEditable();
    }

    zoneResultat.innerHTML = `<p class="etat-vide">Calcul…</p>`;
    const reglagesBase = await window.GoldAI.reglagesCalculateur.charger();
    // Répartition au prorata forcée : elle remplace les deux groupes (4 TP et 3 TP).
    const reglages = repartitionForcee ? { ...reglagesBase, repartition: repartitionForcee, repartition3: null } : reglagesBase;
    const spec = reglages.instruments?.[signalCourant.instrument];

    // Taux de conversion : seulement si la devise des gains diffère de celle du compte.
    let tauxUtilise = null;
    if (spec && spec.deviseProfit && spec.deviseProfit !== reglages.devise) {
      const saisi = document.getElementById("calc-taux")?.value;
      if (saisi && Number(saisi) > 0) taux = { taux: Number(saisi), manuel: true };
      tauxUtilise = taux?.taux ?? null;
    }

    // Lots par TP (réglages « Lots par TP » du compte maître) ; sans Journal lisible :
    // ancien calcul selon le risque et la répartition.
    const ctx = await contexteObjectif(reglages);
    // La part TP1 de la répartition rapporte l'objectif restant, le lot total est partagé selon
    // la répartition. Switch ESS (Journal › ESS) ON : les lots sont coupés à partir du TP2 pour
    // que la journée ne batte pas la plus grosse journée gagnante.
    let r;
    if (!ctx) r = N.calculerPosition(signalCourant, reglages, tauxUtilise);
    else {
      r = N.calculerPosition(signalCourant, reglages, tauxUtilise, {
        objectifRestant: ctx.objectifRestant,
        plafondEss: plafondEss(reglages, ctx),
      });
      if (r.objectifAtteint) Object.assign(r, { objectif: ctx.objectif, profitJour: ctx.realise });
    }
    dernierCalcul = r.ok ? { r, reglages, signal: { ...signalCourant } } : null;
    zoneResultat.innerHTML = r.ok ? (r.modeLot === "parTp" ? afficherLotsParTp(r, reglages, ctx) : afficherResultat(r, reglages, spec, ctx))
      : r.objectifAtteint ? afficherObjectifAtteint(r, ctx) : afficherBlocage(r, reglages, spec);
    memoriserCalcul();
    if (r.ok) verifierMarges(r);
    // Trades restants + compte à rebours de la prochaine annonce, avec le résultat.
    window.GoldAI.discipline?.afficher();
    if (repartitionForcee && r.ok) {
      zoneResultat.insertAdjacentHTML("afterbegin", `<div class="alerte-donnees">Répartition au prorata utilisée pour ce calcul seulement : ${repartitionForcee.map((x) => `${nombre(x, 1)} %`).join(" / ")} (tes paramètres enregistrés ne changent pas).</div>`);
    }
  }

  // « Retour » : remet le calculateur à zéro pour un nouveau calcul.
  function reinitialiser({ oublier = true } = {}) {
    if (oublier) oublierCalcul();
    signalCourant = null;
    lectureCourante = null;
    repartitionForcee = null;
    taux = null;
    dernierCalcul = null;
    texteCalcule = null;
    const champSignal = document.getElementById("champ-signal");
    if (champSignal) champSignal.value = "";
    calculConfirme = false;
    avertissementGain = null;
    const zoneSignal = document.getElementById("zone-signal-interprete");
    if (zoneSignal) { zoneSignal.innerHTML = ""; zoneSignal.classList.add("hidden"); }
    const zoneResultat = document.getElementById("zone-resultat-calcul");
    if (zoneResultat) zoneResultat.innerHTML = "";
    window.GoldAI.discipline?.masquer();
  }

  // Au retour sur le calculateur (onglet, ouverture de l'app) : le dernier calcul
  // est toujours là. S'il n'est plus en mémoire (app rechargée), on le refait à
  // l'identique à partir du signal mémorisé.
  async function restaurer() {
    if (!window.GoldAI.auth?.getToken?.() || avertissementGain) return;
    if (signalCourant) {
      if (aRecalculer) { aRecalculer = false; await calculer({ depuisTexte: false, confirme: true }); return; }
      if (dernierCalcul) window.GoldAI.discipline?.afficher();
      return;
    }
    const m = lireCalculMemorise();
    if (!m?.signal || !m.lecture) return;
    lectureCourante = m.lecture;
    signalCourant = m.signal;
    repartitionForcee = m.repartitionForcee || null;
    taux = m.taux || null;
    texteCalcule = m.texte ?? null;
    const champSignal = document.getElementById("champ-signal");
    if (champSignal && texteCalcule !== null && !champSignal.value) champSignal.value = texteCalcule;
    const zoneSignal = document.getElementById("zone-signal-interprete");
    zoneSignal.innerHTML = afficherSignalEditable(signalCourant, lectureCourante);
    zoneSignal.classList.toggle("hidden", !(lectureCourante.ambiguites.length || lectureCourante.aPreciser.length));
    // confirme : l'avertissement « déjà un trade gagnant » a déjà été vu pour ce calcul.
    await calculer({ depuisTexte: false, confirme: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const section = document.getElementById("section-calculateur");
    if (!section) return;

    document.getElementById("bouton-calculer").addEventListener("click", () => calculer({ depuisTexte: true }));
    // Toucher le champ qui montre encore le signal déjà calculé : il se vide
    // pour le trade suivant (le résultat affiché, lui, reste jusqu'à « Retour »).
    document.getElementById("champ-signal").addEventListener("focus", (e) => {
      if (texteCalcule !== null && e.target.value === texteCalcule) {
        e.target.value = "";
        texteCalcule = null;
        memoriserCalcul();
      }
    });

    section.addEventListener("click", async (e) => {
      const t = e.target;
      if (t.classList.contains("puce-choix")) {
        const correspondance = { entree: "sig-entree", sl: "sig-sl", sens: "sig-sens", instrument: "sig-instrument" };
        const id = correspondance[t.dataset.champ];
        if (id) document.getElementById(id).value = t.dataset.valeur;
        t.closest(".alerte-donnees").remove();
        calculer({ depuisTexte: false });
      } else if (t.id === "sig-ajouter-tp") {
        const liste = document.getElementById("sig-liste-tps");
        const n = liste.querySelectorAll("input").length;
        liste.insertAdjacentHTML("beforeend", champ(`sig-tp-${n}`, `TP${n + 1}`, null));
      } else if (t.closest("#calc-retour")) {
        reinitialiser();
        document.getElementById("champ-signal")?.scrollIntoView({ block: "center" });
      } else if (t.id === "gain-annuler") {
        // Nouveau calcul annulé : le calcul précédent (s'il y en a un) revient.
        avertissementGain = null;
        document.getElementById("zone-resultat-calcul").innerHTML = "";
        signalCourant = null;
        restaurer();
      } else if (t.id === "gain-continuer" && avertissementGain) {
        calculer({ depuisTexte: avertissementGain.depuisTexte, confirme: true });
      } else if (t.id === "aller-general") {
        window.GoldAI.app.allerA("profil");
        document.getElementById("bouton-ouvrir-parametres").click();
      } else if (t.id === "calc-copier-lots" && dernierCalcul?.r?.modeLot === "parTp") {
        const texte = texteLots(dernierCalcul.r, dernierCalcul.signal);
        const msg = document.getElementById("calc-copie-message");
        try { await navigator.clipboard.writeText(texte); msg.textContent = "✓ Lots copiés"; }
        catch { msg.textContent = texte; } // presse-papiers refusé : le texte est affiché pour le copier à la main
      } else if (t.id === "calc-prorata") {
        const reglages = await window.GoldAI.reglagesCalculateur.charger();
        const nb = signalCourant.tps.length + (signalCourant.tpOuverts ? 1 : 0);
        const base = N.repartitionPourSignal(signalCourant, reglages).slice(0, nb);
        const somme = base.reduce((s, x) => s + x, 0);
        repartitionForcee = base.map((x) => (x / somme) * 100);
        calculer({ depuisTexte: false });
      } else if (t.id === "calc-recuperer-taux") {
        const reglages = await window.GoldAI.reglagesCalculateur.charger();
        const spec = reglages.instruments?.[signalCourant?.instrument];
        t.disabled = true;
        try {
          taux = await window.GoldAI.cotations.tauxChange(spec.deviseProfit, reglages.devise);
          document.getElementById("calc-taux").value = "";
          calculer({ depuisTexte: false });
        } catch (err) {
          t.insertAdjacentHTML("afterend", `<p class="avertissement-erreur visible">Taux indisponible (${esc(err.message)}) : saisis-le manuellement.</p>`);
        } finally { t.disabled = false; }
      }
    });

    // Correction sur place : chaque modification du signal interprété relance le calcul.
    section.addEventListener("change", (e) => {
      if (e.target.closest("#zone-signal-interprete") || e.target.id === "calc-taux") calculer({ depuisTexte: false });
    });
  });

  // Réglages, règles, comptes ou trades changés : le calcul affiché est refait tout de suite
  // si l'onglet Calcul est ouvert, sinon dès qu'on y revient (restaurer).
  let aRecalculer = false;
  const actualiserCalcul = () => {
    if (!signalCourant || avertissementGain) return;
    if (document.getElementById("section-calculateur")?.classList.contains("actif")) calculer({ depuisTexte: false, confirme: true });
    else aRecalculer = true;
  };
  ["goldai:reglages-calculateur", "goldai:regles", "goldai:comptes", "goldai:trades"].forEach((ev) => window.addEventListener(ev, actualiserCalcul));

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.calculateur = { calculer, verifierMarges, restaurer,
    // Déconnexion : on vide l'écran (le calcul reste mémorisé pour cette personne).
    viderCache: () => reinitialiser({ oublier: false }) };
})();
