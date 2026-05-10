import re
import psycopg2.extras
from db import get_db_connection as get_conn
from db import get_latest_asset_data
from utils.llm_utils import convert_area_to_acres


def parse_acres_from_text(area_text: str) -> float:
    """Convert any area text (e.g. '2.5 acres') to float acres."""
    if not area_text:
        return 0.0
    m = re.search(r"([\d\.]+)", str(area_text))
    if not m:
        return 0.0
    return float(m.group(1))


def normalize_gender(g: str) -> str:
    """Normalize gender strings into 'male' / 'female' / 'other'."""
    if not g:
        return ""
    g = g.lower().strip()
    if g.startswith("m"):
        return "male"
    if g.startswith("f"):
        return "female"
    if g.startswith("o"):
        return "other"
    return g


def matches_criteria(record: dict, criteria: dict) -> bool:
    """Check if one DB record satisfies the scheme eligibility rules."""

    # --- Age ---
    age = None
    if record.get("age"):  # DB column `age`
        try:
            age = int(re.search(r"\d+", str(record["age"])).group(0))
        except Exception:
            age = None

    if criteria.get("min_age") is not None:
        if age is None or age < int(criteria["min_age"]):
            return False

    if criteria.get("max_age") is not None:
        if age is None or age > int(criteria["max_age"]):
            return False

    if criteria.get("state"):
        if not record.get("state") or criteria["state"].strip().lower() != record["state"].strip().lower():
            return False

    if criteria.get("claim_type_in"):
        allowed = {value.upper() for value in criteria["claim_type_in"]}
        if str(record.get("claim_type", "")).upper() not in allowed:
            return False

    # --- Gender ---
    if criteria.get("gender"):
        if normalize_gender(criteria["gender"]) != normalize_gender(record.get("gender", "")):
            return False

    # --- Land area ---
    if criteria.get("min_land_area_acres") is not None:
        area_text = record.get("total_area_claimed", "")
        acres = parse_acres_from_text(area_text)
        if acres < float(criteria["min_land_area_acres"]):
            return False

    if criteria.get("max_land_area_acres") is not None:
        area_text = record.get("total_area_claimed", "")
        acres = parse_acres_from_text(area_text)
        if acres > float(criteria["max_land_area_acres"]):
            return False

    land_use = str(record.get("land_use", "")).lower()
    if criteria.get("land_use_contains"):
        if not any(keyword.lower() in land_use for keyword in criteria["land_use_contains"]):
            return False

    forest_profile = "forest" in land_use or "forest" in str(record.get("forest_cover", "")).lower()
    if criteria.get("forest_profile") and not forest_profile:
        return False

    asset = get_latest_asset_data(int(record["id"])) if record.get("id") else None
    if criteria.get("requires_water_priority") and asset and asset.get("water_available") is True:
        return False

    if criteria.get("irrigation_required") is False and asset and asset.get("irrigation") is True:
        return False

    return True


def find_eligible_people_by_scheme(
    scheme_record: dict,
    village: str = None,
    district: str = None,
    state: str = None
):
    q = "SELECT * FROM fra_documents WHERE 1=1"
    params = []

    if village:
        q += " AND village_name ILIKE %s"
        params.append(f"%{village}%")

    if district:
        q += " AND district ILIKE %s"
        params.append(f"%{district}%")

    if state:
        q += " AND state ILIKE %s"
        params.append(f"%{state}%")

    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(q, tuple(params))
            rows = cur.fetchall()

    criteria = scheme_record.get("eligibility", {}) or {}
    return [r for r in rows if matches_criteria(r, criteria)]
