"""SignOff backend — configuration and client initialization.

Centralizes environment loading and lazily-initialized singleton clients for:
  * Vertex AI (Gemini 1.5 Pro) — core reasoning model
  * Firestore — session state & audit trail
  * Neo4j (async driver) — precedent / citation graph

Clients are created lazily and cached so the same connection pool is reused
across requests, and so importing this module never forces a network call.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import List

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()

logger = logging.getLogger("signoff.config")


class Settings(BaseSettings):
    """Strongly-typed application settings sourced from the environment / .env."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- Google Cloud / Vertex AI ---
    gcp_project_id: str = "your-gcp-project-id"
    gcp_location: str = "us-central1"
    vertex_model: str = "gemini-1.5-pro"

    # --- Firestore ---
    firestore_database: str = "(default)"
    firestore_audit_collection: str = "mesh_audit_trail"

    # --- Neo4j ---
    neo4j_uri: str = "neo4j://localhost:7687"
    neo4j_username: str = "neo4j"
    neo4j_password: str = "neo4j"
    neo4j_database: str = "neo4j"

    # --- Perplexity AI ---
    perplexity_api_key: str = ""
    perplexity_model: str = "sonar-reasoning"
    perplexity_base_url: str = "https://api.perplexity.ai"

    # --- NVIDIA NIM (High-Security Risk Agent) ---
    nim_base_url: str = "http://localhost:8000"
    nim_mock: bool = True

    # --- CORS ---
    cors_allow_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse the comma-separated CORS origins into a clean list."""
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


# ---------------------------------------------------------------------------
# Vertex AI (Gemini 1.5 Pro)
# ---------------------------------------------------------------------------
_vertex_initialized = False


def init_vertex() -> None:
    """Initialize the Vertex AI SDK exactly once for this process."""
    global _vertex_initialized
    if _vertex_initialized:
        return

    import vertexai

    settings = get_settings()
    vertexai.init(project=settings.gcp_project_id, location=settings.gcp_location)
    _vertex_initialized = True
    logger.info(
        "Vertex AI initialized (project=%s, location=%s, model=%s)",
        settings.gcp_project_id,
        settings.gcp_location,
        settings.vertex_model,
    )


@lru_cache(maxsize=1)
def get_gemini_model():
    """Return a cached Gemini 1.5 Pro generative model handle.

    Strict JSON output is enforced at the call site via per-request
    ``generation_config`` (see ``mesh.py``) so the same model handle can be
    reused for structured and free-form generations.
    """
    init_vertex()
    from vertexai.generative_models import GenerativeModel

    settings = get_settings()
    return GenerativeModel(settings.vertex_model)


# ---------------------------------------------------------------------------
# Firestore (State & Audit Trail)
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def get_firestore_client():
    """Return a cached async Firestore client.

    Uses Application Default Credentials (ADC). On Cloud Run this resolves to
    the runtime service account automatically; locally it uses
    ``GOOGLE_APPLICATION_CREDENTIALS``.
    """
    from google.cloud import firestore

    settings = get_settings()
    database = settings.firestore_database or "(default)"
    client = firestore.AsyncClient(
        project=settings.gcp_project_id, database=database
    )
    logger.info("Firestore async client created (database=%s)", database)
    return client


# ---------------------------------------------------------------------------
# Neo4j (Precedents / Citations Graph)
# ---------------------------------------------------------------------------
_neo4j_driver = None


def get_neo4j_driver():
    """Return a cached async Neo4j driver (lazily created).

    The driver manages its own connection pool and is safe to share across
    coroutines. Call :func:`close_neo4j_driver` on shutdown.
    """
    global _neo4j_driver
    if _neo4j_driver is None:
        from neo4j import AsyncGraphDatabase

        settings = get_settings()
        _neo4j_driver = AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_username, settings.neo4j_password),
        )
        logger.info("Neo4j async driver created (uri=%s)", settings.neo4j_uri)
    return _neo4j_driver


async def close_neo4j_driver() -> None:
    """Close the shared Neo4j driver if it was created."""
    global _neo4j_driver
    if _neo4j_driver is not None:
        await _neo4j_driver.close()
        _neo4j_driver = None
        logger.info("Neo4j async driver closed")
