// Gold AI — Journal › fiche détaillée d'un trade (ajout ou modification).
//
// Champs : (instrument = XAUUSD automatiquement, RR retiré) prix d'entrée / sortie,
// RR obtenu, profit/perte, frais, captures d'écran, notes.
// Enregistré dans Supabase (supabase/patch_journal_detaille.sql). Les images
// sont réduites sur le téléphone avant l'envoi (1600 px max, JPEG) pour rester
// légères, puis stockées à part et chargées seulement à l'ouverture du trade.
// Tous les changements (y compris ajout/suppression d'images) ne sont appliqués
// qu'au clic sur « Enregistrer le trade ».
(() => {
  const TAILLE_MAX_PX = 1600;
  const MAX_IMAGES = 10;

  let tradeOuvert = null;     // trade en cours de modification, ou null pour un nouveau
  let dateFiche = null;       // "AAAA-MM-JJ"
  let imagesExistantes = [];  // [{ id, image_data }] déjà en base
  let imagesASupprimer = new Set();
  let imagesNouvelles = [];   // data URLs pas encore envoyées

  const client = () => window.GoldAI.auth.client;
  const token = () => window.GoldAI.auth.getToken();
  const $ = (id) => document.getElementById(id);
  const fonctionAbsente = (error) => error && (error.code === "PGRST202" || /could not find the function/i.test(error.message || ""));

  function afficherErreur(message) {
    const zone = $("fiche-erreur");
    zone.textContent = message || "";
    zone.classList.toggle("visible", Boolean(message));
  }

  // Réduit une image (capture d'écran) : 1600 px max de côté, JPEG qualité 0,82.
  function compresser(fichier) {
    return new Promise((resoudre, rejeter) => {
      const url = URL.createObjectURL(fichier);
      const img = new Image();
      img.onload = () => {
        const echelle = Math.min(1, TAILLE_MAX_PX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * echelle);
        canvas.height = Math.round(img.height * echelle);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        let qualite = 0.82;
        let donnees = canvas.toDataURL("image/jpeg", qualite);
        while (donnees.length > 2500000 && qualite > 0.4) {
          qualite -= 0.15;
          donnees = canvas.toDataURL("image/jpeg", qualite);
        }
        resoudre(donnees);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rejeter(new Error("image illisible")); };
      img.src = url;
    });
  }

  function afficherGalerie() {
    const galerie = $("fiche-galerie");
    const vignette = (src, attributs) => `
      <div class="vignette-trade">
        <img src="${src}" alt="Capture du trade" data-agrandir />
        <button type="button" class="retirer-image" ${attributs} aria-label="Retirer cette image">✕</button>
      </div>`;
    const existantes = imagesExistantes.filter((i) => !imagesASupprimer.has(i.id));
    galerie.innerHTML = existantes.map((i) => vignette(i.image_data, `data-existante="${i.id}"`)).join("")
      + imagesNouvelles.map((d, n) => vignette(d, `data-nouvelle="${n}"`)).join("");
    $("fiche-bouton-images").textContent = existantes.length + imagesNouvelles.length
      ? "Ajouter d'autres images" : "Ajouter une ou plusieurs images";
  }

  let apresEnregistrement = null; // action à faire une fois le trade enregistré (ex. arrêter le suivi)
  let comptesFiche = [];          // [{ cle, nom, nomOrigine }] : comptes TradeLocker reliés

  // Menu « Compte » : le trade est enregistré DANS un compte existant de
  // Profil › Mes comptes TradeLocker (pas dans une section « à part »).
  // Nouveau trade : le compte affiché dans le calendrier, sinon le compte maître.
  async function remplirComptes(trade, prerempli) {
    const menu = $("fiche-compte");
    const { esc } = window.GoldAI.utils;
    menu.innerHTML = `<option value="">Chargement des comptes…</option>`;
    menu.disabled = true;
    const [liste, reglages] = await Promise.all([
      window.GoldAI.journal.comptesPourFiche().catch(() => []),
      window.GoldAI.reglagesCalculateur.charger().catch(() => ({})),
    ]);
    if (tradeOuvert !== (trade || null)) return; // fiche changée entre-temps
    comptesFiche = [...liste];
    if (trade?.compteTl && !comptesFiche.some((c) => c.cle === trade.compteTl)) {
      comptesFiche.push({ cle: trade.compteTl, nom: trade.compteTlNom || trade.compteTl, nomOrigine: trade.compteTlNom });
    }
    let choix = "";
    if (trade) choix = trade.compteTl || "";
    else {
      const filtre = window.GoldAI.journal.filtreActuel();
      const candidats = [prerempli?.compteTl, filtre !== "tous" && filtre !== "manuel" ? filtre : null, reglages.compteMaitre, comptesFiche[0]?.cle];
      choix = candidats.find((c) => c && comptesFiche.some((x) => x.cle === c)) || "";
    }
    menu.innerHTML = comptesFiche.map((c) => `<option value="${esc(c.cle)}">${esc(c.nom)}</option>`).join("")
      + `<option value="">Aucun compte (trade à part)</option>`;
    menu.value = choix;
    menu.disabled = false;
  }

  // `prerempli` (nouveau trade seulement) : { prixEntree, prixSortie, resultat, note }
  // venant du calculateur ou du trade en cours.
  async function ouvrir(trade, date, prerempli = null, apres = null) {
    tradeOuvert = trade || null;
    apresEnregistrement = apres;
    dateFiche = trade ? trade.date : date;
    imagesExistantes = [];
    imagesASupprimer = new Set();
    imagesNouvelles = [];
    afficherErreur("");

    const [a, m, j] = dateFiche.split("-").map(Number);
    $("fiche-titre").textContent = trade ? "Fiche du trade" : "Nouveau trade";
    $("fiche-date").textContent = new Date(a, m - 1, j).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    const val = (x) => (x === null || x === undefined ? "" : String(x));
    const source = trade || prerempli || {};
    $("fiche-entree").value = val(source.prixEntree);
    $("fiche-sortie").value = val(source.prixSortie);
    $("fiche-resultat").value = val(source.resultat);
    $("fiche-frais").value = val(trade?.frais);
    $("fiche-notes").value = source.note || "";

    afficherGalerie();
    remplirComptes(trade, prerempli); // sans attendre : la fiche s'ouvre tout de suite
    $("modale-fiche-trade").classList.add("visible");
    $("modale-fiche-trade").querySelector(".modale").scrollTop = 0;

    if (trade?.nbImages) {
      $("fiche-galerie").innerHTML = `<p class="etat-vide petit">Chargement des images…</p>`;
      const { data, error } = await client().rpc("lister_images_trade", { p_token: token(), p_trade_id: trade.id });
      if (tradeOuvert !== trade) return; // fiche refermée / changée entre-temps
      if (error) afficherErreur("Images impossibles à charger pour l'instant.");
      imagesExistantes = data || [];
      afficherGalerie();
    }
  }

  function fermer() {
    $("modale-fiche-trade").classList.remove("visible");
    tradeOuvert = null;
    apresEnregistrement = null;
  }

  function nombreOuNull(id) {
    const brut = $(id).value.trim();
    if (brut === "") return null;
    const n = Number(brut.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }

  async function enregistrer() {
    afficherErreur("");
    const resultat = nombreOuNull("fiche-resultat");
    if (resultat === null || Number.isNaN(resultat)) { afficherErreur("Indique le profit ou la perte en $ (négatif si perte)."); return; }
    const champs = { entree: nombreOuNull("fiche-entree"), sortie: nombreOuNull("fiche-sortie"), frais: nombreOuNull("fiche-frais") };
    if (Object.values(champs).some(Number.isNaN)) { afficherErreur("Un des champs chiffrés contient autre chose qu'un nombre."); return; }
    const frais = champs.frais === null ? null : Math.abs(champs.frais);
    if ($("fiche-compte").disabled) { afficherErreur("Attends la fin du chargement des comptes."); return; }
    const compte = comptesFiche.find((c) => c.cle === $("fiche-compte").value) || null;

    const trade = {
      ...(tradeOuvert || {}), // garde l'heure d'ouverture / le sens d'un trade importé
      compteTl: compte?.cle || null,
      compteTlNom: compte?.nomOrigine || compte?.nom || null,
      id: tradeOuvert?.id || null,
      date: dateFiche,
      resultat,
      note: $("fiche-notes").value.trim(),
      compteTradingId: tradeOuvert?.compteTradingId || null, // plus demandé : on garde celui déjà enregistré
      instrument: tradeOuvert?.instrument || "XAUUSD", // on ne trade que l'or : plus demandé
      frais,
      prixEntree: champs.entree,
      prixSortie: champs.sortie,
      rr: tradeOuvert?.rr ?? null, // RR plus demandé : on garde celui d'un ancien trade
    };

    const bouton = $("fiche-enregistrer");
    bouton.disabled = true;
    bouton.textContent = "Enregistrement…";
    try {
      let { data: id, error } = await client().rpc("enregistrer_mon_trade", {
        p_token: token(), p_trade_id: trade.id, p_date: trade.date, p_resultat: trade.resultat, p_note: trade.note || null,
        p_compte_trading_id: trade.compteTradingId, p_instrument: trade.instrument, p_frais: trade.frais,
        p_prix_entree: trade.prixEntree, p_prix_sortie: trade.prixSortie, p_rr: trade.rr,
        p_compte_tl: trade.compteTl || "", p_compte_tl_nom: trade.compteTlNom, // "" = aucun compte
      });

      let patchAbsent = false;
      if (fonctionAbsente(error)) {
        // Patch SQL pas encore installé : seul un NOUVEAU trade peut être
        // enregistré, et sans prix / RR / images.
        patchAbsent = true;
        if (trade.id) { afficherErreur("Modification impossible : installe d'abord supabase/patch_journal_detaille.sql dans Supabase."); return; }
        ({ data: id, error } = await client().rpc("ajouter_mon_trade", {
          p_token: token(), p_date: trade.date, p_resultat: trade.resultat, p_note: trade.note || null,
          p_compte_trading_id: trade.compteTradingId, p_instrument: trade.instrument, p_frais: trade.frais,
        }));
        trade.prixEntree = trade.prixSortie = trade.rr = null;
      }
      if (error) {
        if (error.message === "SESSION_INVALIDE") { fermer(); window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi."); return; }
        afficherErreur("Le serveur n'a pas enregistré le trade. Vérifie ta connexion et réessaie.");
        return;
      }
      trade.id = id;

      // Images : suppressions puis ajouts (une par une pour rester sous la taille max d'une requête).
      let echecsImages = 0;
      if (!patchAbsent) {
        for (const idImage of imagesASupprimer) {
          const r = await client().rpc("supprimer_image_trade", { p_token: token(), p_image_id: idImage });
          if (r.error) echecsImages++;
        }
        for (const donnees of imagesNouvelles) {
          const r = await client().rpc("ajouter_image_trade", { p_token: token(), p_trade_id: id, p_image_data: donnees });
          if (r.error) echecsImages++;
        }
      }
      trade.nbImages = patchAbsent ? 0
        : imagesExistantes.filter((i) => !imagesASupprimer.has(i.id)).length + imagesNouvelles.length - echecsImages;

      await window.GoldAI.journal.memoriserTrade(trade);
      if (apresEnregistrement) { try { await apresEnregistrement(trade); } catch { /* sans effet sur l'enregistrement */ } }
      if (patchAbsent) {
        alert("Trade enregistré, mais sans prix, RR ni images : le patch Supabase (patch_journal_detaille.sql) n'est pas encore installé.");
      } else if (echecsImages) {
        alert(`Trade enregistré, mais ${echecsImages} image(s) n'ont pas pu être envoyées. Rouvre le trade pour réessayer.`);
      }
      fermer();
    } finally {
      bouton.disabled = false;
      bouton.textContent = "Enregistrer le trade";
    }
  }

  async function ajouterFichiers(fichiers) {
    const place = MAX_IMAGES - (imagesExistantes.filter((i) => !imagesASupprimer.has(i.id)).length + imagesNouvelles.length);
    const liste = [...fichiers].filter((f) => f.type.startsWith("image/"));
    if (liste.length > place) afficherErreur(`${MAX_IMAGES} images maximum par trade : ${liste.length - Math.max(place, 0)} ignorée(s).`);
    for (const f of liste.slice(0, Math.max(place, 0))) {
      try { imagesNouvelles.push(await compresser(f)); } catch { afficherErreur(`Image illisible : ${f.name}`); }
      afficherGalerie();
    }
  }

  function agrandir(src) {
    const fond = document.createElement("div");
    fond.className = "visionneuse-image";
    fond.innerHTML = `<img src="${src}" alt="Capture du trade en grand" />`;
    fond.addEventListener("click", () => fond.remove());
    document.body.appendChild(fond);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("fiche-bouton-images").addEventListener("click", () => $("fiche-fichiers").click());
    $("fiche-fichiers").addEventListener("change", async (e) => {
      await ajouterFichiers(e.target.files);
      e.target.value = ""; // permet de rechoisir la même image
    });
    $("fiche-galerie").addEventListener("click", (e) => {
      const b = e.target.closest(".retirer-image");
      if (b?.dataset.existante) imagesASupprimer.add(b.dataset.existante);
      else if (b?.dataset.nouvelle !== undefined) imagesNouvelles.splice(Number(b.dataset.nouvelle), 1);
      else if (e.target.dataset.agrandir !== undefined) return agrandir(e.target.src);
      else return;
      afficherGalerie();
    });
    $("fiche-enregistrer").addEventListener("click", enregistrer);
    $("fiche-fermer").addEventListener("click", fermer);
    // Pas de fermeture en touchant à côté : on perdrait des notes non enregistrées.
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.ficheTrade = { ouvrir, fermer };
})();
