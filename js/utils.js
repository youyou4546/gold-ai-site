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

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.utils = { esc, fuseau, definirFuseau, formaterDate, heure, jourHeure, jourLong, cleJour, depuis, compteARebours, montant, nombre, rpc, FUSEAU_DEFAUT };
})();
