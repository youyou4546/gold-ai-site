// Gold AI — Formation : cours vidéo, quiz, examens et progression façon carrière.
//
// Contenu : formation/cours.json (fabriqué par formation/scripts/publier_site.py
// à partir des leçons du dossier gold-ai/formation) + vidéos formation/videos/*.mp4.
// Progression : enregistrée avec les réglages de l'utilisateur (même stockage que
// les paramètres du calculateur, champ « formation ») : chacun a la sienne.
//
// Règles du jeu :
//  - XP : leçon terminée +20, quiz +10 par bonne réponse (+20 si 100 %, seulement
//    ce qui améliore ton meilleur score), certification +100 × difficulté
//    (+50 du premier coup), expert +150 × difficulté, examen final +1 000,
//    défi du jour +30 (ou +10), série de jours : +5 par jour (max +50).
//  - Niveaux 1 à 50, avec un titre de métier (Apprenti → Maître trader).
//  - Domaine : Bronze (tous les quiz ≥ 60 %), Argent (certification ≥ 80 %),
//    Or = niveau max (examen expert chronométré ≥ 90 %).
//  - Un domaine s'ouvre quand ses prérequis sont certifiés ; une leçon quand la
//    précédente a son quiz à 60 % ou plus.
(() => {
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);

  const NIVEAU_MAX = 50;
  const XP_NIVEAU_MAX = 12000;
  const seuil = (n) => (n <= 1 ? 0 : Math.round(XP_NIVEAU_MAX * Math.pow((n - 1) / (NIVEAU_MAX - 1), 1.4)));
  const niveauDe = (xp) => { let n = 1; while (n < NIVEAU_MAX && xp >= seuil(n + 1)) n++; return n; };
  const TITRES = [[1, "Apprenti"], [3, "Stagiaire"], [6, "Assistant trader"], [10, "Analyste junior"], [15, "Analyste"], [20, "Trader junior"],
    [25, "Trader"], [30, "Trader confirmé"], [35, "Trader senior"], [40, "Gestionnaire de risque"], [45, "Chef de salle"], [50, "Maître trader"]];
  const titreDe = (n) => TITRES.filter(([m]) => n >= m).pop()[1];
  const prochainTitre = (n) => TITRES.find(([m]) => m > n);
  const SEUILS = { quiz: 0.6, certif: 0.8, expert: 0.9, final: 0.85, defi: 0.8 };
  const CHRONO = { expert: 25, final: 30 };
  const MAITRISES = ["", "Bronze", "Argent", "Or"];
  const ICONES = {
    cadenas: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    coche: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>',
    flamme: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-5 5-5 8 0 4 3 7 7 7z"/></svg>',
    lecture: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>',
    trophee: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>',
    eclair: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  };

  let cours = null;     // formation/cours.json
  let etat = null;      // progression de l'utilisateur
  let vue = { nom: "accueil" };
  let session = null;   // quiz / examen en cours
  let minuterieSauvegarde = null;
  let chrono = null;

  const etatVide = () => ({ version: 1, xp: 0, lecons: {}, examens: {}, final: null, serie: { jours: 0, dernier: null },
    defis: { dernier: null, total: 0 }, badges: [], erreurs: [] });

  // ---------------------------------------------------------------- Données
  async function chargerCours() {
    if (cours) return cours;
    const rep = await fetch("formation/cours.json", { cache: "no-cache" });
    if (!rep.ok) throw new Error("cours introuvables");
    cours = await rep.json();
    return cours;
  }

  async function chargerEtat() {
    if (etat) return etat;
    const r = await window.GoldAI.reglagesCalculateur.charger();
    etat = { ...etatVide(), ...(r.formation || {}) };
    return etat;
  }

  // Enregistrement groupé (une écriture même après plusieurs gains rapprochés).
  function sauvegarder() {
    clearTimeout(minuterieSauvegarde);
    minuterieSauvegarde = setTimeout(async () => {
      const r = await window.GoldAI.reglagesCalculateur.charger({ forcer: true });
      await window.GoldAI.reglagesCalculateur.sauvegarder({ ...r, formation: etat });
    }, 700);
  }

  // ---------------------------------------------------------------- Progression
  const domaine = (id) => cours.domaines.find((d) => d.id === id);
  const progres = (lid) => etat.lecons[lid] || {};
  const quizReussi = (lid) => (progres(lid).meilleur ?? 0) >= SEUILS.quiz;
  const certifie = (did) => !!etat.examens[did]?.certif;
  const expert = (did) => !!etat.examens[did]?.expert;
  const debloque = (d) => d.prerequis.every(certifie);
  const leconOuverte = (d, i) => debloque(d) && (i === 0 || quizReussi(d.lecons[i - 1]));
  const maitrise = (d) => (expert(d.id) ? 3 : certifie(d.id) ? 2 : d.lecons.every(quizReussi) ? 1 : 0);
  const toutCertifie = () => cours.domaines.every((d) => certifie(d.id));
  const aujourdHui = () => U.cleJour(Date.now());

  const BADGES = [
    ["premier-pas", "Premier pas", "Terminer une première leçon", (e) => Object.values(e.lecons).some((l) => l.vue)],
    ["sans-faute", "Sans faute", "Un quiz à 100 %", (e) => Object.values(e.lecons).some((l) => l.meilleur === 1)],
    ["serie-3", "Régulier", "3 jours d'affilée", (e) => e.serie.jours >= 3],
    ["serie-7", "Discipliné", "7 jours d'affilée", (e) => e.serie.jours >= 7],
    ["serie-30", "Inarrêtable", "30 jours d'affilée", (e) => e.serie.jours >= 30],
    ["certifie", "Certifié", "Une première certification", (e) => Object.values(e.examens).some((x) => x.certif)],
    ["bases", "Bases solides", "Les 2 domaines Bases certifiés", (e) => ["marches", "graphiques"].every((d) => e.examens[d]?.certif)],
    ["expert", "Expert", "Un premier domaine au niveau Or", (e) => Object.values(e.examens).some((x) => x.expert)],
    ["gardien", "Gardien du capital", "Gestion du risque au niveau Or", (e) => !!e.examens.risque?.expert],
    ["curieux", "Curieux", "Tous les quiz réussis", () => cours.domaines.every((d) => d.lecons.every(quizReussi))],
    ["assidu", "Assidu", "10 défis du jour", (e) => e.defis.total >= 10],
    ["maitre", "Maître trader", "Examen final réussi", (e) => !!e.final],
  ];

  let gainsSession = [];  // XP gagnés pendant l'écran en cours (affichés au résultat)
  let niveauAvant = null;
  let silencieux = false; // fin de quiz : les gains sont listés sur l'écran de résultat, pas en bulles

  function gagner(xp, raison) {
    if (xp <= 0) return;
    if (niveauAvant === null) niveauAvant = niveauDe(etat.xp);
    const auj = aujourdHui();
    if (etat.serie.dernier !== auj) {  // premier gain du jour : la série continue (ou recommence)
      etat.serie.jours = etat.serie.dernier === U.cleJour(Date.now() - 86400000) ? etat.serie.jours + 1 : 1;
      etat.serie.dernier = auj;
      const bonus = 5 * Math.min(etat.serie.jours, 10);
      etat.xp += bonus;
      gainsSession.push([bonus, `Série : ${etat.serie.jours} jour${etat.serie.jours > 1 ? "s" : ""}`]);
    }
    etat.xp += xp;
    gainsSession.push([xp, raison]);
    if (!silencieux) toast(`+${xp} XP`, raison);
    BADGES.forEach(([id, nom, , test]) => {
      if (!etat.badges.includes(id) && test(etat)) { etat.badges.push(id); setTimeout(() => toast("Nouveau badge", nom), 1400); }
    });
    sauvegarder();
  }

  function toast(titre, texte) {
    let zone = $("toasts-formation");
    if (!zone) { zone = document.createElement("div"); zone.id = "toasts-formation"; zone.className = "toasts-formation"; document.body.appendChild(zone); }
    while (zone.children.length >= 2) zone.firstChild.remove();
    const t = document.createElement("div");
    t.className = "toast-formation";
    t.innerHTML = `<strong>${esc(titre)}</strong><span>${esc(texte || "")}</span>`;
    zone.appendChild(t);
    setTimeout(() => t.classList.add("sortie"), 2400);
    setTimeout(() => t.remove(), 2900);
  }

  function marquerVue(lid) {
    const p = (etat.lecons[lid] = etat.lecons[lid] || {});
    if (p.vue) return;
    p.vue = true;
    gagner(20, "Leçon terminée");
  }

  // ---------------------------------------------------------------- Rendu
  function rendre() {
    const zone = $("formation-contenu");
    if (!zone) return;
    clearInterval(chrono);
    const ecrans = { accueil: ecranAccueil, domaine: ecranDomaine, lecon: ecranLecon, quiz: ecranQuestion, resultat: ecranResultat };
    zone.innerHTML = (ecrans[vue.nom] || ecranAccueil)();
    if (vue.nom === "quiz") demarrerChrono();
    if (vue.nom === "lecon") brancherVideo();
  }

  function aller(nouvelle) {
    vue = nouvelle;
    rendre();
    document.querySelector("main")?.scrollTo({ top: 0 });
  }

  const pct = (x) => `${Math.round(x * 100)} %`;
  const barre = (x, classe = "") => `<div class="barre-formation ${classe}"><span style="width:${Math.max(0, Math.min(100, x * 100))}%"></span></div>`;

  function carteCarriere() {
    const n = niveauDe(etat.xp);
    const debut = seuil(n), fin = seuil(n + 1);
    const avance = n >= NIVEAU_MAX ? 1 : (etat.xp - debut) / (fin - debut);
    const suivant = prochainTitre(n);
    const serieActive = etat.serie.dernier === aujourdHui() || etat.serie.dernier === U.cleJour(Date.now() - 86400000);
    return `<div class="carte-section carte-resume carte-carriere">
      <div class="titre-carte-compte"><strong>${esc(window.GoldAI.auth.getNom() || "Mon parcours")}</strong><span class="badge-periode">Niveau ${n}</span></div>
      <div class="metier-formation">${esc(titreDe(n))}</div>
      ${barre(avance, "xp")}
      <div class="chiffres-carte-compte">
        <div><span class="lib">Expérience</span><span class="val">${etat.xp.toLocaleString("fr-FR")} XP</span></div>
        <div class="droite"><span class="lib">Série</span><span class="val serie-formation ${serieActive && etat.serie.jours ? "active" : ""}">${ICONES.flamme} ${serieActive ? etat.serie.jours : 0} j</span></div>
      </div>
      <div class="pied-carte-compte">
        <span class="texte-attenue">${n >= NIVEAU_MAX ? "Niveau maximum atteint" : `${(fin - etat.xp).toLocaleString("fr-FR")} XP avant le niveau ${n + 1}`}</span>
        <span class="texte-attenue">${suivant ? `Prochain titre : ${esc(suivant[1])} (niv. ${suivant[0]})` : ""}</span>
      </div>
    </div>`;
  }

  // Prochaine étape conseillée : la 1re leçon à faire, sinon la certification à passer.
  function prochaineEtape() {
    for (const d of cours.domaines) {
      if (!debloque(d) || certifie(d.id)) continue;
      const i = d.lecons.findIndex((l) => !quizReussi(l));
      if (i >= 0) return { type: "lecon", lid: d.lecons[i], texte: `Continuer : ${cours.lecons[d.lecons[i]].titre}` };
      return { type: "certif", did: d.id, texte: `Passer la certification : ${d.nom}` };
    }
    return null;
  }

  function ecranAccueil() {
    const etape = prochaineEtape();
    const lecons = Object.values(cours.lecons);
    const defiDispo = lecons.some((l) => quizReussi(l.id));
    const defiFait = etat.defis.dernier === aujourdHui();
    const niveaux = [...new Set(cours.domaines.map((d) => d.niveau))];
    const faites = lecons.filter((l) => quizReussi(l.id)).length;
    return `
      ${carteCarriere()}
      ${etape ? `<button type="button" class="bouton bouton-continuer" data-action="${etape.type}" data-lecon="${etape.lid || ""}" data-domaine="${etape.did || ""}">${ICONES.lecture} ${esc(etape.texte)}</button>` : ""}
      <button type="button" class="carte-section carte-defi ${defiFait ? "fait" : ""}" data-action="defi" ${!defiDispo || defiFait ? "disabled" : ""}>
        <span class="icone-defi">${ICONES.eclair}</span>
        <span><strong>Défi du jour</strong><span class="texte-attenue petit">${defiFait ? "Fait aujourd'hui. Reviens demain !" : defiDispo
          ? "5 questions sur tes leçons, surtout tes erreurs · +30 XP" : "Termine une première leçon pour le débloquer"}</span></span>
      </button>
      <p class="texte-attenue petit avancement-formation">${faites} / ${lecons.length} leçons réussies · ${cours.domaines.filter((d) => certifie(d.id)).length} / ${cours.domaines.length} domaines certifiés</p>
      ${niveaux.map((niv) => `<h3 class="sous-titre-formation">${esc(niv)}</h3>
        ${cours.domaines.filter((d) => d.niveau === niv).map(carteDomaine).join("")}`).join("")}
      ${carteFinal()}
      ${U.carteSection({ cle: "badges", titre: "Badges", ouvertes,
        resume: `<span>${etat.badges.length} / ${BADGES.length}</span>`,
        contenu: `<ul class="grille-badges">${BADGES.map(([id, nom, desc]) => `<li class="${etat.badges.includes(id) ? "obtenu" : ""}">
          <span class="icone-badge">${ICONES.trophee}</span><strong>${esc(nom)}</strong><span>${esc(desc)}</span></li>`).join("")}</ul>` })}`;
  }

  function carteDomaine(d) {
    const ouvert = debloque(d);
    const reussies = d.lecons.filter(quizReussi).length;
    const m = maitrise(d);
    const manque = d.prerequis.filter((p) => !certifie(p)).map((p) => domaine(p).nom);
    return `<button type="button" class="carte-section carte-domaine ${ouvert ? "" : "verrouille"}" data-action="domaine" data-domaine="${d.id}">
      <span class="haut-domaine"><strong>${esc(d.nom)}</strong>${m ? `<span class="maitrise m${m}">${MAITRISES[m]}${m === 3 ? " · max" : ""}</span>` : ouvert ? "" : `<span class="cadenas">${ICONES.cadenas}</span>`}</span>
      <span class="texte-attenue petit">${esc(d.description)}</span>
      ${barre(reussies / d.lecons.length)}
      <span class="bas-domaine"><span>${reussies} / ${d.lecons.length} leçons</span><span class="difficulte" aria-label="Difficulté ${d.difficulte} sur 3">${"●".repeat(d.difficulte)}${"○".repeat(3 - d.difficulte)}</span></span>
      ${ouvert ? "" : `<span class="condition-domaine">${ICONES.cadenas} Se débloque quand ${esc(manque.join(" et "))} ${manque.length > 1 ? "sont certifiés" : "est certifié"}</span>`}
    </button>`;
  }

  function carteFinal() {
    const ouvert = toutCertifie();
    return `<button type="button" class="carte-section carte-final ${etat.final ? "reussi" : ""} ${ouvert ? "" : "verrouille"}" data-action="final" ${ouvert ? "" : "disabled"}>
      <span class="haut-domaine"><strong>${ICONES.trophee} Examen final</strong>${etat.final ? `<span class="maitrise m3">${pct(etat.final)}</span>` : ""}</span>
      <span class="texte-attenue petit">${ouvert ? "27 questions sur tous les domaines · 30 s par question · 85 % requis · +1 000 XP"
        : "Se débloque quand les 9 domaines sont certifiés"}</span>
    </button>`;
  }

  function ecranDomaine() {
    const d = domaine(vue.did);
    const ouvert = debloque(d);
    const toutesReussies = d.lecons.every(quizReussi);
    const ex = etat.examens[d.id] || {};
    const etapes = [["Bronze", "Tous les quiz à 60 % ou plus"], ["Argent", "Certification à 80 %"], ["Or", "Examen expert chronométré à 90 % · niveau max"]];
    return `
      <button type="button" class="bouton-retour" data-action="accueil"><span aria-hidden="true">←</span> Formation</button>
      <div class="carte-section carte-resume">
        <div class="titre-carte-compte"><strong>${esc(d.nom)}</strong><span class="badge-periode">${esc(d.niveau)}</span></div>
        <span class="texte-attenue">${esc(d.description)}</span>
        ${ouvert ? "" : `<span class="condition-domaine">${ICONES.cadenas} Se débloque quand ${esc(d.prerequis.filter((p) => !certifie(p)).map((p) => domaine(p).nom).join(" et "))} ${d.prerequis.filter((p) => !certifie(p)).length > 1 ? "sont certifiés" : "est certifié"}</span>`}
        <ol class="etapes-maitrise">${etapes.map(([nom, desc], i) => `<li class="${maitrise(d) > i ? "atteint" : ""}"><span class="maitrise m${i + 1}">${nom}</span><span class="petit texte-attenue">${desc}</span></li>`).join("")}</ol>
      </div>
      <ul class="liste-lecons">${d.lecons.map((lid, i) => {
        const l = cours.lecons[lid];
        const p = progres(lid);
        const ok = leconOuverte(d, i);
        return `<li><button type="button" class="ligne-lecon ${ok ? "" : "verrouille"} ${quizReussi(lid) ? "reussie" : ""}" data-action="lecon" data-lecon="${lid}" ${ok ? "" : "disabled"}>
          <span class="numero-lecon">${quizReussi(lid) ? ICONES.coche : ok ? i + 1 : ICONES.cadenas}</span>
          <span class="texte-lecon"><strong>${esc(l.titre)}</strong><span class="petit texte-attenue">${l.minutes} min${p.meilleur !== undefined ? ` · quiz ${pct(p.meilleur)}` : ""}${l.video ? "" : " · vidéo bientôt"}</span></span>
          <span class="fleche-compte" aria-hidden="true">›</span>
        </button></li>`;
      }).join("")}</ul>
      <div class="examens-domaine">
        <button type="button" class="carte-section carte-examen ${certifie(d.id) ? "reussi" : ""}" data-action="certif" data-domaine="${d.id}" ${ouvert && toutesReussies ? "" : "disabled"}>
          <strong>Certification <span class="maitrise m2">Argent</span></strong>
          <span class="petit texte-attenue">${certifie(d.id) ? `Réussie : ${pct(ex.certif)}` : toutesReussies ? `10 questions · 80 % requis · +${100 * d.difficulte} XP` : "Réussis tous les quiz du domaine pour la débloquer"}</span>
        </button>
        <button type="button" class="carte-section carte-examen ${expert(d.id) ? "reussi" : ""}" data-action="expert" data-domaine="${d.id}" ${certifie(d.id) ? "" : "disabled"}>
          <strong>Examen expert <span class="maitrise m3">Or · max</span></strong>
          <span class="petit texte-attenue">${expert(d.id) ? `Réussi : ${pct(ex.expert)}` : certifie(d.id) ? `12 questions difficiles · ${CHRONO.expert} s chacune · 90 % · +${150 * d.difficulte} XP` : "Après la certification"}</span>
        </button>
      </div>`;
  }

  function ecranLecon() {
    const l = cours.lecons[vue.lid];
    const d = domaine(l.domaine);
    const p = progres(l.id);
    return `
      <button type="button" class="bouton-retour" data-action="domaine" data-domaine="${d.id}"><span aria-hidden="true">←</span> ${esc(d.nom)}</button>
      <div class="carte-section carte-lecon">
        <span class="petit texte-attenue">${esc(d.nom)} · Leçon ${l.ordre} · ${l.minutes} min</span>
        <h3 class="titre-lecon">${esc(l.titre)}</h3>
        ${l.video ? `<video class="video-lecon" id="video-lecon" controls playsinline preload="metadata" src="formation/videos/${encodeURIComponent(l.id)}.mp4"></video>`
          : `<div class="video-absente">${ICONES.lecture}<span>Vidéo en préparation. Tu peux déjà lire la leçon ci-dessous.</span></div>`}
      </div>
      ${U.carteSection({ cle: "texte-lecon", titre: "Lire la leçon", ouvertes, resume: "",
        contenu: l.sections.map((s) => `<h4 class="sous-titre-analyse">${esc(s.titre)}</h4><p class="texte-lecon-ecrit">${esc(s.texte)}</p>`).join("") })}
      <div class="carte-section carte-retenir">
        <strong>À retenir</strong>
        <ol>${l.a_retenir.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
      </div>
      ${p.vue ? "" : `<button type="button" class="bouton secondaire" data-action="vue" data-lecon="${l.id}">J'ai terminé la leçon · +20 XP</button>`}
      <button type="button" class="bouton" data-action="quiz" data-lecon="${l.id}">${p.meilleur !== undefined ? `Refaire le quiz (meilleur : ${pct(p.meilleur)})` : "Passer le quiz"}</button>`;
  }

  // La vidéo regardée presque jusqu'au bout compte comme leçon terminée.
  function brancherVideo() {
    const v = $("video-lecon");
    if (!v) return;
    const lid = vue.lid;
    const verifier = () => { if (v.duration && v.currentTime / v.duration > 0.9) { marquerVue(lid); v.removeEventListener("timeupdate", verifier); } };
    v.addEventListener("timeupdate", verifier);
    v.addEventListener("error", () => {
      v.replaceWith(Object.assign(document.createElement("div"), { className: "video-absente", textContent: "Vidéo indisponible pour le moment. Tu peux lire la leçon ci-dessous." }));
    });
  }

  // ---------------------------------------------------------------- Quiz et examens
  const melanger = (t) => { const a = [...t]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const questionsLecon = (lid) => cours.lecons[lid].quiz.map((q, k) => ({ ...q, id: `${lid}#${k}` }));
  const questionsExamen = (did) => (cours.examens[did] || []).map((q, k) => ({ ...q, id: `examen:${did}#${k}` }));
  const questionsDomaine = (did) => domaine(did).lecons.flatMap(questionsLecon);

  function demarrer(type, cle) {
    let questions;
    if (type === "quiz") questions = questionsLecon(cle);
    else if (type === "certif") questions = melanger([...questionsDomaine(cle), ...questionsExamen(cle)]).slice(0, 10);
    else if (type === "expert") questions = melanger([...questionsExamen(cle), ...melanger(questionsDomaine(cle)).slice(0, 4)]);
    else if (type === "final") questions = melanger(cours.domaines.flatMap((d) => melanger([...questionsExamen(d.id), ...questionsDomaine(d.id)]).slice(0, 3)));
    else {  // défi du jour : d'abord les questions ratées, puis au hasard dans les leçons réussies
      const dispo = Object.keys(cours.lecons).filter(quizReussi).flatMap(questionsLecon);
      const ratees = dispo.filter((q) => etat.erreurs.includes(q.id));
      questions = [...melanger(ratees), ...melanger(dispo.filter((q) => !etat.erreurs.includes(q.id)))].slice(0, 5);
    }
    questions = questions.map((q) => ({ ...q, ordre: melanger(q.choix.map((_, i) => i)) }));
    const retour = type === "quiz" ? { nom: "lecon", lid: cle } : type === "certif" || type === "expert" ? { nom: "domaine", did: cle } : { nom: "accueil" };
    session = { type, cle, questions, i: 0, bonnes: 0, repondu: null, chrono: CHRONO[type] || 0, retour };
    gainsSession = [];
    niveauAvant = null;
    aller({ nom: "quiz" });
  }

  const NOMS_SESSION = { quiz: "Quiz", certif: "Certification", expert: "Examen expert", final: "Examen final", defi: "Défi du jour" };

  function ecranQuestion() {
    const s = session;
    const q = s.questions[s.i];
    const fini = s.repondu !== null;
    const titre = s.type === "quiz" ? cours.lecons[s.cle].titre : s.type === "certif" || s.type === "expert" ? domaine(s.cle).nom : NOMS_SESSION[s.type];
    return `
      <div class="entete-quiz">
        <button type="button" class="bouton-retour" data-action="quitter"><span aria-hidden="true">✕</span> Quitter</button>
        <span class="petit texte-attenue">${esc(NOMS_SESSION[s.type])} · ${esc(titre)}</span>
      </div>
      <div class="points-quiz">${s.questions.map((_, k) => `<span class="${k < s.i ? "fait" : k === s.i ? "actuel" : ""}"></span>`).join("")}</div>
      ${s.chrono && !fini ? `<div class="chrono-quiz">${barre(1, "chrono")}<span id="chrono-texte">${s.chrono} s</span></div>` : ""}
      <div class="carte-section carte-question">
        <span class="petit texte-attenue">Question ${s.i + 1} / ${s.questions.length}</span>
        <p class="texte-question">${esc(q.question)}</p>
        <div class="choix-quiz">${q.ordre.map((k) => {
          const classe = !fini ? "" : k === q.bonne ? "juste" : k === s.repondu ? "faux" : "";
          return `<button type="button" class="choix ${classe}" data-action="repondre" data-choix="${k}" ${fini ? "disabled" : ""}>${esc(q.choix[k])}</button>`;
        }).join("")}</div>
        ${fini ? `<div class="explication-quiz ${s.repondu === q.bonne ? "juste" : "faux"}"><strong>${s.repondu === q.bonne ? "Bonne réponse !" : s.repondu === -1 ? "Temps écoulé." : "Pas tout à fait."}</strong>
          <span>${esc(q.explication)}</span></div>` : ""}
      </div>
      ${fini ? `<button type="button" class="bouton" data-action="suivante">${s.i + 1 < s.questions.length ? "Question suivante" : "Voir le résultat"}</button>` : ""}`;
  }

  function demarrerChrono() {
    const s = session;
    if (!s.chrono || s.repondu !== null) return;
    const fin = Date.now() + s.chrono * 1000;
    const maj = () => {
      const reste = Math.max(0, fin - Date.now());
      const b = document.querySelector(".chrono-quiz .barre-formation span");
      if (b) b.style.width = `${(reste / (s.chrono * 1000)) * 100}%`;
      const t = $("chrono-texte");
      if (t) t.textContent = `${Math.ceil(reste / 1000)} s`;
      if (reste <= 0) { clearInterval(chrono); repondre(-1); }
    };
    chrono = setInterval(maj, 200);
    maj();
  }

  function repondre(k) {
    const s = session;
    if (!s || s.repondu !== null) return;
    clearInterval(chrono);
    const q = s.questions[s.i];
    s.repondu = k;
    if (k === q.bonne) { s.bonnes++; etat.erreurs = etat.erreurs.filter((id) => id !== q.id); }
    else if (!etat.erreurs.includes(q.id)) etat.erreurs = [...etat.erreurs, q.id].slice(-80);
    rendre();
  }

  function suivante() {
    const s = session;
    if (s.i + 1 < s.questions.length) { s.i++; s.repondu = null; rendre(); return; }
    terminer();
  }

  function terminer() {
    const s = session;
    const total = s.questions.length;
    const score = s.bonnes / total;
    const reussi = score >= SEUILS[s.type];
    silencieux = true;
    if (s.type === "quiz") {
      const p = (etat.lecons[s.cle] = etat.lecons[s.cle] || {});
      const avant = p.meilleurNb ?? 0;
      if (s.bonnes > avant) gagner((s.bonnes - avant) * 10, "Bonnes réponses");
      if (s.bonnes === total && avant < total) gagner(20, "Quiz parfait");
      p.meilleurNb = Math.max(avant, s.bonnes);
      p.meilleur = Math.max(p.meilleur ?? 0, score);
      if (reussi && !p.vue) marquerVue(s.cle);
    } else if (s.type === "certif" || s.type === "expert") {
      const d = domaine(s.cle);
      const ex = (etat.examens[d.id] = etat.examens[d.id] || {});
      const cleEssais = `essais_${s.type}`;
      if (reussi && !ex[s.type]) {
        gagner((s.type === "certif" ? 100 : 150) * d.difficulte, s.type === "certif" ? `Certification ${d.nom}` : `Niveau Or : ${d.nom}`);
        if (!ex[cleEssais]) gagner(50, "Réussi du premier coup");
      }
      if (reussi) ex[s.type] = Math.max(ex[s.type] || 0, score);
      ex[cleEssais] = (ex[cleEssais] || 0) + 1;
    } else if (s.type === "final") {
      if (reussi && !etat.final) gagner(1000, "Examen final réussi");
      if (reussi) etat.final = Math.max(etat.final || 0, score);
    } else if (s.type === "defi" && etat.defis.dernier !== aujourdHui()) {
      etat.defis.dernier = aujourdHui();
      etat.defis.total++;
      gagner(s.bonnes >= 4 ? 30 : 10, "Défi du jour");
    }
    silencieux = false;
    sauvegarder();
    s.resultat = { score, reussi, gains: gainsSession, niveauAvant, niveauApres: niveauDe(etat.xp) };
    aller({ nom: "resultat" });
  }

  function ecranResultat() {
    const s = session;
    const r = s.resultat;
    const seuilTxt = s.type === "defi" ? "" : `${pct(SEUILS[s.type])} requis`;
    const monte = r.niveauAvant !== null && r.niveauApres > r.niveauAvant;
    let suite = "";
    if (s.type === "quiz") {
      const d = domaine(cours.lecons[s.cle].domaine);
      const i = d.lecons.indexOf(s.cle);
      const prochaine = d.lecons[i + 1];
      if (r.reussi && prochaine) suite = `<button type="button" class="bouton" data-action="lecon" data-lecon="${prochaine}">Leçon suivante : ${esc(cours.lecons[prochaine].titre)}</button>`;
      else if (r.reussi && d.lecons.every(quizReussi)) suite = `<button type="button" class="bouton" data-action="certif" data-domaine="${d.id}">Passer la certification</button>`;
      suite += `<button type="button" class="bouton secondaire" data-action="quiz" data-lecon="${s.cle}">Refaire le quiz</button>
        <button type="button" class="bouton secondaire" data-action="lecon" data-lecon="${s.cle}">Revoir la leçon</button>`;
    } else if (s.type === "certif" || s.type === "expert") {
      suite = `${r.reussi ? "" : `<button type="button" class="bouton" data-action="${s.type}" data-domaine="${s.cle}">Réessayer</button>`}
        <button type="button" class="bouton secondaire" data-action="domaine" data-domaine="${s.cle}">Retour au domaine</button>`;
    } else if (s.type === "final" && !r.reussi) {
      suite = `<button type="button" class="bouton" data-action="final">Réessayer</button>`;
    }
    const message = s.type === "defi" ? "Défi du jour terminé" : r.reussi ? (s.type === "quiz" ? "Quiz réussi !" : s.type === "certif" ? "Certifié !" : s.type === "expert" ? "Niveau Or atteint !" : "Formation terminée !")
      : "Pas encore… Revois la leçon et réessaie.";
    return `
      <div class="carte-section carte-resultat ${r.reussi ? "reussi" : "rate"}">
        <span class="anneau-kpi" style="--p:${Math.round(r.score * 100)}"><strong>${pct(r.score)}</strong></span>
        <strong class="message-resultat">${esc(message)}</strong>
        <span class="petit texte-attenue">${s.bonnes} / ${s.questions.length} bonnes réponses${seuilTxt ? ` · ${seuilTxt}` : ""}</span>
        ${monte ? `<div class="niveau-monte">${ICONES.trophee}<span>Niveau ${r.niveauApres} : <strong>${esc(titreDe(r.niveauApres))}</strong></span></div>` : ""}
        ${r.gains.length ? `<ul class="gains-xp">${r.gains.map(([xp, raison]) => `<li><span>${esc(raison)}</span><strong>+${xp} XP</strong></li>`).join("")}</ul>` : ""}
      </div>
      ${suite}
      <button type="button" class="bouton secondaire" data-action="accueil">Retour à la formation</button>`;
  }

  // ---------------------------------------------------------------- Ouverture et clics
  const ouvertes = new Set();

  async function ouvrir() {
    const zone = $("formation-contenu");
    if (!zone || !window.GoldAI.auth?.getToken()) return;
    if (!cours || !etat) zone.innerHTML = `<p class="etat-vide">Chargement de la formation…</p>`;
    try {
      await Promise.all([chargerCours(), chargerEtat()]);
    } catch {
      zone.innerHTML = `<p class="etat-vide">Impossible de charger la formation. Vérifie ta connexion.</p>`;
      return;
    }
    if (vue.nom === "quiz" || vue.nom === "resultat") return rendre();  // on garde le quiz en cours
    rendre();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const zone = $("formation-contenu");
    if (!zone) return;
    U.basculerSections(zone, ouvertes);
    zone.addEventListener("click", (e) => {
      const b = e.target.closest("[data-action]");
      if (!b || b.disabled) return;
      const { action, lecon, domaine: did } = b.dataset;
      if (action === "accueil") aller({ nom: "accueil" });
      else if (action === "domaine") aller({ nom: "domaine", did });
      else if (action === "lecon") aller({ nom: "lecon", lid: lecon });
      else if (action === "vue") { marquerVue(lecon); rendre(); }
      else if (action === "quiz") demarrer("quiz", lecon);
      else if (action === "certif" || action === "expert") demarrer(action, did);
      else if (action === "final") demarrer("final");
      else if (action === "defi") demarrer("defi");
      else if (action === "repondre") repondre(Number(b.dataset.choix));
      else if (action === "suivante") suivante();
      else if (action === "quitter") { clearInterval(chrono); const retour = session?.retour || { nom: "accueil" }; session = null; aller(retour); }
    });
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.formation = { ouvrir, viderCache: () => { etat = null; vue = { nom: "accueil" }; session = null; } };
})();
