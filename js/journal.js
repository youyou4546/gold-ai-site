// Gold AI — Section 4 : journal de trading en vue calendrier mensuel.
// Stocké dans Supabase, rattaché au compte connecté : chaque utilisateur ne
// voit que ses propres trades (imposé côté serveur par la fonction appelée,
// pas seulement par ce code).
(() => {
  const NOMS_MOIS = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];

  const aujourdhui = new Date();
  let anneeAffichee = aujourdhui.getFullYear();
  let moisAffiche = aujourdhui.getMonth(); // 0-11
  let dateJourSelectionne = null; // "AAAA-MM-JJ" pendant que la modale d'un jour est ouverte

  // Cache mémoire de TOUS les trades de l'utilisateur connecté :
  // - cacheTrades : regroupés par jour { "AAAA-MM-JJ": [...] }, pour le calendrier
  // - cacheTradesBruts : liste à plat (mêmes objets), pour la section Performance
  // Remis à zéro à chaque connexion/déconnexion pour ne jamais mélanger les
  // journaux de deux comptes.
  let cacheTrades = null;
  let cacheTradesBruts = null;

  function client() {
    return window.GoldAI.auth.client;
  }

  function token() {
    return window.GoldAI.auth.getToken();
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

  // Renvoie false (et déconnecte proprement) si la session n'est plus valide.
  function gererErreur(error) {
    if (error?.message === "SESSION_INVALIDE") {
      window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi.");
      return true;
    }
    if (error) {
      alert("Impossible de contacter le serveur pour l'instant. Vérifie ta connexion et réessaie.");
      return true;
    }
    return false;
  }

  async function chargerTousLesTrades(forcerRechargement = false) {
    if (cacheTrades && !forcerRechargement) return cacheTrades;

    const { data, error } = await client().rpc("lister_mes_trades", { p_token: token() });
    if (gererErreur(error)) return {};

    cacheTradesBruts = (data || []).map((trade) => ({
      id: trade.id,
      date: trade.date_trade,
      resultat: Number(trade.resultat),
      note: trade.note || "",
      compteTradingId: trade.compte_trading_id || null,
    }));

    const parJour = {};
    cacheTradesBruts.forEach((trade) => {
      if (!parJour[trade.date]) parJour[trade.date] = [];
      parJour[trade.date].push(trade);
    });

    cacheTrades = parJour;
    return cacheTrades;
  }

  // Utilisé par journal-performance.js : liste à plat de tous les trades déjà
  // chargés (appeler chargerTousLesTrades() avant, pour être sûr qu'elle soit à jour).
  function obtenirTradesBruts() {
    return cacheTradesBruts || [];
  }

  // Appelé par auth.js après une déconnexion pour ne pas garder les trades
  // de l'utilisateur précédent en mémoire, et repartir de l'accueil du
  // journal au prochain compte connecté.
  function viderCache() {
    cacheTrades = null;
    cacheTradesBruts = null;
    document.getElementById("journal-calendrier")?.classList.add("hidden");
    document.getElementById("journal-performance")?.classList.add("hidden");
    document.getElementById("journal-accueil")?.classList.remove("hidden");
  }

  async function afficherMoisCourant() {
    const grille = document.getElementById("grille-calendrier");
    grille.innerHTML = `<p class="etat-vide" style="grid-column:1/-1;">Chargement…</p>`;

    const tousLesTrades = await chargerTousLesTrades();

    document.getElementById("nom-mois-affiche").textContent = `${NOMS_MOIS[moisAffiche]} ${anneeAffichee}`;

    const premierJourDuMois = new Date(anneeAffichee, moisAffiche, 1);
    const nombreJoursDansLeMois = new Date(anneeAffichee, moisAffiche + 1, 0).getDate();

    // getDay() : 0=dimanche..6=samedi → on veut 0=lundi..6=dimanche pour la grille L M M J V S D
    const decalageDebut = (premierJourDuMois.getDay() + 6) % 7;

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

  async function ouvrirModaleJour(cle) {
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
    await peuplerSelectCompteTrade();

    await rafraichirListeTradesDuJour();
    document.getElementById("modale-jour").classList.add("visible");
  }

  // Remplit le menu "Compte" du formulaire d'ajout de trade avec les comptes
  // de trading créés dans Profil > Mes comptes (masqué s'il n'y en a aucun).
  async function peuplerSelectCompteTrade() {
    const champ = document.getElementById("select-compte-trade");
    if (!champ || !window.GoldAI.comptesTrading) return;

    const comptes = await window.GoldAI.comptesTrading.chargerComptes();
    champ.innerHTML = `<option value="">Aucun compte</option>`;
    comptes.forEach((c) => {
      const option = document.createElement("option");
      option.value = c.id;
      option.textContent = c.nom;
      champ.appendChild(option);
    });
    champ.parentElement.style.display = comptes.length > 0 ? "block" : "none";
  }

  async function rafraichirListeTradesDuJour() {
    const tousLesTrades = await chargerTousLesTrades();
    const tradesJour = tousLesTrades[dateJourSelectionne] || [];
    const conteneur = document.getElementById("liste-trades-jour");

    if (tradesJour.length === 0) {
      conteneur.innerHTML = `<p class="etat-vide" style="padding:10px 0;">Aucun trade enregistré ce jour.</p>`;
      return;
    }

    conteneur.innerHTML = "";
    tradesJour.forEach((trade) => {
      const item = document.createElement("div");
      item.className = "trade-item";
      item.innerHTML = `
        <div>
          <div class="resultat-trade ${trade.resultat >= 0 ? "positif" : "negatif"}">${formaterDollars(trade.resultat)}</div>
          ${trade.note ? `<div class="note-trade">${trade.note}</div>` : ""}
        </div>
        <button class="supprimer-trade" aria-label="Supprimer">✕</button>
      `;
      item.querySelector(".supprimer-trade").addEventListener("click", () => supprimerTrade(trade.id));
      conteneur.appendChild(item);
    });
  }

  async function ajouterTrade() {
    const champResultat = document.getElementById("resultat-nouveau-trade");
    const champNote = document.getElementById("note-nouveau-trade");
    const champCompte = document.getElementById("select-compte-trade");

    const resultat = parseFloat(champResultat.value);
    if (isNaN(resultat)) {
      alert("Renseigne un résultat en $ (négatif si c'est une perte).");
      return;
    }

    const note = champNote.value.trim();
    const compteTradingId = champCompte?.value || null;
    const { data: idTrade, error } = await client().rpc("ajouter_mon_trade", {
      p_token: token(),
      p_date: dateJourSelectionne,
      p_resultat: resultat,
      p_note: note || null,
      p_compte_trading_id: compteTradingId,
    });
    if (gererErreur(error)) return;

    const tousLesTrades = await chargerTousLesTrades();
    const nouveauTrade = { id: idTrade, date: dateJourSelectionne, resultat, note, compteTradingId };
    if (!tousLesTrades[dateJourSelectionne]) tousLesTrades[dateJourSelectionne] = [];
    tousLesTrades[dateJourSelectionne].push(nouveauTrade);
    if (cacheTradesBruts) cacheTradesBruts.push(nouveauTrade);

    champResultat.value = "";
    champNote.value = "";
    await rafraichirListeTradesDuJour();
    await afficherMoisCourant();
  }

  async function supprimerTrade(idTrade) {
    const { error } = await client().rpc("supprimer_mon_trade", { p_token: token(), p_trade_id: idTrade });
    if (gererErreur(error)) return;

    const tousLesTrades = await chargerTousLesTrades();
    const tradesJour = tousLesTrades[dateJourSelectionne] || [];
    const index = tradesJour.findIndex((t) => t.id === idTrade);
    if (index !== -1) tradesJour.splice(index, 1);

    if (tradesJour.length === 0) delete tousLesTrades[dateJourSelectionne];

    if (cacheTradesBruts) {
      const indexBrut = cacheTradesBruts.findIndex((t) => t.id === idTrade);
      if (indexBrut !== -1) cacheTradesBruts.splice(indexBrut, 1);
    }

    await rafraichirListeTradesDuJour();
    await afficherMoisCourant();
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

    // Le calendrier des trades n'est chargé/affiché qu'au clic sur la tuile
    // "Calendrier" de l'accueil du journal (pas dès qu'on ouvre l'onglet Journal
    // — d'autres tuiles viendront s'ajouter à côté à l'avenir).
    document.getElementById("bouton-ouvrir-calendrier-trades").addEventListener("click", () => {
      document.getElementById("journal-accueil").classList.add("hidden");
      document.getElementById("journal-calendrier").classList.remove("hidden");
      afficherMoisCourant();
    });

    document.getElementById("bouton-retour-journal").addEventListener("click", () => {
      document.getElementById("journal-calendrier").classList.add("hidden");
      document.getElementById("journal-accueil").classList.remove("hidden");
    });
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.journal = { afficherMoisCourant, viderCache, chargerTousLesTrades, obtenirTradesBruts };
})();
