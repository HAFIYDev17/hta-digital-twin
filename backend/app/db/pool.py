"""
Pool de connexions Postgres (Neon) - psycopg3, requetes SQL brutes.

On utilise volontairement du SQL brut parametre (pas d'ORM) : la base est
deja le "moteur metier" (fonctions val_like/extract_clients, vues d'anomalies,
triggers de cache). Le backend ne fait qu'orchestrer ces requetes pour le front.
"""
import os
from contextlib import asynccontextmanager

from psycopg_pool import AsyncConnectionPool
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL manquant. Copiez backend/.env.example vers backend/.env "
        "et collez la chaine de connexion Neon (Dashboard Neon -> Connect -> "
        "'Pooled connection', avec ?sslmode=require)."
    )

pool = AsyncConnectionPool(
    conninfo=DATABASE_URL,
    min_size=1,
    max_size=10,
    kwargs={"row_factory": dict_row},
    open=False,
)


@asynccontextmanager
async def lifespan_pool():
    await pool.open(wait=True)
    try:
        yield
    finally:
        await pool.close()


async def fetch_all(query: str, params: tuple = ()):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, params)
            return await cur.fetchall()


async def fetch_one(query: str, params: tuple = ()):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, params)
            return await cur.fetchone()


async def execute(query: str, params: tuple = ()):
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, params)
            await conn.commit()
            try:
                return await cur.fetchall()
            except Exception:
                return None
