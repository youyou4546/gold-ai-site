// Service worker Gold AI — installation en PWA et utilisation hors ligne.
//
// Stratégie :
//  - Fichiers de l'app (HTML/CSS/JS) et données (data/*.json) : RÉSEAU
//    D'ABORD, copie en cache seulement en secours hors ligne. Avant, l'app
//    était servie "cache d'abord" : une ancienne version (et ses anciennes
//    données) pouvait rester affichée tant que ce numéro n'était pas changé.
//  - Requêtes vers d'autres sites (Twelve Data, Supabase) : jamais touchées,
//    pour ne jamais servir une cotation ou une donnée de compte en cache.
//  - Bibliothèques du CDN (Supabase, Chart.js) : cache d'abord (versions figées).
//
// Change ce numéro à chaque mise à jour pour nettoyer les anciens caches.
const VERSION = "goldai-v31";

const FICHIERS_A_METTRE_EN_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/auth.js",
  "./js/utils.js",
  "./js/noyau.js",
  "./js/donnees.js",
  "./js/cotations.js",
  "./js/app.js",
  "./js/marche.js",
  "./js/annonces.js",
  "./js/impact.js",
  "./js/parametres-calculateur.js",
  "./js/calculateur.js",
  "./js/analyse-graphique.js",
  "./js/comptes-trading.js",
  "./js/journal.js",
  "./js/journal-fiche.js",
  "./js/garde-fou.js",
  "./js/notifications.js",
  "./js/accueil-discipline.js",
  "./js/trade-en-cours.js",
  "./js/journal-performance.js",
  "./js/parametres.js",
  "./js/profil-comptes.js",
  "./js/profil-mon-compte.js",
  "./data/glossaire_annonces.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const CDN = ["cdn.jsdelivr.net"];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(
        FICHIERS_A_METTRE_EN_CACHE.map((fichier) =>
          fetch(fichier, { cache: "reload" }).then((reponse) => (reponse.ok ? cache.put(fichier, reponse) : null)).catch(() => null)
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches.keys().then((noms) => Promise.all(noms.filter((nom) => nom !== VERSION).map((nom) => caches.delete(nom))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;
  const url = new URL(requete.url);

  if (CDN.includes(url.hostname)) {
    evenement.respondWith(
      caches.match(requete).then((enCache) => enCache || fetch(requete).then((reponse) => {
        const copie = reponse.clone();
        caches.open(VERSION).then((cache) => cache.put(requete, copie));
        return reponse;
      }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // Twelve Data, Supabase… : réseau direct

  evenement.respondWith(
    fetch(requete, { cache: "no-store" })
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(requete, { ignoreSearch: true }))
  );
});

// ---------------------------------------------------------------- Notifications
// Envoyées par le PC (site/notifier_annonces.py) ~15 min avant une annonce
// USD à fort impact. Affichées même quand l'app est fermée.
self.addEventListener("push", (evenement) => {
  let d = {};
  try { d = evenement.data ? evenement.data.json() : {}; } catch { d = { texte: evenement.data?.text() }; }
  evenement.waitUntil(
    self.registration.showNotification(d.titre || "Trading Tool", {
      body: d.texte || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: d.tag || undefined,
      data: { url: d.url || "./index.html#calendrier" },
      vibrate: [200, 100, 200],
    })
  );
});

// Toucher la notification ouvre l'app sur la page Annonces.
self.addEventListener("notificationclick", (evenement) => {
  evenement.notification.close();
  const url = new URL(evenement.notification.data?.url || "./index.html#calendrier", self.location.href).href;
  evenement.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      const ouverte = fenetres.find((f) => f.url.startsWith(self.registration.scope));
      if (ouverte) {
        ouverte.postMessage({ type: "aller", section: "calendrier" });
        return ouverte.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
