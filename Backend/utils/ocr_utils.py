import io
from pathlib import Path

from PIL import Image, ImageSequence
import pytesseract
from pypdf import PdfReader

# ✅ Explicitly tell pytesseract where Tesseract is installed (Windows fix)
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def _extract_from_image_bytes(file_bytes: bytes) -> str:
    image = Image.open(io.BytesIO(file_bytes))
    frames = (
        [frame.convert("RGB") for frame in ImageSequence.Iterator(image)]
        if getattr(image, "is_animated", False)
        else [image.convert("RGB")]
    )
    text_parts = [pytesseract.image_to_string(frame, lang="eng").strip() for frame in frames]
    return "\n\n".join(part for part in text_parts if part)


def _extract_from_pdf_bytes(file_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(file_bytes))
    text_parts = []
    for page in reader.pages:
        text = (page.extract_text() or "").strip()
        if text:
            text_parts.append(text)
    return "\n\n".join(text_parts)


def extract_text_from_file(file_bytes: bytes, filename: str = "") -> str:
    """
    Extract text from an uploaded image file (bytes) using Tesseract OCR.
    Supports PNG, JPG, JPEG, etc.
    """
    try:
        suffix = Path(filename or "").suffix.lower()
        if suffix == ".pdf":
            text = _extract_from_pdf_bytes(file_bytes)
        else:
            text = _extract_from_image_bytes(file_bytes)

        if not text.strip():
            raise RuntimeError("No readable text could be extracted from the uploaded file.")

        return text.strip()

    except Exception as e:
        # Return clean error message if OCR fails
        raise RuntimeError(f"OCR extraction failed: {str(e)}")
