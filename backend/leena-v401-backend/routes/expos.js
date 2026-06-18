// routes/expos.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

/**
 * Generate URL-friendly slug from expo name
 * @param {string} name - The expo name to convert
 * @returns {string} URL-friendly slug
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/[^\w-]+/g, '')        // Remove non-alphanumeric characters
    .replace(/--+/g, '-')           // Replace multiple hyphens with single
    .replace(/^-+|-+$/g, '');       // Remove leading/trailing hyphens
}

/**
 * Generate unique slug by checking database
 * @param {string} baseName - The expo name to convert
 * @param {number} organizerId - The organizer ID
 * @returns {Promise<string>} Unique slug
 */
async function generateUniqueSlug(baseName, organizerId) {
  let slug = generateSlug(baseName);
  let counter = 1;
  
  while (true) {
    const existing = await pool.query(
      'SELECT id FROM expos WHERE slug = $1 AND organizer_id = $2',
      [slug, organizerId]
    );
    
    if (existing.rows.length === 0) {
      return slug;
    }
    
    // Add counter to make it unique
    slug = `${generateSlug(baseName)}-${counter}`;
    counter++;
  }
}

/**
 * GET /api/expos
 * Get all expos for the authenticated organizer
 */
router.get('/', authenticateToken, async (req, res) => {
  // Optional filters (all ignored when absent). organizer_id scope always enforced.
  const { organizer_role, status, country_code, year } = req.query;

  const conditions = ['e.organizer_id = $1'];
  const values = [req.organizer_id];
  let p = 2;

  if (organizer_role) { conditions.push(`e.organizer_role = $${p++}`); values.push(organizer_role); }
  if (status)         { conditions.push(`e.status = $${p++}`);         values.push(status); }
  if (country_code)   { conditions.push(`e.country_code = $${p++}`);   values.push(country_code); }
  if (year)           { conditions.push(`COALESCE(e.edition_year, EXTRACT(YEAR FROM e.start_date)::int) = $${p++}`); values.push(parseInt(year, 10)); }

  // Sectors intentionally NOT joined here (list stays lean; sectors live in detail/form).
  try {
    const result = await pool.query(
      `SELECT e.id, e.organizer_id, e.name, e.slug, e.location, e.start_date, e.end_date,
              e.logo_url, e.created_at, e.updated_at,
              e.edition_year, e.country_code, cc.name AS country_name,
              e.city, e.venue, e.organizer_role, e.status, e.show_open_hours, e.cluster_id,
              e.catalogue_form_url, e.stand_design_form_url, e.visitor_preregistration_form_url,
              (SELECT COUNT(*)::int FROM visitors WHERE expo_id = e.id) as visitor_count,
              (SELECT COUNT(*)::int FROM checkins WHERE expo_id = e.id) as checkin_count
       FROM expos e
       LEFT JOIN core_countries cc ON cc.code = e.country_code
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.start_date DESC, e.id DESC`,
      values
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching expos:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/expos/:id
 * Get a specific expo by ID
 */
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Deadline _effective columns: COALESCE(manual override, start/end ± offset days).
    // Column names verified against live schema (ADIM 3 / Dilim 1) — exact match.
    const result = await pool.query(
      `SELECT e.*,
              cc.name AS country_name,
              ec.name AS cluster_name,
              COALESCE(e.buildup_day_1, (e.start_date - e.buildup_1_days_before * INTERVAL '1 day')::date) AS buildup_day_1_effective,
              COALESCE(e.buildup_day_2, (e.start_date - e.buildup_2_days_before * INTERVAL '1 day')::date) AS buildup_day_2_effective,
              COALESCE(e.standard_buildup_day, (e.start_date - e.standard_buildup_days_before * INTERVAL '1 day')::date) AS standard_buildup_day_effective,
              COALESCE(e.catalogue_submission_deadline, (e.start_date - e.catalogue_deadline_days_before * INTERVAL '1 day')::date) AS catalogue_submission_deadline_effective,
              COALESCE(e.stand_design_confirmation_deadline, (e.start_date - e.stand_design_deadline_days_before * INTERVAL '1 day')::date) AS stand_design_confirmation_deadline_effective,
              COALESCE(e.payment_deadline, (e.start_date - e.payment_deadline_days_before * INTERVAL '1 day')::date) AS payment_deadline_effective,
              COALESCE(e.visa_support_deadline, (e.start_date - e.visa_deadline_days_before * INTERVAL '1 day')::date) AS visa_support_deadline_effective,
              COALESCE(e.breakdown, (e.end_date + e.breakdown_days_after * INTERVAL '1 day')::date) AS breakdown_effective,
              (SELECT json_agg(json_build_object('id', cs.id, 'slug', cs.slug, 'name', cs.name) ORDER BY cs.name)
                 FROM expo_sectors es JOIN core_sectors cs ON cs.id = es.sector_id
                WHERE es.expo_id = e.id) AS sectors,
              (SELECT COUNT(*)::int FROM visitors WHERE expo_id = e.id) as visitor_count,
              (SELECT COUNT(*)::int FROM checkins WHERE expo_id = e.id) as checkin_count
       FROM expos e
       LEFT JOIN core_countries cc ON cc.code = e.country_code
       LEFT JOIN expo_clusters ec ON ec.id = e.cluster_id
       WHERE e.id = $1 AND e.organizer_id = $2`,
      [id, req.organizer_id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expo not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching expo:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/expos/slug/:slug
 * Get expo by slug (useful for public forms)
 */
router.get('/slug/:slug', async (req, res) => {
  const { slug } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT id, name, slug, location, start_date, end_date, logo_url FROM expos WHERE slug = $1',
      [slug]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expo not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching expo by slug:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Expo Operations write support ────────────────────────────────────────────
const ORGANIZER_ROLES = ['main_organizer', 'co_organizer', 'agent', 'consultant'];
const STATUSES = ['announcement', 'sales-open', 'build-up', 'live', 'accomplished'];

// Columns writable via create/update (direct column set). `name` (slug side-effect)
// and `sectors` (expo_sectors junction) are handled separately. Deadline override
// columns are written as-is: NULL = "compute from offset" (the _effective columns in
// GET /:id derive the live value); a non-NULL value = a manual override that sticks.
const WRITABLE_FIELDS = [
  'location', 'description', 'logo_url', 'start_date', 'end_date',
  'edition_year', 'country_code', 'city', 'venue', 'organizer_role', 'status',
  'show_open_hours', 'cluster_id',
  'buildup_1_days_before', 'buildup_2_days_before', 'standard_buildup_days_before',
  'catalogue_deadline_days_before', 'stand_design_deadline_days_before',
  'payment_deadline_days_before', 'visa_deadline_days_before', 'breakdown_days_after',
  'buildup_day_1', 'buildup_day_2', 'standard_buildup_day', 'catalogue_submission_deadline',
  'stand_design_confirmation_deadline', 'payment_deadline', 'visa_support_deadline', 'breakdown',
  'catalogue_form_url', 'stand_design_form_url', 'visitor_preregistration_form_url'
];

// Empty string → null (form inputs send '' for untouched optional date/number/text fields).
const nn = (v) => (v === undefined || v === '' ? null : v);

function mapWriteError(err, res) {
  if (err.code === '23505') return res.status(409).json({ error: 'An expo with this name already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'Invalid reference (country or cluster does not exist)' });
  if (err.code === '23514') return res.status(400).json({ error: 'Invalid value for organizer_role or status' });
  console.error('Expo write error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}

// Replace the expo's sector set (junction). Caller must already own the expo + be in a tx.
async function setExpoSectors(client, expoId, sectorIds) {
  await client.query('DELETE FROM expo_sectors WHERE expo_id = $1', [expoId]);
  for (const sid of sectorIds) {
    await client.query(
      'INSERT INTO expo_sectors (expo_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [expoId, sid]
    );
  }
}

/**
 * POST /api/expos
 * Create a new expo (Expo Operations fields + sectors). Backward compatible:
 * a body with only name/location/start_date/end_date still works (defaults apply).
 */
router.post('/', authenticateToken, async (req, res) => {
  const b = req.body || {};
  const { name, start_date, end_date } = b;

  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: 'Missing required fields', required: ['name', 'start_date', 'end_date'] });
  }
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date format' });
  }
  if (startDate > endDate) {
    return res.status(400).json({ error: 'Start date must be before end date' });
  }
  if (b.organizer_role && !ORGANIZER_ROLES.includes(b.organizer_role)) {
    return res.status(400).json({ error: 'Invalid organizer_role' });
  }
  if (b.status && !STATUSES.includes(b.status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const sectorIds = Array.isArray(b.sectors) ? b.sectors.map(Number).filter(Number.isInteger) : null;

  const client = await pool.connect();
  try {
    const slug = await generateUniqueSlug(name, req.organizer_id);
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO expos (
         organizer_id, name, slug, location, description, logo_url, start_date, end_date,
         edition_year, country_code, city, venue, organizer_role, status, show_open_hours, cluster_id,
         buildup_1_days_before, buildup_2_days_before, standard_buildup_days_before,
         catalogue_deadline_days_before, stand_design_deadline_days_before, payment_deadline_days_before,
         visa_deadline_days_before, breakdown_days_after,
         buildup_day_1, buildup_day_2, standard_buildup_day, catalogue_submission_deadline,
         stand_design_confirmation_deadline, payment_deadline, visa_support_deadline, breakdown,
         catalogue_form_url, stand_design_form_url, visitor_preregistration_form_url
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,
         $9,$10,$11,$12, COALESCE($13,'main_organizer'), COALESCE($14,'announcement'), $15, $16,
         COALESCE($17,3), COALESCE($18,2), COALESCE($19,1),
         COALESCE($20,25), COALESCE($21,25), COALESCE($22,30),
         COALESCE($23,40), COALESCE($24,0),
         $25,$26,$27,$28,$29,$30,$31,$32,
         $33,$34,$35
       ) RETURNING *`,
      [
        req.organizer_id, name, slug, nn(b.location), nn(b.description), nn(b.logo_url), start_date, end_date,
        nn(b.edition_year), nn(b.country_code), nn(b.city), nn(b.venue), nn(b.organizer_role), nn(b.status), nn(b.show_open_hours), nn(b.cluster_id),
        nn(b.buildup_1_days_before), nn(b.buildup_2_days_before), nn(b.standard_buildup_days_before),
        nn(b.catalogue_deadline_days_before), nn(b.stand_design_deadline_days_before), nn(b.payment_deadline_days_before),
        nn(b.visa_deadline_days_before), nn(b.breakdown_days_after),
        nn(b.buildup_day_1), nn(b.buildup_day_2), nn(b.standard_buildup_day), nn(b.catalogue_submission_deadline),
        nn(b.stand_design_confirmation_deadline), nn(b.payment_deadline), nn(b.visa_support_deadline), nn(b.breakdown),
        nn(b.catalogue_form_url), nn(b.stand_design_form_url), nn(b.visitor_preregistration_form_url)
      ]
    );
    const expo = result.rows[0];

    if (sectorIds && sectorIds.length) await setExpoSectors(client, expo.id, sectorIds);

    await client.query('COMMIT');
    res.status(201).json({ message: 'Expo created successfully', expo });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return mapWriteError(err, res);
  } finally {
    client.release();
  }
});

/**
 * PUT /api/expos/:id
 * Update an existing expo
 */
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};

  // Validate dates if both provided
  if (b.start_date && b.end_date) {
    const s = new Date(b.start_date), e = new Date(b.end_date);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return res.status(400).json({ error: 'Invalid date format' });
    if (s > e) return res.status(400).json({ error: 'Start date must be before end date' });
  }
  if (b.organizer_role && !ORGANIZER_ROLES.includes(b.organizer_role)) {
    return res.status(400).json({ error: 'Invalid organizer_role' });
  }
  if (b.status && !STATUSES.includes(b.status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const sectorIds = Array.isArray(b.sectors) ? b.sectors.map(Number).filter(Number.isInteger) : null;

  // Build dynamic update from name (+slug) and the writable column set.
  const updates = [];
  const values = [];
  let p = 1;

  if (b.name) {
    updates.push(`name = $${p++}`); values.push(b.name);
    const slug = await generateUniqueSlug(b.name, req.organizer_id);
    updates.push(`slug = $${p++}`); values.push(slug);
  }
  for (const f of WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(b, f)) {
      updates.push(`${f} = $${p++}`); values.push(nn(b[f]));
    }
  }

  if (updates.length === 0 && sectorIds === null) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let expo = null;

    if (updates.length > 0) {
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id, req.organizer_id);
      const result = await client.query(
        `UPDATE expos SET ${updates.join(', ')} WHERE id = $${p} AND organizer_id = $${p + 1} RETURNING *`,
        values
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Expo not found' });
      }
      expo = result.rows[0];
    } else {
      // Sectors-only update — verify ownership before touching the junction.
      const own = await client.query('SELECT * FROM expos WHERE id = $1 AND organizer_id = $2', [id, req.organizer_id]);
      if (own.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Expo not found' });
      }
      expo = own.rows[0];
    }

    if (sectorIds !== null) await setExpoSectors(client, id, sectorIds);

    await client.query('COMMIT');
    res.json({ message: 'Expo updated successfully', expo });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return mapWriteError(err, res);
  } finally {
    client.release();
  }
});

// Year in an expo name → bumped to newYear (regex replace, not parse). First 19xx/20xx wins.
function bumpExpoName(name, newYear) {
  if (!name) return name;
  return /\b(?:19|20)\d{2}\b/.test(name) ? name.replace(/\b(?:19|20)\d{2}\b/, String(newYear)) : name;
}
function yearOf(d) { return d ? new Date(d).getFullYear() : null; }

/**
 * POST /api/expos/:id/clone
 * Clone an expo into a new edition. organizer_id scope enforced on BOTH source and copy.
 *
 *   COPY        : organizer_role, country_code/city/venue, location/description/logo_url,
 *                 8 offsets, show_open_hours, sectors (junction), partners,
 *                 floor plan layout (ACTIVE version per hall → new draft, assignments cleared).
 *   RECALC/BUMP : edition_year (+1), expo_name (year regex +1), slug.
 *   RESET       : start_date/end_date → NULL, 8 deadline overrides → NULL, 3 form_urls → NULL,
 *                 cluster_id → NULL, status → 'announcement', stand commercial_status → 'available'.
 *
 * Dates come back BLANK on purpose: expo dates shift unpredictably year to year, so Yaprak
 * enters the real new dates; the 8 deadlines then auto-compute from the copied offsets.
 */
router.post('/:id/clone', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const srcRes = await client.query('SELECT * FROM expos WHERE id = $1 AND organizer_id = $2', [id, req.organizer_id]);
    if (srcRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Expo not found' });
    }
    const src = srcRes.rows[0];

    const newEdition = (src.edition_year ? Number(src.edition_year) : yearOf(src.start_date) || 0) + 1;
    const newName = bumpExpoName(src.name, newEdition);
    const slug = await generateUniqueSlug(newName, req.organizer_id);

    const insRes = await client.query(
      `INSERT INTO expos (
         organizer_id, name, slug, location, description, logo_url, start_date, end_date,
         edition_year, country_code, city, venue, organizer_role, status, show_open_hours, cluster_id,
         buildup_1_days_before, buildup_2_days_before, standard_buildup_days_before,
         catalogue_deadline_days_before, stand_design_deadline_days_before, payment_deadline_days_before,
         visa_deadline_days_before, breakdown_days_after,
         buildup_day_1, buildup_day_2, standard_buildup_day, catalogue_submission_deadline,
         stand_design_confirmation_deadline, payment_deadline, visa_support_deadline, breakdown,
         catalogue_form_url, stand_design_form_url, visitor_preregistration_form_url
       ) VALUES (
         $1,$2,$3,$4,$5,$6, NULL, NULL,
         $7,$8,$9,$10,$11,'announcement',$12, NULL,
         $13,$14,$15,$16,$17,$18,$19,$20,
         NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,
         NULL,NULL,NULL
       ) RETURNING *`,
      [
        req.organizer_id, newName, slug, src.location, src.description, src.logo_url,
        newEdition, src.country_code, src.city, src.venue, src.organizer_role, src.show_open_hours,
        src.buildup_1_days_before, src.buildup_2_days_before, src.standard_buildup_days_before,
        src.catalogue_deadline_days_before, src.stand_design_deadline_days_before, src.payment_deadline_days_before,
        src.visa_deadline_days_before, src.breakdown_days_after
      ]
    );
    const newExpo = insRes.rows[0];

    // Sectors (junction copy)
    await client.query(
      'INSERT INTO expo_sectors (expo_id, sector_id) SELECT $1, sector_id FROM expo_sectors WHERE expo_id = $2',
      [newExpo.id, src.id]
    );

    // Partners (bonds copied; freelancer/onsite contacts carry over)
    await client.query(
      `INSERT INTO expo_partners (expo_id, partner_role, company_name, contact_name, phone, email, notes, is_primary)
       SELECT $1, partner_role, company_name, contact_name, phone, email, notes, is_primary
       FROM expo_partners WHERE expo_id = $2`,
      [newExpo.id, src.id]
    );

    // Floor plan: each hall → its ACTIVE version → new draft (stands reset to available, cells copied)
    const halls = await client.query(
      'SELECT * FROM expo_halls WHERE expo_id = $1 AND organizer_id = $2',
      [src.id, req.organizer_id]
    );
    for (const hall of halls.rows) {
      const nh = await client.query(
        `INSERT INTO expo_halls (expo_id, organizer_id, name, grid_width, grid_height, cell_size_m2, metadata, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [newExpo.id, req.organizer_id, hall.name, hall.grid_width, hall.grid_height, hall.cell_size_m2, hall.metadata, req.organizer_id]
      );
      const newHallId = nh.rows[0].id;

      const av = await client.query(
        `SELECT * FROM expo_floorplan_versions WHERE hall_id = $1 AND status = 'active' ORDER BY version_number DESC LIMIT 1`,
        [hall.id]
      );
      if (av.rows.length === 0) continue;
      const srcVer = av.rows[0];

      const nv = await client.query(
        `INSERT INTO expo_floorplan_versions (hall_id, version_number, version_label, status, notes, cloned_from_version_id, created_by)
         VALUES ($1, 1, $2, 'draft', $3, $4, $5) RETURNING id`,
        [newHallId, `Clone of v${srcVer.version_number}`, srcVer.notes, srcVer.id, req.organizer_id]
      );
      const newVerId = nv.rows[0].id;

      const stands = await client.query('SELECT * FROM expo_stands WHERE floorplan_version_id = $1', [srcVer.id]);
      for (const st of stands.rows) {
        // commercial assignment reset; size_m2 recomputed by trigger on cell insert.
        const ns = await client.query(
          `INSERT INTO expo_stands (
             floorplan_version_id, stand_code, zone, display_label, area_kind, special_area_type,
             commercial_status, stand_type, price_per_m2, notes, metadata, created_by
           ) VALUES ($1,$2,$3,$4,$5,$6,'available',$7,$8,$9,$10,$11) RETURNING id`,
          [newVerId, st.stand_code, st.zone, st.display_label, st.area_kind, st.special_area_type,
           st.stand_type, st.price_per_m2, st.notes, st.metadata, req.organizer_id]
        );
        await client.query(
          `INSERT INTO expo_stand_cells (stand_id, floorplan_version_id, cell_x, cell_y)
           SELECT $1, $2, cell_x, cell_y FROM expo_stand_cells WHERE stand_id = $3`,
          [ns.rows[0].id, newVerId, st.id]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Expo cloned successfully', expo: newExpo });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return mapWriteError(err, res);
  } finally {
    client.release();
  }
});

/**
 * PUT /api/expos/:id/cluster
 * Link the expo to a cluster ({ cluster_id }) or unlink it ({ cluster_id: null }).
 * Equal-expo model — this is a plain nullable FK set, organizer scope enforced.
 */
router.put('/:id/cluster', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const clusterId = (req.body && req.body.cluster_id) ? req.body.cluster_id : null; // falsy → unlink
  try {
    const r = await pool.query(
      'UPDATE expos SET cluster_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND organizer_id = $3 RETURNING id, cluster_id',
      [clusterId, id, req.organizer_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Expo not found' });
    res.json({ message: clusterId ? 'Expo linked to cluster' : 'Expo unlinked from cluster', expo: r.rows[0] });
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Cluster does not exist' });
    console.error('Error updating expo cluster:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/expos/:id
 * Delete an expo (soft delete or hard delete based on config)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { force } = req.query; // ?force=true for hard delete

  try {
    // Check if expo has visitors
    const visitorCheck = await pool.query(
      'SELECT COUNT(*) as count FROM visitors WHERE expo_id = $1',
      [id]
    );

    const visitorCount = parseInt(visitorCheck.rows[0].count);

    if (visitorCount > 0 && !force) {
      return res.status(400).json({
        error: 'Cannot delete expo with visitors',
        visitor_count: visitorCount,
        message: 'Use ?force=true to delete expo and all associated data'
      });
    }

    if (force === 'true') {
      // Hard delete with cascade
      await pool.query('BEGIN');
      
      try {
        // Delete in order of dependencies
        await pool.query('DELETE FROM checkins WHERE expo_id = $1', [id]);
        await pool.query('DELETE FROM visitors WHERE expo_id = $1', [id]);
        await pool.query('DELETE FROM forms WHERE expo_id = $1', [id]);
        
        const result = await pool.query(
          'DELETE FROM expos WHERE id = $1 AND organizer_id = $2 RETURNING id, name',
          [id, req.organizer_id]
        );

        if (result.rows.length === 0) {
          await pool.query('ROLLBACK');
          return res.status(404).json({ error: 'Expo not found' });
        }

        await pool.query('COMMIT');
        
        res.json({
          message: 'Expo and all associated data deleted successfully',
          deleted: result.rows[0]
        });
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    } else {
      // Simple delete (will fail if there are foreign key constraints)
      const result = await pool.query(
        'DELETE FROM expos WHERE id = $1 AND organizer_id = $2 RETURNING id, name',
        [id, req.organizer_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Expo not found' });
      }

      res.json({
        message: 'Expo deleted successfully',
        deleted: result.rows[0]
      });
    }
  } catch (err) {
    console.error('Error deleting expo:', err);
    
    if (err.code === '23503') { // Foreign key violation
      return res.status(400).json({
        error: 'Cannot delete expo due to existing references',
        hint: 'Use ?force=true to delete expo and all associated data'
      });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/expos/:id/stats
 * Get statistics for a specific expo
 */
router.get('/:id/stats', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Verify expo ownership
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [id, req.organizer_id]
    );

    if (expoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Expo not found' });
    }

    // Get comprehensive statistics
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM visitors WHERE expo_id = $1) as total_visitors,
        (SELECT COUNT(*)::int FROM visitors WHERE expo_id = $1 AND created_at >= CURRENT_DATE) as visitors_today,
        (SELECT COUNT(*)::int FROM checkins WHERE expo_id = $1) as total_checkins,
        (SELECT COUNT(DISTINCT visitor_id)::int FROM checkins WHERE expo_id = $1) as unique_checkins,
        (SELECT COUNT(*)::int FROM checkins WHERE expo_id = $1 AND checkin_time >= CURRENT_DATE) as checkins_today,
        (SELECT COUNT(*)::int FROM visitors WHERE expo_id = $1 AND custom_fields->>'country' IS NOT NULL) as visitors_with_country,
        (SELECT json_agg(DISTINCT custom_fields->>'country') FROM visitors WHERE expo_id = $1 AND custom_fields->>'country' IS NOT NULL) as countries
    `, [id]);

    res.json({
      expo_id: id,
      statistics: stats.rows[0],
      generated_at: new Date()
    });
  } catch (err) {
    console.error('Error fetching expo stats:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
