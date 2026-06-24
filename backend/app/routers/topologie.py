"""
Route API pour la topologie des départs.
Sert les données de depart_topologie via la vue v_depart_topologie.
Retourne un tableau vide si la table/vue n'existe pas encore.
"""
from typing import Optional

from fastapi import APIRouter

from app.db.pool import fetch_all

router = APIRouter()


@router.get("")
async def list_topologie(poste_source: Optional[str] = None, depart: Optional[str] = None):
    """Topologie ordonnée des départs pour le SchemaView arborescent."""
    clauses, params = [], []
    if poste_source:
        clauses.append("poste_source = %s")
        params.append(poste_source)
    if depart:
        clauses.append("depart = %s")
        params.append(depart)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    try:
        return await fetch_all(
            f"""
            SELECT * FROM v_depart_topologie
            {where}
            ORDER BY depart, niveau_branche, ordre_principal NULLS LAST, rang_branche NULLS LAST;
            """,
            tuple(params),
        )
    except Exception:
        # Table/vue pas encore créée → retour vide, le schéma utilise le fallback
        return []
