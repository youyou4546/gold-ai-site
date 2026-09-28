// Gold AI — section Annonces : "Actualités urgentes" + "Calendrier économique".
//
// Données : js/donnees.js (publiées par le PC : site/sync_actualites.py et
// site/sync_calendrier.py). Explications des annonces : data/glossaire_annonces.json.
// Toutes les heures sont stockées en UTC et affichées dans le fuseau choisi
// (America/Toronto par défaut, changements d'heure gérés par le navigateur).
(() => {
  const U = window.GoldAI.utils;
  const N = window.GoldAI.noyau;
  const { esc } = U;

  const DEVISES_SUIVIES = ["USD", "EUR", "GBP", "JPY", "CHF", "CNY"];
  const LIBELLE_IMPACT = { high: "Fort", medium: "Moyen", low: "Faible", holiday: "Férié" };
  const LIBELLE_CATEGORIE = {
    conflit: "Conflit / militaire", sanctions_commerce: "Sanctions / commerce", banque_centrale: "Banque centrale",
    declaration: "Déclaration", crise_bancaire: "Crise bancaire", marche: "Commentaire de marché", autre: "Autre",
  };
  const CATEGORIES_URGENTES = ["conflit", "sanctions_commerce", "banque_centrale", "declaration", "crise_bancaire"];

  const filtres = { mode: "tout", pays: "", periode: "semaine", tousEvenements: false };
  let glossaire = null;
  let voirPlusActus = false;
  const ouvertes = new Set(); // cartes dépliées (par id)

  function basculer(carte, ouvrir) {
    carte.classList.toggle("ouverte", ouvrir);
    carte.querySelector(".tete-annonce").setAttribute("aria-expanded", String(ouvrir));
    carte.querySelector(".detail-annonce").hidden = !ouvrir;
  }

  async function chargerGlossaire() {
    if (glossaire) return glossaire;
    try { glossaire = await (await fetch("data/glossaire_annonces.json")).json(); } catch { glossaire = { annonces: [], avertissement: "" }; }
    return glossaire;
  }

  function trouverExplication(titre) {
    const t = String(titre).toLowerCase();
    return glossaire?.annonces?.find((a) => a.mots_cles.some((m) => t.includes(m))) || null;
  }

  // ------------------------------------------------------------------ Filtres

  function dansPeriode(ms, maintenant) {
    if (filtres.periode === "jour") return U.cleJour(ms) === U.cleJour(maintenant);
    if (filtres.periode === "24h") return Math.abs(ms - maintenant) <= 24 * 3600000;
    return true; // semaine (tout le flux)
  }

  function filtrerActualite(n, maintenant) {
    if (!filtres.tousEvenements && !CATEGORIES_URGENTES.includes(n.categorie)) return false;
    if (filtres.mode === "urgent" && !(n.importance === "haute" && CATEGORIES_URGENTES.includes(n.categorie))) return false;
    if (filtres.mode === "fort" && n.importance !== "haute") return false;
    if (filtres.mode === "xau" && !(n.actifs || []).includes("XAUUSD")) return false;
    if (filtres.mode === "usd" && !(n.actifs || []).includes("USD")) return false;
    if (filtres.pays) return false; // les actualités n'ont pas de pays fiable : masquées quand un pays est choisi
    return dansPeriode(Date.parse(n.publie_le), maintenant);
  }

  function filtrerEvenement(e, maintenant) {
    const ms = e.horodatage_utc ? Date.parse(e.horodatage_utc) : Date.parse(`${e.date_utc}T12:00:00Z`);
    if (!filtres.tousEvenements && (!DEVISES_SUIVIES.includes(e.devise) || e.impact === "low" || e.impact === "holiday")) return false;
    if (filtres.mode === "urgent") return false;
    if (filtres.mode === "fort" && e.impact !== "high") return false;
    if (filtres.mode === "xau" && e.devise !== "USD" && !(e.impact === "high")) return false;
    if (filtres.mode === "usd" && e.devise !== "USD") return false;
    if (filtres.pays && e.devise !== filtres.pays) return false;
    return dansPeriode(ms, maintenant);
  }

  // ------------------------------------------------------------------ Actualités

  // Badge or d'une actualité : neutre tant qu'elle n'est pas confirmée.
  function biaisActualite(n) {
    const dir = n.interpretation?.direction_or;
    return n.statut === "confirmé" || n.statut === "en développement" ? ({ haussier: "haussier", baissier: "baissier" }[dir] || "neutre") : "neutre";
  }

  // Carte compacte commune (actualité ou annonce) : lisible en 2 secondes.
  // Ligne du haut : heure + impact. Puis le nom, UNE ligne d'explication, et
  // le gros badge or à droite. Le détail (chiffres, raisonnement,
  // avertissement) est dans un bloc replié qui s'ouvre au toucher de la carte.
  const BADGES_OR = {
    haussier: { classe: "haussier", texte: "Haussier or", fleche: "↑" },
    baissier: { classe: "baissier", texte: "Baissier or", fleche: "↓" },
    neutre: { classe: "neutre", texte: "Neutre", fleche: "" },
  };
  const LIBELLE_IMPACT_COURT = { high: "Élevé", medium: "Moyen", low: "Faible", holiday: "Férié" };

  function carteCompacte({ id, heureTxt, impact, nom, ligne, biais, detail }) {
    const b = BADGES_OR[biais] || BADGES_OR.neutre;
    return `
      <article class="carte-annonce" data-id="${esc(id)}">
        <button type="button" class="tete-annonce" aria-expanded="false">
          <span class="corps-annonce">
            <span class="haut-annonce"><span class="heure-annonce">${heureTxt}</span><span class="point-impact ${esc(impact)}"></span><span class="impact-annonce ${esc(impact)}">${LIBELLE_IMPACT_COURT[impact] || esc(impact)}</span></span>
            <span class="nom-annonce">${esc(nom)}</span>
            <span class="ligne-annonce">${esc(ligne)}</span>
          </span>
          <span class="badge-or ${b.classe}">${b.texte}${b.fleche ? ` <span aria-hidden="true">${b.fleche}</span>` : ""}</span>
        </button>
        <div class="detail-annonce" hidden>${detail}</div>
      </article>`;
  }

  // ------------------------------------------------------------------ Actualités

  function carteActualite(n, maintenant) {
    const titre = n.titre_fr || n.titre_original;
    const imp = { haute: "high", moyenne: "medium", faible: "low" }[n.importance] || "low";
    const biais = biaisActualite(n);
    const liens = n.articles.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.source)}</a>${a.officiel ? " (officiel)" : ""} · ${U.heure(a.publie_le)}</li>`).join("");
    const detail = `
      ${n.resume_fr ? `<p><span class="etiquette-mini">Faits</span> ${esc(n.resume_fr)}</p>` : ""}
      ${n.interpretation?.texte ? `<p><span class="etiquette-mini">Pourquoi</span> ${esc(n.interpretation.texte)}</p>` : ""}
      ${n.mise_a_jour ? `<p><span class="etiquette-mini">Mise à jour</span> ${esc(n.mise_a_jour.texte)}</p>` : ""}
      <p class="texte-attenue petit">${esc(LIBELLE_CATEGORIE[n.categorie] || n.categorie)} · ${esc(n.statut)} (${esc(n.raison_statut)}) · publié ${U.jourHeure(n.publie_le)}</p>
      ${n.statut === "non confirmé" ? `<p class="texte-attenue petit">Non confirmée : badge laissé neutre.</p>` : ""}
      <ul class="liens-actu petit">${liens}</ul>
      ${glossaire?.avertissement ? `<p class="avertissement-annonce">⚠️ ${esc(glossaire.avertissement)}</p>` : ""}`;
    return carteCompacte({
      id: n.id, heureTxt: U.depuis(n.publie_le, maintenant), impact: imp, nom: titre,
      ligne: n.statut === "non confirmé" ? "Non confirmé — à surveiller" : (n.resume_fr || LIBELLE_CATEGORIE[n.categorie] || ""),
      biais, detail,
    });
  }

  // ------------------------------------------------------------------ Calendrier

  function ligneEvenement(e, maintenant) {
    const ms = e.horodatage_utc ? Date.parse(e.horodatage_utc) : null;
    const expl = trouverExplication(e.titre);
    const b = N.biaisAnnonceOr(e, expl);
    const v = e.valeurs[0] || {};
    const res = e.valeurs.find((x) => x.resultat)?.resultat || null;
    const rebours = ms ? U.compteARebours(e.horodatage_utc, maintenant) : null;
    const heureTxt = ms ? `${U.formaterDate(ms, { weekday: "short" })} ${U.heure(ms)}` : esc(e.precision_heure || "—");
    const scen = (lib, s) => `<li><strong>${lib}</strong> : ${s.direction === "hausse" ? "or ↑" : "or ↓"} — ${esc(s.raisonnement)}</li>`;
    const detail = `
      <div class="chiffres-annonce">
        <span>Précédent <strong>${v.precedent ? esc(v.precedent) : "—"}</strong></span>
        <span>Prévision <strong>${v.prevision ? esc(v.prevision) : "—"}</strong></span>
        <span>Résultat <strong>${res ? esc(res) : "—"}</strong></span>
      </div>
      <p class="texte-attenue petit">${esc(e.pays)} · ${esc(e.devise)}${rebours ? ` · ${rebours}` : ""}${ms ? ` · ${U.jourLong(ms)} (${esc(U.fuseau())})` : ""}</p>
      ${expl ? `<p><span class="etiquette-mini">Ce que ça mesure</span> ${esc(expl.mesure)}</p>` : ""}
      ${expl?.or_affecte ? `<ul class="liste-scenarios">${scen("Plus fort que prévu", expl.si_superieur)}${scen("Plus faible que prévu", expl.si_inferieur)}</ul>` : ""}
      ${b.base === "prevision" ? `<p class="texte-attenue petit">Résultat pas encore connu : le badge compare la prévision au chiffre précédent.</p>` : ""}
      ${e.divergences?.length ? `<div class="alerte-donnees">Divergence entre sources : ${e.divergences.map(esc).join(" ; ")}</div>` : ""}
      ${v.url ? `<p class="petit"><a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">Fiche ${esc(e.sources.join(", "))}</a></p>` : ""}
      ${expl?.or_affecte && glossaire?.avertissement ? `<p class="avertissement-annonce">⚠️ ${esc(glossaire.avertissement)}</p>` : ""}`;
    return carteCompacte({ id: e.id, heureTxt, impact: e.impact, nom: e.titre, ligne: b.ligne, biais: b.biais, detail });
  }

  // ------------------------------------------------------------------ Rendu

  function etatSources(jeu, nom) {
    if (!jeu) return `<li><strong>${nom}</strong> : aucune donnée disponible</li>`;
    const ageMin = (Date.now() - Date.parse(jeu.publieLe)) / 60000;
    const vieux = ageMin > 45;
    const sources = (jeu.contenu.sources || []).map((s) => `${esc(s.source)} : ${esc(s.statut)}${s.note ? ` — ${esc(s.note)}` : ""}`).join("<br>");
    return `<li><strong>${nom}</strong> : actualisé ${U.depuis(jeu.publieLe)} (${esc(jeu.origine)})${vieux ? ' <span class="texte-alerte">— données anciennes</span>' : ""}<br><span class="texte-attenue petit">${sources}</span></li>`;
  }

  function evenementsCalendrier() {
    const jeu = window.GoldAI.donnees.obtenir("calendrier");
    const evs = jeu?.contenu?.evenements || [];
    // Une seule source connectée aujourd'hui : la fusion garde la même structure
    // (sources, divergences) et fonctionnera telle quelle si une autre s'ajoute.
    const parSource = {};
    evs.forEach((e) => { (e.sources || ["Forex Factory"]).forEach((s) => { (parSource[s] = parSource[s] || []).push(e); }); });
    return Object.keys(parSource).length > 1 ? N.fusionnerCalendriers(parSource) : evs.map((e) => ({ ...e, divergences: e.divergences || [] }));
  }

  function afficher() {
    const zone = document.getElementById("contenu-annonces");
    if (!zone) return;
    const maintenant = Date.now();
    const jeuActus = window.GoldAI.donnees.obtenir("actualites");
    const jeuCal = window.GoldAI.donnees.obtenir("calendrier");

    // Filtres et liste des sources retirés de la page : valeurs par défaut fixes.
    const zoneSources = document.getElementById("etat-sources-annonces");
    if (zoneSources) zoneSources.innerHTML = `<ul class="liste-sources">${etatSources(jeuActus, "Actualités")}${etatSources(jeuCal, "Calendrier")}
      ${jeuActus?.contenu?.ia?.statut === "erreur" ? `<li class="texte-alerte">Tri automatique : ${esc(jeuActus.contenu.ia.note)}</li>` : ""}</ul>`;

    // --- Actualités urgentes
    const actus = (jeuActus?.contenu?.evenements || [])
      .filter((n) => filtrerActualite(n, maintenant))
      .filter((n) => biaisActualite(n) !== "neutre") // seulement ce qui a un effet clair sur l'or
      .map((n) => ({ n, p: N.scorePriorite({ ...n, type: "actualite" }, maintenant).score }))
      .sort((a, b) => b.p - a.p || Date.parse(b.n.publie_le) - Date.parse(a.n.publie_le));
    const visibles = voirPlusActus ? actus : actus.slice(0, 5);
    const htmlActus = filtres.pays
      ? `<p class="etat-vide">Filtre pays actif : les actualités ne sont pas rattachées à un pays de façon fiable.</p>`
      : visibles.length
        ? visibles.map(({ n }) => carteActualite(n, maintenant)).join("") + (actus.length > 5 ? `<button class="bouton secondaire bouton-petit" id="voir-plus-actus">${voirPlusActus ? "Voir moins" : `Voir les ${actus.length - 5} autres`}</button>` : "")
        : `<p class="etat-vide">${jeuActus ? "Aucune actualité ne correspond aux filtres." : "Actualités indisponibles pour l'instant."}</p>`;

    // --- Calendrier
    const evs = evenementsCalendrier().filter((e) => filtrerEvenement(e, maintenant));
    const msDe = (e) => (e.horodatage_utc ? Date.parse(e.horodatage_utc) : Date.parse(`${e.date_utc}T00:00:00Z`));
    // Les annonces « Neutre » (sans effet clair sur l'or) ne sont pas affichées.
    const aVenir = evs.filter((e) => msDe(e) > maintenant && N.biaisAnnonceOr(e, trouverExplication(e.titre)).biais !== "neutre")
      .sort((a, b) => {
        // Les 24 prochaines heures classées par priorité, le reste par date.
        const pa = msDe(a) - maintenant < 24 * 3600000, pb = msDe(b) - maintenant < 24 * 3600000;
        if (pa !== pb) return pa ? -1 : 1;
        if (pa) return N.scorePriorite({ ...b, type: "annonce", importance: b.impact }, maintenant).score - N.scorePriorite({ ...a, type: "annonce", importance: a.impact }, maintenant).score || msDe(a) - msDe(b);
        return msDe(a) - msDe(b);
      });
    // Les annonces déjà passées ne sont pas affichées du tout : elles
    // disparaissent d'elles-mêmes au rafraîchissement suivant (30 s).

    const liste = (arr, vide) => (arr.length ? arr.map((e) => ligneEvenement(e, maintenant)).join("") : `<p class="etat-vide">${vide}</p>`);

    zone.innerHTML = `
      <section class="bloc-annonces" aria-labelledby="titre-calendrier">
        <h2 class="titre-bloc-annonces" id="titre-calendrier">📅 Annonces économiques</h2>
        ${filtres.mode === "urgent" ? `<p class="etat-vide">Filtre « Urgent » : seules les actualités sont affichées.</p>` : `
          ${liste(aVenir, jeuCal ? "Aucune annonce à venir pour ces filtres." : "Calendrier indisponible pour l'instant.")}`}
      </section>
      <section class="bloc-annonces" aria-labelledby="titre-urgentes">
        <h2 class="titre-bloc-annonces" id="titre-urgentes">⚡ Actualités urgentes</h2>
        ${htmlActus}
      </section>`;

    // Les cartes ouvertes le restent après le rafraîchissement automatique (30 s).
    zone.querySelectorAll(".carte-annonce").forEach((carte) => { if (ouvertes.has(carte.dataset.id)) basculer(carte, true); });
    document.getElementById("voir-plus-actus")?.addEventListener("click", () => { voirPlusActus = !voirPlusActus; afficher(); });
  }

  function remplirPays() {
    const select = document.getElementById("filtre-pays");
    if (!select) return;
    const jeu = window.GoldAI.donnees.obtenir("calendrier");
    const devises = [...new Set((jeu?.contenu?.evenements || []).map((e) => `${e.devise}|${e.pays}`))].sort();
    const actuel = select.value;
    select.innerHTML = `<option value="">Tous les pays</option>` + devises.map((d) => { const [c, p] = d.split("|"); return `<option value="${esc(c)}">${esc(p)} (${esc(c)})</option>`; }).join("");
    select.value = actuel;
  }

  let minuterie = null;
  async function charger() {
    await chargerGlossaire();
    await window.GoldAI.donnees.charger();
    remplirPays();
    afficher();
    window.GoldAI.impact?.afficher();
    clearInterval(minuterie);
    // Comptes à rebours et "il y a…" rafraîchis chaque 30 s sans recharger.
    minuterie = setInterval(() => { if (document.getElementById("section-calendrier")?.classList.contains("actif")) afficher(); }, 30000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("filtres-annonces")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-filtre]");
      if (!b) return;
      filtres.mode = b.dataset.filtre;
      document.querySelectorAll("#filtres-annonces [data-filtre]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      afficher();
    });
    document.getElementById("filtre-pays")?.addEventListener("change", (e) => { filtres.pays = e.target.value; afficher(); });
    document.getElementById("filtre-periode")?.addEventListener("change", (e) => { filtres.periode = e.target.value; afficher(); });
    document.getElementById("filtre-tous")?.addEventListener("change", (e) => { filtres.tousEvenements = e.target.checked; afficher(); });
    document.getElementById("contenu-annonces")?.addEventListener("click", (e) => {
      const tete = e.target.closest(".tete-annonce");
      if (!tete) return;
      const carte = tete.closest(".carte-annonce");
      const ouvrir = tete.getAttribute("aria-expanded") !== "true";
      basculer(carte, ouvrir);
      if (ouvrir) ouvertes.add(carte.dataset.id); else ouvertes.delete(carte.dataset.id);
    });
  });

  window.addEventListener("goldai:donnees", () => {
    if (document.getElementById("section-calendrier")?.classList.contains("actif")) { remplirPays(); afficher(); }
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.calendrier = { charger, afficher, evenementsCalendrier };
})();
