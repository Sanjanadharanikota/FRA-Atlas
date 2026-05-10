import os
from typing import Any, Dict

from utils.runtime_utils import configure_runtime_noise

configure_runtime_noise()

import ee
from utils.env_utils import load_backend_env

load_backend_env()

_GEE_INIT_ERROR = None
_GEE_INITIALIZED = False

_PROXY_VARS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)


def _clear_broken_network_env() -> None:
    """Ignore known-bad local proxy/cert overrides that break GEE auth."""
    curl_ca_bundle = os.environ.get("CURL_CA_BUNDLE", "")
    if "PostgreSQL" in curl_ca_bundle and not os.path.exists(curl_ca_bundle):
        os.environ.pop("CURL_CA_BUNDLE", None)

    for var_name in _PROXY_VARS:
        if os.environ.get(var_name) == "http://127.0.0.1:9":
            os.environ.pop(var_name, None)


def get_gee_project() -> str | None:
    return (
        os.getenv("GEE_PROJECT_ID")
        or os.getenv("GOOGLE_CLOUD_PROJECT")
        or os.getenv("GCLOUD_PROJECT")
    )


def initialize_gee(force: bool = False) -> None:
    global _GEE_INITIALIZED, _GEE_INIT_ERROR

    if _GEE_INITIALIZED and not force:
        return

    _clear_broken_network_env()

    project_id = get_gee_project()
    if not project_id:
        _GEE_INITIALIZED = False
        _GEE_INIT_ERROR = (
            "Google Earth Engine project is not configured. "
            "Set GEE_PROJECT_ID in Backend/.env and run 'earthengine authenticate'."
        )
        raise RuntimeError(_GEE_INIT_ERROR)

    try:
        ee.Initialize(project=project_id)
        _GEE_INITIALIZED = True
        _GEE_INIT_ERROR = None
    except Exception as exc:
        _GEE_INITIALIZED = False
        _GEE_INIT_ERROR = str(exc)
        raise RuntimeError(f"Earth Engine initialization failed: {exc}") from exc


def get_gee_status() -> Dict[str, Any]:
    project_id = get_gee_project()
    status: Dict[str, Any] = {
        "configured_project": project_id,
        "initialized": False,
        "error": None,
    }

    try:
        initialize_gee(force=True)
        status["initialized"] = True
        status["ee_test_value"] = ee.Number(100).getInfo()
    except Exception as exc:
        status["error"] = str(exc)

    return status
