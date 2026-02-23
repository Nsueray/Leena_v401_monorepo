/**
 * Exhibitor Lead Scanning Routes
 * Leena EMS v402
 * 
 * Public-facing endpoints for exhibitors to scan visitor QR codes
 * Auth via exhibitor's own QR code (no JWT)
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');

/**
 * POST /api/leads/auth
 * Exhibitor authenticates by scanning their own badge QR
 * Returns exhibitor info + company session token
 */
router.post('/auth', async (req, res) => {
  try {
    const { qr_code, expo_id } = req.body;

    if (!qr_code || !expo_id) {
      return res.status(400).json({ success: false, message: 'qr_code and expo_id required' });
    }

    const result = await pool.query(
      `SELECT id, name, last_name, email, company, visitor_type, booth_number
       FROM visitors
       WHERE qr_code = $1 AND expo_id = $2 LIMIT 1`,
      [qr_code, expo_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Badge not found' });
    }

    const exhibitor = result.rows[0];

    if (exhibitor.visitor_type !== 'exhibitor') {
      return res.status(403).json({ success: false, message: 'This badge is not an exhibitor badge' });
    }

    if (!exhibitor.company) {
      return res.status(400).json({ success: false, message: 'Exhibitor has no company assigned' });
    }

    // Get count of leads already scanned by this company
    const leadCount = await pool.query(
      `SELECT COUNT(*) as count FROM exhibitor_leads WHERE exhibitor_company = $1 AND expo_id = $2`,
      [exhibitor.company, expo_id]
    );

    console.log(`🏢 [LEADS] Exhibitor logged in: ${exhibitor.name} (${exhibitor.company})`);

    res.json({
      success: true,
      exhibitor: {
        id: exhibitor.id,
        name: exhibitor.name,
        last_name: exhibitor.last_name,
        company: exhibitor.company,
        booth_number: exhibitor.booth_number
      },
      lead_count: parseInt(leadCount.rows[0].count)
    });

  } catch (err) {
    console.error('❌ [LEADS] Auth error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/leads/scan
 * Scan a visitor QR code to record as lead
 */
router.post('/scan', async (req, res) => {
  try {
    const { qr_code, exhibitor_id, exhibitor_company, expo_id } = req.body;

    if (!qr_code || !exhibitor_id || !exhibitor_company || !expo_id) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Find visitor by QR
    const visitor = await pool.query(
      `SELECT id, name, last_name, email, company, country, job_title, phone, visitor_type
       FROM visitors
       WHERE qr_code = $1 AND expo_id = $2 LIMIT 1`,
      [qr_code, expo_id]
    );

    if (visitor.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Visitor not found' });
    }

    const lead = visitor.rows[0];

    // Check duplicate - same exhibitor company + same visitor
    const duplicate = await pool.query(
      `SELECT id FROM exhibitor_leads 
       WHERE exhibitor_company = $1 AND lead_visitor_id = $2 AND expo_id = $3 LIMIT 1`,
      [exhibitor_company, lead.id, expo_id]
    );

    if (duplicate.rows.length > 0) {
      return res.json({
        success: true,
        duplicate: true,
        message: 'Already scanned',
        visitor: {
          name: lead.name,
          last_name: lead.last_name,
          email: lead.email,
          company: lead.company,
          country: lead.country,
          job_title: lead.job_title,
          phone: lead.phone,
          visitor_type: lead.visitor_type
        }
      });
    }

    // Insert lead
    await pool.query(
      `INSERT INTO exhibitor_leads (expo_id, exhibitor_visitor_id, exhibitor_company, lead_visitor_id, scanned_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [expo_id, exhibitor_id, exhibitor_company, lead.id]
    );

    // Get updated count
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM exhibitor_leads WHERE exhibitor_company = $1 AND expo_id = $2`,
      [exhibitor_company, expo_id]
    );

    console.log(`📇 [LEADS] New lead: ${lead.name} → ${exhibitor_company}`);

    res.json({
      success: true,
      duplicate: false,
      message: 'Lead saved!',
      visitor: {
        name: lead.name,
        last_name: lead.last_name,
        email: lead.email,
        company: lead.company,
        country: lead.country,
        job_title: lead.job_title,
        phone: lead.phone,
        visitor_type: lead.visitor_type
      },
      total_leads: parseInt(countResult.rows[0].count)
    });

  } catch (err) {
    console.error('❌ [LEADS] Scan error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/leads/list
 * Get all leads for a company at an expo
 */
router.get('/list', async (req, res) => {
  try {
    const { exhibitor_company, expo_id } = req.query;

    if (!exhibitor_company || !expo_id) {
      return res.status(400).json({ success: false, message: 'exhibitor_company and expo_id required' });
    }

    const result = await pool.query(
      `SELECT 
        el.id,
        el.scanned_at,
        v.name, v.last_name, v.email, v.company, v.country, v.job_title, v.phone, v.visitor_type,
        ev.name as scanned_by_name, ev.last_name as scanned_by_last_name
       FROM exhibitor_leads el
       JOIN visitors v ON v.id = el.lead_visitor_id
       JOIN visitors ev ON ev.id = el.exhibitor_visitor_id
       WHERE el.exhibitor_company = $1 AND el.expo_id = $2
       ORDER BY el.scanned_at DESC`,
      [exhibitor_company, expo_id]
    );

    res.json({
      success: true,
      leads: result.rows,
      total: result.rows.length
    });

  } catch (err) {
    console.error('❌ [LEADS] List error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
