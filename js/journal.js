// Gold AI — Section 4 : journal de trading en vue calendrier mensuel.
// Stockage 100% local (localStorage) : aucun serveur, aucun compte.
// Limite à connaître : les trades saisis restent sur l'appareil utilisé
// (pas de synchro automatique entre ton téléphone et ton PC).
(() => {
  const CLE_JOURNAL = "goldai_journal_trades";
  const NOMS_MOIS = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];

  const aujourdhui = new Date();
  let anneeAffichee = aujourdhui.getFullYear();
  let moisAffiche = aujourdhui.getMonth(); // 0-11
  let dateJourSelectionne = null; // "AAAA-MM-JJ" pendant que la modale d'un jour est ouverte

  function chargerTousLesTrades() {
    try {
      return JSON.parse(localStorage.getItem(CLE_JOURNAL) || "{}");
    } catch (erreur) {
      return {};
    }
  }

  function sauvegarderTousLesTrades(trades) {
    try {
      localStorage.setItem(CLE_JOURNAL, JSON.stringify(trades));
    } catch (erreur) {
      alert("Impossible de sauvegarder : le stockage du navigateur est indisponible ou plein.");
    }
  }

  function cleDate(annee, moisIndex, jour) {
    const mm = String(moisIndex + 1).padStart(2, "0");
    const jj = String(jour).padStart(2, "0");
    return `${annee}-${mm}-${jj}`;
  }

  function formaterDollars(valeur) {
    const signe = valeur < 0 ? "-" : "+";
    return `${signe}$${Math.abs(valeur).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function sommeDuJour(tradesJour) {
    return (tradesJour || []).reduce((total, t) => total + t.resultat, 0);
  }

  function afficherMoisCourant() {
    const tousLesTrades = chargerTousLesTrades();

    document.getElementById("nom-mois-affiche").textContent = `${NOMS_MOIS[moisAffiche]} ${anneeAffichee}`;

    const premierJourDuMois = new Date(anneeAffichee, moisAffiche, 1);
    const nombreJoursDansLeMois = new Date(anneeAffichee, moisAffiche + 1, 0).getDate();

    // getDay() : 0=dimanche..6=samedi → on veut 0=lundi..6=dimanche pour la grille L M M J V S D
    const decalageDebut = (premierJourDuMois.getDay() + 6) % 7;

    const grille = document.getElementById("grille-calendrier");
    grille.innerHTML = "";

    for (let i = 0; i < decalageDebut; i++) {
      const caseVide = document.createElement("div");
      caseVide.className = "case-jour vide";
      grille.appendChild(caseVide);
    }

    let totalMois = 0;

    for (let jour = 1; jour <= nombreJoursDansLeMois; jour++) {
      const cle = cleDate(anneeAffichee, moisAffiche, jour);
      const tradesJour = tousLesTrades[cle] || [];
      const somme = sommeDuJour(tradesJour);
      totalMois += somme;

      const caseJour = document.createElement("div");
      caseJour.className = "case-jour";
      if (somme > 0) caseJour.classList.add("jour-gain");
      if (somme < 0) caseJour.classList.add("jour-perte");
      if (
        jour === aujourdhui.getDate() &&
        moisAffiche === aujourdhui.getMonth() &&
        anneeAffichee === aujourdhui.getFullYear()
      ) {
        caseJour.classList.add("aujourdhui");
      }

      caseJour.innerHTML = `
        <span class="numero-jour">${jour}</span>
        ${tradesJour.length > 0 ? `<span class="resultat-jour">${formaterDollars(somme)}</span>` : ""}
      `;

      caseJour.addEventListener("click", () => ouvrirModaleJour(cle));
      grille.appendChild(caseJour);
    }

    const zoneTotalMois = document.getElementById("total-mois");
    const valeurTotalMois = document.getElementById("valeur-total-mois");
    valeurTotalMois.textContent = formaterDollars(totalMois);
    zoneTotalMois.classList.remove("gain", "perte");
    if (totalMois > 0) zoneTotalMois.classList.add("gain");
    if (totalMois < 0) zoneTotalMois.classList.add("perte");
  }

  function ouvrirModaleJour(cle) {
    dateJourSelectionne = cle;

    const [annee, mois, jour] = cle.split("-").map(Number);
    const dateLisible = new Date(annee, mois - 1, jour).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    document.getElementById("modale-titre-jour").textContent =
      dateLisible.charAt(0).toUpperCase() + dateLisible.slice(1);

    document.getElementById("resultat-nouveau-trade").value = "";
    document.getElementById("note-nouveau-trade").value = "";

    rafraichirListeTradesDuJour();
    document.getElementById("modale-jour").classList.add("visible");
  }

  function rafraichirListeTradesDuJour() {
    const tousLesTrades = chargerTousLesTrades();
    const tradesJour = tousLesTrades[dateJourSelectionne] || [];
    const conteneur = document.getElementById("liste-trades-jour");

    if (tradesJour.length === 0) {
      conteneur.innerHTML = `<p class="etat-vide" style="padding:10px 0;">Aucun trade enregistré ce jour.</p>`;
      return;
    }

    conteneur.innerHTML = "";
    tradesJour.forEach((trade, index) => {
      const item = document.createElement("div");
      item.className = "trade-item";
      item.innerHTML = `
        <div>
          <div class="resultat-trade ${trade.resultat >= 0 ? "positif" : "negatif"}">${formaterDollars(trade.resultat)}</div>
          ${trade.note ? `<div class="note-trade">${trade.note}</div>` : ""}
        </div>
        <button class="supprimer-trade" aria-label="Supprimer">✕</button>
      `;
      item.querySelector(".supprimer-trade").addEventListener("click", () => supprimerTrade(index));
      conteneur.appendChild(item);
    });
  }

  function ajouterTrade() {
    const champResultat = document.getElementById("resultat-nouveau-trade");
    const champNote = document.getElementById("note-nouveau-trade");

    const resultat = parseFloat(champResultat.value);
    if (isNaN(resultat)) {
      alert("Renseigne un résultat en $ (négatif si c'est une perte).");
      return;
    }

    const tousLesTrades = chargerTousLesTrades();
    if (!tousLesTrades[dateJourSelectionne]) tousLesTrades[dateJourSelectionne] = [];
    tousLesTrades[dateJourSelectionne].push({ resultat, note: champNote.value.trim() });
    sauvegarderTousLesTrades(tousLesTrades);

    champResultat.value = "";
    champNote.value = "";
    rafraichirListeTradesDuJour();
    afficherMoisCourant();
  }

  function supprimerTrade(index) {
    const tousLesTrades = chargerTousLesTrades();
    const tradesJour = tousLesTrades[dateJourSelectionne] || [];
    tradesJour.splice(index, 1);

    if (tradesJour.length === 0) {
      delete tousLesTrades[dateJourSelectionne];
    } else {
      tousLesTrades[dateJourSelectionne] = tradesJour;
    }

    sauvegarderTousLesTrades(tousLesTrades);
    rafraichirListeTradesDuJour();
    afficherMoisCourant();
  }

  function fermerModaleJour() {
    document.getElementById("modale-jour").classList.remove("visible");
    dateJourSelectionne = null;
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("mois-precedent").addEventListener("click", () => {
      moisAffiche--;
      if (moisAffiche < 0) {
        moisAffiche = 11;
        anneeAffichee--;
      }
      afficherMoisCourant();
    });

    document.getElementById("mois-suivant").addEventListener("click", () => {
      moisAffiche++;
      if (moisAffiche > 11) {
        moisAffiche = 0;
        anneeAffichee++;
      }
      afficherMoisCourant();
    });

    document.getElementById("bouton-ajouter-trade").addEventListener("click", ajouterTrade);
    document.getElementById("bouton-fermer-modale-jour").addEventListener("click", fermerModaleJour);
    document.getElementById("modale-jour").addEventListener("click", (evenement) => {
      if (evenement.target.id === "modale-jour") fermerModaleJour();
    });
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.journal = { afficherMoisCourant };
})();
