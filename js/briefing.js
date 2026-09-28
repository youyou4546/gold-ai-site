// Gold AI — Analyse › Briefing du jour (lu à voix haute).
//
// Même esprit que le briefing du matin de gold-ai (scripts/analyse_flash.py),
// mais construit dans l'app au moment où l'on appuie sur « Écouter », avec les
// données déjà chargées : prix de l'or (direct), dollar et rendement 10 ans
// (data/marche.json), annonces du jour (calendrier), actualités confirmées,
// et ta journée (garde-fou, objectif).
// Voix : synthèse vocale intégrée au téléphone / navigateur (Web Speech API) —
// gratuite, sans clé, rien n'est envoyé à un service payant.
(() => {
  const N = window.GoldAI.noyau;
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);

  let glossaire = null;
  let phrases = [];
  let enLecture = false;

  // ---------------------------------------------------------------- Mise en mots

  const nb = (x, d = 1) => Number(x).toFixed(d).replace(".", ",");     // « 4127,6 » (lu correctement)
  const heureParlee = (ms) => U.heure(ms).replace(":", " h ").replace(/ h 00$/, " h");
  function dans(ms) {
    const min = Math.max(1, Math.round((ms - Date.now()) / 60000));
    if (min < 60) return `dans ${min} minute${min > 1 ? "s" : ""}`;
    const h = Math.floor(min / 60), m = min % 60;
    return `dans ${h} heure${h > 1 ? "s" : ""}${m ? ` ${m}` : ""}`;
  }

  async function chargerGlossaire() {
    if (glossaire) return glossaire;
    try { glossaire = await (await fetch("data/glossaire_annonces.json")).json(); } catch { glossaire = { annonces: [] }; }
    return glossaire;
  }
  const fiche = (titre) => glossaire?.annonces?.find((a) => a.mots_cles.some((m) => String(titre).toLowerCase().includes(m))) || null;
  // « CPI (indice des prix à la consommation) » → « l'indice des prix à la consommation, le CPI »
  function nomParle(e) {
    const f = fiche(e.titre);
    if (!f) return e.titre;
    const m = f.nom.match(/^(.+?)\s*\((.+)\)$/);
    return m ? `${m[2]}, le ${m[1]}` : f.nom;
  }

  function actif(cle) {
    return (window.GoldAI.donnees.obtenir("marche")?.contenu?.actifs || []).find((a) => a.cle === cle && !a.erreur) || null;
  }

  function construire() {
    const maintenant = Date.now();
    const p = [];
    p.push(`Bonjour. Voici ton briefing du ${U.formaterDate(maintenant, { weekday: "long", day: "numeric", month: "long" })}, à ${heureParlee(maintenant)}.`);

    // 1. L'or
    const or = actif("or");
    const c = window.GoldAI.cotations?.instantane?.();
    const prix = c && c.prix !== null && (c.fraicheur === "direct" || c.fraicheur === "retard") ? c.prix : or?.prix;
    if (prix) {
      const ref = or?.cloture_precedente;
      const variation = ref ? ((prix - ref) / ref) * 100 : null;
      p.push(`L'or est à ${nb(prix, 1)} dollars${variation === null ? "" : Math.abs(variation) < 0.05 ? ", quasiment stable depuis la clôture d'hier" : `, en ${variation > 0 ? "hausse" : "baisse"} de ${nb(Math.abs(variation), 2)} pour cent depuis la clôture d'hier`}.`);
    } else {
      p.push("Le prix de l'or n'est pas disponible pour l'instant.");
    }

    // 2. Le contexte : dollar et rendements (sens inverse de l'or)
    let pour = 0, contre = 0;
    for (const [cle, nom] of [["dollar", "Le dollar"], ["rendement10ans", "Le rendement américain à 10 ans"]]) {
      const a = actif(cle);
      if (!a || a.variation_pct === null || a.variation_pct === undefined) continue;
      const v = Number(a.variation_pct);
      if (Math.abs(v) < 0.1) { p.push(`${nom} est stable.`); continue; }
      if (v > 0) contre++; else pour++;
      p.push(`${nom} ${v > 0 ? "monte" : "baisse"} de ${nb(Math.abs(v), 2)} pour cent, ce qui ${v > 0 ? "pèse sur l'or" : "aide plutôt l'or"}.`);
    }
    const argent = actif("argent");
    if (argent && Math.abs(Number(argent.variation_pct)) >= 1) {
      p.push(`L'argent, qui suit souvent l'or, ${argent.variation_pct > 0 ? "monte" : "recule"} de ${nb(Math.abs(argent.variation_pct), 1)} pour cent.`);
    }
    if (pour || contre) {
      p.push(`Au global, le contexte est ${pour > contre ? "plutôt favorable" : contre > pour ? "plutôt défavorable" : "partagé"} pour l'or.`);
    }

    // 3. Les annonces du jour sur le dollar
    const jour = U.cleJour(maintenant);
    const annonces = (window.GoldAI.calendrier?.evenementsCalendrier?.() || [])
      .filter((e) => e.devise === "USD" && (e.impact === "high" || e.impact === "medium") && e.horodatage_utc && U.cleJour(e.horodatage_utc) === jour)
      .map((e) => ({ e, ms: Date.parse(e.horodatage_utc) }))
      .sort((a, b) => a.ms - b.ms);
    const aVenir = annonces.filter((x) => x.ms > maintenant);
    if (!annonces.length) {
      p.push("Aucune annonce importante sur le dollar aujourd'hui.");
    } else if (!aVenir.length) {
      p.push(`Les ${annonces.length} annonce${annonces.length > 1 ? "s" : ""} importante${annonces.length > 1 ? "s" : ""} du jour sur le dollar sont déjà passées.`);
    } else {
      p.push(`Il reste ${aVenir.length} annonce${aVenir.length > 1 ? "s" : ""} importante${aVenir.length > 1 ? "s" : ""} sur le dollar aujourd'hui.`);
      for (const { e, ms } of aVenir.slice(0, 4)) {
        const v = (e.valeurs || [])[0] || {};
        let phrase = `À ${heureParlee(ms)}, ${nomParle(e)}${e.impact === "high" ? ", impact fort" : ""}${v.prevision ? `, prévision ${v.prevision.replace(".", ",").replace("%", " pour cent")}` : ""}.`;
        const f = fiche(e.titre);
        const dir = f?.si_superieur?.direction;
        if (e.impact === "high" && f?.or_affecte && dir) phrase += ` Un chiffre au-dessus de la prévision serait plutôt ${dir === "baisse" ? "baissier" : "haussier"} pour l'or.`;
        p.push(phrase);
      }
      const prochaine = aVenir[0];
      if (prochaine.ms - maintenant <= 60 * 60000) p.push(`Attention, la prochaine tombe ${dans(prochaine.ms)} : attends la publication avant d'entrer.`);
    }

    // 4. Les actualités confirmées des dernières 24 heures, avec un effet clair sur l'or
    const actus = (window.GoldAI.donnees.obtenir("actualites")?.contenu?.evenements || [])
      .filter((n) => (n.statut === "confirmé" || n.statut === "en développement") && maintenant - Date.parse(n.publie_le) < 24 * 3600000)
      .map((n) => ({ n, dir: n.interpretation?.direction_or }))
      .filter((x) => x.dir === "haussier" || x.dir === "baissier")
      .map((x) => ({ ...x, score: N.scorePriorite({ ...x.n, type: "actualite" }, maintenant).score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (actus.length) {
      p.push("Côté actualités.");
      for (const { n, dir } of actus) {
        const titre = String(n.titre_fr || n.titre_original).trim();
        p.push(`${titre}${/[.!?…]$/.test(titre) ? "" : "."} Plutôt ${dir} pour l'or.`);
      }
    }

    // 5. Ta journée
    const g = window.GoldAI.gardeFou?.etat?.();
    if (g) {
      if (!g.nb) p.push(`De ton côté, tu n'as pas encore pris de trade aujourd'hui${g.maxTrades ? `, sur ${g.maxTrades} autorisés` : ""}.`);
      else p.push(`De ton côté, ${g.nb} trade${g.nb > 1 ? "s" : ""} aujourd'hui${g.maxTrades ? ` sur ${g.maxTrades}` : ""}, pour un résultat de ${g.net < 0 ? "moins " : g.net > 0 ? "plus " : ""}${nb(Math.abs(g.net), 0)} dollars.`);
      if (g.niveau === "bloque") p.push("Une de tes règles est atteinte : ta journée de trading est terminée.");
    }
    if (window.GoldAI.dernierObjectif?.atteint) p.push("Ton objectif est atteint : pense à protéger tes gains.");

    p.push("Bon trading.");
    return p;
  }

  // ---------------------------------------------------------------- Voix

  const vocal = () => "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  function voixFrancaise() {
    const voix = speechSynthesis.getVoices().filter((v) => /^fr/i.test(v.lang));
    const preferees = /Thomas|Amélie|Amelie|Audrey|Aurélie|Marie|Google français|Denise|Henri|Vivienne/i;
    return voix.find((v) => /^fr-FR/i.test(v.lang) && preferees.test(v.name)) || voix.find((v) => /^fr-FR/i.test(v.lang)) || voix[0] || null;
  }

  function surligner(i) {
    document.querySelectorAll("#briefing-texte li").forEach((li, k) => li.classList.toggle("en-cours", k === i));
  }

  function etatBoutons() {
    $("briefing-play").textContent = enLecture ? (speechSynthesis.paused ? "▶️ Reprendre" : "⏸ Pause") : "▶️ Écouter le briefing";
    $("briefing-stop").classList.toggle("hidden", !enLecture);
  }

  function arreter() {
    if (vocal()) speechSynthesis.cancel();
    enLecture = false;
    surligner(-1);
    etatBoutons();
  }

  async function jouer() {
    if (!vocal()) { $("briefing-voix").textContent = "Ce navigateur ne sait pas lire à voix haute."; return; }
    if (enLecture) { // pause / reprise
      if (speechSynthesis.paused) speechSynthesis.resume(); else speechSynthesis.pause();
      etatBoutons();
      return;
    }
    await chargerGlossaire();
    phrases = construire();
    afficherTexte();
    speechSynthesis.cancel();
    const voix = voixFrancaise();
    $("briefing-voix").textContent = voix ? `Voix : ${voix.name}` : "Voix française par défaut du téléphone.";
    enLecture = true;
    // Une phrase à la fois : plus fiable sur iPhone (les longs textes y sont parfois coupés).
    phrases.forEach((texte, i) => {
      const u = new SpeechSynthesisUtterance(texte);
      u.lang = "fr-FR";
      if (voix) u.voice = voix;
      u.rate = 1;
      u.onstart = () => surligner(i);
      if (i === phrases.length - 1) u.onend = () => { enLecture = false; surligner(-1); etatBoutons(); };
      u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") arreter(); };
      speechSynthesis.speak(u);
    });
    etatBoutons();
  }

  function afficherTexte() {
    $("briefing-texte").innerHTML = phrases.map((t) => `<li>${esc(t)}</li>`).join("");
    $("briefing-maj").textContent = `préparé à ${U.heure(Date.now())}`;
  }

  async function preparer() {
    if (enLecture) return;
    await chargerGlossaire();
    phrases = construire();
    afficherTexte();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("briefing-play")?.addEventListener("click", jouer);
    $("briefing-stop")?.addEventListener("click", arreter);
    // La liste des voix arrive parfois après le chargement de la page.
    if (vocal()) speechSynthesis.onvoiceschanged = () => {};
    // Ouverture de l'onglet Analyse : le texte est préparé (sans parler).
    document.querySelector('nav.barre-onglets button.onglet[data-section="analyse"]')?.addEventListener("click", preparer);
  });
  window.GoldAI.briefing = { construire, preparer };

  // On quitte l'app : la lecture s'arrête.
  document.addEventListener("visibilitychange", () => { if (document.hidden && enLecture) arreter(); });
})();
