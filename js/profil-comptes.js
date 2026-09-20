// Gold AI — Profil > Mes comptes : plusieurs comptes de trading (challenge ou
// financé), avec calcul automatique de la Daily Loss Limit et du Max Drawdown
// à partir du solde de chaque compte (voir js/comptes-trading.js).
(() => {
  const NOMS_MOIS_COURT = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "aoû", "sep", "oct", "nov", "déc"];
  let idCompteEnEdition = null;

  function formaterDollars(valeur) {
    return window.GoldAI.comptesTrading.formaterDollars(valeur);
  }

  function formaterDate(dateIso) {
    if (!dateIso) return "—";
    const [annee, mois, jour] = dateIso.split("-").map(Number);
    return `${jour} ${NOMS_MOIS_COURT[mois - 1]} ${annee}`;
  }

  function aujourdhuiIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function perteAujourdhuiPourCompte(idCompteTrading) {
    await window.GoldAI.journal.chargerTousLesTrades();
    const trades = window.GoldAI.journal.obtenirTradesBruts();
    const aujourdhui = aujourdhuiIso();
    return trades
      .filter((t) => t.compteTradingId === idCompteTrading && t.date === aujourdhui)
      .reduce((s, t) => s + t.resultat, 0);
  }

  async function creerCarteCompte(compte) {
    const perteAujourdhui = await perteAujourdhuiPourCompte(compte.id);
    const limites = window.GoldAI.comptesTrading.calculerLimites(compte, perteAujourdhui);

    const div = document.createElement("div");
    div.className = "carte-compte-trading";
    div.innerHTML = `
      <div class="entete-compte-trading">
        <div>
          <div class="nom-compte-trading">${compte.nom}</div>
          <div class="meta-compte-trading">${formaterDollars(compte.taille)} · actif depuis le ${formaterDate(compte.dateActivation)}</div>
        </div>
        <span class="badge-statut-compte ${compte.statut}">${compte.statut === "finance" ? "Financé" : "Challenge"}</span>
      </div>

      <div class="ligne-solde-compte">
        <span class="label-solde">Solde actuel</span>
        <span class="valeur-solde">${formaterDollars(compte.soldeActuel)}</span>
      </div>

      <div class="bloc-limite">
        <div class="entete-limite">
          <span>Daily Loss Limit (${compte.limitePerteQuotidiennePct}%)</span>
          <span>${formaterDollars(limites.dailyLossLimit)}</span>
        </div>
        <div class="barre-marge">
          <div class="barre-marge-remplie" style="width:${Math.min(100, (limites.margeAvantDLL / limites.dailyLossLimit) * 100 || 0)}%;"></div>
        </div>
        <div class="marge-restante">Marge restante aujourd'hui : ${formaterDollars(limites.margeAvantDLL)}</div>
      </div>

      <div class="bloc-limite">
        <div class="entete-limite">
          <span>Max Drawdown (${compte.limiteDrawdownMaxPct}%)</span>
          <span>seuil ${formaterDollars(limites.seuilMaxDrawdown)}</span>
        </div>
        <div class="barre-marge">
          <div class="barre-marge-remplie" style="width:${Math.min(100, (limites.margeAvantMaxDD / (compte.taille * compte.limiteDrawdownMaxPct / 100)) * 100 || 0)}%;"></div>
        </div>
        <div class="marge-restante">Marge restante avant Max Drawdown : ${formaterDollars(limites.margeAvantMaxDD)}</div>
      </div>

      <div class="actions-compte-trading">
        <button class="bouton secondaire bouton-petit" data-action="modifier">Modifier</button>
        <button class="bouton danger bouton-petit" data-action="supprimer">Supprimer</button>
      </div>
    `;

    div.querySelector('[data-action="modifier"]').addEventListener("click", () => ouvrirModaleCompte(compte));
    div.querySelector('[data-action="supprimer"]').addEventListener("click", () => confirmerSuppression(compte));

    return div;
  }

  async function rafraichirListe() {
    const conteneur = document.getElementById("liste-comptes-trading");
    conteneur.innerHTML = `<p class="etat-vide">Chargement…</p>`;

    const comptes = await window.GoldAI.comptesTrading.chargerComptes(true);
    if (comptes.length === 0) {
      conteneur.innerHTML = `<p class="etat-vide">Aucun compte de trading enregistré pour l'instant.</p>`;
      return;
    }

    conteneur.innerHTML = "";
    for (const compte of comptes) {
      conteneur.appendChild(await creerCarteCompte(compte));
    }
  }

  function ouvrirModaleCompte(compte) {
    idCompteEnEdition = compte ? compte.id : null;
    document.getElementById("modale-compte-trading-titre").textContent = compte ? "Modifier le compte" : "Ajouter un compte";
    document.getElementById("champ-nom-compte-trading").value = compte ? compte.nom : "";
    document.getElementById("champ-taille-compte-trading").value = compte ? compte.taille : "";
    document.getElementById("champ-solde-compte-trading").value = compte ? compte.soldeActuel : "";
    document.getElementById("champ-statut-compte-trading").value = compte ? compte.statut : "challenge";
    document.getElementById("champ-date-compte-trading").value = compte ? compte.dateActivation || "" : aujourdhuiIso();
    document.getElementById("champ-dll-compte-trading").value = compte ? compte.limitePerteQuotidiennePct : 5;
    document.getElementById("champ-maxdd-compte-trading").value = compte ? compte.limiteDrawdownMaxPct : 10;
    document.getElementById("modale-compte-trading").classList.add("visible");
  }

  function fermerModaleCompte() {
    document.getElementById("modale-compte-trading").classList.remove("visible");
    idCompteEnEdition = null;
  }

  async function sauvegarderCompte() {
    const champs = {
      nom: document.getElementById("champ-nom-compte-trading").value.trim(),
      taille: parseFloat(document.getElementById("champ-taille-compte-trading").value),
      soldeActuel: parseFloat(document.getElementById("champ-solde-compte-trading").value),
      statut: document.getElementById("champ-statut-compte-trading").value,
      dateActivation: document.getElementById("champ-date-compte-trading").value || null,
      limitePerteQuotidiennePct: parseFloat(document.getElementById("champ-dll-compte-trading").value) || 5,
      limiteDrawdownMaxPct: parseFloat(document.getElementById("champ-maxdd-compte-trading").value) || 10,
    };

    if (!champs.nom || isNaN(champs.taille) || isNaN(champs.soldeActuel)) {
      alert("Renseigne au moins le nom, la taille et le solde actuel du compte.");
      return;
    }

    // creerCompte renvoie l'id créé (ou null si erreur) ; modifierCompte renvoie true/false.
    const succes = idCompteEnEdition
      ? await window.GoldAI.comptesTrading.modifierCompte(idCompteEnEdition, champs)
      : (await window.GoldAI.comptesTrading.creerCompte(champs)) !== null;

    if (!succes) return; // erreur déjà signalée par le module (alert)

    fermerModaleCompte();
    await rafraichirListe();
  }

  async function confirmerSuppression(compte) {
    if (!confirm(`Supprimer le compte "${compte.nom}" ? Cette action est irréversible.`)) return;
    const ok = await window.GoldAI.comptesTrading.supprimerCompte(compte.id);
    if (ok) await rafraichirListe();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("bouton-ouvrir-comptes")?.addEventListener("click", async () => {
      document.getElementById("profil-accueil").classList.add("hidden");
      document.getElementById("profil-comptes").classList.remove("hidden");
      await rafraichirListe();
    });

    document.getElementById("bouton-retour-comptes")?.addEventListener("click", () => {
      document.getElementById("profil-comptes").classList.add("hidden");
      document.getElementById("profil-accueil").classList.remove("hidden");
    });

    document.getElementById("bouton-ajouter-compte-trading")?.addEventListener("click", () => ouvrirModaleCompte(null));
    document.getElementById("bouton-sauvegarder-compte-trading")?.addEventListener("click", sauvegarderCompte);
    document.getElementById("bouton-fermer-modale-compte-trading")?.addEventListener("click", fermerModaleCompte);
    document.getElementById("modale-compte-trading")?.addEventListener("click", (e) => {
      if (e.target.id === "modale-compte-trading") fermerModaleCompte();
    });
  });
})();
