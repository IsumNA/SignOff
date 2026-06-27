"""SignOff backend — configuration and client initialization.

Centralizes environment loading and lazily-initialized singleton clients for:
  * Vertex AI (Gemini 2.5 Flash) — core reasoning model
  * Firestore — session state & audit trail
  * Neo4j (async driver) — precedent / citation graph

Clients are created lazily and cached so the same connection pool is reused
across requests, and so importing this module never forces a network call.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env locations independent of the current working directory, so the
# backend picks up config whether it's launched from backend/ or the repo root,
# and whether the .env lives alongside the code or at the monorepo root.
_BACKEND_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _BACKEND_DIR.parent
_ENV_FILES = (_REPO_ROOT / ".env", _BACKEND_DIR / ".env")

# Populate os.environ too (Google client libraries read it directly, e.g.
# GOOGLE_APPLICATION_CREDENTIALS). Backend/.env wins over the repo-root one.
for _env_path in _ENV_FILES:
    if _env_path.exists():
        load_dotenv(_env_path, override=True)

logger = logging.getLogger("signoff.config")


class Settings(BaseSettings):
    """Strongly-typed application settings sourced from the environment / .env."""

    model_config = SettingsConfigDict(
        env_file=_ENV_FILES, env_file_encoding="utf-8", extra="ignore"
    )

    # --- Google Cloud / Vertex AI ---
    gcp_project_id: str = "your-gcp-project-id"
    gcp_location: str = "us-central1"
    vertex_model: str = "gemini-2.5-flash"

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

    # --- NVIDIA NIM / Nemotron (High-Security Risk Agent) ---
    # Defaults target NVIDIA's hosted, OpenAI-compatible API. Point NIM_BASE_URL
    # at a self-hosted NIM container for true on-prem processing.
    nim_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_api_key: str = ""
    nim_model: str = "nvidia/llama-3.1-nemotron-70b-instruct"
    nim_mock: bool = False

    # --- CORS ---
    # Lovable's dev server defaults to :8080; Vite's default is :5173. Both
    # (plus an :8081 fallback) are allowed so local dev works out of the box.
    cors_allow_origins: str = (
        "http://localhost:8080,http://localhost:8081,"
        "http://localhost:5173,http://localhost:3000"
    )

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse the comma-separated CORS origins into a clean list."""
        return [o.strip() for o in self.cors_allow_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


# ---------------------------------------------------------------------------
# Integration status — drives the frontend "live vs demo" indicator and lets
# the mesh gracefully fall back to a deterministic demo when creds are absent.
# ---------------------------------------------------------------------------
_PLACEHOLDER_TOKENS = ("your-", "changeme", "")


def _looks_configured(value: str) -> bool:
    v = (value or "").strip().lower()
    return bool(v) and not any(v.startswith(p) for p in _PLACEHOLDER_TOKENS if p)


@lru_cache(maxsize=1)
def _adc_available() -> bool:
    """True when Application Default Credentials resolve.

    Covers ``gcloud auth application-default login`` (local),
    ``GOOGLE_APPLICATION_CREDENTIALS``, and the Cloud Run metadata server.
    Cached for the process lifetime — run the ADC login then restart the
    backend to pick up newly-granted credentials.
    """
    try:
        import google.auth

        creds, _ = google.auth.default()
        return creds is not None
    except Exception:  # noqa: BLE001 — no credentials available
        logger.info("No Application Default Credentials found; GCP runs in demo mode")
        return False


def vertex_is_live() -> bool:
    """True when Vertex AI has a real project *and* usable credentials.

    Requiring credentials (not just a project id) keeps the UI fast and honest:
    without ADC the mesh stays in deterministic demo mode instead of hanging on
    a doomed live call.
    """
    return _looks_configured(get_settings().gcp_project_id) and _adc_available()


def neo4j_is_live() -> bool:
    """True when Neo4j points at a non-local instance with a real password."""
    s = get_settings()
    return (
        _looks_configured(s.neo4j_uri)
        and "localhost" not in s.neo4j_uri
        and _looks_configured(s.neo4j_password)
        and s.neo4j_password != "neo4j"
    )


def perplexity_is_live() -> bool:
    """True when a Perplexity API key is configured."""
    return _looks_configured(get_settings().perplexity_api_key)


def nim_is_live() -> bool:
    """True when the NIM/Nemotron agent has a usable API key and isn't forced to mock."""
    s = get_settings()
    return _looks_configured(s.nvidia_api_key) and not s.nim_mock


def firestore_is_live() -> bool:
    """True when Firestore has a real project to write the audit trail to."""
    return vertex_is_live()


def integration_status() -> dict:
    """Map of integration -> 'live' | 'demo' for the health endpoint."""

    def mode(flag: bool) -> str:
        return "live" if flag else "demo"

    return {
        "vertex_ai": mode(vertex_is_live()),
        "nvidia_nim": mode(nim_is_live()),
        "neo4j": mode(neo4j_is_live()),
        "perplexity": mode(perplexity_is_live()),
        "firestore": mode(firestore_is_live()),
    }


# ---------------------------------------------------------------------------
# Vertex AI (Gemini 2.5 Flash)
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
    """Return a cached Gemini 2.5 Flash generative model handle.

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
