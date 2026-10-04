// Gold AI — Profil › Mes comptes TradeLocker : solde, équité, résultat du
// jour et trades ouverts (avec leur P&L en direct) de TOUS tes comptes
// TradeLocker. Les trades FERMÉS sont importés dans le Journal au clic sur
// « Actualiser les trades » (Journal) seulement ; ils restent modifiables
// comme les autres. Données lues par la fonction Supabase
// « tradelocker » (supabase/functions/tradelocker, tables
// supabase/patch_comptes_tradelocker.sql et patch_import_tradelocker.sql).
// Lecture seule : l'app ne passe aucun ordre. Rafraîchi toutes les 30 s tant
// que la page est ouverte.
(() => {
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const RAFRAICHISSEMENT_MS = 30000;

  let donnees = null;     // réponse de « lister »
  let erreur = "";
  let environnement = "live";
  let minuterie = null;
  let enCours = false;
  let surnoms = {};        // { "live|123": "Compte principal" } — noms choisis dans l'app seulement
  let compteMaitre = "";   // clé du compte « maître » (suivi par la barre d'objectif)
  let statuts = {};        // { "live|123": { statut: "finance" | "evaluation", depuis: "AAAA-MM-JJ" } }
  let seuilEss = 20;
  let enEdition = null;    // clé du compte en train d'être renommé (pas de rafraîchissement pendant ce temps)

  const ouverte = () => !$("profil-tradelocker")?.classList.contains("hidden");

  // ---------------------------------------------------------------- Appels

  async function appeler(action, extra = {}) {
    const { data, error } = await window.GoldAI.auth.client.functions.invoke("tradelocker", {
      body: { token: window.GoldAI.auth.getToken(), action, ...extra },
    });
    if (!error) return data;
    let corps = null;
    try { corps = await error.context?.json(); } catch { /* pas de JSON */ }
    if (corps?.erreur === "SESSION_INVALIDE") window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi.");
    return { erreur: corps?.erreur === "PATCH_ABSENT"
      ? "Il manque la mise à jour Supabase : colle supabase/patch_comptes_tradelocker.sql dans Supabase › SQL Editor › Run."
      : corps?.erreur || "Connexion au serveur impossible. Vérifie ta connexion internet." };
  }

  let aRefaire = false;
  // Surnoms : enregistrés avec les paramètres du calculateur (même stockage par
  // utilisateur que l'objectif). Ne changent rien chez TradeLocker.
  async function chargerSurnoms() {
    const r = await window.GoldAI.reglagesCalculateur.charger();
    surnoms = { ...(r.surnomsComptes || {}) };
    compteMaitre = r.compteMaitre || "";
    statuts = { ...(r.statutsComptes || {}) };
    seuilEss = Number(r.seuilEss) > 0 ? Number(r.seuilEss) : 20;
  }

  // Compte maître : un seul à la fois (le choisir sur un compte le retire de l'ancien).
  // Enregistré par utilisateur avec les paramètres du calculateur.
  async function definirMaitre(cle) {
    const r = await window.GoldAI.reglagesCalculateur.charger({ forcer: true });
    compteMaitre = cle;
    await window.GoldAI.reglagesCalculateur.sauvegarder({ ...r, compteMaitre: cle }); // → la barre d'objectif se met à jour
    afficherNoms();
  }

  async function enregistrerStatut(cle, champs) {
    const r = await window.GoldAI.reglagesCalculateur.charger({ forcer: true });
    const tous = { ...(r.statutsComptes || {}) };
    tous[cle] = { ...(tous[cle] || {}), ...champs };
    statuts = tous;
    await window.GoldAI.reglagesCalculateur.sauvegarder({ ...r, statutsComptes: tous });
    afficherNoms();
  }

  async function enregistrerSurnom(cle, nom) {
    const r = await window.GoldAI.reglagesCalculateur.charger({ forcer: true });
    const tous = { ...(r.surnomsComptes || {}) };
    if (nom) tous[cle] = nom.slice(0, 40); else delete tous[cle]; // vide = nom d'origine
    await window.GoldAI.reglagesCalculateur.sauvegarder({ ...r, surnomsComptes: tous });
    surnoms = tous;
    enEdition = null;
    afficherNoms();
    afficher();
  }

  // ---------------------------------------------------------------- Section « Noms de mes comptes »
  // Liste légère des comptes reliés (action « comptes ») : marche même quand
  // les détails d'un compte ne se chargent pas.
  let comptesListe = null;
  async function chargerNoms() {
    const r = await appeler("comptes");
    comptesListe = r?.comptes || [];
    afficherNoms();
  }

  // ESS (Equity Stability Score) de chaque compte (Financé ou Évaluation), calculé avec
  // les trades du journal liés à ce compte (pour un Financé : depuis la date de passage
  // en Financé si indiquée ; pour une Évaluation : tous ses trades).
  function blocEss(cle) {
    const st = statuts[cle] || {};
    const depuis = st.statut === "finance" ? st.depuis : null;
    const trades = (window.GoldAI.journal.obtenirTradesBruts() || [])
      .filter((t) => t.compteTl === cle && (!depuis || t.date >= depuis));
    const e = window.GoldAI.noyau.calculerEss(trades, seuilEss);
    const m = (v, signe = false) => U.montant(v, "USD", { signe });
    const pct = (v) => `${(Math.round(v * 100) / 100).toLocaleString("fr-FR")} %`;
    const seuil = pct(e.seuil);
    const general = "Équilibre tes jours gagnants et perdants, évite les trades surdimensionnés, et vise une croissance régulière plutôt que des pics.";
    const rappel = `<p class="texte-attenue petit">ℹ️ Score calculé avec les trades entrés dans le journal, pas une donnée officielle NOVA : il peut différer s'il manque des trades. Même avec un ESS conforme, les autres règles de paiement doivent aussi être respectées (montant minimum de retrait, pas de brèche du compte, etc.).</p>`;
    if (!e.nbJours) {
      return `<div class="bloc-ess"><div class="entete-ess"><span>ESS</span><strong>—</strong></div>
        <p class="petit">Aucun trade de ce compte dans le journal${depuis ? " depuis le passage en Financé" : ""}.</p>${rappel}</div>`;
    }
    const details = `<div class="details-ess">
        <span>Plus grand jour gagnant <strong>${m(e.maxGain, true)}</strong></span>
        <span>Plus grande journée de perte <strong>${m(-e.maxPerte)}</strong></span>
        <span>Bénéfice net total <strong>${m(e.total, true)}</strong></span>
        <span>${e.nbJours} jour${e.nbJours > 1 ? "s" : ""} de trading</span>
      </div>`;
    if (!e.calculable) {
      return `<div class="bloc-ess ko"><div class="entete-ess"><span>ESS</span><strong>non calculable</strong></div>${details}
        <p class="petit">Ton bénéfice net total n'est pas positif : l'ESS ne peut pas encore être calculé. Il te faut au moins ${m(e.requis)} de bénéfice net total pour être sous ${seuil}, sans battre ta plus grande journée gagnante ou perdante actuelle.</p>
        <p class="texte-attenue petit">💡 ${general}</p>${rappel}</div>`;
    }
    const conseil = e.eligible
      ? `Tu es en dessous de ${seuil}, éligible selon ce critère. Marge avant de le dépasser : ${m(e.marge)} de bénéfice net total en plus, sans battre ta plus grande journée gagnante ou perdante actuelle.`
      : `Il te faut au moins ${m(e.manque)} de bénéfice net total en plus pour redescendre sous ${seuil}, sans battre ta plus grande journée gagnante ou perdante actuelle.`;
    return `<div class="bloc-ess ${e.eligible ? "ok" : "ko"}">
      <div class="entete-ess"><span>ESS <span class="texte-attenue petit">· seuil ${seuil}</span></span><strong>${pct(e.ess)}</strong></div>
      ${details}
      <p class="petit">${esc(conseil)}</p>
      <p class="texte-attenue petit">💡 ${general}</p>
      ${rappel}
    </div>`;
  }

  function afficherNoms() {
    const bloc = $("noms-comptes-tradelocker");
    if (!bloc) return;
    bloc.classList.toggle("hidden", !comptesListe?.length);
    $("liste-noms-tradelocker").innerHTML = (comptesListe || []).map((c) => {
      const surnom = surnoms[c.cle];
      if (enEdition === c.cle) {
        return `<li>
          <form class="renommer-compte-tl" data-renommer-form="${esc(c.cle)}">
            <input type="text" maxlength="40" value="${esc(surnom || "")}" placeholder="${esc(c.nom)}" aria-label="Nouveau nom pour ${esc(c.nom)}">
            <button type="submit" class="bouton bouton-petit">OK</button>
            <button type="button" class="bouton secondaire bouton-petit" data-annuler-renommer>Annuler</button>
          </form>
          <span class="texte-attenue petit">Laisse vide pour revenir à « ${esc(c.nom)} ».</span>
        </li>`;
      }
      const maitre = compteMaitre === c.cle;
      const st = statuts[c.cle] || {};
      const finance = st.statut === "finance";
      return `<li class="compte-tl-ligne">
        <span class="nom-compte-tl"><strong>${esc(surnom || c.nom)}</strong>
          ${maitre ? `<span class="badge-maitre">⭐ Maître</span>` : ""}
          <span class="badge-statut-compte ${finance ? "finance" : "challenge"}">${finance ? "Financé" : "Évaluation"}</span></span>
        <span class="actions-compte-tl">
          ${maitre ? "" : `<button type="button" class="bouton secondaire bouton-petit" data-maitre="${esc(c.cle)}">⭐ Compte maître</button>`}
          <button type="button" class="bouton secondaire bouton-petit" data-renommer="${esc(c.cle)}">✏️ Renommer</button>
        </span>
        <div class="reglage-statut-tl">
          <label>Statut
            <select data-statut="${esc(c.cle)}">
              <option value="evaluation" ${finance ? "" : "selected"}>Évaluation / challenge</option>
              <option value="finance" ${finance ? "selected" : ""}>Financé</option>
            </select></label>
          ${finance ? `<label>Financé depuis le <input type="date" data-depuis="${esc(c.cle)}" value="${esc(st.depuis || "")}"></label>` : ""}
        </div>
        ${blocEss(c.cle)}
      </li>`;
    }).join("");
    $("liste-noms-tradelocker").querySelector("[data-renommer-form] input")?.focus();
  }

  async function charger() {
    if (enCours) { aRefaire = true; return; } // une lecture est déjà en route : on relira juste après
    enCours = true;
    const r = await appeler("lister");
    enCours = false;
    if (r?.erreur) erreur = r.erreur;
    else {
      // Nouveaux trades importés : le Journal (calendrier, performance, garde-fou) se met à jour.
      if (donnees && r.importes24h !== donnees.importes24h) {
        await window.GoldAI.journal.chargerTousLesTrades(true);
        window.dispatchEvent(new CustomEvent("goldai:trades"));
      }
      donnees = r; erreur = "";
    }
    afficher();
    if (aRefaire) { aRefaire = false; charger(); }
  }

  async function ajouter(e) {
    e.preventDefault();
    const bouton = $("bouton-ajouter-tradelocker");
    message("");
    bouton.disabled = true;
    bouton.textContent = "Vérification auprès de TradeLocker…";
    const r = await appeler("ajouter", {
      environnement, email: $("tl-email").value.trim(), motDePasse: $("tl-mot-de-passe").value, serveur: $("tl-serveur").value.trim(),
    });
    bouton.disabled = false;
    bouton.textContent = "Connecter";
    if (r?.erreur) return message(r.erreur);
    $("formulaire-tradelocker").reset();
    window.GoldAI.journal.oublierComptesRelies?.();
    $("carte-ajout-tradelocker").open = false;
    chargerNoms();
    await charger();
  }

  async function supprimer(id) {
    await appeler("supprimer", { id });
    window.GoldAI.journal.oublierComptesRelies?.();
    chargerNoms();
    await charger();
  }

  // ---------------------------------------------------------------- Affichage

  function message(texte) {
    $("message-tradelocker").textContent = texte;
    $("message-tradelocker").classList.toggle("hidden", !texte);
  }

  const argent = (v, devise, signe = false) => (v === null || v === undefined ? "—" : U.montant(v, devise || "USD", { signe }));
  const classe = (v) => (v > 0 ? "positif" : v < 0 ? "negatif" : "");

  // Une ligne par compte : son nom (ou le nom choisi dans l'app) et son solde actuel.
  function ligneCompte(c, env) {
    const cle = `${env}|${c.id}`;
    const origine = `${c.nom || "Compte"} #${c.accNum}`;
    const surnom = surnoms[cle];
    return `
      <li>
        <span><strong>${esc(surnom || origine)}</strong>
          ${c.statut && c.statut !== "ACTIVE" ? ` <span class="statut-compte-tl">${esc(c.statut)}</span>` : ""}</span>
        <span class="solde-compte-tl">${argent(c.solde, c.devise)}</span>
      </li>`;
  }

  function afficher() {
    const zone = $("contenu-tradelocker");
    if (!zone) return;
    if (!donnees && !erreur) { zone.innerHTML = `<p class="texte-attenue petit">Chargement de tes comptes…</p>`; return; }
    if (erreur && !donnees) { zone.innerHTML = `<p class="alerte-donnees">${esc(erreur)}</p>`; return; }

    const connexions = donnees.connexions || [];
    if (!connexions.length) {
      zone.innerHTML = `<div class="carte"><strong>Aucun compte connecté</strong><p class="texte-attenue petit">Ajoute ta connexion TradeLocker ci-dessous pour voir le solde de tous tes comptes ici.</p></div>`;
      $("carte-ajout-tradelocker").open = true;
      return;
    }

    // Solde total (seulement si tous les comptes sont dans la même devise).
    const comptes = connexions.flatMap((c) => c.comptes || []).filter((c) => c.solde !== null && c.solde !== undefined);
    const devises = [...new Set(comptes.map((c) => c.devise))];
    const total = devises.length === 1 ? `
      <div class="carte solde-total-tl">
        <span class="lib">Solde total${comptes.length > 1 ? ` · ${comptes.length} comptes` : ""}</span>
        <span class="val">${argent(comptes.reduce((t, c) => t + Number(c.solde), 0), devises[0])}</span>
      </div>` : "";

    zone.innerHTML = `
      <p class="texte-attenue petit maj-tradelocker">${erreur ? `⚠️ ${esc(erreur)} — ` : ""}Mis à jour ${esc(U.heure(donnees.lu_le))} · toutes les 30 s
        <button type="button" class="lien-retour" id="rafraichir-tradelocker">Actualiser</button></p>
      <p class="texte-attenue petit">🔄 Pour ajouter tes trades fermés au <strong>Journal</strong>, appuie sur « Actualiser les trades » dans le Journal. Ils restent modifiables comme les autres.
        ${donnees.importes24h ? `<strong>${donnees.importes24h}</strong> importé${donnees.importes24h > 1 ? "s" : ""} ces dernières 24 h.` : ""}
        Profit calculé sans commissions ni swap.</p>
      ${total}
      ${connexions.map((cx) => `
        <div class="groupe-connexion-tl">
          <div class="entete-connexion-tl">
            <span class="texte-attenue petit">${esc(cx.email)} · ${esc(cx.serveur)} · ${cx.environnement === "live" ? "Réel" : "Démo"}</span>
            <button type="button" class="lien-retour" data-oublier="${esc(cx.id)}">Retirer</button>
          </div>
          <div class="confirmation-arret hidden" data-confirmation="${esc(cx.id)}">
            <span>Retirer cette connexion de l'app ? (Tes comptes TradeLocker ne sont pas touchés.)</span>
            <div class="boutons-confirmation">
              <button type="button" class="bouton secondaire bouton-petit" data-annuler-oubli="${esc(cx.id)}">Non</button>
              <button type="button" class="bouton danger bouton-petit" data-confirmer-oubli="${esc(cx.id)}">Oui, retirer</button>
            </div>
          </div>
          ${cx.erreur ? `<p class="alerte-donnees">${esc(cx.erreur)}</p>` : ""}
          ${(cx.comptes || []).length ? `<ul class="carte liste-soldes-tl">${cx.comptes.map((c) => ligneCompte(c, cx.environnement)).join("")}</ul>` : ""}
        </div>`).join("")}`;
  }

  // ---------------------------------------------------------------- Trades supprimés → Réimporter

  let supprimes = [];
  async function chargerSupprimes() {
    const r = await appeler("supprimes");
    supprimes = r?.trades || [];
    afficherSupprimes();
  }

  function afficherSupprimes() {
    const carte = $("carte-supprimes-tl");
    if (!carte) return;
    carte.classList.toggle("hidden", !supprimes.length);
    $("nb-supprimes-tl").textContent = supprimes.length ? `(${supprimes.length})` : "";
    $("liste-supprimes-tl").innerHTML = supprimes.map((t) => {
      const nom = surnoms[t.compteTl] || window.GoldAI.journal.obtenirTradesBruts().find((x) => x.compteTl === t.compteTl)?.compteTlNom || t.compteTl;
      return `<li>
        <span><strong class="${t.resultat >= 0 ? "positif" : "negatif"}">${argent(t.resultat, "USD", true)}</strong>
          <span class="texte-attenue petit">· ${esc(nom)} · fermé le ${esc(U.jourHeure(Date.parse(t.fermeLe)))} · ${t.positions} position${t.positions > 1 ? "s" : ""}</span></span>
        <button type="button" class="bouton secondaire bouton-petit" data-reimporter="${esc(t.tradeId)}">↩️ Réimporter</button>
      </li>`;
    }).join("");
  }

  async function reimporterTrade(bouton) {
    const zone = $("message-supprimes-tl");
    if (bouton.disabled) return; // double appui
    bouton.disabled = true;
    bouton.textContent = "Réimport…";
    const r = await appeler("reimporter", { tradeId: bouton.dataset.reimporter });
    zone.classList.remove("hidden");
    if (r?.erreur) {
      zone.textContent = r.erreur;
      bouton.disabled = false;
      bouton.textContent = "↩️ Réimporter";
      return;
    }
    zone.textContent = r.importes ? "✓ Trade remis dans le Journal." : "TradeLocker n'a pas renvoyé ce trade pour l'instant : réessaie dans quelques minutes.";
    await window.GoldAI.journal.chargerTousLesTrades(true);
    window.dispatchEvent(new CustomEvent("goldai:trades")); // calendrier, objectif, garde-fou, ESS
    await chargerSupprimes();
  }

  // ---------------------------------------------------------------- Cycle de vie

  function ouvrir() {
    ["profil-accueil", "profil-parametres", "profil-mon-compte"].forEach((id) => $(id)?.classList.add("hidden"));
    $("profil-tradelocker").classList.remove("hidden");
    message("");
    enEdition = null;
    chargerSurnoms().then(() => { afficher(); afficherNoms(); });
    // Trades du journal : nécessaires au calcul de l'ESS de chaque compte.
    window.GoldAI.journal.chargerTousLesTrades().then(afficherNoms);
    supprimes = []; afficherSupprimes();
    chargerSupprimes();
    chargerNoms();
    afficher();
    charger();
    clearInterval(minuterie);
    minuterie = setInterval(() => { if (ouverte() && !document.hidden) charger(); }, RAFRAICHISSEMENT_MS);
  }

  function fermer() {
    clearInterval(minuterie);
    $("profil-tradelocker").classList.add("hidden");
    $("profil-accueil").classList.remove("hidden");
  }

  function viderCache() {
    donnees = null; erreur = "";
    clearInterval(minuterie);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("bouton-ouvrir-tradelocker")?.addEventListener("click", ouvrir);
    $("bouton-retour-tradelocker")?.addEventListener("click", fermer);
    $("formulaire-tradelocker")?.addEventListener("submit", ajouter);
    $("liste-noms-tradelocker")?.addEventListener("click", (e) => {
      const t = e.target;
      if (t.dataset.maitre) definirMaitre(t.dataset.maitre);
      else if (t.dataset.renommer) { enEdition = t.dataset.renommer; afficherNoms(); }
      else if (t.hasAttribute("data-annuler-renommer")) { enEdition = null; afficherNoms(); }
    });
    $("liste-noms-tradelocker")?.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.statut) enregistrerStatut(t.dataset.statut, { statut: t.value });
      else if (t.dataset.depuis !== undefined) enregistrerStatut(t.dataset.depuis, { depuis: t.value || null });
    });
    $("liste-noms-tradelocker")?.addEventListener("submit", (e) => {
      const form = e.target.closest("[data-renommer-form]");
      if (!form) return;
      e.preventDefault();
      enregistrerSurnom(form.dataset.renommerForm, form.querySelector("input").value.trim());
    });
    document.querySelectorAll("#formulaire-tradelocker .segmente button").forEach((b) => b.addEventListener("click", () => {
      environnement = b.dataset.env;
      document.querySelectorAll("#formulaire-tradelocker .segmente button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
    $("liste-supprimes-tl")?.addEventListener("click", (e) => { if (e.target.dataset.reimporter) reimporterTrade(e.target); });
    $("contenu-tradelocker")?.addEventListener("click", (e) => {
      const t = e.target;
      if (t.id === "rafraichir-tradelocker") charger();
      else if (t.dataset.oublier) document.querySelector(`[data-confirmation="${CSS.escape(t.dataset.oublier)}"]`)?.classList.remove("hidden");
      else if (t.dataset.annulerOubli) document.querySelector(`[data-confirmation="${CSS.escape(t.dataset.annulerOubli)}"]`)?.classList.add("hidden");
      else if (t.dataset.confirmerOubli) supprimer(t.dataset.confirmerOubli);
    });
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ouverte()) charger(); });
  // Nouveau trade (ajouté, modifié, supprimé ou importé) : l'ESS est recalculé.
  window.addEventListener("goldai:trades", () => { if (ouverte() && !enEdition) afficherNoms(); });
  // Seuil ESS changé dans Profil › Général.
  window.addEventListener("goldai:reglages-calculateur", () => { if (ouverte() && !enEdition) chargerSurnoms().then(afficherNoms); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.comptesTradelocker = { ouvrir, viderCache };
})();
