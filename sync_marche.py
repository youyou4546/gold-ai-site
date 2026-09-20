"""
Récupère les prix en direct des actifs qui influencent l'or (DXY, rendement
US 10 ans, argent) et écrit site/data/marche.json pour la section "Marché"
du site.

Réutilise recuperer_prix() de collecte_quotidienne.py (Twelve Data si
disponible, sinon Yahoo Finance en secours — gratuit, déjà en place).

Pensé pour tourner plus souvent que la collecte quotidienne (ex. toutes les
15 minutes) afin que le suivi ait l'air "en direct" — voir les instructions
données pour créer la tâche planifiée correspondante. Aucun coût : Yahoo
Finance ne demande pas de clé, et Twelve Data (gratuit) n'est de toute façon
pas utilisable pour ces 3 actifs sur le forfait actuel (voir commentaire
dans collecte_quotidienne.py).
"""

import datetime
import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = RACINE / "scripts"
SITE_DATA_DIR = Path(__file__).resolve().parent / "data"

sys.path.insert(0, str(SCRIPTS_DIR))

# Sens de la corrélation avec l'or, à titre indicatif (tendance historique
# générale, pas une garantie — le marché peut diverger selon le contexte).
CORRELATIONS = {
    "dollar": {
        "sens": "inverse",
        "explication": "Un dollar plus fort rend l'or plus cher pour les autres devises → généralement baissier pour l'or, et inversement.",
    },
    "rendement10ans": {
        "sens": "inverse",
        "explication": "Des rendements obligataires plus élevés rendent les obligations plus attractives face à l'or (qui ne rapporte pas d'intérêt) → généralement baissier pour l'or, et inversement.",
    },
    "argent": {
        "sens": "positif",
        "explication": "L'argent est un métal précieux qui suit historiquement des mouvements similaires à l'or (tous deux réagissent au dollar et aux taux) → corrélation généralement positive.",
    },
}


def main():
    import collecte_quotidienne as cq

    config = cq.charger_config()
    actifs = []

    # "or" en premier : c'est l'actif suivi, pas un actif corrélé à lui-même
    # (pas d'étiquette de corrélation pour celui-là — voir marche.js).
    for cle in ("or", "dollar", "rendement10ans", "argent"):
        donnees = cq.recuperer_prix(cle, config["cle_api_twelvedata"])
        info_correlation = CORRELATIONS.get(cle)

        if "erreur" in donnees:
            actif = {"cle": cle, "nom": donnees["nom"], "erreur": donnees["erreur"]}
        else:
            actif = {
                "cle": cle,
                "nom": donnees["nom"],
                "prix": donnees["actuel"],
                "variation_pct": round(donnees["variation_pct"], 2),
                "source": donnees["source"],
            }

        if info_correlation:
            actif["correlation"] = info_correlation["sens"]
            actif["correlation_explication"] = info_correlation["explication"]

        actifs.append(actif)

    SITE_DATA_DIR.mkdir(exist_ok=True)
    sortie = {
        "genere_le": datetime.datetime.now().isoformat(timespec="seconds"),
        "actifs": actifs,
    }
    (SITE_DATA_DIR / "marche.json").write_text(
        json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"OK : {len(actifs)} actif(s) écrit(s) dans marche.json")


if __name__ == "__main__":
    main()
