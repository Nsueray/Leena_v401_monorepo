/**
 * Email Campaign Routes
 * Leena EMS v403 — Email Sequence Campaigns
 *
 * Campaign CRUD + Steps + Recipients + Activation
 * All endpoints require JWT auth (authMiddleware → req.organizer_id)
 *
 * Endpoints:
 *   POST   /api/campaigns                          — Create campaign
 *   GET    /api/campaigns?expo_id=X&status=Y       — List campaigns
 *   GET    /api/campaigns/:id                      — Campaign detail + steps + stats
 *   PUT    /api/campaigns/:id                      — Update (draft only)
 *   DELETE /api/campaigns/:id                      — Delete (draft only)
 *
 *   POST   /api/campaigns/:id/steps                — Add step (draft only)
 *   GET    /api/campaigns/:id/steps                — List steps
 *   PUT    /api/campaigns/:id/steps/:stepId        — Update step (draft only)
 *   DELETE /api/campaigns/:id/steps/:stepId        — Delete step (draft only)
 *
 *   POST   /api/campaigns/:id/recipients/upload    — Upload CSV/Excel (draft only)
 *   POST   /api/campaigns/:id/recipients/from-expo — Add from expo visitors (draft only)
 *   GET    /api/campaigns/:id/recipients?page=X    — Paginated recipient list
 *   DELETE /api/campaigns/:id/recipients/:recId    — Remove recipient (draft only)
 *   DELETE /api/campaigns/:id/recipients           — Clear all (draft only)
 *
 *   POST   /api/campaigns/:id/activate             — draft → active
 *   POST   /api/campaigns/:id/pause                — active → paused
 *   POST   /api/campaigns/:id/resume               — paused → active
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const multer = require('multer');
const XLSX = require('xlsx');
const authMiddleware = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Apply auth to all routes
router.use(authMiddleware);

// ============================================================
// HELPERS
// ============================================================

const VALID_CONDITIONS = ['all', 'not_opened', 'opened', 'not_clicked', 'clicked', 'not_registered', 'registered'];
const VALID_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'];

async function getCampaign(campaignId, organizerId) {
  const res = await pool.query(
    'SELECT * FROM email_campaigns WHERE id = $1 AND organizer_id = $2',
    [campaignId, organizerId]
  );
  return res.rows[0] || null;
}

async function requireDraft(campaignId, organizerId) {
  const campaign = await getCampaign(campaignId, organizerId);
  if (!campaign) return { error: 'Campaign not found', status: 404 };
  if (campaign.status !== 'draft') return { error: 'Campaign must be in draft status to modify', status: 400 };
  return { campaign };
}

function normalizeEmail(email) {
  return (email || '').toString().trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ============================================================
// CAMPAIGN CRUD
// ============================================================

// POST /api/campaigns — Create campaign
router.post('/', async (req, res) => {
  try {
    const organizerId = req.organizer_id;
    const { name, expo_id, description } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Campaign name is required' });
    }

    const result = await pool.query(
      `INSERT INTO email_campaigns (organizer_id, expo_id, name, description, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [organizerId, expo_id || null, name, description || null, organizerId]
    );

    res.status(201).json({ success: true, campaign: result.rows[0] });
  } catch (err) {
    console.error('[campaigns] Create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create campaign' });
  }
});

// GET /api/campaigns — List campaigns
router.get('/', async (req, res) => {
  try {
    const organizerId = req.organizer_id;
    const { expo_id, status } = req.query;

    let query = `
      SELECT c.*,
        (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = c.id) AS recipient_count,
        (SELECT COUNT(*) FROM campaign_steps WHERE campaign_id = c.id) AS step_count,
        e.name AS expo_name
      FROM email_campaigns c
      LEFT JOIN expos e ON c.expo_id = e.id
      WHERE c.organizer_id = $1
    `;
    const values = [organizerId];
    let idx = 2;

    if (expo_id) {
      query += ` AND c.expo_id = $${idx++}`;
      values.push(expo_id);
    }
    if (status && VALID_STATUSES.includes(status)) {
      query += ` AND c.status = $${idx++}`;
      values.push(status);
    }

    query += ' ORDER BY c.created_at DESC';
    const result = await pool.query(query, values);

    res.json({ success: true, campaigns: result.rows });
  } catch (err) {
    console.error('[campaigns] List error:', err);
    res.status(500).json({ success: false, message: 'Failed to list campaigns' });
  }
});

// GET /api/campaigns/:id — Campaign detail
router.get('/:id', async (req, res) => {
  try {
    const organizerId = req.organizer_id;
    const campaign = await getCampaign(req.params.id, organizerId);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    // Fetch steps
    const stepsRes = await pool.query(
      `SELECT cs.*, et.name AS template_name, et.subject AS template_subject
       FROM campaign_steps cs
       LEFT JOIN email_templates et ON cs.template_id = et.id
       WHERE cs.campaign_id = $1 ORDER BY cs.step_number ASC`,
      [campaign.id]
    );

    // Fetch stats
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active_count,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
        COUNT(*) FILTER (WHERE status = 'unsubscribed') AS unsubscribed_count,
        COUNT(*) FILTER (WHERE status = 'bounced') AS bounced_count,
        COUNT(*) AS total_count
      FROM campaign_recipients WHERE campaign_id = $1
    `, [campaign.id]);

    // Per-step stats (unique + raw event counts)
    const stepStatsRes = await pool.query(`
      SELECT
        ee.step_id,
        COUNT(*) FILTER (WHERE ee.event_type = 'sent') AS sent_events,
        COUNT(DISTINCT ee.recipient_id) FILTER (WHERE ee.event_type = 'sent') AS sent_unique,
        COUNT(*) FILTER (WHERE ee.event_type = 'opened') AS opened_events,
        COUNT(DISTINCT ee.recipient_id) FILTER (WHERE ee.event_type = 'opened') AS opened_unique,
        COUNT(*) FILTER (WHERE ee.event_type = 'clicked') AS clicked_events,
        COUNT(DISTINCT ee.recipient_id) FILTER (WHERE ee.event_type = 'clicked') AS clicked_unique
      FROM email_events ee
      WHERE ee.campaign_id = $1
      GROUP BY ee.step_id
    `, [campaign.id]);

    const stepStatsMap = {};
    for (const s of stepStatsRes.rows) {
      stepStatsMap[s.step_id] = {
        sent: parseInt(s.sent_unique), opened: parseInt(s.opened_unique), clicked: parseInt(s.clicked_unique),
        sent_events: parseInt(s.sent_events), opened_events: parseInt(s.opened_events), clicked_events: parseInt(s.clicked_events)
      };
    }

    // Campaign-level registration count (not per-step)
    const regCountRes = await pool.query(
      `SELECT COUNT(DISTINCT recipient_id) AS registered_count FROM email_events WHERE campaign_id = $1 AND event_type = 'registered'`,
      [campaign.id]
    );

    const steps = stepsRes.rows.map(step => ({
      ...step,
      stats: stepStatsMap[step.id] || { sent: 0, opened: 0, clicked: 0, sent_events: 0, opened_events: 0, clicked_events: 0 }
    }));

    res.json({
      success: true,
      campaign: { ...campaign, registered_count: parseInt(regCountRes.rows[0].registered_count) || 0 },
      steps,
      stats: statsRes.rows[0]
    });
  } catch (err) {
    console.error('[campaigns] Detail error:', err);
    res.status(500).json({ success: false, message: 'Failed to get campaign details' });
  }
});

// PUT /api/campaigns/:id — Update campaign (draft only)
router.put('/:id', async (req, res) => {
  try {
    const { error, status, campaign } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    const { name, description } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    const whereIdIdx = idx++;
    const whereOrgIdx = idx++;
    values.push(campaign.id, req.organizer_id);

    const result = await pool.query(
      `UPDATE email_campaigns SET ${updates.join(', ')} WHERE id = $${whereIdIdx} AND organizer_id = $${whereOrgIdx} RETURNING *`,
      values
    );

    res.json({ success: true, campaign: result.rows[0] });
  } catch (err) {
    console.error('[campaigns] Update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update campaign' });
  }
});

// DELETE /api/campaigns/:id — Delete (draft only)
router.delete('/:id', async (req, res) => {
  try {
    const { error, status } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    await pool.query(
      'DELETE FROM email_campaigns WHERE id = $1 AND organizer_id = $2',
      [req.params.id, req.organizer_id]
    );

    res.json({ success: true, message: 'Campaign deleted' });
  } catch (err) {
    console.error('[campaigns] Delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete campaign' });
  }
});

// ============================================================
// STEPS
// ============================================================

// POST /api/campaigns/:id/steps — Add step
router.post('/:id/steps', async (req, res) => {
  try {
    const { error, status, campaign } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    const { template_id, delay_hours, condition } = req.body;

    if (condition && !VALID_CONDITIONS.includes(condition)) {
      return res.status(400).json({ success: false, message: `condition must be one of: ${VALID_CONDITIONS.join(', ')}` });
    }

    // Get next step number
    const maxRes = await pool.query(
      'SELECT COALESCE(MAX(step_number), 0) AS max_num FROM campaign_steps WHERE campaign_id = $1',
      [campaign.id]
    );
    const nextStep = maxRes.rows[0].max_num + 1;

    // Step 1 constraints
    const effectiveDelay = nextStep === 1 ? 0 : (parseInt(delay_hours) || 0);
    const effectiveCondition = nextStep === 1 ? 'all' : (condition || 'all');

    const result = await pool.query(
      `INSERT INTO campaign_steps (campaign_id, step_number, template_id, delay_hours, condition)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [campaign.id, nextStep, template_id || null, effectiveDelay, effectiveCondition]
    );

    res.status(201).json({ success: true, step: result.rows[0] });
  } catch (err) {
    console.error('[campaigns] Add step error:', err);
    res.status(500).json({ success: false, message: 'Failed to add step' });
  }
});

// GET /api/campaigns/:id/steps — List steps
router.get('/:id/steps', async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id, req.organizer_id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const result = await pool.query(
      `SELECT cs.*, et.name AS template_name, et.subject AS template_subject
       FROM campaign_steps cs
       LEFT JOIN email_templates et ON cs.template_id = et.id
       WHERE cs.campaign_id = $1 ORDER BY cs.step_number ASC`,
      [campaign.id]
    );

    res.json({ success: true, steps: result.rows });
  } catch (err) {
    console.error('[campaigns] List steps error:', err);
    res.status(500).json({ success: false, message: 'Failed to list steps' });
  }
});

// PUT /api/campaigns/:id/steps/:stepId — Update step (draft only)
router.put('/:id/steps/:stepId', async (req, res) => {
  try {
    const { error, status } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    const { template_id, delay_hours, condition } = req.body;

    // Check step exists and belongs to this campaign
    const stepRes = await pool.query(
      'SELECT * FROM campaign_steps WHERE id = $1 AND campaign_id = $2',
      [req.params.stepId, req.params.id]
    );
    if (stepRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Step not found' });

    const step = stepRes.rows[0];

    if (condition && !VALID_CONDITIONS.includes(condition)) {
      return res.status(400).json({ success: false, message: `condition must be one of: ${VALID_CONDITIONS.join(', ')}` });
    }

    // Step 1 constraints
    const isStep1 = step.step_number === 1;
    const effectiveDelay = isStep1 ? 0 : (delay_hours !== undefined ? parseInt(delay_hours) || 0 : step.delay_hours);
    const effectiveCondition = isStep1 ? 'all' : (condition || step.condition);

    const result = await pool.query(
      `UPDATE campaign_steps SET
        template_id = $1, delay_hours = $2, condition = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [template_id !== undefined ? template_id : step.template_id, effectiveDelay, effectiveCondition, step.id]
    );

    res.json({ success: true, step: result.rows[0] });
  } catch (err) {
    console.error('[campaigns] Update step error:', err);
    res.status(500).json({ success: false, message: 'Failed to update step' });
  }
});

// DELETE /api/campaigns/:id/steps/:stepId — Delete step (draft only, auto-renumber)
router.delete('/:id/steps/:stepId', async (req, res) => {
  try {
    const { error, status } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    const delRes = await pool.query(
      'DELETE FROM campaign_steps WHERE id = $1 AND campaign_id = $2 RETURNING step_number',
      [req.params.stepId, req.params.id]
    );
    if (delRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Step not found' });

    const deletedNum = delRes.rows[0].step_number;

    // Renumber steps after the deleted one
    await pool.query(
      `UPDATE campaign_steps SET step_number = step_number - 1, updated_at = NOW()
       WHERE campaign_id = $1 AND step_number > $2`,
      [req.params.id, deletedNum]
    );

    // Re-enforce step 1 constraints if step 1 was deleted and a new step 1 exists
    await pool.query(
      `UPDATE campaign_steps SET delay_hours = 0, condition = 'all'
       WHERE campaign_id = $1 AND step_number = 1`,
      [req.params.id]
    );

    res.json({ success: true, message: 'Step deleted and renumbered' });
  } catch (err) {
    console.error('[campaigns] Delete step error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete step' });
  }
});

// GET /api/campaigns/:id/steps/:stepId/recipients — Per-step recipient drill-down
router.get('/:id/steps/:stepId/recipients', async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id, req.organizer_id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const stepRes = await pool.query(
      `SELECT cs.*, et.name AS template_name FROM campaign_steps cs LEFT JOIN email_templates et ON cs.template_id = et.id WHERE cs.id = $1 AND cs.campaign_id = $2`,
      [req.params.stepId, campaign.id]
    );
    if (stepRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Step not found' });

    const result = await pool.query(`
      SELECT
        cr.id AS recipient_id, cr.email, cr.first_name, cr.last_name, cr.company, cr.status AS overall_status,
        EXISTS(SELECT 1 FROM email_events WHERE recipient_id = cr.id AND step_id = $2 AND event_type = 'sent') AS was_sent,
        EXISTS(SELECT 1 FROM email_events WHERE recipient_id = cr.id AND step_id = $2 AND event_type = 'opened') AS opened,
        EXISTS(SELECT 1 FROM email_events WHERE recipient_id = cr.id AND step_id = $2 AND event_type = 'clicked') AS clicked,
        EXISTS(SELECT 1 FROM email_events WHERE recipient_id = cr.id AND event_type = 'registered') AS registered,
        (SELECT MAX(created_at) FROM email_events WHERE recipient_id = cr.id AND step_id = $2 AND event_type = 'sent') AS sent_at,
        (SELECT MAX(created_at) FROM email_events WHERE recipient_id = cr.id AND step_id = $2 AND event_type = 'opened') AS first_opened_at,
        (SELECT MAX(created_at) FROM email_events WHERE recipient_id = cr.id AND step_id = $2 AND event_type = 'clicked') AS first_clicked_at
      FROM campaign_recipients cr
      WHERE cr.campaign_id = $1
        AND EXISTS(SELECT 1 FROM email_events WHERE recipient_id = cr.id AND step_id = $2)
      ORDER BY cr.email
    `, [campaign.id, req.params.stepId]);

    res.json({ success: true, step: stepRes.rows[0], recipients: result.rows });
  } catch (err) {
    console.error('[campaigns] Step recipients error:', err);
    res.status(500).json({ success: false, message: 'Failed to get step recipients' });
  }
});

// ============================================================
// RECIPIENTS
// ============================================================

// POST /api/campaigns/:id/recipients/upload — Upload CSV/Excel
router.post('/:id/recipients/upload', upload.single('file'), async (req, res) => {
  try {
    const { error, status, campaign } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Parse Excel/CSV
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'File is empty' });
    }

    // Known columns — rest goes to extra_fields
    const knownCols = new Set([
      'email', 'Email', 'EMAIL', 'e_mail',
      'first_name', 'First Name', 'name', 'Name',
      'last_name', 'Last Name', 'surname', 'Surname',
      'company', 'Company', 'COMPANY', 'organization'
    ]);

    // Load existing recipients for duplicate check
    const existingRes = await pool.query(
      'SELECT email FROM campaign_recipients WHERE campaign_id = $1',
      [campaign.id]
    );
    const existingEmails = new Set(existingRes.rows.map(r => r.email));

    // Load unsubscribes for this organizer
    const unsubRes = await pool.query(
      'SELECT email FROM email_unsubscribes WHERE organizer_id = $1',
      [req.organizer_id]
    );
    const unsubEmails = new Set(unsubRes.rows.map(r => r.email));

    let added = 0, skipped_duplicates = 0, skipped_unsubscribed = 0, invalid = 0;

    // Parse all valid rows into a batch array
    const batch = [];
    for (const row of rows) {
      const email = normalizeEmail(row.email || row.Email || row.EMAIL || row.e_mail);
      if (!email || !isValidEmail(email)) { invalid++; continue; }
      if (existingEmails.has(email)) { skipped_duplicates++; continue; }
      if (unsubEmails.has(email)) { skipped_unsubscribed++; continue; }

      const firstName = (row.first_name || row['First Name'] || row.name || row.Name || '').toString().trim();
      const lastName = (row.last_name || row['Last Name'] || row.surname || row.Surname || '').toString().trim();
      const company = (row.company || row.Company || row.COMPANY || row.organization || '').toString().trim();

      const extraFields = {};
      for (const [key, value] of Object.entries(row)) {
        if (!knownCols.has(key) && value !== null && value !== undefined && value !== '') {
          extraFields[key] = String(value).trim();
        }
      }

      batch.push({ email, firstName: firstName || null, lastName: lastName || null, company: company || null, extraFields });
      existingEmails.add(email);
    }

    // Batch INSERT in chunks of 1000
    const CHUNK_SIZE = 1000;
    for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
      const chunk = batch.slice(i, i + CHUNK_SIZE);
      const valueClauses = [];
      const params = [];
      let pi = 1;

      for (const r of chunk) {
        valueClauses.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++})`);
        params.push(campaign.id, r.email, r.firstName, r.lastName, r.company, JSON.stringify(r.extraFields));
      }

      try {
        const insertRes = await pool.query(
          `INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company, extra_fields)
           VALUES ${valueClauses.join(', ')}
           ON CONFLICT (campaign_id, email) DO NOTHING`,
          params
        );
        added += insertRes.rowCount;
      } catch (batchErr) {
        // Batch failed — fallback to per-row insert to save as many as possible
        console.warn(`[campaigns] Batch insert failed (chunk ${i}-${i + chunk.length}), falling back to per-row: ${batchErr.message}`);

        for (const r of chunk) {
          try {
            const rowRes = await pool.query(
              `INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company, extra_fields)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (campaign_id, email) DO NOTHING`,
              [campaign.id, r.email, r.firstName, r.lastName, r.company, JSON.stringify(r.extraFields)]
            );
            added += rowRes.rowCount;
          } catch (rowErr) {
            console.error(`[campaigns] Single-row insert failed for ${r.email}: ${rowErr.message}`);
            invalid++;
          }
        }
      }
    }

    // Update total_recipients count
    const countRes = await pool.query(
      'SELECT COUNT(*) AS total FROM campaign_recipients WHERE campaign_id = $1',
      [campaign.id]
    );
    await pool.query(
      'UPDATE email_campaigns SET total_recipients = $1, updated_at = NOW() WHERE id = $2',
      [parseInt(countRes.rows[0].total), campaign.id]
    );

    res.json({
      success: true,
      added,
      skipped_duplicates,
      skipped_unsubscribed,
      invalid,
      total_recipients: parseInt(countRes.rows[0].total)
    });
  } catch (err) {
    console.error('[campaigns] Upload recipients error:', err);
    res.status(500).json({ success: false, message: 'Failed to upload recipients' });
  }
});

// POST /api/campaigns/:id/recipients/from-expo — Add from expo visitors
router.post('/:id/recipients/from-expo', async (req, res) => {
  try {
    const { error, status, campaign } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    const { expo_id, filter, limit: maxLimit } = req.body;

    if (!expo_id) {
      return res.status(400).json({ success: false, message: 'expo_id is required' });
    }

    // Verify expo ownership
    const expoCheck = await pool.query(
      'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
      [expo_id, req.organizer_id]
    );
    if (expoCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Expo not found' });
    }

    // Build visitor query based on filter
    let visitorQuery = `
      SELECT v.id, v.email, v.name, v.last_name, v.company
      FROM visitors v
      WHERE v.expo_id = $1 AND v.organizer_id = $2
        AND v.email IS NOT NULL AND v.email != ''
    `;

    if (filter === 'checked_in') {
      visitorQuery += ` AND EXISTS (SELECT 1 FROM visitor_event_status ves WHERE ves.visitor_id = v.id AND ves.expo_id = v.expo_id AND ves.status = 'checked_in')`;
    } else if (filter === 'not_checked_in') {
      visitorQuery += ` AND NOT EXISTS (SELECT 1 FROM visitor_event_status ves WHERE ves.visitor_id = v.id AND ves.expo_id = v.expo_id AND ves.status = 'checked_in')`;
    }

    visitorQuery += ' ORDER BY v.created_at ASC';
    const queryValues = [expo_id, req.organizer_id];
    if (maxLimit) {
      const parsedLimit = parseInt(maxLimit);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        visitorQuery += ` LIMIT $${queryValues.length + 1}`;
        queryValues.push(parsedLimit);
      }
    }

    const visitorsRes = await pool.query(visitorQuery, queryValues);

    // Load existing + unsubscribes
    const existingRes = await pool.query(
      'SELECT email FROM campaign_recipients WHERE campaign_id = $1',
      [campaign.id]
    );
    const existingEmails = new Set(existingRes.rows.map(r => r.email));

    const unsubRes = await pool.query(
      'SELECT email FROM email_unsubscribes WHERE organizer_id = $1',
      [req.organizer_id]
    );
    const unsubEmails = new Set(unsubRes.rows.map(r => r.email));

    let added = 0, skipped_duplicates = 0, skipped_unsubscribed = 0;

    for (const v of visitorsRes.rows) {
      const email = normalizeEmail(v.email);
      if (!email || !isValidEmail(email)) continue;
      if (existingEmails.has(email)) { skipped_duplicates++; continue; }
      if (unsubEmails.has(email)) { skipped_unsubscribed++; continue; }

      try {
        await pool.query(
          `INSERT INTO campaign_recipients (campaign_id, email, first_name, last_name, company, visitor_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (campaign_id, email) DO NOTHING`,
          [campaign.id, email, v.name || null, v.last_name || null, v.company || null, v.id]
        );
        existingEmails.add(email);
        added++;
      } catch (insertErr) {
        console.error(`[campaigns] Insert from-expo error: ${insertErr.message}`);
      }
    }

    // Update total
    const countRes = await pool.query(
      'SELECT COUNT(*) AS total FROM campaign_recipients WHERE campaign_id = $1',
      [campaign.id]
    );
    await pool.query(
      'UPDATE email_campaigns SET total_recipients = $1, updated_at = NOW() WHERE id = $2',
      [parseInt(countRes.rows[0].total), campaign.id]
    );

    res.json({
      success: true,
      added,
      skipped_duplicates,
      skipped_unsubscribed,
      total_visitors_found: visitorsRes.rows.length,
      total_recipients: parseInt(countRes.rows[0].total)
    });
  } catch (err) {
    console.error('[campaigns] From-expo error:', err);
    res.status(500).json({ success: false, message: 'Failed to add recipients from expo' });
  }
});

// GET /api/campaigns/:id/recipients — Paginated list
router.get('/:id/recipients', async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id, req.organizer_id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT cr.*,
        (SELECT COUNT(DISTINCT step_id) FROM email_events WHERE recipient_id = cr.id AND event_type = 'opened') AS steps_opened,
        (SELECT COUNT(DISTINCT step_id) FROM email_events WHERE recipient_id = cr.id AND event_type = 'clicked') AS steps_clicked,
        EXISTS(SELECT 1 FROM email_events WHERE recipient_id = cr.id AND event_type = 'registered') AS has_registered,
        (SELECT MAX(created_at) FROM email_events WHERE recipient_id = cr.id AND event_type = 'sent') AS last_sent_at,
        (SELECT MAX(created_at) FROM email_events WHERE recipient_id = cr.id AND event_type = 'opened') AS last_opened_at
       FROM campaign_recipients cr
       WHERE cr.campaign_id = $1
       ORDER BY cr.created_at ASC
       LIMIT $2 OFFSET $3`,
      [campaign.id, limit, offset]
    );

    const countRes = await pool.query(
      'SELECT COUNT(*) AS total FROM campaign_recipients WHERE campaign_id = $1',
      [campaign.id]
    );

    res.json({
      success: true,
      recipients: result.rows,
      total: parseInt(countRes.rows[0].total),
      page,
      limit
    });
  } catch (err) {
    console.error('[campaigns] List recipients error:', err);
    res.status(500).json({ success: false, message: 'Failed to list recipients' });
  }
});

// DELETE /api/campaigns/:id/recipients/:recId — Remove single
router.delete('/:id/recipients/:recId', async (req, res) => {
  try {
    const { error, status } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    const delRes = await pool.query(
      'DELETE FROM campaign_recipients WHERE id = $1 AND campaign_id = $2 RETURNING id',
      [req.params.recId, req.params.id]
    );
    if (delRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Recipient not found' });

    // Update count
    await pool.query(
      `UPDATE email_campaigns SET total_recipients = (
        SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = $1
      ), updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    res.json({ success: true, message: 'Recipient removed' });
  } catch (err) {
    console.error('[campaigns] Remove recipient error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove recipient' });
  }
});

// DELETE /api/campaigns/:id/recipients — Clear all
router.delete('/:id/recipients', async (req, res) => {
  try {
    const { error, status } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    const delRes = await pool.query(
      'DELETE FROM campaign_recipients WHERE campaign_id = $1',
      [req.params.id]
    );

    await pool.query(
      'UPDATE email_campaigns SET total_recipients = 0, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    res.json({ success: true, message: `Cleared ${delRes.rowCount} recipients` });
  } catch (err) {
    console.error('[campaigns] Clear recipients error:', err);
    res.status(500).json({ success: false, message: 'Failed to clear recipients' });
  }
});

// ============================================================
// ACTIVATION / PAUSE / RESUME
// ============================================================

// POST /api/campaigns/:id/activate — draft → active
router.post('/:id/activate', async (req, res) => {
  try {
    const { error, status, campaign } = await requireDraft(req.params.id, req.organizer_id);
    if (error) return res.status(status).json({ success: false, message: error });

    // Validation: steps
    const stepsRes = await pool.query(
      'SELECT * FROM campaign_steps WHERE campaign_id = $1 ORDER BY step_number ASC',
      [campaign.id]
    );
    if (stepsRes.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Campaign must have at least 1 step' });
    }

    // All steps must have template_id
    const missingTemplate = stepsRes.rows.find(s => !s.template_id);
    if (missingTemplate) {
      return res.status(400).json({ success: false, message: `Step ${missingTemplate.step_number} has no template assigned` });
    }

    // Step 1 constraints
    const step1 = stepsRes.rows[0];
    if (step1.step_number !== 1 || step1.delay_hours !== 0 || step1.condition !== 'all') {
      return res.status(400).json({ success: false, message: 'Step 1 must have delay=0 and condition=all' });
    }

    // Validation: recipients
    const recipientCountRes = await pool.query(
      'SELECT COUNT(*) AS total FROM campaign_recipients WHERE campaign_id = $1',
      [campaign.id]
    );
    const totalRecipients = parseInt(recipientCountRes.rows[0].total);
    if (totalRecipients === 0) {
      return res.status(400).json({ success: false, message: 'Campaign must have at least 1 recipient' });
    }

    // Activate: transactional (campaign status + recipients must both succeed)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE email_campaigns SET status = 'active', started_at = NOW(), total_recipients = $1, updated_at = NOW()
         WHERE id = $2`,
        [totalRecipients, campaign.id]
      );

      await client.query(
        `UPDATE campaign_recipients SET next_step_due_at = NOW(), updated_at = NOW()
         WHERE campaign_id = $1 AND status = 'active'`,
        [campaign.id]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    console.log(`[campaigns] Campaign ${campaign.id} activated: ${totalRecipients} recipients, ${stepsRes.rows.length} steps`);

    res.json({
      success: true,
      message: `Campaign activated with ${totalRecipients} recipients`,
      total_recipients: totalRecipients,
      total_steps: stepsRes.rows.length
    });
  } catch (err) {
    console.error('[campaigns] Activate error:', err);
    res.status(500).json({ success: false, message: 'Failed to activate campaign' });
  }
});

// POST /api/campaigns/:id/pause — active → paused
router.post('/:id/pause', async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id, req.organizer_id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    if (campaign.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Only active campaigns can be paused' });
    }

    await pool.query(
      `UPDATE email_campaigns SET status = 'paused', updated_at = NOW() WHERE id = $1`,
      [campaign.id]
    );

    res.json({ success: true, message: 'Campaign paused' });
  } catch (err) {
    console.error('[campaigns] Pause error:', err);
    res.status(500).json({ success: false, message: 'Failed to pause campaign' });
  }
});

// POST /api/campaigns/:id/resume — paused → active
router.post('/:id/resume', async (req, res) => {
  try {
    const campaign = await getCampaign(req.params.id, req.organizer_id);
    if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
    if (campaign.status !== 'paused') {
      return res.status(400).json({ success: false, message: 'Only paused campaigns can be resumed' });
    }

    await pool.query(
      `UPDATE email_campaigns SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [campaign.id]
    );

    res.json({ success: true, message: 'Campaign resumed' });
  } catch (err) {
    console.error('[campaigns] Resume error:', err);
    res.status(500).json({ success: false, message: 'Failed to resume campaign' });
  }
});

module.exports = router;
