<div align="center">

# 🌿 🏞️ FRA Atlas: A WebGIS-Based Intelligent Frontier for Forest Rights Decision Support

### Intelligent Forest Rights Monitoring & Decision Support System

[![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-Frontend-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Type%20Safe-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![TensorFlow](https://img.shields.io/badge/TensorFlow-CNN%20Model-FF6F00?style=for-the-badge&logo=tensorflow&logoColor=white)](https://tensorflow.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-PostGIS-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Google Earth Engine](https://img.shields.io/badge/Google%20Earth%20Engine-Satellite%20Intelligence-4285F4?style=for-the-badge&logo=googleearth&logoColor=white)](https://earthengine.google.com/)
[![Gemini AI](https://img.shields.io/badge/Gemini%20AI-RAG%20%2B%20OCR-8E75B2?style=for-the-badge&logo=google-gemini&logoColor=white)](https://deepmind.google/technologies/gemini/)
[![Blockchain Integrity](https://img.shields.io/badge/Blockchain-Hash%20Integrity-121D33?style=for-the-badge&logo=blockchaindotcom&logoColor=white)](#)
[![JWT Auth](https://img.shields.io/badge/JWT-Authentication-black?style=for-the-badge&logo=jsonwebtokens&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-success?style=for-the-badge)](LICENSE)

![GitHub stars](https://img.shields.io/github/stars/Sanjanadharanikota/FRA-Atlas?style=for-the-badge)
![GitHub forks](https://img.shields.io/github/forks/Sanjanadharanikota/FRA-Atlas?style=for-the-badge)
![GitHub repo size](https://img.shields.io/github/repo-size/Sanjanadharanikota/FRA-Atlas?style=for-the-badge)
![GitHub last commit](https://img.shields.io/github/last-commit/Sanjanadharanikota/FRA-Atlas?style=for-the-badge)




🔗 GitHub Repository: https://github.com/Sanjanadharanikota/FRA-Atlas

🎥 Project Demo Drive Link: https://drive.google.com/file/d/1Rg1kaTtZk92AK0yhVv4v0JDCluM5RyfN/view?usp=sharing

> **Digitizing Forest Rights for Transparent, Data-Driven, and Cryptographically Secure Governance.**


FRA Atlas is an AI-powered WebGIS platform designed for integrated monitoring of Forest Rights Act (FRA) implementation. The system digitizes FRA records using OCR and AI, integrates satellite-based land classification, provides blockchain-inspired record integrity, and delivers an intelligent Decision Support System (DSS) for government scheme recommendation and spatial monitoring.


</div>

---
## 📋 Table of Contents

- [The Problem](#-the-problem)
- [Solution Overview](#-solution-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [System Workflow](#-system-workflow)
- [Complete System Architecture](#-complete-system-architecture)
- [Tech Stack](#-tech-stack)
- [High-Level System Architecture](#-high-level-system-architecture)
- [Project Structure](#-project-structure)
- [API Reference](#-api-reference)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Database Schema](#-database-schema)
- [ML Model](#-ml-model)
- [RAG-Powered DSS](#-rag-powered-dss)
- [Role-Based Access Control](#-role-based-access-control)
- [Project Status](#-project-status)
- [Research Papers & References](#-research-papers--references)
- [Team](#-team)

---

## 🌍 The Problem

India's Forest Rights Act (2006) was designed to recognize and vest the rights of forest-dwelling communities over land they have occupied for generations. However, implementation suffers from deep structural gaps:

- **Fragmented Records** — FRA claims, GIS maps, and Census data exist in isolated, non-digital silos.
- **Manual Verification** — Field staff verify documents entirely by hand, with no spatial cross-referencing.
- **No Accountability** — There is no audit trail when records are altered, making tampering undetectable.
- **Zero Satellite Correlation** — Claimed land coordinates are never cross-checked against actual satellite land cover.
- **Scheme Exclusion** — FRA patta holders are rarely linked to the government welfare schemes they are eligible for.

---

## 💡 Solution Overview

FRA Atlas AI operates across **four core pillars**:

| Pillar | What It Does |
|--------|-------------|
| **🔍 Automated Digitization** | Paper scans → structured data via Tesseract OCR + Google Gemini LLM |
| **⛓️ Cryptographic Validation** | Every record is SHA-256 chained; tampering is detected in real time |
| **🛰️ Spatial Intelligence** | GPS coordinates → GEE Sentinel-2 imagery → MobileNetV2 CNN land classification |
| **🤖 RAG-Powered DSS** | Policy PDFs ingested and indexed; hybrid LLM + vector search for scheme recommendations |

---

## ✨ Key Features

### 🔐 JWT Authentication & Role-Based Access Control

Full authentication system with secure password hashing and token-based sessions:

- **PBKDF2-SHA256** password hashing with random salting (100,000 iterations).
- **JWT tokens** (HS256) with configurable expiry via `JWT_EXP_MINUTES`.
- **Two roles**: `admin` (full access) and `analyst` (read + query access).
- **Bootstrap admin** auto-created on first startup from environment variables.
- Protected routes using `Depends(require_roles(...))` guards across all sensitive endpoints.

### ⛓️ Forensic Blockchain & Audit System

Every document stored in the database is part of a cryptographic hash chain:

- **Sequential SHA-256 Hashing** — Each record's `current_hash` is derived from its data and the previous record's hash.
- **Smart Edit Rippling** — Editing or deleting a record automatically recalculates all downstream hashes forward.
- **Forensic Audit Logs (`fra_audit_logs`)** — Every `EDIT` or `DELETE` action captures the editor's IP, timestamp, and a full **before/after JSON snapshot**.
- **Real-Time Chain Verification** (`GET /upload/verify-chain`) — Instantly surfaces the exact record ID and expected vs. actual hash if tampering is detected.

### 🗺️ Advanced Geospatial Atlas

A fully interactive React Leaflet map with:

- **Density Heatmaps & Intelligent Clustering** — Handles thousands of FRA claim records without performance degradation.
- **Village Coverage Zones** — Projects approximate village perimeters by calculating the centroid of all claim coordinates within a jurisdiction.
- **Deterministic Spatial Jitter** — Prevents coordinate stacking by generating a unique, reproducible GPS offset for each claimant derived from their name.
- **Gemini Geocoding Fallback** — When OpenStreetMap fails to resolve an obscure Indian village name, Gemini AI estimates precise GPS coordinates.
- **Extended Geometry Support** — New `geometry_geojson`, `geometry_source`, and `geometry_status` columns enable polygon-level spatial representation beyond simple points.

### 🛰️ Automated Satellite Asset Extraction

Triggered automatically on every document confirmation (`POST /upload/confirm`):

1. Parses the claim's GPS coordinates.
2. Builds a bounding polygon scaled to the claimed land area.
3. Queries **Google Earth Engine** for a Sentinel-2 median composite (B4/B3/B2 bands, cloud cover < 60%).
4. Passes the image to a **MobileNetV2 CNN** (`best_model.h5`) trained on the EuroSAT dataset.
5. Stores `land_type`, `confidence`, `water_available`, and `irrigation` in the `asset_data` table — immutably linked to the claim.

**Classified Land Types**: AnnualCrop · Forest · HerbaceousVegetation · Highway · Industrial · Pasture · PermanentCrop · Residential · River · SeaLake

### 🤖 Hybrid RAG Decision Support System (DSS)

The most significant new addition. Officers can query scheme eligibility using natural language, with answers grounded in real policy documents:

- **PDF Ingestion** — Admins upload government policy PDFs (FRA Act, DAJGUA guidelines, MPR reports) directly via the API.
- **Chunking & Embedding** — PDFs are split into 900-character chunks and embedded using Google Gemini (`models/embedding-001`), with a local SHA-256 hash fallback when the API is unavailable.
- **Vector Index** — Embeddings stored in a JSON flat-file index (`dss_index.json`) with cosine similarity retrieval.
- **Hybrid LLM Query** — User queries trigger structured database matching AND semantic chunk retrieval, fused into a single Gemini-powered recommendation.
- **Per-Applicant Recommendations** — Select any FRA applicant by ID to get personalized scheme suggestions based on their land type, claim type, satellite asset data, and indexed policy documents.
- **Context Themes** — Eight predefined context themes (irrigation, drinking water, housing, livelihood, agriculture, forest management, land development, convergence) boost relevant scheme scores automatically.

**Supported Schemes**: PM-KISAN · PMKSY · MGNREGA · Jal Jeevan Mission · PM Awas Yojana · DAJGUA · Forest Rights Act Support

### 📄 OCR Document Pipeline

- Upload a scanned FRA document (image or PDF).
- **Tesseract / Google Vision** extracts raw text.
- **Gemini LLM** cleans and structures the text into a validated JSON payload.
- Officers review and confirm — triggering geocoding, satellite classification, and blockchain insertion atomically.

### ❤️ Health & Observability

New `/health` endpoints for production readiness:

- `GET /health/live` — Liveness check (service is running).
- `GET /health/ready` — Readiness check (verifies database connectivity, GEE status, and DSS index path).

---

## 🏗️ Architecture

FRA Atlas operates as an integrated AI + WebGIS platform across **four core pillars**:
## 🖼️ System Workflow

![FRAAtlas Workflow](assets/system-workflow.jpeg)

```
┌──────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                           │
│  Login · Signup · Dashboard · Atlas · Upload · DSS · Support     │
└──────────────────────────┬───────────────────────────────────────┘
                           │ REST API  ·  Bearer JWT
┌──────────────────────────▼───────────────────────────────────────┐
│                      Backend (FastAPI v1.0.0)                     │
│                                                                   │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐  │
│  │ auth_router  │  │upload_router│  │dss_router│  │model_pred│  │
│  │              │  │             │  │          │  │          │  │
│  │ JWT signup   │  │ OCR → LLM   │  │ RAG DSS  │  │GEE + CNN │  │
│  │ login / me   │  │ Hash chain  │  │ PDF index│  │Sentinel-2│  │
│  │ PBKDF2 hash  │  │ Blockchain  │  │ Gemini   │  │MobileNet │  │
│  └──────────────┘  └──────┬──────┘  └────┬─────┘  └──────────┘  │
└──────────────────────────────────────────────────────────────────┘
                            │              │
┌───────────────────────────▼──────────────▼──────────────────────┐
│                   PostgreSQL + PostGIS                            │
│  users · fra_documents · asset_data · fra_audit_logs             │
│  schemes · dss_logs · dss_documents                              │
└──────────────────────────────────────────────────────────────────┘
                                        │
                        ┌───────────────▼───────────────┐
                        │  data/dss_docs/  (PDFs)        │
                        │  data/dss_index.json (vectors) │
                        └───────────────────────────────┘
```

---


## 🏛️ Complete System Architecture

![Complete System Architecture](assets/final-architecture.jpeg)


---


## 🛠️ Tech Stack

### Frontend
| Technology | Purpose |
|-----------|---------|
| React 18 + TypeScript | UI framework |
| Vite | Build tool |
| Tailwind CSS + shadcn/ui | Styling & components |
| React Leaflet | Interactive geospatial map |
| Lucide React | Icons |

### Backend
| Technology | Purpose |
|-----------|---------|
| FastAPI (Python) | REST API framework |
| PostgreSQL + PostGIS | Spatial database with geometry support |
| psycopg2 | Database driver |
| SQLAlchemy + Alembic | ORM & migrations |
| python-jose | JWT encode/decode |
| PBKDF2-HMAC-SHA256 | Password hashing |

### AI / ML
| Technology | Purpose |
|-----------|---------|
| Tesseract / Google Vision | OCR from scanned documents |
| Google Gemini (LangChain) | LLM for data structuring, DSS queries, geocoding fallback |
| Gemini Embeddings (`embedding-001`) | Vector embeddings for RAG DSS |
| TensorFlow / Keras | MobileNetV2 CNN for land classification |
| Google Earth Engine | Sentinel-2 satellite imagery |
| pypdf | PDF text extraction for RAG ingestion |
| EuroSAT Dataset | CNN training data |

---
## 🏗️ High-Level System Architecture
![High Level Architecture](assets/high-level-architecture.jpeg)

---
## 📂 Project Structure

```
fra-atlas/
├── Backend/
│   ├── main.py                    # FastAPI app, CORS, startup, health endpoints
│   ├── db.py                      # Database connection, query helpers, schema init
│   ├── settings.py                # Typed settings via dataclass + lru_cache
│   ├── fra.db                     # SQLite (dev) / PostgreSQL (prod)
│   ├── best_model.h5              # Trained MobileNetV2 Keras model
│   ├── requirements.txt
│   ├── data/
│   │   ├── dss_docs/              # Uploaded policy PDFs (FRA Act, DAJGUA, MPR)
│   │   └── dss_index.json         # Flat-file vector index for RAG retrieval
│   ├── migrations/
│   │   └── 0001_production_hardening.sql  # Full schema with indexes
│   ├── routers/
│   │   ├── auth_router.py         # /auth — signup, login, /me
│   │   ├── upload_router.py       # /upload — OCR, confirm, CRUD, blockchain, audit
│   │   ├── dss_router.py          # /dss — schemes, RAG assistant, per-applicant DSS
│   │   ├── model_pred.py          # /model — GEE satellite fetch + CNN classification
│   │   └── Search_router.py       # Document search
│   ├── services/
│   │   ├── rag_service.py         # Full RAG pipeline: ingest, embed, retrieve, respond
│   │   └── scheme_service.py      # Structured scheme eligibility matching
│   └── utils/
│       ├── auth_utils.py          # JWT Bearer dependency, require_roles()
│       ├── security_utils.py      # PBKDF2 hashing, JWT create/decode
│       ├── llm_utils.py           # Gemini LLM calls
│       ├── ocr_utils.py           # Tesseract / Vision OCR
│       ├── gee_utils.py           # Google Earth Engine helpers
│       ├── api_utils.py           # Standardised success_response / error_response
│       └── env_utils.py           # .env loading
│
└── Frontend/
    └── src/
        ├── lib/api.ts             # Centralised API client with auth headers
        ├── components/            # Chatbot, Header, Layout, ProtectedRoute, shadcn/ui
        ├── hooks/                 # use-auth, use-mobile, use-toast
        └── pages/                 # Atlas, Dashboard, Upload, Login, Signup, Support, DSS
```

---

## 📡 API Reference

> All protected endpoints require `Authorization: Bearer <token>` header.
> Roles: `admin` > `analyst`.

### Auth (`/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/signup` | Public | Register a new analyst account |
| `POST` | `/auth/login` | Public | Login and receive a JWT |
| `GET` | `/auth/me` | Any role | Get the current authenticated user |

### Upload (`/upload`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/upload/` | analyst+ | Upload a scanned document; returns OCR-extracted structured data |
| `POST` | `/upload/confirm` | analyst+ | Finalize document; triggers geocoding, CNN classification & blockchain insert |
| `POST` | `/upload/preview` | analyst+ | Preview geocoded data without committing to the database |
| `GET` | `/upload/all` | analyst+ | Retrieve all FRA documents |
| `GET` | `/upload/verify-chain` | analyst+ | Verify cryptographic integrity of the entire blockchain |
| `PUT` | `/upload/{doc_id}` | analyst+ | Edit a document; ripples hash chain and logs audit entry |
| `DELETE` | `/upload/{doc_id}` | admin | Delete a document; logs audit entry and repairs hash chain |
| `GET` | `/upload/{doc_id}/audit-history` | analyst+ | Full edit/delete history for a document |
| `GET` | `/upload/{doc_id}/assets` | analyst+ | CNN satellite classification results for a document |

### DSS (`/dss`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/dss/schemes` | admin | Register a new government scheme |
| `GET` | `/dss/schemes` | analyst+ | List all registered schemes |
| `GET` | `/dss/documents` | analyst+ | List all ingested DSS policy PDFs (paginated) |
| `POST` | `/dss/documents` | admin | Upload one or more policy PDFs; triggers chunking & embedding |
| `GET` | `/dss/applicants` | analyst+ | List all FRA applicants (searchable, paginated) |
| `POST` | `/dss/assistant` | analyst+ | Natural language hybrid RAG query |
| `POST` | `/dss/applicants/{id}/recommendations` | analyst+ | Per-applicant scheme recommendations |
| `GET` | `/dss/check?q=...` | analyst+ | Simple natural language eligibility check |

### Model (`/model`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/model/predict` | analyst+ | Run full GEE + CNN pipeline on a claim |

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health/live` | Public | Liveness probe |
| `GET` | `/health/ready` | Public | Readiness probe (DB + GEE + DSS index) |

---

## 🚀 Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+ (or Bun)
- PostgreSQL with PostGIS extension
- Google Earth Engine account (authenticated)
- Google Gemini API key

### 1. Clone the Repository

```bash
git clone https://github.com/Sanjanadharanikota/FRA-Atlas  
cd fra-atlas
```

### 2. Backend Setup

```bash
cd Backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate        # macOS/Linux
# .venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Authenticate Google Earth Engine (one-time)
earthengine authenticate

# Configure environment variables
cp .env.example .env
# Edit .env with your credentials

# Run the database migration
psql -U your_user -d fra_atlas -f migrations/0001_production_hardening.sql

# Start the FastAPI server
uvicorn main:app --reload --port 8000
```

The API is available at `http://localhost:8000`. Swagger docs at `http://localhost:8000/docs`.

> **First run:** A bootstrap admin is automatically created using `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` from your `.env`.

### 3. Frontend Setup

```bash
cd Frontend

npm install      # or: bun install
npm run dev      # or: bun run dev
```

The app is available at `http://localhost:5173`.

### 4. Ingest DSS Policy Documents

Once logged in as admin, upload the policy PDFs:

```bash
curl -X POST http://localhost:8000/dss/documents \
  -H "Authorization: Bearer <admin_token>" \
  -F "files=@data/dss_docs/FRAActnRulesBook_.pdf" \
  -F "files=@data/dss_docs/Guidelines4Interventions....pdf"
```

This triggers automatic PDF extraction, chunking, and Gemini embedding.

---

## 🔐 Environment Variables

Create a `.env` file in the `Backend/` directory:

```env
# Application
APP_ENV=development
DEBUG=false

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/fra_atlas

# Google AI
GEMINI_API_KEY=AIzaSy...
GEE_PROJECT_ID=your-gee-project-id

# JWT Auth
JWT_SECRET=your-long-random-secret-key
JWT_EXP_MINUTES=120

# Bootstrap Admin (created on first startup)
BOOTSTRAP_ADMIN_EMAIL=admin@fra-atlas.local
BOOTSTRAP_ADMIN_PASSWORD=Admin@12345

# CORS (comma-separated origins)
CORS_ORIGINS=http://localhost:5173,http://localhost:8080
```

---

## 🗄️ Database Schema

### `users`
| Column | Type | Description |
|--------|------|-------------|
| `email` | TEXT UNIQUE | Login email |
| `password_hash` | TEXT | PBKDF2-SHA256 salted hash |
| `role` | TEXT | `admin` or `analyst` |
| `is_active` | BOOLEAN | Account enabled flag |

### `fra_documents`
| Column | Type | Description |
|--------|------|-------------|
| `claim_id` | TEXT UNIQUE | Unique claim reference |
| `claim_type` | TEXT | IFR / CR / CFR |
| `coordinates` | TEXT | `lat, lon` string |
| `latitude / longitude` | DOUBLE PRECISION | Parsed numeric coordinates |
| `geometry_geojson` | JSONB | Full polygon geometry |
| `geometry_status` | TEXT | `point_only` / `polygon` |
| `area_acres` | DOUBLE PRECISION | Parsed numeric area |
| `previous_hash` | TEXT | SHA-256 of previous record |
| `current_hash` | TEXT | SHA-256 of this record |

### `asset_data`
| Column | Type | Description |
|--------|------|-------------|
| `fra_id` | FK → fra_documents | CASCADE DELETE |
| `land_type` | TEXT | CNN-predicted class |
| `confidence` | FLOAT | Model confidence (0–1) |
| `water_available` | BOOLEAN | Derived from land type |
| `irrigation` | BOOLEAN | Derived from land type |

### `fra_audit_logs`
| Column | Type | Description |
|--------|------|-------------|
| `editor` | TEXT | IP address / user ID |
| `action` | TEXT | `EDIT` or `DELETE` |
| `previous_data` | JSONB | Record snapshot before change |
| `new_data` | JSONB | Record snapshot after change |

### `dss_documents`
| Column | Type | Description |
|--------|------|-------------|
| `stored_path` | TEXT | Disk path in `data/dss_docs/` |
| `ingest_status` | TEXT | `uploaded` → `indexing` → `indexed` / `error` |
| `chunk_count` | INTEGER | Number of indexed chunks |

**Indexes**: `claim_id`, `patta_holder_name`, `(state, district, village_name)`, `dss_logs.created_at DESC`

---

## 🛰️ ML Model

The CNN model (`best_model.h5`) is a **MobileNetV2** architecture fine-tuned on the [EuroSAT](https://github.com/phelber/EuroSAT) Sentinel-2 dataset for 10-class land cover classification.

**Inference pipeline:**
1. Parse GPS coordinates from a confirmed FRA claim.
2. Build a bounding polygon scaled to claimed land area (default: 500 m²).
3. Query GEE for Sentinel-2 median composite (2023, cloud cover < 60%).
4. Download 512×512 RGB thumbnail (B4/B3/B2).
5. Resize to 64×64, normalize to [0, 1].
6. Run inference → top-1 class + confidence.
7. Map class to `water_available` and `irrigation` booleans.

**Class → Asset mapping:**

| Land Type | Water Available | Irrigation |
|-----------|----------------|-----------|
| AnnualCrop, PermanentCrop | ❌ | ❌ |
| River, SeaLake | ✅ | ✅ |
| All others | ✅ | ❌ |

---

## 🤖 RAG-Powered DSS

The DSS uses a **hybrid retrieval-augmented generation** pipeline:

```
User Query
    │
    ├─► Parse with Gemini LLM (extract scheme, village, district, state)
    │
    ├─► Structured DB match (fra_documents × scheme eligibility rules)
    │
    ├─► Semantic retrieval (cosine similarity on dss_index.json)
    │
    └─► Hybrid Gemini LLM fusion → ranked recommendations + citations
```

**Embedding backends** (automatic fallback):
1. **Gemini** `models/embedding-001` — primary, 768-dim
2. **Local SHA-256 hash** — fallback when API unavailable, 256-dim

**Per-applicant mode**: Builds rich context from land use, claim type, satellite asset data, and policy documents → prioritised scheme recommendations with citations.

---

## 🔐 Role-Based Access Control

| Action | admin | analyst |
|--------|-------|---------|
| Signup / Login | ✅ | ✅ |
| View documents & run queries | ✅ | ✅ |
| Upload & confirm FRA docs | ✅ | ✅ |
| Upload DSS policy PDFs | ✅ | ❌ |
| Create/manage schemes | ✅ | ❌ |
| Delete FRA documents | ✅ | ❌ |

---

## 📊 Project Status

| Feature | Status |
|---------|--------|
| JWT Auth (signup / login / roles) | ✅ Complete |
| OCR Document Upload Pipeline | ✅ Complete |
| Gemini LLM Data Structuring | ✅ Complete |
| Forensic Blockchain & Audit Logs | ✅ Complete |
| Hash Ripple on Edit / Delete | ✅ Complete |
| Real-Time Chain Verification | ✅ Complete |
| Satellite Asset Extraction (CNN) | ✅ Complete |
| Google Earth Engine Integration | ✅ Complete |
| Smart Geocoding + Jitter | ✅ Complete |
| Atlas Map with Heatmaps | ✅ Live |
| RAG DSS (PDF ingestion + hybrid LLM) | ✅ Complete |
| Per-Applicant Scheme Recommendations | ✅ Complete |
| Health Endpoints (live / ready) | ✅ Complete |
| Production DB Migration Script | ✅ Complete |
| Polygon-Level Geometry Support | ✅ Schema Ready |
| Mobile Responsive UI | 🔜 Planned |

---

## 📚 Research Papers & References

[1] Ministry of Tribal Affairs, Government of India, *“Forest Rights Act, 2006 and Rules (FRA Act & Rules Book),”* New Delhi, India.  
Available: https://tribal.nic.in/FRA.aspx

[2] Ministry of Tribal Affairs, Government of India, *“Guidelines for Interventions Implemented by MoTA under DAJGUA,”* New Delhi, India, 2024.

[3] Ministry of Tribal Affairs, Government of India, *“Monthly Progress Report (MPR) on Implementation of Forest Rights Act,”* July 2025.

[4] M. Manimegala, T. Gayathri, M. Deva Harsar, Y. Hans Rohit, *“AI-Powered FRA Atlas & WebGIS Decision Support System,”* International Journal of Innovative Research in Technology (IJIRT), Paper ID: IJIRT195690.  
Available: https://ijirt.org/publishedpaper/IJIRT195690_PAPER.pdf

[5] National Tribal Knowledge Portal, *“FRA Atlas - Project Keywords,”* Ministry of Tribal Affairs, Government of India.  
Available: https://knowledge.tribal.gov.in/project_keywords/fra-atlas/

[6] Smart Forests, *“Forest Rights Act,”* Smart Forests Atlas Logbooks.  
Available: http://atlas.smartforests.net/en/logbooks/forest-rights-act/

[7] M. Drusch et al., *“Sentinel-2: ESA's Optical High-Resolution Mission for GMES Operational Services,”* Remote Sensing of Environment, vol. 120, pp. 25–36, 2012.

---
## 🚀 Future Scope

- Real-time satellite monitoring
- Mobile app for field officers
- Multi-language OCR support
- IoT-based environmental monitoring
- Automated policy analytics

----

## 👥 Team

| Member | Responsibility |
|--------|---------------|
| D. Sanjana | Authentication System, OCR & NER Integration, Blockchain Integrity Layer, WebGIS Development |
| B. Shiva Sai | AI-Based Asset Identification, CNN Model Training, Satellite Classification Pipeline, DSS Engine Development |
| P. Kowshika | Research, Testing, Documentation & System Validation |

---
<div align="center">

*Empowering forest communities through AI-powered spatial intelligence and transparent governance.*


</div>
