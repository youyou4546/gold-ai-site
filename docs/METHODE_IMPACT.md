# Méthode « Impact probable » (version 1)

Code : `js/noyau.js` (fonctions `calculerTendance` et `analyserImpact`), testé par `tests/noyau.test.cjs`.
Chaque analyse enregistrée porte la mention `methode: "v1"` : si la méthode change, les anciennes analyses restent comparables.

## 1. Données utilisées (et leur fraîcheur)

| Donnée | Source | Fraîcheur exigée |
|---|---|---|
| Prix XAU/USD spot | Twelve Data (WebSocket, sinon requête toutes les 3 min) | ≤ 3 min = « en direct » ; > 15 min marché ouvert = « ancien » → analyse suspendue |
| Bougies 30 min, 1 h, 4 h, 1W | Twelve Data `time_series`, heures UTC | seules les bougies **clôturées** sont utilisées ; dernière clôture > 3 durées (10 j pour 1W) marché ouvert = « données anciennes » |
| Indice dollar (DXY), taux US 10 ans | Yahoo Finance via le PC (différé) | > 60 min marché ouvert = non compté |
| Corrélations observées | variations quotidiennes, 60 séances communes | recalculées toutes les 6 h |
| Actualités urgentes | Google News RSS + Fed/BCE/BoE, regroupées par événement | < 6 h |
| Calendrier | Forex Factory (prévision/précédent seulement) | semaine en cours |

## 2. Tendance d'une unité de temps

Sur les bougies clôturées (minimum 30) :

- **A — position** : clôture − EMA20, comptée si l'écart dépasse 0,25 × ATR14 (+1 au-dessus, −1 en dessous, 0 sinon).
- **B — pente** : EMA20 actuelle − EMA20 d'il y a 5 bougies, si > 0,1 × ATR14.
- **C — structure** : clôture − clôture d'il y a 10 bougies, si > 0,5 × ATR14.

Somme A+B+C : ≥ +2 haussier, ≤ −2 baissier, sinon neutre.

## 3. Combinaison des signaux (poids 1 chacun)

| Signal | Valeur |
|---|---|
| Tendance 30 min, 1 h, 4 h | +1 haussier / −1 baissier / 0 neutre |
| Tendance 1W | idem — **contexte seulement**, ne prouve pas la réaction à une annonce |
| Dollar (DXY) | signe(variation du jour) × signe(corrélation observée), si \|corrélation\| ≥ 0,3 et \|variation\| ≥ 0,15 % |
| Taux US 10 ans | idem, seuil 3 points de base |
| Actualités urgentes | somme des interprétations (haussier +1 / baissier −1) des événements **confirmés**, pertinents pour l'or, < 6 h, **plafonnée à ±1 au total** |

Non comptés (pour éviter le double comptage) : l'argent (réagit aux mêmes causes que l'or), les actualités non confirmées (signalées comme source d'incertitude), un même événement repris par plusieurs médias (regroupé en amont en un seul événement).

## 4. Règles de décision

1. Prix de l'or non à jour (marché ouvert) → **Analyse insuffisante**.
2. Moins de 3 signaux disponibles → **Analyse insuffisante**.
3. ≥ 2 signaux haussiers et ≥ 2 baissiers avec |somme| ≤ 1 → **Incertaine**.
4. Concordance = somme ÷ nombre de signaux : ≥ +0,25 **hausse**, ≤ −0,25 **baisse**, sinon **neutre**.
5. Confiance :
   - **élevée** : |concordance| ≥ 0,6, ≥ 5 signaux, prix en direct, pas d'annonce majeure USD dans les 2 h ;
   - **moyenne** : |concordance| ≥ 0,4 ;
   - **faible** sinon, et toujours faible avant une annonce majeure (< 2 h) ou marché fermé.
6. Horizon : **réaction immédiate** si une annonce majeure USD tombe dans < 2 h ou est sortie il y a < 1 h ; sinon **prochaines heures** ; la ligne 1W est affichée comme **contexte de fond**.

## 5. Avant / après une annonce

- **Avant** : trois scénarios conditionnels (supérieur / conforme / inférieur aux attentes) tirés de `data/glossaire_annonces.json`. Le chiffre n'est jamais « deviné ».
- **Après** : le résultat publié est affiché s'il existe (le flux gratuit Forex Factory ne le fournit pas : c'est indiqué). Le **mouvement déjà observé** = prix actuel − ouverture de la bougie 30 min de la publication. Le **scénario pour la suite** = la direction probable calculée ci-dessus.

## 6. Ce que la méthode ne fait pas

- La concordance n'est **pas une probabilité** : aucune calibration historique n'a été faite. Aucune probabilité chiffrée n'est affichée.
- Les corrélations ne sont ni fixes ni causales : elles sont recalculées et affichées avec leur période.
- Rien n'est garanti : « impact probable » = scénario.

## 7. Historique

Chaque analyse (horodatage, actif, horizon, direction, confiance, prix de référence et son horodatage, signaux, données disponibles) est ajoutée dans la table `analyses_impact` (Supabase) : aucune fonction ne permet de la modifier ou de la supprimer. Une nouvelle ligne est enregistrée quand la conclusion change, ou au plus une fois par heure sinon. La colonne « mouvement observé depuis » est calculée à l'affichage, sans toucher à l'analyse enregistrée.
