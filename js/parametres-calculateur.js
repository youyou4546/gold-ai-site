// Gold AI — Profil › Général › "Paramètres du calculateur".
//
// Configurés une fois, réutilisés à chaque calcul : solde et devise du compte,
// risque (% du solde ou montant fixe), répartition entre les TP (total 100 %),
// et spécifications PAR INSTRUMENT (elles varient d'un courtier à l'autre :
// rien n'est supposé, les champs sont vides tant que tu ne les remplis pas).
//
// Stockage : Supabase (fonctions obtenir/sauvegarder_parametres_calculateur).
// Tant que le patch SQL n'est pas installé : sauvegarde sur cet appareil
// seulement, et c'est affiché clairement.
(() => {
  const { esc, rpc } = window.GoldAI.utils;
  const DEVISES = ["USD", "CAD", "EUR", "GBP", "CHF", "JPY", "AUD", "NZD"];
  const FUSEAUX = ["America/Toronto", "America/New_York", "America/Montreal", "America/Vancouver", "Europe/Paris", "Europe/London", "UTC"];
  const CHAMPS_SPEC = [
    ["tailleContrat", "Taille du contrat (unités par lot)", "ex : 100 (onces)"],
    ["tailleTick", "Taille du tick (mouvement de prix minimal)", "ex : 0.01"],
    ["valeurTick", "Valeur du tick pour 1 lot", "ex : 1"],
    ["lotMin", "Lot minimum", "ex : 0.01"],
    ["lotMax", "Lot maximum par ordre", "ex : 50"],
    ["pasLot", "Pas de lot", "ex : 0.01"],
  ];

  let cache = null;          // réglages chargés
  let stockage = null;       // "supabase" | "appareil"

  function cleLocale() {
    return `goldai_parametres_calculateur_${window.GoldAI.auth.getNom() || "anonyme"}`;
  }

  function reglagesVides(ancien) {
    // Reprend les valeurs déjà saisies dans l'ancien formulaire Paramètres
    // (solde, % de risque, TP1/TP2/Runner) pour ne rien faire ressaisir.
    const rep = ancien ? [ancien.repartition_tp1, ancien.repartition_tp2, ancien.repartition_runner].map(Number).filter((x) => x > 0) : [];
    return {
      version: 1,
      solde: ancien?.solde_compte ? Number(ancien.solde_compte) : null,
      devise: "USD",
      risqueMode: "pourcentage",
      risqueValeur: ancien?.pourcentage_risque ? Number(ancien.pourcentage_risque) : null,
      repartition: rep.length ? rep : [],
      instruments: {},
      fuseau: window.GoldAI.utils.fuseau(),
    };
  }

  async function charger({ forcer = false } = {}) {
    if (cache && !forcer) return cache;
    const { data, error, absente } = await rpc("obtenir_parametres_calculateur", { p_token: window.GoldAI.auth.getToken() });
    if (!error) {
      stockage = "supabase";
      if (data) cache = data;
      else {
        const anciens = await rpc("obtenir_mes_parametres", { p_token: window.GoldAI.auth.getToken() });
        cache = reglagesVides(anciens.data);
      }
    } else {
      stockage = "appareil";
      let local = null;
      try { local = JSON.parse(localStorage.getItem(cleLocale()) || "null"); } catch { /* ignoré */ }
      if (local) cache = local;
      else {
        const anciens = await rpc("obtenir_mes_parametres", { p_token: window.GoldAI.auth.getToken() });
        cache = reglagesVides(anciens.error ? null : anciens.data);
      }
      if (!absente) console.warn("Paramètres du calculateur : serveur injoignable, copie locale utilisée.");
    }
    if (cache.fuseau) window.GoldAI.utils.definirFuseau(cache.fuseau);
    return cache;
  }

  async function sauvegarder(reglages) {
    const { error, absente } = await rpc("sauvegarder_parametres_calculateur", { p_token: window.GoldAI.auth.getToken(), p_parametres: reglages });
    try { localStorage.setItem(cleLocale(), JSON.stringify(reglages)); } catch { /* ignoré */ }
    cache = reglages;
    window.GoldAI.utils.definirFuseau(reglages.fuseau || window.GoldAI.utils.FUSEAU_DEFAUT);
    window.dispatchEvent(new CustomEvent("goldai:reglages-calculateur"));
    if (error) {
      stockage = "appareil";
      return { ok: true, local: true, message: absente
        ? "Enregistré sur cet appareil seulement : le patch Supabase n'est pas encore installé."
        : "Serveur injoignable : enregistré sur cet appareil seulement pour l'instant." };
    }
    stockage = "supabase";
    return { ok: true, local: false, message: "✓ Paramètres du calculateur enregistrés" };
  }

  // ------------------------------------------------------------------ Formulaire

  function ligneRepartition(pct, i) {
    return `<div class="ligne-repartition">
      <label for="rep-${i}">TP${i + 1}</label>
      <input type="number" id="rep-${i}" class="champ-rep" inputmode="decimal" step="any" min="0" value="${pct ?? ""}" />
      <span class="suffixe">%</span>
      <button type="button" class="bouton-icone" data-suppr-rep="${i}" aria-label="Retirer la portion TP${i + 1}">✕</button>
    </div>`;
  }

  function carteInstrument(sym, spec) {
    return `<div class="carte-instrument" data-instrument="${esc(sym)}">
      <div class="entete-instrument">
        <input type="text" class="champ-symbole" value="${esc(sym)}" aria-label="Symbole" placeholder="ex : XAUUSD" />
        <button type="button" class="bouton-icone" data-suppr-instrument aria-label="Retirer cet instrument">✕</button>
      </div>
      <div class="grille-specs">
        ${CHAMPS_SPEC.map(([cle, lib, ph]) => `
          <div class="champ">
            <label>${lib}</label>
            <input type="number" inputmode="decimal" step="any" min="0" data-spec="${cle}" value="${spec?.[cle] ?? ""}" placeholder="${ph}" />
          </div>`).join("")}
        <div class="champ">
          <label>Devise des gains/pertes</label>
          <select data-spec="deviseProfit">${DEVISES.map((d) => `<option ${spec?.deviseProfit === d ? "selected" : ""}>${d}</option>`).join("")}</select>
        </div>
      </div>
      <p class="aide">Vérifie ces valeurs dans les spécifications de contrat de TON courtier : elles diffèrent d'un courtier à l'autre (ex. XAUUSD à 100 onces ou non, tick de 0.01 ou 0.001).</p>
    </div>`;
  }

  function afficherFormulaire(r) {
    const zone = document.getElementById("zone-parametres-calculateur");
    if (!zone) return;
    zone.innerHTML = `
      ${stockage === "appareil" ? `<div class="alerte-donnees">Sauvegarde en ligne indisponible (patch Supabase non installé) : ces réglages sont gardés sur cet appareil seulement.</div>` : ""}
      <div class="ligne-champs">
        <div class="champ">
          <label for="calc-solde">Solde du compte</label>
          <input type="number" id="calc-solde" inputmode="decimal" step="any" min="0" value="${r.solde ?? ""}" placeholder="ex : 100000" />
        </div>
        <div class="champ">
          <label for="calc-devise">Devise du compte</label>
          <select id="calc-devise">${DEVISES.map((d) => `<option ${r.devise === d ? "selected" : ""}>${d}</option>`).join("")}</select>
        </div>
      </div>

      <label class="label-groupe">Risque par trade</label>
      <div class="segmente" role="radiogroup" aria-label="Type de risque">
        <label><input type="radio" name="calc-risque-mode" value="pourcentage" ${r.risqueMode !== "montant" ? "checked" : ""}/> % du solde</label>
        <label><input type="radio" name="calc-risque-mode" value="montant" ${r.risqueMode === "montant" ? "checked" : ""}/> Montant fixe</label>
      </div>
      <div class="champ">
        <label for="calc-risque">Valeur du risque <span id="unite-risque">${r.risqueMode === "montant" ? `(${esc(r.devise)})` : "(%)"}</span></label>
        <input type="number" id="calc-risque" inputmode="decimal" step="any" min="0" value="${r.risqueValeur ?? ""}" placeholder="${r.risqueMode === "montant" ? "ex : 300" : "ex : 0.3"}" />
      </div>

      <label class="label-groupe">Répartition de la position entre les TP</label>
      <div id="liste-repartition">${(r.repartition.length ? r.repartition : [null]).map(ligneRepartition).join("")}</div>
      <div class="ligne-actions">
        <button type="button" class="bouton secondaire bouton-petit" id="ajouter-rep">+ Ajouter une portion</button>
        <span id="total-repartition" class="total-rep"></span>
      </div>

      <label class="label-groupe">Instruments</label>
      <div id="liste-instruments">${Object.entries(r.instruments || {}).map(([s, spec]) => carteInstrument(s, spec)).join("") || ""}</div>
      <button type="button" class="bouton secondaire bouton-petit" id="ajouter-instrument">+ Ajouter un instrument</button>

      <div class="champ" style="margin-top:16px;">
        <label for="calc-fuseau">Fuseau horaire d'affichage</label>
        <select id="calc-fuseau">${FUSEAUX.map((f) => `<option ${((r.fuseau || window.GoldAI.utils.FUSEAU_DEFAUT) === f) ? "selected" : ""}>${f}</option>`).join("")}</select>
      </div>

      <p class="avertissement-erreur" id="erreur-parametres-calculateur"></p>
      <p class="message-succes" id="message-parametres-calculateur"></p>
      <button class="bouton" id="bouton-sauvegarder-calculateur">Enregistrer les paramètres du calculateur</button>`;
    majTotalRepartition();
  }

  function lireRepartition() {
    return [...document.querySelectorAll("#liste-repartition .champ-rep")].map((c) => c.value.trim() === "" ? null : Number(c.value));
  }

  function majTotalRepartition() {
    const total = lireRepartition().reduce((s, x) => s + (x || 0), 0);
    const zone = document.getElementById("total-repartition");
    if (!zone) return;
    const ok = Math.abs(total - 100) < 1e-6;
    zone.className = `total-rep ${ok ? "ok" : "ko"}`;
    zone.textContent = `Total : ${Math.round(total * 100) / 100} % ${ok ? "✓" : "(doit faire 100 %)"}`;
  }

  function lireFormulaire() {
    const erreurs = [];
    const val = (id) => { const v = document.getElementById(id).value.trim(); return v === "" ? null : Number(v); };
    const r = {
      version: 1,
      solde: val("calc-solde"),
      devise: document.getElementById("calc-devise").value,
      risqueMode: document.querySelector("input[name=calc-risque-mode]:checked").value,
      risqueValeur: val("calc-risque"),
      repartition: lireRepartition().filter((x) => x !== null),
      instruments: {},
      fuseau: document.getElementById("calc-fuseau").value,
    };
    if (r.risqueMode === "pourcentage" && !(r.solde > 0)) erreurs.push("Indique le solde du compte (nécessaire pour un risque en %).");
    if (!(r.risqueValeur > 0)) erreurs.push("Indique la valeur du risque.");
    if (r.risqueMode === "pourcentage" && r.risqueValeur > 10) erreurs.push("Risque supérieur à 10 % du solde : vérifie la valeur saisie.");
    const total = r.repartition.reduce((s, x) => s + x, 0);
    if (!r.repartition.length || r.repartition.some((x) => !(x > 0))) erreurs.push("Chaque portion de la répartition doit être supérieure à 0 %.");
    else if (Math.abs(total - 100) > 1e-6) erreurs.push(`La répartition doit totaliser 100 % (actuellement ${Math.round(total * 100) / 100} %).`);

    document.querySelectorAll("#liste-instruments .carte-instrument").forEach((carte) => {
      const sym = carte.querySelector(".champ-symbole").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!sym) { erreurs.push("Un instrument n'a pas de symbole."); return; }
      if (r.instruments[sym]) { erreurs.push(`${sym} est configuré deux fois.`); return; }
      const spec = {};
      carte.querySelectorAll("[data-spec]").forEach((c) => {
        spec[c.dataset.spec] = c.dataset.spec === "deviseProfit" ? c.value : (c.value.trim() === "" ? null : Number(c.value));
      });
      ["tailleTick", "valeurTick", "lotMin", "lotMax", "pasLot"].forEach((k) => {
        if (!(spec[k] > 0)) erreurs.push(`${sym} : « ${window.GoldAI.noyau.LIBELLES_SPEC[k]} » doit être rempli (> 0).`);
      });
      if (spec.lotMin > 0 && spec.lotMax > 0 && spec.lotMin > spec.lotMax) erreurs.push(`${sym} : le lot minimum dépasse le lot maximum.`);
      if (spec.lotMin > 0 && spec.pasLot > 0 && Math.abs(Math.round(spec.lotMin / spec.pasLot) - spec.lotMin / spec.pasLot) > 1e-6) erreurs.push(`${sym} : le lot minimum doit être un multiple du pas de lot.`);
      r.instruments[sym] = spec;
    });
    return { r, erreurs };
  }

  async function ouvrir() {
    const zone = document.getElementById("zone-parametres-calculateur");
    zone.innerHTML = `<p class="etat-vide">Chargement…</p>`;
    afficherFormulaire(await charger({ forcer: true }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const zone = document.getElementById("zone-parametres-calculateur");
    if (!zone) return;

    zone.addEventListener("input", (e) => { if (e.target.classList.contains("champ-rep")) majTotalRepartition(); });
    zone.addEventListener("change", (e) => {
      if (e.target.name === "calc-risque-mode") {
        const montant = e.target.value === "montant";
        document.getElementById("unite-risque").textContent = montant ? `(${document.getElementById("calc-devise").value})` : "(%)";
        document.getElementById("calc-risque").placeholder = montant ? "ex : 300" : "ex : 0.3";
      }
    });
    zone.addEventListener("click", async (e) => {
      const t = e.target;
      if (t.id === "ajouter-rep") {
        const liste = document.getElementById("liste-repartition");
        const n = liste.querySelectorAll(".ligne-repartition").length;
        if (n >= 8) return;
        liste.insertAdjacentHTML("beforeend", ligneRepartition(null, n));
        majTotalRepartition();
      } else if (t.dataset.supprRep !== undefined) {
        const valeurs = lireRepartition();
        valeurs.splice(Number(t.dataset.supprRep), 1);
        document.getElementById("liste-repartition").innerHTML = (valeurs.length ? valeurs : [null]).map(ligneRepartition).join("");
        majTotalRepartition();
      } else if (t.id === "ajouter-instrument") {
        document.getElementById("liste-instruments").insertAdjacentHTML("beforeend", carteInstrument(document.querySelector("#liste-instruments .carte-instrument") ? "" : "XAUUSD", null));
      } else if (t.hasAttribute("data-suppr-instrument")) {
        t.closest(".carte-instrument").remove();
      } else if (t.id === "bouton-sauvegarder-calculateur") {
        const zoneErreur = document.getElementById("erreur-parametres-calculateur");
        const zoneMsg = document.getElementById("message-parametres-calculateur");
        zoneErreur.classList.remove("visible");
        const { r, erreurs } = lireFormulaire();
        if (erreurs.length) {
          zoneErreur.innerHTML = erreurs.map(esc).join("<br>");
          zoneErreur.classList.add("visible");
          return;
        }
        t.disabled = true;
        const res = await sauvegarder(r);
        t.disabled = false;
        zoneMsg.textContent = res.message;
        zoneMsg.classList.add("succes-visible");
        setTimeout(() => zoneMsg.classList.remove("succes-visible"), 4000);
      }
    });
  });

  function viderCache() { cache = null; stockage = null; }

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.reglagesCalculateur = { charger, sauvegarder, ouvrir, viderCache, stockage: () => stockage };
})();
