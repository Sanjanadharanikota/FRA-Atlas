from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import os

from utils.env_utils import load_backend_env

load_backend_env()


def _split_csv(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    backend_root: Path
    app_env: str
    debug: bool
    database_url: str
    gemini_api_key: str | None
    gee_project_id: str | None
    jwt_secret: str
    jwt_algorithm: str
    jwt_exp_minutes: int
    cors_origins: list[str]
    dss_docs_dir: Path
    dss_index_path: Path
    bootstrap_admin_email: str
    bootstrap_admin_password: str


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    backend_root = Path(__file__).resolve().parent
    data_dir = backend_root / "data"
    return Settings(
        backend_root=backend_root,
        app_env=os.getenv("APP_ENV", "development"),
        debug=os.getenv("DEBUG", "false").lower() == "true",
        database_url=os.getenv("DATABASE_URL", ""),
        gemini_api_key=os.getenv("GEMINI_API_KEY"),
        gee_project_id=os.getenv("GEE_PROJECT_ID"),
        jwt_secret=os.getenv("JWT_SECRET", "change-me-production-secret"),
        jwt_algorithm="HS256",
        jwt_exp_minutes=int(os.getenv("JWT_EXP_MINUTES", "120")),
        cors_origins=_split_csv(
            os.getenv("CORS_ORIGINS"),
            ["http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:5173", "http://127.0.0.1:5173"],
        ),
        dss_docs_dir=data_dir / "dss_docs",
        dss_index_path=data_dir / "dss_index.json",
        bootstrap_admin_email=os.getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@fra-atlas.local"),
        bootstrap_admin_password=os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "Admin@12345"),
    )
