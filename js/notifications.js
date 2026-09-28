// Gold AI — Notifications sur le téléphone avant les annonces (Web Push).
//
// Ce fichier gère seulement l'ABONNEMENT : demander la permission, créer
// l'abonnement du navigateur et l'enregistrer dans Supabase
// (supabase/patch_notifications.sql). L'ENVOI est fait par le PC
// (site/notifier_annonces.py, toutes les 5 min), et l'affichage par le
// service worker (service-worker.js, événement "push").
//
// Sur iPhone : les notifications ne marchent que si l'app a été ajoutée à
// l'écran d'accueil (Partager › Sur l'écran d'accueil) et ouverte depuis
// l'icône (iOS 16.4 ou plus récent).
(() => {
  // Clé PUBLIQUE (la clé privée reste sur le PC : config/vapid_prive.pem).
  const CLE_PUBLIQUE_VAPID = "BO3B5VcilMB6mDYfDEerKNrX9f2KOj5IkDCKXf4s_x9CaU2M13xdw4-au9D8mGYGxkQRuv_Hxbjcq3JODCXt0ak";

  const $ = (id) => document.getElementById(id);
  const client = () => window.GoldAI.auth.client;
  const token = () => window.GoldAI.auth.getToken();

  const estIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const estInstallee = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  const compatible = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  function versOctets(base64url) {
    const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  async function abonnementActuel() {
    if (!compatible()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  // État lisible : "actif" | "inactif" | "refuse" | "installer" | "incompatible"
  async function etat() {
    if (!compatible()) return estIos() && !estInstallee() ? "installer" : "incompatible";
    if (Notification.permission === "denied") return "refuse";
    return (await abonnementActuel()) && Notification.permission === "granted" ? "actif" : "inactif";
  }

  async function activer() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, message: "Tu as refusé les notifications. Pour les réactiver : réglages du téléphone › Notifications › Trading Tool." };
    const reg = await navigator.serviceWorker.ready;
    let ab = await reg.pushManager.getSubscription();
    if (!ab) ab = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(CLE_PUBLIQUE_VAPID) });
    const json = ab.toJSON();
    const { error } = await client().rpc("enregistrer_abonnement_push", {
      p_token: token(), p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
    });
    if (error) {
      if (error.message === "SESSION_INVALIDE") window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi.");
      const absent = error.code === "PGRST202" || /could not find the function/i.test(error.message || "");
      return { ok: false, message: absent ? "Il manque la mise à jour Supabase (patch_notifications.sql)." : "Le serveur n'a pas enregistré l'abonnement. Réessaie." };
    }
    return { ok: true };
  }

  async function desactiver() {
    const ab = await abonnementActuel();
    if (ab) {
      await client().rpc("supprimer_mon_abonnement_push", { p_token: token(), p_endpoint: ab.endpoint });
      await ab.unsubscribe();
    }
    return { ok: true };
  }

  const TEXTES = {
    actif: ["Activées sur ce téléphone : tu es prévenu ~15 min avant chaque annonce USD à fort impact.", "Désactiver"],
    inactif: ["Reçois une alerte ~15 min avant chaque annonce USD à fort impact, même app fermée.", "Activer"],
    refuse: ["Bloquées dans les réglages du téléphone (Notifications › Trading Tool).", null],
    installer: ["Sur iPhone : ajoute d'abord l'app à l'écran d'accueil (Partager › Sur l'écran d'accueil), puis ouvre-la depuis l'icône.", null],
    incompatible: ["Ce navigateur ne permet pas les notifications.", null],
  };

  async function rafraichir(message = "") {
    const e = await etat();
    const [texte, bouton] = TEXTES[e];
    const zone = $("etat-notifications");
    if (zone) zone.textContent = message || texte;
    const b = $("bouton-notifications");
    if (b) { b.classList.toggle("hidden", !bouton); b.textContent = bouton || ""; b.classList.toggle("secondaire", e === "actif"); }
    // Proposition discrète dans Annonces, tant que ce n'est pas activé.
    $("proposition-notifications")?.classList.toggle("hidden", !(e === "inactif" || e === "installer"));
  }

  async function basculer() {
    const b = $("bouton-notifications");
    b.disabled = true;
    try {
      const r = (await etat()) === "actif" ? await desactiver() : await activer();
      await rafraichir(r.ok ? "" : r.message);
    } catch (err) {
      await rafraichir(`Activation impossible : ${err.message}`);
    } finally { b.disabled = false; }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("bouton-notifications")?.addEventListener("click", basculer);
    $("proposition-notifications")?.addEventListener("click", () => {
      window.GoldAI.app.allerA("profil");
      $("carte-notifications")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.notifications = { rafraichir, etat };
})();
