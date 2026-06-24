from fastapi import APIRouter

from app.db.pool import fetch_all

router = APIRouter()


@router.get("")
async def list_postes_source():
    """Les 3 postes source + leurs KPI agreges (carte d'entree de l'appli)."""
    return await fetch_all("SELECT * FROM v_kpi_poste_source ORDER BY poste_source;")
