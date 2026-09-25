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
  const { esc, heure, jourHeure, nombre } = window.GoldAI.utils;

  const LIBELLES_FRAICHEUR = {
    direct: { txt: "En direct", icone: "●", classe: "ok" },
    retard: { txt: "Retard", icone: "◐", classe: "attention" },
    ancien: { txt: "Donnée ancienne", icone: "▲", classe: "alerte" },
    "marché fermé": { txt: "Marché fermé", icone: "⏸", classe: "neutre" },
    "différé": { txt: "Différé", icone: "◔", classe: "attention" },
    chargement: { txt: "Chargement…", icone: "…", classe: "neutre" },
    indisponible: { txt: "Indisponible", icone: "✕", classe: "alerte" },
  };

  function badgeFraicheur(f) {
    const l = LIBELLES_FRAICHEUR[f] || LIBELLES_FRAICHEUR.indisponible;
    return `<span class="badge-fraicheur ${l.classe}"><span aria-hidden="true">${l.icone}</span> ${l.txt}</span>`;
  }

  // Affichage volontairement court : prix, variation, heure de la cotation.
  // Le fournisseur des données n'est pas affiché.
  function carteOr() {
    const c = window.GoldAI.cotations.instantane();
    const variation = c.variationPct;
    const prix = c.prix !== null ? nombre(c.prix, 2) : "—";
    return `
      <div class="carte-actif carte-or">
        <div class="entete-actif">
          <div class="nom-actif">Or spot (XAU/USD)</div>
          ${badgeFraicheur(c.fraicheur)}
        </div>
        <div class="ligne-prix-actif">
          <div class="prix-actif">${prix}</div>
          ${variation !== null ? `<div class="variation-actif ${variation >= 0 ? "positif" : "negatif"}">${variation >= 0 ? "▲ +" : "▼ "}${variation.toFixed(2)} %</div>` : ""}
        </div>
        <div class="meta-cotation">
          ${c.horodatageMs ? `Mis à jour à ${heure(c.horodatageMs)}` : "Aucune cotation reçue"}
          ${c.connexion === "reconnexion" ? " · <strong>reconnexion…</strong>" : c.connexion === "hors ligne" && c.mode === "websocket" ? " · <strong>déconnecté</strong>" : ""}
        </div>
        ${c.erreur ? `<div class="alerte-donnees">${esc(c.erreur)}</div>` : ""}
        ${c.fraicheur === "ancien" ? `<div class="alerte-donnees">Prix non mis à jour depuis plus de 15 min.</div>` : ""}
      </div>`;
  }

  function fraicheurActifPublie(a) {
    if (!a.horodatage_cotation) return "indisponible";
    const age = Date.now() - Date.parse(a.horodatage_cotation);
    if (a.marche_ouvert === false) return "marché fermé";
    if (age > 45 * 60000) return "ancien";
    return a.differe ? "différé" : "direct";
  }

  function carteActifPublie(a, correlations) {
    if (a.erreur) {
      return `<div class="carte-actif"><div class="nom-actif">${esc(a.nom)}</div><div class="alerte-donnees">Indisponible pour l'instant.</div></div>`;
    }
    const f = fraicheurActifPublie(a);
    const estTaux = a.cle === "rendement10ans";
    const varTxt = a.variation_pct === null || a.variation_pct === undefined ? "" : estTaux && a.cloture_precedente
      ? `${a.prix - a.cloture_precedente >= 0 ? "▲ +" : "▼ "}${((a.prix - a.cloture_precedente) * 100).toFixed(1)} pb`
      : `${a.variation_pct >= 0 ? "▲ +" : "▼ "}${a.variation_pct.toFixed(2)} %`;
    return `
      <div class="carte-actif">
        <div class="entete-actif">
          <div class="nom-actif">${esc(a.nom)}</div>
          ${badgeFraicheur(f)}
        </div>
        <div class="ligne-prix-actif">
          <div class="prix-actif">${estTaux ? `${nombre(a.prix, 3)} %` : nombre(a.prix, 3)}</div>
          ${varTxt ? `<div class="variation-actif ${(a.variation_pct ?? 0) >= 0 ? "positif" : "negatif"}">${varTxt}</div>` : ""}
        </div>
        <div class="meta-cotation">Mis à jour ${jourHeure(a.horodatage_cotation)}</div>
        ${a.correlation ? `
          <div class="bloc-correlation">
            <span class="pastille-correlation">${a.correlation === "inverse" ? "⇅ Évolue en général à l'inverse de l'or" : "⇄ Évolue en général comme l'or"}</span>
          </div>` : ""}
      </div>`;
  }

  function afficher() {
    const liste = document.getElementById("liste-actifs-marche");
    if (!liste) return;
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
    liste.innerHTML = carteOr() + autres.map((a) => carteActifPublie(a, contenu?.correlations_observees)).join("")
      + (etatDonnees.erreur ? `<p class="note-source">ⓘ ${esc(etatDonnees.erreur)}</p>` : "");
  }

  let rendu = null;
  function planifierRendu() {
    if (rendu) return;
    rendu = requestAnimationFrame(() => { rendu = null; if (document.getElementById("section-marche")?.classList.contains("actif")) afficher(); });
  }

  function charger() {
    afficher();
    window.GoldAI.donnees.charger();
  }

  window.addEventListener("goldai:cotation", planifierRendu);
  window.addEventListener("goldai:bougies", planifierRendu);
  window.addEventListener("goldai:donnees", planifierRendu);

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.marche = { charger, afficher };
})();
