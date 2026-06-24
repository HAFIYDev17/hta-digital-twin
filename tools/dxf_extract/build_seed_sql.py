#!/usr/bin/env python3
"""
build_seed_sql.py - Transforme les JSON extraits des DXF (tools/dxf_extract/extract.py)
en fichiers SQL prets a executer sur Neon (Postgres).

Ne fabrique AUCUNE donnee metier inventee :
- Les 6 departs de SADA + leurs couleurs viennent de modele_import_postes_sada.xlsx
  (referentiel officiel deja valide par le metier).
- Les 23 autres departs (LONGONI + KAWENI_BADAMIER) sont derives par analyse des
  calques DXF (cf. docs/ANOMALIES_DECOUVERTES.md) : la couleur officielle de la
  legende DWG n'a pas pu etre echantillonnee de facon fiable -> on assigne une
  couleur PLACEHOLDER distincte (a remplacer en 1 requete UPDATE une fois la
  legende officielle confirmee). Champ `couleur_a_confirmer = true` pour ces lignes.
- Les 629 postes viennent integralement de l'extraction DXF (tools/dxf_extract/extract.py).
"""
import json
import colorsys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXTRACTED = ROOT / "data" / "extracted"
OUT = ROOT / "database" / "seed"
OUT.mkdir(parents=True, exist_ok=True)

# ----------------------------------------------------------------------------
# 1. POSTE SOURCE
# ----------------------------------------------------------------------------
POSTE_SOURCE = [
    # code, nom, tension_kv, commune
    ("SADA", "Poste Source SADA", 20, "Sada"),
    ("LONGONI", "Poste Source LONGONI", 20, "Koungou"),
    ("KAWENI_BADAMIER", "Poste Source KAWENI / BADAMIER", 20, "Mamoudzou"),
]

# ----------------------------------------------------------------------------
# 2. REFERENTIEL TYPE BLOC (issu du VBA / Projet_SU.txt - confirme)
# ----------------------------------------------------------------------------
REFERENTIEL_TYPE_BLOC = [
    ("POSTECAB_AB",   "AB", "CAB"),
    ("POSTECAB_DP",   "DP", "CAB"),
    ("POSTECBS_AB",   "AB", "CBS"),
    ("POSTECBS_DP",   "DP", "CBS"),
    ("POSTEH61_DP",   "DP", "H61"),
    ("POSTELOCAL_AB", "AB", "LOCAL"),
    ("POSTELOCAL_DP", "DP", "LOCAL"),
    ("POSTEPVCR_AB",  "AB", "PVCR"),
    ("POSTESOCLE_DP", "DP", "SOCLE"),
]

# ----------------------------------------------------------------------------
# 3. REFERENTIEL DEPART
#    SADA: officiel (xlsx métier). Les autres: derives empiriquement des DXF
#    (comptage d'entites par calque + attributs poste, cf. docs/).
# ----------------------------------------------------------------------------
SADA_OFFICIAL = [
    ("KANIKELI",  "Kani Kéli",  "#D4A017", "SADA"),
    ("CHIRONGUI", "Chirongui",  "#E74C3C", "SADA"),
    ("CHICONI",   "Chiconi",    "#95A5A6", "SADA"),
    ("OUANGANI",  "Ouangani",   "#2ECC71", "SADA"),
    ("MAKI",      "Maki",       "#8E44AD", "SADA"),
    ("BOUENI",    "Bouéni",     "#FF66CC", "SADA"),
]

LONGONI_DERIVED = [
    ("SOULOU",     "Soulou"),
    ("KAHANI",     "Kahani"),
    ("KANGANI",    "Kangani"),
    ("BANDRABOUA", "Bandraboua"),
    ("YLANG",      "Ylang"),
    ("VALLEE3",    "Vallée 3"),
    ("PORT",       "Port (Longoni)"),
    ("SOLAIRE",    "Solaire"),
]

KAWENI_BADAMIER_DERIVED = [
    ("SUD",         "Sud"),
    ("ZI",          "Zone Industrielle (ZI)"),
    ("PASSAMAINTY", "Passamainty"),
    ("CAVANI",      "Cavani"),
    ("PAMANDZI",    "Pamandzi"),
    ("LUKIDA",      "Lukida"),
    ("DZAOUDZI",    "Dzaoudzi"),
    ("MAMOUDZOU",   "Mamoudzou"),
    ("LAFERME",     "La Ferme"),
    ("MANGROVE",    "Mangrove"),
    ("KAWENI_1",    "Kaweni 1"),
    ("TSA1KAW",     "TSA 1 Kaweni"),
    ("TSA2KAW",     "TSA 2 Kaweni"),
]

# Codes qui apparaissent dans 2 postes source a la fois (points de jonction /
# bouclage probables entre departs voisins - cf. detection sur numeros partages).
# On les rattache a un poste_source "principal" pour l'affichage, l'autre cote
# est documente dans la table bouclage.
JONCTION_CODES = [
    ("LONGONI1", "Longoni 1", "LONGONI"),
    ("LONGONI2", "Longoni 2", "LONGONI"),
]


def placeholder_colors(n, exclude_hues=()):
    """Palette HSL deterministe et bien contrastee, en evitant les teintes
    deja prises (rouge/ambre reserves aux alertes)."""
    colors = []
    i = 0
    while len(colors) < n:
        hue = (i * 0.6180339887) % 1.0  # nombre d'or -> repartition uniforme
        i += 1
        if any(abs(hue - h) < 0.04 for h in exclude_hues):
            continue
        r, g, b = colorsys.hls_to_rgb(hue, 0.42, 0.55)
        colors.append("#{:02x}{:02x}{:02x}".format(int(r * 255), int(g * 255), int(b * 255)))
    return colors


def build_referentiel_depart():
    rows = []
    for code, libelle, couleur, ps in SADA_OFFICIAL:
        rows.append(dict(code=code, libelle=libelle, couleur=couleur, poste_source=ps,
                          couleur_a_confirmer=False))

    used_hues = [0.0, 0.08]  # rouge/ambre deja pris par SADA -> exclus du placeholder
    palette = placeholder_colors(len(LONGONI_DERIVED) + len(KAWENI_BADAMIER_DERIVED) + len(JONCTION_CODES),
                                  exclude_hues=used_hues)
    pi = 0
    for code, libelle in LONGONI_DERIVED:
        rows.append(dict(code=code, libelle=libelle, couleur=palette[pi], poste_source="LONGONI",
                          couleur_a_confirmer=True))
        pi += 1
    for code, libelle in KAWENI_BADAMIER_DERIVED:
        rows.append(dict(code=code, libelle=libelle, couleur=palette[pi], poste_source="KAWENI_BADAMIER",
                          couleur_a_confirmer=True))
        pi += 1
    for code, libelle, ps in JONCTION_CODES:
        rows.append(dict(code=code, libelle=libelle, couleur=palette[pi], poste_source=ps,
                          couleur_a_confirmer=True))
        pi += 1
    return rows


def sql_str(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def sql_num(v):
    return "NULL" if v is None else repr(v)


def sql_bool(v):
    return "TRUE" if v else "FALSE"


def main():
    postes = json.loads((EXTRACTED / "postes.json").read_text())
    assets = json.loads((EXTRACTED / "assets.json").read_text())
    rm6 = json.loads((EXTRACTED / "rm6.json").read_text())

    # ---- 010_referentiels.sql ----
    lines = ["-- Genere automatiquement par tools/dxf_extract/build_seed_sql.py",
              "-- NE PAS EDITER A LA MAIN : relancer le generateur puis ajuster les",
              "-- couleurs/poste_source via UPDATE si besoin (cf. docs/ANOMALIES_DECOUVERTES.md).",
              ""]
    lines.append("INSERT INTO poste_source (code, nom, tension_kv, commune) VALUES")
    lines.append(",\n".join(
        f"  ({sql_str(c)}, {sql_str(n)}, {tk}, {sql_str(co)})" for c, n, tk, co in POSTE_SOURCE
    ) + "\nON CONFLICT (code) DO NOTHING;\n")

    lines.append("INSERT INTO referentiel_type_bloc (code, regime, famille) VALUES")
    lines.append(",\n".join(
        f"  ({sql_str(c)}, {sql_str(r)}, {sql_str(f)})" for c, r, f in REFERENTIEL_TYPE_BLOC
    ) + "\nON CONFLICT (code) DO NOTHING;\n")

    dep_rows = build_referentiel_depart()
    lines.append("INSERT INTO referentiel_depart (code, libelle, couleur, poste_source, couleur_a_confirmer) VALUES")
    lines.append(",\n".join(
        f"  ({sql_str(d['code'])}, {sql_str(d['libelle'])}, {sql_str(d['couleur'])}, "
        f"{sql_str(d['poste_source'])}, {sql_bool(d['couleur_a_confirmer'])})" for d in dep_rows
    ) + "\nON CONFLICT (code) DO NOTHING;\n")
    (OUT / "010_referentiels.sql").write_text("\n".join(lines))

    # ---- 020_postes.sql ----
    plines = ["-- Genere automatiquement depuis data/extracted/postes.json (extraction DXF reelle).", ""]
    plines.append("INSERT INTO poste (poste_source, numero, nom, type_bloc, depart, depart_brut, regime,")
    plines.append("                    puissance_txt, puissance_kva, nb_clients, autre, x, y, rotation_deg, layer_dxf) VALUES")
    vals = []
    for p in postes:
        regime = p["type_bloc"].split("_")[-1] if "_" in p["type_bloc"] else None
        vals.append(
            f"  ({sql_str(p['poste_source'])}, {sql_str(p['numero']) if p['numero'] else 'NULL'}, "
            f"{sql_str(p['nom'])}, {sql_str(p['type_bloc'])}, "
            f"{sql_str(p['depart']) if p['depart'] else 'NULL'}, {sql_str(p['depart_brut'])}, {sql_str(regime)}, "
            f"{sql_str(p['puissance_txt'])}, {sql_num(p['puissance_kva'])}, {sql_num(p['nb_clients'])}, "
            f"{sql_str(p['autre'])}, {sql_num(p['x'])}, {sql_num(p['y'])}, {sql_num(p['rotation_deg'])}, "
            f"{sql_str(p['layer'])})"
        )
    plines.append(",\n".join(vals) + ";\n")
    (OUT / "020_postes.sql").write_text("\n".join(plines))

    # ---- 030_assets.sql (ILD / points d'ouverture / producteurs PV / MHRV / cadenas) ----
    alines = ["-- Genere automatiquement depuis data/extracted/assets.json + rm6.json.", ""]
    kind_table = {
        "ild": "ild",
        "point_ouverture": "point_ouverture",
        "client_mhrv": None,   # stocke comme flag sur poste le plus proche -> hors scope v1, voir docs
        "producteur_pv": "producteur",
        "cadenas_exploitation": None,
    }
    for kind in ("point_ouverture", "ild", "producteur"):
        rows = [a for a in assets if kind_table.get(a["kind"]) == kind]
        if not rows:
            continue
        if kind == "point_ouverture":
            alines.append("INSERT INTO point_ouverture (poste_source, x, y, etat, remarque) VALUES")
            alines.append(",\n".join(
                f"  ({sql_str(a['poste_source'])}, {sql_num(a['x'])}, {sql_num(a['y'])}, 'FERME', "
                f"{sql_str('extrait DXF layer=' + a['layer'])})" for a in rows
            ) + ";\n")
        elif kind == "ild":
            alines.append("INSERT INTO ild (poste_source, x, y, type, etat) VALUES")
            alines.append(",\n".join(
                f"  ({sql_str(a['poste_source'])}, {sql_num(a['x'])}, {sql_num(a['y'])}, 'SOUTERRAIN', "
                f"{sql_str('A_VERIFIER' if not a['etat_suspecte'] else 'DEFAUT_SUSPECTE')})" for a in rows
            ) + ";\n")
        elif kind == "producteur":
            alines.append("INSERT INTO producteur (poste_source, x, y, type, actif) VALUES")
            alines.append(",\n".join(
                f"  ({sql_str(a['poste_source'])}, {sql_num(a['x'])}, {sql_num(a['y'])}, 'PHOTOVOLTAIQUE', TRUE)"
                for a in rows
            ) + ";\n")
    if rm6:
        dep_codes = {d["code"] for d in dep_rows}
        dep_codes_no_us = {d["code"].replace("_", ""): d["code"] for d in dep_rows}

        def canon_depart(raw):
            if not raw:
                return None
            if raw in dep_codes:
                return raw
            return dep_codes_no_us.get(raw.replace("_", ""))

        alines.append("INSERT INTO rm6 (poste_source, depart, x, y, label_detecte, commande, a_verifier) VALUES")
        alines.append(",\n".join(
            f"  ({sql_str(r['poste_source'])}, {sql_str(canon_depart(r['depart']))}, "
            f"{sql_num(r['x'])}, {sql_num(r['y'])}, {sql_str(r['label_proche'])}, "
            f"{sql_str(r['commande_detectee'])}, {sql_bool(r['_a_verifier'])})" for r in rm6
        ) + ";\n")
    (OUT / "030_assets.sql").write_text("\n".join(alines))

    # ---- 040_infodepart_enregistre.sql (temoin du bilan DWG, pour detection de derive) ----
    infodepart = json.loads((EXTRACTED / "infodepart.json").read_text())
    if infodepart:
        ilines = ["-- Genere depuis data/extracted/infodepart.json (bloc INFODEPART / bilan des",
                   "-- puissances installees, lu tel quel dans le DWG au 30/07/2025).", "",
                   "INSERT INTO infodepart_enregistre (poste_source, depart_brut, puissance_enregistree_kva) VALUES"]
        ilines.append(",\n".join(
            f"  ({sql_str(i['poste_source'])}, {sql_str(i['depart'])}, {sql_num(i['puissance_enregistree_kva'])})"
            for i in infodepart
        ) + ";\n")
        (OUT / "040_infodepart_enregistre.sql").write_text("\n".join(ilines))

    print("Fichiers SQL ecrits dans", OUT)
    for f in sorted(OUT.glob("*.sql")):
        print(" -", f.name, f"({f.stat().st_size/1024:.1f} Ko)")


if __name__ == "__main__":
    main()
