// Gold AI — Profil › Mes comptes : comptes MT5 (ex. FundedNext) en LECTURE SEULE.
//
// Chaque utilisateur ajoute ses comptes ici (numéro, serveur, mot de passe
// INVESTISSEUR, chiffré dans Supabase : connexions_mt5). Le PC (site/sync_mt5.py)
// les lit toutes les 5 min avec MetaTrader 5 et publie leurs chiffres (table
// comptes_mt5, seulement pour la personne connectée). Ici : solde, résultat du
// jour, marge avant rupture, perte max du jour restante, progression vers l'objectif.
(() => {
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const argent = (v, d = "USD", signe = false) => U.montant(v, d, { signe });
  const r2 = (x) => Math.round(x * 100) / 100;

  let comptes = null;
  let connexions = [];
  let erreur = null;
  let message = null; // { texte, ok } après un ajout / un retrait

  const rpc = (nom, params = {}) => window.GoldAI.auth.client.rpc(nom, { p_token: window.GoldAI.auth.getToken(), ...params });

  async function charger() {
    const [lus, cx] = await Promise.all([rpc("lire_mes_comptes_mt5"), rpc("lister_mes_connexions_mt5")]);
    erreur = lus.error ? "Comptes MT5 illisibles pour l'instant." : null;
    if (!lus.error) comptes = lus.data || [];
    if (!cx.error) connexions = cx.data || [];
    afficher();
  }

  async function ajouter(form) {
    const v = (n) => form.elements[n].value.trim();
    const num = (n) => (v(n) === "" ? null : Number(v(n).replace(/\s/g, "").replace(",", ".")));
    const bouton = form.querySelector("button[type=submit]");
    if (bouton.disabled) return; // déjà en cours d'envoi
    bouton.disabled = true;
    const { error } = await rpc("ajouter_connexion_mt5", {
      p_login: num("login"), p_serveur: v("serveur"), p_mdp: form.elements.mdp.value, p_nom: v("nom"),
      p_depart: num("depart"), p_perte_max: num("perte_max"), p_perte_jour: num("perte_jour"), p_objectif_pct: num("objectif_pct"),
    });
    bouton.disabled = false;
    if (error) {
      message = { ok: false, texte: /CHAMPS_MANQUANTS/.test(error.message || "") ? "Numéro du compte, serveur et mot de passe investisseur sont obligatoires." : "Ajout impossible pour l'instant, réessaie." };
    } else {
      form.reset();
      message = { ok: true, texte: "✓ Compte ajouté. Ses chiffres apparaîtront ici dans 5 min au plus." };
    }
    document.activeElement?.blur();
    await charger();
  }

  async function retirer(id) {
    await rpc("supprimer_connexion_mt5", { p_id: id });
    message = { ok: true, texte: "Compte retiré de l'app (rien n'est touché chez le courtier)." };
    await charger();
  }

  // Calculs à partir des chiffres publiés par le PC.
  function etat(c) {
    const plancher = c.depart - c.perteMax;                       // niveau de rupture (perte max totale)
    const marge = r2(c.equite - plancher);
    const perteJourFaite = Math.max(0, r2(c.soldeDebutJour - c.equite));
    const resteJour = r2(c.perteJour - perteJourFaite);
    const cible = r2(c.depart * (1 + c.objectifPct / 100));
    const resteObjectif = r2(cible - c.solde);
    const progression = c.objectifPct > 0 ? Math.max(0, Math.min(100, ((c.solde - c.depart) / (cible - c.depart)) * 100)) : null;
    return { plancher, marge, resteJour, cible, resteObjectif, progression, ratioMarge: c.perteMax > 0 ? marge / c.perteMax : 1 };
  }

  function carte(ligne) {
    const c = ligne.contenu || {};
    const d = c.devise || "USD";
    const e = etat(c);
    const vieux = Date.now() - Date.parse(ligne.maj_le) > 15 * 60000; // > 15 min : PC éteint ?
    const couleur = e.ratioMarge <= 0.25 ? "negatif" : e.ratioMarge <= 0.5 ? "attention" : "positif";
    // Courbe : départ puis résultat cumulé jour par jour (jours publiés par le PC), puis solde.
    let cumul = c.depart;
    const valeurs = [c.depart, ...(c.jours || []).map((j) => (cumul += j.net)), c.solde];
    const contenu = `
        <div class="grille-mt5">
          <div><span class="lib">Équité</span><span class="val">${argent(c.equite, d)}</span></div>
          <div><span class="lib">Aujourd'hui</span><span class="val ${c.jourNet >= 0 ? "positif" : "negatif"}">${argent(c.jourNet, d, true)}</span>
            <span class="sous">${c.tradesJour || 0} trade${c.tradesJour > 1 ? "s" : ""} fermé${c.tradesJour > 1 ? "s" : ""}${c.positionsOuvertes ? ` · ${c.positionsOuvertes} ouvert${c.positionsOuvertes > 1 ? "s" : ""}` : ""}</span></div>
          ${c.perteMax > 0 ? `<div><span class="lib">Avant rupture</span><span class="val ${couleur}">${argent(e.marge, d)}</span>
            <span class="sous">rupture à ${argent(e.plancher, d)}</span></div>` : ""}
          ${c.perteJour > 0 ? `<div><span class="lib">Perte max du jour restante</span><span class="val">${argent(e.resteJour, d)}</span>
            <span class="sous">sur ${argent(c.perteJour, d)}</span></div>` : ""}
          ${c.objectifPct > 0 ? `<div><span class="lib">Objectif ${U.nombre(c.objectifPct, 0)} %</span><span class="val">${e.resteObjectif > 0 ? `reste ${argent(e.resteObjectif, d)}` : "atteint ✅"}</span>
            <span class="sous">cible ${argent(e.cible, d)}</span></div>` : ""}
        </div>
        ${e.progression !== null ? `<div class="barre-mt5"><span style="width:${e.progression.toFixed(1)}%"></span></div>` : ""}
        <p class="texte-attenue petit">${esc(c.serveur || "")} · lecture seule 🔒 · lu à ${esc(U.heure(ligne.maj_le))}${vieux ? " ⚠️ PC éteint ?" : ""}</p>`;
    return window.GoldAI.comptesTradelocker.carteCompte({
      cle: ligne.cle, nom: c.nom || ligne.cle, devise: d,
      badges: `<span class="badge-statut-compte challenge">MT5</span>`,
      valeurs, solde: c.solde, profit: Math.round((c.solde - c.depart) * 100) / 100,
      numero: c.login, plateforme: "MetaTrader 5",
      etat: vieux ? "Pas à jour" : "Active", etatOk: !vieux, contenu,
    });
  }

  // Comptes ajoutés dans l'app : état de la lecture + bouton Retirer.
  function ligneConnexion(c) {
    const lu = (comptes || []).some((x) => x.cle === `mt5|${c.login}`);
    const etatLecture = c.erreur ? `<span class="negatif">${esc(c.erreur)}</span>` : lu ? "lu ✓" : "en attente de la première lecture (5 min max)";
    return `
      <li>
        <span><strong>${esc(c.nom || `MT5 ${c.login}`)}</strong> <span class="texte-attenue petit">${esc(String(c.login))} · ${esc(c.serveur)}</span><br>
          <span class="texte-attenue petit">${etatLecture}</span></span>
        <button type="button" class="lien-retour" data-retirer-mt5="${esc(c.id)}">Retirer</button>
      </li>`;
  }

  const formulaire = `
    <details class="carte" id="carte-ajout-mt5">
      <summary><strong>+ Ajouter un compte MetaTrader 5</strong></summary>
      <p class="texte-attenue petit">Utilise le mot de passe <strong>investisseur</strong> (lecture seule) donné par ta prop firm : l'app peut seulement regarder, jamais passer d'ordre. Il est chiffré et n'est plus jamais affiché.</p>
      <form id="formulaire-mt5" novalidate>
        <div class="ligne-champs">
          <div class="champ"><label for="mt5-login">Numéro du compte</label><input id="mt5-login" name="login" inputmode="numeric" autocomplete="off" required></div>
          <div class="champ"><label for="mt5-serveur">Serveur</label><input id="mt5-serveur" name="serveur" autocomplete="off" placeholder="ex. FundedNext-Server" required></div>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label for="mt5-mdp">Mot de passe investisseur</label><input id="mt5-mdp" name="mdp" type="password" autocomplete="new-password" required></div>
          <div class="champ"><label for="mt5-nom">Nom dans l'app (facultatif)</label><input id="mt5-nom" name="nom" autocomplete="off" placeholder="ex. FundedNext 100k"></div>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label for="mt5-depart">Solde de départ ($)</label><input id="mt5-depart" name="depart" inputmode="decimal" placeholder="ex. 100000"></div>
          <div class="champ"><label for="mt5-perte-max">Perte max totale ($)</label><input id="mt5-perte-max" name="perte_max" inputmode="decimal" placeholder="ex. 8000"></div>
        </div>
        <div class="ligne-champs">
          <div class="champ"><label for="mt5-perte-jour">Perte max par jour ($)</label><input id="mt5-perte-jour" name="perte_jour" inputmode="decimal" placeholder="ex. 4000"></div>
          <div class="champ"><label for="mt5-objectif">Objectif (%)</label><input id="mt5-objectif" name="objectif_pct" inputmode="decimal" placeholder="ex. 8"></div>
        </div>
        <button type="submit" class="bouton">Ajouter ce compte</button>
      </form>
    </details>`;

  function afficher() {
    const zone = $("contenu-mt5");
    if (!zone) return;
    // Jamais redessiné pendant la saisie dans le formulaire.
    if (document.activeElement?.closest?.("#formulaire-mt5")) return;
    const ouvert = $("carte-ajout-mt5")?.open;
    zone.innerHTML = `
      ${erreur && !comptes ? `<p class="alerte-donnees">${esc(erreur)}</p>` : ""}
      ${comptes?.length ? `<ul class="liste-cartes-comptes">${comptes.map(carte).join("")}</ul>` : ""}
      ${connexions.length ? `<ul class="carte liste-noms-tl">${connexions.map(ligneConnexion).join("")}</ul>` : ""}
      ${message ? `<p class="alerte-donnees${message.ok ? "" : " negatif"}" role="status">${esc(message.texte)}</p>` : ""}
      ${formulaire}`;
    if (ouvert) $("carte-ajout-mt5").open = true;
  }

  const ouverte = () => !$("profil-tradelocker")?.classList.contains("hidden");
  let minuterie = null;
  document.addEventListener("DOMContentLoaded", () => {
    $("contenu-mt5")?.addEventListener("submit", (e) => {
      if (e.target.id !== "formulaire-mt5") return;
      e.preventDefault();
      ajouter(e.target);
    });
    $("contenu-mt5")?.addEventListener("click", (e) => window.GoldAI.comptesTradelocker.basculer(e));
    $("contenu-mt5")?.addEventListener("keydown", (e) => window.GoldAI.comptesTradelocker.basculer(e));
    $("contenu-mt5")?.addEventListener("click", (e) => {
      const id = e.target.dataset?.retirerMt5;
      if (id) retirer(id);
    });
    $("bouton-ouvrir-tradelocker")?.addEventListener("click", () => {
      message = null;
      charger();
      clearInterval(minuterie);
      minuterie = setInterval(() => { if (ouverte() && !document.hidden) charger(); else if (!ouverte()) clearInterval(minuterie); }, 60000);
    });
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.comptesMt5 = { charger, relire: () => { if (ouverte()) charger(); }, viderCache: () => { comptes = null; connexions = []; erreur = null; message = null; clearInterval(minuterie); const z = $("contenu-mt5"); if (z) z.innerHTML = ""; } };
})();
