"""
Postgres connection pool (asyncpg) with pgvector codec registered.

We use asyncpg directly rather than an ORM. The schema is owned by Prisma
on the Node side; we only read/write rows here. SQL is hand-written, kept
small, and lives in app/store/*.
"""

from __future__ import annotations

import asyncpg
from pgvector.asyncpg import register_vector

from .config import get_settings
from .logging_setup import get_logger

log = get_logger("db")

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Per-connection setup: register the pgvector codec so vector columns
    round-trip as Python lists/numpy arrays."""
    await register_vector(conn)


async def init_pool() -> asyncpg.Pool:
    """Create the shared connection pool. Called once on app startup."""
    global _pool
    if _pool is not None:
        return _pool

    settings = get_settings()
    log.info("db.pool.init", dsn_host=_dsn_host(settings.database_url))
    _pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=1,
        max_size=10,
        # asyncpg infers SSL from sslmode in the DSN; the Prisma adapter on the
        # Node side also disables verification. Match that posture here.
        ssl="prefer",
        init=_init_connection,
    )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    """Accessor for handlers. init_pool() must have been awaited first."""
    if _pool is None:
        raise RuntimeError("db pool not initialized — call init_pool() first")
    return _pool


async def ping() -> bool:
    """Cheap health check."""
    try:
        async with get_pool().acquire() as conn:
            await conn.execute("SELECT 1")
        return True
    except Exception as exc:  # noqa: BLE001 — health checks intentionally broad
        log.warning("db.ping.failed", error=str(exc))
        return False


def _dsn_host(dsn: str) -> str:
    """Extract host from DSN for logging without leaking the password."""
    try:
        # postgres://user:pass@host:port/db → host:port
        without_scheme = dsn.split("://", 1)[1]
        after_creds = without_scheme.split("@", 1)[-1]
        return after_creds.split("/", 1)[0]
    except Exception:
        return "unknown"
