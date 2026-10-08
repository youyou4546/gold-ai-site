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
//  - Affichage volontairement minimal : des titres et « Go », pas de descriptions.
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
  const SEUILS = { quiz: 0.6, certif: 0.8, expert: 0.9, final: 0.85, defi: 0.8 };
  const CHRONO = { expert: 25, final: 30 };
  const MAITRISES = ["", "Bronze", "Argent", "Or"];
  const ICONES = {
    cadenas: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    coche: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>',
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
    defis: { dernier: null, total: 0 }, erreurs: [] });

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

  // Une ligne = un titre + « Go » (ou un cadenas). Pas d'autre texte.
  function ligne({ action, titre, lecon = "", did = "", ouvert = true, fait = false, gauche = "", chip = "" }) {
    return `<button type="button" class="ligne-formation ${ouvert ? "" : "verrouille"} ${fait ? "fait" : ""}" data-action="${action}" data-lecon="${lecon}" data-domaine="${did}" ${ouvert ? "" : "disabled"}>
      ${gauche ? `<span class="numero-lecon">${gauche}</span>` : ""}
      <span class="titre-ligne-formation">${esc(titre)}</span>
      ${chip}
      ${ouvert ? `<span class="go-formation">${fait ? ICONES.coche : "Go"}</span>` : `<span class="cadenas">${ICONES.cadenas}</span>`}
    </button>`;
  }

  const chipMaitrise = (m) => (m ? `<span class="maitrise m${m}">${MAITRISES[m]}</span>` : "");

  function carteCarriere() {
    const n = niveauDe(etat.xp);
    const debut = seuil(n), fin = seuil(n + 1);
    const avance = n >= NIVEAU_MAX ? 1 : (etat.xp - debut) / (fin - debut);
    return `<div class="carte-section carte-resume carte-carriere">
      <div class="titre-carte-compte"><span class="metier-formation">${esc(titreDe(n))}</span><span class="badge-periode">Niveau ${n}</span></div>
      ${barre(avance, "xp")}
      <span class="petit texte-attenue">${etat.xp.toLocaleString("fr-FR")} XP</span>
    </div>`;
  }

  function ecranAccueil() {
    const defiDispo = Object.keys(cours.lecons).some(quizReussi);
    const defiFait = etat.defis.dernier === aujourdHui();
    const niveaux = [...new Set(cours.domaines.map((d) => d.niveau))];
    return `
      <button type="button" class="bouton-retour" data-action="profil"><span aria-hidden="true">←</span> Profil</button>
      ${carteCarriere()}
      ${defiDispo ? ligne({ action: "defi", titre: "Défi du jour", ouvert: !defiFait, fait: defiFait, gauche: ICONES.eclair }) : ""}
      ${niveaux.map((niv) => `<h3 class="sous-titre-formation">${esc(niv)}</h3>
        ${cours.domaines.filter((d) => d.niveau === niv).map((d) =>
          ligne({ action: "domaine", did: d.id, titre: d.nom, ouvert: debloque(d), chip: chipMaitrise(maitrise(d)) })).join("")}`).join("")}
      <h3 class="sous-titre-formation">Final</h3>
      ${ligne({ action: "final", titre: "Examen final", ouvert: toutCertifie(), gauche: ICONES.trophee, chip: etat.final ? `<span class="maitrise m3">${pct(etat.final)}</span>` : "" })}`;
  }

  function ecranDomaine() {
    const d = domaine(vue.did);
    const ouvert = debloque(d);
    return `
      <button type="button" class="bouton-retour" data-action="accueil"><span aria-hidden="true">←</span> Formation</button>
      <h3 class="titre-lecon">${esc(d.nom)} ${chipMaitrise(maitrise(d))}</h3>
      ${d.lecons.map((lid, i) => ligne({ action: "lecon", lecon: lid, titre: cours.lecons[lid].titre, ouvert: leconOuverte(d, i),
        fait: quizReussi(lid), gauche: String(i + 1) })).join("")}
      <h3 class="sous-titre-formation">Examens</h3>
      ${ligne({ action: "certif", did: d.id, titre: "Certification", ouvert: ouvert && d.lecons.every(quizReussi), chip: chipMaitrise(2) })}
      ${ligne({ action: "expert", did: d.id, titre: "Examen expert", ouvert: certifie(d.id), chip: chipMaitrise(3) })}`;
  }

  function ecranLecon() {
    const l = cours.lecons[vue.lid];
    const d = domaine(l.domaine);
    return `
      <button type="button" class="bouton-retour" data-action="domaine" data-domaine="${d.id}"><span aria-hidden="true">←</span> ${esc(d.nom)}</button>
      <h3 class="titre-lecon">${esc(l.titre)}</h3>
      ${l.video ? `<video class="video-lecon" id="video-lecon" controls playsinline preload="metadata" src="formation/videos/${encodeURIComponent(l.id)}.mp4"></video>` : ""}
      <button type="button" class="bouton" data-action="quiz" data-lecon="${l.id}">Quiz</button>`;
  }

  // La vidéo regardée presque jusqu'au bout compte comme leçon terminée.
  function brancherVideo() {
    const v = $("video-lecon");
    if (!v) return;
    const lid = vue.lid;
    const verifier = () => { if (v.duration && v.currentTime / v.duration > 0.9) { marquerVue(lid); v.removeEventListener("timeupdate", verifier); } };
    v.addEventListener("timeupdate", verifier);
    v.addEventListener("error", () => {
      v.replaceWith(Object.assign(document.createElement("div"), { className: "video-absente", textContent: "Vidéo indisponible pour le moment." }));
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

  function ecranQuestion() {
    const s = session;
    const q = s.questions[s.i];
    const fini = s.repondu !== null;
    return `
      <div class="entete-quiz">
        <button type="button" class="bouton-retour" data-action="quitter"><span aria-hidden="true">✕</span> Quitter</button>
      </div>
      <div class="points-quiz">${s.questions.map((_, k) => `<span class="${k < s.i ? "fait" : k === s.i ? "actuel" : ""}"></span>`).join("")}</div>
      ${s.chrono && !fini ? `<div class="chrono-quiz">${barre(1, "chrono")}<span id="chrono-texte">${s.chrono} s</span></div>` : ""}
      <div class="carte-section carte-question">
        <p class="texte-question">${esc(q.question)}</p>
        <div class="choix-quiz">${q.ordre.map((k) => {
          const classe = !fini ? "" : k === q.bonne ? "juste" : k === s.repondu ? "faux" : "";
          return `<button type="button" class="choix ${classe}" data-action="repondre" data-choix="${k}" ${fini ? "disabled" : ""}>${esc(q.choix[k])}</button>`;
        }).join("")}</div>
        ${fini ? `<div class="explication-quiz ${s.repondu === q.bonne ? "juste" : "faux"}"><strong>${s.repondu === q.bonne ? "Bonne réponse !" : s.repondu === -1 ? "Temps écoulé." : "Pas tout à fait."}</strong>
          <span>${esc(q.explication)}</span></div>` : ""}
      </div>
      ${fini ? `<button type="button" class="bouton" data-action="suivante">${s.i + 1 < s.questions.length ? "Suivante" : "Résultat"}</button>` : ""}`;
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
    const monte = r.niveauAvant !== null && r.niveauApres > r.niveauAvant;
    const xp = r.gains.reduce((t, [x]) => t + x, 0);
    let suite = "";
    if (s.type === "quiz") {
      const d = domaine(cours.lecons[s.cle].domaine);
      const prochaine = d.lecons[d.lecons.indexOf(s.cle) + 1];
      if (r.reussi && prochaine) suite = `<button type="button" class="bouton" data-action="lecon" data-lecon="${prochaine}">Leçon suivante</button>`;
      else if (r.reussi && d.lecons.every(quizReussi)) suite = `<button type="button" class="bouton" data-action="certif" data-domaine="${d.id}">Certification</button>`;
      else if (!r.reussi) suite = `<button type="button" class="bouton" data-action="quiz" data-lecon="${s.cle}">Réessayer</button>`;
    } else if ((s.type === "certif" || s.type === "expert" || s.type === "final") && !r.reussi) {
      suite = `<button type="button" class="bouton" data-action="${s.type}" data-domaine="${s.cle || ""}">Réessayer</button>`;
    }
    return `
      <div class="carte-section carte-resultat ${r.reussi ? "reussi" : "rate"}">
        <span class="anneau-kpi" style="--p:${Math.round(r.score * 100)}"><strong>${pct(r.score)}</strong></span>
        ${xp ? `<strong class="message-resultat">+${xp} XP</strong>` : ""}
        ${monte ? `<div class="niveau-monte">${ICONES.trophee}<span>Niveau ${r.niveauApres} : <strong>${esc(titreDe(r.niveauApres))}</strong></span></div>` : ""}
      </div>
      ${suite}
      <button type="button" class="bouton secondaire" data-action="${esc(s.retour.nom)}" data-lecon="${s.retour.lid || ""}" data-domaine="${s.retour.did || ""}">Retour</button>`;
  }

  // ---------------------------------------------------------------- Ouverture et clics
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
    zone.addEventListener("click", (e) => {
      const b = e.target.closest("[data-action]");
      if (!b || b.disabled) return;
      const { action, lecon, domaine: did } = b.dataset;
      if (action === "profil") window.GoldAI.app?.allerA("profil");
      else if (action === "accueil") aller({ nom: "accueil" });
      else if (action === "domaine") aller({ nom: "domaine", did });
      else if (action === "lecon") aller({ nom: "lecon", lid: lecon });
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
