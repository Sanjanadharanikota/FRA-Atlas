import json
import re
import os
import requests
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import PromptTemplate
# Added imports for DSS
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import Runnable
from db import fetch_schemes
from typing import Dict, Any
from utils.env_utils import load_backend_env

# -------------------------
# Load API Keys
# -------------------------
load_backend_env()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    temperature=0,
    api_key=GEMINI_API_KEY
)

# -------------------------
# Conversion factors to acres
# -------------------------
UNIT_TO_ACRE = {
    "acre": 1.0, "acres": 1.0,
    "hectare": 2.47105, "hectares": 2.47105, "ha": 2.47105,
    "sq m": 0.000247105, "sqm": 0.000247105,
    "square meter": 0.000247105, "square meters": 0.000247105,
    "sq ft": 2.2957e-5, "sqft": 2.2957e-5, "square feet": 2.2957e-5,
    "bigha": 0.619, "cent": 0.0247, "guntha": 0.0247
}

# -------------------------
# Prompt Template (OCR → JSON Schema)
# -------------------------
SCHEMA_PROMPT = """
You are an assistant that extracts structured data from noisy OCR text for Forest Rights Act claim forms in India.

Rules:
1. Extract only values present in text.
2. Fix obvious OCR spelling mistakes for place names, claim types, and common FRA terms.
3. Do not invent missing values.
4. Missing fields = "".
5. Claim Type must be one of "IFR", "CR", or "CFR" when present.
6. Return valid JSON only, with no prose, no markdown, and no code fences.
7. Preserve dates in YYYY-MM-DD format when visible.

JSON Format:
{{
    "Patta-Holder Name": "",
    "Father/Husband Name": "",
    "Age": "",
    "Gender": "",
    "Address": "",
    "Village Name": "",
    "Block": "",
    "District": "",
    "State": "",
    "Total Area Claimed": "",
    "Coordinates": "",
    "Land Use": "",
    "Claim ID": "",
    "Claim Type": "",
    "Date of Application": "",
    "Water bodies": "",
    "Forest cover": "",
    "Homestead": ""
}}

OCR Text:
{ocr_text}
"""
prompt = PromptTemplate.from_template(SCHEMA_PROMPT)
chain = prompt | llm | StrOutputParser()

REPAIR_PROMPT = """
You are a JSON repair assistant.

Convert the following model output into exactly one valid JSON object with this schema:
{{
    "Patta-Holder Name": "",
    "Father/Husband Name": "",
    "Age": "",
    "Gender": "",
    "Address": "",
    "Village Name": "",
    "Block": "",
    "District": "",
    "State": "",
    "Total Area Claimed": "",
    "Coordinates": "",
    "Land Use": "",
    "Claim ID": "",
    "Claim Type": "",
    "Date of Application": "",
    "Water bodies": "",
    "Forest cover": "",
    "Homestead": ""
}}

Rules:
1. Return valid JSON only.
2. No markdown or explanation.
3. If a field is missing, set it to "".
4. Keep only the schema fields above.

Model output:
{raw_output}
"""
repair_prompt = PromptTemplate.from_template(REPAIR_PROMPT)
repair_chain = repair_prompt | llm | StrOutputParser()

# -------------------------
# JSON Cleaning
# -------------------------
def clean_llm_output(raw_text: str) -> str:
    # Remove markdown code blocks if present
    raw_text = re.sub(r'```(?:json)?', '', raw_text)
    raw_text = raw_text.replace('```', '')
    
    first = raw_text.find("{")
    last = raw_text.rfind("}")
    if first == -1 or last == -1:
        return raw_text
    raw_text = raw_text[first:last+1]
    raw_text = raw_text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    raw_text = raw_text.replace("'", '"')
    raw_text = re.sub(r',\s*([}\]])', r'\1', raw_text)
    return raw_text.strip()

def log_llm_output(stage: str, text: str) -> None:
    preview = (text or "")[:600].replace("\n", "\\n")
    print(f"LLM {stage}: {preview}")

def safe_json_parse(text: str) -> dict:
    try:
        return json.loads(text)
    except Exception:
        cleaned = clean_llm_output(text)
        try:
            return json.loads(cleaned)
        except Exception as e:
            print(f"JSON Parse Error: {e}")
            log_llm_output("raw OCR response", text)
            try:
                repaired = repair_chain.invoke({"raw_output": text})
                log_llm_output("repaired OCR response", repaired)
                repaired_clean = clean_llm_output(repaired)
                return json.loads(repaired_clean)
            except Exception as repair_error:
                print(f"LLM JSON repair failed: {repair_error}")
                return {"error": "LLM JSON parse failed", "raw": text}


# -------------------------
# Regex Fallback
# -------------------------
def fallback_extract(data: dict, text: str) -> dict:
    patterns = {
        "Patta-Holder Name": r"Patta[- ]Holder Name[:\-]?\s*(.+)",
        "Father/Husband Name": r"(Father|Husband) Name[:\-]?\s*(.+)",
        "Age": r"Age[:\-]?\s*(\d+)",
        "Gender": r"Gender[:\-]?\s*(Male|Female|Other)",
        "Address": r"Address[:\-]?\s*(.+)",
        "Village Name": r"Village Name[:\-]?\s*(.+)",
        "Block": r"Block[:\-]?\s*(.+)",
        "District": r"District[:\-]?\s*(.+)",
        "State": r"State[:\-]?\s*(.+)",
        "Total Area Claimed": r"Total Area Claimed[:\-]?\s*([\d\.]+.*)",
        "Coordinates": r"Coordinates[:\-]?\s*(.+)",
        "Land Use": r"Land Use[:\-]?\s*(.+)",
        "Claim ID": r"Claim ID[:\-]?\s*(.+)",
        "Date of Application": r"Date of Application[:\-]?\s*(.+)",
        "Water bodies": r"Water bodies[:\-]?\s*(.+)",
        "Forest cover": r"Forest cover[:\-]?\s*(.+)",
        "Homestead": r"Homestead[:\-]?\s*(.+)"
    }
    for field, pattern in patterns.items():
        if not data.get(field) or data.get(field) == "":
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                data[field] = match.group(1).strip()

    targeted_patterns = {
        "Patta-Holder Name": r"Name of the claimant\(s\):\s*(.+?)(?:\s+Claim ID:|\n|Father\s*/\s*Husband Name:)",
        "Claim ID": r"Claim ID[:\-]?\s*([A-Z]{2,4}-[A-Z]{2,4}-\d+)",
        "Village Name": r"Village[:\-]?\s*(.+?)(?:\s+3\.|\n)",
        "Block": r"Tehsil/Taluka[:\-]?\s*(.+?)(?:\n|5\.)",
        "District": r"District[:\-]?\s*([A-Za-z ]+?)(?:\s+State[:\-]|\s+Btate[:\-]|\n)",
        "State": r"(?:State|Btate)[:\-]?\s*([A-Za-z ]+)",
        "Claim Type": r"Claim Type[:\-]?\s*(IFR|CR|CFR)",
        "Total Area Claimed": r"Total Area Claimed[:\-]?\s*([\d\.]+\s*[A-Za-z]+)",
        "Land Use": r"Land Use[:\-]?\s*(.+?)(?:Date.*Application[:\-]|\n)",
        "Date of Application": r"Date\w*\s*Application[:\-]?\s*([0-9]{4}\s*-\s*[0-9]{2}\s*-\s*[0-9]{1,2})",
        "Water bodies": r"Water Bodies[:\-]?\s*(.+?)(?:Forest\s*Cove|Forest\s*cover|\n)",
        "Forest cover": r"Forest\s*(?:Cove|cover)[:\-]?\s*(.+?)(?:Homestead[:\-]|\n)",
        "Homestead": r"Homestead[:\-]?\s*([A-Za-z]+)",
    }
    for field, pattern in targeted_patterns.items():
        if not data.get(field) or data.get(field) == "":
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                data[field] = match.group(1).strip()
    return data

# -------------------------
# Area Conversion
# -------------------------
def convert_area_to_acres(area_str: str) -> str:
    if not area_str:
        return ""
    match = re.search(r"([\d\.]+)\s*([a-zA-Z ]+)?", area_str)
    if not match:
        return area_str
    value = float(match.group(1))
    unit = (match.group(2) or "acre").strip().lower()
    for key, factor in UNIT_TO_ACRE.items():
        if key in unit:
            acres = value * factor
            return f"{acres:.2f} acres"
    return f"{value:.2f} acres"

# -------------------------
# Coordinate Helpers
# -------------------------
def is_valid_coordinates(coords: str) -> bool:
    if not coords:
        return False
    return bool(re.match(r"^-?\d+\.\d+,\s*-?\d+\.\d+$", coords))

def fetch_coordinates_from_address(address: str) -> str:
    if not address.strip():
        return ""
    url = "https://nominatim.openstreetmap.org/search"
    params = {"q": address, "format": "json", "limit": 1}
    headers = {"User-Agent": "FRA-System/1.0"}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        print("🔍 Geocoding request:", resp.url)
        data = resp.json()
        print("📍 Geocoding response:", data)
        if data:
            return f"{data[0]['lat']}, {data[0]['lon']}"
    except Exception as e:
        print("Geocoding error:", e)
    return ""

# -------------------------
# Main Cleaning
# -------------------------
def clean_with_llm(text: str) -> dict:
    try:
        response = chain.invoke({"ocr_text": text})
        log_llm_output("OCR extraction response", response)
        data = safe_json_parse(response)
    except Exception as e:
        print(f"LLM invocation failed during OCR cleanup: {e}")
        data = {}

    if "error" in data:
        print("Falling back to regex extraction because Gemini output could not be repaired.")
        data = {}
    data = fallback_extract(data, text)

    if "Total Area Claimed" in data and data["Total Area Claimed"]:
        data["Total Area Claimed"] = convert_area_to_acres(data["Total Area Claimed"])

    coords = data.get("Coordinates", "").strip()
    if not is_valid_coordinates(coords):
        full_address = ", ".join(
            filter(None, [
                data.get("Address", ""),
                data.get("Village Name", ""),
                data.get("Block", ""),
                data.get("District", ""),
                data.get("State", ""),
                "India"
            ])
        )
        print("Full Address for geocoding:", full_address)
        new_coords = fetch_coordinates_from_address(full_address)

        if not new_coords and data.get("District") and data.get("State"):
            alt_address = f"{data['District']}, {data['State']}, India"
            new_coords = fetch_coordinates_from_address(alt_address)

        if not new_coords:
            pincode_match = re.search(r"\b\d{6}\b", full_address)
            if pincode_match:
                new_coords = fetch_coordinates_from_address(pincode_match.group(0) + ", India")

        if new_coords:
            data["Coordinates"] = new_coords

    return data


# -------------------------
# DSS Query Parsing
# -------------------------
DSS_PROMPT = """
You are an assistant that extracts structured filters from a natural language question
about government scheme eligibility.

Rules:
1. Extract scheme, village, district, state (if available).
2. If any field is missing, return null.
3. Output ONLY valid JSON. No explanation, no markdown.

Question:
{user_query}

Example:
Question: Who is eligible for Farm Support Scheme in Bhimganga?
Answer:
{{
  "scheme": "Farm Support Scheme",
  "village": "Bhimganga",
  "district": null,
  "state": null
}}

Question: List all people in Mandla eligible for Old Age Pension.
Answer:
{{
  "scheme": "Old Age Pension",
  "village": "Mandla",
  "district": null,
  "state": null
}}
"""


dss_prompt = PromptTemplate.from_template(DSS_PROMPT)
dss_chain: Runnable = dss_prompt | llm | StrOutputParser()

INDIAN_STATES = {
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh",
    "goa", "gujarat", "haryana", "himachal pradesh", "jharkhand", "karnataka",
    "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya",
    "mizoram", "nagaland", "odisha", "punjab", "rajasthan", "sikkim",
    "tamil nadu", "telangana", "tripura", "uttar pradesh", "uttarakhand",
    "west bengal",
}

PLACE_STOP_WORDS = (" with ", " for ", " based ", " having ", " where ", " needing ", " who ")

def parse_dss_query(user_query: str) -> Dict[str, Any]:
    result = {"scheme": None, "village": None, "district": None, "state": None}

    try:
        llm_out = dss_chain.invoke({"user_query": user_query})
        parsed = json.loads(llm_out)

        for key in result.keys():
            if key in parsed:
                result[key] = parsed[key]

    except Exception as e:
        print("LLM parse failed, fallback:", e)

        # Regex fallback for village
        m = re.search(r"\bin\s+([A-Za-z ]+?)(?:[?.!,]|$)", user_query)
        if m:
            place = f" {m.group(1).strip()} "
            for marker in PLACE_STOP_WORDS:
                if marker in place.lower():
                    place = place[:place.lower().index(marker)]
                    break
            place = place.strip()
            if place.lower() in INDIAN_STATES:
                result["state"] = place
            else:
                result["village"] = place

        # Match scheme from DB
        schemes = fetch_schemes()
        for s in schemes:
            if s["name"].lower() in user_query.lower():
                result["scheme"] = s["name"]
                break

    return result

# -------------------------
# LLM Geographic Fallback
# -------------------------
GEOCODE_PROMPT = """
You are an expert geography API. Calculate the rough GPS coordinates for the center of the following village in India:
Village: {village}
District: {district}
State: {state}

Respond ONLY with a valid JSON containing "lat" and "lon" as floats. Do not include markdown or blockticks.
If you genuinely cannot find or confidently estimate it, return {{"lat": null, "lon": null}}.
"""

geocode_prompt = PromptTemplate.from_template(GEOCODE_PROMPT)
geocode_chain: Runnable = geocode_prompt | llm | StrOutputParser()

def geocode_village_with_llm(village: str, district: str, state: str) -> str:
    if not village:
        return ""
    try:
        raw_resp = geocode_chain.invoke({"village": village, "district": district, "state": state})
        cleaned = raw_resp.strip().replace("```json", "").replace("```", "")
        data = json.loads(cleaned)
        if data.get("lat") is not None and data.get("lon") is not None:
            return f"{float(data['lat']):.6f}, {float(data['lon']):.6f}"
    except Exception as e:
        print("LLM geocoding fallback error:", e)
    return ""
