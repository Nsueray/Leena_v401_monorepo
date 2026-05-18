/**
 * Badge Templates Routes
 * Leena EMS v402
 * 
 * Manages badge print templates (size, content, style)
 * 
 * Endpoints:
 *   GET    /api/badge-templates          - List all templates for organizer
 *   GET    /api/badge-templates/:id      - Get single template
 *   POST   /api/badge-templates          - Create new template
 *   PUT    /api/badge-templates/:id      - Update template
 *   DELETE /api/badge-templates/:id      - Delete template
 *   GET    /api/badge-templates/for-terminal/:terminalKey - Get template for terminal (public)
 */

const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// Default configs
const DEFAULT_SIZE_CONFIG = {
  width_mm: 100,
  height_mm: 50,
  orientation: 'landscape'
};

const DEFAULT_CONTENT_CONFIG = {
  show_qr: true,
  show_name: true,
  show_company: true,
  show_country: false,
  show_role: false,
  show_badge_id: false,
  show_job_title: false,
  show_booth_number: false,
  show_phone: false,
  show_sector: false
};

const DEFAULT_STYLE_CONFIG = {
  font_size_name: '18pt',
  font_size_company: '14pt',
  font_size_country: '12pt',
  font_family: 'Arial, sans-serif'
};

/**
 * GET /api/badge-templates
 * List all templates for the authenticated organizer
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM badge_templates 
       WHERE organizer_id = $1 
       ORDER BY is_default DESC, created_at DESC`,
      [req.organizer_id]
    );

    res.json({
      success: true,
      templates: result.rows
    });
  } catch (err) {
    console.error('[badge-templates] List error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to list templates' });
  }
});

/**
 * GET /api/badge-templates/:id
 * Get a single template
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM badge_templates 
       WHERE id = $1 AND organizer_id = $2`,
      [id, req.organizer_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({
      success: true,
      template: result.rows[0]
    });
  } catch (err) {
    console.error('[badge-templates] Get error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get template' });
  }
});

/**
 * POST /api/badge-templates
 * Create a new template
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, size_config, content_config, style_config, is_default, visitor_type } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    // If this is set as default, unset other defaults first
    if (is_default) {
      await pool.query(
        `UPDATE badge_templates SET is_default = FALSE WHERE organizer_id = $1`,
        [req.organizer_id]
      );
    }

    const result = await pool.query(
      `INSERT INTO badge_templates 
       (organizer_id, name, description, size_config, content_config, style_config, is_default, visitor_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.organizer_id,
        name,
        description || null,
        size_config || DEFAULT_SIZE_CONFIG,
        content_config || DEFAULT_CONTENT_CONFIG,
        style_config || DEFAULT_STYLE_CONFIG,
        is_default || false,
        visitor_type || 'all'
      ]
    );

    res.status(201).json({
      success: true,
      template: result.rows[0]
    });
  } catch (err) {
    console.error('[badge-templates] Create error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create template' });
  }
});

/**
 * PUT /api/badge-templates/:id
 * Update a template
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, size_config, content_config, style_config, is_default, visitor_type } = req.body;

    // Check ownership
    const check = await pool.query(
      `SELECT id FROM badge_templates WHERE id = $1 AND organizer_id = $2`,
      [id, req.organizer_id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    // If setting as default, unset others first
    if (is_default) {
      await pool.query(
        `UPDATE badge_templates SET is_default = FALSE WHERE organizer_id = $1 AND id != $2`,
        [req.organizer_id, id]
      );
    }

    const result = await pool.query(
      `UPDATE badge_templates SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         size_config = COALESCE($3, size_config),
         content_config = COALESCE($4, content_config),
         style_config = COALESCE($5, style_config),
         is_default = COALESCE($6, is_default),
         visitor_type = COALESCE($7, visitor_type)
       WHERE id = $8 AND organizer_id = $9
       RETURNING *`,
      [name, description, size_config, content_config, style_config, is_default, visitor_type, id, req.organizer_id]
    );

    res.json({
      success: true,
      template: result.rows[0]
    });
  } catch (err) {
    console.error('[badge-templates] Update error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update template' });
  }
});

/**
 * DELETE /api/badge-templates/:id
 * Delete a template
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if template is in use
    const usageCheck = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM terminals WHERE badge_template_id = $1) as terminal_count,
        (SELECT COUNT(*) FROM expos WHERE default_badge_template_id = $1) as expo_count`,
      [id]
    );

    const { terminal_count, expo_count } = usageCheck.rows[0];
    if (parseInt(terminal_count) > 0 || parseInt(expo_count) > 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Template is in use by terminals or expos. Remove references first.' 
      });
    }

    const result = await pool.query(
      `DELETE FROM badge_templates WHERE id = $1 AND organizer_id = $2 RETURNING id`,
      [id, req.organizer_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error('[badge-templates] Delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete template' });
  }
});

/**
 * GET /api/badge-templates/for-terminal/:terminalKey
 * Get the badge template for a specific terminal (PUBLIC - no auth required)
 * Priority: Terminal > Expo > Organizer Default
 */
router.get('/for-terminal/:terminalKey', async (req, res) => {
  try {
    const { terminalKey } = req.params;

    // Get terminal with its expo and organizer info
    const terminalResult = await pool.query(
      `SELECT 
         t.id as terminal_id,
         t.hall,
         t.terminal_no,
         t.badge_template_id,
         t.allow_manual_registration,
         t.kind,
         t.expo_id,
         t.organizer_id,
         e.default_badge_template_id as expo_badge_template_id,
         e.name as expo_name
       FROM terminals t
       JOIN expos e ON t.expo_id = e.id
       WHERE t.terminal_key = $1 AND t.is_active = TRUE`,
      [terminalKey]
    );

    if (terminalResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Terminal not found' });
    }

    const terminal = terminalResult.rows[0];

    // Determine which template to use (priority chain)
    let templateId = terminal.badge_template_id || terminal.expo_badge_template_id;

    let template = null;

    if (templateId) {
      // Get specific template
      const templateResult = await pool.query(
        `SELECT * FROM badge_templates WHERE id = $1`,
        [templateId]
      );
      if (templateResult.rows.length > 0) {
        template = templateResult.rows[0];
      }
    }

    // Fallback to organizer's default template
    if (!template) {
      const defaultResult = await pool.query(
        `SELECT * FROM badge_templates 
         WHERE organizer_id = $1 AND is_default = TRUE
         LIMIT 1`,
        [terminal.organizer_id]
      );
      if (defaultResult.rows.length > 0) {
        template = defaultResult.rows[0];
      }
    }

    // Ultimate fallback - return default config
    if (!template) {
      template = {
        id: null,
        name: 'System Default',
        size_config: DEFAULT_SIZE_CONFIG,
        content_config: DEFAULT_CONTENT_CONFIG,
        style_config: DEFAULT_STYLE_CONFIG
      };
    }

    res.json({
      success: true,
      terminal: {
        id: terminal.terminal_id,
        hall: terminal.hall,
        terminalNo: terminal.terminal_no,
        expoId: terminal.expo_id,
        expoName: terminal.expo_name,
        allowManualRegistration: terminal.allow_manual_registration,
        kind: terminal.kind
      },
      template: template
    });
  } catch (err) {
    console.error('[badge-templates] For-terminal error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to get template' });
  }
});

module.exports = router;
