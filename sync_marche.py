"""
Récupère les cotations des actifs qui influencent l'or (indice dollar,
rendement US 10 ans, argent) + l'or spot, écrit site/data/marche.json ET le
publie dans Supabase (voir publication.py) pour que le site en ligne le voie.

Corrections par rapport à l'ancienne version (prix "figés" sur le site) :
  1. Le fichier n'était jamais envoyé sur le site en ligne → publication Supabase.
  2. Le secours Yahoo pour l'or/l'argent prenait les CONTRATS À TERME COMEX
     (GC=F / SI=F) mais les affichait comme "XAU/USD" / "XAG/USD" spot. Ici
     chaque actif garde son vrai instrument et son vrai libellé. L'or spot vient
     uniquement de Twelve Data (XAU/USD) ; s'il échoue, pas de substitution.
  3. La "variation du jour" Yahoo était calculée contre la clôture d'il y a
     5 jours (chartPreviousClose avec range=5d) → on prend la vraie clôture
     de la séance précédente.
  4. Chaque cotation garde son horodatage (heure de la cotation, pas l'heure du
     script) pour que le site puisse juger de sa fraîcheur.

Corrélations : en plus du sens "théorique" (dollar ↔ or inverse…), calcule la
corrélation OBSERVÉE des variations quotidiennes sur ~60 séances (mise en
cache 6 h). Ce n'est ni fixe ni une preuve de causalité — le site l'affiche
comme une mesure récente, rien de plus.

Coût : Twelve Data gratuit (1 crédit par lancement + 1 crédit toutes les 6 h
pour les corrélations), Yahoo Finance sans clé (données différées).
"""

import datetime
import json
import math
import sys
import time
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")

ICI = Path(__file__).resolve().parent
RACINE = ICI.parent
SCRIPTS_DIR = RACINE / "scripts"
SITE_DATA_DIR = ICI / "data"
CACHE_CORRELATIONS = RACINE / "data" / "_cache_correlations.json"
CACHE_CORRELATIONS_HEURES = 6

sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(ICI))

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) gold-ai/1.0"}
UTC = datetime.timezone.utc

# Sens habituel de la relation avec l'or (tendance historique générale, pas
# une règle fixe — voir la corrélation observée calculée plus bas).
CORRELATIONS = {
    "dollar": {
        "sens": "inverse",
        "explication": "Un dollar plus fort rend l'or plus cher pour les autres devises → souvent baissier pour l'or, et inversement.",
    },
    "rendement10ans": {
        "sens": "inverse",
        "explication": "Des rendements plus élevés rendent les obligations plus attractives face à l'or (qui ne rapporte pas d'intérêt) → souvent baissier pour l'or, et inversement.",
    },
    "argent": {
        "sens": "positif",
        "explication": "L'argent réagit souvent aux mêmes facteurs que l'or (dollar, taux) → évolue généralement dans le même sens. Il ne « cause » pas les mouvements de l'or.",
    },
}

# Instruments Yahoo réellement utilisés — libellés honnêtes (indice, futures).
YAHOO = {
    "dollar": {"symbole": "DX-Y.NYB", "nom": "Indice dollar (DXY)", "type_instrument": "indice", "type_prix": "dernier prix"},
    "rendement10ans": {"symbole": "^TNX", "nom": "Rendement US 10 ans", "type_instrument": "taux (%)", "type_prix": "dernier prix"},
    "argent": {"symbole": "SI=F", "nom": "Argent — contrat à terme COMEX (SI=F)", "type_instrument": "contrat à terme", "type_prix": "dernier prix"},
}


def iso(ts):
    return datetime.datetime.fromtimestamp(ts, UTC).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Or spot — Twelve Data
# ---------------------------------------------------------------------------

def lire_or_spot(cle_api):
    base = {
        "cle": "or",
        "nom": "Or spot (XAU/USD)",
        "instrument": "XAU/USD",
        "type_instrument": "spot",
        "fournisseur": "Twelve Data",
        "type_prix": "prix agrégé (le fournisseur ne précise pas bid/ask)",
    }
    if not cle_api or cle_api == "VOTRE_CLE_ICI":
        return {**base, "erreur": "clé Twelve Data absente de config.ini"}
    try:
        r = requests.get("https://api.twelvedata.com/quote",
                         params={"symbol": "XAU/USD", "apikey": cle_api}, headers=HEADERS, timeout=15)
        d = r.json()
    except Exception as erreur:
        return {**base, "erreur": f"Twelve Data injoignable ({type(erreur).__name__})"}
    if not isinstance(d, dict) or d.get("status") == "error" or "close" not in d:
        return {**base, "erreur": f"Twelve Data : {d.get('message', 'réponse inattendue') if isinstance(d, dict) else 'réponse inattendue'}"}

    prix = float(d["close"])
    precedent = float(d["previous_close"])
    horodatage = d.get("last_quote_at") or d.get("timestamp")
    return {
        **base,
        "prix": prix,
        "cloture_precedente": precedent,
        "variation_pct": round((prix - precedent) / precedent * 100, 3),
        "horodatage_cotation": iso(int(horodatage)) if horodatage else None,
        "marche_ouvert": d.get("is_market_open"),
        "differe": False,
    }


# ---------------------------------------------------------------------------
# Indice dollar, rendement 10 ans, argent — Yahoo Finance (différé)
# ---------------------------------------------------------------------------

def _yahoo_chart(symbole, intervalle, periode):
    derniere_erreur = None
    for hote in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            r = requests.get(f"https://{hote}/v8/finance/chart/{symbole}",
                             params={"interval": intervalle, "range": periode}, headers=HEADERS, timeout=15)
            r.raise_for_status()
            resultat = r.json()["chart"]["result"]
            if resultat:
                return resultat[0]
            derniere_erreur = ValueError("aucune donnée")
        except Exception as erreur:
            derniere_erreur = erreur
    raise RuntimeError(f"Yahoo Finance indisponible ({type(derniere_erreur).__name__})")


def _cloture_precedente(resultat):
    """Clôture de la dernière séance COMPLÈTE avant celle de la cotation
    actuelle (et non celle d'il y a 5 jours)."""
    meta = resultat["meta"]
    tz_offset = meta.get("gmtoffset", 0)
    jour_cotation = datetime.datetime.fromtimestamp(meta["regularMarketTime"] + tz_offset, UTC).date()
    closes = resultat["indicators"]["quote"][0]["close"]
    candidats = []
    for ts, close in zip(resultat.get("timestamp", []), closes):
        jour = datetime.datetime.fromtimestamp(ts + tz_offset, UTC).date()
        if close is not None and jour < jour_cotation:
            candidats.append(close)
    return candidats[-1] if candidats else None


def lire_yahoo(cle):
    info = YAHOO[cle]
    base = {
        "cle": cle,
        "nom": info["nom"],
        "instrument": info["symbole"],
        "type_instrument": info["type_instrument"],
        "fournisseur": "Yahoo Finance",
        "type_prix": info["type_prix"],
        "differe": True,
    }
    try:
        resultat = _yahoo_chart(info["symbole"], "1d", "10d")
    except Exception as erreur:
        return {**base, "erreur": str(erreur)}

    meta = resultat["meta"]
    prix = meta.get("regularMarketPrice")
    precedent = _cloture_precedente(resultat)
    if prix is None:
        return {**base, "erreur": "cotation absente de la réponse Yahoo"}

    periode = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    maintenant = time.time()
    marche_ouvert = bool(periode) and periode.get("start", 0) <= maintenant <= periode.get("end", 0)

    return {
        **base,
        "prix": prix,
        "cloture_precedente": precedent,
        "variation_pct": round((prix - precedent) / precedent * 100, 3) if precedent else None,
        "horodatage_cotation": iso(meta["regularMarketTime"]),
        "marche_ouvert": marche_ouvert,
    }


# ---------------------------------------------------------------------------
# Corrélations observées (variations quotidiennes, ~60 séances)
# ---------------------------------------------------------------------------

def _rendements_par_jour(paires):
    """paires = [(date, close)] triées → {date: variation relative vs séance précédente}."""
    sortie = {}
    for (d0, c0), (d1, c1) in zip(paires, paires[1:]):
        if c0 and c1:
            sortie[d1] = c1 / c0 - 1
    return sortie


def _pearson(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    return cov / math.sqrt(vx * vy) if vx > 0 and vy > 0 else None


def calculer_correlations(cle_api):
    try:
        if CACHE_CORRELATIONS.exists():
            cache = json.loads(CACHE_CORRELATIONS.read_text(encoding="utf-8"))
            age_h = (time.time() - CACHE_CORRELATIONS.stat().st_mtime) / 3600
            if age_h < CACHE_CORRELATIONS_HEURES:
                return cache
    except Exception:
        pass

    try:
        r = requests.get("https://api.twelvedata.com/time_series",
                         params={"symbol": "XAU/USD", "interval": "1day", "outputsize": 90,
                                 "timezone": "UTC", "apikey": cle_api}, headers=HEADERS, timeout=20)
        valeurs = r.json().get("values") or []
        or_paires = sorted((v["datetime"][:10], float(v["close"])) for v in valeurs)
    except Exception:
        return None
    rend_or = _rendements_par_jour(or_paires)

    resultats = {}
    for cle, info in YAHOO.items():
        try:
            res = _yahoo_chart(info["symbole"], "1d", "6mo")
            closes = res["indicators"]["quote"][0]["close"]
            paires = sorted(
                (datetime.datetime.fromtimestamp(ts, UTC).date().isoformat(), c)
                for ts, c in zip(res["timestamp"], closes) if c is not None
            )
            rend = _rendements_par_jour(paires)
            jours = sorted(set(rend) & set(rend_or))[-60:]
            if len(jours) < 30:
                continue
            coef = _pearson([rend_or[j] for j in jours], [rend[j] for j in jours])
            if coef is not None:
                resultats[cle] = {"coefficient": round(coef, 2), "seances": len(jours),
                                  "du": jours[0], "au": jours[-1]}
        except Exception:
            continue

    sortie = {"calcule_le": datetime.datetime.now(UTC).isoformat(timespec="seconds"),
              "methode": "corrélation de Pearson des variations quotidiennes de clôture (or spot Twelve Data vs instrument Yahoo), dates communes",
              "valeurs": resultats}
    try:
        CACHE_CORRELATIONS.write_text(json.dumps(sortie, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
    return sortie


def main():
    import collecte_quotidienne as cq
    from publication import publier

    config = cq.charger_config()
    cle_td = config["cle_api_twelvedata"]

    actifs = [lire_or_spot(cle_td)] + [lire_yahoo(cle) for cle in ("dollar", "rendement10ans", "argent")]
    for actif in actifs:
        info = CORRELATIONS.get(actif["cle"])
        if info:
            actif["correlation"] = info["sens"]
            actif["correlation_explication"] = info["explication"]

    sortie = {
        "genere_le": datetime.datetime.now(UTC).isoformat(timespec="seconds"),
        "actifs": actifs,
        "correlations_observees": calculer_correlations(cle_td),
    }

    SITE_DATA_DIR.mkdir(exist_ok=True)
    (SITE_DATA_DIR / "marche.json").write_text(json.dumps(sortie, ensure_ascii=False, indent=2), encoding="utf-8")
    erreurs = [a["cle"] for a in actifs if "erreur" in a]
    print(f"OK : {len(actifs)} actif(s) écrit(s) dans marche.json" + (f" — en erreur : {', '.join(erreurs)}" if erreurs else ""))
    print(publier("marche", sortie)[1])


if __name__ == "__main__":
    main()
