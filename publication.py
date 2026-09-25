"""
Publie les données du site (marché, calendrier, actualités) dans la base
Supabase, pour que le site EN LIGNE les voie immédiatement.

Pourquoi : avant, sync_marche.py / sync_calendrier.py écrivaient seulement des
fichiers JSON sur ce PC — rien ne les envoyait sur GitHub Pages, donc le site
en ligne affichait des prix et un calendrier figés (ex. prix du 19/09 encore
visibles le 25/09).

Le secret de publication est dans config/config.ini, section [site_supabase]
(créé par preparer_patch_local.py). Sans lui, la publication est simplement
ignorée avec un message clair : les fichiers JSON locaux restent écrits.
"""

import configparser
from pathlib import Path

import requests

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "config.ini"


def _config():
    config = configparser.ConfigParser()
    config.read(CONFIG_PATH, encoding="utf-8")
    if not config.has_section("site_supabase"):
        return None
    section = config["site_supabase"]
    valeurs = {k: section.get(k, "").strip() for k in ("url", "cle_publique", "secret_publication")}
    return valeurs if all(valeurs.values()) else None


def publier(nom, contenu):
    """Envoie `contenu` (dict JSON) sous le nom `nom` ("marche", "calendrier"
    ou "actualites"). Renvoie (ok: bool, message: str) — ne lève jamais."""
    cfg = _config()
    if not cfg:
        return False, "publication ignorée : section [site_supabase] absente de config.ini (lance preparer_patch_local.py)"
    try:
        reponse = requests.post(
            f"{cfg['url']}/rest/v1/rpc/publier_donnees",
            headers={
                "apikey": cfg["cle_publique"],
                "Authorization": f"Bearer {cfg['cle_publique']}",
                "Content-Type": "application/json",
            },
            json={"p_secret": cfg["secret_publication"], "p_nom": nom, "p_contenu": contenu},
            timeout=20,
        )
    except requests.exceptions.RequestException as erreur:
        return False, f"publication « {nom} » impossible (réseau) : {type(erreur).__name__}"

    if reponse.status_code >= 400:
        # Le message ne reprend jamais le secret (seulement la réponse du serveur).
        detail = reponse.text[:200]
        if "SECRET_INVALIDE" in detail:
            detail = "secret refusé (le patch Supabase a-t-il été exécuté avec ce secret ?)"
        elif "publier_donnees" in detail and ("not find" in detail or "PGRST202" in detail):
            detail = "fonction absente : le patch supabase/patch_calculateur_cotations.sql n'a pas encore été exécuté"
        return False, f"publication « {nom} » refusée (HTTP {reponse.status_code}) : {detail}"
    return True, f"publication « {nom} » OK ({reponse.json()})"
