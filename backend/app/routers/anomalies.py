from typing import Optional

from fastapi import APIRouter

from app.db.pool import fetch_all

router = APIRouter()


@router.get("")
async def list_anomalies(poste_source: Optional[str] = None):
    query = "SELECT * FROM v_anomalies"
    params = ()
    if poste_source:
        query += " WHERE poste_source = %s"
        params = (poste_source,)
    query += " ORDER BY niveau, poste_source;"
    return await fetch_all(query, params)


@router.get("/duplicates")
async def duplicates():
    """Vrais doublons de NUMERO au sein du meme poste source (erreur de saisie)."""
    return await fetch_all("SELECT * FROM v_anomalie_numero_duplique;")


@router.get("/jonctions")
async def jonctions():
    """Memes NUMERO sur 2 postes source differents : bouclage/jonction probable,
    a confirmer manuellement (pas une erreur automatique)."""
    return await fetch_all("SELECT * FROM v_jonction_inter_source_candidate;")
