import json
import math
import os
import re
import hashlib
from typing import Any

from langchain_core.documents import Document
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import Runnable
from langchain_core.output_parsers import StrOutputParser
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from pypdf import PdfReader

from db import (
    fetch_schemes,
    get_fra_applicant_by_id,
    get_latest_asset_data,
    get_scheme_by_name,
    insert_dss_document,
    list_fra_applicants,
    list_dss_documents,
    update_dss_document_status,
    write_dss_log,
)
from settings import get_settings
from services.scheme_service import find_eligible_people_by_scheme, matches_criteria
from utils.env_utils import load_backend_env
from utils.llm_utils import clean_llm_output, llm, parse_dss_query

load_backend_env()
settings = get_settings()
DSS_DOCS_DIR = settings.dss_docs_dir
DSS_INDEX_PATH = settings.dss_index_path

KNOWN_SCHEME_HINTS = [
    {
        "name": "Jal Jeevan Mission",
        "keywords": ["water", "drinking water", "tap water", "pipeline", "water access", "jal"],
    },
    {
        "name": "PMKSY",
        "keywords": ["irrigation", "sinchai", "micro irrigation", "sprinkler", "drip", "farm water", "watershed"],
    },
    {
        "name": "MGNREGA",
        "keywords": ["employment", "livelihood", "wage", "labor", "works", "asset creation", "mgnrega", "pond", "water harvesting", "irrigation channel"],
    },
    {
        "name": "PM-KISAN",
        "keywords": ["farm", "agriculture", "farmer", "cultivation", "crop", "pm-kisan"],
    },
    {
        "name": "PM Awas Yojana",
        "keywords": ["housing", "house", "homestead", "shelter", "awas"],
    },
    {
        "name": "DAJGUA",
        "keywords": ["convergence", "tribal", "development", "intervention", "dajgua"],
    },
    {
        "name": "Forest Rights Act Support",
        "keywords": ["fra", "forest rights", "cfr", "ifr", "claim holder", "patta"],
    },
]

CONTEXT_THEMES = {
    "irrigation": {
        "keywords": ["irrigation", "sinchai", "drip", "sprinkler", "watershed", "farm water"],
        "scheme_boosts": {"PMKSY": 24, "MGNREGA": 10, "PM-KISAN": 6},
        "reason": "Relevant for irrigation support, water-use efficiency, and farm-level water infrastructure needs.",
    },
    "drinking_water": {
        "keywords": ["water", "drinking water", "tap water", "jal", "pipeline", "water access"],
        "scheme_boosts": {"Jal Jeevan Mission": 24, "DAJGUA": 8, "MGNREGA": 5},
        "reason": "Relevant for drinking water access, village water supply, and basic water infrastructure needs.",
    },
    "housing": {
        "keywords": ["housing", "house", "home", "homestead", "shelter", "awas"],
        "scheme_boosts": {"PM Awas Yojana": 24, "DAJGUA": 8, "Forest Rights Act Support": 5},
        "reason": "Relevant for housing, homestead improvement, and basic settlement support needs.",
    },
    "livelihood": {
        "keywords": ["livelihood", "income", "employment", "wage", "jobs", "work", "self help", "enterprise"],
        "scheme_boosts": {"MGNREGA": 20, "DAJGUA": 12, "PM-KISAN": 8},
        "reason": "Relevant for livelihood enhancement, wage opportunities, and income support for FRA beneficiaries.",
    },
    "agriculture": {
        "keywords": ["agriculture", "farming", "farm", "crop", "cultivation", "seed", "soil", "productivity", "farmer"],
        "scheme_boosts": {"PM-KISAN": 40, "PMKSY": 20, "MGNREGA": 6},
        "reason": "Relevant for agricultural productivity, cultivation support, and farm-focused development needs.",
    },
    "forest_management": {
        "keywords": ["forest", "cfr", "community forest", "bamboo", "ntfp", "minor forest produce", "forest management"],
        "scheme_boosts": {"Forest Rights Act Support": 22, "DAJGUA": 12, "MGNREGA": 6},
        "reason": "Relevant for community forest rights, forest-based livelihoods, and local resource management support.",
    },
    "land_development": {
        "keywords": ["land development", "land leveling", "bunding", "soil conservation", "land improvement", "pond"],
        "scheme_boosts": {"MGNREGA": 18, "PMKSY": 12, "DAJGUA": 8},
        "reason": "Relevant for land development, soil and water conservation, and durable asset creation on FRA land.",
    },
    "convergence": {
        "keywords": ["convergence", "multiple schemes", "overall support", "development package", "priority support"],
        "scheme_boosts": {"DAJGUA": 22, "Forest Rights Act Support": 10, "MGNREGA": 8},
        "reason": "Relevant for combining multiple departmental schemes into a coordinated support package for the selected FRA beneficiary.",
    },
}


def ensure_dss_storage() -> None:
    DSS_DOCS_DIR.mkdir(parents=True, exist_ok=True)
    DSS_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)


def sanitize_filename(filename: str) -> str:
    name = Path(filename or "document.pdf").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return cleaned or "document.pdf"


def persist_uploaded_pdf(filename: str, file_bytes: bytes) -> dict[str, Any]:
    ensure_dss_storage()
    safe_name = sanitize_filename(filename)
    stored_path = DSS_DOCS_DIR / safe_name
    suffix = 1
    while stored_path.exists():
        stem = Path(safe_name).stem
        ext = Path(safe_name).suffix or ".pdf"
        stored_path = DSS_DOCS_DIR / f"{stem}_{suffix}{ext}"
        suffix += 1

    stored_path.write_bytes(file_bytes)
    return insert_dss_document(safe_name, str(stored_path), ingest_status="uploaded")


def _extract_pdf_documents(path: str, document_id: int, filename: str) -> list[Document]:
    reader = PdfReader(path)
    pages: list[Document] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if not text:
            continue
        pages.append(
            Document(
                page_content=text,
                metadata={
                    "document_id": document_id,
                    "source": filename,
                    "page": page_number,
                },
            )
        )
    return pages


def _split_documents(pages: list[Document]) -> list[Document]:
    try:
        from langchain.text_splitter import RecursiveCharacterTextSplitter

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=900,
            chunk_overlap=120,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        return splitter.split_documents(pages)
    except Exception:
        chunks: list[Document] = []
        chunk_size = 900
        overlap = 120
        for page in pages:
            text = page.page_content
            start = 0
            chunk_id = 0
            while start < len(text):
                end = start + chunk_size
                snippet = text[start:end].strip()
                if snippet:
                    metadata = dict(page.metadata)
                    metadata["chunk_id"] = chunk_id
                    chunks.append(Document(page_content=snippet, metadata=metadata))
                if end >= len(text):
                    break
                start = max(0, end - overlap)
                chunk_id += 1
        return chunks


def _get_embeddings_client() -> GoogleGenerativeAIEmbeddings:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required for DSS RAG indexing.")
    return GoogleGenerativeAIEmbeddings(
        model="models/embedding-001",
        google_api_key=api_key,
    )


def _normalize_tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _local_embed_text(text: str, dimensions: int = 256) -> list[float]:
    vector = [0.0] * dimensions
    for token in _normalize_tokens(text):
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        bucket = int(digest[:8], 16) % dimensions
        vector[bucket] += 1.0

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def _embed_documents(chunks: list[Document]) -> tuple[list[list[float]], str]:
    try:
        embeddings = _get_embeddings_client()
        return embeddings.embed_documents([chunk.page_content for chunk in chunks]), "gemini"
    except Exception:
        return [_local_embed_text(chunk.page_content) for chunk in chunks], "local-hash"


def _embed_query(query: str) -> tuple[list[float], str]:
    try:
        embeddings = _get_embeddings_client()
        return embeddings.embed_query(query), "gemini"
    except Exception:
        return _local_embed_text(query), "local-hash"


def _save_index(records: list[dict[str, Any]]) -> None:
    ensure_dss_storage()
    DSS_INDEX_PATH.write_text(json.dumps(records, ensure_ascii=True), encoding="utf-8")


def load_index() -> list[dict[str, Any]]:
    ensure_dss_storage()
    if not DSS_INDEX_PATH.exists():
        return []
    try:
        return json.loads(DSS_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def rebuild_rag_index() -> dict[str, Any]:
    ensure_dss_storage()
    documents = list_dss_documents()
    if not documents:
        _save_index([])
        return {"documents_indexed": 0, "chunks_indexed": 0}

    all_chunks: list[Document] = []
    chunk_counts: dict[int, int] = {}
    for doc in documents:
        stored_path = doc["stored_path"]
        filename = doc["filename"]
        try:
            update_dss_document_status(doc["id"], "indexing", doc.get("chunk_count", 0))
            pages = _extract_pdf_documents(stored_path, doc["id"], filename)
            chunks = _split_documents(pages)
            all_chunks.extend(chunks)
            chunk_counts[doc["id"]] = len(chunks)
        except Exception:
            update_dss_document_status(doc["id"], "error", 0)
            raise

    if not all_chunks:
        _save_index([])
        for doc in documents:
            update_dss_document_status(doc["id"], "indexed", chunk_counts.get(doc["id"], 0))
        return {"documents_indexed": len(documents), "chunks_indexed": 0}

    vectors, embedding_backend = _embed_documents(all_chunks)

    records = []
    for chunk, vector in zip(all_chunks, vectors):
        records.append(
            {
                "document_id": chunk.metadata.get("document_id"),
                "source": chunk.metadata.get("source"),
                "page": chunk.metadata.get("page"),
                "chunk_id": chunk.metadata.get("chunk_id", 0),
                "text": chunk.page_content,
                "embedding": vector,
                "embedding_backend": embedding_backend,
            }
        )

    _save_index(records)
    for doc in documents:
        update_dss_document_status(doc["id"], "indexed", chunk_counts.get(doc["id"], 0))
    return {"documents_indexed": len(documents), "chunks_indexed": len(records)}


def ingest_uploaded_pdf(filename: str, file_bytes: bytes) -> dict[str, Any]:
    document = persist_uploaded_pdf(filename, file_bytes)
    try:
        summary = rebuild_rag_index()
        return {
            "document": document,
            "indexing": {"status": "indexed", **summary},
        }
    except Exception as exc:
        update_dss_document_status(document["id"], "error", 0)
        return {
            "document": document,
            "indexing": {"status": "error", "message": str(exc)},
        }


def _cosine_similarity(first: list[float], second: list[float]) -> float:
    numerator = sum(a * b for a, b in zip(first, second))
    first_norm = math.sqrt(sum(a * a for a in first))
    second_norm = math.sqrt(sum(b * b for b in second))
    if first_norm == 0 or second_norm == 0:
        return 0.0
    return numerator / (first_norm * second_norm)


def retrieve_relevant_chunks(query: str, top_k: int = 4) -> list[dict[str, Any]]:
    records = load_index()
    if not records:
        return []

    query_vector, _ = _embed_query(query)
    scored = []
    for record in records:
        score = _cosine_similarity(query_vector, record.get("embedding", []))
        scored.append({**record, "score": score})

    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[:top_k]


def _safe_json_load(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        cleaned = clean_llm_output(text)
        return json.loads(cleaned)


def _normalize_filters(parsed: dict[str, Any], village: str | None, district: str | None, state: str | None) -> dict[str, Any]:
    filters = dict(parsed)
    if village:
        filters["village"] = village
    if district:
        filters["district"] = district
    if state:
        filters["state"] = state
    return filters


def _sample_people(rows: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    trimmed = []
    for row in rows[:limit]:
        trimmed.append(
            {
                "patta_holder_name": row.get("patta_holder_name"),
                "village_name": row.get("village_name"),
                "district": row.get("district"),
                "state": row.get("state"),
                "claim_id": row.get("claim_id"),
                "land_use": row.get("land_use"),
                "total_area_claimed": row.get("total_area_claimed"),
                "status": row.get("status"),
            }
        )
    return trimmed


def _extract_named_schemes(text: str) -> list[str]:
    patterns = [
        r"\b(?:PM|Pradhan Mantri|Jal|National|Integrated|Community|Forest|Tribal|Rural)[A-Za-z0-9()\/,\- ]{2,80}?(?:Mission|Yojana|Scheme|Programme|Program|Abhiyan)\b",
        r"\bMGNREGA\b",
        r"\bPM-KISAN\b",
        r"\bDAJGUA\b",
    ]
    matches: list[str] = []
    for pattern in patterns:
        for item in re.findall(pattern, text or "", flags=re.IGNORECASE):
            cleaned = re.sub(r"\s+", " ", item).strip(" .,;:-")
            if cleaned and cleaned.lower() not in {value.lower() for value in matches}:
                matches.append(cleaned)
    return matches


def _select_relevant_citations(chunks: list[dict[str, Any]], scheme_name: str, limit: int = 2) -> list[dict[str, Any]]:
    scheme_tokens = set(_normalize_tokens(scheme_name))
    preferred = []
    fallback = []
    for chunk in chunks:
        citation = {
            "source": chunk.get("source"),
            "page": chunk.get("page"),
            "snippet": (chunk.get("text") or "")[:220].strip(),
        }
        chunk_tokens = set(_normalize_tokens(chunk.get("text", "")))
        if scheme_tokens and scheme_tokens.intersection(chunk_tokens):
            preferred.append(citation)
        else:
            fallback.append(citation)

    selected = preferred[:limit]
    if len(selected) < limit:
        selected.extend(fallback[: limit - len(selected)])
    return selected


def _score_scheme_hint(query: str, chunk_text: str, scheme_name: str, keywords: list[str]) -> int:
    query_text = query.lower()
    chunk_lower = chunk_text.lower()
    score = 0
    if scheme_name.lower() in query_text:
        score += 6
    if scheme_name.lower() in chunk_lower:
        score += 4
    if scheme_name == "PMKSY" and ("irrigation" in query_text or "sinchai" in query_text):
        score += 20
    if scheme_name == "MGNREGA" and ("irrigation" in query_text or "water harvesting" in query_text):
        score += 8
    for keyword in keywords:
        if keyword.lower() in query_text:
            score += 3
        if keyword.lower() in chunk_lower:
            score += 2
    for theme in CONTEXT_THEMES.values():
        if any(keyword in query_text for keyword in theme["keywords"]):
            score += theme["scheme_boosts"].get(scheme_name, 0)
    return score


def _infer_offline_schemes(query: str, chunks: list[dict[str, Any]], scheme: dict[str, Any] | None) -> list[dict[str, Any]]:
    if scheme:
        return [{"name": scheme["name"], "score": 100, "source": "structured"}]

    candidate_scores: dict[str, dict[str, Any]] = {}
    chunk_text = "\n".join(chunk.get("text", "") for chunk in chunks)

    for hint in KNOWN_SCHEME_HINTS:
        score = _score_scheme_hint(query, chunk_text, hint["name"], hint["keywords"])
        if score > 0:
            candidate_scores[hint["name"]] = {"name": hint["name"], "score": score, "source": "hint"}

    for extracted in _extract_named_schemes(chunk_text):
        entry = candidate_scores.setdefault(extracted, {"name": extracted, "score": 0, "source": "pdf"})
        entry["score"] += 5

    db_schemes = fetch_schemes()
    for db_scheme in db_schemes:
        name = db_scheme["name"]
        score = _score_scheme_hint(query, chunk_text, name, [name])
        if score > 0:
            entry = candidate_scores.setdefault(name, {"name": name, "score": 0, "source": "db"})
            entry["score"] += score

    active_themes = _get_active_context_themes(query)
    for theme_name in active_themes:
        theme = CONTEXT_THEMES[theme_name]
        for scheme_name, boost in theme["scheme_boosts"].items():
            entry = candidate_scores.setdefault(scheme_name, {"name": scheme_name, "score": 0, "source": "theme"})
            entry["score"] += boost

    ranked = sorted(candidate_scores.values(), key=lambda item: item["score"], reverse=True)
    return ranked[:3]


def _get_active_context_themes(query: str) -> list[str]:
    query_lower = query.lower()
    active = []
    for theme_name, theme in CONTEXT_THEMES.items():
        if any(keyword in query_lower for keyword in theme["keywords"]):
            active.append(theme_name)
    return active


def _build_theme_specific_reason(query: str, default_reason: str) -> str:
    active_themes = _get_active_context_themes(query)
    if not active_themes:
        return default_reason
    primary_theme = active_themes[0]
    return CONTEXT_THEMES[primary_theme]["reason"]


def _offline_reason(query: str, match_count: int, citations: list[dict[str, Any]]) -> str:
    query_lower = query.lower()
    theme_reason = _build_theme_specific_reason(query, "")
    if theme_reason:
        return theme_reason
    if match_count:
        return "Relevant because structured FRA records matched the current filters."
    if citations:
        return "Relevant because the uploaded policy documents discuss this intervention area for FRA beneficiaries."
    return "Relevant based on the current DSS query context."


def _offline_eligibility_note(match_count: int, citations: list[dict[str, Any]]) -> str:
    if match_count:
        return f"{match_count} FRA record(s) matched the structured filters. Use the cited policy text to confirm final eligibility conditions."
    if citations:
        return "Eligibility should be confirmed against the cited document excerpts and the beneficiary's FRA record details."
    return "Eligibility details were not confirmed from structured records in this query."


def _build_structured_matches(filters: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    scheme_name = filters.get("scheme")
    if not scheme_name:
        return None, []

    scheme = get_scheme_by_name(scheme_name)
    if not scheme:
        return None, []

    matches = find_eligible_people_by_scheme(
        scheme,
        village=filters.get("village"),
        district=filters.get("district"),
        state=filters.get("state"),
    )
    return scheme, matches


def _build_applicant_query(applicant: dict[str, Any], extra_prompt: str | None = None) -> str:
    asset_data = get_latest_asset_data(applicant["id"]) if applicant.get("id") else None
    parts = [
        f"Recommend suitable government schemes for FRA patta holder {applicant.get('patta_holder_name') or 'applicant'}",
        f"in {applicant.get('village_name')}, {applicant.get('district')}, {applicant.get('state')}"
        if applicant.get("village_name") and applicant.get("district") and applicant.get("state")
        else None,
        f"land use: {applicant.get('land_use')}" if applicant.get("land_use") else None,
        f"claimed area: {applicant.get('total_area_claimed')}" if applicant.get("total_area_claimed") else None,
        f"water bodies: {applicant.get('water_bodies')}" if applicant.get("water_bodies") else None,
        f"homestead: {applicant.get('homestead')}" if applicant.get("homestead") else None,
        f"forest cover: {applicant.get('forest_cover')}" if applicant.get("forest_cover") else None,
        f"satellite land type: {asset_data.get('land_type')}" if asset_data and asset_data.get("land_type") else None,
        f"water availability detected: {'yes' if asset_data.get('water_available') else 'no'}" if asset_data and asset_data.get("water_available") is not None else None,
        f"irrigation detected: {'yes' if asset_data.get('irrigation') else 'no'}" if asset_data and asset_data.get("irrigation") is not None else None,
        extra_prompt.strip() if extra_prompt else None,
    ]
    return ". ".join(part for part in parts if part)


def _get_structured_scheme_recommendations_for_applicant(applicant: dict[str, Any]) -> list[dict[str, Any]]:
    recommendations = []
    for scheme in fetch_schemes():
        criteria = scheme.get("eligibility", {}) or {}
        try:
            if matches_criteria(applicant, criteria):
                recommendations.append(scheme)
        except Exception:
            continue
    return recommendations


def _merge_applicant_scheme_candidates(
    structured_schemes: list[dict[str, Any]],
    inferred_schemes: list[dict[str, Any]],
    asset_boosts: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for scheme in structured_schemes:
        merged[scheme["name"]] = {"name": scheme["name"], "score": 120, "source": "structured"}
    for inferred in inferred_schemes:
        current = merged.get(inferred["name"])
        if current:
            current["score"] = max(current["score"], inferred["score"])
        else:
            merged[inferred["name"]] = inferred
    for scheme_name, boost in (asset_boosts or {}).items():
        entry = merged.setdefault(scheme_name, {"name": scheme_name, "score": 0, "source": "asset"})
        entry["score"] += boost
    return sorted(merged.values(), key=lambda item: item["score"], reverse=True)[:5]


def _infer_asset_scheme_boosts(applicant: dict[str, Any], asset_data: dict[str, Any] | None) -> dict[str, int]:
    boosts: dict[str, int] = {}
    claim_type = str(applicant.get("claim_type") or "").upper()
    land_use = str(applicant.get("land_use") or "").lower()
    water_bodies = str(applicant.get("water_bodies") or "").lower()
    forest_cover = str(applicant.get("forest_cover") or "").lower()

    if claim_type == "CFR" or "community forest" in land_use or "forest" in forest_cover:
        boosts["Forest Rights Act Support"] = boosts.get("Forest Rights Act Support", 0) + 18
        boosts["DAJGUA"] = boosts.get("DAJGUA", 0) + 10

    if "agric" in land_use or claim_type == "IFR":
        boosts["PM-KISAN"] = boosts.get("PM-KISAN", 0) + 12

    if asset_data:
        if asset_data.get("water_available") is False:
            boosts["Jal Jeevan Mission"] = boosts.get("Jal Jeevan Mission", 0) + 18
            boosts["MGNREGA"] = boosts.get("MGNREGA", 0) + 8
        if asset_data.get("irrigation") is False and ("agric" in land_use or claim_type == "IFR"):
            boosts["PMKSY"] = boosts.get("PMKSY", 0) + 22
            boosts["MGNREGA"] = boosts.get("MGNREGA", 0) + 10
        if str(asset_data.get("land_type") or "").lower() in {"forest", "herbaceousvegetation"}:
            boosts["Forest Rights Act Support"] = boosts.get("Forest Rights Act Support", 0) + 10
        if str(asset_data.get("land_type") or "").lower() in {"annualcrop", "permanentcrop", "pasture"}:
            boosts["PM-KISAN"] = boosts.get("PM-KISAN", 0) + 10

    if "seasonal" in water_bodies or "none" in water_bodies:
        boosts["Jal Jeevan Mission"] = boosts.get("Jal Jeevan Mission", 0) + 8

    return boosts


def _build_applicant_recommendations(
    applicant: dict[str, Any],
    query: str,
    chunks: list[dict[str, Any]],
    structured_schemes: list[dict[str, Any]],
) -> dict[str, Any]:
    asset_data = get_latest_asset_data(applicant["id"]) if applicant.get("id") else None
    merged_schemes = _merge_applicant_scheme_candidates(
        structured_schemes,
        _infer_offline_schemes(query, chunks, None),
        _infer_asset_scheme_boosts(applicant, asset_data),
    )

    recommendations = []
    for index, candidate in enumerate(merged_schemes):
        scheme_name = candidate["name"]
        citations = _select_relevant_citations(chunks, scheme_name, limit=2)
        reason = _offline_reason(query, 1 if candidate["source"] == "structured" else 0, citations)
        if candidate["source"] == "structured":
            reason = f"Structured FRA applicant details align with saved eligibility rules for {scheme_name}."
        recommendations.append(
            {
                "scheme": scheme_name,
                "priority": "High" if index < 2 else "Medium",
                "reason": reason,
                "eligibility_note": _offline_eligibility_note(1 if candidate["source"] == "structured" else 0, citations),
                "supporting_sources": citations,
            }
        )

    return {
        "status": "ok",
        "query": query,
        "summary": f"Generated scheme suggestions for {applicant.get('patta_holder_name') or 'the selected applicant'} based on saved FRA details and indexed policy documents.",
        "applicant_profile": {
            "id": applicant.get("id"),
            "patta_holder_name": applicant.get("patta_holder_name"),
            "claim_id": applicant.get("claim_id"),
            "claim_type": applicant.get("claim_type"),
            "village_name": applicant.get("village_name"),
            "district": applicant.get("district"),
            "state": applicant.get("state"),
            "land_use": applicant.get("land_use"),
            "total_area_claimed": applicant.get("total_area_claimed"),
            "status": applicant.get("status"),
            "asset_data": asset_data,
        },
        "matched_people_count": 1,
        "matched_people_preview": _sample_people([applicant], limit=1),
        "recommended_schemes": recommendations,
        "citations": [source for recommendation in recommendations for source in recommendation.get("supporting_sources", [])],
        "knowledge_base_status": "indexed" if load_index() else "empty",
        "source_count": len(
            {
                (source.get("source"), source.get("page"))
                for recommendation in recommendations
                for source in recommendation.get("supporting_sources", [])
            }
        ),
        "retrieval_error": None,
    }


HYBRID_RESPONSE_PROMPT = """
You are an FRA decision-support assistant for scheme recommendation.

Use only the provided policy excerpts and structured FRA context.
Do not invent source files, page numbers, or unsupported scheme claims.
If the policy excerpts are weak or incomplete, say so briefly.
Return valid JSON only with this shape:
{{
  "summary": "short answer",
  "recommended_schemes": [
    {{
      "scheme": "scheme name",
      "priority": "High | Medium | Low",
      "reason": "why this scheme is relevant",
      "eligibility_note": "high-level eligibility note grounded in sources",
      "supporting_sources": [
        {{
          "source": "filename.pdf",
          "page": 1,
          "snippet": "short supporting snippet"
        }}
      ]
    }}
  ]
}}

User query:
{query}

Structured FRA context:
{structured_context}

Available scheme names from the database:
{available_schemes}

Policy excerpts:
{policy_context}
"""

hybrid_prompt = PromptTemplate.from_template(HYBRID_RESPONSE_PROMPT)
hybrid_chain: Runnable = hybrid_prompt | llm | StrOutputParser()


def _build_default_recommendations(
    query: str,
    chunks: list[dict[str, Any]],
    scheme: dict[str, Any] | None,
    match_count: int,
) -> dict[str, Any]:
    if not chunks and not scheme:
        return {
            "summary": "No indexed DSS policy documents are available yet. Upload the 3 PDFs to enable policy-grounded recommendations.",
            "recommended_schemes": [],
        }

    inferred_schemes = _infer_offline_schemes(query, chunks, scheme)
    if not inferred_schemes:
        inferred_schemes = [{"name": scheme["name"] if scheme else "Scheme guidance", "score": 1, "source": "fallback"}]

    recommendations = []
    for index, inferred in enumerate(inferred_schemes):
        scheme_name = inferred["name"]
        citations = _select_relevant_citations(chunks, scheme_name, limit=2)
        recommendations.append(
            {
                "scheme": scheme_name,
                "priority": "High" if match_count and index == 0 else "Medium",
                "reason": _offline_reason(query, match_count, citations),
                "eligibility_note": _offline_eligibility_note(match_count, citations),
                "supporting_sources": citations,
            }
        )

    return {
        "summary": "Generated an offline DSS answer from indexed policy excerpts and available structured FRA data.",
        "recommended_schemes": recommendations,
    }


def _generate_llm_response(
    query: str,
    scheme: dict[str, Any] | None,
    matches: list[dict[str, Any]],
    chunks: list[dict[str, Any]],
) -> dict[str, Any]:
    if not chunks:
        return _build_default_recommendations(query, chunks, scheme, len(matches))

    structured_context = json.dumps(
        {
            "matched_scheme": scheme["name"] if scheme else None,
            "matched_people_count": len(matches),
            "matched_people_preview": _sample_people(matches),
        },
        ensure_ascii=True,
        default=str,
    )
    available_schemes = json.dumps([item["name"] for item in fetch_schemes()], ensure_ascii=True)
    policy_context = json.dumps(
        [
            {
                "source": chunk.get("source"),
                "page": chunk.get("page"),
                "snippet": (chunk.get("text") or "")[:500],
            }
            for chunk in chunks
        ],
        ensure_ascii=True,
    )

    try:
        raw = hybrid_chain.invoke(
            {
                "query": query,
                "structured_context": structured_context,
                "available_schemes": available_schemes,
                "policy_context": policy_context,
            }
        )
        parsed = _safe_json_load(raw)
        if isinstance(parsed, dict) and "recommended_schemes" in parsed:
            return parsed
    except Exception:
        pass

    return _build_default_recommendations(query, chunks, scheme, len(matches))


def run_hybrid_dss_query(
    query: str,
    village: str | None = None,
    district: str | None = None,
    state: str | None = None,
    top_k: int = 4,
) -> dict[str, Any]:
    parsed = parse_dss_query(query)
    filters = _normalize_filters(parsed, village, district, state)
    scheme, matches = _build_structured_matches(filters)

    try:
        chunks = retrieve_relevant_chunks(query, top_k=top_k)
    except Exception as exc:
        chunks = []
        retrieval_error = str(exc)
    else:
        retrieval_error = None

    llm_response = _generate_llm_response(query, scheme, matches, chunks)
    recommendations = llm_response.get("recommended_schemes", []) or []

    citations = []
    for recommendation in recommendations:
        for source in recommendation.get("supporting_sources", []) or []:
            citations.append(source)

    try:
        write_dss_log(
            query,
            filters,
            scheme["id"] if scheme else None,
            len(matches),
            _sample_people(matches),
        )
    except Exception:
        pass

    return {
        "status": "ok",
        "query": query,
        "filters": filters,
        "matched_people_count": len(matches),
        "matched_people_preview": _sample_people(matches),
        "recommended_schemes": recommendations,
        "citations": citations,
        "summary": llm_response.get("summary", ""),
        "source_count": len({(item.get("source"), item.get("page")) for item in citations}),
        "knowledge_base_status": "indexed" if load_index() else "empty",
        "retrieval_error": retrieval_error,
    }


def get_available_applicants(page: int = 1, page_size: int = 100, search: str | None = None) -> tuple[list[dict[str, Any]], int]:
    return list_fra_applicants(page=page, page_size=page_size, search=search)


def run_applicant_dss_query(applicant_id: int, extra_prompt: str | None = None, top_k: int = 6) -> dict[str, Any]:
    applicant = get_fra_applicant_by_id(applicant_id)
    if not applicant:
        return {
            "status": "error",
            "message": f"Applicant with id {applicant_id} was not found.",
            "recommended_schemes": [],
        }

    query = _build_applicant_query(applicant, extra_prompt)
    structured_schemes = _get_structured_scheme_recommendations_for_applicant(applicant)

    try:
        chunks = retrieve_relevant_chunks(query, top_k=top_k)
        retrieval_error = None
    except Exception as exc:
        chunks = []
        retrieval_error = str(exc)

    response = _build_applicant_recommendations(applicant, query, chunks, structured_schemes)
    response["retrieval_error"] = retrieval_error

    try:
        write_dss_log(
            query,
            {"applicant_id": applicant_id, "claim_id": applicant.get("claim_id")},
            None,
            1,
            _sample_people([applicant], limit=1),
        )
    except Exception:
        pass

    return response
