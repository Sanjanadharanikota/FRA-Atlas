from typing import Optional

from fastapi import APIRouter, Depends, Query
import psycopg2

from db import get_db_connection
from utils.api_utils import success_response
from utils.auth_utils import require_roles

router = APIRouter(prefix="/search", tags=["Search"])


@router.get("/")
async def search_claims(
    q: Optional[str] = Query(None, description="General search query"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    _: dict = Depends(require_roles("admin", "analyst")),
):
    offset = (page - 1) * page_size
    base_query = "SELECT * FROM fra_documents WHERE 1=1"
    count_query = "SELECT COUNT(*) FROM fra_documents WHERE 1=1"
    params: list[object] = []

    if q:
        clause = """ AND (
            patta_holder_name ILIKE %s OR
            village_name ILIKE %s OR
            district ILIKE %s OR
            state ILIKE %s OR
            claim_id ILIKE %s
        )"""
        like_q = f"%{q}%"
        base_query += clause
        count_query += clause
        params += [like_q] * 5

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(count_query, tuple(params))
            total = cur.fetchone()[0]
            cur.execute(f"{base_query} ORDER BY created_at DESC LIMIT %s OFFSET %s", tuple(params + [page_size, offset]))
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description]

    results = [dict(zip(columns, row)) for row in rows]
    return success_response(results, message="Search completed successfully", meta={"page": page, "page_size": page_size, "total": total})
