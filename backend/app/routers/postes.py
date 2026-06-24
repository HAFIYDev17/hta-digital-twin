"""
Routes CRUD pour les postes HTA.

Table poste (colonnes existantes + migration v2) :
  Base : poste_source, numero, nom, type_bloc, regime, depart, depart_brut,
         puissance_txt, autre, x, y, lat, lng, producteur, client_mhrv, commentaire
  Migration v2 : antenne_de, commune, omt

ILD : table séparée `ild` (jointure en lecture, upsert séparé en écriture).
"""
import uuid
import traceback
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db.pool import fetch_all, fetch_one, execute

router = APIRouter()


class PosteIn(BaseModel):
    poste_source: str
    numero: Optional[str] = None
    nom: Optional[str] = None
    type_bloc: str = "POSTECAB_AB"
    depart: Optional[str] = None
    puissance_txt: Optional[str] = ""
    autre: Optional[str] = ""
    x: Optional[float] = 0
    y: Optional[float] = 0
    lat: Optional[float] = None
    lng: Optional[float] = None
    producteur: Optional[bool] = False
    client_mhrv: Optional[bool] = False
    commentaire: Optional[str] = None
    # Migration v2
    antenne_de: Optional[str] = None
    commune: Optional[str] = None
    omt: Optional[bool] = False
    # ILD (table séparée - traité après le save poste)
    ild: Optional[bool] = None
    ild_etat: Optional[str] = None


# ------------- Colonnes -------------------------------------------------

_BASE_COLS = [
    "poste_source", "numero", "nom", "type_bloc", "depart", "depart_brut",
    "puissance_txt", "autre", "x", "y", "lat", "lng",
    "producteur", "client_mhrv", "commentaire",
]
_EXTENDED_COLS = ["antenne_de", "commune", "omt"]

_SELECT = """
    SELECT p.*,
           rd.libelle  AS depart_libelle,
           rd.couleur  AS depart_couleur,
           (i.id IS NOT NULL) AS ild,
           i.etat             AS ild_etat,
           i.id               AS ild_id
    FROM poste p
    LEFT JOIN referentiel_depart rd ON rd.code = p.depart AND rd.poste_source = p.poste_source
    LEFT JOIN LATERAL (
        SELECT id, etat FROM ild WHERE ild.poste_id = p.id LIMIT 1
    ) i ON true
"""


def _col_value(payload: PosteIn, col: str):
    if col == "depart_brut":
        return payload.depart
    if col == "antenne_de":
        return str(payload.antenne_de) if payload.antenne_de else None
    return getattr(payload, col, None)


async def _do_write(mode: str, payload: PosteIn, poste_id: uuid.UUID = None):
    cols = _BASE_COLS + _EXTENDED_COLS
    for attempt in range(2):
        if mode == "insert":
            query = f"INSERT INTO poste ({', '.join(cols)}) VALUES ({', '.join(['%s']*len(cols))}) RETURNING id;"
        else:
            query = f"UPDATE poste SET {', '.join(f'{c} = %s' for c in cols)} WHERE id = %s RETURNING id;"

        vals = tuple(_col_value(payload, c) for c in cols)
        if mode == "update":
            vals += (str(poste_id),)

        try:
            rows = await execute(query, vals)
            new_id = rows[0]["id"] if rows and rows[0] else (str(poste_id) if poste_id else None)

            # --- Gérer l'ILD (table séparée) ---
            if new_id:
                await _sync_ild(str(new_id), payload)
                await _sync_omt(str(new_id), payload)

            # Relire le poste complet
            if new_id:
                row = await fetch_one(f"{_SELECT} WHERE p.id = %s;", (str(new_id),))
                if row:
                    return row
            return {"ok": True, "id": str(new_id)}
        except Exception as exc:
            msg = str(exc).lower()
            if "column" in msg and ("does not exist" in msg or "unknown" in msg) and attempt == 0:
                cols = _BASE_COLS
                continue
            raise
    raise HTTPException(500, f"Échec {mode} après fallback colonnes")


async def _sync_ild(poste_id: str, payload: PosteIn):
    """Synchronise la table ild avec ce que le formulaire envoie."""
    if payload.ild is None:
        return  # Le front n'a pas touché au champ ILD

    try:
        existing = await fetch_one("SELECT id, etat FROM ild WHERE poste_id = %s;", (poste_id,))

        if payload.ild:
            etat = payload.ild_etat or "A_VERIFIER"
            etat_map = {"fonctionnel": "EN_SERVICE", "en_panne": "HORS_SERVICE", "a_controler": "A_VERIFIER"}
            etat = etat_map.get(etat.lower(), etat.upper())

            if existing:
                await execute("UPDATE ild SET etat = %s WHERE id = %s;", (etat, str(existing["id"])))
            else:
                poste = await fetch_one("SELECT poste_source, x, y FROM poste WHERE id = %s;", (poste_id,))
                if poste:
                    await execute(
                        "INSERT INTO ild (poste_source, poste_id, x, y, etat) VALUES (%s, %s, %s, %s, %s);",
                        (poste["poste_source"], poste_id, poste.get("x"), poste.get("y"), etat)
                    )
        else:
            if existing:
                await execute("DELETE FROM ild WHERE poste_id = %s;", (poste_id,))
    except Exception as exc:
        print(f"[WARN] _sync_ild skipped: {exc}")


async def _sync_omt(poste_id: str, payload: PosteIn):
    """Synchronise la table omt (organe de manœuvre télécommandé) avec la case
    du formulaire. Silencieux si la table omt n'existe pas encore.
    """
    if payload.omt is None:
        return

    try:
        existing = await fetch_one("SELECT id FROM omt WHERE poste_id = %s;", (poste_id,))

        if payload.omt:
            if not existing:
                poste = await fetch_one(
                    "SELECT poste_source, depart FROM poste WHERE id = %s;", (poste_id,)
                )
                if poste:
                    await execute(
                        "INSERT INTO omt (poste_source, poste_id, depart) VALUES (%s, %s, %s);",
                        (poste["poste_source"], poste_id, poste.get("depart")),
                    )
        else:
            if existing:
                await execute("DELETE FROM omt WHERE poste_id = %s;", (poste_id,))
    except Exception as exc:
        # Table omt pas encore créée → on log et on continue
        print(f"[WARN] _sync_omt skipped: {exc}")


# ------------- Routes ---------------------------------------------------

@router.get("")
async def list_postes(poste_source: Optional[str] = None, depart: Optional[str] = None,
                       search: Optional[str] = None):
    clauses, params = [], []
    if poste_source:
        clauses.append("p.poste_source = %s"); params.append(poste_source)
    if depart:
        clauses.append("p.depart = %s"); params.append(depart)
    if search:
        clauses.append("(p.nom ILIKE %s OR p.numero ILIKE %s)")
        params += [f"%{search}%", f"%{search}%"]
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return await fetch_all(f"{_SELECT} {where} ORDER BY p.depart, p.x;", tuple(params))


@router.get("/{poste_id}")
async def get_poste(poste_id: uuid.UUID):
    row = await fetch_one(f"{_SELECT} WHERE p.id = %s;", (str(poste_id),))
    if not row:
        raise HTTPException(404, "Poste introuvable")
    return row


@router.post("", status_code=201)
async def create_poste(payload: PosteIn):
    try:
        return await _do_write("insert", payload)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, detail=f"Erreur INSERT : {exc}")


@router.put("/{poste_id}")
async def update_poste(poste_id: uuid.UUID, payload: PosteIn):
    existing = await fetch_one("SELECT id FROM poste WHERE id = %s;", (str(poste_id),))
    if not existing:
        raise HTTPException(404, "Poste introuvable")
    try:
        return await _do_write("update", payload, poste_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, detail=f"Erreur UPDATE poste {poste_id} : {exc}")


@router.delete("/{poste_id}", status_code=204)
async def delete_poste(poste_id: uuid.UUID):
    await execute("DELETE FROM ild WHERE poste_id = %s;", (str(poste_id),))
    await execute("DELETE FROM poste WHERE id = %s;", (str(poste_id),))
