const express = require('express');
const router = express.Router();

const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// routes/forms.js - EXHIBITORS DESTEĞİ EKLENMİŞ VERSİYON

// GET /api/forms - Get all forms for current organizer
router.get('/', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;

        const query = `
            SELECT 
                f.id,
                f.name,
                f.description,
                f.expo_id,
                f.organizer_id,
                f.fields,
                f.is_active,
                f.email_template_id,
                f.visitor_type,
                f.source,
                f.origin,
                f.created_at,
                f.updated_at,
                e.name as expo_name,
                et.name as email_template_name,
                CASE 
                    WHEN f.visitor_type = 'exhibitor' THEN COALESCE(COUNT(DISTINCT ex.id), 0)
                    ELSE COALESCE(COUNT(DISTINCT v.id), 0)
                END as submission_count
            FROM forms f
            LEFT JOIN expos e ON e.id = f.expo_id
            LEFT JOIN email_templates et ON et.id = f.email_template_id
            LEFT JOIN visitors v ON v.form_id = f.id AND f.visitor_type = 'visitor'
            LEFT JOIN exhibitors ex ON ex.form_id = f.id AND f.visitor_type = 'exhibitor'
            WHERE f.organizer_id = $1
            GROUP BY f.id, e.name, et.name
            ORDER BY f.created_at DESC
        `;

        const result = await pool.query(query, [organizerId]);

        res.json({
            success: true,
            forms: result.rows.map(form => ({
                ...form,
                fields: form.fields || [],
                submission_count: parseInt(form.submission_count) || 0,
                expo_name: form.expo_id ? form.expo_name : 'All Expos'
            }))
        });
    } catch (error) {
        console.error('Error fetching forms:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch forms'
        });
    }
});

// GET /api/forms/expo/:expo_id - Get forms for specific expo
router.get('/expo/:expo_id', authMiddleware, async (req, res) => {
    try {
        const { expo_id } = req.params;
        const organizerId = req.organizer_id;

        const query = `
            SELECT 
                f.*,
                e.name as expo_name,
                et.name as email_template_name,
                CASE 
                    WHEN f.visitor_type = 'exhibitor' THEN COALESCE(COUNT(DISTINCT ex.id), 0)
                    ELSE COALESCE(COUNT(DISTINCT v.id), 0)
                END as submission_count
            FROM forms f
            LEFT JOIN expos e ON e.id = f.expo_id
            LEFT JOIN email_templates et ON et.id = f.email_template_id
            LEFT JOIN visitors v ON v.form_id = f.id AND f.visitor_type = 'visitor'
            LEFT JOIN exhibitors ex ON ex.form_id = f.id AND f.visitor_type = 'exhibitor'
            WHERE (f.expo_id = $1 OR f.expo_id IS NULL) AND f.organizer_id = $2
            GROUP BY f.id, e.name, et.name
            ORDER BY f.created_at DESC
        `;

        const result = await pool.query(query, [expo_id, organizerId]);

        res.json({
            success: true,
            forms: result.rows.map(form => ({
                ...form,
                fields: form.fields || [],
                submission_count: parseInt(form.submission_count) || 0,
                expo_name: form.expo_id ? form.expo_name : 'All Expos'
            }))
        });
    } catch (error) {
        console.error('Error fetching expo forms:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch expo forms'
        });
    }
});

// GET /api/forms/:id - Get single form with submission details
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const organizerId = req.organizer_id;

        const query = `
            SELECT 
                f.*,
                e.name as expo_name,
                et.name as email_template_name,
                CASE 
                    WHEN f.visitor_type = 'exhibitor' THEN COALESCE(COUNT(DISTINCT ex.id), 0)
                    ELSE COALESCE(COUNT(DISTINCT v.id), 0)
                END as submission_count
            FROM forms f
            LEFT JOIN expos e ON e.id = f.expo_id
            LEFT JOIN email_templates et ON et.id = f.email_template_id
            LEFT JOIN visitors v ON v.form_id = f.id AND f.visitor_type = 'visitor'
            LEFT JOIN exhibitors ex ON ex.form_id = f.id AND f.visitor_type = 'exhibitor'
            WHERE f.id = $1 AND f.organizer_id = $2
            GROUP BY f.id, e.name, et.name
        `;

        const result = await pool.query(query, [id, organizerId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Form not found'
            });
        }

        const form = result.rows[0];
        res.json({
            success: true,
            ...form,
            fields: form.fields || [],
            submission_count: parseInt(form.submission_count) || 0,
            expo_name: form.expo_id ? form.expo_name : 'All Expos'
        });
    } catch (error) {
        console.error('Error fetching form:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch form'
        });
    }
});

// GET /api/forms/:id/submissions - Get form submissions
router.get('/:id/submissions', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const organizerId = req.organizer_id;

        const formQuery = 'SELECT visitor_type FROM forms WHERE id = $1 AND organizer_id = $2';
        const formResult = await pool.query(formQuery, [id, organizerId]);

        if (formResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Form not found'
            });
        }

        const visitorType = formResult.rows[0].visitor_type;

        let submissionsQuery;
        if (visitorType === 'exhibitor') {
            submissionsQuery = `
                SELECT 
                    id,
                    name,
                    last_name,
                    email,
                    company,
                    country,
                    job_title,
                    booth_number,
                    badge_id,
                    custom_fields,
                    timestamp as created_at,
                    'exhibitor' as type
                FROM exhibitors 
                WHERE form_id = $1 AND organizer_id = $2
                ORDER BY timestamp DESC
            `;
        } else {
            submissionsQuery = `
                SELECT 
                    id,
                    name,
                    last_name,
                    email,
                    company,
                    phone,
                    badge_id,
                    custom_fields,
                    created_at,
                    'visitor' as type
                FROM visitors 
                WHERE form_id = $1 AND organizer_id = $2
                ORDER BY created_at DESC
            `;
        }

        const submissions = await pool.query(submissionsQuery, [id, organizerId]);

        res.json({
            success: true,
            visitor_type: visitorType,
            submissions: submissions.rows
        });
    } catch (error) {
        console.error('Error fetching form submissions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch form submissions'
        });
    }
});

// ✅ NEW – POST /api/forms - Create a new form
router.post('/', authMiddleware, async (req, res) => {
    try {
        const {
            name,
            description,
            expo_id,
            fields,
            is_active,
            email_template_id,
            visitor_type,
            source,
            origin
        } = req.body;

        const organizerId = req.organizer_id;

        const query = `
            INSERT INTO forms (
                name, description, expo_id, organizer_id,
                fields, is_active, email_template_id,
                visitor_type, source, origin,
                created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            RETURNING *
        `;

        const values = [
            name,
            description,
            expo_id,
            organizerId,
            JSON.stringify(fields || []),
            is_active !== false,
            email_template_id,
            visitor_type || 'visitor',
            source || 'form-builder',
            origin || 'form-builder'
        ];

        const result = await pool.query(query, values);

        res.status(201).json({
            success: true,
            message: 'Form created successfully',
            form: result.rows[0]
        });

    } catch (error) {
        console.error('Error creating form:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create form'
        });
    }
});

// ✅ NEW – GET /api/forms/public/:id - Public form fetch (no auth)
router.get('/public/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            SELECT 
                f.id,
                f.name,
                f.description,
                f.fields,
                f.expo_id,
                f.email_template_id,
                f.visitor_type,
                f.source,
                f.origin,
                f.is_active,
                f.created_at,
                e.name as expo_name,
                et.name as email_template_name
            FROM forms f
            LEFT JOIN expos e ON e.id = f.expo_id
            LEFT JOIN email_templates et ON et.id = f.email_template_id
            WHERE f.id = $1 AND f.is_active = true
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Form not found or inactive'
            });
        }

        res.json({
            success: true,
            form: result.rows[0]
        });

    } catch (error) {
        console.error('Error fetching public form:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load form'
        });
    }
});

// ✅ PUT /api/forms/:id - Update existing form
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            description,
            expo_id,
            fields,
            is_active,
            email_template_id,
            visitor_type,
            source,
            origin
        } = req.body;
        
        const organizerId = req.organizer_id;

        // First check if form exists and belongs to this organizer
        const checkQuery = 'SELECT id FROM forms WHERE id = $1 AND organizer_id = $2';
        const checkResult = await pool.query(checkQuery, [id, organizerId]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Form not found or you do not have permission to edit it'
            });
        }

        // Update the form
        const updateQuery = `
            UPDATE forms 
            SET 
                name = $1,
                description = $2,
                expo_id = $3,
                fields = $4,
                is_active = $5,
                email_template_id = $6,
                visitor_type = $7,
                source = $8,
                origin = $9,
                updated_at = NOW()
            WHERE id = $10 AND organizer_id = $11
            RETURNING *
        `;

        const values = [
            name,
            description,
            expo_id,
            JSON.stringify(fields || []),
            is_active !== false,
            email_template_id,
            visitor_type || 'visitor',
            source,
            origin || 'form-builder',
            id,
            organizerId
        ];

        const result = await pool.query(updateQuery, values);

        res.json({
            success: true,
            message: 'Form updated successfully',
            form: result.rows[0]
        });

    } catch (error) {
        console.error('Error updating form:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update form'
        });
    }
});

// ✅ PATCH /api/forms/:id/toggle - Toggle form active status
router.patch('/:id/toggle', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const organizerId = req.organizer_id;

        // Toggle the is_active status
        const query = `
            UPDATE forms 
            SET 
                is_active = NOT is_active,
                updated_at = NOW()
            WHERE id = $1 AND organizer_id = $2
            RETURNING id, name, is_active
        `;

        const result = await pool.query(query, [id, organizerId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Form not found or you do not have permission to modify it'
            });
        }

        const form = result.rows[0];
        res.json({
            success: true,
            message: `Form "${form.name}" is now ${form.is_active ? 'active' : 'inactive'}`,
            is_active: form.is_active
        });

    } catch (error) {
        console.error('Error toggling form status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to toggle form status'
        });
    }
});

// ✅ DELETE /api/forms/:id - Delete form (soft delete recommended for production)
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const organizerId = req.organizer_id;

        // Check if form has submissions
        const checkSubmissionsQuery = `
            SELECT 
                f.visitor_type,
                CASE 
                    WHEN f.visitor_type = 'exhibitor' THEN (SELECT COUNT(*) FROM exhibitors WHERE form_id = f.id)
                    ELSE (SELECT COUNT(*) FROM visitors WHERE form_id = f.id)
                END as submission_count
            FROM forms f
            WHERE f.id = $1 AND f.organizer_id = $2
        `;
        
        const checkResult = await pool.query(checkSubmissionsQuery, [id, organizerId]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Form not found'
            });
        }

        const submissionCount = parseInt(checkResult.rows[0].submission_count);
        
        if (submissionCount > 0) {
            // If form has submissions, just deactivate it instead of deleting
            const deactivateQuery = `
                UPDATE forms 
                SET is_active = false, updated_at = NOW()
                WHERE id = $1 AND organizer_id = $2
                RETURNING name
            `;
            
            const result = await pool.query(deactivateQuery, [id, organizerId]);
            
            return res.json({
                success: true,
                message: `Form "${result.rows[0].name}" has been deactivated (has ${submissionCount} submissions)`
            });
        } else {
            // No submissions, safe to delete
            const deleteQuery = `
                DELETE FROM forms 
                WHERE id = $1 AND organizer_id = $2
                RETURNING name
            `;
            
            const result = await pool.query(deleteQuery, [id, organizerId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Form not found or you do not have permission to delete it'
                });
            }

            res.json({
                success: true,
                message: `Form "${result.rows[0].name}" deleted successfully`
            });
        }

    } catch (error) {
        console.error('Error deleting form:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete form'
        });
    }
});

module.exports = router;
