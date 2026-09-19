// Service worker Gold AI — permet l'installation en PWA et l'utilisation
// hors-ligne (calculateur et journal fonctionnent sans internet ; le
// calendrier économique a besoin du fichier data téléchargé au moins une fois).
//
// Change ce numéro de version à chaque mise à jour des fichiers pour forcer
// le téléchargement de la nouvelle version chez l'utilisateur.
const VERSION = "goldai-v4";

const FICHIERS_A_METTRE_EN_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/auth.js",
  "./js/app.js",
  "./js/calculateur.js",
  "./js/calendrier-eco.js",
  "./js/analyse-graphique.js",
  "./js/journal.js",
  "./data/glossaire_annonces.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION).then((cache) =>
      // { cache: "reload" } force à aller chercher les fichiers sur le serveur plutôt
      // que dans le cache HTTP du navigateur (GitHub Pages garde les fichiers "frais"
      // 10 minutes côté navigateur — sans ça, une mise à jour pourrait remettre en
      // cache une version pas si nouvelle que ça).
      Promise.all(
        FICHIERS_A_METTRE_EN_CACHE.map((fichier) =>
          fetch(fichier, { cache: "reload" }).then((reponse) => cache.put(fichier, reponse))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches.keys().then((noms) =>
      Promise.all(noms.filter((nom) => nom !== VERSION).map((nom) => caches.delete(nom)))
    )
  );
  self.clients.claim();
});

// Stratégie : réseau d'abord pour le fichier de calendrier du jour (données
// fraîches), cache d'abord pour le reste (app shell = rapide + hors-ligne).
self.addEventListener("fetch", (evenement) => {
  const url = new URL(evenement.request.url);

  if (url.pathname.endsWith("calendrier_du_jour.json")) {
    evenement.respondWith(
      fetch(evenement.request)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(evenement.request, copie));
          return reponse;
        })
        .catch(() => caches.match(evenement.request))
    );
    return;
  }

  evenement.respondWith(
    caches.match(evenement.request).then((reponseEnCache) => reponseEnCache || fetch(evenement.request))
  );
});
