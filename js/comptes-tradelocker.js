// Gold AI — Profil › Mes comptes TradeLocker : solde, équité, résultat du
// jour et trades ouverts (avec leur P&L en direct) de TOUS tes comptes
// TradeLocker. Les trades FERMÉS sont importés tout seuls dans le Journal
// (Supabase, toutes les 5 min et à l'ouverture de cette page) ; ils restent
// modifiables comme les autres. Données lues par la fonction Supabase
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
  }

  async function enregistrerSurnom(cle, nom) {
    const r = await window.GoldAI.reglagesCalculateur.charger();
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
      return `<li>
        <span><strong>${esc(surnom || c.nom)}</strong></span>
        <button type="button" class="bouton secondaire bouton-petit" data-renommer="${esc(c.cle)}">✏️ Renommer</button>
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
      <p class="texte-attenue petit">🔄 Tes trades fermés arrivent tout seuls dans le <strong>Journal</strong> (toutes les 5 min), modifiables comme les autres.
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

  // ---------------------------------------------------------------- Cycle de vie

  function ouvrir() {
    ["profil-accueil", "profil-parametres", "profil-comptes", "profil-mon-compte"].forEach((id) => $(id)?.classList.add("hidden"));
    $("profil-tradelocker").classList.remove("hidden");
    message("");
    enEdition = null;
    chargerSurnoms().then(() => { afficher(); afficherNoms(); });
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
      if (t.dataset.renommer) { enEdition = t.dataset.renommer; afficherNoms(); }
      else if (t.hasAttribute("data-annuler-renommer")) { enEdition = null; afficherNoms(); }
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
    $("contenu-tradelocker")?.addEventListener("click", (e) => {
      const t = e.target;
      if (t.id === "rafraichir-tradelocker") charger();
      else if (t.dataset.oublier) document.querySelector(`[data-confirmation="${CSS.escape(t.dataset.oublier)}"]`)?.classList.remove("hidden");
      else if (t.dataset.annulerOubli) document.querySelector(`[data-confirmation="${CSS.escape(t.dataset.annulerOubli)}"]`)?.classList.add("hidden");
      else if (t.dataset.confirmerOubli) supprimer(t.dataset.confirmerOubli);
    });
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ouverte()) charger(); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.comptesTradelocker = { ouvrir, viderCache };
})();
