// Gold AI — données publiées par le PC (marché, calendrier, actualités).
//
// Source principale : Supabase (fonction lire_donnees), alimentée toutes les
// 15 min par site/sync_site.py. Repli : les fichiers data/*.json du site
// (peuvent être anciens — c'est signalé à l'écran, jamais caché).
(() => {
  const NOMS = ["marche", "calendrier", "actualites"];
  const ACTUALISATION_MS = 2 * 60 * 1000;

  let etat = { charge: false, origine: null, recupereLe: null, jeux: {}, erreur: null };
  let enCours = null;
  let minuterie = null;

  async function lireFichiers() {
    const jeux = {};
    const fichiers = { marche: "data/marche.json", calendrier: "data/calendrier_semaine.json", actualites: "data/actualites.json" };
    await Promise.all(Object.entries(fichiers).map(async ([nom, url]) => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok) {
          const contenu = await r.json();
          jeux[nom] = { contenu, publieLe: contenu.genere_le || null, origine: "fichier du site" };
        }
      } catch { /* fichier absent : signalé comme source indisponible */ }
    }));
    return jeux;
  }

  async function charger({ forcer = false } = {}) {
    if (enCours) return enCours;
    if (!forcer && etat.charge && Date.now() - etat.recupereLe < 30000) return etat;

    enCours = (async () => {
      const { data, error, absente } = await window.GoldAI.utils.rpc("lire_donnees", { p_token: window.GoldAI.auth.getToken() });
      let jeux = {};
      let origine;
      if (!error && Array.isArray(data)) {
        data.forEach((ligne) => { jeux[ligne.nom] = { contenu: ligne.contenu, publieLe: ligne.publie_le, origine: "publication en ligne" }; });
        origine = "Supabase";
      }
      // Compléter ce qui manque avec les fichiers du site.
      const manquants = NOMS.filter((n) => !jeux[n]);
      if (manquants.length) {
        const fichiers = await lireFichiers();
        manquants.forEach((n) => { if (fichiers[n]) jeux[n] = fichiers[n]; });
        origine = origine ? "mixte" : "fichiers du site";
      }
      etat = {
        charge: true, origine, recupereLe: Date.now(), jeux,
        erreur: error ? (absente ? "publication en ligne pas encore installée (patch Supabase)" : "publication en ligne injoignable") : null,
      };
      window.dispatchEvent(new CustomEvent("goldai:donnees", { detail: etat }));
      return etat;
    })();
    try { return await enCours; } finally { enCours = null; }
  }

  function obtenir(nom) {
    return etat.jeux[nom] || null;
  }

  function demarrer() {
    if (minuterie) return;
    charger({ forcer: true });
    minuterie = setInterval(() => { if (document.visibilityState === "visible") charger({ forcer: true }); }, ACTUALISATION_MS);
  }

  // Un seul écouteur pour toute la vie de la page (pas de doublon à chaque connexion).
  document.addEventListener("visibilitychange", () => {
    if (minuterie && document.visibilityState === "visible") charger();
  });

  function arreter() {
    clearInterval(minuterie);
    minuterie = null;
    etat = { charge: false, origine: null, recupereLe: null, jeux: {}, erreur: null };
  }

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.donnees = { charger, obtenir, demarrer, arreter, etat: () => etat };
})();
