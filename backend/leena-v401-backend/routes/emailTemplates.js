// routes/emailTemplates.js
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
        
        // Validation
        if (!name || !subject || !html_content) {
            return res.status(400).json({
                success: false,
                message: 'Name, subject, and content are required'
            });
        }
        
        // If setting as registration default, unset others
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
            html_content,  // body column için de aynı değeri kullan
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
        
        // Check ownership
        const checkQuery = 'SELECT id FROM email_templates WHERE id = $1 AND organizer_id = $2';
        const checkResult = await pool.query(checkQuery, [id, organizerId]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Template not found or access denied'
            });
        }
        
        // If setting as registration default, unset others
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
            html_content,  // body column için
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
        
        // Check if organizer already has templates
        const checkQuery = 'SELECT COUNT(*) FROM email_templates WHERE organizer_id = $1';
        const checkResult = await pool.query(checkQuery, [organizerId]);
        
        if (parseInt(checkResult.rows[0].count) > 0) {
            // Add to existing templates
        }
        
        const defaultTemplates = [
            {
                name: 'Welcome Email',
                subject: 'Welcome to {{expo_name}}!',
                html_content: `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 30px; background: #f8f9fa; }
        .footer { text-align: center; padding: 20px; color: #6c757d; font-size: 0.9em; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Welcome to {{expo_name}}!</h1>
        </div>
        <div class="content">
            <h2>Hello {{name}}!</h2>
            <p>Thank you for registering for {{expo_name}}. We're excited to have you join us!</p>
            <p><strong>Your Details:</strong><br>
            Email: {{email}}<br>
            Company: {{company}}</p>
            <p>We look forward to seeing you at the event!</p>
        </div>
        <div class="footer">
            <p>&copy; 2025 {{expo_name}}. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`,
                is_registration_default: true
            },
            {
                name: 'QR Code Badge',
                subject: 'Your Badge for {{expo_name}}',
                html_content: `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 30px; background: #f8f9fa; text-align: center; }
        .qr-box { background: white; padding: 20px; border-radius: 10px; display: inline-block; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Your Event Badge</h1>
        </div>
        <div class="content">
            <h2>Hello {{name}}!</h2>
            <p>Here's your QR code badge for {{expo_name}}:</p>
            <div class="qr-box">
                {{qr_code}}
            </div>
            <p>Show this QR code at the entrance for quick check-in.</p>
            <a href="{{badge_url}}" class="button">Download Badge</a>
        </div>
    </div>
</body>
</html>`,
                is_registration_default: false
            },
            {
                name: 'General Announcement',
                subject: 'Important Update: {{expo_name}}',
                html_content: `<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { padding: 30px; background: #f8f9fa; }
        .footer { text-align: center; padding: 20px; color: #6c757d; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{{expo_name}} Update</h1>
        </div>
        <div class="content">
            <h2>Dear {{name}},</h2>
            <p>We have an important announcement regarding {{expo_name}}.</p>
            <p>[Your announcement content goes here]</p>
            <p>Thank you for your attention.</p>
            <p>Best regards,<br>The {{expo_name}} Team</p>
        </div>
        <div class="footer">
            <p>&copy; 2025 {{expo_name}}. All rights reserved.</p>
        </div>
    </div>
</body>
</html>`,
                is_registration_default: false
            }
        ];
        
        // Insert default templates
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
