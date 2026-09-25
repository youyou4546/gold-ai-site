// Gold AI — Journal › Performance : statistiques et graphiques calculés à
// partir des trades RÉELS enregistrés (aucune donnée d'exemple).
//
// Règles de calcul (affichées aussi à l'écran) :
//  - Chaque trade du journal est un trade CLÔTURÉ (résultat réalisé). Le
//    journal ne suit pas de positions ouvertes.
//  - Résultat net = résultat saisi − frais (si des frais sont renseignés).
//  - Trade "à l'équilibre" = résultat net exactement 0,00 $. Il est compté à
//    part et EXCLU du taux de réussite : gagnants ÷ (gagnants + perdants).
//  - Toutes les valeurs du journal sont en USD ($) : aucune conversion.
//  - La courbe cumulée est la somme des résultats, PAS le solde du compte
//    (solde initial, dépôts et retraits ne sont pas connus ici).
// Graphiques : Chart.js (chargé depuis jsDelivr, mis en cache par l'app).
(() => {
  const DEVISE = "USD";
  const COULEURS = { gain: "#2fe0a3", perte: "#ff4d6d", equilibre: "#8a9bb0", ligne: "#22d3ee", grille: "rgba(120,137,158,0.18)", texte: "#aab7c8" };
  const filtre = { periode: "30j", regroupement: "jour", compte: "" };
  let graphiques = [];

  const U = () => window.GoldAI.utils;
  const m = (v, opts) => U().montant(v, DEVISE, opts);

  function net(t) { return Math.round((t.resultat - (t.frais || 0)) * 100) / 100; }

  function debutPeriode(periode) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (periode === "7j") d.setDate(d.getDate() - 6);
    else if (periode === "30j") d.setDate(d.getDate() - 29);
    else if (periode === "90j") d.setDate(d.getDate() - 89);
    else if (periode === "annee") { d.setMonth(0, 1); }
    else return null;
    return d;
  }

  function filtrer(trades) {
    const debut = debutPeriode(filtre.periode);
    return trades.filter((t) => {
      if (filtre.compte && t.compteTradingId !== filtre.compte) return false;
      if (!debut) return true;
      const [a, mo, j] = t.date.split("-").map(Number);
      return new Date(a, mo - 1, j) >= debut;
    });
  }

  function calculerStats(trades) {
    const nets = trades.map(net);
    const gagnants = nets.filter((x) => x > 0);
    const perdants = nets.filter((x) => x < 0);
    const equilibre = nets.filter((x) => x === 0).length;
    const decisifs = gagnants.length + perdants.length;
    const gainMoyen = gagnants.length ? gagnants.reduce((s, x) => s + x, 0) / gagnants.length : null;
    const perteMoyenne = perdants.length ? Math.abs(perdants.reduce((s, x) => s + x, 0) / perdants.length) : null;
    const fraisTotaux = trades.reduce((s, t) => s + (t.frais || 0), 0);
    return {
      nombre: trades.length, gagnants: gagnants.length, perdants: perdants.length, equilibre,
      tauxReussite: decisifs ? (gagnants.length / decisifs) * 100 : null,
      gainMoyen, perteMoyenne,
      ratio: gainMoyen !== null && perteMoyenne ? gainMoyen / perteMoyenne : null,
      resultatNet: nets.reduce((s, x) => s + x, 0),
      fraisTotaux, avecFrais: trades.some((t) => t.frais),
    };
  }

  function cleGroupe(dateIso) {
    const [a, mo, j] = dateIso.split("-").map(Number);
    if (filtre.regroupement === "mois") return `${a}-${String(mo).padStart(2, "0")}`;
    if (filtre.regroupement === "semaine") {
      const d = new Date(a, mo - 1, j);
      const decal = (d.getDay() + 6) % 7; // lundi = début de semaine
      d.setDate(d.getDate() - decal);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    return dateIso;
  }

  function libelleGroupe(cle) {
    const [a, mo, j] = cle.split("-").map(Number);
    if (filtre.regroupement === "mois") return new Date(a, mo - 1, 1).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
    const txt = new Date(a, mo - 1, j).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return filtre.regroupement === "semaine" ? `sem. ${txt}` : txt;
  }

  function carte(label, valeur, sous, classe = "") {
    return `<div class="carte-stat ${classe}"><div class="label-stat">${label}</div><div class="valeur-stat">${valeur}</div>${sous ? `<div class="sous-valeur-stat">${sous}</div>` : ""}</div>`;
  }

  function detruireGraphiques() {
    graphiques.forEach((g) => g.destroy());
    graphiques = [];
  }

  function optionsCommunes() {
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      plugins: { legend: { labels: { color: COULEURS.texte, boxWidth: 12 } }, tooltip: { backgroundColor: "#0b111c", borderColor: "#223049", borderWidth: 1, titleColor: "#e8edf5", bodyColor: "#e8edf5" } },
      scales: {
        x: { ticks: { color: COULEURS.texte, maxRotation: 0, autoSkip: true }, grid: { display: false } },
        y: { ticks: { color: COULEURS.texte, callback: (v) => m(v, { decimales: 0 }) }, grid: { color: COULEURS.grille } },
      },
    };
  }

  function afficher(trades) {
    const conteneur = document.getElementById("contenu-performance");
    detruireGraphiques();
    const s = calculerStats(trades);
    const classeNet = s.resultatNet > 0 ? "positif" : s.resultatNet < 0 ? "negatif" : "";
    const signeNet = s.resultatNet > 0 ? "▲ " : s.resultatNet < 0 ? "▼ " : "";

    if (trades.length === 0) {
      conteneur.innerHTML = `<div class="etat-vide-soigne"><div class="icone-placeholder">📊</div><h3>Aucun trade sur cette période</h3>
        <p>Ajoute tes trades depuis le Calendrier du journal, ou élargis la période ci-dessus. Les graphiques se construisent uniquement à partir de tes trades enregistrés.</p></div>`;
      return;
    }

    // --- Données des graphiques
    const tries = [...trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let cumul = 0;
    const parJour = new Map();
    tries.forEach((t) => { parJour.set(t.date, (parJour.get(t.date) || 0) + net(t)); });
    const pointsCumul = [...parJour.entries()].map(([date, v]) => { cumul += v; return { date, cumul: Math.round(cumul * 100) / 100 }; });

    const groupes = new Map();
    tries.forEach((t) => { const k = cleGroupe(t.date); groupes.set(k, (groupes.get(k) || 0) + net(t)); });

    const avecInstrument = trades.filter((t) => t.instrument);
    const parInstrument = new Map();
    avecInstrument.forEach((t) => {
      const x = parInstrument.get(t.instrument) || { net: 0, n: 0, g: 0, p: 0 };
      x.net += net(t); x.n += 1; if (net(t) > 0) x.g += 1; if (net(t) < 0) x.p += 1;
      parInstrument.set(t.instrument, x);
    });

    conteneur.innerHTML = `
      <div class="grille-stats-perf perf-v2">
        ${carte("Résultat net réalisé", `<span class="${classeNet}">${signeNet}${m(s.resultatNet, { signe: true })}</span>`, s.avecFrais ? `frais déduits : ${m(s.fraisTotaux)}` : "aucun frais renseigné", "carte-mise-en-avant")}
        ${carte("Taux de réussite", s.tauxReussite === null ? "—" : `${U().nombre(s.tauxReussite, 1)} %`, s.tauxReussite === null ? "aucun trade gagnant ou perdant" : `${s.gagnants} gagnant${s.gagnants > 1 ? "s" : ""} ÷ ${s.gagnants + s.perdants} (équilibre exclu)`)}
        ${carte("Trades clôturés", String(s.nombre), `${s.equilibre} à l'équilibre`)}
        ${carte("Gain moyen / perte moyenne", s.ratio === null ? "—" : s.ratio.toFixed(2), s.ratio === null ? (s.perdants === 0 ? "aucune perte sur la période" : "aucun gain sur la période") : `${m(s.gainMoyen)} / ${m(s.perteMoyenne)}`)}
      </div>

      <div class="grille-graphiques">
        <div class="carte carte-graphique">
          <h3 class="titre-bloc">Répartition des trades</h3>
          <div class="zone-anneau"><canvas id="graph-anneau" aria-label="Gagnants ${s.gagnants}, perdants ${s.perdants}, à l'équilibre ${s.equilibre}" role="img"></canvas></div>
          <ul class="legende-texte">
            <li><span class="pastille" style="background:${COULEURS.gain}"></span>▲ Gagnants : <strong>${s.gagnants}</strong></li>
            <li><span class="pastille" style="background:${COULEURS.perte}"></span>▼ Perdants : <strong>${s.perdants}</strong></li>
            <li><span class="pastille" style="background:${COULEURS.equilibre}"></span>= À l'équilibre : <strong>${s.equilibre}</strong></li>
          </ul>
        </div>
        <div class="carte carte-graphique large">
          <h3 class="titre-bloc">Résultat net cumulé</h3>
          <p class="aide">Somme des résultats nets des trades clôturés — ce n'est pas le solde du compte.</p>
          <div class="zone-graphique"><canvas id="graph-cumul" role="img" aria-label="Courbe du résultat net cumulé"></canvas></div>
        </div>
        <div class="carte carte-graphique large">
          <div class="entete-graphique">
            <h3 class="titre-bloc">Gains et pertes par ${filtre.regroupement}</h3>
            <div class="segmente petit" role="group" aria-label="Regroupement">
              ${["jour", "semaine", "mois"].map((r) => `<button type="button" data-regroupement="${r}" aria-pressed="${filtre.regroupement === r}">${r}</button>`).join("")}
            </div>
          </div>
          <div class="zone-graphique"><canvas id="graph-barres" role="img" aria-label="Barres des gains et pertes par ${filtre.regroupement}"></canvas></div>
        </div>
        ${parInstrument.size ? `
        <div class="carte carte-graphique large">
          <h3 class="titre-bloc">Résultats par instrument</h3>
          <div class="tableau-defilant"><table class="tableau-portions">
            <thead><tr><th>Instrument</th><th>Trades</th><th>Gagnants / perdants</th><th>Résultat net</th></tr></thead>
            <tbody>${[...parInstrument.entries()].sort((a, b) => b[1].net - a[1].net).map(([ins, x]) => `<tr><th scope="row">${U().esc(ins)}</th><td>${x.n}</td><td>${x.g} / ${x.p}</td><td class="${x.net > 0 ? "positif" : x.net < 0 ? "negatif" : ""}">${x.net > 0 ? "▲" : x.net < 0 ? "▼" : "="} ${m(x.net, { signe: true })}</td></tr>`).join("")}</tbody>
          </table></div>
          ${avecInstrument.length < trades.length ? `<p class="aide">${trades.length - avecInstrument.length} trade(s) sans instrument renseigné ne sont pas dans ce tableau.</p>` : ""}
        </div>` : `<p class="note-source">Résultats par instrument : renseigne l'instrument en ajoutant un trade pour voir cette répartition.</p>`}
      </div>

      <p class="note-source">Performances réalisées sur trades clôturés uniquement (le journal ne suit pas les positions ouvertes). Montants en ${DEVISE}. Trade à l'équilibre = résultat net de 0,00 $, exclu du taux de réussite.</p>`;

    if (typeof Chart === "undefined") {
      conteneur.insertAdjacentHTML("beforeend", `<p class="alerte-donnees">Graphiques indisponibles (bibliothèque non chargée — connexion ?). Les chiffres ci-dessus restent exacts.</p>`);
      return;
    }

    graphiques.push(new Chart(document.getElementById("graph-anneau"), {
      type: "doughnut",
      data: { labels: ["Gagnants", "Perdants", "À l'équilibre"], datasets: [{ data: [s.gagnants, s.perdants, s.equilibre], backgroundColor: [COULEURS.gain, COULEURS.perte, COULEURS.equilibre], borderColor: "#121a28", borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.label} : ${c.parsed} trade${c.parsed > 1 ? "s" : ""} (${((c.parsed / s.nombre) * 100).toFixed(0)} %)` } } } },
    }));

    const oc = optionsCommunes();
    graphiques.push(new Chart(document.getElementById("graph-cumul"), {
      type: "line",
      data: { labels: pointsCumul.map((p) => libelleGroupeJour(p.date)), datasets: [{ label: "Résultat net cumulé", data: pointsCumul.map((p) => p.cumul), borderColor: COULEURS.ligne, backgroundColor: "rgba(34,211,238,0.10)", fill: true, borderWidth: 2, pointRadius: pointsCumul.length > 40 ? 0 : 3, pointHoverRadius: 5, tension: 0.2 }] },
      options: { ...oc, interaction: { mode: "index", intersect: false }, plugins: { ...oc.plugins, legend: { display: false },
        tooltip: { ...oc.plugins.tooltip, callbacks: { label: (c) => ` Cumul : ${m(c.parsed.y, { signe: true })}` } } } },
    }));

    const cles = [...groupes.keys()];
    graphiques.push(new Chart(document.getElementById("graph-barres"), {
      type: "bar",
      data: { labels: cles.map(libelleGroupe), datasets: [{ label: "Résultat net", data: cles.map((k) => Math.round(groupes.get(k) * 100) / 100),
        backgroundColor: cles.map((k) => (groupes.get(k) >= 0 ? COULEURS.gain : COULEURS.perte)), borderRadius: 4, maxBarThickness: 28 }] },
      options: { ...oc, plugins: { ...oc.plugins, legend: { display: false },
        tooltip: { ...oc.plugins.tooltip, callbacks: { label: (c) => ` ${c.parsed.y >= 0 ? "▲ Gain" : "▼ Perte"} : ${m(c.parsed.y, { signe: true })}` } } } },
    }));
  }

  function libelleGroupeJour(dateIso) {
    const [a, mo, j] = dateIso.split("-").map(Number);
    return new Date(a, mo - 1, j).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }

  async function peuplerFiltreComptes() {
    const select = document.getElementById("select-filtre-compte-perf");
    const comptes = await window.GoldAI.comptesTrading.chargerComptes();
    select.innerHTML = `<option value="">Tous les comptes</option>`;
    comptes.forEach((c) => {
      const option = document.createElement("option");
      option.value = c.id;
      option.textContent = c.nom;
      select.appendChild(option);
    });
    select.value = filtre.compte;
    select.parentElement.style.display = comptes.length > 0 ? "block" : "none";
  }

  async function rafraichir({ recharger = true } = {}) {
    if (recharger) await window.GoldAI.journal.chargerTousLesTrades(true);
    afficher(filtrer(window.GoldAI.journal.obtenirTradesBruts()));
  }

  function visible() {
    return !document.getElementById("journal-performance").classList.contains("hidden");
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("bouton-ouvrir-performance")?.addEventListener("click", async () => {
      document.getElementById("journal-accueil").classList.add("hidden");
      document.getElementById("journal-performance").classList.remove("hidden");
      document.getElementById("contenu-performance").innerHTML = `<p class="etat-vide">Chargement…</p>`;
      await peuplerFiltreComptes();
      await rafraichir();
    });

    document.getElementById("bouton-retour-performance")?.addEventListener("click", () => {
      detruireGraphiques();
      document.getElementById("journal-performance").classList.add("hidden");
      document.getElementById("journal-accueil").classList.remove("hidden");
    });

    document.getElementById("select-filtre-compte-perf")?.addEventListener("change", (e) => { filtre.compte = e.target.value; rafraichir({ recharger: false }); });
    document.getElementById("filtres-periode-perf")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-periode]");
      if (!b) return;
      filtre.periode = b.dataset.periode;
      document.querySelectorAll("#filtres-periode-perf [data-periode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      rafraichir({ recharger: false });
    });
    document.getElementById("contenu-performance")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-regroupement]");
      if (!b) return;
      filtre.regroupement = b.dataset.regroupement;
      rafraichir({ recharger: false });
    });
  });

  // Ajout / suppression d'un trade → tous les graphiques sont recalculés.
  window.addEventListener("goldai:trades", () => { if (visible()) rafraichir({ recharger: false }); });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.performance = { calculerStats, rafraichir };
})();
