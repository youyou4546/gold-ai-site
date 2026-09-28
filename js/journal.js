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

  // ---------------------------------------------------------------- Filtre « Compte »
  // Partagé par le Calendrier et la Performance : « tous », un compte
  // TradeLocker ("live|123"), ou « manuel » (trades saisis à la main).
  // Le garde-fou et l'objectif, eux, comptent toujours TOUS les trades.
  let filtreCompte = "tous";
  const cleFiltre = () => `goldai_filtre_compte_${window.GoldAI.auth.getNom() || "anonyme"}`;
  function lireFiltreMemorise() {
    try { filtreCompte = localStorage.getItem(cleFiltre()) || "tous"; } catch { filtreCompte = "tous"; }
  }

  // Comptes TradeLocker reliés (Profil › Mes comptes TradeLocker), chargés une fois par session.
  let comptesRelies = null;
  let chargementRelies = null;
  function chargerComptesRelies() {
    if (comptesRelies || chargementRelies) return chargementRelies;
    chargementRelies = window.GoldAI.auth.client.functions
      .invoke("tradelocker", { body: { token: token(), action: "comptes" } })
      .then(({ data }) => { comptesRelies = data?.comptes || []; })
      .catch(() => { comptesRelies = []; })
      .finally(() => { chargementRelies = null; });
    return chargementRelies;
  }

  let surnoms = {};
  async function chargerSurnoms() {
    try { surnoms = (await window.GoldAI.reglagesCalculateur.charger()).surnomsComptes || {}; } catch { surnoms = {}; }
  }

  function comptesDisponibles() {
    const noms = new Map((comptesRelies || []).map((c) => [c.cle, c.nom]));
    let manuels = false;
    (cacheTradesBruts || []).forEach((t) => {
      if (t.compteTl) noms.set(t.compteTl, t.compteTlNom || "Compte TradeLocker");
      else manuels = true;
    });
    const liste = [...noms].map(([cle, nom]) => ({ cle, nom: surnoms[cle] || nom })).sort((a, b) => a.nom.localeCompare(b.nom));
    if (manuels) liste.push({ cle: "manuel", nom: "Trades ajoutés à la main" });
    return liste;
  }

  function filtrerParCompte(trades) {
    if (filtreCompte === "tous") return trades || [];
    return (trades || []).filter((t) => (filtreCompte === "manuel" ? !t.compteTl : t.compteTl === filtreCompte));
  }

  // Menu « Compte » (toujours affiché) : tous les comptes, chaque compte TradeLocker
  // relié (même sans trade encore), et les trades ajoutés à la main.
  function afficherSelecteurCompte(idZone) {
    const zone = document.getElementById(idZone);
    if (!zone) return;
    const dessiner = () => {
      const comptes = comptesDisponibles();
      if (comptesRelies && filtreCompte !== "tous" && !comptes.some((c) => c.cle === filtreCompte)) filtreCompte = "tous";
      const esc = window.GoldAI.utils.esc;
      zone.classList.remove("hidden");
      zone.innerHTML = `<label for="${idZone}-choix">Compte</label>
        <select id="${idZone}-choix">
          <option value="tous">Tous les comptes</option>
          ${comptes.map((c) => `<option value="${esc(c.cle)}" ${c.cle === filtreCompte ? "selected" : ""}>${esc(c.nom)}</option>`).join("")}
        </select>
        ${comptesRelies && !comptesRelies.length ? `<p class="texte-attenue petit">Relie tes comptes dans Profil › Mes comptes TradeLocker pour les choisir ici.</p>` : ""}`;
    };
    dessiner();
    chargerSurnoms().then(dessiner);
    if (!comptesRelies) chargerComptesRelies()?.then(dessiner);
  }

  function changerFiltreCompte(valeur) {
    filtreCompte = valeur;
    try { localStorage.setItem(cleFiltre(), valeur); } catch { /* ignoré */ }
    window.dispatchEvent(new CustomEvent("goldai:filtre-compte"));
  }

  function sommeDuJour(tradesJour) {
    // Résultat net : frais déduits quand ils sont renseignés (comme dans Performance).
    return (tradesJour || []).reduce((total, t) => total + t.resultat - (t.frais || 0), 0);
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
      compteTl: trade.compte_tl || null,           // compte TradeLocker (trades importés)
      compteTlNom: trade.compte_tl_nom || null,
      instrument: trade.instrument || null,
      frais: trade.frais === null || trade.frais === undefined ? null : Number(trade.frais),
      prixEntree: trade.prix_entree === null || trade.prix_entree === undefined ? null : Number(trade.prix_entree),
      prixSortie: trade.prix_sortie === null || trade.prix_sortie === undefined ? null : Number(trade.prix_sortie),
      rr: trade.rr === null || trade.rr === undefined ? null : Number(trade.rr),
      nbImages: 0,
    }));

    // Nombre d'images par trade (📷 dans la liste). Sans le patch SQL : aucune image.
    const images = await client().rpc("compter_images_mes_trades", { p_token: token() });
    if (!images.error) {
      const parTrade = new Map((images.data || []).map((x) => [x.trade_id, x.nombre]));
      cacheTradesBruts.forEach((t) => { t.nbImages = parTrade.get(t.id) || 0; });
    }

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
    filtreCompte = "tous";
    comptesRelies = null;
    document.getElementById("journal-calendrier")?.classList.add("hidden");
    document.getElementById("journal-performance")?.classList.add("hidden");
    document.getElementById("journal-alertes")?.classList.add("hidden");
    document.getElementById("journal-accueil")?.classList.remove("hidden");
  }

  async function afficherMoisCourant() {
    const grille = document.getElementById("grille-calendrier");
    grille.innerHTML = `<p class="etat-vide" style="grid-column:1/-1;">Chargement…</p>`;

    const tousLesTrades = await chargerTousLesTrades();
    afficherSelecteurCompte("choix-compte-calendrier");

    document.getElementById("nom-mois-affiche").textContent = `${NOMS_MOIS[moisAffiche]} ${anneeAffichee}`;

    const premierJourDuMois = new Date(anneeAffichee, moisAffiche, 1);
    const nombreJoursDansLeMois = new Date(anneeAffichee, moisAffiche + 1, 0).getDate();

    // Grille sans samedi/dimanche (on ne trade pas ces jours-là) : 5 colonnes
    // L M M J V. Si le mois commence un week-end, aucune case vide n'est
    // nécessaire — la semaine suivante démarre proprement au lundi.
    const jourSemaineDebut = premierJourDuMois.getDay(); // 0=dimanche..6=samedi
    const decalageDebut = jourSemaineDebut >= 1 && jourSemaineDebut <= 5 ? jourSemaineDebut - 1 : 0;

    grille.innerHTML = "";

    for (let i = 0; i < decalageDebut; i++) {
      const caseVide = document.createElement("div");
      caseVide.className = "case-jour vide";
      grille.appendChild(caseVide);
    }

    let totalMois = 0;

    for (let jour = 1; jour <= nombreJoursDansLeMois; jour++) {
      const cle = cleDate(anneeAffichee, moisAffiche, jour);
      const tradesJour = filtrerParCompte(tousLesTrades[cle]);
      const somme = sommeDuJour(tradesJour);
      totalMois += somme; // compte quand même un trade éventuellement noté un week-end

      const jourSemaine = new Date(anneeAffichee, moisAffiche, jour).getDay();
      if (jourSemaine === 0 || jourSemaine === 6) continue; // pas de case pour samedi/dimanche

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

    await rafraichirListeTradesDuJour();
    document.getElementById("modale-jour").classList.add("visible");
  }

  async function rafraichirListeTradesDuJour() {
    const tousLesTrades = await chargerTousLesTrades();
    const tradesJour = filtrerParCompte(tousLesTrades[dateJourSelectionne]);
    const conteneur = document.getElementById("liste-trades-jour");

    if (tradesJour.length === 0) {
      conteneur.innerHTML = `<p class="etat-vide" style="padding:10px 0;">Aucun trade enregistré ce jour.</p>`;
      return;
    }

    const { esc } = window.GoldAI.utils;
    conteneur.innerHTML = "";
    const comptes = await window.GoldAI.comptesTrading.chargerComptes();
    tradesJour.forEach((trade) => {
      const item = document.createElement("div");
      item.className = "trade-item";
      const compte = comptes.find((c) => c.id === trade.compteTradingId);
      const details = [
        trade.instrument,
        compte?.nom,
        trade.rr !== null && trade.rr !== undefined ? `RR ${trade.rr}` : "",
        trade.frais ? `frais ${formaterDollars(-trade.frais)}` : "",
        trade.nbImages ? `📷 ${trade.nbImages}` : "",
      ].filter(Boolean).join(" · ");
      item.innerHTML = `
        <button type="button" class="infos-trade ouvrir-fiche" aria-label="Ouvrir la fiche de ce trade">
          <span class="resultat-trade ${trade.resultat >= 0 ? "positif" : "negatif"}">${formaterDollars(trade.resultat)}</span>
          ${details ? `<span class="note-trade">${esc(details)}</span>` : ""}
          ${trade.note ? `<span class="note-trade apercu-note">${esc(trade.note)}</span>` : ""}
        </button>
        <button type="button" class="supprimer-trade" aria-label="Supprimer ce trade">✕</button>
        <div class="confirmation-suppression hidden" role="alertdialog" aria-label="Confirmer la suppression">
          <span>Supprimer ce trade définitivement ?</span>
          <div class="boutons-confirmation">
            <button type="button" class="bouton secondaire bouton-petit" data-action="annuler">Annuler</button>
            <button type="button" class="bouton danger bouton-petit" data-action="confirmer">Supprimer</button>
          </div>
          <p class="avertissement-erreur" data-role="erreur"></p>
        </div>
      `;
      const zoneConfirm = item.querySelector(".confirmation-suppression");
      item.querySelector(".ouvrir-fiche").addEventListener("click", () => window.GoldAI.ficheTrade.ouvrir(trade));
      // stopPropagation : le clic sur ✕ ne doit rien déclencher d'autre (ouverture, fermeture de la fenêtre…).
      item.querySelector(".supprimer-trade").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        zoneConfirm.classList.remove("hidden");
        zoneConfirm.querySelector("[data-action=confirmer]").focus();
      });
      zoneConfirm.addEventListener("click", async (e) => {
        e.stopPropagation();
        const action = e.target.dataset.action;
        if (action === "annuler") zoneConfirm.classList.add("hidden");
        if (action !== "confirmer") return;
        const bouton = e.target;
        const zoneErreur = zoneConfirm.querySelector("[data-role=erreur]");
        bouton.disabled = true;
        bouton.textContent = "Suppression…";
        zoneErreur.classList.remove("visible");
        const resultat = await supprimerTrade(trade.id);
        if (!resultat.ok) {
          bouton.disabled = false;
          bouton.textContent = "Réessayer";
          zoneErreur.textContent = resultat.message;
          zoneErreur.classList.add("visible");
        }
      });
      conteneur.appendChild(item);
    });
  }

  // Appelé par la fiche (js/journal-fiche.js) après un enregistrement réussi :
  // met à jour le trade en mémoire (nouveau ou modifié), puis la liste du
  // jour, le calendrier et Performance.
  async function memoriserTrade(trade) {
    await chargerTousLesTrades();
    cacheTradesBruts = (cacheTradesBruts || []).filter((t) => t.id !== trade.id);
    cacheTradesBruts.push(trade);
    Object.keys(cacheTrades).forEach((jour) => {
      cacheTrades[jour] = cacheTrades[jour].filter((t) => t.id !== trade.id);
      if (cacheTrades[jour].length === 0) delete cacheTrades[jour];
    });
    (cacheTrades[trade.date] = cacheTrades[trade.date] || []).push(trade);

    if (dateJourSelectionne) await rafraichirListeTradesDuJour();
    await afficherMoisCourant();
    window.dispatchEvent(new CustomEvent("goldai:trades"));
  }

  // Renvoie { ok, message }. Le trade n'est retiré de l'écran QU'APRÈS
  // confirmation par le serveur : en cas d'échec il reste affiché.
  async function supprimerTrade(idTrade) {
    const session = token();
    let data, error;
    try {
      ({ data, error } = await client().rpc("supprimer_mon_trade", { p_token: session, p_trade_id: idTrade }));
    } catch {
      return { ok: false, message: "Connexion impossible : le trade est conservé. Vérifie ta connexion et réessaie." };
    }
    if (error) {
      if (error.message === "SESSION_INVALIDE") {
        window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi.");
        return { ok: false, message: "Session expirée." };
      }
      return { ok: false, message: "Le serveur a refusé la suppression : le trade est conservé. Réessaie." };
    }
    if (data === false) {
      await chargerTousLesTrades(true);
      await rafraichirListeTradesDuJour();
      await afficherMoisCourant();
      return { ok: false, message: "Ce trade n'existe plus côté serveur (déjà supprimé ?) : le journal a été rechargé." };
    }
    if (data !== true) {
      // Ancienne fonction serveur (ne dit pas si la ligne a été supprimée) : on vérifie en relisant.
      const verif = await client().rpc("lister_mes_trades", { p_token: session });
      if (verif.error || !Array.isArray(verif.data) || verif.data.some((t) => t.id === idTrade)) {
        return { ok: false, message: "Suppression non confirmée par le serveur : le trade est conservé." };
      }
    }
    if (token() !== session) return { ok: true };

    cacheTradesBruts = (cacheTradesBruts || []).filter((t) => t.id !== idTrade);
    if (cacheTrades) {
      Object.keys(cacheTrades).forEach((jour) => {
        cacheTrades[jour] = cacheTrades[jour].filter((t) => t.id !== idTrade);
        if (cacheTrades[jour].length === 0) delete cacheTrades[jour];
      });
    }
    await rafraichirListeTradesDuJour();
    await afficherMoisCourant();
    window.dispatchEvent(new CustomEvent("goldai:trades"));
    return { ok: true };
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

    document.getElementById("bouton-nouveau-trade").addEventListener("click", () => window.GoldAI.ficheTrade.ouvrir(null, dateJourSelectionne));
    document.getElementById("bouton-fermer-modale-jour").addEventListener("click", fermerModaleJour);
    document.getElementById("modale-jour").addEventListener("click", (evenement) => {
      if (evenement.target.id === "modale-jour") fermerModaleJour();
    });

    // Le calendrier des trades n'est chargé/affiché qu'au clic sur la tuile
    // "Calendrier" de l'accueil du journal (pas dès qu'on ouvre l'onglet Journal
    // — d'autres tuiles viendront s'ajouter à côté à l'avenir).
    // Le menu est redessiné à chaque affichage : on écoute sur sa zone.
    document.getElementById("choix-compte-calendrier")?.addEventListener("change", (e) => changerFiltreCompte(e.target.value));
    window.addEventListener("goldai:filtre-compte", () => {
      if (!document.getElementById("journal-calendrier").classList.contains("hidden")) afficherMoisCourant();
    });

    document.getElementById("bouton-ouvrir-calendrier-trades").addEventListener("click", () => {
      lireFiltreMemorise();
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
  window.GoldAI.journal = { afficherMoisCourant, viderCache, chargerTousLesTrades, obtenirTradesBruts, memoriserTrade,
    filtrerParCompte, afficherSelecteurCompte, changerFiltreCompte, lireFiltreMemorise,
    oublierComptesRelies: () => { comptesRelies = null; },
    filtreActuel: () => filtreCompte,
    // Comptes reliés avec leur solde (rechargés à la demande : le solde change).
    comptesReliesAJour: async () => { comptesRelies = null; await chargerComptesRelies(); return comptesRelies || []; },
    surnomDe: (cle) => surnoms[cle] || null };
})();
