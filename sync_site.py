"""
Met à jour TOUTES les données du site en une fois : prix (sync_marche.py),
calendrier (sync_calendrier.py), actualités urgentes (sync_actualites.py)
et comptes MT5 en lecture seule (sync_mt5.py),
puis les publie en ligne (Supabase).

Lancé toutes les 15 minutes par la tâche planifiée Windows "gold-ai site"
(scripts/lancer_site.bat). Si le PC est éteint, rien n'est publié : le site
l'indique (« relevé ancien ») au lieu d'afficher de vieux chiffres comme récents.
"""

import sys
import traceback

sys.stdout.reconfigure(encoding="utf-8")

import sync_actualites
import sync_calendrier
import sync_marche
import sync_mt5

for nom, module in (("marché", sync_marche), ("calendrier", sync_calendrier), ("actualités", sync_actualites), ("comptes MT5", sync_mt5)):
    try:
        module.main()
    except Exception:
        print(f"ÉCHEC {nom} :")
        traceback.print_exc()
