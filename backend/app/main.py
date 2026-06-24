from dotenv import load_dotenv
import os

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db.pool import pool
from app.routers import postes, departs, anomalies, poste_source, rm6_assets, topologie


@asynccontextmanager
async def lifespan(app: FastAPI):
    await pool.open(wait=True)
    yield
    await pool.close()


app = FastAPI(
    title="HTA Digital Twin API",
    description="API metier pour la gestion des schemas unifilaires HTA "
                "(SADA, LONGONI, KAWENI_BADAMIER) - Mayotte.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(poste_source.router, prefix="/api/postes-source", tags=["poste_source"])
app.include_router(postes.router, prefix="/api/postes", tags=["postes"])
app.include_router(departs.router, prefix="/api/departs", tags=["departs"])
app.include_router(anomalies.router, prefix="/api/anomalies", tags=["anomalies"])
app.include_router(rm6_assets.router, prefix="/api/actifs", tags=["actifs"])
app.include_router(topologie.router, prefix="/api/topologie", tags=["topologie"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}