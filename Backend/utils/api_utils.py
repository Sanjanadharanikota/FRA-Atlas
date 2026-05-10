from typing import Any


def success_response(
    data: Any = None,
    message: str = "ok",
    *,
    status: str = "ok",
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"status": status, "message": message, "data": data}
    if meta is not None:
        payload["meta"] = meta
    return payload


def error_response(
    message: str,
    *,
    status: str = "error",
    errors: list[dict[str, Any]] | None = None,
    data: Any = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"status": status, "message": message, "data": data}
    if errors is not None:
        payload["errors"] = errors
    return payload
