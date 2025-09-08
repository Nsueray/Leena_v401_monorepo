const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// GET /api/email-templates - Get all templates for organizer
router.get('/', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        
        const query = `
            SELECT id, name, subject, html_content, is_active, 
                   is_registration_default, created_at, updated_at
            FROM email_templates
            WHERE organizer_id = $1
            ORDER BY created_at DESC
        `;
        
        const result = await pool.query(query, [organizerId]);
        
        res.json({
            success: true,
            templates: result.rows
        });
    } catch (error) {
        console.error('Error fetching email templates:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch email templates'
        });
    }
});

// ✅ NEW: GET /api/templates?expo_id=... (for form-builder dropdown)
router.get('/templates', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;

        const query = `
            SELECT id, name, subject
            FROM email_templates
            WHERE organizer_id = $1 AND is_active = true
            ORDER BY created_at DESC
        `;

        const result = await pool.query(query, [organizerId]);

        res.json({
            success: true,
            templates: result.rows
        });
    } catch (error) {
        console.error('Error fetching templates for form-builder:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch templates'
        });
    }
});

// GET /api/email-templates/:id - Get single template
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const organizerId = req.organizer_id;
        
        const query = `
            SELECT * FROM email_templates
            WHERE id = $1 AND organizer_id = $2
        `;
        
        const result = await pool.query(query, [id, organizerId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }
        
        res.json({
            success: true,
            template: result.rows[0]
        });
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch template'
        });
    }
});

// POST /api/email-templates - Create new template
router.post('/', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const { name, subject, html_content, is_active, is_registration_default } = req.body;
        
        if (!name || !subject || !html_content) {
            return res.status(400).json({
                success: false,
                message: 'Name, subject, and content are required'
            });
        }
        
        if (is_registration_default) {
            await pool.query(
                `UPDATE email_templates 
                 SET is_registration_default = false 
                 WHERE organizer_id = $1`,
                [organizerId]
            );
        }
        
        const query = `
            INSERT INTO email_templates 
            (organizer_id, name, subject, body, html_content, is_active, is_registration_default, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            RETURNING *
        `;
        
        const values = [
            organizerId,
            name,
            subject,
            html_content,
            html_content,
            is_active !== false,
            is_registration_default || false
        ];
        
        const result = await pool.query(query, values);
        
        res.status(201).json({
            success: true,
            message: 'Template created successfully',
            template: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating template:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create template'
        });
    }
});

// PUT /api/email-templates/:id - Update template
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const organizerId = req.organizer_id;
        const { name, subject, html_content, is_active, is_registration_default } = req.body;
        
        const checkQuery = 'SELECT id FROM email_templates WHERE id = $1 AND organizer_id = $2';
        const checkResult = await pool.query(checkQuery, [id, organizerId]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Template not found or access denied'
            });
        }
        
        if (is_registration_default) {
            await pool.query(
                `UPDATE email_templates 
                 SET is_registration_default = false 
                 WHERE organizer_id = $1 AND id != $2`,
                [organizerId, id]
            );
        }
        
        const query = `
            UPDATE email_templates
            SET name = $1, subject = $2, body = $3, html_content = $4, 
                is_active = $5, is_registration_default = $6, updated_at = NOW()
            WHERE id = $7 AND organizer_id = $8
            RETURNING *
        `;
        
        const values = [
            name,
            subject,
            html_content,
            html_content,
            is_active !== false,
            is_registration_default || false,
            id,
            organizerId
        ];
        
        const result = await pool.query(query, values);
        
        res.json({
            success: true,
            message: 'Template updated successfully',
            template: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating template:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update template'
        });
    }
});

// DELETE /api/email-templates/:id - Delete template
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const organizerId = req.organizer_id;
        
        const query = `
            DELETE FROM email_templates 
            WHERE id = $1 AND organizer_id = $2
            RETURNING name
        `;
        
        const result = await pool.query(query, [id, organizerId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Template not found or access denied'
            });
        }
        
        res.json({
            success: true,
            message: `Template "${result.rows[0].name}" deleted successfully`
        });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete template'
        });
    }
});

// POST /api/email-templates/defaults - Load default templates
router.post('/defaults', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;

        const checkQuery = 'SELECT COUNT(*) FROM email_templates WHERE organizer_id = $1';
        const checkResult = await pool.query(checkQuery, [organizerId]);

        const count = parseInt(checkResult.rows[0].count || '0');
        if (count > 0) {
            return res.json({
                success: false,
                message: 'Templates already exist'
            });
        }

        const defaultTemplates = [
            {
                name: 'QR Code Badge',
                subject: 'Your Badge for {{expo_name}}',
                html_content: '<p>Hello {{name}}, here is your badge QR: {{qr_code}}</p>',
                is_registration_default: true
            }
        ];

        for (const template of defaultTemplates) {
            await pool.query(
                `INSERT INTO email_templates 
                (organizer_id, name, subject, body, html_content, is_active, is_registration_default, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, true, $6, NOW(), NOW())
                ON CONFLICT DO NOTHING`,
                [organizerId, template.name, template.subject, template.html_content, template.html_content, template.is_registration_default]
            );
        }

        res.json({
            success: true,
            message: 'Default templates loaded successfully'
        });
    } catch (error) {
        console.error('Error loading default templates:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load default templates'
        });
    }
});

module.exports = router;
