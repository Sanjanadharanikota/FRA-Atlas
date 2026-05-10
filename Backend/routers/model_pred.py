import io
import math
import os
from typing import Optional

from utils.runtime_utils import configure_runtime_noise, configure_tensorflow_logging

configure_runtime_noise()

import ee
import numpy as np
import requests
import tensorflow as tf
from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel

from utils.gee_utils import get_gee_status, initialize_gee

configure_tensorflow_logging(tf)

router = APIRouter(prefix="/model", tags=["model"])

# ------------------ CONFIG ------------------
IMG_SIZE = 64
SAVED_IMAGES_DIR = "saved_images"
EE_START_DATE = "2023-01-01"
EE_END_DATE = "2023-12-31"
THUMB_DIM = 512
# --------------------------------------------

os.makedirs(SAVED_IMAGES_DIR, exist_ok=True)

# Load TensorFlow model
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "..", "best_model.h5")
model = None

if not os.path.exists(MODEL_PATH):
    print(f"Warning: Model file {MODEL_PATH} not found. Place your Keras model there.")
else:
    try:
        model = tf.keras.models.load_model(MODEL_PATH)
        print(f"Model loaded from {MODEL_PATH}")
    except Exception as exc:
        print(f"Warning: could not load model: {exc}")


CLASS_NAMES = [
    "AnnualCrop",
    "Forest",
    "HerbaceousVegetation",
    "Highway",
    "Industrial",
    "Pasture",
    "PermanentCrop",
    "Residential",
    "River",
    "SeaLake",
]


class Claim(BaseModel):
    id: int
    patta_holder_name: str
    father_or_husband_name: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    address: Optional[str] = None
    village_name: Optional[str] = None
    block: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    total_area_claimed: Optional[str] = None
    coordinates: str
    land_use: Optional[str] = None
    claim_id: Optional[str] = None
    date_of_application: Optional[str] = None


def parse_coordinate(coord_str: str):
    """Parse 'lat, lon' or 'lon, lat' strings and return (lat, lon)."""
    try:
        parts = [part.strip() for part in coord_str.replace(",", " ").split()]
        if len(parts) < 2:
            raise ValueError("coordinate string must have two numeric values")
        first, second = float(parts[0]), float(parts[1])

        if -90 <= first <= 90 and -180 <= second <= 180:
            lat, lon = first, second
        elif -90 <= second <= 90 and -180 <= first <= 180:
            lat, lon = second, first
        else:
            lat, lon = first, second

        return lat, lon
    except Exception as exc:
        raise ValueError(f"Could not parse coordinates: {exc}") from exc


def parse_area_to_m2(area_str: str):
    """Parse area strings like '1.00 acres', '0.5 ha', '4000 m2' into square meters."""
    if not area_str:
        return None

    text = area_str.strip().lower()
    try:
        tokens = text.split()
        num = float(tokens[0])
        unit = tokens[1] if len(tokens) > 1 else "acres"
    except Exception:
        import re

        match = re.match(r"([\d\.]+)", text)
        if not match:
            return None
        num = float(match.group(1))
        unit = text[match.end():].strip() or "acres"

    if unit.startswith("acre"):
        return num * 4046.8564224
    if unit.startswith("ha") or "hect" in unit:
        return num * 10000.0
    if unit.startswith("m") or "sq" in unit:
        return num
    return num * 4046.8564224


def make_square_polygon(lat, lon, area_m2):
    """Create an axis-aligned square polygon around (lat, lon) in lon/lat order."""
    if area_m2 is None or area_m2 <= 0:
        half_side = 50.0
    else:
        side = math.sqrt(area_m2)
        half_side = side / 2.0

    delta_lat = half_side / 111000.0
    delta_lon = half_side / (111000.0 * math.cos(math.radians(lat)) + 1e-9)
    p1 = (lon - delta_lon, lat - delta_lat)
    p2 = (lon + delta_lon, lat - delta_lat)
    p3 = (lon + delta_lon, lat + delta_lat)
    p4 = (lon - delta_lon, lat + delta_lat)
    return [p1, p2, p3, p4, p1]


def ee_polygon_from_coords(coords_list):
    return ee.Geometry.Polygon([coords_list])


def fetch_satellite_thumbnail(
    aoi_coords,
    start_date=EE_START_DATE,
    end_date=EE_END_DATE,
    dim=THUMB_DIM,
):
    initialize_gee()
    aoi = ee_polygon_from_coords(aoi_coords)
    image = (
        ee.ImageCollection("COPERNICUS/S2_HARMONIZED")
        .filterBounds(aoi)
        .filterDate(start_date, end_date)
        .select(["B4", "B3", "B2"])
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 60))
        .median()
        .clip(aoi)
    )
    vis = {"min": 0, "max": 3000, "bands": ["B4", "B3", "B2"]}
    return image.getThumbURL({"region": aoi, "dimensions": dim, "format": "png", **vis})


def download_image_from_url(url):
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def preprocess_for_model(pil_img, size=IMG_SIZE):
    img = pil_img.resize((size, size))
    arr = np.array(img).astype(np.float32) / 255.0
    return np.expand_dims(arr, axis=0)


def predict_with_model(img_array):
    if model is None:
        raise RuntimeError("Model not loaded on server. Place your Keras model at MODEL_PATH.")

    preds = model.predict(img_array, verbose=0)
    prob = float(np.max(preds))
    cls_idx = int(np.argmax(preds))
    cls_name = CLASS_NAMES[cls_idx] if cls_idx < len(CLASS_NAMES) else str(cls_idx)
    return {"class": cls_name, "class_index": cls_idx, "confidence": prob}


@router.get("/gee-health")
def gee_health():
    status = get_gee_status()
    if not status["initialized"]:
        raise HTTPException(status_code=503, detail=status)
    return status


@router.post("/predict")
def predict(claim: Claim):
    try:
        lat, lon = parse_coordinate(claim.coordinates)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid coordinate: {exc}") from exc

    area_m2 = parse_area_to_m2(claim.total_area_claimed or "")
    square_coords = make_square_polygon(lat, lon, area_m2)

    try:
        thumb_url = fetch_satellite_thumbnail(square_coords)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Earth Engine error: {exc}") from exc

    try:
        pil_img = download_image_from_url(thumb_url)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to download thumbnail: {exc}") from exc

    img_filename = f"{SAVED_IMAGES_DIR}/claim_{claim.id}.png"
    pil_img.save(img_filename)

    try:
        arr = preprocess_for_model(pil_img, size=IMG_SIZE)
        pred = predict_with_model(arr)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Model prediction error: {exc}") from exc

    return {
        "id": claim.id,
        "claim_id": claim.claim_id,
        "input_coordinates": {"lat": lat, "lon": lon},
        "polygon_coords_lonlat": square_coords,
        "thumbnail_url": thumb_url,
        "saved_image": img_filename,
        "model_prediction": pred,
    }


def root():
    return {"status": "ok", "note": "POST /predict with claim JSON to run the pipeline."}


def get_asset_data(coords_str: str):
    """
    Build a sampling AOI, fetch the satellite image via EE, and classify land type.
    Returns: (land_type, confidence, water_available, irrigation)
    """
    try:
        lat, lon = parse_coordinate(coords_str)
        square_coords = make_square_polygon(lat, lon, 500.0)

        thumb_url = fetch_satellite_thumbnail(square_coords)
        pil_img = download_image_from_url(thumb_url)

        arr = preprocess_for_model(pil_img, size=IMG_SIZE)
        pred = predict_with_model(arr)

        land_type = pred.get("class", "Unknown")
        confidence = pred.get("confidence", 0.0)

        if land_type in ["AnnualCrop", "PermanentCrop"]:
            water_available = False
            irrigation = False
        elif land_type in ["River", "SeaLake"]:
            water_available = True
            irrigation = True
        else:
            water_available = True
            irrigation = False

        return land_type, confidence, water_available, irrigation
    except Exception as exc:
        print(f"Error in get_asset_data helper: {exc}")
        return "Unknown", 0.0, False, False
