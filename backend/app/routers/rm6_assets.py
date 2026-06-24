"""Routes pour les RM6, points d'ouverture, ILD, producteurs.
   + PUT /rm6/:id pour éditer un RM6 depuis le schéma.
   + POST /postes/reorder pour réagencer l'ordre des postes.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db.pool import fetch_all, fetch_one, execute

router = APIRouter()


# ---- RM6 ----------------------------------------------------------------

class RM6Update(BaseModel):
    nom: Optional[str] = None
    depart: Optional[str] = None
    commande: Optional[str] = None
    etat: Optional[str] = None
    a_verifier: Optional[bool] = None


@router.get("/rm6")
async def list_rm6(poste_source: Optional[str] = None, search: Optional[str] = None):
    clauses, params = [], []
    if poste_source:
        clauses.append("poste_source = %s"); params.append(poste_source)
    if search:
        clauses.append("(nom ILIKE %s OR label_detecte ILIKE %s)")
        params += [f"%{search}%", f"%{search}%"]
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return await fetch_all(f"SELECT * FROM rm6 {where} ORDER BY depart, x;", tuple(params))


@router.put("/rm6/{rm6_id}")
async def update_rm6(rm6_id: uuid.UUID, payload: RM6Update):
    existing = await fetch_one("SELECT id FROM rm6 WHERE id = %s;", (str(rm6_id),))
    if not existing:
        raise HTTPException(404, "RM6 introuvable")
    sets, vals = [], []
    for field in ["nom", "depart", "commande", "etat", "a_verifier"]:
        v = getattr(payload, field, None)
        if v is not None:
            sets.append(f"{field} = %s"); vals.append(v)
    if not sets:
        return existing
    vals.append(str(rm6_id))
    await execute(f"UPDATE rm6 SET {', '.join(sets)} WHERE id = %s;", tuple(vals))
    return await fetch_one("SELECT * FROM rm6 WHERE id = %s;", (str(rm6_id),))


# ---- Batch reorder postes -----------------------------------------------

class ReorderItem(BaseModel):
    id: str
    x: float

class ReorderPayload(BaseModel):
    items: list[ReorderItem]

@router.post("/postes/reorder")
async def reorder_postes(payload: ReorderPayload):
    """Met à jour les positions x de plusieurs postes d'un coup (réagencement)."""
    for item in payload.items:
        await execute("UPDATE poste SET x = %s WHERE id = %s;", (item.x, item.id))
    return {"updated": len(payload.items)}


# ---- Points d'ouverture -------------------------------------------------

@router.get("/points-ouverture")
async def list_points_ouverture(poste_source: Optional[str] = None):
    q = "SELECT * FROM point_ouverture"
    p = ()
    if poste_source: q += " WHERE poste_source = %s"; p = (poste_source,)
    return await fetch_all(q, p)


# ---- ILD -----------------------------------------------------------------

@router.get("/ild")
async def list_ild(poste_source: Optional[str] = None):
    q = "SELECT * FROM ild"
    p = ()
    if poste_source: q += " WHERE poste_source = %s"; p = (poste_source,)
    return await fetch_all(q, p)


# ---- Producteurs ---------------------------------------------------------

@router.get("/producteurs")
async def list_producteurs(poste_source: Optional[str] = None):
    q = "SELECT * FROM producteur"
    p = ()
    if poste_source: q += " WHERE poste_source = %s"; p = (poste_source,)
    return await fetch_all(q, p)
