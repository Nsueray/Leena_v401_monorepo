// routes/emailTemplates.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');

// POST / - Create new template
router.post('/', authenticateToken, async (req, res) => {
    const { name, subject, body, expo_id, template_type } = req.body;
    if (!name || !subject || !body) {
        return res.status(400).json({ error: 'Name, subject, and body are required' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO email_templates (organizer_id, expo_id, name, subject, body, template_type)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [req.organizer_id, expo_id || null, name, subject, body, template_type || 'custom']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating email template:', err);
        res.status(500).json({ error: 'Failed to create email template' });
    }
});

// GET / - List templates with filtering
router.get('/', authenticateToken, async (req, res) => {
    const { expo_id } = req.query;
    try {
        let query = `
            SELECT et.*, 
                   (SELECT COUNT(*) FROM email_logs WHERE template_id = et.id AND status = 'sent') as sent_count
            FROM email_templates et 
            WHERE organizer_id = $1
        `;
        const params = [req.organizer_id];
        if (expo_id) {
            query += ' AND (expo_id = $2 OR expo_id IS NULL)';
            params.push(expo_id);
        }
        query += ' ORDER BY name';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching email templates:', err);
        res.status(500).json({ error: 'Failed to fetch email templates' });
    }
});

// GET /:id - Get specific template
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM email_templates WHERE id = $1 AND organizer_id = $2', [id, req.organizer_id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching email template:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /:id - Update template
router.put('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { name, subject, body, expo_id, template_type } = req.body;
    try {
        const result = await pool.query(
            `UPDATE email_templates 
             SET name = $1, subject = $2, body = $3, expo_id = $4, template_type = $5, updated_at = CURRENT_TIMESTAMP
             WHERE id = $6 AND organizer_id = $7 RETURNING *`,
            [name, subject, body, expo_id || null, template_type, id, req.organizer_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating email template:', err);
        res.status(500).json({ error: 'Failed to update email template' });
    }
});

// DELETE /:id - Delete template
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM email_templates WHERE id = $1 AND organizer_id = $2 RETURNING *', [id, req.organizer_id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Template not found' });
        }
        res.status(200).json({ message: 'Template deleted successfully' });
    } catch (err) {
        console.error('Error deleting email template:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
