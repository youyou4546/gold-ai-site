// Gold AI — Journal > Performance : statistiques calculées automatiquement
// à partir des trades enregistrés (aucune saisie supplémentaire nécessaire).
// Peut être filtré par compte de trading (voir js/comptes-trading.js).
(() => {
  function formaterDollars(valeur) {
    const signe = valeur < 0 ? "-" : "+";
    return `${signe}$${Math.abs(valeur).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function calculerStats(trades) {
    if (trades.length === 0) {
      // Affiche quand même toutes les tuiles, à zéro, plutôt qu'un message
      // vide — plus lisible en un coup d'œil, même sans historique.
      return {
        nombreTrades: 0,
        winRate: 0,
        ratioGainPerte: null,
        meilleureJournee: 0,
        pireJournee: 0,
        serieGainsMax: 0,
        seriePertesMax: 0,
        gainNetTotal: 0,
      };
    }

    const gagnants = trades.filter((t) => t.resultat > 0);
    const perdants = trades.filter((t) => t.resultat < 0);

    const winRate = (gagnants.length / trades.length) * 100;

    const gainMoyen = gagnants.length > 0 ? gagnants.reduce((s, t) => s + t.resultat, 0) / gagnants.length : 0;
    const perteMoyenne = perdants.length > 0 ? Math.abs(perdants.reduce((s, t) => s + t.resultat, 0) / perdants.length) : 0;
    const ratioGainPerte = perteMoyenne > 0 ? gainMoyen / perteMoyenne : null;

    // Regroupe par jour pour meilleure/pire journée
    const parJour = {};
    trades.forEach((t) => {
      parJour[t.date] = (parJour[t.date] || 0) + t.resultat;
    });
    const sommesJournalieres = Object.values(parJour);
    const meilleureJournee = Math.max(...sommesJournalieres);
    const pireJournee = Math.min(...sommesJournalieres);

    // Plus longues séries consécutives, dans l'ordre chronologique des trades
    // (un résultat à 0 pile interrompt les deux types de série).
    const tradesTries = [...trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let serieGainsActuelle = 0, serieGainsMax = 0;
    let seriePertesActuelle = 0, seriePertesMax = 0;
    tradesTries.forEach((t) => {
      if (t.resultat > 0) {
        serieGainsActuelle++;
        seriePertesActuelle = 0;
      } else if (t.resultat < 0) {
        seriePertesActuelle++;
        serieGainsActuelle = 0;
      } else {
        serieGainsActuelle = 0;
        seriePertesActuelle = 0;
      }
      serieGainsMax = Math.max(serieGainsMax, serieGainsActuelle);
      seriePertesMax = Math.max(seriePertesMax, seriePertesActuelle);
    });

    const gainNetTotal = trades.reduce((s, t) => s + t.resultat, 0);

    return {
      nombreTrades: trades.length,
      winRate,
      ratioGainPerte,
      meilleureJournee,
      pireJournee,
      serieGainsMax,
      seriePertesMax,
      gainNetTotal,
    };
  }

  function afficherStats(stats) {
    const conteneur = document.getElementById("contenu-performance");
    const classeGainNet = stats.gainNetTotal >= 0 ? "positif" : "negatif";

    conteneur.innerHTML = `
      <div class="grille-stats-perf">
        <div class="carte-stat">
          <div class="label-stat">Win rate</div>
          <div class="valeur-stat">${stats.winRate.toFixed(1)}%</div>
          <div class="sous-valeur-stat">${stats.nombreTrades} trade${stats.nombreTrades > 1 ? "s" : ""}</div>
        </div>
        <div class="carte-stat">
          <div class="label-stat">Ratio gain / perte moyen</div>
          <div class="valeur-stat">${stats.ratioGainPerte === null ? "—" : stats.ratioGainPerte.toFixed(2)}</div>
          <div class="sous-valeur-stat">moyenne des gains ÷ moyenne des pertes</div>
        </div>
        <div class="carte-stat">
          <div class="label-stat">Meilleure journée</div>
          <div class="valeur-stat positif">${formaterDollars(stats.meilleureJournee)}</div>
        </div>
        <div class="carte-stat">
          <div class="label-stat">Pire journée</div>
          <div class="valeur-stat negatif">${formaterDollars(stats.pireJournee)}</div>
        </div>
        <div class="carte-stat">
          <div class="label-stat">Plus longue série de gains</div>
          <div class="valeur-stat">${stats.serieGainsMax}</div>
        </div>
        <div class="carte-stat">
          <div class="label-stat">Plus longue série de pertes</div>
          <div class="valeur-stat">${stats.seriePertesMax}</div>
        </div>
        <div class="carte-stat carte-stat-large">
          <div class="label-stat">Gain net total</div>
          <div class="valeur-stat ${classeGainNet}" style="font-size:26px;">${formaterDollars(stats.gainNetTotal)}</div>
        </div>
      </div>
    `;
  }

  async function peuplerFiltreComptes() {
    const select = document.getElementById("select-filtre-compte-perf");
    const comptes = await window.GoldAI.comptesTrading.chargerComptes();

    select.innerHTML = `<option value="">Tous les comptes</option>`;
    comptes.forEach((c) => {
      const option = document.createElement("option");
      option.value = c.id;
      option.textContent = c.nom;
      select.appendChild(option);
    });
    select.parentElement.style.display = comptes.length > 0 ? "block" : "none";
  }

  async function rafraichir() {
    await window.GoldAI.journal.chargerTousLesTrades(true);
    const tousLesTrades = window.GoldAI.journal.obtenirTradesBruts();

    const idCompteFiltre = document.getElementById("select-filtre-compte-perf").value;
    const tradesFiltres = idCompteFiltre
      ? tousLesTrades.filter((t) => t.compteTradingId === idCompteFiltre)
      : tousLesTrades;

    afficherStats(calculerStats(tradesFiltres));
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("bouton-ouvrir-performance")?.addEventListener("click", async () => {
      document.getElementById("journal-accueil").classList.add("hidden");
      document.getElementById("journal-performance").classList.remove("hidden");
      document.getElementById("contenu-performance").innerHTML = `<p class="etat-vide">Chargement…</p>`;
      await peuplerFiltreComptes();
      await rafraichir();
    });

    document.getElementById("bouton-retour-performance")?.addEventListener("click", () => {
      document.getElementById("journal-performance").classList.add("hidden");
      document.getElementById("journal-accueil").classList.remove("hidden");
    });

    document.getElementById("select-filtre-compte-perf")?.addEventListener("change", rafraichir);
  });
})();
