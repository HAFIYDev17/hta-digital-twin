# Anomalies découvertes dans les schémas officiels (30/07/2025)

Ce document liste ce que l'extraction automatique a trouvé en analysant
**les vrais fichiers DXF** (`SCHEMA_POSTE_SOURCE_*_30072025.dxf`) et le
fichier maître `UNIFILAIRE2026.xls`. Rien ici n'est hypothétique : chaque
ligne est reproductible avec `tools/dxf_extract/extract.py`.

## 1. Le bug qui gonfle les totaux : confusion calque ↔ attribut DEPART

Chaque poste est un bloc DXF qui porte un attribut `DEPART` (texte saisi) **et**
vit sur un calque nommé `<DEPART>_POSTE`. Ces deux informations devraient
toujours coïncider. Sur 629 postes, **10 ne coïncident pas** (hors différences
de notation type `KANI_KELI` vs `KANIKELI`, qui sont juste des conventions
de nommage différentes et sans impact) :

| Poste | Nom               | Départ déclaré | Dessiné sur le calque |
| ----- | ----------------- | -------------- | --------------------- |
| 90003 | PETANQUE          | MAKI           | YLANG                 |
| 83002 | LPA               | MAKI           | YLANG                 |
| 83001 | COCONI            | MAKI           | YLANG                 |
| 06008 | MAHOUJANI         | SOULOU         | CHIRONGUI             |
| 06011 | ISND              | SOULOU         | CHIRONGUI             |
| 96000 | MROALE            | KAHANI         | SOULOU                |
| 66068 | PROD. OKINAWA     | ZI             | LUKIDA                |
| 66065 | ALBIOMA STOCK NEL | ZI             | LUKIDA                |
| 41000 | TSARARANO         | OUANGANI       | PASSAMAINTY           |
| 68001 | 17MAR             | YLANG          | PASSAMAINTY           |

**Conséquence concrète déjà visible aujourd'hui** : l'export `UNIFILAIRE2026.xls`
actuellement utilisé par le métier contient ces mêmes postes **en double**
(une fois par département), ce qui fausse silencieusement les cumuls de
puissance et de clients par départ. Exemple vérifié dans le fichier réel :

```
68001 | 17MAR | YLANG       | 630 kVA | Nbr Client : 720
68001 | 17MAR | PASSAMAINTY | 630 kVA | Nbr Client : 720
```

720 clients comptés deux fois. Le poste 17MAR est d'ailleurs visiblement
signalé par un marqueur d'alerte dans le schéma LONGONI d'origine - l'auteur
du plan avait déjà remarqué que quelque chose clochait à cet endroit, sans
que l'outil ne le formalise.

La vue `v_anomalie_depart_layer_mismatch` détecte ce cas en continu.

## 2. Doublons de NUMERO : deux familles de signal très différentes

### a) Vraie erreur de saisie (même poste source)

| Numéro | Nom     | Poste source | Départs en conflit     |
| ------ | ------- | ------------ | ---------------------- |
| 51000  | KANI BE | SADA         | KANIKELI **et** BOUENI |

Deux blocs distincts, à ~2000 unités de distance, portant le même numéro
métier. À trancher avec le terrain (renommer l'un des deux).
→ `v_anomalie_numero_duplique`.

### b) Jonctions inter-postes-source (probablement légitimes)

Le même numéro apparaît une fois dans chaque DXF voisin - typiquement un
point de bouclage/secours entre deux postes source, ou un renvoi visuel
(« VERS POSTE … ») redessiné comme un poste complet plutôt qu'une simple
annotation :

| Numéro | Nom                    | Jonction                                        |
| ------ | ---------------------- | ----------------------------------------------- |
| 41000  | TSARARANO              | SADA (Ouangani) ↔ KAWENI_BADAMIER (Passamainty) |
| 68001  | 17MAR                  | LONGONI (Ylang) ↔ KAWENI_BADAMIER (Passamainty) |
| 58041  | REPORT CHARGE (6x1600) | LONGONI ↔ KAWENI_BADAMIER (Kaweni 1)            |
| 58045  | REGUL SOLAR (4x1000)   | LONGONI ↔ KAWENI_BADAMIER (Kaweni 1)            |
| 66066  | HAMAHA BEACH           | LONGONI ↔ KAWENI_BADAMIER (Longoni 1)           |
| 66072  | FPV HAMAHA             | LONGONI ↔ KAWENI_BADAMIER (Longoni 2)           |

→ `v_jonction_inter_source_candidate`. Ne pas dédupliquer automatiquement :
direction produit volontaire (cf. table `bouclage`).

## 3. Bilan des puissances : LONGONI n'est plus tenu à jour

Chaque DWG contient un bloc `INFODEPART` (« BILAN DES PUISSANCES INSTALLEES »)
avec une valeur de référence par départ, saisie manuellement. En comparant
au recalcul automatique (`v_depart_drift`) :

- **SADA** et **KAWENI_BADAMIER** : écarts de 0 à 14 % (cohérent avec une
  évolution normale du réseau depuis le dernier calcul manuel - preuve que
  l'extraction est fiable).
- **LONGONI** : le bloc enregistré donne des valeurs absurdes (ex. Kangani
  "29 kVA" enregistrés pour 45 postes / 29 140 kVA réels). Ce bilan n'a
  vraisemblablement jamais été recalculé depuis la création du gabarit -
  à ne pas utiliser comme référence tant qu'il n'est pas refait.

## 4. Référentiel départ → poste source : confiance et zones grises

Les 6 départs de SADA viennent du référentiel métier officiel
(`modele_import_postes_sada.xlsx`, couleurs incluses) : **fiabilité haute**.

Les 23 autres (LONGONI, KAWENI_BADAMIER) sont déduits par recoupement
(comptage d'entités par calque + attribut DEPART des vrais postes) :
**fiabilité haute sur la liste des départs**, mais :

- les **couleurs** de ces 23 départs sont des placeholders générés
  (`couleur_a_confirmer = true` dans `referentiel_depart`) - à remplacer en
  une requête `UPDATE` une fois la légende DWG officielle confirmée visuellement ;
- `KAWENI_1`, `LONGONI1`, `LONGONI2` se comportent comme des départs de
  jonction (très peu de postes, présents dans 2 DXF) plutôt que des départs
  de distribution classiques - à valider avec l'exploitant.

## 5. RM6 : positions détectées par géométrie, pas par attribut

Contrairement aux postes, les RM6 ne sont pas des blocs avec attributs : ce
sont des polylignes groupées sur un calque `<DEPART>_RM6`. L'extracteur les
détecte par clustering spatial puis rattache le texte le plus proche (ex.
"11CRT", ou "R"/"T" pour le mode de commande radio/RTC). **26 RM6 détectés**
au total, tous marqués `a_verifier = true` par défaut : à confirmer
visuellement avant de s'appuyer dessus pour une manœuvre réelle.

## 6. Symboles ignorés à l'extraction

Chaque DXF contient 2 à 3 blocs « gabarit de légende » (Poste LOCAL/SOCLE/PVCR
de la planche légende), reconnaissables car tous leurs attributs sont vides.
Ils sont filtrés à l'extraction pour ne pas polluer les comptages - sauf
quand le bloc porte un nom/numéro réel (ex. TSA1KAW/TSA2KAW, qui eux sont
de vrais actifs simplement dépourvus de NUMERO : anomalie `numero_vide`
légitime, conservée).
