// Gold AI — Marché › bloc « Discours » (Trump, Fed, BCE…).
//
// Pour chaque discours du calendrier (noyau.estDiscours, mêmes devises et
// impacts que la liste des Annonces) :
//   - 30 min avant : un chrono jusqu'au début ;
//   - à l'heure prévue : le lecteur YouTube du direct, SI un lien a été
//     associé au discours (sinon le chrono reste, sans lecteur vide) ;
//   - 90 min après l'heure prévue (ou au clic « Terminé ») : le bloc disparaît.
//
// Le lien YouTube est collé par l'utilisateur (Annonces › carte du discours,
// ou directement dans ce bloc). Il est rangé dans le JSON des paramètres
// (`liensDirect`, Supabase) : visible sur tous ses appareils, sans SQL.
(() => {
  const { esc } = window.GoldAI.utils;
  const N = window.GoldAI.noyau;
  const CLE_MASQUES = "goldai_discours_masques";
  const FUSEAU_QUEBEC = "America/Toronto";
  const heureQc = (ms) => new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU_QUEBEC, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));

  let liens = {};            // { idEvenement: { url, le } }
  let dernierChargement = 0;

  // ------------------------------------------------------------------ Liens

  async function chargerLiens(forcer = false) {
    if (!window.GoldAI.auth?.getToken?.() || !window.GoldAI.reglagesCalculateur) return;
    if (!forcer && Date.now() - dernierChargement < 120000 && dernierChargement) return;
    dernierChargement = Date.now();
    try {
      const r = await window.GoldAI.reglagesCalculateur.charger({ forcer });
      liens = r?.liensDirect || {};
    } catch { /* hors ligne : on garde les liens connus */ }
  }

  const lienDe = (id) => liens[id]?.url || "";
  // Lien utilisé pour le lecteur : celui que tu as collé, sinon la chaîne
  // officielle (Maison-Blanche pour Trump, Fed pour son président).
  const lienEffectif = (e) => lienDe(e.id) || N.chaineOfficielle(e)?.url || "";

  // Enregistre (ou efface si vide) le lien d'un discours. Renvoie un message d'erreur ou null.
  async function enregistrerLien(evenement, url) {
    url = String(url || "").trim();
    if (url && !N.lecteurYoutube(url)) return "Lien non reconnu : colle l'adresse d'une vidéo YouTube (youtube.com/watch?v=…, youtu.be/… ou youtube.com/live/…).";
    const R = window.GoldAI.reglagesCalculateur;
    const r = await R.charger({ forcer: true }); // dernière version du serveur : rien d'autre n'est écrasé
    const tous = { ...(r.liensDirect || {}) };
    if (url) tous[evenement.id] = { url, le: evenement.horodatage_utc };
    else delete tous[evenement.id];
    // Ménage : les liens de discours vieux de plus de 3 jours sont oubliés.
    Object.keys(tous).forEach((k) => { if (Date.parse(tous[k]?.le) < Date.now() - 3 * 86400000) delete tous[k]; });
    await R.sauvegarder({ ...r, liensDirect: tous });
    liens = tous;
    return null;
  }

  // Petit champ « lien du direct » (réutilisé dans la carte du discours des Annonces).
  function champLien(evenement) {
    const actuel = lienDe(evenement.id);
    const auto = N.chaineOfficielle(evenement);
    return `
      <div class="champ-lien-direct" data-evenement="${esc(evenement.id)}">
        <label class="petit texte-attenue" for="lien-${esc(evenement.id)}">Lien YouTube du direct</label>
        <div class="rangee-lien-direct">
          <input type="url" id="lien-${esc(evenement.id)}" inputmode="url" placeholder="https://youtube.com/watch?v=…" value="${esc(actuel)}">
          <button type="button" class="bouton bouton-petit" data-lien-direct="enregistrer">${actuel ? "Modifier" : "Ajouter"}</button>
        </div>
        ${auto && !actuel ? `<p class="petit texte-attenue">Sans lien : direct de la chaîne ${esc(auto.nom)} automatiquement.</p>` : ""}
        <p class="petit message-lien-direct" aria-live="polite"></p>
      </div>`;
  }

  // ------------------------------------------------------------------ Bloc Marché

  function masques() {
    try { return JSON.parse(localStorage.getItem(CLE_MASQUES) || "[]"); } catch { return []; }
  }

  function discoursVisibles(maintenant) {
    const caches = masques();
    return (window.GoldAI.calendrier?.discoursSuivis?.() || [])
      .filter((e) => e.horodatage_utc && !caches.includes(e.id))
      .map((e) => ({ e, ms: Date.parse(e.horodatage_utc), phase: N.phaseDiscours(Date.parse(e.horodatage_utc), maintenant) }))
      .filter((x) => x.phase !== "cache")
      .sort((a, b) => a.ms - b.ms);
  }

  const nomCourt = (titre) => String(titre).replace(/\s+speaks$/i, "");

  function chrono(ms, maintenant) {
    const s = Math.max(0, Math.round((ms - maintenant) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  function depuisDebut(ms, maintenant) {
    const m = Math.max(0, Math.floor((maintenant - ms) / 60000));
    return m < 1 ? "Commence maintenant" : `Commencé depuis ${m} min`;
  }

  function carte({ e, ms, phase }, maintenant) {
    const lecteur = N.lecteurYoutube(lienEffectif(e));
    const entete = `
      <div class="entete-discours">
        <span class="etiquette-discours">Discours</span>
        <span class="nom-discours">${esc(nomCourt(e.titre))}</span>
        <span class="texte-attenue petit">${esc(e.devise)} · ${heureQc(ms)}</span>
      </div>`;
    if (phase === "en_cours" && lecteur) {
      return `
        <article class="carte carte-discours" data-evenement="${esc(e.id)}">
          ${entete}
          <div class="video-direct"><iframe src="${esc(lecteur)}" title="Direct : ${esc(e.titre)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
          <div class="pied-discours">
            <span class="petit texte-attenue">Son coupé au départ : touche la vidéo pour l'activer.</span>
            <button type="button" class="bouton secondaire bouton-petit" data-lien-direct="masquer">Terminé ✕</button>
          </div>
        </article>`;
    }
    const rebours = phase === "chrono"
      ? `<div class="chrono-discours" data-debut="${ms}">${chrono(ms, maintenant)}</div><p class="petit texte-attenue centre-discours">Début à ${heureQc(ms)} (heure du Québec)</p>`
      : `<div class="chrono-discours en-cours" data-debut="${ms}">En cours</div><p class="petit texte-attenue centre-discours" data-depuis="${ms}">${depuisDebut(ms, maintenant)}</p>`;
    return `
      <article class="carte carte-discours" data-evenement="${esc(e.id)}">
        ${entete}
        ${rebours}
        ${lecteur ? `<p class="petit centre-discours">▶ Le direct${lienDe(e.id) ? "" : ` (chaîne ${esc(N.chaineOfficielle(e).nom)})`} s'affichera ici à l'heure prévue.</p>` : champLien(e)}
        ${phase === "en_cours" ? `<div class="pied-discours"><span></span><button type="button" class="bouton secondaire bouton-petit" data-lien-direct="masquer">Terminé ✕</button></div>` : ""}
      </article>`;
  }

  let cleAffichee = "";
  function afficher() {
    const zone = document.getElementById("direct-marche");
    if (!zone || !document.getElementById("section-marche")?.classList.contains("actif")) return;
    const maintenant = Date.now();
    const liste = discoursVisibles(maintenant);
    if (liste.length) chargerLiens(); // relit de temps en temps (lien ajouté sur un autre appareil)
    // Redessiné seulement quand quelque chose change vraiment (sinon la vidéo se rechargerait),
    // et jamais pendant que tu tapes un lien dans ce bloc.
    const cle = liste.map((x) => `${x.e.id}|${x.phase}|${lienEffectif(x.e)}`).join(";");
    const saisie = zone.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
    if (cle !== cleAffichee && !saisie) {
      zone.innerHTML = liste.length ? `<h3 class="titre-bloc-annonces">Discours</h3>${liste.map((x) => carte(x, maintenant)).join("")}` : "";
      cleAffichee = cle;
      return;
    }
    // Sinon : seul le texte du chrono avance (chaque seconde).
    zone.querySelectorAll(".chrono-discours:not(.en-cours)").forEach((el) => { el.textContent = chrono(Number(el.dataset.debut), maintenant); });
    zone.querySelectorAll("[data-depuis]").forEach((el) => { el.textContent = depuisDebut(Number(el.dataset.depuis), maintenant); });
  }

  // ------------------------------------------------------------------ Clics (Marché + Annonces)

  document.addEventListener("click", async (ev) => {
    const bouton = ev.target.closest("[data-lien-direct]");
    if (!bouton) return;
    const id = bouton.closest("[data-evenement]")?.dataset.evenement;
    if (!id) return;
    if (bouton.dataset.lienDirect === "masquer") {
      try { localStorage.setItem(CLE_MASQUES, JSON.stringify([...masques(), id].slice(-50))); } catch { /* ignoré */ }
      cleAffichee = ""; afficher();
      return;
    }
    const bloc = bouton.closest(".champ-lien-direct");
    const message = bloc.querySelector(".message-lien-direct");
    const evenement = (window.GoldAI.calendrier?.evenementsCalendrier?.() || []).find((x) => x.id === id);
    if (!evenement) { message.textContent = "Discours introuvable dans le calendrier."; return; }
    bouton.disabled = true;
    message.textContent = "Enregistrement…";
    try {
      const erreur = await enregistrerLien(evenement, bloc.querySelector("input").value);
      message.textContent = erreur || "✓ Lien enregistré";
      message.classList.toggle("texte-alerte", !!erreur);
      bouton.blur();
      if (!erreur) { bouton.textContent = bloc.querySelector("input").value.trim() ? "Modifier" : "Ajouter"; cleAffichee = ""; afficher(); }
    } catch {
      message.textContent = "Enregistrement impossible pour l'instant : vérifie ta connexion.";
      message.classList.add("texte-alerte");
    } finally {
      bouton.disabled = false;
    }
  });

  window.addEventListener("goldai:donnees", () => { chargerLiens().then(afficher); });
  document.addEventListener("DOMContentLoaded", () => { chargerLiens(true).then(afficher); });
  setInterval(afficher, 1000);

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.direct = { afficher, champLien, lienDe, lienEffectif, chargerLiens };
})();
