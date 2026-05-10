from datetime import date, datetime
import hashlib
import json
import re

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
import psycopg2.extras
import requests

from db import ensure_core_schema, get_db_connection
from utils.api_utils import success_response
from utils.auth_utils import get_current_user, require_roles
from utils.ocr_utils import extract_text_from_file
from utils.llm_utils import clean_with_llm

router = APIRouter(prefix="/upload", tags=["upload"])


class DocumentPayload(BaseModel):
    patta_holder_name: str = ""
    father_or_husband_name: str = ""
    age: str = ""
    gender: str = ""
    address: str = ""
    village_name: str = ""
    block: str = ""
    district: str = ""
    state: str = ""
    total_area_claimed: str = ""
    coordinates: str = ""
    land_use: str = ""
    claim_id: str = ""
    claim_type: str = ""
    date_of_application: str = ""
    water_bodies: str = ""
    forest_cover: str = ""
    homestead: str = ""
    survey_reference: str = ""


class GeometryPayload(BaseModel):
    geometry_geojson: dict
    geometry_source: str = "uploaded_geojson"
    survey_reference: str = ""


REQUIRED_FIELDS = {
    "claim_id": "Claim ID",
    "patta_holder_name": "Applicant / Patta Holder",
    "village_name": "Village Name",
    "district": "District",
    "state": "State",
    "claim_type": "Claim Type",
    "total_area_claimed": "Total Area Claimed",
    "land_use": "Land Use",
    "date_of_application": "Date of Application",
}

ALLOWED_CLAIM_TYPES = {"IFR", "CR", "CFR"}


def _dserializer(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return str(obj)


def parse_area_to_acres(area_text: str) -> float | None:
    if not area_text:
        return None
    match = re.search(r"([\d.]+)\s*([A-Za-z ]+)?", area_text)
    if not match:
        return None
    value = float(match.group(1))
    unit = (match.group(2) or "acre").strip().lower()
    if "hect" in unit or unit == "ha":
        return round(value * 2.47105, 4)
    if "sq m" in unit or "sqm" in unit or "square meter" in unit:
        return round(value * 0.000247105, 4)
    return round(value, 4)


def parse_coordinate_pair(coords: str) -> tuple[float, float] | tuple[None, None]:
    if not coords:
        return None, None
    matches = re.findall(r"-?\d+(?:\.\d+)?", coords)
    if len(matches) < 2:
        return None, None
    lat, lon = float(matches[0]), float(matches[1])
    if abs(lat) > 90 or abs(lon) > 180:
        return None, None
    return lat, lon


def derive_centroid_from_geojson(geometry: dict) -> tuple[float, float]:
    geo = geometry.get("geometry", geometry)
    geo_type = geo.get("type")
    coords = geo.get("coordinates")
    if geo_type == "Polygon":
        ring = coords[0]
    elif geo_type == "MultiPolygon":
        ring = coords[0][0]
    else:
        raise HTTPException(status_code=400, detail="Only Polygon or MultiPolygon geometries are supported")
    if not ring:
        raise HTTPException(status_code=400, detail="GeoJSON geometry has no coordinates")
    lon = sum(point[0] for point in ring) / len(ring)
    lat = sum(point[1] for point in ring) / len(ring)
    return lat, lon


def is_stale_asset_result(asset: dict | None) -> bool:
    if not asset:
        return True
    land_type = str(asset.get("land_type") or "").strip().lower()
    confidence = asset.get("confidence")
    try:
        confidence_value = float(confidence if confidence is not None else 0.0)
    except (TypeError, ValueError):
        confidence_value = 0.0
    return land_type in {"", "unknown"} and confidence_value <= 0.0


def compute_and_store_asset_data(cur, doc_id: int, coordinates_val: str):
    from routers.model_pred import get_asset_data

    land_type, confidence, water_available, irrigation = get_asset_data(coordinates_val)
    cur.execute(
        """
        INSERT INTO asset_data (fra_id, land_type, water_available, irrigation, confidence)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (doc_id, land_type, water_available, irrigation, confidence),
    )
    return {
        "fra_id": doc_id,
        "land_type": land_type,
        "confidence": confidence,
        "water_available": water_available,
        "irrigation": irrigation,
    }


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def score_geocoding_result(result: dict, village: str, district: str, state: str) -> int:
    display_name = normalize_text(result.get("display_name", ""))
    result_name = normalize_text(result.get("name", ""))
    result_type = str(result.get("type", "")).lower()
    address = result.get("address") or {}
    address_values = " ".join(normalize_text(value) for value in address.values())

    village_text = normalize_text(village)
    district_text = normalize_text(district)
    state_text = normalize_text(state)
    score = 0
    if village_text:
        if result_name == village_text:
            score += 10
        elif village_text in result_name or village_text in display_name:
            score += 6
    if district_text:
        score += 8 if district_text in address_values else 5 if district_text in display_name else 0
    if state_text:
        score += 8 if state_text in address_values else 5 if state_text in display_name else 0
    if "india" in display_name:
        score += 2
    if result_type in {"village", "hamlet", "isolated_dwelling", "suburb"}:
        score += 4
    elif result_type in {"administrative", "residential"}:
        score += 1
    importance = result.get("importance")
    if isinstance(importance, (int, float)):
        score += min(int(importance * 10), 3)
    return score


def get_coordinates_from_address(address: str, village: str = "", district: str = "", state: str = ""):
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": address,
                "format": "jsonv2",
                "addressdetails": 1,
                "countrycodes": "in",
                "limit": 5,
            },
            headers={"User-Agent": "fra-doc-system"},
            timeout=10,
        )
        if response.status_code == 200:
            results = response.json()
            if results:
                best_match = max(results, key=lambda item: score_geocoding_result(item, village, district, state))
                return f"{best_match['lat']}, {best_match['lon']}"
    except Exception:
        return ""
    return ""


def build_address_candidates(data: dict) -> list[str]:
    address = str(data.get("Address") or data.get("address") or "").strip()
    village = str(data.get("Village Name") or data.get("village_name") or "").strip()
    block = str(data.get("Block") or data.get("block") or "").strip()
    district = str(data.get("District") or data.get("district") or "").strip()
    state = str(data.get("State") or data.get("state") or "").strip()
    candidates = [
        ", ".join(part for part in [village, district, state, "India"] if part),
        ", ".join(part for part in [village, block, district, state, "India"] if part),
        ", ".join(part for part in [address, village, district, state, "India"] if part),
        ", ".join(part for part in [district, state, "India"] if part),
    ]
    seen = set()
    return [candidate for candidate in candidates if candidate and not (candidate in seen or seen.add(candidate))]


def apply_deterministic_jitter(coords: str, seed_string: str) -> str:
    if not coords or not seed_string:
        return coords
    try:
        lat_str, lon_str = coords.split(",")
        lat, lon = float(lat_str), float(lon_str)
        hash_val = int(hashlib.md5(seed_string.encode()).hexdigest(), 16)
        lat_offset = ((hash_val % 1000) / 1000.0) * 0.04 - 0.02
        lon_offset = (((hash_val // 1000) % 1000) / 1000.0) * 0.04 - 0.02
        return f"{lat + lat_offset:.6f}, {lon + lon_offset:.6f}"
    except Exception:
        return coords


def ensure_coordinates(data: dict) -> dict:
    coords = str(data.get("Coordinates") or data.get("coordinates") or "").strip()
    if coords:
        data["Coordinates"] = coords
        data["coordinates"] = coords
        return data

    applicant = str(data.get("patta_holder_name") or data.get("Patta-Holder Name") or "").strip()
    village = str(data.get("Village Name") or data.get("village_name") or "").strip()
    district = str(data.get("District") or data.get("district") or "").strip()
    state = str(data.get("State") or data.get("state") or "").strip()

    coords = ""
    for candidate in build_address_candidates(data):
        coords = get_coordinates_from_address(candidate, village=village, district=district, state=state)
        if coords:
            break

    if coords:
        coords = apply_deterministic_jitter(coords, f"{village}_{applicant}")

    data["Coordinates"] = coords
    data["coordinates"] = coords
    return data


def normalize_and_validate_payload(payload: DocumentPayload) -> DocumentPayload:
    raw = payload.model_dump()
    raw["claim_type"] = str(raw.get("claim_type", "")).strip().upper()
    missing = [label for field, label in REQUIRED_FIELDS.items() if not str(raw.get(field, "")).strip()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Required fields missing: {', '.join(missing)}")
    if raw["claim_type"] not in ALLOWED_CLAIM_TYPES:
        raise HTTPException(status_code=400, detail="Claim Type must be IFR, CR, or CFR")
    if raw.get("date_of_application") and not re.match(r"^\d{4}-\d{2}-\d{2}$", raw["date_of_application"]):
        raise HTTPException(status_code=400, detail="Date of Application must be in YYYY-MM-DD format")
    return DocumentPayload(**raw)


def build_insert_values(payload: DocumentPayload, previous_hash: str, current_hash: str):
    latitude, longitude = parse_coordinate_pair(payload.coordinates)
    area_acres = parse_area_to_acres(payload.total_area_claimed)
    return (
        payload.patta_holder_name,
        payload.father_or_husband_name,
        payload.age,
        payload.gender,
        payload.address,
        payload.village_name,
        payload.block,
        payload.district,
        payload.state,
        payload.total_area_claimed,
        area_acres,
        payload.coordinates,
        latitude,
        longitude,
        None,
        "geocoded" if payload.coordinates else None,
        "point_only",
        payload.survey_reference,
        payload.land_use,
        payload.claim_id,
        payload.claim_type,
        payload.date_of_application,
        payload.water_bodies,
        payload.forest_cover,
        payload.homestead,
        previous_hash,
        current_hash,
    )


def build_update_values(payload: DocumentPayload, doc_id: int):
    latitude, longitude = parse_coordinate_pair(payload.coordinates)
    area_acres = parse_area_to_acres(payload.total_area_claimed)
    return (
        payload.patta_holder_name,
        payload.father_or_husband_name,
        payload.age,
        payload.gender,
        payload.address,
        payload.village_name,
        payload.block,
        payload.district,
        payload.state,
        payload.total_area_claimed,
        area_acres,
        payload.coordinates,
        latitude,
        longitude,
        payload.land_use,
        payload.claim_id,
        payload.claim_type,
        payload.date_of_application,
        payload.water_bodies,
        payload.forest_cover,
        payload.homestead,
        payload.survey_reference,
        doc_id,
    )


def recompute_blockchain(cur) -> None:
    cur.execute("SELECT id, patta_holder_name, village_name, claim_type, status, coordinates FROM fra_documents ORDER BY id ASC")
    all_docs = cur.fetchall()
    last_hash = "0"
    for doc in all_docs:
        name = doc["patta_holder_name"] or ""
        village = doc["village_name"] or ""
        claim_type = doc["claim_type"] or ""
        status = doc.get("status") or "pending"
        coords = doc["coordinates"] or ""
        current_hash = hashlib.sha256(f"{name}{village}{claim_type}{status}{coords}{last_hash}".encode()).hexdigest()
        cur.execute("UPDATE fra_documents SET previous_hash=%s, current_hash=%s WHERE id=%s", (last_hash, current_hash, doc["id"]))
        last_hash = current_hash


@router.post("/")
async def upload_document(file: UploadFile = File(...), _: dict = Depends(require_roles("admin", "analyst"))):
    file_bytes = await file.read()
    ocr_text = extract_text_from_file(file_bytes, file.filename or "")
    data = clean_with_llm(ocr_text)
    if "error" in data:
        raise HTTPException(status_code=500, detail=data["error"])
    return success_response(data, message="Document extracted successfully")


@router.post("/confirm")
async def confirm_document(payload: DocumentPayload, user: dict = Depends(require_roles("admin", "analyst"))):
    validated_payload = normalize_and_validate_payload(payload)
    data = ensure_coordinates(validated_payload.model_dump())
    normalized_payload = DocumentPayload(**data)
    insert_query = """
        INSERT INTO fra_documents (
            patta_holder_name, father_or_husband_name, age, gender, address,
            village_name, block, district, state, total_area_claimed, area_acres,
            coordinates, latitude, longitude, geometry_geojson, geometry_source, geometry_status,
            survey_reference, land_use, claim_id, claim_type, date_of_application,
            water_bodies, forest_cover, homestead, previous_hash, current_hash
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
    """

    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            ensure_core_schema(cur)
            cur.execute("SELECT id FROM fra_documents WHERE claim_id = %s", (normalized_payload.claim_id,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail="A record with this Claim ID already exists")

            cur.execute("SELECT current_hash FROM fra_documents ORDER BY id DESC LIMIT 1")
            last_record = cur.fetchone()
            previous_hash = last_record["current_hash"] if last_record and last_record.get("current_hash") else "0"
            status_value = "pending"
            coordinates_val = normalized_payload.coordinates or ""
            current_hash = hashlib.sha256(
                f"{normalized_payload.patta_holder_name or ''}{normalized_payload.village_name or ''}{normalized_payload.claim_type or ''}{status_value}{coordinates_val}{previous_hash}".encode()
            ).hexdigest()

            cur.execute(insert_query, build_insert_values(normalized_payload, previous_hash, current_hash))
            doc_id = cur.fetchone()["id"]

            if coordinates_val:
                try:
                    compute_and_store_asset_data(cur, doc_id, coordinates_val)
                except Exception:
                    pass

            cur.execute(
                """
                INSERT INTO fra_audit_logs (doc_id, editor, action, previous_data, new_data)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (doc_id, user["email"], "CREATE", json.dumps({}, default=_dserializer), json.dumps(normalized_payload.model_dump(), default=_dserializer)),
            )
        conn.commit()

    return success_response({"doc_id": doc_id, **normalized_payload.model_dump()}, message="Record stored successfully")


@router.post("/preview")
async def preview_document(payload: DocumentPayload, _: dict = Depends(require_roles("admin", "analyst"))):
    preview_payload = DocumentPayload(**ensure_coordinates(payload.model_dump()))
    return success_response(preview_payload.model_dump(), message="Preview generated successfully")


@router.post("/{doc_id}/geometry")
async def upload_geometry(doc_id: int, payload: GeometryPayload, user: dict = Depends(require_roles("admin"))):
    lat, lon = derive_centroid_from_geojson(payload.geometry_geojson)
    coordinates = f"{lat:.6f}, {lon:.6f}"
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            ensure_core_schema(cur)
            cur.execute("SELECT * FROM fra_documents WHERE id = %s", (doc_id,))
            old_record = cur.fetchone()
            if not old_record:
                raise HTTPException(status_code=404, detail="Document not found")
            cur.execute(
                """
                UPDATE fra_documents
                SET geometry_geojson=%s, geometry_source=%s, geometry_status=%s,
                    survey_reference=%s, latitude=%s, longitude=%s, coordinates=%s
                WHERE id=%s
                """,
                (
                    json.dumps(payload.geometry_geojson),
                    payload.geometry_source,
                    "polygon_uploaded",
                    payload.survey_reference,
                    lat,
                    lon,
                    coordinates,
                    doc_id,
                ),
            )
            cur.execute(
                """
                INSERT INTO fra_audit_logs (doc_id, editor, action, previous_data, new_data)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (doc_id, user["email"], "GEOMETRY_UPDATE", json.dumps(old_record, default=_dserializer), json.dumps(payload.model_dump(), default=_dserializer)),
            )
            recompute_blockchain(cur)
        conn.commit()
    return success_response({"doc_id": doc_id, "coordinates": coordinates}, message="Geometry uploaded successfully")


@router.get("/verify-chain")
async def verify_blockchain(user: dict = Depends(require_roles("admin"))):
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            ensure_core_schema(cur)
            cur.execute("SELECT * FROM fra_documents ORDER BY id ASC")
            rows = cur.fetchall()
            if not rows:
                return success_response({"verified_by": user["email"]}, message="Blockchain is secure", status="safe")
            last_curr = "0"
            for record in rows:
                expected_hash = hashlib.sha256(
                    f"{record['patta_holder_name'] or ''}{record['village_name'] or ''}{record['claim_type'] or ''}{record.get('status') or 'pending'}{record['coordinates'] or ''}{last_curr}".encode()
                ).hexdigest()
                if record["previous_hash"] != last_curr or record["current_hash"] != expected_hash:
                    cur.execute("SELECT editor, previous_data, new_data, timestamp FROM fra_audit_logs WHERE doc_id = %s ORDER BY timestamp DESC LIMIT 1", (record["id"],))
                    audit = cur.fetchone()
                    return success_response(
                        {
                            "broken_record_id": record["id"],
                            "expected_hash": expected_hash,
                            "actual_hash": record["current_hash"],
                            "last_audit_log": audit,
                        },
                        message=f"Chain mathematically broken at record id {record['id']}.",
                        status="error",
                    )
                last_curr = record["current_hash"]
    return success_response({"verified_by": user["email"]}, message="Blockchain is mathematically secure", status="safe")


@router.get("/all")
async def get_all_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    search: str | None = Query(None),
    state: str | None = Query(None),
    district: str | None = Query(None),
    claim_type: str | None = Query(None),
    _: dict = Depends(require_roles("admin", "analyst")),
):
    offset = (page - 1) * page_size
    query = "SELECT * FROM fra_documents WHERE 1=1"
    count_query = "SELECT COUNT(*) FROM fra_documents WHERE 1=1"
    params: list[object] = []
    if search:
        clause = " AND (patta_holder_name ILIKE %s OR claim_id ILIKE %s OR village_name ILIKE %s OR district ILIKE %s OR state ILIKE %s)"
        like = f"%{search}%"
        query += clause
        count_query += clause
        params.extend([like, like, like, like, like])
    if state:
        query += " AND state ILIKE %s"
        count_query += " AND state ILIKE %s"
        params.append(f"%{state}%")
    if district:
        query += " AND district ILIKE %s"
        count_query += " AND district ILIKE %s"
        params.append(f"%{district}%")
    if claim_type:
        query += " AND claim_type = %s"
        count_query += " AND claim_type = %s"
        params.append(claim_type.upper())
    query += " ORDER BY created_at DESC LIMIT %s OFFSET %s"

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_core_schema(cur)
            cur.execute(count_query, tuple(params))
            total = cur.fetchone()[0]
            cur.execute(query, tuple(params + [page_size, offset]))
            rows = cur.fetchall()
            colnames = [desc[0] for desc in cur.description]

    results = [dict(zip(colnames, row)) for row in rows]
    return success_response(results, message="Records fetched successfully", meta={"page": page, "page_size": page_size, "total": total})


@router.delete("/{doc_id}")
async def delete_document(doc_id: int, user: dict = Depends(require_roles("admin"))):
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            ensure_core_schema(cur)
            cur.execute("SELECT * FROM fra_documents WHERE id = %s", (doc_id,))
            doc_to_delete = cur.fetchone()
            if not doc_to_delete:
                raise HTTPException(status_code=404, detail="Document not found")
            cur.execute(
                """
                INSERT INTO fra_audit_logs (doc_id, editor, action, previous_data, new_data)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (doc_id, user["email"], "DELETE", json.dumps(doc_to_delete, default=_dserializer), json.dumps({"status": "DELETED"}, default=_dserializer)),
            )
            cur.execute("DELETE FROM fra_documents WHERE id = %s RETURNING id", (doc_id,))
            deleted = cur.fetchone()
            recompute_blockchain(cur)
        conn.commit()
    return success_response({"doc_id": deleted["id"]}, message="Record deleted successfully")


@router.put("/{doc_id}")
async def update_document(doc_id: int, payload: DocumentPayload, user: dict = Depends(require_roles("admin"))):
    validated_payload = normalize_and_validate_payload(payload)
    data = ensure_coordinates(validated_payload.model_dump())
    normalized_payload = DocumentPayload(**data)
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            ensure_core_schema(cur)
            cur.execute("SELECT * FROM fra_documents WHERE id = %s", (doc_id,))
            old_record = cur.fetchone()
            if not old_record:
                raise HTTPException(status_code=404, detail="Document not found")
            cur.execute("SELECT id FROM fra_documents WHERE claim_id = %s AND id != %s", (normalized_payload.claim_id, doc_id))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail="Another record already uses this Claim ID")

            cur.execute(
                """
                INSERT INTO fra_audit_logs (doc_id, editor, action, previous_data, new_data)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (doc_id, user["email"], "EDIT", json.dumps(old_record, default=_dserializer), json.dumps(normalized_payload.model_dump(), default=_dserializer)),
            )
            cur.execute(
                """
                UPDATE fra_documents SET
                patta_holder_name=%s, father_or_husband_name=%s, age=%s, gender=%s, address=%s,
                village_name=%s, block=%s, district=%s, state=%s, total_area_claimed=%s, area_acres=%s,
                coordinates=%s, latitude=%s, longitude=%s, land_use=%s, claim_id=%s, claim_type=%s,
                date_of_application=%s, water_bodies=%s, forest_cover=%s, homestead=%s, survey_reference=%s
                WHERE id=%s
                """,
                build_update_values(normalized_payload, doc_id),
            )
            recompute_blockchain(cur)
        conn.commit()
    return success_response({"doc_id": doc_id, **normalized_payload.model_dump()}, message="Record updated successfully")


@router.get("/{doc_id}/audit-history")
async def get_audit_history(doc_id: int, _: dict = Depends(require_roles("admin", "analyst"))):
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            ensure_core_schema(cur)
            cur.execute("SELECT * FROM fra_audit_logs WHERE doc_id = %s ORDER BY timestamp DESC", (doc_id,))
            logs = cur.fetchall()
    return success_response(logs, message="Audit history fetched successfully")


@router.get("/{doc_id}/assets")
async def get_document_assets(doc_id: int, refresh: bool = False, _: dict = Depends(require_roles("admin", "analyst"))):
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            ensure_core_schema(cur)
            cur.execute("SELECT id, coordinates FROM fra_documents WHERE id = %s", (doc_id,))
            doc = cur.fetchone()
            if not doc:
                raise HTTPException(status_code=404, detail="Document not found")
            cur.execute("SELECT * FROM asset_data WHERE fra_id = %s ORDER BY created_at DESC LIMIT 1", (doc_id,))
            asset = cur.fetchone()
            if (refresh or is_stale_asset_result(asset)) and doc.get("coordinates"):
                compute_and_store_asset_data(cur, doc_id, doc["coordinates"])
                conn.commit()
                cur.execute("SELECT * FROM asset_data WHERE fra_id = %s ORDER BY created_at DESC LIMIT 1", (doc_id,))
                asset = cur.fetchone()
    if not asset:
        return success_response(None, message="No satellite land-cover classification found for this claim.")
    asset["land_cover_class"] = asset.pop("land_type", None)
    asset["irrigation_detected"] = asset.pop("irrigation", None)
    return success_response(asset, message="Satellite land-cover classification fetched successfully")
