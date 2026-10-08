// Gold AI — Section Marché : or spot en direct + actifs qui l'influencent.
//
// - Or spot (XAU/USD) : module central js/cotations.js (Twelve Data,
//   WebSocket ou requêtes périodiques), mis à jour sans recharger la page.
// - Indice dollar, taux US 10 ans, argent (contrat à terme) : publiés toutes
//   les 15 min par le PC (site/sync_marche.py, Yahoo Finance, données
//   DIFFÉRÉES) via js/donnees.js.
// Chaque prix affiche l'heure de la cotation et sa fraîcheur : une valeur
// ancienne n'est jamais présentée comme "en direct".
(() => {
  const { esc, heure, nombre } = window.GoldAI.utils;

  const LIBELLES_FRAICHEUR = {
    direct: { txt: "En direct", icone: "●", classe: "ok" },
    retard: { txt: "Retard", icone: "◐", classe: "attention" },
    ancien: { txt: "Donnée ancienne", icone: "▲", classe: "alerte" },
    "marché fermé": { txt: "Marché fermé", icone: "‖", classe: "neutre" },
    "différé": { txt: "Différé", icone: "◔", classe: "attention" },
    chargement: { txt: "Chargement…", icone: "…", classe: "neutre" },
    indisponible: { txt: "Indisponible", icone: "✕", classe: "alerte" },
  };

  // Affichage en lignes : nom, prix, flèche + variation colorée. Pas de
  // paragraphe : la fraîcheur est un simple point de couleur, et un message
  // n'apparaît que si la donnée pose problème.
  function fleche(v, texte) {
    if (v === null || v === undefined) return `<span class="variation-ligne neutre">—</span>`;
    const cl = v > 0 ? "positif" : v < 0 ? "negatif" : "neutre";
    return `<span class="variation-ligne ${cl}"><span aria-hidden="true">${v > 0 ? "▲" : v < 0 ? "▼" : "■"}</span> ${texte}</span>`;
  }

  function point(f) {
    const l = LIBELLES_FRAICHEUR[f] || LIBELLES_FRAICHEUR.indisponible;
    return `<span class="point-fraicheur ${l.classe}" title="${l.txt}" aria-label="${l.txt}"></span>`;
  }

  function ligneActif({ nom, sous, prix, variation, varTexte, fraicheur, correlation, grand = false }) {
    return `
      <div class="ligne-actif${grand ? " ligne-or" : ""}">
        <div class="nom-ligne">${point(fraicheur)}<span class="textes-ligne"><span class="titre-ligne">${esc(nom)}${sous ? ` <span class="sous-ligne">${sous}</span>` : ""}</span>${correlation ? `<span class="correl-ligne">${correlation === "inverse"
          ? "Quand l'or monte, il descend (et inversement)"
          : "Quand l'or monte, il monte aussi (et inversement)"}</span>` : ""}</span></div>
        <div class="prix-ligne">${prix}</div>
        ${fleche(variation, varTexte)}
      </div>`;
  }

  function ligneOr() {
    const c = window.GoldAI.cotations.instantane();
    const v = c.variationPct;
    let html = ligneActif({
      nom: "Or (XAU/USD)", sous: c.horodatageMs ? heure(c.horodatageMs) : "", grand: true,
      prix: c.prix !== null ? nombre(c.prix, 2) : "—",
      variation: v, varTexte: v === null ? "" : `${v >= 0 ? "+" : ""}${v.toFixed(2)} %`, fraicheur: c.fraicheur,
    });
    if (c.erreur) html += `<div class="alerte-donnees">${esc(c.erreur)}</div>`;
    else if (c.fraicheur === "ancien") html += `<div class="alerte-donnees">Prix non mis à jour depuis plus de 15 min.</div>`;
    return html;
  }

  function fraicheurActifPublie(a) {
    if (!a.horodatage_cotation) return "indisponible";
    const age = Date.now() - Date.parse(a.horodatage_cotation);
    if (a.marche_ouvert === false) return "marché fermé";
    if (age > 45 * 60000) return "ancien";
    return a.differe ? "différé" : "direct";
  }

  function ligneActifPublie(a) {
    if (a.erreur) return ligneActif({ nom: a.nom, prix: "—", variation: null, fraicheur: "indisponible" });
    const estTaux = a.cle === "rendement10ans";
    let variation = a.variation_pct ?? null, varTexte = variation === null ? "" : `${variation >= 0 ? "+" : ""}${variation.toFixed(2)} %`;
    if (estTaux && a.cloture_precedente) {
      variation = (a.prix - a.cloture_precedente) * 100;
      varTexte = `${variation >= 0 ? "+" : ""}${variation.toFixed(1)} pb`;
    }
    return ligneActif({
      nom: a.nom, prix: estTaux ? `${nombre(a.prix, 3)} %` : nombre(a.prix, 3),
      variation, varTexte, fraicheur: fraicheurActifPublie(a), correlation: a.correlation,
    });
  }

  function afficher() {
    // L'or et les actifs liés sont dessinés séparément : les blocs Sessions et
    // Discours placés entre les deux ne sont jamais redessinés à chaque cotation
    // (sinon la vidéo d'un direct se rechargerait sans arrêt).
    const zoneOr = document.getElementById("or-marche");
    const zoneLies = document.getElementById("actifs-lies-marche");
    if (!zoneOr || !zoneLies) return;
    const jeu = window.GoldAI.donnees.obtenir("marche");
    const etatDonnees = window.GoldAI.donnees.etat();
    const contenu = jeu?.contenu;

    const entete = document.getElementById("date-marche");
    if (jeu) {
      const ageMin = (Date.now() - Date.parse(jeu.publieLe)) / 60000;
      entete.innerHTML = ageMin > 30 ? `<strong class="texte-alerte">Actifs liés : relevé de plus de 30 min</strong>` : "";
    } else {
      entete.textContent = etatDonnees.charge ? "Actifs liés indisponibles." : "Chargement…";
    }

    const autres = (contenu?.actifs || []).filter((a) => a.cle !== "or");
    zoneOr.innerHTML = `<div class="carte liste-lignes">${ligneOr()}</div>`;
    zoneLies.innerHTML = `
      <h3 class="titre-bloc-annonces">Actifs liés</h3>
      <div class="carte liste-lignes">${autres.map(ligneActifPublie).join("") || '<p class="etat-vide">Chargement…</p>'}</div>`
      + (etatDonnees.erreur ? `<p class="note-source">ⓘ ${esc(etatDonnees.erreur)}</p>` : "");
  }

  let rendu = null;
  function planifierRendu() {
    if (rendu) return;
    rendu = requestAnimationFrame(() => { rendu = null; if (document.getElementById("section-marche")?.classList.contains("actif")) afficher(); });
  }

  function charger() {
    afficher();
    window.GoldAI.sessionsMarche?.afficher();
    window.GoldAI.direct?.afficher();
    window.GoldAI.donnees.charger();
  }

  window.addEventListener("goldai:cotation", planifierRendu);
  window.addEventListener("goldai:bougies", planifierRendu);
  window.addEventListener("goldai:donnees", planifierRendu);

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.marche = { charger, afficher };
})();
