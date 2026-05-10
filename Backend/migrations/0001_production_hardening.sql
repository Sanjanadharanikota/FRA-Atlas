CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'analyst',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS asset_data (
    id SERIAL PRIMARY KEY,
    fra_id INTEGER REFERENCES fra_documents(id) ON DELETE CASCADE,
    land_type TEXT,
    water_available BOOLEAN,
    irrigation BOOLEAN,
    confidence FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fra_audit_logs (
    id SERIAL PRIMARY KEY,
    doc_id INTEGER,
    editor TEXT,
    action TEXT,
    previous_data JSONB,
    new_data JSONB,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schemes (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    eligibility JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS dss_logs (
    id SERIAL PRIMARY KEY,
    user_query TEXT NOT NULL,
    parsed JSONB DEFAULT '{}'::jsonb,
    scheme_id INTEGER,
    result_count INTEGER DEFAULT 0,
    sample JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dss_documents (
    id SERIAL PRIMARY KEY,
    filename TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    ingest_status TEXT DEFAULT 'uploaded',
    chunk_count INTEGER DEFAULT 0,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    indexed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fra_claim_id ON fra_documents (claim_id);
CREATE INDEX IF NOT EXISTS idx_fra_applicant_name ON fra_documents (patta_holder_name);
CREATE INDEX IF NOT EXISTS idx_fra_location ON fra_documents (state, district, village_name);
CREATE INDEX IF NOT EXISTS idx_dss_logs_created_at ON dss_logs (created_at DESC);
