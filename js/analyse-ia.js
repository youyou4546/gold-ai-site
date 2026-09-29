// Gold AI — Analyse › Analyse de graphique par l'IA (Claude Sonnet 5.5, payant).
// L'IA combine la capture ET le contexte de marché (prix corrélés, annonces,
// actualités, tendances multi-unités de temps), rassemblé par le serveur.
//
// La capture est réduite sur le téléphone (1568 px max, JPEG) puis envoyée à la
// fonction Supabase « analyse-graphique » (supabase/functions/analyse-graphique),
// qui vérifie les limites du jour (5 par personne, 10 au total, journée de
// Toronto), appelle l'IA avec la clé gardée côté serveur et renvoie l'analyse
// + son coût. Compteurs et historique : fonction SQL mes_analyses_graphique
// (supabase/patch_analyse_graphique.sql).
(() => {
  const U = window.GoldAI.utils;
  const { esc } = U;
  const $ = (id) => document.getElementById(id);
  const TAILLE_MAX_PX = 1568; // au-delà, l'IA réduit l'image de toute façon (et on paierait plus d'envoi)

  let image = null;       // data URL de la capture choisie
  let etat = null;        // { moi, total, limite_moi, limite_total, historique }
  let enCours = false;

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
        resoudre(canvas.toDataURL("image/jpeg", 0.88));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rejeter(new Error("image illisible")); };
      img.src = url;
    });
  }

  function erreur(message) {
    $("ia-erreur").textContent = message || "";
    $("ia-erreur").classList.toggle("visible", Boolean(message));
  }

  function restantes() {
    if (!etat) return 0;
    return Math.max(0, Math.min(etat.limite_moi - etat.moi, etat.limite_total - etat.total));
  }

  function afficherCompteurs() {
    const zone = $("compteur-ia");
    if (!etat) { zone.textContent = "Compteurs indisponibles pour l'instant."; return; }
    const r = restantes();
    zone.className = `compteur-ia ${r === 0 ? "epuise" : r <= 1 ? "bientot" : ""}`;
    zone.innerHTML = `<strong>${etat.moi} / ${etat.limite_moi}</strong> analyses aujourd'hui`;
    majBouton();
  }

  function majBouton() {
    const bouton = $("ia-analyser");
    const r = restantes();
    bouton.disabled = enCours || !image || r === 0;
    bouton.textContent = enCours ? "Analyse en cours… (jusqu'à 1 min)"
      : r === 0 ? (etat && etat.moi >= etat.limite_moi ? "Tes 5 analyses du jour sont utilisées" : "Les 10 analyses du jour sont utilisées")
      : !image ? "Choisis d'abord une capture" : `Analyser ce graphique (${r} restante${r > 1 ? "s" : ""})`;
  }

  // Rendu d'une analyse (réponse JSON de l'IA) :
  // verdict → marché maintenant → annonces → niveaux clés (échelle de prix) → plan.
  const VERDICT = {
    achat: { mot: "ACHETER", icone: "🟢", classe: "achat" },
    vente: { mot: "VENDRE", icone: "🔴", classe: "vente" },
    attendre: { mot: "ATTENDRE", icone: "⏸️", classe: "attendre" },
  };

  function effet(e) {
    if (/haussier/.test(e || "")) return { signe: "▲", classe: "haut", titre: "favorable à l'or" };
    if (/baissier/.test(e || "")) return { signe: "▼", classe: "bas", titre: "défavorable à l'or" };
    return { signe: "●", classe: "", titre: "neutre" };
  }

  // Niveaux triés du plus haut au plus bas, avec le prix actuel placé au bon endroit.
  function echelle(zones, prixActuel) {
    const liste = (zones || []).filter((z) => z && z.prix);
    if (!liste.length) return "";
    const avecNum = liste.filter((z) => Number(z.prix_num) > 0).sort((a, b) => b.prix_num - a.prix_num);
    const sansNum = liste.filter((z) => !(Number(z.prix_num) > 0));
    const lignes = [];
    let actuelPlace = !(Number(prixActuel) > 0);
    for (const z of avecNum) {
      if (!actuelPlace && z.prix_num < prixActuel) {
        lignes.push(`<li class="niveau-actuel"><span class="prix-niveau">${esc(U.nombre(prixActuel, 2))}</span><span>◀ prix actuel</span></li>`);
        actuelPlace = true;
      }
      const haut = /résistance|offre/.test(z.type), bas = /support|demande/.test(z.type);
      lignes.push(`<li><span class="prix-niveau">${esc(z.prix)}</span><span><span class="type-zone ${haut ? "haut" : bas ? "bas" : ""}">${esc(z.type)}</span> ${esc(z.commentaire)}</span></li>`);
    }
    if (!actuelPlace) lignes.push(`<li class="niveau-actuel"><span class="prix-niveau">${esc(U.nombre(prixActuel, 2))}</span><span>◀ prix actuel</span></li>`);
    for (const z of sansNum) lignes.push(`<li><span class="prix-niveau">${esc(z.prix)}</span><span><span class="type-zone">${esc(z.type)}</span> ${esc(z.commentaire)}</span></li>`);
    return `<h4 class="sous-titre-analyse">Niveaux clés</h4><ul class="echelle-ia">${lignes.join("")}</ul>`;
  }

  function plan(titre, s, classe, principal) {
    if (!s || !(s.conditions || s.entree)) return "";
    return `<div class="scenario-ia ${classe} ${principal ? "principal" : ""}">
      <div class="entete-scenario"><strong>${titre}</strong>${principal ? `<span class="pastille-ia">plan principal</span>` : ""}</div>
      <p>${esc(s.conditions)}</p>
      <div class="chiffres-scenario">
        <span><span class="texte-attenue">Entrée</span><strong>${esc(s.entree)}</strong></span>
        <span><span class="texte-attenue">Stop</span><strong>${esc(s.stop)}</strong></span>
        <span><span class="texte-attenue">Objectifs</span><strong>${esc(s.objectifs)}</strong></span>
      </div></div>`;
  }

  function rendu(a, cout, date) {
    if (!a) return "";
    if (a.lisible === false) {
      return `<div class="resultat-ia"><p class="alerte-donnees">🤔 ${esc(a.resume || "Ce n'est pas un graphique lisible.")}</p></div>`;
    }
    const v = VERDICT[a.biais?.direction];
    const achatPrincipal = a.biais?.direction !== "vente";
    return `<div class="resultat-ia">
      <p class="entete-ia">${[a.instrument, a.unite_de_temps].filter(Boolean).map(esc).join(" · ")}
        ${date ? ` <span class="texte-attenue petit">· ${esc(U.jourHeure(date))}</span>` : ""}</p>

      ${v ? `<div class="verdict-ia ${v.classe}">
        <div class="ligne-verdict"><span class="mot-verdict">${v.icone} ${v.mot}</span>
          <span class="pastille-ia">confiance ${esc(a.biais.confiance)}</span></div>
        <p>${esc(a.resume || "")}</p>
        ${a.biais.raison ? `<p class="texte-attenue petit">${esc(a.biais.raison)}</p>` : ""}
      </div>` : `<p class="resume-ia">${esc(a.resume || "")}</p>`}

      ${(a.contexte || []).length ? `<h4 class="sous-titre-analyse">Le marché maintenant</h4>
      <ul class="contexte-ia">${a.contexte.map((c) => { const f = effet(c.effet); return `
        <li><span class="fleche-ia ${f.classe}" title="${f.titre}">${f.signe}</span>
          <span><strong>${esc(c.facteur)}</strong><br><span class="texte-attenue petit">${esc(c.detail)}</span></span></li>`; }).join("")}</ul>` : ""}

      ${a.tendance ? `<p class="petit"><strong>Tendance ${esc(a.tendance.direction)}</strong> — <span class="texte-attenue">${esc(a.tendance.explication)}</span></p>` : ""}

      ${(a.annonces || []).length ? `<h4 class="sous-titre-analyse">Annonces à surveiller</h4>
      <ul class="annonces-ia">${a.annonces.map((x) => `<li><span class="quand-ia">${esc(x.quand)}</span><span><strong>${esc(x.titre)}</strong><br><span class="texte-attenue petit">${esc(x.conseil)}</span></span></li>`).join("")}</ul>` : ""}

      ${echelle(a.zones, Number(a.prix_actuel))}

      <h4 class="sous-titre-analyse">Plan</h4>
      ${achatPrincipal ? plan("🟢 Achat", a.scenario_achat, "achat", a.biais?.direction === "achat") + plan("🔴 Vente", a.scenario_vente, "vente", false)
        : plan("🔴 Vente", a.scenario_vente, "vente", true) + plan("🟢 Achat", a.scenario_achat, "achat", false)}
      ${a.invalidation ? `<p class="petit"><strong>❌ Invalidation :</strong> ${esc(a.invalidation)}</p>` : ""}
      ${a.prudence ? `<p class="texte-attenue petit">⚠️ ${esc(a.prudence)}</p>` : ""}
    </div>`;
  }

  function afficherHistorique() {
    const liste = etat?.historique || [];
    $("ia-historique").classList.toggle("hidden", !liste.length);
    $("ia-liste-historique").innerHTML = liste.map((h) => `
      <details class="element-historique-ia">
        <summary>${esc(U.jourHeure(h.cree_le))} — ${esc((h.reponse?.resume || "").slice(0, 90))}${(h.reponse?.resume || "").length > 90 ? "…" : ""}</summary>
        ${h.question ? `<p class="texte-attenue petit">Ta question : ${esc(h.question)}</p>` : ""}
        ${rendu(h.reponse, h.cout_usd, null)}
      </details>`).join("");
  }

  async function rafraichir() {
    if (!window.GoldAI.auth?.getToken()) return;
    const { data, error } = await window.GoldAI.auth.client.rpc("mes_analyses_graphique", { p_token: window.GoldAI.auth.getToken() });
    etat = error ? null : data;
    afficherCompteurs();
    afficherHistorique();
  }

  // Tendances de l'or déjà calculées par la page Marché (bougies clôturées, non
  // périmées). Sinon le serveur les calcule lui-même avec les bougies 1 h et 4 h.
  function tendancesDuMarche() {
    try {
      const t = window.GoldAI.cotations?.tendances?.() || {};
      const sortie = {};
      Object.entries(t).forEach(([tf, x]) => {
        if (x && x.etat && x.etat !== "insuffisant" && !x.perimee) {
          sortie[tf] = { etat: x.etat, ema20: x.ema20, atr14: x.atr14, plusHaut10: x.plusHaut10, plusBas10: x.plusBas10 };
        }
      });
      return Object.keys(sortie).length ? sortie : null;
    } catch { return null; }
  }

  async function analyser() {
    if (enCours || !image) return;
    erreur("");
    enCours = true;
    majBouton();
    $("ia-resultat").innerHTML = `<p class="etat-vide">🤖 L'IA lit ton graphique…</p>`;
    let data = null, message = "";
    try {
      const r = await window.GoldAI.auth.client.functions.invoke("analyse-graphique", {
        body: { token: window.GoldAI.auth.getToken(), image, question: $("ia-question").value.trim(), tendances: tendancesDuMarche() },
      });
      data = r.data;
      if (r.error) {
        let corps = null;
        try { corps = await r.error.context?.json(); } catch { /* pas de JSON */ }
        if (corps?.erreur === "SESSION_INVALIDE") { window.GoldAI.auth.forcerDeconnexion("Ta session a expiré, reconnecte-toi."); return; }
        message = corps?.erreur || "Connexion au serveur impossible. Vérifie ta connexion.";
      }
    } catch {
      message = "Connexion au serveur impossible. Vérifie ta connexion.";
    } finally {
      enCours = false;
    }
    if (message) {
      $("ia-resultat").innerHTML = "";
      erreur(message);
    } else {
      $("ia-resultat").innerHTML = rendu(data.analyse, data.cout_usd, null);
    }
    await rafraichir();
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("carte-analyse-ia")) return;
    $("ia-choisir").addEventListener("click", () => $("ia-fichier").click());
    $("ia-fichier").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (!f) return;
      erreur("");
      try {
        image = await compresser(f);
        $("ia-apercu").src = image;
        $("ia-apercu").classList.remove("hidden");
        $("ia-choisir").textContent = "📷 Changer de capture";
        $("ia-resultat").innerHTML = "";
      } catch { image = null; erreur("Image illisible : choisis une autre capture."); }
      majBouton();
    });
    $("ia-analyser").addEventListener("click", analyser);
  });

  window.GoldAI = window.GoldAI || {};
  window.GoldAI.analyseIa = { rafraichir, rendu };
})();
