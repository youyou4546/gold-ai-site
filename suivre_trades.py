"""
Surveille le « trade en cours » (bouton « J'entre » du calculateur) et envoie
une notification sur le téléphone quand un TP ou le SL est touché, même app
fermée — avec le nouveau SL à placer selon le plan de Profil › Général.

Lancé chaque minute par la tâche planifiée Windows "gold-ai suivi trade"
(scripts/lancer_suivi_trade.bat). S'il n'y a aucun trade en cours, il s'arrête
tout de suite SANS appeler Twelve Data (aucun crédit consommé).

Prix : bougies 1 minute de l'or spot (XAU/USD, Twelve Data) → on regarde le
plus haut et le plus bas depuis la dernière vérification, pour ne pas rater
un TP touché en mèche. Garde-fous sur le quota gratuit (800 requêtes / jour) :
une seule requête par minute pour tous les trades, rien le week-end, et le
suivi s'arrête tout seul 6 h après l'entrée.

La logique TP / SL est la même que dans le site (js/noyau.js › evaluerTouches).
"""

import configparser
import sys
from datetime import datetime, timezone

import requests

sys.stdout.reconfigure(encoding="utf-8")

import notifications_push as np_

DUREE_MAX_MS = 6 * 3600 * 1000
URL_APP = "./index.html#calculateur"


def cle_twelvedata():
    config = configparser.ConfigParser()
    config.read(np_.CONFIG_PATH, encoding="utf-8")
    return config.get("api", "twelvedata_api_key", fallback="").strip()


def marche_ferme(maintenant):
    # Or spot : fermé du vendredi ~21 h UTC au dimanche ~22 h UTC.
    j, h = maintenant.weekday(), maintenant.hour
    return j == 5 or (j == 4 and h >= 21) or (j == 6 and h < 22)


def bougies_1min():
    """Bougies 1 min (les plus récentes), en ms UTC. Une seule requête."""
    r = requests.get("https://api.twelvedata.com/time_series", params={
        "symbol": "XAU/USD", "interval": "1min", "outputsize": 15, "timezone": "UTC", "apikey": cle_twelvedata(),
    }, timeout=20)
    d = r.json()
    if d.get("status") == "error":
        raise RuntimeError(d.get("message", "erreur Twelve Data"))
    sortie = []
    for v in d.get("values", []):
        debut = datetime.strptime(v["datetime"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        sortie.append({"debut": int(debut.timestamp() * 1000), "haut": float(v["high"]), "bas": float(v["low"]), "cloture": float(v["close"])})
    return sortie


# --- Même logique que js/noyau.js -------------------------------------------

def sl_courant(t):
    sl = t["sl"]
    for p in t.get("plan", []):
        if p["apres"] in t.get("touches", []):
            sl = p["sl"]
    return sl


def evaluer_touches(t, haut, bas):
    vente = t["sens"] == "SELL"
    touches = list(t.get("touches", []))
    nouveaux = []
    sl_avant = sl_courant(t)
    sl_touche = not t.get("slTouche") and (haut >= sl_avant if vente else bas <= sl_avant)
    for tp in t.get("tps", []):
        nom = f"TP{tp['numero']}"
        if nom not in touches and (bas <= tp["prix"] if vente else haut >= tp["prix"]):
            touches.append(nom)
            nouveaux.append(nom)
    suivant = {**t, "touches": touches, "slTouche": bool(t.get("slTouche") or sl_touche)}
    tous = bool(t.get("tps")) and all(f"TP{tp['numero']}" in touches for tp in t["tps"])
    runner = any(p.get("type") != "tp" for p in t.get("portions", []))
    suivant["statut"] = "sl" if suivant["slTouche"] else ("termine" if tous and not runner else "ouvert")
    return suivant, nouveaux, sl_touche, sl_avant


def prix(x):
    return f"{x:.2f}".rstrip("0").rstrip(".")


# ---------------------------------------------------------------------------

def main():
    maintenant = datetime.now(timezone.utc)
    maintenant_ms = int(maintenant.timestamp() * 1000)
    horodatage = maintenant.strftime("%Y-%m-%d %H:%M")

    try:
        trades = np_._rpc("lister_trades_en_cours", {}) or []
    except RuntimeError as e:
        # Patch supabase/patch_trade_en_cours.sql pas encore installé : on attend sans bruit.
        if "PGRST202" not in str(e):
            print(f"{horodatage} lecture des trades en cours impossible : {e}")
        return
    ouverts = [x for x in trades if (x["contenu"] or {}).get("statut", "ouvert") == "ouvert"]
    if not ouverts:
        return  # rien à suivre : aucune requête Twelve Data

    bougies = None
    if not marche_ferme(maintenant):
        try:
            bougies = bougies_1min()
        except Exception as e:
            print(f"{horodatage} prix indisponibles : {e}")

    for ligne in ouverts:
        compte_id, t = ligne["compte_id"], ligne["contenu"]
        a_envoyer = []

        if maintenant_ms - t.get("debutMs", maintenant_ms) > DUREE_MAX_MS:
            t = {**t, "statut": "expire"}
            a_envoyer.append(("⏱️ Suivi du trade arrêté", "6 h après l'entrée, le suivi s'arrête. Pense à enregistrer ton trade dans le Journal."))
        elif bougies:
            depuis = max(t.get("debutMs", 0), t.get("derniereVerifMs", 0))
            # Bougies qui chevauchent la période depuis la dernière vérification.
            utiles = [b for b in bougies if b["debut"] + 60000 > depuis]
            if utiles:
                haut, bas = max(b["haut"] for b in utiles), min(b["bas"] for b in utiles)
                t, nouveaux, sl_touche, sl_avant = evaluer_touches(t, haut, bas)
                sl_apres = sl_courant(t)
                if nouveaux:
                    prix_tp = {f"TP{tp['numero']}": tp["prix"] for tp in t["tps"]}
                    niveaux = " et ".join(f"{n} ({prix(prix_tp[n])})" for n in nouveaux)
                    titre = f"🎯 {niveaux} touché{'s' if len(nouveaux) > 1 else ''}"
                    if t["statut"] == "termine":
                        texte = "Dernier TP atteint : trade terminé. Enregistre-le dans le Journal."
                    elif sl_apres != sl_avant:
                        texte = f"Remonte ton SL à {prix(sl_apres)}." if t["sens"] == "BUY" else f"Descends ton SL à {prix(sl_apres)}."
                    else:
                        texte = f"SL inchangé à {prix(sl_apres)} (selon ton plan)."
                    a_envoyer.append((titre, texte))
                if sl_touche:
                    a_envoyer.append((f"🛑 SL touché ({prix(sl_avant)})", "Ton trade est sans doute fermé. Ouvre l'app pour l'enregistrer dans le Journal."))
        t = {**t, "derniereVerifMs": maintenant_ms}

        for titre, texte in a_envoyer:
            try:
                envoyes, echecs = np_.envoyer_a_tous(titre, texte, url=URL_APP, etiquette=f"trade-{t.get('id')}", compte_id=compte_id)
                print(f"{horodatage} « {titre} » → {envoyes} téléphone(s), {echecs} échec(s)")
            except Exception as e:
                print(f"{horodatage} notification impossible : {e}")
        try:
            np_._rpc("maj_trade_en_cours", {"p_compte_id": compte_id, "p_id": t.get("id"), "p_contenu": t})
        except Exception as e:
            print(f"{horodatage} mise à jour du trade impossible : {e}")


if __name__ == "__main__":
    main()
