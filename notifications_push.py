"""
Notifications sur le téléphone (Web Push) — outils communs.

- Clés "VAPID" : c'est la signature qui prouve aux services de notification
  (Apple, Google, Mozilla) que c'est bien NOTRE site qui envoie. La clé privée
  reste sur ce PC (config/vapid_prive.pem, jamais dans le dépôt public) ; la
  clé publique est copiée dans le site (js/notifications.js).
- Les abonnements (un par téléphone qui a accepté les notifications) sont
  stockés dans Supabase ; ce PC les lit avec le secret de publication.

Usage unique :  python notifications_push.py --cles   (crée les clés si absentes
et affiche la clé publique à mettre dans js/notifications.js).
"""

import base64
import configparser
import json
import sys
from pathlib import Path

import requests

RACINE = Path(__file__).resolve().parent.parent
CONFIG_PATH = RACINE / "config" / "config.ini"
CLE_PRIVEE = RACINE / "config" / "vapid_prive.pem"
# Contact exigé par les services de notification : l'adresse du site (pas d'e-mail personnel).
CONTACT = "https://youyou4546.github.io/gold-ai-site/"


def _config_supabase():
    config = configparser.ConfigParser()
    config.read(CONFIG_PATH, encoding="utf-8")
    s = config["site_supabase"] if config.has_section("site_supabase") else {}
    valeurs = {k: s.get(k, "").strip() for k in ("url", "cle_publique", "secret_publication")}
    return valeurs if all(valeurs.values()) else None


def _rpc(nom, params):
    cfg = _config_supabase()
    if not cfg:
        raise RuntimeError("section [site_supabase] absente de config.ini")
    r = requests.post(
        f"{cfg['url']}/rest/v1/rpc/{nom}",
        headers={"apikey": cfg["cle_publique"], "Authorization": f"Bearer {cfg['cle_publique']}", "Content-Type": "application/json"},
        json={"p_secret": cfg["secret_publication"], **params},
        timeout=20,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"{nom} refusé (HTTP {r.status_code}) : {r.text[:200]}")
    return r.json() if r.text else None


def cle_publique():
    """Clé publique au format attendu par le navigateur (base64url, point non compressé)."""
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid01

    v = Vapid01.from_file(str(CLE_PRIVEE))
    brut = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(brut).rstrip(b"=").decode()


def creer_cles_si_absentes():
    from py_vapid import Vapid01

    if not CLE_PRIVEE.exists():
        v = Vapid01()
        v.generate_keys()
        v.save_key(str(CLE_PRIVEE))
    return cle_publique()


def lister_abonnements():
    return _rpc("lister_abonnements_push", {}) or []


def retirer_abonnement(endpoint):
    _rpc("retirer_abonnement_push", {"p_endpoint": endpoint})


def envoyer_a_tous(titre, texte, url="./index.html#calendrier", etiquette=None):
    """Envoie la notification à tous les téléphones abonnés. Renvoie (envoyés, échecs)."""
    from pywebpush import WebPushException, webpush

    envoyes, echecs = 0, 0
    charge = json.dumps({"titre": titre, "texte": texte, "url": url, "tag": etiquette}, ensure_ascii=False)
    for ab in lister_abonnements():
        try:
            webpush(
                subscription_info={"endpoint": ab["endpoint"], "keys": {"p256dh": ab["p256dh"], "auth": ab["auth"]}},
                data=charge,
                vapid_private_key=str(CLE_PRIVEE),
                vapid_claims={"sub": CONTACT},
                ttl=15 * 60,  # inutile de livrer une alerte d'annonce après l'annonce
            )
            envoyes += 1
        except WebPushException as e:
            echecs += 1
            code = getattr(e.response, "status_code", None)
            if code in (404, 410):
                # Téléphone désabonné (app supprimée, notifications refusées) : on l'oublie.
                retirer_abonnement(ab["endpoint"])
            else:
                print(f"  échec d'envoi (HTTP {code}) : {str(e)[:150]}")
    return envoyes, echecs


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--cles" in sys.argv:
        print("Clé publique :", creer_cles_si_absentes())
    elif "--test" in sys.argv:
        print("Envoyés / échecs :", envoyer_a_tous("🔔 Test Trading Tool", "Les notifications d'annonces fonctionnent.", etiquette="test"))
    else:
        print(__doc__)
