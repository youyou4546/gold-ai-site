// Gold AI — Journal › Performance : suivi du challenge de chaque compte
// TradeLocker relié, comme l'écran de la prop firm :
//  - Perte max : perdu / limite, niveau de rupture (fixe, ou « suiveuse » qui
//    monte avec le plus haut atteint et se bloque au départ, ex. Nova) ;
//  - Objectif de profit : réalisé / restant, niveau à atteindre.
// Solde : TradeLocker (fonction « tradelocker », action « comptes »).
// Règles par compte (départ, perte max, objectif, type) : réglées ici et
// enregistrées avec les paramètres du calculateur (reglesComptes).
// Calcul : js/noyau.js › etatChallenge.
(() => {
  const N = window.GoldAI.noyau;
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const J = () => window.GoldAI.journal;

  let comptes = [];      // [{ cle, nom, solde, devise }]
  let regles = {};       // { cle: { depart, perteMax, objectif, perteJour, suiveuse, plusHaut } }
  let enReglage = null;  // compte dont le formulaire de règles est ouvert

  const argent = (v, d = "USD", signe = false) => U.montant(v, d, { signe });

  async function chargerRegles() {
    regles = { ...((await window.GoldAI.reglagesCalculateur.charger()).reglesComptes || {}) };
  }

  async function sauverRegles() {
    const r = await window.GoldAI.reglagesCalculateur.charger({ forcer: true });
    await window.GoldAI.reglagesCalculateur.sauvegarder({ ...r, reglesComptes: regles });
  }

  // Le « plus haut atteint » (perte max suiveuse) est mis à jour quand l'app voit un solde plus haut.
  async function memoriserPlusHauts() {
    let change = false;
    for (const c of comptes) {
      const rg = regles[c.cle];
      if (rg?.suiveuse && Number.isFinite(c.solde) && c.solde > (Number(rg.plusHaut) || 0)) { rg.plusHaut = c.solde; change = true; }
    }
    if (change) await sauverRegles();
  }

  function formulaire(c) {
    const rg = regles[c.cle] || {};
    return `
      <form class="form-regles-challenge" data-regles-form="${esc(c.cle)}">
        <div class="ligne-champs">
          <div class="champ"><label>Taille du compte au départ ($)</label><input name="depart" type="number" inputmode="decimal" step="any" min="0" value="${rg.depart ?? ""}" placeholder="ex. 100000"></div>
          <div class="champ"><label>Perte max ($)</label><input name="perteMax" type="number" inputmode="decimal" step="any" min="0" value="${rg.perteMax ?? ""}" placeholder="ex. 5000"></div>
          <div class="champ"><label>Objectif de profit ($)</label><input name="objectif" type="number" inputmode="decimal" step="any" min="0" value="${rg.objectif ?? ""}" placeholder="ex. 5000"></div>
          <div class="champ"><label>Perte max par jour ($)</label><input name="perteJour" type="number" inputmode="decimal" step="any" min="0" value="${rg.perteJour ?? ""}" placeholder="ex. 3000"></div>
        </div>
        <p class="texte-attenue petit">Perte max par jour : le garde-fou t'avertit à 70 %, bloque le calculateur à 100 %, et tu reçois une notification (calculée avec l'équité TradeLocker, trades ouverts compris).</p>
        <label class="case-a-cocher case-regle"><input type="checkbox" name="suiveuse" ${rg.suiveuse ? "checked" : ""}>
          <span><strong>Perte max « suiveuse »</strong><br>Le niveau de rupture monte avec ton plus haut solde, puis se bloque au solde de départ (ex. comptes Nova).</span></label>
        <div class="boutons-confirmation">
          <button type="button" class="bouton secondaire bouton-petit" data-annuler-regles>Annuler</button>
          <button type="submit" class="bouton bouton-petit">Enregistrer</button>
        </div>
      </form>`;
  }

  // Perte du jour de ce compte (trades du journal d'aujourd'hui) face à sa perte max par jour.
  function blocPerteJour(c, d) {
    const limite = Number(regles[c.cle]?.perteJour);
    if (!(limite > 0)) return "";
    const aujourdhui = window.GoldAI.gardeFou?.cleAujourdhui?.();
    const net = J().obtenirTradesBruts().filter((t) => t.compteTl === c.cle && t.date === aujourdhui)
      .reduce((s, t) => s + Number(t.resultat) - (Number(t.frais) || 0), 0);
    const perte = Math.max(0, -net), reste = Math.max(0, limite - perte), pct = Math.min(100, (perte / limite) * 100);
    return `<div class="bloc-challenge perte">
        <div class="lib">Perte max du jour</div>
        <div class="grand ${perte > 0 ? "negatif" : ""}">${argent(perte, d)} perdus aujourd'hui${perte >= limite ? " · limite atteinte" : ""}</div>
        <div class="barre-objectif"><div class="remplissage-objectif" style="width:${pct}%"></div></div>
        <div class="pied"><span>Limite ${argent(limite, d)}</span><span>Reste <strong>${argent(reste, d)}</strong></span></div>
      </div>`;
  }

  function carte(c) {
    const nom = J().surnomDe(c.cle) || c.nom;
    const d = c.devise || "USD";
    const e = N.etatChallenge(regles[c.cle], c.solde);
    const entete = `<div class="entete-challenge"><strong>${esc(nom)}</strong>
      <span>Solde <strong>${Number.isFinite(c.solde) ? argent(c.solde, d) : "—"}</strong>
      ${enReglage === c.cle ? "" : ` · <button type="button" class="lien-retour" data-regler="${esc(c.cle)}">Règles</button>`}</span></div>`;
    if (enReglage === c.cle) return `<div class="carte carte-challenge">${entete}${formulaire(c)}</div>`;
    const jour = blocPerteJour(c, d);
    if (!e || (!e.perte && !e.objectif)) {
      if (jour) return `<div class="carte carte-challenge">${entete}${jour}</div>`;
      return `<div class="carte carte-challenge">${entete}
        <p class="texte-attenue petit">Indique la taille de départ, la perte max et l'objectif de ce compte pour suivre ton challenge ici.</p>
        <button type="button" class="bouton bouton-petit" data-regler="${esc(c.cle)}">Régler ce compte</button></div>`;
    }
    const p = e.perte, o = e.objectif;
    return `<div class="carte carte-challenge">${entete}
      ${jour}
      ${p ? `<div class="bloc-challenge perte">
        <div class="lib">Perte max</div>
        <div class="grand ${p.perdu > 0 ? "negatif" : ""}">${argent(p.perdu, d)} perdus${p.depassee ? " · limite atteinte" : ""}</div>
        <div class="barre-objectif"><div class="remplissage-objectif" style="width:${p.pourcentage}%"></div></div>
        <div class="pied"><span>Limite ${argent(p.limite, d)}</span><span>Niveau de rupture : ${argent(p.niveau, d)}</span></div>
        <div class="pied"><span>Marge avant rupture</span><strong>${argent(p.marge, d)}</strong></div>
        ${regles[c.cle].suiveuse ? `<div class="pied"><span>Plus haut atteint (vu par l'app)</span><span>${argent(p.plusHaut, d)}</span></div>` : ""}
      </div>` : ""}
      ${o ? `<div class="bloc-challenge gain">
        <div class="lib">Objectif de profit</div>
        <div class="grand ${o.profit > 0 ? "positif" : o.profit < 0 ? "negatif" : ""}">${argent(o.profit, d, true)}${o.atteint ? " · ✓ atteint" : ""}</div>
        <div class="barre-objectif"><div class="remplissage-objectif" style="width:${o.pourcentage}%"></div></div>
        <div class="pied"><span>Objectif ${argent(o.montant, d)}</span><span>Reste ${argent(o.restant, d)}</span></div>
        <div class="pied"><span>Solde à atteindre</span><strong>${argent(o.niveau, d)}</strong></div>
      </div>` : ""}
    </div>`;
  }

  function afficher() {
    const zone = $("challenge-performance");
    if (!zone) return;
    const filtre = J().filtreActuel();
    // Un compte choisi → sa carte ; « Tous les comptes » → une carte par compte.
    const visibles = filtre === "tous" ? comptes : comptes.filter((c) => c.cle === filtre);
    zone.innerHTML = visibles.map(carte).join("");
  }

  async function rafraichir() {
    const zone = $("challenge-performance");
    if (!zone) return;
    await chargerRegles();
    afficher();
    comptes = await J().comptesReliesAJour();
    await memoriserPlusHauts();
    afficher();
  }

  // Pour le calculateur : marge avant rupture de chaque compte réglé (solde relu au plus toutes les 60 s).
  let cacheMarges = { t: 0, liste: null };
  async function margesComptes() {
    if (cacheMarges.liste && Date.now() - cacheMarges.t < 60000) return cacheMarges.liste;
    await chargerRegles();
    if (!Object.values(regles).some((r) => Number(r?.perteMax) > 0)) return [];
    comptes = await J().comptesReliesAJour();
    const liste = comptes
      .map((c) => ({ cle: c.cle, nom: J().surnomDe(c.cle) || c.nom, devise: c.devise || "USD", etat: N.etatChallenge(regles[c.cle], c.solde) }))
      .filter((x) => x.etat?.perte);
    cacheMarges = { t: Date.now(), liste };
    return liste;
  }
  // « Actualiser les trades » : soldes relus tout de suite (cache vidé) et cartes redessinées si visibles.
  function toutRelire() {
    cacheMarges = { t: 0, liste: null };
    if (!$("journal-performance")?.classList.contains("hidden") && !enReglage) rafraichir();
  }
  window.GoldAI.challenge = { margesComptes, toutRelire };

  document.addEventListener("DOMContentLoaded", () => {
    $("bouton-ouvrir-performance")?.addEventListener("click", () => { enReglage = null; rafraichir(); });
    const zone = $("challenge-performance");
    zone?.addEventListener("click", (e) => {
      const t = e.target;
      if (t.dataset.regler) { enReglage = t.dataset.regler; afficher(); }
      else if (t.hasAttribute("data-annuler-regles")) { enReglage = null; afficher(); }
    });
    zone?.addEventListener("submit", async (e) => {
      const form = e.target.closest("[data-regles-form]");
      if (!form) return;
      e.preventDefault();
      const cle = form.dataset.reglesForm;
      const val = (n) => { const v = Number(form.elements[n].value); return v > 0 ? v : null; };
      const compte = comptes.find((c) => c.cle === cle);
      regles[cle] = {
        depart: val("depart"), perteMax: val("perteMax"), objectif: val("objectif"),
        perteJour: val("perteJour"),
        suiveuse: form.elements.suiveuse.checked,
        plusHaut: Math.max(val("depart") || 0, Number(compte?.solde) || 0),
      };
      enReglage = null;
      await sauverRegles();
      afficher();
    });
  });
  window.addEventListener("goldai:filtre-compte", () => { if (!$("journal-performance")?.classList.contains("hidden")) afficher(); });
  window.addEventListener("goldai:trades", () => { if (!$("journal-performance")?.classList.contains("hidden") && !enReglage) afficher(); });
})();
