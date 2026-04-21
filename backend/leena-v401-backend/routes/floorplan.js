/**
 * Floor Plan Builder Routes
 * Leena EMS — ELL Extension
 *
 * Sprint 1 Endpoints:
 *   GET    /api/floorplan/halls?expo_id=X              — List halls for expo
 *   POST   /api/floorplan/halls                        — Create hall
 *   PUT    /api/floorplan/halls/:id                    — Update hall
 *   GET    /api/floorplan/halls/:hallId/versions       — List versions for hall
 *   POST   /api/floorplan/halls/:hallId/versions       — Create new draft version
 *   GET    /api/floorplan/versions/:versionId/stands   — All stands + cells for version
 *   POST   /api/floorplan/versions/:versionId/stands   — Create stand with cells (transaction)
 *   DELETE /api/floorplan/stands/:id                   — Delete stand (cells cascade)
 *
 * Sprint 2 Endpoints:
 *   PUT    /api/floorplan/stands/:id                   — Update stand (general fields)
 *   PUT    /api/floorplan/stands/:id/status            — Update commercial status only
 *   POST   /api/floorplan/versions/:id/activate        — Activate version (draft→active)
 *   PUT    /api/floorplan/versions/:id                 — Update version label/notes
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// ============================================================
// HALLS
// ============================================================

// GET /api/floorplan/halls?expo_id=X
router.get('/halls', authMiddleware, async (req, res) => {
  try {
    const { expo_id } = req.query;
    const organizer_id = req.organizer_id;

    if (!expo_id) {
      return res.status(400).json({ success: false, message: 'expo_id is required' });
    }

    const result = await pool.query(
      `SELECT h.*,
              (SELECT COUNT(*) FROM expo_floorplan_versions v WHERE v.hall_id = h.id) AS version_count
       FROM expo_halls h
       WHERE h.expo_id = $1 AND h.organizer_id = $2
       ORDER BY h.created_at ASC`,
      [expo_id, organizer_id]
    );

    res.json({ success: true, halls: result.rows });
  } catch (err) {
    console.error('[floorplan] Error fetching halls:', err);
    res.status(500).json({ success: false, message: 'Failed to load halls' });
  }
});

// POST /api/floorplan/halls
router.post('/halls', authMiddleware, async (req, res) => {
  try {
    const organizer_id = req.organizer_id;
    const { expo_id, name, grid_width, grid_height, cell_size_m2, metadata } = req.body;

    if (!expo_id || !name || !grid_width || !grid_height) {
      return res.status(400).json({ success: false, message: 'expo_id, name, grid_width, and grid_height are required' });
    }

    if (!Number.isInteger(grid_width) || !Number.isInteger(grid_height) || grid_width < 1 || grid_height < 1) {
      return res.status(400).json({ success: false, message: 'grid_width and grid_height must be positive integers' });
    }

    if (grid_width > 200 || grid_height > 200) {
      return res.status(400).json({ success: false, message: 'Grid dimensions cannot exceed 200x200' });
    }

    // Verify expo belongs to organizer
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expo_id, organizer_id]
    );
    if (expoCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Expo not found' });
    }

    const result = await pool.query(
      `INSERT INTO expo_halls (expo_id, organizer_id, name, grid_width, grid_height, cell_size_m2, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [expo_id, organizer_id, name, grid_width, grid_height, cell_size_m2 || 1.0, metadata || '{}', organizer_id]
    );

    res.status(201).json({ success: true, hall: result.rows[0] });
  } catch (err) {
    console.error('[floorplan] Error creating hall:', err);
    res.status(500).json({ success: false, message: 'Failed to create hall' });
  }
});

// PUT /api/floorplan/halls/:id
router.put('/halls/:id', authMiddleware, async (req, res) => {
  try {
    const hallId = req.params.id;
    const organizer_id = req.organizer_id;
    const { name, grid_width, grid_height, cell_size_m2, metadata } = req.body;

    // Build dynamic update
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (grid_width !== undefined) {
      if (!Number.isInteger(grid_width) || grid_width < 1 || grid_width > 200) {
        return res.status(400).json({ success: false, message: 'grid_width must be a positive integer (max 200)' });
      }
      updates.push(`grid_width = $${idx++}`); values.push(grid_width);
    }
    if (grid_height !== undefined) {
      if (!Number.isInteger(grid_height) || grid_height < 1 || grid_height > 200) {
        return res.status(400).json({ success: false, message: 'grid_height must be a positive integer (max 200)' });
      }
      updates.push(`grid_height = $${idx++}`); values.push(grid_height);
    }
    if (cell_size_m2 !== undefined) { updates.push(`cell_size_m2 = $${idx++}`); values.push(cell_size_m2); }
    if (metadata !== undefined) { updates.push(`metadata = $${idx++}`); values.push(metadata); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    updates.push(`updated_by = $${idx++}`); values.push(organizer_id);
    updates.push(`updated_at = NOW()`);

    values.push(hallId, organizer_id);

    const result = await pool.query(
      `UPDATE expo_halls SET ${updates.join(', ')}
       WHERE id = $${idx++} AND organizer_id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Hall not found' });
    }

    res.json({ success: true, hall: result.rows[0] });
  } catch (err) {
    console.error('[floorplan] Error updating hall:', err);
    res.status(500).json({ success: false, message: 'Failed to update hall' });
  }
});

// ============================================================
// FLOORPLAN VERSIONS
// ============================================================

// GET /api/floorplan/halls/:hallId/versions
router.get('/halls/:hallId/versions', authMiddleware, async (req, res) => {
  try {
    const hallId = req.params.hallId;
    const organizer_id = req.organizer_id;

    // Verify hall belongs to organizer
    const hallCheck = await pool.query(
      'SELECT id FROM expo_halls WHERE id = $1 AND organizer_id = $2',
      [hallId, organizer_id]
    );
    if (hallCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Hall not found' });
    }

    const result = await pool.query(
      `SELECT v.*,
              (SELECT COUNT(*) FROM expo_stands s WHERE s.floorplan_version_id = v.id) AS stand_count
       FROM expo_floorplan_versions v
       WHERE v.hall_id = $1
       ORDER BY v.version_number DESC`,
      [hallId]
    );

    res.json({ success: true, versions: result.rows });
  } catch (err) {
    console.error('[floorplan] Error fetching versions:', err);
    res.status(500).json({ success: false, message: 'Failed to load versions' });
  }
});

// POST /api/floorplan/halls/:hallId/versions
router.post('/halls/:hallId/versions', authMiddleware, async (req, res) => {
  try {
    const hallId = req.params.hallId;
    const organizer_id = req.organizer_id;
    const { version_label, notes } = req.body;

    // Verify hall belongs to organizer
    const hallCheck = await pool.query(
      'SELECT id FROM expo_halls WHERE id = $1 AND organizer_id = $2',
      [hallId, organizer_id]
    );
    if (hallCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Hall not found' });
    }

    // Get next version number
    const maxVersion = await pool.query(
      'SELECT COALESCE(MAX(version_number), 0) AS max_num FROM expo_floorplan_versions WHERE hall_id = $1',
      [hallId]
    );
    const nextVersion = maxVersion.rows[0].max_num + 1;

    const result = await pool.query(
      `INSERT INTO expo_floorplan_versions (hall_id, version_number, version_label, status, notes, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5)
       RETURNING *`,
      [hallId, nextVersion, version_label || `Draft v${nextVersion}`, notes || null, organizer_id]
    );

    res.status(201).json({ success: true, version: result.rows[0] });
  } catch (err) {
    console.error('[floorplan] Error creating version:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Version number conflict, please retry' });
    }
    res.status(500).json({ success: false, message: 'Failed to create version' });
  }
});

// PUT /api/floorplan/versions/:id — Update version label/notes (not status)
router.put('/versions/:id', authMiddleware, async (req, res) => {
  try {
    const versionId = req.params.id;
    const organizer_id = req.organizer_id;
    const { version_label, notes } = req.body;

    // Verify ownership
    const check = await pool.query(
      `SELECT v.id FROM expo_floorplan_versions v
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE v.id = $1 AND h.organizer_id = $2`,
      [versionId, organizer_id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Version not found' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (version_label !== undefined) { updates.push(`version_label = $${idx++}`); values.push(version_label); }
    if (notes !== undefined) { updates.push(`notes = $${idx++}`); values.push(notes); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(versionId);
    const result = await pool.query(
      `UPDATE expo_floorplan_versions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json({ success: true, version: result.rows[0] });
  } catch (err) {
    console.error('[floorplan] Error updating version:', err);
    res.status(500).json({ success: false, message: 'Failed to update version' });
  }
});

// POST /api/floorplan/versions/:id/activate — Draft → Active (archives current active)
router.post('/versions/:id/activate', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const versionId = req.params.id;
    const organizer_id = req.organizer_id;

    // Verify ownership and get version + hall info
    const check = await client.query(
      `SELECT v.id, v.status, v.hall_id
       FROM expo_floorplan_versions v
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE v.id = $1 AND h.organizer_id = $2`,
      [versionId, organizer_id]
    );
    if (check.rows.length === 0) {
      client.release();
      return res.status(404).json({ success: false, message: 'Version not found' });
    }

    const version = check.rows[0];
    if (version.status !== 'draft') {
      client.release();
      return res.status(400).json({ success: false, message: 'Only draft versions can be activated' });
    }

    await client.query('BEGIN');

    // Archive current active version for this hall (if any)
    await client.query(
      `UPDATE expo_floorplan_versions SET status = 'archived'
       WHERE hall_id = $1 AND status = 'active'`,
      [version.hall_id]
    );

    // Activate this version
    const result = await client.query(
      `UPDATE expo_floorplan_versions SET status = 'active', activated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [versionId]
    );

    await client.query('COMMIT');

    res.json({ success: true, version: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[floorplan] Error activating version:', err);
    res.status(500).json({ success: false, message: 'Failed to activate version' });
  } finally {
    client.release();
  }
});

// POST /api/floorplan/versions/:id/clone — Clone version (all stands + cells)
router.post('/versions/:id/clone', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const versionId = req.params.id;
    const organizer_id = req.organizer_id;
    const { clear_assignments } = req.body || {};

    // Verify ownership
    const check = await client.query(
      `SELECT v.*, h.id AS hall_id
       FROM expo_floorplan_versions v
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE v.id = $1 AND h.organizer_id = $2`,
      [versionId, organizer_id]
    );
    if (check.rows.length === 0) {
      client.release();
      return res.status(404).json({ success: false, message: 'Version not found' });
    }

    const source = check.rows[0];

    // Get next version number
    const maxV = await client.query(
      'SELECT COALESCE(MAX(version_number), 0) AS max_num FROM expo_floorplan_versions WHERE hall_id = $1',
      [source.hall_id]
    );
    const nextNum = maxV.rows[0].max_num + 1;

    await client.query('BEGIN');

    // Create new version
    const newVersionRes = await client.query(
      `INSERT INTO expo_floorplan_versions (hall_id, version_number, version_label, status, notes, cloned_from_version_id, created_by)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6) RETURNING *`,
      [source.hall_id, nextNum, `Clone of v${source.version_number}`, source.notes, versionId, organizer_id]
    );
    const newVersion = newVersionRes.rows[0];

    // Copy all stands
    const standsRes = await client.query('SELECT * FROM expo_stands WHERE floorplan_version_id = $1', [versionId]);

    for (const oldStand of standsRes.rows) {
      const newStandRes = await client.query(
        `INSERT INTO expo_stands (
          floorplan_version_id, stand_code, zone, display_label, area_kind, special_area_type,
          commercial_status, stand_type, assigned_company_name, company_id, contract_id,
          reservation_type, reserved_by_user_id, reserved_until, price_per_m2,
          notes, metadata, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [
          newVersion.id, oldStand.stand_code, oldStand.zone, oldStand.display_label,
          oldStand.area_kind, oldStand.special_area_type,
          clear_assignments ? 'available' : oldStand.commercial_status,
          oldStand.stand_type,
          clear_assignments ? null : oldStand.assigned_company_name,
          clear_assignments ? null : oldStand.company_id,
          clear_assignments ? null : oldStand.contract_id,
          clear_assignments ? null : oldStand.reservation_type,
          clear_assignments ? null : oldStand.reserved_by_user_id,
          clear_assignments ? null : oldStand.reserved_until,
          oldStand.price_per_m2,
          oldStand.notes, oldStand.metadata, organizer_id
        ]
      );

      const newStandId = newStandRes.rows[0].id;

      // Copy cells
      await client.query(
        `INSERT INTO expo_stand_cells (stand_id, floorplan_version_id, cell_x, cell_y)
         SELECT $1, $2, cell_x, cell_y FROM expo_stand_cells WHERE stand_id = $3`,
        [newStandId, newVersion.id, oldStand.id]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({ success: true, version: newVersion });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[floorplan] Error cloning version:', err);
    res.status(500).json({ success: false, message: 'Failed to clone version' });
  } finally {
    client.release();
  }
});

// ============================================================
// STANDS
// ============================================================

// GET /api/floorplan/versions/:versionId/stands
router.get('/versions/:versionId/stands', authMiddleware, async (req, res) => {
  try {
    const versionId = req.params.versionId;
    const organizer_id = req.organizer_id;

    // Verify version belongs to organizer (version → hall → organizer)
    const versionCheck = await pool.query(
      `SELECT v.id, v.hall_id, v.status, h.grid_width, h.grid_height, h.cell_size_m2, h.name AS hall_name
       FROM expo_floorplan_versions v
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE v.id = $1 AND h.organizer_id = $2`,
      [versionId, organizer_id]
    );
    if (versionCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Version not found' });
    }

    const versionInfo = versionCheck.rows[0];

    // Fetch all stands with exhibitor info
    const stands = await pool.query(
      `SELECT s.*,
              ex.name AS exhibitor_name, ex.contact_person AS exhibitor_contact,
              ex.email AS exhibitor_email, ex.phone AS exhibitor_phone,
              ex.country AS exhibitor_country, ex.sector AS exhibitor_sector
       FROM expo_stands s
       LEFT JOIN expo_exhibitors ex ON s.exhibitor_id = ex.id
       WHERE s.floorplan_version_id = $1
       ORDER BY s.stand_code ASC`,
      [versionId]
    );

    // Fetch all cells for this version in one query
    const cells = await pool.query(
      `SELECT c.stand_id, c.cell_x, c.cell_y
       FROM expo_stand_cells c
       WHERE c.floorplan_version_id = $1
       ORDER BY c.stand_id, c.cell_y, c.cell_x`,
      [versionId]
    );

    // Group cells by stand_id
    const cellsByStand = {};
    for (const cell of cells.rows) {
      if (!cellsByStand[cell.stand_id]) cellsByStand[cell.stand_id] = [];
      cellsByStand[cell.stand_id].push({ x: cell.cell_x, y: cell.cell_y });
    }

    // Attach cells to stands
    const standsWithCells = stands.rows.map(stand => ({
      ...stand,
      cells: cellsByStand[stand.id] || []
    }));

    res.json({
      success: true,
      version: versionInfo,
      stands: standsWithCells
    });
  } catch (err) {
    console.error('[floorplan] Error fetching stands:', err);
    res.status(500).json({ success: false, message: 'Failed to load stands' });
  }
});

// POST /api/floorplan/versions/:versionId/stands
// Creates a stand with its cells in a single transaction
router.post('/versions/:versionId/stands', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const versionId = req.params.versionId;
    const organizer_id = req.organizer_id;
    const { stand_code, zone, display_label, area_kind, special_area_type, commercial_status, stand_type, notes, metadata, cells } = req.body;

    if (!cells || !Array.isArray(cells) || cells.length === 0) {
      client.release();
      return res.status(400).json({ success: false, message: 'cells[] is required (must be non-empty array)' });
    }

    // Validate cell format
    for (const cell of cells) {
      if (typeof cell.x !== 'number' || typeof cell.y !== 'number' || cell.x < 0 || cell.y < 0) {
        client.release();
        return res.status(400).json({ success: false, message: 'Each cell must have non-negative integer x and y coordinates' });
      }
    }

    // Verify version belongs to organizer and is draft
    const versionCheck = await client.query(
      `SELECT v.id, v.status, h.grid_width, h.grid_height
       FROM expo_floorplan_versions v
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE v.id = $1 AND h.organizer_id = $2`,
      [versionId, organizer_id]
    );
    if (versionCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ success: false, message: 'Version not found' });
    }

    const version = versionCheck.rows[0];
    if (version.status !== 'draft') {
      client.release();
      return res.status(400).json({ success: false, message: 'Can only add stands to draft versions' });
    }

    // Validate cells are within grid bounds
    for (const cell of cells) {
      if (cell.x >= version.grid_width || cell.y >= version.grid_height) {
        client.release();
        return res.status(400).json({
          success: false,
          message: `Cell (${cell.x},${cell.y}) is outside grid bounds (${version.grid_width}x${version.grid_height})`
        });
      }
    }

    await client.query('BEGIN');

    // Use a temporary placeholder if stand_code not provided — will be replaced after INSERT
    const tempCode = stand_code || `__temp_${Date.now()}`;

    // Insert stand
    const standResult = await client.query(
      `INSERT INTO expo_stands (
        floorplan_version_id, stand_code, zone, display_label,
        area_kind, special_area_type, commercial_status, stand_type,
        notes, metadata, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        versionId,
        tempCode,
        zone || null,
        display_label || null,
        area_kind || 'stand',
        special_area_type || null,
        (area_kind === 'stand' || !area_kind) ? (commercial_status || 'available') : null,
        stand_type || 'raw_space',
        notes || null,
        metadata || '{}',
        organizer_id
      ]
    );

    let stand = standResult.rows[0];

    // Auto-generate stand_code from ID if not provided
    if (!stand_code) {
      const autoCode = `S-${stand.id}`;
      const updated = await client.query(
        'UPDATE expo_stands SET stand_code = $1 WHERE id = $2 RETURNING *',
        [autoCode, stand.id]
      );
      stand = updated.rows[0];
    }

    // Batch insert cells
    // Build a multi-row VALUES clause for efficiency
    const cellValues = [];
    const cellParams = [];
    let paramIdx = 1;

    for (const cell of cells) {
      cellValues.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
      cellParams.push(stand.id, versionId, cell.x, cell.y);
    }

    await client.query(
      `INSERT INTO expo_stand_cells (stand_id, floorplan_version_id, cell_x, cell_y)
       VALUES ${cellValues.join(', ')}`,
      cellParams
    );

    await client.query('COMMIT');

    // Re-read stand to get trigger-updated size_m2
    const updatedStand = await pool.query(
      'SELECT * FROM expo_stands WHERE id = $1',
      [stand.id]
    );

    res.status(201).json({
      success: true,
      stand: {
        ...updatedStand.rows[0],
        cells: cells
      }
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    console.error('[floorplan] Error creating stand:', err);

    if (err.code === '23505') {
      // Unique constraint violation
      const detail = err.detail || '';
      if (detail.includes('cell_x') || detail.includes('floorplan_version_id, cell_x, cell_y')) {
        return res.status(409).json({ success: false, message: 'One or more cells are already occupied by another stand' });
      }
      if (detail.includes('stand_code')) {
        return res.status(409).json({ success: false, message: `Stand code "${req.body.stand_code}" already exists in this version` });
      }
      return res.status(409).json({ success: false, message: 'Duplicate entry conflict' });
    }

    res.status(500).json({ success: false, message: 'Failed to create stand' });
  } finally {
    client.release();
  }
});

// PUT /api/floorplan/stands/:id — Update stand fields
// Structural fields (stand_code, zone, area_kind, stand_type) require draft version
// Commercial fields (commercial_status, assigned_company_name, display_label, notes, metadata) allowed on active too
router.put('/stands/:id', authMiddleware, async (req, res) => {
  try {
    const standId = req.params.id;
    const organizer_id = req.organizer_id;
    const { stand_code, zone, display_label, area_kind, special_area_type,
            commercial_status, stand_type, assigned_company_name, exhibitor_id, notes, metadata } = req.body;

    // Verify ownership and get version status
    const standCheck = await pool.query(
      `SELECT s.*, v.status AS version_status
       FROM expo_stands s
       JOIN expo_floorplan_versions v ON v.id = s.floorplan_version_id
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE s.id = $1 AND h.organizer_id = $2`,
      [standId, organizer_id]
    );
    if (standCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Stand not found' });
    }

    const current = standCheck.rows[0];
    const isDraft = current.version_status === 'draft';

    // Structural fields require draft
    const structuralFields = { stand_code, zone, area_kind, special_area_type, stand_type };
    const hasStructuralChange = Object.values(structuralFields).some(v => v !== undefined);
    if (hasStructuralChange && !isDraft) {
      return res.status(400).json({ success: false, message: 'Structural changes (code, zone, area_kind, stand_type) require draft version' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (stand_code !== undefined) { updates.push(`stand_code = $${idx++}`); values.push(stand_code); }
    if (zone !== undefined) { updates.push(`zone = $${idx++}`); values.push(zone); }
    if (display_label !== undefined) { updates.push(`display_label = $${idx++}`); values.push(display_label); }
    if (area_kind !== undefined) { updates.push(`area_kind = $${idx++}`); values.push(area_kind); }
    if (special_area_type !== undefined) { updates.push(`special_area_type = $${idx++}`); values.push(special_area_type); }
    if (commercial_status !== undefined) { updates.push(`commercial_status = $${idx++}`); values.push(commercial_status); }
    if (stand_type !== undefined) { updates.push(`stand_type = $${idx++}`); values.push(stand_type); }
    if (assigned_company_name !== undefined) { updates.push(`assigned_company_name = $${idx++}`); values.push(assigned_company_name); }
    if (exhibitor_id !== undefined) { updates.push(`exhibitor_id = $${idx++}`); values.push(exhibitor_id); }
    if (notes !== undefined) { updates.push(`notes = $${idx++}`); values.push(notes); }
    if (metadata !== undefined) { updates.push(`metadata = $${idx++}`); values.push(JSON.stringify(metadata)); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    updates.push(`updated_by = $${idx++}`); values.push(organizer_id);
    updates.push(`updated_at = NOW()`);
    values.push(standId);

    const result = await pool.query(
      `UPDATE expo_stands SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    // Re-attach cells for frontend
    const cells = await pool.query(
      'SELECT cell_x, cell_y FROM expo_stand_cells WHERE stand_id = $1',
      [standId]
    );

    res.json({
      success: true,
      stand: { ...result.rows[0], cells: cells.rows.map(c => ({ x: c.cell_x, y: c.cell_y })) }
    });
  } catch (err) {
    console.error('[floorplan] Error updating stand:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Stand code already exists in this version' });
    }
    res.status(500).json({ success: false, message: 'Failed to update stand' });
  }
});

// PUT /api/floorplan/stands/:id/status — Quick status change (allowed on active versions)
router.put('/stands/:id/status', authMiddleware, async (req, res) => {
  try {
    const standId = req.params.id;
    const organizer_id = req.organizer_id;
    const { commercial_status } = req.body;

    const validStatuses = ['available', 'hold', 'reserved', 'pending_contract', 'sold'];
    if (!commercial_status || !validStatuses.includes(commercial_status)) {
      return res.status(400).json({ success: false, message: `commercial_status must be one of: ${validStatuses.join(', ')}` });
    }

    // Verify ownership (no draft requirement — commercial changes allowed on active)
    const standCheck = await pool.query(
      `SELECT s.id, s.area_kind
       FROM expo_stands s
       JOIN expo_floorplan_versions v ON v.id = s.floorplan_version_id
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE s.id = $1 AND h.organizer_id = $2`,
      [standId, organizer_id]
    );
    if (standCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Stand not found' });
    }
    if (standCheck.rows[0].area_kind !== 'stand') {
      return res.status(400).json({ success: false, message: 'Cannot set commercial status on special/blocked areas' });
    }

    const result = await pool.query(
      `UPDATE expo_stands SET commercial_status = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [commercial_status, organizer_id, standId]
    );

    const cells = await pool.query(
      'SELECT cell_x, cell_y FROM expo_stand_cells WHERE stand_id = $1',
      [standId]
    );

    res.json({
      success: true,
      stand: { ...result.rows[0], cells: cells.rows.map(c => ({ x: c.cell_x, y: c.cell_y })) }
    });
  } catch (err) {
    console.error('[floorplan] Error updating stand status:', err);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

// POST /api/floorplan/stands/:id/split — Split stand into multiple new stands
router.post('/stands/:id/split', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const standId = req.params.id;
    const organizer_id = req.organizer_id;
    const { new_stands } = req.body;

    if (!new_stands || !Array.isArray(new_stands) || new_stands.length < 2) {
      client.release();
      return res.status(400).json({ success: false, message: 'new_stands must be an array with at least 2 entries' });
    }

    // Verify ownership, draft status, and get original stand + cells
    const standCheck = await client.query(
      `SELECT s.*, v.status AS version_status, v.id AS version_id
       FROM expo_stands s
       JOIN expo_floorplan_versions v ON v.id = s.floorplan_version_id
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE s.id = $1 AND h.organizer_id = $2`,
      [standId, organizer_id]
    );
    if (standCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ success: false, message: 'Stand not found' });
    }

    const original = standCheck.rows[0];
    if (original.version_status !== 'draft') {
      client.release();
      return res.status(400).json({ success: false, message: 'Can only split stands in draft versions' });
    }

    // Get original cells
    const origCellsRes = await client.query(
      'SELECT cell_x, cell_y FROM expo_stand_cells WHERE stand_id = $1',
      [standId]
    );
    const origCellSet = new Set(origCellsRes.rows.map(c => `${c.cell_x},${c.cell_y}`));

    // Validate: union of all new_stands cells must equal original cells exactly
    const allNewCells = new Set();
    for (const ns of new_stands) {
      if (!ns.cells || !Array.isArray(ns.cells) || ns.cells.length === 0) {
        client.release();
        return res.status(400).json({ success: false, message: 'Each new stand must have non-empty cells array' });
      }
      for (const c of ns.cells) {
        const key = `${c.x},${c.y}`;
        if (!origCellSet.has(key)) {
          client.release();
          return res.status(400).json({ success: false, message: `Cell (${c.x},${c.y}) is not part of the original stand` });
        }
        if (allNewCells.has(key)) {
          client.release();
          return res.status(400).json({ success: false, message: `Cell (${c.x},${c.y}) is assigned to multiple new stands` });
        }
        allNewCells.add(key);
      }
    }
    if (allNewCells.size !== origCellSet.size) {
      client.release();
      return res.status(400).json({ success: false, message: `All original cells must be assigned. Original: ${origCellSet.size}, assigned: ${allNewCells.size}` });
    }

    const versionId = original.version_id;

    await client.query('BEGIN');

    // Delete original stand (cells cascade)
    await client.query('DELETE FROM expo_stands WHERE id = $1', [standId]);

    // Create new stands
    const createdStands = [];
    for (const ns of new_stands) {
      const code = ns.stand_code || `__temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const standRes = await client.query(
        `INSERT INTO expo_stands (
          floorplan_version_id, stand_code, zone, display_label, area_kind, special_area_type,
          commercial_status, stand_type, notes, metadata, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          versionId, code, original.zone, ns.display_label || null,
          original.area_kind, original.special_area_type,
          original.commercial_status, original.stand_type,
          null, original.metadata || '{}', organizer_id
        ]
      );

      let newStand = standRes.rows[0];

      // Auto-generate code if not provided
      if (!ns.stand_code) {
        const autoCode = `S-${newStand.id}`;
        const upd = await client.query('UPDATE expo_stands SET stand_code = $1 WHERE id = $2 RETURNING *', [autoCode, newStand.id]);
        newStand = upd.rows[0];
      }

      // Insert cells
      const cellValues = [];
      const cellParams = [];
      let pi = 1;
      for (const c of ns.cells) {
        cellValues.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++})`);
        cellParams.push(newStand.id, versionId, c.x, c.y);
      }
      await client.query(
        `INSERT INTO expo_stand_cells (stand_id, floorplan_version_id, cell_x, cell_y) VALUES ${cellValues.join(', ')}`,
        cellParams
      );

      createdStands.push({ ...newStand, cells: ns.cells });
    }

    await client.query('COMMIT');

    // Re-read to get trigger-updated size_m2
    const finalStands = [];
    for (const cs of createdStands) {
      const r = await pool.query('SELECT * FROM expo_stands WHERE id = $1', [cs.id]);
      finalStands.push({ ...r.rows[0], cells: cs.cells });
    }

    res.json({ success: true, stands: finalStands });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[floorplan] Error splitting stand:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Stand code conflict during split' });
    }
    res.status(500).json({ success: false, message: 'Failed to split stand' });
  } finally {
    client.release();
  }
});

// POST /api/floorplan/stands/merge — Merge multiple stands into one
router.post('/stands/merge', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const organizer_id = req.organizer_id;
    const { stand_ids, merged_stand_code } = req.body;

    if (!stand_ids || !Array.isArray(stand_ids) || stand_ids.length < 2) {
      client.release();
      return res.status(400).json({ success: false, message: 'stand_ids must contain at least 2 stand IDs' });
    }

    // Fetch all stands with ownership + version check
    const placeholders = stand_ids.map((_, i) => `$${i + 1}`).join(',');
    const standsRes = await client.query(
      `SELECT s.*, v.status AS version_status, v.id AS version_id, v.hall_id
       FROM expo_stands s
       JOIN expo_floorplan_versions v ON v.id = s.floorplan_version_id
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE s.id IN (${placeholders}) AND h.organizer_id = $${stand_ids.length + 1}`,
      [...stand_ids, organizer_id]
    );

    if (standsRes.rows.length !== stand_ids.length) {
      client.release();
      return res.status(404).json({ success: false, message: 'One or more stands not found' });
    }

    // All must be in same version and draft
    const versionIds = new Set(standsRes.rows.map(s => s.version_id));
    if (versionIds.size !== 1) {
      client.release();
      return res.status(400).json({ success: false, message: 'All stands must be in the same version' });
    }
    if (standsRes.rows[0].version_status !== 'draft') {
      client.release();
      return res.status(400).json({ success: false, message: 'Can only merge stands in draft versions' });
    }

    const versionId = standsRes.rows[0].version_id;
    const first = standsRes.rows[0]; // inherit properties from first stand

    // Collect all cells
    const cellsRes = await client.query(
      `SELECT cell_x, cell_y FROM expo_stand_cells WHERE stand_id IN (${placeholders})`,
      stand_ids
    );
    const allCells = cellsRes.rows.map(c => ({ x: c.cell_x, y: c.cell_y }));

    if (allCells.length === 0) {
      client.release();
      return res.status(400).json({ success: false, message: 'No cells found in selected stands' });
    }

    await client.query('BEGIN');

    // Delete all source stands (cells cascade)
    await client.query(`DELETE FROM expo_stands WHERE id IN (${placeholders})`, stand_ids);

    // Create merged stand
    const code = merged_stand_code || `__temp_${Date.now()}`;
    const mergedRes = await client.query(
      `INSERT INTO expo_stands (
        floorplan_version_id, stand_code, zone, display_label, area_kind, special_area_type,
        commercial_status, stand_type, assigned_company_name, notes, metadata, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        versionId, code, first.zone, null,
        first.area_kind, first.special_area_type,
        first.commercial_status, first.stand_type,
        first.assigned_company_name, null, first.metadata || '{}', organizer_id
      ]
    );

    let merged = mergedRes.rows[0];

    // Auto-generate code if not provided
    if (!merged_stand_code) {
      const autoCode = `S-${merged.id}`;
      const upd = await client.query('UPDATE expo_stands SET stand_code = $1 WHERE id = $2 RETURNING *', [autoCode, merged.id]);
      merged = upd.rows[0];
    }

    // Insert cells
    const cellValues = [];
    const cellParams = [];
    let pi = 1;
    for (const c of allCells) {
      cellValues.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++})`);
      cellParams.push(merged.id, versionId, c.x, c.y);
    }
    await client.query(
      `INSERT INTO expo_stand_cells (stand_id, floorplan_version_id, cell_x, cell_y) VALUES ${cellValues.join(', ')}`,
      cellParams
    );

    await client.query('COMMIT');

    // Re-read for trigger-updated size_m2
    const finalRes = await pool.query('SELECT * FROM expo_stands WHERE id = $1', [merged.id]);

    res.json({
      success: true,
      stand: { ...finalRes.rows[0], cells: allCells }
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[floorplan] Error merging stands:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Stand code conflict during merge' });
    }
    res.status(500).json({ success: false, message: 'Failed to merge stands' });
  } finally {
    client.release();
  }
});

// DELETE /api/floorplan/stands/:id
// PUT /api/floorplan/stands/:id/move — Move stand to new cell positions
router.put('/stands/:id/move', authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const standId = req.params.id;
    const organizer_id = req.organizer_id;
    const { cells } = req.body;

    if (!cells || !Array.isArray(cells) || cells.length === 0) {
      client.release();
      return res.status(400).json({ success: false, message: 'cells[] is required' });
    }

    // Verify ownership + draft
    const standCheck = await client.query(
      `SELECT s.id, s.floorplan_version_id, v.status, h.grid_width, h.grid_height
       FROM expo_stands s
       JOIN expo_floorplan_versions v ON v.id = s.floorplan_version_id
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE s.id = $1 AND h.organizer_id = $2`,
      [standId, organizer_id]
    );
    if (standCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ success: false, message: 'Stand not found' });
    }

    const info = standCheck.rows[0];
    if (info.status !== 'draft') {
      client.release();
      return res.status(400).json({ success: false, message: 'Can only move stands in draft versions' });
    }

    // Validate bounds
    for (const c of cells) {
      if (c.x < 0 || c.y < 0 || c.x >= info.grid_width || c.y >= info.grid_height) {
        client.release();
        return res.status(400).json({ success: false, message: `Cell (${c.x},${c.y}) is outside grid bounds` });
      }
    }

    await client.query('BEGIN');

    // Delete old cells
    await client.query('DELETE FROM expo_stand_cells WHERE stand_id = $1', [standId]);

    // Insert new cells
    const vals = [];
    const params = [];
    let pi = 1;
    for (const c of cells) {
      vals.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++})`);
      params.push(standId, info.floorplan_version_id, c.x, c.y);
    }
    await client.query(
      `INSERT INTO expo_stand_cells (stand_id, floorplan_version_id, cell_x, cell_y) VALUES ${vals.join(', ')}`,
      params
    );

    await client.query('COMMIT');

    // Re-read stand with trigger-updated size_m2
    const updated = await pool.query('SELECT * FROM expo_stands WHERE id = $1', [standId]);

    res.json({
      success: true,
      stand: { ...updated.rows[0], cells }
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[floorplan] Error moving stand:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Target cells are occupied by another stand' });
    }
    res.status(500).json({ success: false, message: 'Failed to move stand' });
  } finally {
    client.release();
  }
});

router.delete('/stands/:id', authMiddleware, async (req, res) => {
  try {
    const standId = req.params.id;
    const organizer_id = req.organizer_id;

    // Verify stand belongs to organizer (stand → version → hall → organizer)
    // and version is draft
    const standCheck = await pool.query(
      `SELECT s.id, s.stand_code, v.status
       FROM expo_stands s
       JOIN expo_floorplan_versions v ON v.id = s.floorplan_version_id
       JOIN expo_halls h ON h.id = v.hall_id
       WHERE s.id = $1 AND h.organizer_id = $2`,
      [standId, organizer_id]
    );

    if (standCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Stand not found' });
    }

    if (standCheck.rows[0].status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Can only delete stands from draft versions' });
    }

    // DELETE cascades to expo_stand_cells
    await pool.query('DELETE FROM expo_stands WHERE id = $1', [standId]);

    res.json({ success: true, message: 'Stand deleted' });
  } catch (err) {
    console.error('[floorplan] Error deleting stand:', err);
    res.status(500).json({ success: false, message: 'Failed to delete stand' });
  }
});

module.exports = router;
