#!/usr/bin/env python3
"""
extract.py - Extracteur DXF -> JSON pour le jumeau numerique HTA Mayotte.

Contexte (verifie empiriquement sur les 3 DXF reels fournis le 30/07/2025):
- Chaque poste HTA/BT est un bloc INSERT dont le NOM commence par "POSTE..."
  (POSTECAB_DP, POSTECAB_AB, POSTECBS_DP, POSTECBS_AB, POSTEH61_DP,
   POSTELOCAL_AB, POSTELOCAL_DP, POSTEPVCR_AB, POSTESOCLE_DP).
  Ce nom de bloc encode directement REGIME (DP/AB) + FAMILLE (CAB/CBS/H61/...).
- Chaque INSERT porte des ATTRIB exploitables: NOM, NUMERO, PUISSANCE, DEPART, AUTRE.
- Le calque (layer) du bloc poste est toujours "<DEPART>_POSTE" -> recoupement
  fiable avec l'attribut DEPART (sert a detecter les DEPART mal saisis).
- Les autres actifs (ILD, points d'ouverture, producteurs PV, drapeaux MHRV,
  cadenas d'exploitation) sont des blocs SANS attributs : leur sens vient
  uniquement de leur layer + position. Cf. extract_assets() ci-dessous.
- Les RM6 ne sont PAS des blocs : ce sont des polylignes groupees sur un layer
  "<DEPART>_RM6". On les regroupe par clustering spatial (seuil ~80 unites
  dessin = taille du symbole) puis on rattache le texte le plus proche
  (souvent un identifiant de cellule type "11CRT", ou un code de commande
  "R"=radio-commande / "T"=telecommande RTC, cf legende).

Usage:
    python3 extract.py --dxf-dir /chemin/vers/dxf --out /chemin/vers/data/extracted
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path
from collections import defaultdict

import ezdxf

# ----------------------------------------------------------------------------
# Referentiel poste source <-> fichier DXF
# ----------------------------------------------------------------------------
DXF_TO_POSTE_SOURCE = {
    "SCHEMA_POSTE_SOURCE_SADA_30072025.dxf": "SADA",
    "SCHEMA_POSTE_SOURCE_LONGONI_30072025.dxf": "LONGONI",
    "SCHEMA_POSTE_SOURCE_KAWENI_BADAMIER_30072025.dxf": "KAWENI_BADAMIER",
}

POSTE_BLOCK_PREFIX = "POSTE"

ASSET_BLOCKS = {
    "ILD_SOUT": "ild",
    "ILD_SOUT_HS": "ild",          # variante "hors service / defaut"
    "COUPURE": "point_ouverture",
    "Drapeau_MHRV": "client_mhrv",
    "Prod_Photo": "producteur_pv",
    "CADENAS_EXPLOITATION": "cadenas_exploitation",
}

RM6_LAYER_SUFFIX = "_RM6"
RM6_CLUSTER_DIST = 80.0      # unites dessin: distance max entre segments d'un meme symbole
RM6_LABEL_MAX_DIST = 600.0   # distance max pour rattacher un texte au symbole

NUM_RE = re.compile(r"^[-+]?\d+(\.\d+)?")
CLIENT_RE = re.compile(r"Nbr\s*Client\s*:\s*(\d+)", re.I)


def val_like(txt):
    """Reproduit Val() de VBA: lit le nombre en tete de chaine."""
    m = NUM_RE.match(str(txt or "").strip())
    return float(m.group(0)) if m else 0.0


def extract_clients(txt):
    m = CLIENT_RE.search(str(txt or ""))
    return int(m.group(1)) if m else None


def normalize_depart(raw):
    return re.sub(r"\s+", "", str(raw or "").upper().strip())


def layer_base_depart(layer_name, suffix):
    if layer_name.endswith(suffix):
        return layer_name[: -len(suffix)]
    return None


def cluster_points(points, max_dist):
    """Clustering simple par distance (union-find), suffisant pour ~10 pts/symbole."""
    n = len(points)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(n):
        for j in range(i + 1, n):
            dx = points[i][0] - points[j][0]
            dy = points[i][1] - points[j][1]
            if dx * dx + dy * dy <= max_dist * max_dist:
                union(i, j)

    clusters = defaultdict(list)
    for i in range(n):
        clusters[find(i)].append(points[i])
    return list(clusters.values())


def extract_postes(doc, poste_source):
    msp = doc.modelspace()
    postes = []
    seen_layers_mismatch = []

    for e in msp.query("INSERT"):
        block_name = e.dxf.name
        if not block_name.upper().startswith(POSTE_BLOCK_PREFIX):
            continue
        attribs = {a.dxf.tag: a.dxf.text for a in e.attribs}
        if not attribs:
            continue  # bloc poste "fantome" sans attributs (rare, ex: bloc de legende)
        numero_raw = (attribs.get("NUMERO") or "").strip()
        nom_raw = (attribs.get("NOM") or "").strip()
        depart_raw = (attribs.get("DEPART") or "").strip()
        if not numero_raw and not nom_raw and not depart_raw:
            # symbole de legende (planche "Poste dans LOCAL / SOCLE / Prod PVCR")
            # repere empiriquement: toujours regroupe loin du reseau reel, attributs
            # tous vides. On l'exclut pour ne pas polluer le jeu de donnees metier.
            continue

        depart_attr = normalize_depart(attribs.get("DEPART", ""))
        layer = e.dxf.layer
        depart_layer = layer_base_depart(layer, "_POSTE")
        if depart_layer and normalize_depart(depart_layer) != depart_attr:
            seen_layers_mismatch.append(
                {"numero": attribs.get("NUMERO"), "depart_attribut": depart_attr,
                 "depart_layer": depart_layer, "layer": layer}
            )

        puissance_txt = attribs.get("PUISSANCE", "")
        autre = attribs.get("AUTRE", "")

        postes.append({
            "poste_source": poste_source,
            "numero": (attribs.get("NUMERO") or "").strip(),
            "nom": (attribs.get("NOM") or "").strip(),
            "type_bloc": block_name.upper(),
            "depart_brut": attribs.get("DEPART", ""),
            "depart": depart_attr,
            "puissance_txt": puissance_txt,
            "puissance_kva": val_like(puissance_txt),
            "nb_clients": extract_clients(autre),
            "autre": autre,
            "x": round(float(e.dxf.insert.x), 3),
            "y": round(float(e.dxf.insert.y), 3),
            "rotation_deg": round(float(e.dxf.rotation or 0), 2),
            "layer": layer,
        })

    return postes, seen_layers_mismatch


def extract_assets(doc, poste_source):
    msp = doc.modelspace()
    assets = []
    for e in msp.query("INSERT"):
        kind = ASSET_BLOCKS.get(e.dxf.name)
        if not kind:
            continue
        assets.append({
            "poste_source": poste_source,
            "kind": kind,
            "block_name": e.dxf.name,
            "layer": e.dxf.layer,
            "x": round(float(e.dxf.insert.x), 3),
            "y": round(float(e.dxf.insert.y), 3),
            "rotation_deg": round(float(e.dxf.rotation or 0), 2),
            "etat_suspecte": "HS" if e.dxf.name.endswith("_HS") else None,
        })
    return assets


def extract_depart_totals(doc, poste_source):
    """Bloc INFODEPART : DEPART + PUISSANCE enregistree historiquement dans le DWG.
    Sert de valeur de reference pour detecter une derive entre schema et terrain."""
    msp = doc.modelspace()
    out = []
    for e in msp.query("INSERT"):
        if e.dxf.name != "INFODEPART":
            continue
        attribs = {a.dxf.tag: a.dxf.text for a in e.attribs}
        if not attribs:
            continue
        out.append({
            "poste_source": poste_source,
            "depart": normalize_depart(attribs.get("DEPART", "")),
            "puissance_enregistree_kva": val_like(attribs.get("PUISSANCE", "")),
        })
    return out


def nearest_text(msp, cx, cy, max_dist):
    best, best_d = None, max_dist
    for t in msp.query("TEXT MTEXT"):
        tx, ty = t.dxf.insert.x, t.dxf.insert.y
        d = math.hypot(tx - cx, ty - cy)
        if d < best_d:
            txt = t.dxf.text if t.dxftype() == "TEXT" else t.text
            best, best_d = (txt, round(d, 1)), d
    return best


def extract_rm6(doc, poste_source):
    msp = doc.modelspace()
    layers = sorted({e.dxf.layer for e in msp if e.dxf.layer.endswith(RM6_LAYER_SUFFIX)})
    out = []
    for layer in layers:
        depart = layer_base_depart(layer, RM6_LAYER_SUFFIX)
        pts = []
        for e in msp.query("LWPOLYLINE LINE"):
            if e.dxf.layer != layer:
                continue
            if e.dxftype() == "LWPOLYLINE":
                xy = list(e.get_points("xy"))
            else:
                xy = [(e.dxf.start.x, e.dxf.start.y), (e.dxf.end.x, e.dxf.end.y)]
            pts.extend(xy)
        if not pts:
            continue
        for cluster in cluster_points(pts, RM6_CLUSTER_DIST):
            cx = sum(p[0] for p in cluster) / len(cluster)
            cy = sum(p[1] for p in cluster) / len(cluster)
            label = nearest_text(msp, cx, cy, RM6_LABEL_MAX_DIST)
            out.append({
                "poste_source": poste_source,
                "depart": normalize_depart(depart) if depart else None,
                "x": round(cx, 3),
                "y": round(cy, 3),
                "label_proche": label[0] if label else None,
                "label_distance": label[1] if label else None,
                "commande_detectee": label[0] if label and label[0] in ("R", "T") else None,
                "_a_verifier": label is None or label[1] > 200,
            })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dxf-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    dxf_dir = Path(args.dxf_dir)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    all_postes, all_assets, all_rm6, all_infodepart, all_mismatch = [], [], [], [], []

    for fname, poste_source in DXF_TO_POSTE_SOURCE.items():
        path = dxf_dir / fname
        if not path.exists():
            print(f"[!] introuvable: {path}", file=sys.stderr)
            continue
        print(f"--- lecture {fname} ({poste_source}) ---")
        doc = ezdxf.readfile(str(path))

        postes, mismatch = extract_postes(doc, poste_source)
        assets = extract_assets(doc, poste_source)
        rm6 = extract_rm6(doc, poste_source)
        infodepart = extract_depart_totals(doc, poste_source)

        print(f"    postes extraits      : {len(postes)}")
        print(f"    actifs (ILD/PO/PV/..): {len(assets)}")
        print(f"    symboles RM6 detectes: {len(rm6)}")
        print(f"    departs DEPART<>LAYER mismatch: {len(mismatch)}")

        all_postes += postes
        all_assets += assets
        all_rm6 += rm6
        all_infodepart += infodepart
        all_mismatch += mismatch

    (out_dir / "postes.json").write_text(json.dumps(all_postes, ensure_ascii=False, indent=2))
    (out_dir / "assets.json").write_text(json.dumps(all_assets, ensure_ascii=False, indent=2))
    (out_dir / "rm6.json").write_text(json.dumps(all_rm6, ensure_ascii=False, indent=2))
    (out_dir / "infodepart.json").write_text(json.dumps(all_infodepart, ensure_ascii=False, indent=2))
    (out_dir / "depart_layer_mismatch.json").write_text(json.dumps(all_mismatch, ensure_ascii=False, indent=2))

    print("\n=== TOTAL ===")
    print("postes:", len(all_postes), "| actifs:", len(all_assets), "| rm6:", len(all_rm6))
    print(f"Fichiers ecrits dans {out_dir}/")


if __name__ == "__main__":
    main()
