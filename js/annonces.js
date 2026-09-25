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

  function badgeStatut(statut) {
    const s = { "confirmé": ["ok", "✓"], "en développement": ["attention", "◐"], "non confirmé": ["alerte", "?"] }[statut] || ["neutre", "•"];
    return `<span class="badge-fraicheur ${s[0]}"><span aria-hidden="true">${s[1]}</span> ${esc(statut)}</span>`;
  }

  function carteActualite(n, maintenant) {
    const prio = N.scorePriorite({ ...n, type: "actualite" }, maintenant);
    const titre = n.titre_fr || n.titre_original;
    const imp = { haute: "high", moyenne: "medium", faible: "low" }[n.importance] || "low";
    const liens = n.articles.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.source)}</a>${a.officiel ? " (officiel)" : ""} · ${U.heure(a.publie_le)}</li>`).join("");
    return `
      <article class="carte-actu">
        <div class="entete-actu">
          <span class="badge-impact ${imp}">${esc(n.importance)}</span>
          <span class="etiquette-categorie">${esc(LIBELLE_CATEGORIE[n.categorie] || n.categorie)}</span>
          ${badgeStatut(n.statut)}
        </div>
        <h3 class="titre-actu">${esc(titre)}</h3>
        ${!n.titre_fr ? `<p class="texte-attenue">Titre d'origine (non traduit : tri automatique indisponible).</p>` : ""}
        ${n.resume_fr ? `<p class="faits"><span class="etiquette-mini">Faits rapportés</span> ${esc(n.resume_fr)}</p>` : ""}
        ${n.interpretation?.texte ? `<p class="interpretation"><span class="etiquette-mini">Interprétation (hypothèse)</span> ${esc(n.interpretation.texte)} <em>(${esc(n.interpretation.direction_or)} pour l'or)</em></p>` : ""}
        ${n.mise_a_jour ? `<p class="maj-actu"><span class="etiquette-mini">Mise à jour importante</span> ${esc(n.mise_a_jour.texte)}</p>` : ""}
        <div class="meta-actu">
          Publié ${U.jourHeure(n.publie_le)} (${U.depuis(n.publie_le, maintenant)})
          ${n.actifs?.length ? ` · Actifs : ${n.actifs.map((a) => `<span class="puce-actif">${esc(a)}</span>`).join(" ")}` : ""}
        </div>
        ${n.justification ? `<p class="justif"><strong>Importance :</strong> ${esc(n.justification)}</p>` : ""}
        <p class="justif"><strong>Statut :</strong> ${esc(n.raison_statut)}. <strong>Pourquoi ici :</strong> ${esc(prio.raisons.join(", ") || "pertinence modérée")}.</p>
        <details class="details-discrets"><summary>${n.articles.length} article(s) · sources et liens originaux</summary><ul>${liens}</ul></details>
      </article>`;
  }

  // ------------------------------------------------------------------ Calendrier

  function valeursEvenement(e) {
    // Une ligne par source ; jamais de prévision/précédent présentés comme résultat.
    const v = e.valeurs[0] || {};
    const res = e.valeurs.find((x) => x.resultat)?.resultat || null;
    const ecart = res ? N.ecartResultatPrevision(res, v.prevision) : null;
    const cell = (lib, val) => `<div class="valeur-eco"><span class="lib">${lib}</span><span class="val">${val ? esc(val) : "—"}</span></div>`;
    return `
      <div class="grille-valeurs-eco">
        ${cell("Précédent", v.precedent)}
        ${cell("Prévision", v.prevision)}
        <div class="valeur-eco resultat"><span class="lib">Résultat publié</span><span class="val">${res ? esc(res) : '<span class="texte-attenue">non fourni par la source</span>'}</span></div>
        ${ecart ? `<div class="valeur-eco"><span class="lib">Écart vs prévision</span><span class="val">${ecart.ecart > 0 ? "+" : ""}${ecart.ecart}${esc(ecart.unite)}</span></div>` : ""}
      </div>
      <div class="texte-attenue petit">Unité : ${e.unite ? esc(e.unite) : "non précisée"} · Révision : non fournie par la source · Source${e.sources.length > 1 ? "s" : ""} : ${e.sources.map(esc).join(", ")}${v.url ? ` · <a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">fiche</a>` : ""}</div>
      ${e.divergences?.length ? `<div class="alerte-donnees">Divergence entre sources : ${e.divergences.map(esc).join(" ; ")}</div>` : ""}`;
  }

  function ligneEvenement(e, maintenant) {
    const ms = e.horodatage_utc ? Date.parse(e.horodatage_utc) : null;
    const prio = N.scorePriorite({ ...e, type: "annonce", importance: e.impact }, maintenant);
    const rebours = ms ? U.compteARebours(e.horodatage_utc, maintenant) : null;
    const expl = trouverExplication(e.titre);
    const tendance = expl?.or_affecte ? `
      <div class="tendance-inline">
        <span class="pastille-direction ${expl.si_superieur.direction} mini">${expl.si_superieur.direction === "hausse" ? "▲" : "▼"} or si plus fort que prévu</span>
        <span class="pastille-direction ${expl.si_inferieur.direction} mini">${expl.si_inferieur.direction === "hausse" ? "▲" : "▼"} or si plus faible que prévu</span>
      </div>` : "";
    return `
      <div class="evenement evenement-v2" data-id="${esc(e.id)}" tabindex="0" role="button" aria-label="Détails : ${esc(e.titre)}">
        <div class="heure">${ms ? U.heure(ms) : esc(e.precision_heure || "—")}<span class="jour-mini">${ms ? U.formaterDate(ms, { weekday: "short", day: "numeric" }) : ""}</span></div>
        <div class="contenu-evenement">
          <div class="titre-evenement">${esc(e.titre)}</div>
          <div class="meta-evenement">${esc(e.pays)} · ${esc(e.devise)}${rebours ? ` · <strong>${rebours}</strong>` : ms ? ` · publié ${U.depuis(ms, maintenant)}` : ""}</div>
          ${valeursEvenement(e)}
          ${tendance}
          <div class="texte-attenue petit">Priorité : ${esc(prio.raisons.join(", ") || "standard")}</div>
        </div>
        <span class="badge-impact ${esc(e.impact)}">${LIBELLE_IMPACT[e.impact] || esc(e.impact)}</span>
      </div>`;
  }

  function ouvrirModale(e) {
    const expl = trouverExplication(e.titre);
    document.getElementById("modale-titre-annonce").textContent = e.titre;
    const ms = e.horodatage_utc ? Date.parse(e.horodatage_utc) : null;
    document.getElementById("modale-meta-annonce").textContent =
      `${e.pays} · ${e.devise} · ${ms ? `${U.jourLong(ms)} à ${U.heure(ms)} (${U.fuseau()})` : e.date_utc}`;
    const blocImpact = document.getElementById("bloc-impact-or");
    const zoneImpact = document.getElementById("modale-impact-or");
    const zoneAvert = document.getElementById("modale-avertissement");
    if (!expl) {
      document.getElementById("modale-mesure").textContent = "Pas de fiche explicative pour cette annonce précise pour l'instant.";
      blocImpact.style.display = "none"; zoneAvert.style.display = "none";
    } else {
      document.getElementById("modale-mesure").textContent = expl.mesure;
      blocImpact.style.display = "block";
      if (!expl.or_affecte) {
        zoneImpact.innerHTML = `<span class="texte-attenue">Pas d'impact direct connu sur l'or pour ce type d'annonce.</span>`;
        zoneAvert.style.display = "none";
      } else {
        const bloc = (lib, s) => `<div style="margin-bottom:12px;"><div class="texte-attenue petit">${lib}</div>
          <span class="pastille-direction ${s.direction}">${s.direction === "hausse" ? "▲ Hausse probable de l'or" : "▼ Baisse probable de l'or"}</span>
          <div style="font-size:12px; margin-top:6px; line-height:1.5;">${esc(s.raisonnement)}</div></div>`;
        zoneImpact.innerHTML = bloc("Si le résultat est plus fort que prévu :", expl.si_superieur) + bloc("Si le résultat est plus faible que prévu :", expl.si_inferieur);
        zoneAvert.textContent = `⚠️ ${glossaire.avertissement}`;
        zoneAvert.style.display = "block";
      }
    }
    document.getElementById("modale-annonce").classList.add("visible");
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

    document.getElementById("etat-sources-annonces").innerHTML = `<ul class="liste-sources">${etatSources(jeuActus, "Actualités")}${etatSources(jeuCal, "Calendrier")}
      ${jeuActus?.contenu?.ia?.statut === "erreur" ? `<li class="texte-alerte">Tri automatique : ${esc(jeuActus.contenu.ia.note)}</li>` : ""}</ul>`;

    // --- Actualités urgentes
    const actus = (jeuActus?.contenu?.evenements || [])
      .filter((n) => filtrerActualite(n, maintenant))
      .map((n) => ({ n, p: N.scorePriorite({ ...n, type: "actualite" }, maintenant).score }))
      .sort((a, b) => b.p - a.p || Date.parse(b.n.publie_le) - Date.parse(a.n.publie_le));
    const visibles = voirPlusActus ? actus : actus.slice(0, 8);
    const htmlActus = filtres.pays
      ? `<p class="etat-vide">Filtre pays actif : les actualités ne sont pas rattachées à un pays de façon fiable.</p>`
      : visibles.length
        ? visibles.map(({ n }) => carteActualite(n, maintenant)).join("") + (actus.length > 8 ? `<button class="bouton secondaire bouton-petit" id="voir-plus-actus">${voirPlusActus ? "Voir moins" : `Voir les ${actus.length - 8} autres`}</button>` : "")
        : `<p class="etat-vide">${jeuActus ? "Aucune actualité ne correspond aux filtres." : "Actualités indisponibles pour l'instant."}</p>`;

    // --- Calendrier
    const evs = evenementsCalendrier().filter((e) => filtrerEvenement(e, maintenant));
    const msDe = (e) => (e.horodatage_utc ? Date.parse(e.horodatage_utc) : Date.parse(`${e.date_utc}T00:00:00Z`));
    const aVenir = evs.filter((e) => msDe(e) > maintenant)
      .sort((a, b) => {
        // Les 24 prochaines heures classées par priorité, le reste par date.
        const pa = msDe(a) - maintenant < 24 * 3600000, pb = msDe(b) - maintenant < 24 * 3600000;
        if (pa !== pb) return pa ? -1 : 1;
        if (pa) return N.scorePriorite({ ...b, type: "annonce", importance: b.impact }, maintenant).score - N.scorePriorite({ ...a, type: "annonce", importance: a.impact }, maintenant).score || msDe(a) - msDe(b);
        return msDe(a) - msDe(b);
      });
    // Les annonces déjà passées ne sont plus dans la liste : repliées tout en bas.
    const passees = evs.filter((e) => msDe(e) <= maintenant).sort((a, b) => msDe(b) - msDe(a));

    const liste = (arr, vide) => (arr.length ? arr.map((e) => ligneEvenement(e, maintenant)).join("") : `<p class="etat-vide">${vide}</p>`);

    zone.innerHTML = `
      <section class="bloc-annonces" aria-labelledby="titre-urgentes">
        <h2 class="titre-bloc-annonces" id="titre-urgentes">⚡ Actualités urgentes</h2>
        <p class="aide">Nouvelles non planifiées (conflits, sanctions, banques centrales, déclarations, crises bancaires), regroupées par événement, classées par importance, pertinence pour l'or et le dollar, fraîcheur et fiabilité.</p>
        ${htmlActus}
      </section>
      <section class="bloc-annonces" aria-labelledby="titre-calendrier">
        <h2 class="titre-bloc-annonces" id="titre-calendrier">📅 Calendrier économique</h2>
        <p class="aide">Heures affichées dans le fuseau ${esc(U.fuseau())}. Le « résultat publié » n'est jamais remplacé par la prévision ou la valeur précédente.</p>
        ${filtres.mode === "urgent" ? `<p class="etat-vide">Filtre « Urgent » : seules les actualités sont affichées.</p>` : `
          ${liste(aVenir, jeuCal ? "Aucune annonce à venir pour ces filtres (le flux Forex Factory ne couvre que la semaine en cours)." : "Calendrier indisponible pour l'instant.")}
          ${passees.length ? `<details class="details-discrets"><summary>Annonces déjà passées (${passees.length})</summary>${liste(passees, "")}</details>` : ""}`}
      </section>`;

    zone.querySelectorAll(".evenement-v2").forEach((el) => {
      const ev = evs.find((x) => x.id === el.dataset.id);
      const ouvrir = (e) => { if (e.target.closest("a")) return; ouvrirModale(ev); };
      el.addEventListener("click", ouvrir);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") ouvrir(e); });
    });
    document.getElementById("voir-plus-actus")?.addEventListener("click", () => { voirPlusActus = !voirPlusActus; afficher(); });
  }

  function remplirPays() {
    const select = document.getElementById("filtre-pays");
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
    document.getElementById("bouton-fermer-modale").addEventListener("click", () => document.getElementById("modale-annonce").classList.remove("visible"));
    document.getElementById("modale-annonce").addEventListener("click", (e) => { if (e.target.id === "modale-annonce") e.currentTarget.classList.remove("visible"); });
  });

  window.addEventListener("goldai:donnees", () => {
    if (document.getElementById("section-calendrier")?.classList.contains("actif")) { remplirPays(); afficher(); }
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.calendrier = { charger, afficher, evenementsCalendrier };
})();
