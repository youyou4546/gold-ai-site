// Gold AI — Analyse › Suivre le prix (tout en bas) : alertes sur un prix ou une zone de l'or.
//
// - Tu entres un prix (ex. 2650) ou une zone (ex. 2650 – 2660).
// - L'alerte est enregistrée sur ton profil (supabase/patch_alertes_prix.sql).
// - Supabase (fonction « verifications », chaque minute) regarde les bougies
//   1 min de l'or et t'envoie une notification quand le prix touche le niveau
//   ou entre dans la zone (relevé toutes les 10 s) — même app et PC fermés.
// - Ici on affiche le prix en direct et la distance à chaque alerte.
// Règle « touché » : js/noyau.js › alerteTouchee (identique côté Supabase).
(() => {
  const N = window.GoldAI.noyau;
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const px = (p) => Number(p).toFixed(2);

  let type = "prix";
  let alertes = null;      // null = pas encore chargées
  let patchAbsent = false;
  let minuterie = null;
  let rendu = null;

  const rpc = (nom, params = {}) => U.rpc(nom, { p_token: window.GoldAI.auth.getToken(), ...params });
  // Bloc « Suivre le prix » : en bas de l'onglet Analyse (plus dans le Journal).
  const ouverte = () => !!$("section-analyse")?.classList.contains("actif");

  function prixDirect() {
    const c = window.GoldAI.cotations.instantane();
    return c.prix !== null && (c.fraicheur === "direct" || c.fraicheur === "retard") ? c.prix : null;
  }

  // ---------------------------------------------------------------- Données

  async function charger() {
    const { data, error, absente } = await rpc("lister_mes_alertes_prix");
    patchAbsent = absente;
    if (!error) alertes = (data || []).map((a) => ({ ...a, bas: Number(a.bas), haut: Number(a.haut) }));
    else if (!absente) message("Impossible de charger tes alertes. Vérifie ta connexion.");
    afficherListe();
  }

  async function creer(e) {
    e.preventDefault();
    const bas = Number($("alerte-bas").value.replace(",", "."));
    const haut = type === "zone" ? Number($("alerte-haut").value.replace(",", ".")) : bas;
    if (!(bas > 0) || !(haut > 0)) return message(type === "zone" ? "Entre les deux prix de la zone." : "Entre un prix.");
    if (type === "zone" && bas === haut) return message("Les deux prix de la zone sont identiques : choisis « Un prix ».");
    const zone = { bas: Math.min(bas, haut), haut: Math.max(bas, haut) };
    const prix = prixDirect();
    if (prix !== null && N.distanceAlerte(zone, prix).position === "dedans") {
      return message(`L'or est déjà ${type === "zone" ? "dans cette zone" : "à ce prix"} (${px(prix)}).`);
    }
    if (prix !== null && Math.abs(prix - zone.bas) > prix * 0.2) {
      return message(`Ce prix est très loin de l'or actuel (${px(prix)}). Vérifie la saisie.`);
    }

    const bouton = $("bouton-creer-alerte");
    bouton.disabled = true;
    const { error, absente } = await rpc("ajouter_alerte_prix", {
      p_bas: zone.bas, p_haut: zone.haut, p_note: $("alerte-note").value.trim() || null, p_prix_creation: prix,
    });
    bouton.disabled = false;
    if (absente) { patchAbsent = true; afficherListe(); return message("Il manque la mise à jour Supabase (patch_alertes_prix.sql)."); }
    if (error) return message(/TROP_ALERTES/.test(error.message || "") ? "Maximum 20 alertes actives : supprimes-en une." : "L'alerte n'a pas été enregistrée. Réessaie.");
    $("formulaire-alerte").reset();
    message("");
    await charger();
  }

  async function supprimer(id) {
    const { error } = await rpc("supprimer_alerte_prix", { p_id: id });
    if (error) return message("Suppression impossible. Réessaie.");
    alertes = (alertes || []).filter((a) => a.id !== id);
    afficherListe();
  }

  // ---------------------------------------------------------------- Affichage

  function message(texte) {
    const zone = $("message-alerte");
    zone.textContent = texte;
    zone.classList.toggle("hidden", !texte);
  }

  function choisirType(nouveau) {
    type = nouveau;
    document.querySelectorAll("#journal-alertes .segmente button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === type)));
    $("champ-alerte-haut").classList.toggle("hidden", type !== "zone");
    $("libelle-alerte-bas").textContent = type === "zone" ? "De" : "Prix";
    message("");
  }

  const nomAlerte = (a) => (a.bas === a.haut ? `Prix ${px(a.bas)}` : `Zone ${px(a.bas)} – ${px(a.haut)}`);

  function afficherPrix() {
    const prix = prixDirect();
    $("alertes-prix-actuel").textContent = prix === null ? "Or : —" : `Or : ${px(prix)}`;
    // Distances mises à jour en direct.
    document.querySelectorAll("#liste-alertes [data-distance]").forEach((el) => {
      const a = (alertes || []).find((x) => x.id === el.dataset.distance);
      if (a) el.textContent = texteDistance(a, prix);
    });
  }

  function texteDistance(a, prix) {
    if (prix === null) return "";
    const d = N.distanceAlerte(a, prix);
    if (d.position === "dedans") return "l'or y est (notification dans quelques secondes)";
    return `à ${px(d.distance)} ${d.position === "dessus" ? "en dessous" : "au-dessus"}`;
  }

  function afficherListe() {
    const zone = $("liste-alertes");
    if (!zone) return;
    if (patchAbsent) {
      zone.innerHTML = `<p class="alerte-donnees">Il manque la mise à jour Supabase : colle <strong>supabase/patch_alertes_prix.sql</strong> dans Supabase › SQL Editor › Run.</p>`;
      return;
    }
    if (alertes === null) { zone.innerHTML = `<p class="texte-attenue petit">Chargement…</p>`; return; }
    const prix = prixDirect();
    const actives = alertes.filter((a) => !a.touchee_le);
    const touchees = alertes.filter((a) => a.touchee_le);
    const ligne = (a) => `
      <li class="${a.touchee_le ? "touchee" : ""}">
        <div class="infos-alerte">
          <strong>${a.touchee_le ? "✅" : "🎯"} ${esc(nomAlerte(a))}</strong>
          ${a.note ? `<span class="texte-attenue">${esc(a.note)}</span>` : ""}
          <span class="petit texte-attenue" ${a.touchee_le ? "" : `data-distance="${esc(a.id)}"`}>${a.touchee_le
            ? `Touché ${esc(U.jourHeure(a.touchee_le))}${a.prix_touche ? ` · or à ${px(a.prix_touche)}` : ""}`
            : esc(texteDistance(a, prix))}</span>
        </div>
        <button type="button" class="bouton secondaire bouton-petit" data-supprimer="${esc(a.id)}" aria-label="Supprimer l'alerte ${esc(nomAlerte(a))}">✕</button>
      </li>`;
    zone.innerHTML = `
      <div class="carte">
        <strong>Mes alertes actives (${actives.length})</strong>
        ${actives.length ? `<ul class="liste-alertes-prix">${actives.map(ligne).join("")}</ul>` : `<p class="texte-attenue petit">Aucune alerte : entre un prix ou une zone ci-dessus.</p>`}
      </div>
      ${touchees.length ? `<div class="carte"><strong>Touchées (7 derniers jours)</strong><ul class="liste-alertes-prix">${touchees.map(ligne).join("")}</ul></div>` : ""}`;
  }

  async function verifierNotifs() {
    const e = await window.GoldAI.notifications?.etat?.();
    $("alertes-notif-inactives").classList.toggle("hidden", !e || e === "actif");
  }

  // ---------------------------------------------------------------- Cycle de vie

  function ouvrir() {
    message("");
    afficherPrix();
    afficherListe();
    charger();
    verifierNotifs();
    clearInterval(minuterie);
    // Récupère les alertes touchées pendant que la page est ouverte.
    minuterie = setInterval(() => { if (ouverte() && !document.hidden) charger(); }, 60000);
  }

  function viderCache() {
    alertes = null;
    clearInterval(minuterie);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("formulaire-alerte")?.addEventListener("submit", creer);
    document.querySelectorAll("#journal-alertes .segmente button").forEach((b) => b.addEventListener("click", () => choisirType(b.dataset.type)));
    $("liste-alertes")?.addEventListener("click", (e) => {
      const id = e.target.closest("[data-supprimer]")?.dataset.supprimer;
      if (id) supprimer(id);
    });
    $("alertes-activer-notifs")?.addEventListener("click", () => {
      window.GoldAI.app.allerA("profil");
      $("carte-notifications")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  window.addEventListener("goldai:cotation", () => {
    if (!ouverte() || rendu) return;
    rendu = requestAnimationFrame(() => { rendu = null; afficherPrix(); });
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ouverte()) charger(); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.alertesPrix = { ouvrir, viderCache };
})();
