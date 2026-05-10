import json
from datetime import date, datetime

import psycopg2
import psycopg2.extras

from settings import get_settings
from utils.security_utils import hash_password

settings = get_settings()


DEFAULT_SCHEMES = [
    {
        "name": "PM-KISAN",
        "description": "Income support for eligible small and marginal farmer households.",
        "eligibility": {
            "claim_type_in": ["IFR"],
            "land_use_contains": ["agric", "farm", "cultivation"],
            "min_land_area_acres": 0.1,
        },
    },
    {
        "name": "PMKSY",
        "description": "Irrigation and water-use efficiency support for cultivable land.",
        "eligibility": {
            "claim_type_in": ["IFR"],
            "land_use_contains": ["agric", "farm", "cultivation"],
            "irrigation_required": False,
        },
    },
    {
        "name": "Jal Jeevan Mission",
        "description": "Support for drinking water access and village water infrastructure.",
        "eligibility": {
            "requires_water_priority": True,
        },
    },
    {
        "name": "MGNREGA",
        "description": "Livelihood and asset creation support, including land and water development.",
        "eligibility": {
            "claim_type_in": ["IFR", "CR", "CFR"],
            "supports_land_development": True,
        },
    },
    {
        "name": "DAJGUA",
        "description": "Convergence-focused tribal development support for FRA beneficiaries.",
        "eligibility": {
            "claim_type_in": ["IFR", "CR", "CFR"],
        },
    },
    {
        "name": "Forest Rights Act Support",
        "description": "Forest-rights-aligned support for forest-dependent and CFR-focused applicants.",
        "eligibility": {
            "claim_type_in": ["IFR", "CFR"],
            "forest_profile": True,
        },
    },
]


def get_db_connection():
    return psycopg2.connect(settings.database_url)


def _json_serializer(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return str(obj)


def ensure_core_schema(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            full_name TEXT DEFAULT '',
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'analyst',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS fra_documents (
            id SERIAL PRIMARY KEY,
            patta_holder_name TEXT,
            father_or_husband_name TEXT,
            age TEXT,
            gender TEXT,
            address TEXT,
            village_name TEXT,
            block TEXT,
            district TEXT,
            state TEXT,
            total_area_claimed TEXT,
            area_acres DOUBLE PRECISION,
            coordinates TEXT,
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            geometry_geojson JSONB,
            geometry_source TEXT,
            geometry_status TEXT DEFAULT 'point_only',
            survey_reference TEXT,
            land_use TEXT,
            claim_id TEXT UNIQUE,
            claim_type TEXT,
            date_of_application TEXT,
            water_bodies TEXT,
            forest_cover TEXT,
            homestead TEXT,
            status TEXT DEFAULT 'pending',
            previous_hash TEXT,
            current_hash TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_data (
            id SERIAL PRIMARY KEY,
            fra_id INTEGER REFERENCES fra_documents(id) ON DELETE CASCADE,
            land_type TEXT,
            water_available BOOLEAN,
            irrigation BOOLEAN,
            confidence FLOAT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS fra_audit_logs (
            id SERIAL PRIMARY KEY,
            doc_id INTEGER,
            editor TEXT,
            action TEXT,
            previous_data JSONB,
            new_data JSONB,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT ''")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'analyst'")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS father_or_husband_name TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS age TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS gender TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS address TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS block TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS area_acres DOUBLE PRECISION")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS geometry_geojson JSONB")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS geometry_source TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS geometry_status TEXT DEFAULT 'point_only'")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS survey_reference TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS water_bodies TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS forest_cover TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS homestead TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS previous_hash TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS current_hash TEXT")
    cur.execute("ALTER TABLE fra_documents ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

    cur.execute("ALTER TABLE asset_data ADD COLUMN IF NOT EXISTS land_type TEXT")
    cur.execute("ALTER TABLE asset_data ADD COLUMN IF NOT EXISTS water_available BOOLEAN")
    cur.execute("ALTER TABLE asset_data ADD COLUMN IF NOT EXISTS irrigation BOOLEAN")
    cur.execute("ALTER TABLE asset_data ADD COLUMN IF NOT EXISTS confidence FLOAT")
    cur.execute("ALTER TABLE asset_data ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

    ensure_dss_schema(cur)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fra_claim_id ON fra_documents (claim_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fra_applicant_name ON fra_documents (patta_holder_name)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_fra_location ON fra_documents (state, district, village_name)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_dss_logs_created_at ON dss_logs (created_at DESC)")


def ensure_dss_schema(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS schemes (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '',
            eligibility JSONB DEFAULT '{}'::jsonb
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS dss_logs (
            id SERIAL PRIMARY KEY,
            user_query TEXT NOT NULL,
            parsed JSONB DEFAULT '{}'::jsonb,
            scheme_id INTEGER,
            result_count INTEGER DEFAULT 0,
            sample JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS dss_documents (
            id SERIAL PRIMARY KEY,
            filename TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            ingest_status TEXT DEFAULT 'uploaded',
            chunk_count INTEGER DEFAULT 0,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            indexed_at TIMESTAMP
        )
        """
    )


def seed_default_schemes(cur) -> None:
    for scheme in DEFAULT_SCHEMES:
        cur.execute(
            """
            INSERT INTO schemes (name, description, eligibility)
            VALUES (%s, %s, %s)
            ON CONFLICT (name) DO UPDATE
            SET description = EXCLUDED.description,
                eligibility = EXCLUDED.eligibility
            """,
            (scheme["name"], scheme["description"], json.dumps(scheme["eligibility"])),
        )


def bootstrap_admin_user(cur) -> None:
    cur.execute("SELECT id FROM users WHERE email = %s", (settings.bootstrap_admin_email,))
    if cur.fetchone():
        return
    cur.execute(
        """
        INSERT INTO users (email, full_name, password_hash, role, is_active)
        VALUES (%s, %s, %s, %s, TRUE)
        """,
        (
            settings.bootstrap_admin_email,
            "FRA Admin",
            hash_password(settings.bootstrap_admin_password),
            "admin",
        ),
    )


def initialize_database() -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_core_schema(cur)
            seed_default_schemes(cur)
            bootstrap_admin_user(cur)
        conn.commit()


def create_user(email: str, full_name: str, password_hash: str, role: str = "analyst") -> dict:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_core_schema(cur)
            cur.execute(
                """
                INSERT INTO users (email, full_name, password_hash, role)
                VALUES (%s, %s, %s, %s)
                RETURNING id, email, full_name, role, is_active, created_at
                """,
                (email, full_name, password_hash, role),
            )
            row = cur.fetchone()
        conn.commit()
    return {
        "id": row[0],
        "email": row[1],
        "full_name": row[2],
        "role": row[3],
        "is_active": row[4],
        "created_at": row[5],
    }


def get_user_by_email(email: str) -> dict | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_core_schema(cur)
            cur.execute(
                """
                SELECT id, email, full_name, password_hash, role, is_active, created_at
                FROM users
                WHERE email = %s
                """,
                (email,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "email": row[1],
        "full_name": row[2],
        "password_hash": row[3],
        "role": row[4],
        "is_active": row[5],
        "created_at": row[6],
    }


def get_user_by_id(user_id: int) -> dict | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_core_schema(cur)
            cur.execute(
                """
                SELECT id, email, full_name, role, is_active, created_at
                FROM users
                WHERE id = %s
                """,
                (user_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "email": row[1],
        "full_name": row[2],
        "role": row[3],
        "is_active": row[4],
        "created_at": row[5],
    }


def insert_scheme(name: str, description: str, eligibility: dict):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_dss_schema(cur)
            cur.execute(
                """
                INSERT INTO schemes (name, description, eligibility)
                VALUES (%s, %s, %s)
                ON CONFLICT (name) DO UPDATE
                SET description = EXCLUDED.description,
                    eligibility = EXCLUDED.eligibility
                RETURNING id
                """,
                (name, description, json.dumps(eligibility)),
            )
            scheme_id = cur.fetchone()[0]
        conn.commit()
    return scheme_id


def get_scheme_by_name(name: str):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_dss_schema(cur)
            cur.execute(
                "SELECT id, name, description, eligibility FROM schemes WHERE name ILIKE %s",
                (name,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {"id": row[0], "name": row[1], "description": row[2], "eligibility": row[3]}


def fetch_schemes():
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_dss_schema(cur)
            cur.execute("SELECT id, name, description, eligibility FROM schemes ORDER BY name")
            rows = cur.fetchall()
    return [{"id": r[0], "name": r[1], "description": r[2], "eligibility": r[3]} for r in rows]


def write_dss_log(user_query: str, parsed: dict, scheme_id: int | None, count: int, sample: list):
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_dss_schema(cur)
            cur.execute(
                """
                INSERT INTO dss_logs (user_query, parsed, scheme_id, result_count, sample)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    user_query,
                    json.dumps(parsed, default=_json_serializer),
                    scheme_id,
                    count,
                    json.dumps(sample, default=_json_serializer),
                ),
            )
        conn.commit()


def insert_dss_document(filename: str, stored_path: str, ingest_status: str = "uploaded") -> dict:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_dss_schema(cur)
            cur.execute(
                """
                INSERT INTO dss_documents (filename, stored_path, ingest_status)
                VALUES (%s, %s, %s)
                RETURNING id, filename, stored_path, ingest_status, chunk_count, uploaded_at, indexed_at
                """,
                (filename, stored_path, ingest_status),
            )
            row = cur.fetchone()
        conn.commit()
    return {
        "id": row[0],
        "filename": row[1],
        "stored_path": row[2],
        "ingest_status": row[3],
        "chunk_count": row[4],
        "uploaded_at": row[5],
        "indexed_at": row[6],
    }


def update_dss_document_status(document_id: int, ingest_status: str, chunk_count: int = 0) -> None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_dss_schema(cur)
            cur.execute(
                """
                UPDATE dss_documents
                SET ingest_status = %s,
                    chunk_count = %s,
                    indexed_at = CASE WHEN %s = 'indexed' THEN CURRENT_TIMESTAMP ELSE indexed_at END
                WHERE id = %s
                """,
                (ingest_status, chunk_count, ingest_status, document_id),
            )
        conn.commit()


def list_dss_documents(page: int = 1, page_size: int = 50) -> tuple[list[dict], int]:
    offset = (page - 1) * page_size
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_dss_schema(cur)
            cur.execute("SELECT COUNT(*) FROM dss_documents")
            total = cur.fetchone()[0]
            cur.execute(
                """
                SELECT id, filename, stored_path, ingest_status, chunk_count, uploaded_at, indexed_at
                FROM dss_documents
                ORDER BY uploaded_at DESC
                LIMIT %s OFFSET %s
                """,
                (page_size, offset),
            )
            rows = cur.fetchall()
    return (
        [
            {
                "id": row[0],
                "filename": row[1],
                "stored_path": row[2],
                "ingest_status": row[3],
                "chunk_count": row[4],
                "uploaded_at": row[5],
                "indexed_at": row[6],
            }
            for row in rows
        ],
        total,
    )


def list_fra_applicants(page: int = 1, page_size: int = 100, search: str | None = None) -> tuple[list[dict], int]:
    offset = (page - 1) * page_size
    query = """
        SELECT id, patta_holder_name, village_name, district, state, claim_id, claim_type,
               land_use, total_area_claimed, status, geometry_status, area_acres
        FROM fra_documents
        WHERE 1=1
    """
    count_query = "SELECT COUNT(*) FROM fra_documents WHERE 1=1"
    params: list[object] = []
    if search:
        query += " AND (patta_holder_name ILIKE %s OR claim_id ILIKE %s OR village_name ILIKE %s OR district ILIKE %s OR state ILIKE %s)"
        count_query += " AND (patta_holder_name ILIKE %s OR claim_id ILIKE %s OR village_name ILIKE %s OR district ILIKE %s OR state ILIKE %s)"
        like = f"%{search}%"
        params.extend([like, like, like, like, like])
    query += " ORDER BY patta_holder_name ASC NULLS LAST, id DESC LIMIT %s OFFSET %s"

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_core_schema(cur)
            cur.execute(count_query, tuple(params))
            total = cur.fetchone()[0]
            cur.execute(query, tuple(params + [page_size, offset]))
            rows = cur.fetchall()
    return (
        [
            {
                "id": row[0],
                "patta_holder_name": row[1],
                "village_name": row[2],
                "district": row[3],
                "state": row[4],
                "claim_id": row[5],
                "claim_type": row[6],
                "land_use": row[7],
                "total_area_claimed": row[8],
                "status": row[9],
                "geometry_status": row[10],
                "area_acres": row[11],
            }
            for row in rows
        ],
        total,
    )


def get_fra_applicant_by_id(doc_id: int) -> dict | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_core_schema(cur)
            cur.execute(
                """
                SELECT id, patta_holder_name, father_or_husband_name, age, gender, address,
                       village_name, block, district, state, total_area_claimed, coordinates,
                       land_use, claim_id, claim_type, date_of_application, water_bodies,
                       forest_cover, homestead, status, area_acres, latitude, longitude,
                       geometry_geojson, geometry_source, geometry_status, survey_reference
                FROM fra_documents
                WHERE id = %s
                """,
                (doc_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "patta_holder_name": row[1],
        "father_or_husband_name": row[2],
        "age": row[3],
        "gender": row[4],
        "address": row[5],
        "village_name": row[6],
        "block": row[7],
        "district": row[8],
        "state": row[9],
        "total_area_claimed": row[10],
        "coordinates": row[11],
        "land_use": row[12],
        "claim_id": row[13],
        "claim_type": row[14],
        "date_of_application": row[15],
        "water_bodies": row[16],
        "forest_cover": row[17],
        "homestead": row[18],
        "status": row[19],
        "area_acres": row[20],
        "latitude": row[21],
        "longitude": row[22],
        "geometry_geojson": row[23],
        "geometry_source": row[24],
        "geometry_status": row[25],
        "survey_reference": row[26],
    }


def get_latest_asset_data(doc_id: int) -> dict | None:
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            ensure_core_schema(cur)
            cur.execute(
                """
                SELECT fra_id, land_type, water_available, irrigation, confidence, created_at
                FROM asset_data
                WHERE fra_id = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (doc_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {
        "fra_id": row[0],
        "land_type": row[1],
        "water_available": row[2],
        "irrigation": row[3],
        "confidence": row[4],
        "created_at": row[5],
    }


def get_db_health() -> dict:
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
