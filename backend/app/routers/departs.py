from typing import Optional

from fastapi import APIRouter

from app.db.pool import fetch_all

router = APIRouter()


@router.get("")
async def list_departs(poste_source: Optional[str] = None):
    query = "SELECT * FROM v_cumul_depart"
    params = ()
    if poste_source:
        query += " WHERE poste_source = %s"
        params = (poste_source,)
    query += " ORDER BY puissance_kva DESC;"
    return await fetch_all(query, params)


@router.get("/derive")
async def derive(poste_source: Optional[str] = None):
    """Compare le cumul recalcule au bloc BILAN DES PUISSANCES enregistre dans le DWG."""
    query = "SELECT * FROM v_depart_drift"
    params = ()
    if poste_source:
        query += " WHERE poste_source = %s"
        params = (poste_source,)
    query += " ORDER BY abs(coalesce(delta_kva,0)) DESC;"
    return await fetch_all(query, params)
