const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// Helper function to safely process fields
const processFields = (fields) => {
    if (!Array.isArray(fields)) return [];
    
    return fields.map(field => ({
        name: String(field?.name || '').trim(),
        label: String(field?.label || '').trim(),
        type: String(field?.type || 'text').toLowerCase(),
        required: Boolean(field?.required),
        placeholder: String(field?.placeholder || '').trim(),
        helpText: String(field?.helpText || '').trim(),
        options: Array.isArray(field?.options) ? field.options.filter(opt => opt) : []
    })).filter(field => field.name && field.label);
};

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
                COALESCE(COUNT(DISTINCT v.id), 0) + COALESCE(COUNT(DISTINCT ex.id), 0) as submission_count
            FROM forms f
            LEFT JOIN expos e ON e.id = f.expo_id
            LEFT JOIN email_templates et ON et.id = f.email_template_id
            LEFT JOIN visitors v ON v.form_id = f.id
            LEFT JOIN exhibitors ex ON ex.form_id = f.id
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
                COALESCE(COUNT(DISTINCT v.id), 0) + COALESCE(COUNT(DISTINCT ex.id), 0) as submission_count
            FROM forms f
            LEFT JOIN expos e ON e.id = f.expo_id
            LEFT JOIN email_templates et ON et.id = f.email_template_id
            LEFT JOIN visitors v ON v.form_id = f.id
            LEFT JOIN exhibitors ex ON ex.form_id = f.id
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

// GET /api/forms/:id - Get single form
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const organizerId = req.organizer_id;
        
        const query = `
            SELECT 
                f.*,
                e.name as expo_name,
                et.name as email_template_name,
                COALESCE(COUNT(DISTINCT v.id), 0) + COALESCE(COUNT(DISTINCT ex.id), 0) as submission_count
            FROM forms f
            LEFT JOIN expos e ON e.id = f.expo_id
            LEFT JOIN email_templates et ON et.id = f.email_template_id
            LEFT JOIN visitors v ON v.form_id = f.id
            LEFT JOIN exhibitors ex ON ex.form_id = f.id
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

// POST /api/forms - Create new form with email template and visitor type
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
        
        // Validation
        if (!name || !name.trim()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Form name is required' 
            });
        }
        
        // Validate visitor_type
        if (visitor_type && !['visitor', 'exhibitor'].includes(visitor_type)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid visitor type. Must be "visitor" or "exhibitor"' 
            });
        }
        
        // Process and validate fields
        const processedFields = processFields(fields);
        
        if (processedFields.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'At least one valid field is required' 
            });
        }
        
        const query = `
            INSERT INTO forms (
                name, 
                description, 
                expo_id, 
                organizer_id, 
                fields, 
                is_active,
                email_template_id,
                visitor_type,
                source,
                origin,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `;
        
        const values = [
            name.trim(),
            description?.trim() || null,
            expo_id || null,
            organizerId,
            JSON.stringify(processedFields),
            is_active !== false,
            email_template_id || null,
            visitor_type || 'visitor',
            source || null,
            origin || 'form-public'
        ];
        
        const result = await pool.query(query, values);
        
        res.status(201).json({
            success: true,
            message: 'Form created successfully',
            form: {
                ...result.rows[0],
                fields: processedFields
            }
        });
    } catch (error) {
        console.error('Error creating form:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create form'
        });
    }
});

// PUT /api/forms/:id - Update form with email template and visitor type
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
        
        // Check ownership
        const checkQuery = 'SELECT * FROM forms WHERE id = $1 AND organizer_id = $2';
        const checkResult = await pool.query(checkQuery, [id, organizerId]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Form not found or access denied' 
            });
        }
        
        // Build dynamic update
        const updates = [];
        const values = [];
        let valueIndex = 1;
        
        if (name !== undefined && name.trim()) {
            updates.push(`name = $${valueIndex++}`);
            values.push(name.trim());
        }
        
        if (description !== undefined) {
            updates.push(`description = $${valueIndex++}`);
            values.push(description?.trim() || null);
        }
        
        if (expo_id !== undefined) {
            updates.push(`expo_id = $${valueIndex++}`);
            values.push(expo_id || null);
        }
        
        if (email_template_id !== undefined) {
            updates.push(`email_template_id = $${valueIndex++}`);
            values.push(email_template_id || null);
        }
        
        if (visitor_type !== undefined) {
            if (!['visitor', 'exhibitor'].includes(visitor_type)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid visitor type' 
                });
            }
            updates.push(`visitor_type = $${valueIndex++}`);
            values.push(visitor_type);
        }
        
        if (source !== undefined) {
            updates.push(`source = $${valueIndex++}`);
            values.push(source || null);
        }
        
        if (origin !== undefined) {
            updates.push(`origin = $${valueIndex++}`);
            values.push(origin || 'form-public');
        }
        
        if (fields !== undefined) {
            const processedFields = processFields(fields);
            if (processedFields.length === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'At least one valid field is required' 
                });
            }
            updates.push(`fields = $${valueIndex++}`);
            values.push(JSON.stringify(processedFields));
        }
        
        if (is_active !== undefined) {
            updates.push(`is_active = $${valueIndex++}`);
            values.push(Boolean(is_active));
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No valid updates provided' 
            });
        }
        
        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        values.push(id, organizerId);
        
        const updateQuery = `
            UPDATE forms 
            SET ${updates.join(', ')}
            WHERE id = $${valueIndex} AND organizer_id = $${valueIndex + 1}
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, values);
        
        res.json({
            success: true,
            message: 'Form updated successfully',
            form: {
                ...result.rows[0],
                fields: result.rows[0].fields || []
            }
        });
    } catch (error) {
        console.error('Error updating form:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update form'
        });
    }
});

// Other routes remain the same...
// DELETE, PATCH /toggle, GET /stats, GET /public/:id, GET /available/:expo_id

// GET /api/forms/public/:id - Get public form (no auth required)
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
                e.name as expo_name,
                et.subject as email_subject,
                et.html_content as email_html,
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
        
        const form = result.rows[0];
        res.json({
            success: true,
            form: {
                ...form,
                expo_name: form.expo_id ? form.expo_name : 'All Expos'
            }
        });
    } catch (error) {
        console.error('Error fetching public form:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch form'
        });
    }
});

module.exports = router;
