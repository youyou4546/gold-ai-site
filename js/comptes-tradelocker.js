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
        <span><strong>${esc(surnom || c.nom)}</strong>${surnom ? `<br><span class="texte-attenue petit">${esc(c.nom)}</span>` : ""}</span>
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

  function carteCompte(c, env) {
    const d = c.devise;
    const positions = c.positions || [];
    const cle = `${env}|${c.id}`;
    const origine = `${c.nom || "Compte"} #${c.accNum}`;
    const surnom = surnoms[cle];
    const entete = `
        <div class="entete-compte-tl">
          <span>
            <strong>${esc(surnom || c.nom || "Compte")}</strong>
            ${surnom ? `<br><span class="texte-attenue petit">${esc(origine)}</span>` : ` <span class="texte-attenue">#${esc(c.accNum)}</span>`}
          </span>
          ${c.statut && c.statut !== "ACTIVE" ? `<span class="statut-compte-tl">${esc(c.statut)}</span>` : ""}
        </div>`;
    return `
      <div class="carte compte-tl">
        ${entete}
        ${c.erreur ? `<p class="alerte-donnees">${esc(c.erreur)}${c.detail ? `<br><span class="petit texte-attenue">Raison technique : ${esc(c.detail)}</span>` : ""}</p>` : ""}
        <div class="chiffres-trade">
          <div><span class="lib">Solde</span><span class="val">${argent(c.solde, d)}</span></div>
          <div><span class="lib">Équité</span><span class="val">${argent(c.equite, d)}</span></div>
          <div><span class="lib">Résultat du jour${c.jourTrades !== null && c.jourTrades !== undefined ? ` · ${c.jourTrades} trade${c.jourTrades > 1 ? "s" : ""}` : ""}</span><span class="val ${classe(c.jourNet)}">${argent(c.jourNet, d, true)}</span></div>
          <div><span class="lib">En cours (trades ouverts)</span><span class="val ${classe(c.ouvertNet)}">${argent(c.ouvertNet, d, true)}</span></div>
        </div>
        ${positions.length ? `
          <ul class="positions-tl">
            ${positions.map((p) => `
              <li>
                <span>${p.sens === "sell" ? "🔻" : "🔺"} <strong>${esc(p.symbole)}</strong> ${p.sens === "sell" ? "Vente" : "Achat"} ${U.nombre(p.lots, 2)} lot</span>
                <span class="texte-attenue">entrée ${p.prixEntree ?? "—"}</span>
                <span class="${classe(p.pnl)}">${argent(p.pnl, d, true)}</span>
              </li>`).join("")}
          </ul>` : c.erreur ? "" : `<p class="texte-attenue petit">Aucun trade ouvert.</p>`}
      </div>`;
  }

  function afficher() {
    const zone = $("contenu-tradelocker");
    if (!zone) return;
    if (!donnees && !erreur) { zone.innerHTML = `<p class="texte-attenue petit">Chargement de tes comptes…</p>`; return; }
    if (erreur && !donnees) { zone.innerHTML = `<p class="alerte-donnees">${esc(erreur)}</p>`; return; }

    const connexions = donnees.connexions || [];
    if (!connexions.length) {
      zone.innerHTML = `<div class="carte"><strong>Aucun compte connecté</strong><p class="texte-attenue petit">Ajoute ta connexion TradeLocker ci-dessous pour voir tous tes comptes ici : solde, résultat du jour et trades ouverts.</p></div>`;
      $("carte-ajout-tradelocker").open = true;
      return;
    }

    // Totaux (seulement si tous les comptes sont dans la même devise).
    const comptes = connexions.flatMap((c) => c.comptes || []).filter((c) => !c.erreur);
    const devises = [...new Set(comptes.map((c) => c.devise))];
    const somme = (cle) => comptes.reduce((s, c) => s + (Number(c[cle]) || 0), 0);
    const totaux = comptes.length > 1 && devises.length === 1 ? `
      <div class="carte">
        <strong>Tous mes comptes (${comptes.length})</strong>
        <div class="chiffres-trade">
          <div><span class="lib">Résultat du jour</span><span class="val ${classe(somme("jourNet"))}">${argent(somme("jourNet"), devises[0], true)}</span></div>
          <div><span class="lib">En cours</span><span class="val ${classe(somme("ouvertNet"))}">${argent(somme("ouvertNet"), devises[0], true)}</span></div>
        </div>
      </div>` : "";

    zone.innerHTML = `
      <p class="texte-attenue petit maj-tradelocker">${erreur ? `⚠️ ${esc(erreur)} — ` : ""}Mis à jour ${esc(U.heure(donnees.lu_le))} · toutes les 30 s
        <button type="button" class="lien-retour" id="rafraichir-tradelocker">Actualiser</button></p>
      <p class="texte-attenue petit">🔄 Tes trades fermés arrivent tout seuls dans le <strong>Journal</strong> (toutes les 5 min), modifiables comme les autres.
        ${donnees.importes24h ? `<strong>${donnees.importes24h}</strong> importé${donnees.importes24h > 1 ? "s" : ""} ces dernières 24 h.` : ""}
        Profit calculé sans commissions ni swap.</p>
      ${totaux}
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
          ${(cx.comptes || []).map((c) => carteCompte(c, cx.environnement)).join("")}
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
