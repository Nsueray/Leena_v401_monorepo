-- ============================================================
-- Floor Plan Builder — Migration 001
-- Module: ELL Floor Plan Builder (Sprint 1)
-- Date: 2026-03-30
-- Description: Creates core tables for floor plan management
--
-- Tables: expo_halls, expo_floorplan_versions, expo_stands,
--         expo_stand_cells, expo_stand_assignments (Phase 2 stub)
--
-- Invariants enforced at DB level:
--   #1 — One active version per hall (partial unique index)
--   #3 — Cell uniqueness per version (UNIQUE constraint)
--   #4 — size_m2 auto-calc from cell count (trigger)
-- ============================================================

BEGIN;

-- ============================================================
-- HALL: Physical venue definition
-- ============================================================
CREATE TABLE expo_halls (
    id SERIAL PRIMARY KEY,
    expo_id INTEGER NOT NULL REFERENCES expos(id),
    organizer_id INTEGER NOT NULL,              -- Denormalized for scope isolation (matches existing convention)
    name VARCHAR(100) NOT NULL,                 -- "Hall 1", "Pavilion A", "Outdoor"
    grid_width INTEGER NOT NULL,                -- Grid width in cells (1 cell = 1m by default)
    grid_height INTEGER NOT NULL,               -- Grid height in cells
    cell_size_m2 NUMERIC(4,2) DEFAULT 1.0,      -- Cell size (default 1m²)
    total_area_sqm NUMERIC(10,2) GENERATED ALWAYS AS
        (grid_width * grid_height * cell_size_m2) STORED,
    metadata JSONB DEFAULT '{}',                -- Venue info, notes
    created_by INTEGER,                         -- User ID
    updated_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FLOORPLAN VERSION: Multiple plan versions per hall
-- ============================================================
-- Use cases:
--   - Pre-sales draft
--   - Revised version
--   - Version sent to client
--   - Final for print
--   - Answers "which PDF was from which plan?"
-- ============================================================
CREATE TABLE expo_floorplan_versions (
    id SERIAL PRIMARY KEY,
    hall_id INTEGER NOT NULL REFERENCES expo_halls(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,            -- 1, 2, 3...
    version_label VARCHAR(100),                 -- "Draft", "Sales v2", "Final", "Post-show"
    status VARCHAR(20) DEFAULT 'draft',         -- draft, active, archived
    notes TEXT,                                 -- Version notes
    cloned_from_version_id INTEGER REFERENCES expo_floorplan_versions(id),
    created_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    activated_at TIMESTAMPTZ,                   -- Timestamp when activated

    UNIQUE(hall_id, version_number)
);

-- ============================================================
-- STAND: Sellable area unit
-- ============================================================
-- Geometry: Cell-based — stand defined by its owned cells
-- Status: Two-layer — area_kind + commercial_status
-- LiFFY: Nullable FKs ready from day one
-- ============================================================
CREATE TABLE expo_stands (
    id SERIAL PRIMARY KEY,
    floorplan_version_id INTEGER NOT NULL
        REFERENCES expo_floorplan_versions(id) ON DELETE CASCADE,

    -- Identity
    stand_code VARCHAR(20) NOT NULL,            -- "A1", "B3", "C4"
    zone VARCHAR(50),                           -- "A", "B", "C", "D", "E"
    display_label VARCHAR(255),                 -- Label shown on grid

    -- Area type (what it is — structural, rarely changes)
    area_kind VARCHAR(20) NOT NULL DEFAULT 'stand',
        -- stand: sellable stand
        -- special: special area (VIP, conference, reg desk)
        -- blocked: blocked by organizer
    special_area_type VARCHAR(50),              -- When area_kind='special':
        -- vip, conference, registration, entrance, exit, technical, other

    -- Commercial status (only for area_kind='stand')
    commercial_status VARCHAR(30) DEFAULT 'available',
        -- available: open for sale
        -- hold: temporarily held (sales rep talking to client)
        -- reserved: option given
        -- pending_contract: proposal/contract in progress
        -- sold: contract signed

    -- Stand type
    stand_type VARCHAR(30) DEFAULT 'raw_space',
        -- raw_space, shell_scheme, island, corner, peninsula

    -- Calculated area (from cell count, synced via trigger — Invariant #4)
    size_m2 NUMERIC(10,2),

    -- Company assignment (MVP: text + nullable FKs)
    assigned_company_name VARCHAR(255),          -- Used in MVP
    company_id INTEGER,                         -- LiFFY FK (nullable, FK target TBD — Invariant #5)
    contract_id INTEGER,                        -- LiFFY FK (nullable, FK target TBD — Invariant #5)

    -- Reservation info
    reservation_type VARCHAR(30),               -- verbal, written, deposit_paid
    reserved_by_user_id INTEGER,                -- Which sales rep reserved
    reserved_until TIMESTAMPTZ,                 -- Option expiry date

    -- Price (optional)
    price_per_m2 NUMERIC(10,2),                 -- Per-stand price override

    -- Meta
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_by INTEGER,
    updated_by INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(floorplan_version_id, stand_code)
);

-- ============================================================
-- STAND CELLS: Which grid cells belong to this stand
-- ============================================================
-- Each row = 1 cell (1m²)
-- Stand geometry = sum of cells in this table
-- Supports L-shaped, irregular stands
-- floorplan_version_id denormalized for DB-level unique constraint
-- ============================================================
CREATE TABLE expo_stand_cells (
    id SERIAL PRIMARY KEY,
    stand_id INTEGER NOT NULL REFERENCES expo_stands(id) ON DELETE CASCADE,
    floorplan_version_id INTEGER NOT NULL
        REFERENCES expo_floorplan_versions(id),
    cell_x INTEGER NOT NULL,                    -- Grid X coordinate (0-based)
    cell_y INTEGER NOT NULL,                    -- Grid Y coordinate (0-based)

    UNIQUE(stand_id, cell_x, cell_y),
    -- CRITICAL: Same cell cannot belong to two stands in same version
    -- Enforced at DB level (Architectural Invariant #3)
    UNIQUE(floorplan_version_id, cell_x, cell_y)
);

-- ============================================================
-- STAND ASSIGNMENT HISTORY (Phase 2 stub)
-- ============================================================
-- Not used in MVP — expo_stands.assigned_company_name is sufficient
-- Activated with LiFFY integration
-- Tracks assignment history (this year Firm A, last year Firm B)
-- ============================================================
CREATE TABLE expo_stand_assignments (
    id SERIAL PRIMARY KEY,
    stand_id INTEGER NOT NULL REFERENCES expo_stands(id) ON DELETE CASCADE,
    company_id INTEGER,                         -- LiFFY companies FK
    contract_id INTEGER,                        -- LiFFY contracts FK
    assigned_by INTEGER,                        -- User ID
    assignment_type VARCHAR(30),                -- reservation, sale, sponsor, organizer
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    released_at TIMESTAMPTZ,                    -- When assignment released
    notes TEXT
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_expo_halls_expo ON expo_halls(expo_id);
CREATE INDEX idx_expo_halls_organizer ON expo_halls(organizer_id);
CREATE INDEX idx_expo_fpv_hall ON expo_floorplan_versions(hall_id);
CREATE INDEX idx_expo_fpv_status ON expo_floorplan_versions(status);
CREATE INDEX idx_expo_stands_fpv ON expo_stands(floorplan_version_id);
CREATE INDEX idx_expo_stands_status ON expo_stands(commercial_status);
CREATE INDEX idx_expo_stands_kind ON expo_stands(area_kind);
CREATE INDEX idx_expo_stand_cells_stand ON expo_stand_cells(stand_id);
CREATE INDEX idx_expo_stand_cells_pos ON expo_stand_cells(cell_x, cell_y);
CREATE INDEX idx_expo_stand_cells_version ON expo_stand_cells(floorplan_version_id);

-- ============================================================
-- CONSTRAINT: Only 1 active version per hall at a time
-- (Architectural Invariant #1)
-- ============================================================
CREATE UNIQUE INDEX idx_one_active_version_per_hall
    ON expo_floorplan_versions(hall_id)
    WHERE status = 'active';

-- ============================================================
-- TRIGGER: Auto-calculate size_m2 from cell count
-- (Architectural Invariant #4)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_update_stand_size_m2()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE expo_stands
    SET size_m2 = (
        SELECT COUNT(*)
        FROM expo_stand_cells
        WHERE stand_id = COALESCE(NEW.stand_id, OLD.stand_id)
    ),
    updated_at = NOW()
    WHERE id = COALESCE(NEW.stand_id, OLD.stand_id);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stand_size_after_cell_change
AFTER INSERT OR DELETE ON expo_stand_cells
FOR EACH ROW EXECUTE FUNCTION fn_update_stand_size_m2();

COMMIT;
