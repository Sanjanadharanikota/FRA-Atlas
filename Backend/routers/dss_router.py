from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from db import insert_scheme, get_scheme_by_name, fetch_schemes, list_dss_documents
from services.scheme_service import find_eligible_people_by_scheme
from services.rag_service import (
    get_available_applicants,
    ingest_uploaded_pdf,
    run_applicant_dss_query,
    run_hybrid_dss_query,
)
from utils.llm_utils import parse_dss_query  # your LLM query parser
from utils.api_utils import success_response
from utils.auth_utils import require_roles

router = APIRouter(prefix="/dss", tags=["dss"])


class AssistantQueryPayload(BaseModel):
    query: str
    village: str | None = None
    district: str | None = None
    state: str | None = None
    top_k: int = 4


class ApplicantRecommendationPayload(BaseModel):
    note: str | None = None
    top_k: int = 6


@router.post("/schemes")
def create_scheme(payload: dict, _: dict = Depends(require_roles("admin"))):
    name = payload.get("name")
    eligibility = payload.get("eligibility")
    if not name or not eligibility:
        raise HTTPException(status_code=400, detail="name and eligibility required")

    scheme_id = insert_scheme(name, payload.get("description", ""), eligibility)
    return success_response({"id": scheme_id, "name": name}, message="Scheme saved successfully")


@router.get("/schemes")
def list_schemes(_: dict = Depends(require_roles("admin", "analyst"))):
    return success_response(fetch_schemes(), message="Schemes fetched successfully")


@router.get("/documents")
def get_dss_documents(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), _: dict = Depends(require_roles("admin", "analyst"))):
    documents, total = list_dss_documents(page=page, page_size=page_size)
    return success_response(documents, message="DSS documents fetched successfully", meta={"page": page, "page_size": page_size, "total": total})


@router.get("/applicants")
def get_applicants(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    search: str | None = Query(None),
    _: dict = Depends(require_roles("admin", "analyst")),
):
    applicants, total = get_available_applicants(page=page, page_size=page_size, search=search)
    return success_response(applicants, message="Applicants fetched successfully", meta={"page": page, "page_size": page_size, "total": total})


@router.post("/documents")
async def upload_dss_documents(files: list[UploadFile] = File(...), _: dict = Depends(require_roles("admin"))):
    if not files:
        raise HTTPException(status_code=400, detail="At least one PDF is required.")

    results = []
    for file in files:
        filename = file.filename or "document.pdf"
        if not filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"{file.filename} is not a PDF.")
        file_bytes = await file.read()
        results.append(ingest_uploaded_pdf(filename, file_bytes))

    return success_response(results, message="DSS documents uploaded successfully")


@router.post("/assistant")
def dss_assistant(payload: AssistantQueryPayload, _: dict = Depends(require_roles("admin", "analyst"))):
    return success_response(run_hybrid_dss_query(
        query=payload.query,
        village=payload.village,
        district=payload.district,
        state=payload.state,
        top_k=payload.top_k,
    ), message="DSS recommendation generated successfully")


@router.post("/applicants/{applicant_id}/recommendations")
def dss_applicant_recommendations(applicant_id: int, payload: ApplicantRecommendationPayload | None = None, _: dict = Depends(require_roles("admin", "analyst"))):
    response = run_applicant_dss_query(
        applicant_id=applicant_id,
        extra_prompt=payload.note if payload else None,
        top_k=payload.top_k if payload else 6,
    )
    if response.get("status") == "error":
        raise HTTPException(status_code=404, detail=response.get("message"))
    return success_response(response, message="Applicant recommendation generated successfully")


@router.get("/check")
def dss_check(q: str = Query(..., description="Natural language query"), _: dict = Depends(require_roles("admin", "analyst"))):
    parsed = parse_dss_query(q)

    scheme_name = parsed.get("scheme")
    village = parsed.get("village")
    district = parsed.get("district")
    state = parsed.get("state")

    if not scheme_name:
        raise HTTPException(status_code=400, detail="Could not extract scheme name from query")

    scheme = get_scheme_by_name(scheme_name)
    if not scheme:
        raise HTTPException(status_code=404, detail=f"Scheme '{scheme_name}' not found")

    try:
        results = find_eligible_people_by_scheme(
            scheme, village=village, district=district, state=state
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    return success_response(
        {"scheme": scheme_name, "filters": parsed, "count": len(results), "results": results[:5]},
        message="Eligibility check completed successfully",
    )
