"""
Actualités urgentes (non planifiées) pour le site : conflits, sanctions et
droits de douane, décisions surprises des banques centrales, déclarations
inattendues, crises bancaires… utiles pour XAUUSD et le dollar.

Sources (toutes gratuites, sans contournement) :
  - Google News RSS (recherche par thème, déjà utilisé par le projet) — les
    articles viennent des médias qui y sont indexés (Reuters, AP, CNBC…).
  - Flux RSS officiels : Réserve fédérale, BCE, Banque d'Angleterre.

Traitement :
  1. Les articles < 36 h sont regroupés par événement (titres très proches),
     pour ne pas compter plusieurs fois la même information.
  2. Statut calculé par des règles fixes (pas par l'IA) :
       source officielle → "confirmé"
       titre de type rumeur ("reportedly", "selon des sources"…) → "non confirmé"
       titre de type direct ("live", "developing"…) → "en développement"
       ≥ 2 médias différents → "confirmé"
       sinon → "non confirmé" (une seule source)
  3. L'IA (Claude, clé de config.ini [ia], même modèle que le reste du projet)
     trie la pertinence, traduit le titre, fait un résumé court STRICTEMENT
     limité à ce que dit le titre/la description, et donne une interprétation
     séparée (clairement marquée comme telle). Résultats mis en cache par
     article : l'IA n'est appelée que pour les nouveaux événements.
     Sans IA : les événements restent affichés avec leur titre d'origine,
     importance "non évaluée".

Écrit site/data/actualites.json et publie "actualites" dans Supabase.
"""

import configparser
import datetime
import email.utils
import hashlib
import html
import json
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")

ICI = Path(__file__).resolve().parent
RACINE = ICI.parent
SITE_DATA_DIR = ICI / "data"
CACHE_IA = RACINE / "data" / "_cache_actualites_ia.json"
CONFIG_PATH = RACINE / "config" / "config.ini"

sys.path.insert(0, str(ICI))

UTC = datetime.timezone.utc
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) gold-ai/1.0"}
FENETRE_HEURES = 36

# Recherches Google News par thème (anglais : couverture internationale plus
# rapide ; "when:1d" = dernières 24 h).
RECHERCHES = {
    "conflit": "(airstrike OR missile OR bombing OR military escalation OR invasion OR ceasefire) when:1d",
    "sanctions_commerce": "(sanctions OR tariffs OR \"trade war\" OR export ban) when:1d",
    "banque_centrale": "(\"Federal Reserve\" OR Fed OR ECB OR \"central bank\") (surprise OR emergency OR unexpected OR intervention) when:1d",
    "declaration": "(Trump OR Powell OR Bessent OR Lagarde OR Xi) (says OR warns OR threatens) (dollar OR gold OR tariffs OR rates) when:1d",
    "crise_bancaire": "(\"bank run\" OR \"bank collapse\" OR \"banking crisis\" OR default OR bailout) when:1d",
    "or_dollar": "(\"gold price\" OR \"gold prices\" OR \"dollar index\" OR XAUUSD) when:1d",
}

FLUX_OFFICIELS = {
    "Réserve fédérale (Fed)": "https://www.federalreserve.gov/feeds/press_all.xml",
    "Banque centrale européenne (BCE)": "https://www.ecb.europa.eu/rss/press.html",
    "Banque d'Angleterre": "https://www.bankofengland.co.uk/rss/news",
}

MEDIAS_RECONNUS = {
    "reuters", "bloomberg", "associated press", "ap news", "afp", "financial times",
    "the wall street journal", "wsj", "cnbc", "bbc", "the new york times", "the guardian",
    "le monde", "les echos", "le figaro", "france 24", "marketwatch", "barron's", "nikkei",
    "al jazeera", "dw", "yahoo finance", "kitco", "fxstreet", "investing.com", "politico", "axios",
}

MOTS_RUMEUR = re.compile(r"\b(reportedly|sources say|unconfirmed|rumou?r|selon des sources|non confirm|could|may consider|weighs)\b", re.I)
MOTS_DIRECT = re.compile(r"\b(live|latest|developing|breaking|en direct|updates?)\b", re.I)

MOTS_VIDES = set("""a an the of to in on for and or at by with from as is are be after over amid into
its it this that new says said le la les de des du un une et en au aux pour sur par dans avec est
qui que ses son sa vs""".split())

PROMPT = """Tu tries des actualités pour un trader d'or (XAUUSD) et du dollar américain.
Pour CHAQUE événement ci-dessous (identifié par "id"), réponds UNIQUEMENT par un tableau JSON, un objet par id :
{{"id": "...", "pertinent": true/false, "categorie": "conflit|sanctions_commerce|banque_centrale|declaration|crise_bancaire|marche|autre",
 "titre_fr": "titre traduit en français, fidèle",
 "resume_fr": "1 phrase en français qui reprend UNIQUEMENT les faits présents dans le titre/la description, sans rien ajouter",
 "actifs": ["XAUUSD", "USD", ...],
 "importance": "haute|moyenne|faible",
 "justification": "courte raison de l'importance pour l'or / le dollar",
 "interpretation_direction_or": "haussier|baissier|incertain",
 "interpretation": "courte interprétation du mécanisme possible pour l'or (hypothèse, pas un fait)",
 "maj_importante": true/false, "maj_texte": "si une 'mise_a_jour' est fournie : ce qu'elle apporte d'important, sinon vide"}}
Règles : "pertinent" = false pour les faits divers, le sport, la politique intérieure sans effet de marché.
"importance" haute seulement si l'événement peut plausiblement faire bouger l'or ou le dollar dans la journée.
N'invente aucun chiffre, aucune déclaration, aucune source. Réponds avec le JSON seul.

Événements :
{evenements}"""


# ---------------------------------------------------------------------------
# Collecte
# ---------------------------------------------------------------------------

def _date_rss(texte):
    try:
        dt = email.utils.parsedate_to_datetime((texte or "").strip())
        return dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)
    except Exception:
        return None


def _nettoyer(texte):
    texte = re.sub(r"<[^>]+>", " ", html.unescape(texte or ""))
    return re.sub(r"\s+", " ", texte).strip()


def lire_google_news(categorie, requete):
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": requete, "hl": "en-US", "gl": "US", "ceid": "US:en"})
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    racine = ET.fromstring(r.content)
    articles = []
    for item in racine.findall(".//item")[:25]:
        source = (item.findtext("source") or "").strip()
        titre = _nettoyer(item.findtext("title"))
        if source and titre.endswith(f" - {source}"):
            titre = titre[: -len(source) - 3].strip()
        articles.append({
            "titre": titre,
            "description": "",
            "source": source or "Google News",
            "url": (item.findtext("link") or "").strip(),
            "publie_le": _date_rss(item.findtext("pubDate")),
            "officiel": False,
            "categorie_recherche": categorie,
        })
    return articles


def lire_flux_officiel(nom, url):
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    racine = ET.fromstring(r.content)
    articles = []
    for item in racine.findall(".//item")[:20]:
        articles.append({
            "titre": _nettoyer(item.findtext("title")),
            "description": _nettoyer(item.findtext("description"))[:400],
            "source": nom,
            "url": (item.findtext("link") or "").strip(),
            "publie_le": _date_rss(item.findtext("pubDate")),
            "officiel": True,
            "categorie_recherche": "banque_centrale",
        })
    return articles


# ---------------------------------------------------------------------------
# Regroupement par événement + statut
# ---------------------------------------------------------------------------

def _jetons(titre):
    mots = re.findall(r"[a-zà-ÿ0-9]+", titre.lower())
    return {m for m in mots if m not in MOTS_VIDES and len(m) > 2}


def _id_article(a):
    return hashlib.sha1(f"{a['source']}|{a['titre']}".encode("utf-8")).hexdigest()[:16]


def regrouper(articles, seuil=0.45):
    groupes = []
    for a in sorted(articles, key=lambda x: x["publie_le"]):
        j = _jetons(a["titre"])
        for g in groupes:
            inter = len(j & g["jetons"])
            union = len(j | g["jetons"]) or 1
            if inter / union >= seuil or (inter >= 4 and inter / min(len(j), len(g["jetons"]) or 1) >= 0.7):
                g["articles"].append(a)
                g["jetons"] |= j
                break
        else:
            groupes.append({"articles": [a], "jetons": set(j)})
    return groupes


def fiabilite_source(article):
    if article["officiel"]:
        return 3
    return 2 if article["source"].lower() in MEDIAS_RECONNUS else 1


def statut_groupe(articles):
    titres = " ".join(a["titre"] for a in articles)
    sources = {a["source"].lower() for a in articles}
    if any(a["officiel"] for a in articles):
        return "confirmé", "communiqué d'une source officielle"
    if MOTS_RUMEUR.search(titres):
        return "non confirmé", "formulé comme une information non vérifiée (« selon des sources »…)"
    if MOTS_DIRECT.search(titres):
        return "en développement", "couverture en direct / en cours"
    if len(sources) >= 2:
        return "confirmé", f"rapporté par {len(sources)} médias différents"
    return "non confirmé", "une seule source pour l'instant"


# ---------------------------------------------------------------------------
# IA (tri, traduction, interprétation) — avec cache
# ---------------------------------------------------------------------------

def _config_ia():
    config = configparser.ConfigParser()
    config.read(CONFIG_PATH, encoding="utf-8")
    cle = config.get("ia", "anthropic_api_key", fallback="").strip()
    modele = config.get("ia", "modele", fallback="claude-haiku-4-5").strip()
    return (cle, modele) if cle and cle != "VOTRE_CLE_ICI" else (None, None)


def _extraire_json(texte):
    debut, fin = texte.find("["), texte.rfind("]")
    if debut == -1 or fin == -1:
        raise ValueError("pas de tableau JSON dans la réponse")
    return json.loads(texte[debut: fin + 1])


def classer_avec_ia(a_classer):
    """a_classer = [{"id", "titre", "description", "sources", "mise_a_jour"?}] → {id: résultat}"""
    cle, modele = _config_ia()
    if not cle or not a_classer:
        return {}, (None if cle else "IA non configurée (config.ini [ia])")
    import anthropic

    client = anthropic.Anthropic(api_key=cle)
    resultats, erreurs = {}, 0
    for i in range(0, len(a_classer), 8):
        lot = a_classer[i: i + 8]
        try:
            message = client.messages.create(
                model=modele, max_tokens=6000,
                messages=[{"role": "user", "content": PROMPT.format(evenements=json.dumps(lot, ensure_ascii=False))}],
            )
            for obj in _extraire_json(message.content[0].text):
                if isinstance(obj, dict) and obj.get("id"):
                    resultats[obj["id"]] = obj
        except Exception:
            erreurs += 1  # ce lot sera retenté au prochain lancement (pas mis en cache)
    return resultats, (f"{erreurs} lot(s) IA en erreur, retentés au prochain lancement" if erreurs else None)


def _normaliser_ia(r):
    """Ne fait pas confiance au format exact renvoyé par l'IA (leçon du projet)."""
    def choix(valeur, options, defaut):
        v = str(valeur or "").lower()
        return next((o for o in options if o in v), defaut)
    return {
        "pertinent": bool(r.get("pertinent", True)),
        "categorie": choix(r.get("categorie"), ["conflit", "sanctions_commerce", "banque_centrale", "declaration", "crise_bancaire", "marche"], "autre"),
        "titre_fr": str(r.get("titre_fr") or "").strip() or None,
        "resume_fr": str(r.get("resume_fr") or "").strip() or None,
        "actifs": [str(x).upper() for x in (r.get("actifs") or []) if str(x).strip()][:6],
        "importance": choix(r.get("importance"), ["haute", "moyenne", "faible"], "non évaluée"),
        "justification": str(r.get("justification") or "").strip() or None,
        "interpretation_direction_or": choix(r.get("interpretation_direction_or"), ["haussier", "baissier", "incertain"], "incertain"),
        "interpretation": str(r.get("interpretation") or "").strip() or None,
        "maj_importante": bool(r.get("maj_importante")),
        "maj_texte": str(r.get("maj_texte") or "").strip() or None,
    }


# ---------------------------------------------------------------------------

def main():
    from publication import publier

    maintenant = datetime.datetime.now(UTC)
    limite = maintenant - datetime.timedelta(hours=FENETRE_HEURES)
    sources_statut = []
    articles = []

    for categorie, requete in RECHERCHES.items():
        try:
            lus = lire_google_news(categorie, requete)
            articles += lus
            sources_statut.append({"source": f"Google News — {categorie}", "statut": "ok", "nombre": len(lus)})
        except Exception as erreur:
            sources_statut.append({"source": f"Google News — {categorie}", "statut": "erreur", "note": type(erreur).__name__})
        time.sleep(0.5)  # politesse envers le fournisseur

    for nom, url in FLUX_OFFICIELS.items():
        try:
            lus = lire_flux_officiel(nom, url)
            articles += lus
            sources_statut.append({"source": nom, "statut": "ok", "nombre": len(lus)})
        except Exception as erreur:
            sources_statut.append({"source": nom, "statut": "erreur", "note": type(erreur).__name__})

    # Fenêtre de fraîcheur + dédoublonnage exact (même article dans plusieurs recherches)
    vus, uniques = set(), []
    for a in articles:
        if not a["publie_le"] or a["publie_le"] < limite or not a["titre"]:
            continue
        a["id"] = _id_article(a)
        if a["id"] in vus:
            continue
        vus.add(a["id"])
        uniques.append(a)

    groupes = regrouper(uniques)

    try:
        cache = json.loads(CACHE_IA.read_text(encoding="utf-8")) if CACHE_IA.exists() else {}
    except Exception:
        cache = {}

    a_classer = []
    for g in groupes:
        arts = sorted(g["articles"], key=lambda a: (-fiabilite_source(a), a["publie_le"]))
        g["representant"] = arts[0]
        deja = next((a["id"] for a in g["articles"] if a["id"] in cache), None)
        g["cle_cache"] = deja or arts[0]["id"]
        dernier = max(g["articles"], key=lambda a: a["publie_le"])
        nouveau_apres = deja and dernier["id"] not in cache and dernier["id"] != deja
        if not deja or nouveau_apres:
            item = {"id": g["cle_cache"], "titre": arts[0]["titre"], "description": arts[0]["description"],
                    "sources": sorted({a["source"] for a in g["articles"]})}
            if nouveau_apres:
                item["mise_a_jour"] = dernier["titre"]
            a_classer.append(item)
            g["dernier_id"] = dernier["id"]

    resultats, erreur_ia = classer_avec_ia(a_classer)
    maj_demandee = {item["id"] for item in a_classer if "mise_a_jour" in item}
    horodatage = maintenant.isoformat(timespec="seconds")
    for g in groupes:
        r = resultats.get(g["cle_cache"])
        if not r:
            continue
        nouveau = _normaliser_ia(r)
        ancien = cache.get(g["cle_cache"])
        if ancien and g["cle_cache"] in maj_demandee:
            # Garde la classification d'origine : n'ajoute que ce qu'apporte la mise à jour.
            ancien.update({"maj_importante": nouveau["maj_importante"], "maj_texte": nouveau["maj_texte"], "maj_le": horodatage})
        else:
            cache[g["cle_cache"]] = {**nouveau, "vu_le": horodatage}
        if g.get("dernier_id"):
            cache.setdefault(g["dernier_id"], {"alias": g["cle_cache"], "vu_le": horodatage})

    # Purge du cache (> 4 jours) pour qu'il ne grossisse pas indéfiniment
    seuil_purge = (maintenant - datetime.timedelta(days=4)).isoformat()
    cache = {k: v for k, v in cache.items() if v.get("vu_le", horodatage) >= seuil_purge}
    try:
        CACHE_IA.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass

    evenements = []
    for g in groupes:
        info = cache.get(g["cle_cache"]) or {}
        if info.get("alias"):
            info = cache.get(info["alias"], {})
        if info and not info.get("pertinent", True):
            continue
        rep = g["representant"]
        statut, raison_statut = statut_groupe(g["articles"])
        evenements.append({
            "id": g["cle_cache"],
            "titre_original": rep["titre"],
            "titre_fr": info.get("titre_fr"),
            "resume_fr": info.get("resume_fr"),
            "categorie": info.get("categorie") or rep["categorie_recherche"],
            "actifs": info.get("actifs") or [],
            "importance": info.get("importance") or "non évaluée",
            "justification": info.get("justification"),
            "interpretation": {"direction_or": info.get("interpretation_direction_or"), "texte": info.get("interpretation")} if info.get("interpretation") else None,
            "statut": statut,
            "raison_statut": raison_statut,
            "fiabilite": max(fiabilite_source(a) for a in g["articles"]),
            "officiel": any(a["officiel"] for a in g["articles"]),
            "publie_le": min(a["publie_le"] for a in g["articles"]).isoformat(timespec="seconds"),
            "dernier_article_le": max(a["publie_le"] for a in g["articles"]).isoformat(timespec="seconds"),
            "mise_a_jour": {"texte": info.get("maj_texte"), "le": info.get("maj_le")} if info.get("maj_importante") and info.get("maj_texte") else None,
            "evalue_par_ia": bool(info),
            "articles": [
                {"titre": a["titre"], "source": a["source"], "url": a["url"],
                 "publie_le": a["publie_le"].isoformat(timespec="seconds"), "officiel": a["officiel"]}
                for a in sorted(g["articles"], key=lambda a: a["publie_le"])
            ][:8],
        })

    sortie = {
        "genere_le": maintenant.isoformat(timespec="seconds"),
        "fenetre_heures": FENETRE_HEURES,
        "sources": sources_statut,
        "ia": {"statut": "erreur" if erreur_ia else "ok", "note": erreur_ia,
               "nouveaux_evenements_classes": len(resultats)},
        "evenements": evenements,
    }
    SITE_DATA_DIR.mkdir(exist_ok=True)
    (SITE_DATA_DIR / "actualites.json").write_text(json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK : {len(uniques)} article(s) → {len(groupes)} événement(s), {len(evenements)} gardé(s) ; IA : {erreur_ia or 'ok'} ({len(resultats)} classé(s))")
    print(publier("actualites", sortie)[1])


if __name__ == "__main__":
    main()
