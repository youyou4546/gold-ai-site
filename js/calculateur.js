// Gold AI — Section 1 : calculateur de position (taille de lot, répartition
// en 3 paliers TP1/TP2/runner, risque et gain potentiel).
//
// Hypothèse de calcul : 1 lot standard XAUUSD = 100 onces (la norme la plus
// répandue chez les brokers). Donc un mouvement de 1$ sur le prix de l'or =
// 100$ de gain/perte par lot standard détenu.
(() => {
  const TAILLE_CONTRAT = 100; // onces par lot standard

  const champTailleCompte = document.getElementById("taille-compte");
  const champPourcentageRisque = document.getElementById("pourcentage-risque");
  const champPrixEntree = document.getElementById("prix-entree");
  const champPrixSL = document.getElementById("prix-sl");
  const champsTP = [
    document.getElementById("prix-tp1"),
    document.getElementById("prix-tp2"),
    document.getElementById("prix-tp3"),
  ];
  const nomsTP = ["TP1", "TP2", "TP3 (runner)"];

  const zoneErreur = document.getElementById("erreur-calculateur");
  const zoneResultats = document.getElementById("resultats-calculateur");

  // Se souvenir de la taille de compte et du % de risque d'une visite à l'autre
  const CLE_MEMOIRE = "goldai_calculateur_prefs";
  function chargerPreferences() {
    try {
      const donnees = JSON.parse(localStorage.getItem(CLE_MEMOIRE) || "{}");
      if (donnees.compte) champTailleCompte.value = donnees.compte;
      if (donnees.risque) champPourcentageRisque.value = donnees.risque;
    } catch (erreur) {
      // localStorage indisponible (navigation privée, etc.) : pas grave, valeurs par défaut gardées
    }
  }
  function sauvegarderPreferences() {
    try {
      localStorage.setItem(
        CLE_MEMOIRE,
        JSON.stringify({ compte: champTailleCompte.value, risque: champPourcentageRisque.value })
      );
    } catch (erreur) {
      // rien à faire si le stockage échoue
    }
  }

  function afficherErreur(message) {
    zoneErreur.textContent = message;
    zoneErreur.classList.add("visible");
    zoneResultats.style.display = "none";
  }

  function masquerErreur() {
    zoneErreur.textContent = "";
    zoneErreur.classList.remove("visible");
  }

  function formaterDollars(valeur) {
    const signe = valeur < 0 ? "-" : "";
    return `${signe}$${Math.abs(valeur).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function calculer() {
    masquerErreur();

    const compte = parseFloat(champTailleCompte.value);
    const pourcentageRisque = parseFloat(champPourcentageRisque.value);
    const entree = parseFloat(champPrixEntree.value);
    const sl = parseFloat(champPrixSL.value);

    if (!compte || compte <= 0) return afficherErreur("Renseigne la taille de ton compte.");
    if (!pourcentageRisque || pourcentageRisque <= 0) return afficherErreur("Renseigne un % de risque valide.");
    if (!entree || entree <= 0) return afficherErreur("Renseigne le prix d'entrée.");
    if (!sl || sl <= 0) return afficherErreur("Renseigne le stop-loss.");
    if (entree === sl) return afficherErreur("Le stop-loss doit être différent du prix d'entrée.");

    const achat = entree > sl; // achat (long) si le SL est en dessous de l'entrée, sinon vente (short)
    const distanceSL = Math.abs(entree - sl);

    const tpValides = [];
    for (let i = 0; i < champsTP.length; i++) {
      const valeurBrute = champsTP[i].value;
      if (valeurBrute === "") continue;
      const tp = parseFloat(valeurBrute);
      if (!tp || tp <= 0) continue;

      const cotesCoherent = achat ? tp > entree : tp < entree;
      if (!cotesCoherent) {
        return afficherErreur(
          `${nomsTP[i]} doit être ${achat ? "au-dessus" : "en dessous"} du prix d'entrée pour un ${achat ? "achat" : "une vente"}.`
        );
      }
      tpValides.push({ nom: nomsTP[i], prix: tp });
    }

    if (tpValides.length === 0) return afficherErreur("Renseigne au moins un take-profit.");

    const risqueDollars = compte * (pourcentageRisque / 100);
    const lotTotal = risqueDollars / (distanceSL * TAILLE_CONTRAT);
    const lotParPalier = lotTotal / tpValides.length;

    document.getElementById("valeur-risque-dollars").textContent = formaterDollars(risqueDollars);
    document.getElementById("label-direction").textContent = achat ? "🟢 Achat (long)" : "🔴 Vente (short)";
    document.getElementById("valeur-lot-total").textContent = `${lotTotal.toFixed(2)} lot`;

    const conteneurPaliers = document.getElementById("conteneur-paliers");
    conteneurPaliers.innerHTML = "";

    let gainTotal = 0;
    tpValides.forEach(({ nom, prix }) => {
      const distanceTP = Math.abs(prix - entree);
      const gain = lotParPalier * distanceTP * TAILLE_CONTRAT;
      const rMultiple = distanceTP / distanceSL;
      gainTotal += gain;

      const div = document.createElement("div");
      div.className = "palier";
      div.innerHTML = `
        <div>
          <div class="nom">${nom}</div>
          <div class="details">${lotParPalier.toFixed(2)} lot · prix ${prix.toFixed(2)}</div>
        </div>
        <div>
          <div class="gain">+${formaterDollars(gain)}</div>
          <div class="r-multiple">R : ${rMultiple.toFixed(1)}</div>
        </div>
      `;
      conteneurPaliers.appendChild(div);
    });

    document.getElementById("valeur-gain-total").textContent = `+${formaterDollars(gainTotal)}`;
    zoneResultats.style.display = "block";
    sauvegarderPreferences();
  }

  document.getElementById("bouton-calculer").addEventListener("click", calculer);
  chargerPreferences();
})();
