// Gold AI — encadré "Impact probable" (section Annonces).
//
// Combine, pour XAU/USD : tendances 30 min / 1 h / 4 h / 1W (bougies
// clôturées, js/cotations.js), dollar et taux US avec leur corrélation
// OBSERVÉE (js/donnees.js), actualités urgentes regroupées, et l'annonce
// économique la plus proche. Méthode : js/noyau.js › analyserImpact et
// docs/METHODE_IMPACT.md.
//
// Chaque analyse est enregistrée (horodatage, données disponibles, actif,
// horizon) dans Supabase — ajout uniquement, jamais réécrite — pour pouvoir
// la comparer plus tard au mouvement réellement observé.
(() => {
  const U = window.GoldAI.utils;
  const N = window.GoldAI.noyau;
  const { esc } = U;
  const ACTIF = "XAUUSD";
  const CLE_HISTO_LOCAL = () => `goldai_analyses_${window.GoldAI.auth.getNom() || "anonyme"}`;

  let derniereSignature = null;
  let derniereSauvegardeMs = 0;
  let historique = null;
  let stockageHisto = null;

  function annoncesPertinentes(maintenant) {
    const evs = window.GoldAI.calendrier?.evenementsCalendrier?.() || [];
    const majeures = evs.filter((e) => e.horodatage_utc && e.devise === "USD" && e.impact === "high");
    const prochaine = majeures.filter((e) => Date.parse(e.horodatage_utc) > maintenant && Date.parse(e.horodatage_utc) - maintenant < 24 * 3600000)
      .sort((a, b) => Date.parse(a.horodatage_utc) - Date.parse(b.horodatage_utc))[0] || null;
    const recente = majeures.filter((e) => Date.parse(e.horodatage_utc) <= maintenant && maintenant - Date.parse(e.horodatage_utc) < 3 * 3600000)
      .sort((a, b) => Date.parse(b.horodatage_utc) - Date.parse(a.horodatage_utc))[0] || null;
    return { prochaine, recente };
  }

  function donneesMarche() {
    const jeu = window.GoldAI.donnees.obtenir("marche");
    const actifs = jeu?.contenu?.actifs || [];
    const sortie = {};
    ["dollar", "rendement10ans"].forEach((cle) => {
      const a = actifs.find((x) => x.cle === cle);
      if (!a || a.erreur || !a.horodatage_cotation) return;
      const ageMin = (Date.now() - Date.parse(a.horodatage_cotation)) / 60000;
      const variation = cle === "rendement10ans"
        ? (a.cloture_precedente ? (a.prix - a.cloture_precedente) * 100 : null)   // en points de base
        : a.variation_pct;
      sortie[cle] = { variation, perime: a.marche_ouvert !== false && ageMin > 60, horodatage: a.horodatage_cotation };
    });
    return { marche: sortie, correlations: jeu?.contenu?.correlations_observees?.valeurs || {} };
  }

  // Mouvement déjà observé depuis une annonce (bougies 30 min, clôturées ou en cours).
  function mouvementDepuis(msAnnonce, prixActuel) {
    const liste = window.GoldAI.cotations.bougies("30min");
    const bougie = liste.find((x) => x.debut <= msAnnonce && msAnnonce < x.debut + 30 * 60000);
    if (!bougie || prixActuel === null) return null;
    return { depuis: bougie.ouverture, variation: prixActuel - bougie.ouverture };
  }

  function scenariosConditionnels(annonce) {
    const expl = trouverExplication(annonce.titre);
    if (!expl || !expl.or_affecte) {
      return `<p class="texte-attenue petit">Pas de fiche décrivant la réaction habituelle de l'or à cette annonce : aucun scénario n'est proposé.</p>`;
    }
    const fl = (d) => (d === "hausse" ? "▲ hausse" : "▼ baisse");
    return `<ul class="liste-scenarios">
      <li><strong>Supérieur aux attentes</strong> : ${fl(expl.si_superieur.direction)} probable de l'or — ${esc(expl.si_superieur.raisonnement)}</li>
      <li><strong>Conforme aux attentes</strong> : réaction probablement limitée ; le contexte (tendances, dollar) reprend le dessus.</li>
      <li><strong>Inférieur aux attentes</strong> : ${fl(expl.si_inferieur.direction)} probable de l'or — ${esc(expl.si_inferieur.raisonnement)}</li>
    </ul>
    <p class="texte-attenue petit">Le chiffre n'est pas connu à l'avance : ce sont des scénarios conditionnels, pas une prévision du résultat.</p>`;
  }

  let glossaire = null;
  async function chargerGlossaire() {
    if (!glossaire) { try { glossaire = await (await fetch("data/glossaire_annonces.json")).json(); } catch { glossaire = { annonces: [] }; } }
  }
  function trouverExplication(titre) {
    const t = String(titre).toLowerCase();
    return glossaire?.annonces?.find((a) => a.mots_cles.some((m) => t.includes(m))) || null;
  }

  function calculer() {
    const maintenant = Date.now();
    const cotation = window.GoldAI.cotations.instantane();
    const tendances = window.GoldAI.cotations.tendances();
    const { marche, correlations } = donneesMarche();
    const actualites = window.GoldAI.donnees.obtenir("actualites")?.contenu?.evenements || [];
    const { prochaine, recente } = annoncesPertinentes(maintenant);
    const analyse = N.analyserImpact({
      actif: ACTIF, maintenantMs: maintenant, tendances, cotation, marche, correlations, actualites,
      annonceProchaine: prochaine, annonceRecente: recente,
    });
    return { analyse, cotation, tendances, prochaine, recente, actualites, maintenant };
  }

  const ICONES_DIRECTION = { hausse: "▲", baisse: "▼", neutre: "■", incertaine: "?", "analyse insuffisante": "…" };

  function rendu({ analyse, cotation, tendances, prochaine, recente, actualites, maintenant }) {
    const classeDir = { hausse: "positif", baisse: "negatif" }[analyse.direction] || "";
    const lignesTf = ["30min", "1h", "4h", "1week"].map((tf) => {
      const t = tendances[tf] || {};
      const etat = t.perimee ? "données anciennes" : (t.etat || "insuffisant");
      const ic = { haussier: "▲", baissier: "▼", neutre: "■" }[etat] || "?";
      return `<li><span class="tf">${N.LIBELLE_TF[tf]}</span> <span class="${{ haussier: "positif", baissier: "negatif" }[etat] || ""}"><span aria-hidden="true">${ic}</span> ${esc(etat)}</span>${tf === "1week" ? ' <span class="texte-attenue petit">(contexte de fond, ne prouve pas la réaction immédiate)</span>' : ""}</li>`;
    }).join("");

    const urgente = actualites
      .filter((n) => (n.actifs || []).includes("XAUUSD") && n.importance === "haute" && (maintenant - Date.parse(n.publie_le)) < 6 * 3600000)
      .sort((a, b) => Date.parse(b.publie_le) - Date.parse(a.publie_le))[0];

    let blocAnnonce = "";
    if (prochaine) {
      blocAnnonce = `<div class="sous-bloc-impact"><h4>Avant publication : ${esc(prochaine.titre)} (${esc(prochaine.devise)})</h4>
        <p class="texte-attenue petit">${U.jourHeure(prochaine.horodatage_utc)} · ${U.compteARebours(prochaine.horodatage_utc, maintenant) || ""} · prévision ${esc(prochaine.valeurs?.[0]?.prevision || "—")} · précédent ${esc(prochaine.valeurs?.[0]?.precedent || "—")}</p>
        ${scenariosConditionnels(prochaine)}</div>`;
    }
    if (recente) {
      const mv = mouvementDepuis(Date.parse(recente.horodatage_utc), cotation.prix);
      const res = recente.valeurs?.find((v) => v.resultat)?.resultat;
      blocAnnonce += `<div class="sous-bloc-impact"><h4>Après publication : ${esc(recente.titre)}</h4>
        <p class="petit">Résultat publié : ${res ? esc(res) : '<span class="texte-attenue">non fourni par la source actuelle (le flux gratuit Forex Factory ne donne que prévision et précédent)</span>'}</p>
        <p class="petit"><strong>Mouvement déjà observé :</strong> ${mv && (cotation.fraicheur === "direct" || cotation.fraicheur === "retard")
          ? `XAU/USD ${mv.variation >= 0 ? "▲ +" : "▼ "}${mv.variation.toFixed(2)} depuis ${mv.depuis.toFixed(2)} (ouverture de la bougie 30 min de la publication)`
          : "non mesurable (cotations ou bougies indisponibles)"}</p>
        <p class="petit"><strong>Scénario pour la suite :</strong> voir la direction probable ci-dessus (hypothèse, pas une garantie).</p></div>`;
    }
    if (urgente) {
      blocAnnonce += `<div class="sous-bloc-impact"><h4>Actualité non planifiée</h4>
        <p class="petit">${esc(urgente.titre_fr || urgente.titre_original)} — <strong>${esc(urgente.statut)}</strong> (${esc(urgente.raison_statut)})</p>
        ${urgente.interpretation?.texte ? `<p class="petit"><span class="etiquette-mini">Interprétation (hypothèse)</span> ${esc(urgente.interpretation.texte)}</p>` : ""}
        ${urgente.statut !== "confirmé" ? '<p class="texte-attenue petit">Non confirmée : non comptée dans la direction probable.</p>' : ""}</div>`;
    }

    const liste = (arr) => (arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="texte-attenue petit">aucun</p>');

    return `
      <div class="entete-impact">
        <h2 class="titre-bloc-annonces">🧭 Impact probable</h2>
        <span class="texte-attenue petit">Actif : <strong>XAU/USD (or spot)</strong></span>
      </div>
      <div class="ligne-direction">
        <div class="direction ${classeDir}"><span aria-hidden="true">${ICONES_DIRECTION[analyse.direction] || "?"}</span> ${esc(analyse.direction === "analyse insuffisante" ? "Analyse insuffisante" : `Direction probable : ${analyse.direction}`)}</div>
        <div class="meta-direction">
          <span>Horizon : <strong>${esc(analyse.horizon)}</strong></span>
          <span>Confiance : <strong>${esc(analyse.confiance)}</strong></span>
          ${analyse.concordance !== null ? `<span title="Somme des signaux ÷ nombre de signaux disponibles">Concordance : <strong>${analyse.somme > 0 ? "+" : ""}${analyse.somme}/${analyse.nbSignaux}</strong> (pas une probabilité)</span>` : ""}
        </div>
      </div>
      ${analyse.raisonInsuffisance ? `<div class="alerte-donnees">${esc(analyse.raisonInsuffisance)}</div>` : ""}
      <ul class="lignes-tendances">${lignesTf}</ul>
      <div class="grille-arguments">
        <div><h4>Éléments favorables à la hausse</h4>${liste(analyse.favorables)}</div>
        <div><h4>Éléments contraires (baisse)</h4>${liste(analyse.contraires)}</div>
      </div>
      ${analyse.neutres.length || analyse.manquants.length ? `<details class="details-discrets"><summary>Neutres, non comptés ou manquants</summary>${liste([...analyse.neutres, ...analyse.manquants.map((m) => `Manquant : ${m}`)])}</details>` : ""}
      ${analyse.alternatif ? `<p class="petit"><strong>Scénario alternatif :</strong> ${esc(analyse.alternatif)}</p>` : ""}
      ${analyse.invalidation ? `<p class="petit"><strong>Invalidation :</strong> ${esc(analyse.invalidation)}</p>` : ""}
      ${blocAnnonce}
      <p class="texte-attenue petit">Dernière analyse : ${U.jourHeure(analyse.analyseLe)} · prix de référence ${cotation.prix !== null ? cotation.prix.toFixed(2) : "—"} (${esc(cotation.fraicheur)}). « Impact probable » = scénario, pas une garantie de mouvement ni un conseil. Aucune probabilité chiffrée n'est affichée : la méthode n'a pas encore été calibrée sur l'historique.</p>
      <details class="details-discrets"><summary>Méthode utilisée</summary>
        <ul class="petit">
          <li>Tendances : EMA20, pente de l'EMA sur 5 bougies et structure sur 10 bougies, mesurées en ATR14, sur bougies <strong>clôturées</strong> uniquement (la bougie en cours est ignorée). Somme ≥ +2 haussier, ≤ −2 baissier.</li>
          <li>Signaux comptés (poids 1 chacun) : tendances 30 min, 1 h, 4 h, 1W ; dollar et taux US 10 ans si leur corrélation observée sur 60 séances dépasse 0,3 en valeur absolue et que leur mouvement du jour est significatif (≥ 0,15 % / ≥ 3 pb) ; actualités urgentes confirmées < 6 h (plafonnées à ±1 au total). L'argent n'est pas compté (mêmes causes que l'or : double comptage).</li>
          <li>Hausse si concordance ≥ +0,25, baisse si ≤ −0,25, « incertaine » si ≥ 2 signaux de chaque côté presque à égalité, « analyse insuffisante » si moins de 3 signaux ou prix non à jour.</li>
          <li>Confiance élevée seulement si concordance ≥ 0,6 avec ≥ 5 signaux, prix en direct et pas d'annonce majeure dans les 2 h ; plafonnée à faible avant une annonce majeure ou marché fermé.</li>
        </ul>
      </details>
      <details class="details-discrets" id="details-historique"><summary>Historique des analyses enregistrées</summary><div id="historique-analyses"><p class="texte-attenue petit">Ouvre pour charger.</p></div></details>`;
  }

  async function enregistrer(res) {
    const { analyse, cotation } = res;
    const signature = [analyse.direction, analyse.confiance, analyse.horizon, res.prochaine?.id || "", res.recente?.id || ""].join("|");
    const maintenant = Date.now();
    // Mémorisé sur l'appareil pour ne pas réenregistrer la même conclusion à chaque ouverture de l'app.
    const cleDerniere = `goldai_derniere_analyse_${window.GoldAI.auth.getNom() || "anonyme"}`;
    if (derniereSignature === null) {
      try { const d = JSON.parse(localStorage.getItem(cleDerniere) || "null"); if (d) { derniereSignature = d.signature; derniereSauvegardeMs = d.le; } } catch { /* ignoré */ }
    }
    if (signature === derniereSignature && maintenant - derniereSauvegardeMs < 60 * 60000) return;
    derniereSignature = signature;
    derniereSauvegardeMs = maintenant;
    try { localStorage.setItem(cleDerniere, JSON.stringify({ signature, le: maintenant })); } catch { /* ignoré */ }

    const contenu = {
      analyse, // favorables, contraires, manquants, signaux, horizon, etc.
      donnees: {
        cotation: { prix: cotation.prix, horodatage: cotation.horodatageMs ? new Date(cotation.horodatageMs).toISOString() : null, fraicheur: cotation.fraicheur, fournisseur: cotation.fournisseur, mode: cotation.mode },
        annonce_prochaine: res.prochaine ? { titre: res.prochaine.titre, heure_utc: res.prochaine.horodatage_utc } : null,
        annonce_recente: res.recente ? { titre: res.recente.titre, heure_utc: res.recente.horodatage_utc } : null,
      },
      methode: "v1 (voir docs/METHODE_IMPACT.md)",
    };
    const params = {
      p_token: window.GoldAI.auth.getToken(), p_actif: ACTIF, p_horizon: analyse.horizon, p_direction: analyse.direction,
      p_confiance: analyse.confiance, p_prix_reference: cotation.prix, p_prix_reference_horodatage: contenu.donnees.cotation.horodatage, p_contenu: contenu,
    };
    const { error } = await U.rpc("enregistrer_analyse", params);
    if (error) {
      stockageHisto = "appareil";
      try {
        const liste = JSON.parse(localStorage.getItem(CLE_HISTO_LOCAL()) || "[]");
        liste.unshift({ cree_le: new Date().toISOString(), actif: ACTIF, horizon: analyse.horizon, direction: analyse.direction, confiance: analyse.confiance, prix_reference: cotation.prix, prix_reference_horodatage: contenu.donnees.cotation.horodatage, contenu });
        localStorage.setItem(CLE_HISTO_LOCAL(), JSON.stringify(liste.slice(0, 200)));
      } catch { /* stockage plein ou indisponible */ }
    } else stockageHisto = "supabase";
    historique = null;
  }

  async function afficherHistorique() {
    const zone = document.getElementById("historique-analyses");
    if (!zone) return;
    if (!historique) {
      const { data, error } = await U.rpc("lister_mes_analyses", { p_token: window.GoldAI.auth.getToken(), p_limite: 20 });
      if (!error) historique = data || [];
      else { try { historique = JSON.parse(localStorage.getItem(CLE_HISTO_LOCAL()) || "[]").slice(0, 20); } catch { historique = []; } stockageHisto = "appareil"; }
    }
    const prix = window.GoldAI.cotations.instantane();
    zone.innerHTML = historique.length ? `
      ${stockageHisto === "appareil" ? '<p class="alerte-donnees">Historique gardé sur cet appareil seulement (patch Supabase non installé).</p>' : ""}
      <div class="tableau-defilant"><table class="tableau-portions petit"><thead><tr><th>Quand</th><th>Direction</th><th>Confiance</th><th>Horizon</th><th>Prix réf.</th><th>Mouvement observé depuis</th></tr></thead><tbody>
      ${historique.map((h) => {
        const mv = h.prix_reference && prix.prix !== null && (prix.fraicheur === "direct" || prix.fraicheur === "retard") ? prix.prix - Number(h.prix_reference) : null;
        return `<tr><td>${U.jourHeure(h.cree_le)}</td><td>${esc(h.direction)}</td><td>${esc(h.confiance)}</td><td>${esc(h.horizon)}</td><td>${h.prix_reference ? Number(h.prix_reference).toFixed(2) : "—"}</td><td>${mv === null ? "—" : `${mv >= 0 ? "▲ +" : "▼ "}${mv.toFixed(2)}`}</td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="texte-attenue petit">Les analyses ne sont jamais modifiées après coup ; la dernière colonne est calculée à l'affichage avec le prix actuel.</p>`
      : `<p class="texte-attenue petit">Aucune analyse enregistrée pour l'instant.</p>`;
  }

  let dernierRenduMs = 0;
  async function afficher({ forcer = false } = {}) {
    const zone = document.getElementById("encadre-impact");
    if (!zone || !document.getElementById("section-calendrier")?.classList.contains("actif")) return;
    if (!forcer && Date.now() - dernierRenduMs < 20000) return;
    dernierRenduMs = Date.now();
    await chargerGlossaire();
    const ouvert = document.getElementById("details-historique")?.open;
    const res = calculer();
    zone.innerHTML = rendu(res);
    const details = document.getElementById("details-historique");
    if (ouvert) { details.open = true; afficherHistorique(); }
    details.addEventListener("toggle", () => { if (details.open) afficherHistorique(); });
    // N'enregistre que des analyses faites avec des données réelles chargées.
    if (res.cotation.prix !== null && res.analyse.direction !== "analyse insuffisante") enregistrer(res);
  }

  window.addEventListener("goldai:cotation", () => afficher());
  window.addEventListener("goldai:bougies", () => afficher({ forcer: true }));
  window.addEventListener("goldai:donnees", () => afficher({ forcer: true }));

  function viderCache() { historique = null; derniereSignature = null; }

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.impact = { afficher: () => afficher({ forcer: true }), viderCache };
})();
