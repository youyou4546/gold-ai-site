"""
Prépare le calendrier économique de la semaine pour le site :
  - site/data/calendrier_semaine.json (fichier local, aussi utilisé hors ligne)
  - publication Supabase "calendrier" (ce que lit le site en ligne)

Source : flux public Forex Factory (nfs.faireconomy.media), déjà utilisé par
scripts/collecte_quotidienne.py — on réutilise son téléchargement avec cache
15 min (_telecharger_calendrier_brut) pour ne pas déclencher le 429.

Corrections :
  - Les heures du flux XML sont en UTC ("2:00pm" = 14:00 UTC = 10:00 à
    Toronto). L'ancien site les affichait telles quelles, comme si c'était
    l'heure locale (4 à 5 h de décalage). On produit maintenant un horodatage
    UTC complet (ISO 8601) que le site convertit dans le fuseau de
    l'utilisateur (America/Toronto par défaut) — changements d'heure compris.
  - Tous les événements de la semaine (toutes devises / tous impacts) sont
    gardés : le filtrage se fait sur le site ("afficher tous les événements").

Limites de la source (affichées sur le site, rien n'est inventé) :
  - Le flux ne contient PAS le résultat publié (seulement prévision et
    précédent) ni les révisions : "résultat" reste vide.
  - Il ne couvre que la semaine en cours (dimanche → samedi).

Investing.com : pas d'API publique ; leur calendrier et leur widget
renvoient 403 (protection anti-robots) aux requêtes automatiques. Le
contourner irait contre leurs conditions : la source est donc signalée
comme "non connectée" plutôt qu'imitée.
"""

import datetime
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ICI = Path(__file__).resolve().parent
RACINE = ICI.parent
DATA_DIR = RACINE / "data"
SCRIPTS_DIR = RACINE / "scripts"
SITE_DATA_DIR = ICI / "data"

sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(ICI))

UTC = datetime.timezone.utc

PAYS = {
    "USD": "États-Unis", "EUR": "Zone euro", "GBP": "Royaume-Uni", "JPY": "Japon",
    "CHF": "Suisse", "CNY": "Chine", "CAD": "Canada", "AUD": "Australie",
    "NZD": "Nouvelle-Zélande", "ALL": "Mondial",
}

SOURCE_FF = "Forex Factory"


def unite_depuis_valeur(*valeurs):
    """Devine l'unité affichée par la source ("0.3%" → "%", "180K" → "K")."""
    for v in valeurs:
        m = re.search(r"(%|[KMBT])\s*$", v or "")
        if m:
            return m.group(1)
    return ""


def horodatage_utc(date_texte, heure_texte):
    """Renvoie (iso_utc | None, date_iso, precision). Le flux XML est en UTC."""
    date = datetime.datetime.strptime(date_texte, "%m-%d-%Y").date()
    heure = (heure_texte or "").strip().lower()
    try:
        t = datetime.datetime.strptime(heure, "%I:%M%p").time()
    except ValueError:
        # "All Day", "Tentative", "Day 2"… : pas d'heure précise publiée.
        return None, date.isoformat(), heure or "heure non précisée"
    dt = datetime.datetime.combine(date, t, tzinfo=UTC)
    return dt.isoformat().replace("+00:00", "Z"), date.isoformat(), "heure"


def lire_forex_factory():
    import collecte_quotidienne as cq

    contenu = cq._telecharger_calendrier_brut()
    racine = ET.fromstring(contenu)
    evenements = []
    for ev in racine.findall(".//event"):
        devise = (ev.findtext("country") or "").strip().upper()
        titre = (ev.findtext("title") or "").strip()
        try:
            iso, date_iso, precision = horodatage_utc((ev.findtext("date") or "").strip(), ev.findtext("time"))
        except ValueError:
            continue
        prevision = (ev.findtext("forecast") or "").strip()
        precedent = (ev.findtext("previous") or "").strip()
        impact = (ev.findtext("impact") or "").strip().lower()
        ident = hashlib.sha1(f"{devise}|{titre}|{date_iso}".encode("utf-8")).hexdigest()[:16]
        evenements.append({
            "id": ident,
            "titre": titre,
            "devise": devise,
            "pays": PAYS.get(devise, devise),
            "horodatage_utc": iso,
            "date_utc": date_iso,
            "precision_heure": precision,
            "impact": impact,  # high / medium / low / holiday
            "valeurs": [{
                "source": SOURCE_FF,
                "prevision": prevision,
                "precedent": precedent,
                "resultat": None,  # non fourni par ce flux
                "url": (ev.findtext("url") or "").strip(),
            }],
            "unite": unite_depuis_valeur(prevision, precedent),
            "sources": [SOURCE_FF],
        })
    evenements.sort(key=lambda e: (e["horodatage_utc"] or e["date_utc"] + "T00:00:00Z", e["titre"]))
    return evenements


def synchroniser_jour():
    """Inchangé : copie du calendrier du jour collecté par collecte_quotidienne.py
    (conservé pour compatibilité, le site ne l'utilise plus)."""
    aujourdhui = datetime.date.today().isoformat()
    fichier_source = DATA_DIR / f"{aujourdhui}.json"
    if not fichier_source.exists():
        return
    contenu = json.loads(fichier_source.read_text(encoding="utf-8"))
    sortie = {"date": aujourdhui, "genere_le": datetime.datetime.now().isoformat(timespec="seconds"),
              "evenements": contenu.get("calendrier", [])}
    (SITE_DATA_DIR / "calendrier_du_jour.json").write_text(json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8")


def synchroniser_semaine():
    from publication import publier

    maintenant = datetime.datetime.now(UTC).isoformat(timespec="seconds")
    sources = []
    evenements = []
    try:
        evenements = lire_forex_factory()
        sources.append({"source": SOURCE_FF, "statut": "ok", "recupere_le": maintenant,
                        "note": "Flux public gratuit : prévision et précédent uniquement (pas de résultat publié ni de révision). Semaine en cours seulement. Cache 15 min."})
    except Exception as erreur:
        sources.append({"source": SOURCE_FF, "statut": "erreur", "recupere_le": maintenant,
                        "note": f"Téléchargement impossible ({type(erreur).__name__})."})
    sources.append({"source": "Investing.com", "statut": "non connecté", "recupere_le": None,
                    "note": "Aucune API publique ; accès automatisé refusé (HTTP 403). Non intégré pour ne pas contourner leurs restrictions."})

    sortie = {"genere_le": maintenant, "fuseau_source": "UTC", "sources": sources, "evenements": evenements}

    if evenements or not (SITE_DATA_DIR / "calendrier_semaine.json").exists():
        (SITE_DATA_DIR / "calendrier_semaine.json").write_text(json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK : {len(evenements)} événement(s) de la semaine")
    if evenements:
        print(publier("calendrier", sortie)[1])


def main():
    SITE_DATA_DIR.mkdir(exist_ok=True)
    synchroniser_jour()
    synchroniser_semaine()


if __name__ == "__main__":
    main()
