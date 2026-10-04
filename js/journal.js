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

  // Version courte pour les cases du calendrier : sans centimes à partir de 1 000 $
  // (sinon le montant déborde de la case sur un téléphone).
  function formaterDollarsCourt(valeur) {
    if (Math.abs(valeur) < 1000) return formaterDollars(valeur);
    const signe = valeur < 0 ? "-" : "+";
    return `${signe}$${Math.round(Math.abs(valeur)).toLocaleString("fr-FR")}`;
  }

  // ---------------------------------------------------------------- Filtre « Compte »
  // Partagé par le Calendrier et la Performance : « tous », un compte
  // TradeLocker ("live|123"), ou « manuel » (trades saisis à la main).
  // Le garde-fou et l'objectif, eux, comptent toujours TOUS les trades.
  let filtreCompte = "tous";
  const cleFiltre = () => `goldai_filtre_compte_${window.GoldAI.auth.getNom() || "anonyme"}`;
  // Sans choix mémorisé sur cet appareil : le compte maître (Mes comptes), pour
  // que le calendrier montre les mêmes trades que la barre d'objectif.
  function lireFiltreMemorise() {
    let memorise = null;
    try { memorise = localStorage.getItem(cleFiltre()); } catch { /* ignoré */ }
    // Sans choix mémorisé, on garde le compte maître déjà appliqué (sinon :
    // « tous » → compte maître → événement → relecture → « tous »… en boucle).
    filtreCompte = memorise || (filtreCompte !== "manuel" ? filtreCompte : "tous");
    if (!memorise) {
      window.GoldAI.reglagesCalculateur.charger().then((r) => {
        if (!r.compteMaitre || filtreCompte !== "tous") return;
        filtreCompte = r.compteMaitre; // pas mémorisé : suit le compte maître s'il change
        window.dispatchEvent(new CustomEvent("goldai:filtre-compte"));
      }).catch(() => {});
    }
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

  // Pour la fiche de trade (menu « Compte ») : les comptes TradeLocker reliés,
  // avec le nom choisi dans l'app et le nom d'origine (enregistré avec le trade).
  async function comptesPourFiche() {
    await Promise.all([chargerSurnoms(), comptesRelies ? null : chargerComptesRelies()]);
    return (comptesRelies || []).map((c) => ({ cle: c.cle, nom: surnoms[c.cle] || c.nom, nomOrigine: c.nom }));
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
      ouvertLe: trade.ouvert_le || null,           // heure d'ouverture du signal (trades importés)
      sens: trade.sens || null,
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
    document.querySelectorAll(".message-actualiser-trades").forEach((m) => { m.textContent = ""; });
    document.getElementById("journal-calendrier")?.classList.add("hidden");
    document.getElementById("journal-performance")?.classList.add("hidden");
    document.getElementById("journal-analyse")?.classList.add("hidden");
    document.getElementById("journal-ess")?.classList.add("hidden");
    document.getElementById("journal-accueil")?.classList.remove("hidden");
  }

  async function afficherMoisCourant() {
    const grille = document.getElementById("grille-calendrier");
    grille.innerHTML = `<p class="etat-vide" style="grid-column:1/-1;">Chargement…</p>`;

    const tousLesTrades = await chargerTousLesTrades();
    afficherSelecteurCompte("choix-compte-calendrier");

    document.getElementById("nom-mois-affiche").textContent = `${NOMS_MOIS[moisAffiche]} ${anneeAffichee}`;

    const nombreJoursDansLeMois = new Date(anneeAffichee, moisAffiche + 1, 0).getDate();

    // Grille sans samedi/dimanche (on ne trade pas ces jours-là). Chaque ligne va
    // du lundi au vendredi, même si la semaine déborde sur le mois d'avant ou
    // d'après (ces jours-là sont grisés), puis une case « total de la semaine ».
    // Première ligne : la semaine du 1er (ou la suivante si le 1er tombe un week-end).
    const premier = new Date(anneeAffichee, moisAffiche, 1);
    const lundi = new Date(premier);
    const js = premier.getDay(); // 0=dimanche..6=samedi
    lundi.setDate(1 + (js === 0 ? 1 : js === 6 ? 2 : 1 - js));
    const dernier = new Date(anneeAffichee, moisAffiche, nombreJoursDansLeMois);

    grille.innerHTML = "";
    const maintenant = new Date(); // relu à chaque affichage : l'app peut rester ouverte après minuit
    const cleAujourdhui = cleDate(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());

    let totalMois = 0;
    // Compte quand même un trade éventuellement noté un week-end.
    for (let jour = 1; jour <= nombreJoursDansLeMois; jour++) {
      totalMois += sommeDuJour(filtrerParCompte(tousLesTrades[cleDate(anneeAffichee, moisAffiche, jour)]));
    }

    while (lundi <= dernier) {
      let totalSemaine = 0;
      let tradesSemaine = 0;
      for (let k = 0; k < 7; k++) {
        const d = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + k);
        const cle = cleDate(d.getFullYear(), d.getMonth(), d.getDate());
        const tradesJour = filtrerParCompte(tousLesTrades[cle]);
        const somme = sommeDuJour(tradesJour);
        totalSemaine += somme; // samedi/dimanche compris, sans case à eux
        tradesSemaine += tradesJour.length;
        if (k >= 5) continue;

        const caseJour = document.createElement("div");
        caseJour.className = "case-jour";
        if (d.getMonth() !== moisAffiche) caseJour.classList.add("autre-mois");
        if (somme > 0) caseJour.classList.add("jour-gain");
        if (somme < 0) caseJour.classList.add("jour-perte");
        if (cle === cleAujourdhui) caseJour.classList.add("aujourdhui");
        caseJour.innerHTML = `
          <span class="numero-jour">${d.getDate()}</span>
          ${tradesJour.length > 0 ? `<span class="resultat-jour">${formaterDollarsCourt(somme)}</span>` : ""}
        `;
        caseJour.addEventListener("click", () => ouvrirModaleJour(cle));
        grille.appendChild(caseJour);
      }

      const caseSemaine = document.createElement("div");
      caseSemaine.className = "case-jour case-semaine";
      if (tradesSemaine && totalSemaine > 0) caseSemaine.classList.add("jour-gain");
      if (tradesSemaine && totalSemaine < 0) caseSemaine.classList.add("jour-perte");
      caseSemaine.innerHTML = `
        <span class="numero-jour">Sem.</span>
        <span class="resultat-jour">${tradesSemaine ? formaterDollarsCourt(totalSemaine) : "—"}</span>
      `;
      grille.appendChild(caseSemaine);

      lundi.setDate(lundi.getDate() + 7);
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
    tradesJour.forEach((trade) => {
      const item = document.createElement("div");
      item.className = "trade-item";
      const details = [
        trade.instrument,
        trade.compteTl ? surnoms[trade.compteTl] || trade.compteTlNom : "",
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

  // « Actualiser les trades » : va chercher les trades fermés sur TradeLocker
  // UNIQUEMENT à ce moment-là (plus d'import automatique). Le serveur retient
  // chaque position déjà importée : recliquer n'ajoute jamais un trade deux fois.
  let actualisationEnCours = false;
  async function actualiserTrades() {
    if (actualisationEnCours || !token()) return;
    actualisationEnCours = true;
    const boutons = document.querySelectorAll(".bouton-actualiser-trades");
    const messages = document.querySelectorAll(".message-actualiser-trades");
    const ecrire = (texte, classe = "") => messages.forEach((m) => { m.textContent = texte; m.className = `texte-attenue petit message-actualiser-trades ${classe}`; });
    boutons.forEach((b) => { b.disabled = true; b.textContent = "⏳ Recherche sur TradeLocker…"; });
    ecrire("");
    try {
      const { data, error } = await client().functions.invoke("tradelocker", { body: { token: token(), action: "importer" } });
      let corps = data;
      if (error) { try { corps = await error.context?.json(); } catch { corps = null; } }
      if (corps?.erreur === "SESSION_INVALIDE") { window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi."); return; }
      if (error || !corps?.ok) {
        ecrire(corps?.erreur && corps.erreur !== "PATCH_ABSENT" ? corps.erreur : "Impossible de joindre le serveur. Vérifie ta connexion et réessaie.", "erreur");
        return;
      }
      await chargerTousLesTrades(true);
      window.dispatchEvent(new CustomEvent("goldai:trades"));
      const n = corps.importes || 0;
      const texte = n ? `✓ ${n} nouveau${n > 1 ? "x" : ""} trade${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""} au journal.` : "✓ Aucun nouveau trade : ton journal est à jour.";
      const heure = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      ecrire(`${texte} (${heure})${corps.erreurs?.length ? ` — ${corps.erreurs.join(" ")}` : ""}`, corps.erreurs?.length ? "erreur" : "ok");
    } catch {
      ecrire("Impossible de joindre le serveur. Vérifie ta connexion et réessaie.", "erreur");
    } finally {
      actualisationEnCours = false;
      boutons.forEach((b) => { b.disabled = false; b.textContent = "🔄 Actualiser les trades"; });
    }
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

    document.querySelectorAll(".bouton-actualiser-trades").forEach((b) => b.addEventListener("click", actualiserTrades));

    // Trades ajoutés depuis un autre appareil : le Journal se relit (base de
    // l'app seulement, pas TradeLocker) quand il est affiché, toutes les 30 s.
    async function relireSiAffiche() {
      if (document.hidden || !window.GoldAI.auth.getToken()) return;
      if (!document.getElementById("section-journal")?.classList.contains("actif")) return;
      const avant = (cacheTradesBruts || []).length;
      await chargerTousLesTrades(true);
      if ((cacheTradesBruts || []).length !== avant) window.dispatchEvent(new CustomEvent("goldai:trades"));
    }
    setInterval(relireSiAffiche, 30000);
    document.addEventListener("visibilitychange", relireSiAffiche);
    window.addEventListener("goldai:trades", () => {
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
    filtrerParCompte, afficherSelecteurCompte, changerFiltreCompte, lireFiltreMemorise, comptesPourFiche,
    oublierComptesRelies: () => { comptesRelies = null; },
    filtreActuel: () => filtreCompte,
    // Comptes reliés avec leur solde (rechargés à la demande : le solde change).
    comptesReliesAJour: async () => { comptesRelies = null; await chargerComptesRelies(); return comptesRelies || []; },
    surnomDe: (cle) => surnoms[cle] || null };
})();
