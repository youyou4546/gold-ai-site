// Gold AI — petits outils communs : échappement HTML, dates dans le fuseau de
// l'utilisateur, montants avec devise, appels Supabase tolérants.
(() => {
  const FUSEAU_DEFAUT = "America/Toronto";
  const CLE_FUSEAU = "goldai_fuseau";

  function esc(texte) {
    return String(texte ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function fuseau() {
    try { return localStorage.getItem(CLE_FUSEAU) || FUSEAU_DEFAUT; } catch { return FUSEAU_DEFAUT; }
  }

  function definirFuseau(tz) {
    try { localStorage.setItem(CLE_FUSEAU, tz); } catch { /* stockage indisponible */ }
  }

  // Les dates sont toujours stockées en UTC (ISO) et converties ici, ce qui
  // gère automatiquement les changements d'heure (Intl connaît les règles).
  function formaterDate(iso, options) {
    if (!iso) return "—";
    const d = typeof iso === "number" ? new Date(iso) : new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("fr-CA", { timeZone: fuseau(), ...options }).format(d);
  }

  const heure = (iso) => formaterDate(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
  const jourHeure = (iso) => formaterDate(iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const jourLong = (iso) => formaterDate(iso, { weekday: "long", day: "numeric", month: "long" });

  // Clé "AAAA-MM-JJ" du jour dans le fuseau de l'utilisateur.
  function cleJour(iso) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: fuseau(), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}`;
  }

  function depuis(iso, maintenant = Date.now()) {
    if (!iso) return "";
    const s = Math.round((maintenant - (typeof iso === "number" ? iso : Date.parse(iso))) / 1000);
    if (s < 0) return "dans le futur";
    if (s < 60) return `il y a ${s} s`;
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
    return `il y a ${Math.floor(s / 86400)} j`;
  }

  function compteARebours(iso, maintenant = Date.now()) {
    const s = Math.round((Date.parse(iso) - maintenant) / 1000);
    if (s <= 0) return null;
    const j = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (j > 0) return `dans ${j} j ${h} h`;
    if (h > 0) return `dans ${h} h ${String(m).padStart(2, "0")}`;
    if (m > 0) return `dans ${m} min`;
    return `dans ${s} s`;
  }

  function montant(valeur, devise = "USD", { signe = false, decimales = 2 } = {}) {
    if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) return "—";
    const txt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: devise, minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(Math.abs(valeur));
    if (!signe) return valeur < 0 ? `−${txt}` : txt;
    return valeur > 0 ? `+${txt}` : valeur < 0 ? `−${txt}` : txt;
  }

  function nombre(valeur, decimales = 2) {
    if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) return "—";
    return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(valeur);
  }

  // Appel d'une fonction Supabase. `absente` = la fonction n'existe pas encore
  // côté serveur (patch SQL pas encore exécuté) — permet un repli propre.
  async function rpc(nom, params) {
    const client = window.GoldAI.auth.client;
    const { data, error } = await client.rpc(nom, params);
    const message = error?.message || "";
    const absente = !!error && (error.code === "PGRST202" || /could not find the function|schema cache/i.test(message));
    if (message === "SESSION_INVALIDE") window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi.");
    return { data, error, absente };
  }

  // Petite courbe façon TopOne (cartes « Mes comptes », Analyse, Performance) :
  // valeurs successives, verte si on finit plus haut qu'au départ, rouge sinon.
  let numeroCourbe = 0;
  function courbe(valeurs) {
    const v = (valeurs || []).filter(Number.isFinite);
    if (v.length < 2) v.unshift(v[0] ?? 0);
    const min = Math.min(...v), max = Math.max(...v), h = max - min || 1;
    const L = 300, H = 64;
    const pts = v.map((y, i) => [(i / (v.length - 1)) * L, 4 + (1 - (y - min) / h) * (H - 8)]);
    const ligne = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const hausse = v[v.length - 1] >= v[0];
    const id = `degrade-courbe-${++numeroCourbe}`;
    return `<svg class="courbe-compte ${hausse ? "hausse" : "baisse"}" viewBox="0 0 ${L} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0.28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      <polygon points="0,${H} ${ligne} ${L},${H}" fill="url(#${id})"/>
      <polyline points="${ligne}" fill="none" stroke="currentColor" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    </svg>`;
  }

  // Carte repliable façon « Mes comptes » : tête (titre, résumé, flèche) à
  // toucher pour ouvrir / fermer le contenu. `ouvertes` (Set de clés) garde
  // l'état quand la page est redessinée ; voir basculerSections().
  function carteSection({ cle, titre, resume = "", contenu, ouvertes }) {
    const ouvert = ouvertes.has(cle);
    return `<section class="carte-section${ouvert ? " ouverte" : ""}" data-section="${esc(cle)}">
      <div class="tete-carte-section" role="button" tabindex="0" aria-expanded="${ouvert}">
        <strong>${esc(titre)}</strong>
        <span class="resume-section">${resume}<span class="fleche-compte" aria-hidden="true">›</span></span>
      </div>
      <div class="contenu-section">${contenu}</div>
    </section>`;
  }

  // À appeler une fois par zone : ouvre / ferme les cartes de carteSection().
  function basculerSections(zone, ouvertes) {
    if (!zone) return;
    const basculer = (tete) => {
      const carte = tete.closest(".carte-section");
      const ouvert = carte.classList.toggle("ouverte");
      tete.setAttribute("aria-expanded", String(ouvert));
      if (ouvert) ouvertes.add(carte.dataset.section); else ouvertes.delete(carte.dataset.section);
    };
    zone.addEventListener("click", (e) => {
      const tete = e.target.closest(".tete-carte-section");
      if (tete) basculer(tete);
    });
    zone.addEventListener("keydown", (e) => {
      const tete = e.target.closest(".tete-carte-section");
      if (!tete || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      basculer(tete);
    });
  }

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.utils = { esc, fuseau, definirFuseau, formaterDate, heure, jourHeure, jourLong, cleJour, depuis, compteARebours, montant, nombre, rpc, courbe, carteSection, basculerSections, FUSEAU_DEFAUT };
})();
