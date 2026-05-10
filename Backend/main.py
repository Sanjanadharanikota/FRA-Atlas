import asyncio
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from db import get_db_health, initialize_database
from routers.auth_router import router as auth_router
from routers.dss_router import router as dss_router
from routers.model_pred import router as model_pred
from routers.Search_router import router as Search
from routers.upload_router import router as upload_router
from settings import get_settings
from utils.api_utils import error_response, success_response
from utils.gee_utils import get_gee_status

settings = get_settings()
logger = logging.getLogger("fra_atlas")

app = FastAPI(title="FRA Atlas API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    initialize_database()


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content=error_response(str(exc.detail)))


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception):
    logger.exception("Unhandled server error", exc_info=exc)
    return JSONResponse(status_code=500, content=error_response("Internal server error"))


app.include_router(auth_router)
app.include_router(dss_router)
app.include_router(upload_router)
app.include_router(model_pred)
app.include_router(Search)


@app.get("/health/live")
def live_health():
    return success_response({"service": "fra-atlas-backend"}, message="Service is live")


@app.get("/health/ready")
def ready_health():
    db_status = get_db_health()
    gee_status = get_gee_status()
    ready = db_status.get("ok") and bool(settings.database_url)
    return success_response(
        {
            "database": db_status,
            "gee": gee_status,
            "dss_index_path": str(settings.dss_index_path),
            "dss_docs_dir": str(settings.dss_docs_dir),
        },
        message="Service is ready" if ready else "Service dependencies are degraded",
        status="ok" if ready else "degraded",
    )


@app.on_event("shutdown")
async def shutdown_event():
    try:
        await asyncio.sleep(0)
    except asyncio.CancelledError:
        pass
