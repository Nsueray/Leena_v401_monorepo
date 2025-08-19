// routes/visitors.js
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authenticateToken = require('../middleware/authMiddleware');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

/**
 * GET /api/visitors
 * Get visitors for a specific expo with flexible field support
 */
router.get('/', authenticateToken, async (req, res) => {
    const { expoId, limit = 100, offset = 0, search } = req.query;

    if (!expoId) {
        return res.status(400).json({ error: 'expoId is required' });
    }

    try {
        const expoCheck = await pool.query(
            'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
            [expoId, req.organizer_id]
        );

        if (expoCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied to this expo' });
        }

        let query = `
            SELECT 
                v.id, v.expo_id, v.organizer_id, v.qr_code, v.source, v.origin, v.created_at, v.updated_at, v.custom_fields,
                v.custom_fields->>'name' as name,
                v.custom_fields->>'last_name' as last_name,
                v.custom_fields->>'email' as email,
                v.custom_fields->>'phone' as phone,
                v.custom_fields->>'company' as company,
                v.custom_fields->>'country' as country,
                v.custom_fields->>'job_title' as job_title,
                EXISTS (SELECT 1 FROM checkins WHERE visitor_id = v.id) as checked_in,
                (SELECT checkin_time FROM checkins WHERE visitor_id = v.id ORDER BY checkin_time DESC LIMIT 1) as last_checkin
            FROM visitors v
            WHERE v.expo_id = $1
        `;
        const queryParams = [expoId];
        let paramCount = 2;

        if (search) {
            query += ` AND (
                v.custom_fields->>'name' ILIKE $${paramCount} OR
                v.custom_fields->>'last_name' ILIKE $${paramCount} OR
                v.custom_fields->>'email' ILIKE $${paramCount} OR
                v.custom_fields->>'company' ILIKE $${paramCount} OR
                v.qr_code = $${paramCount + 1}
            )`;
            queryParams.push(`%${search}%`, search);
            paramCount += 2;
        }

        query += ` ORDER BY v.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        queryParams.push(limit, offset);

        const result = await pool.query(query, queryParams);

        const countQuery = `
            SELECT COUNT(*) as total 
            FROM visitors 
            WHERE expo_id = $1
            ${search ? `AND (
                custom_fields->>'name' ILIKE $2 OR
                custom_fields->>'last_name' ILIKE $2 OR
                custom_fields->>'email' ILIKE $2 OR
                custom_fields->>'company' ILIKE $2
            )` : ''}
        `;
        const countParams = search ? [expoId, `%${search}%`] : [expoId];
        const countResult = await pool.query(countQuery, countParams);

        res.json({
            visitors: result.rows,
            pagination: {
                total: parseInt(countResult.rows[0].total),
                limit: parseInt(limit),
                offset: parseInt(offset),
                has_more: parseInt(offset) + result.rows.length < parseInt(countResult.rows[0].total)
            }
        });
    } catch (err) {
        console.error('Error fetching visitors:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/visitors/:id
 * Get a specific visitor by ID
 */
router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `SELECT v.*, 
                    e.name as expo_name,
                    (SELECT json_agg(json_build_object(
                        'checkin_time', checkin_time, 'terminal', terminal, 'hall', hall, 'notes', notes
                    ) ORDER BY checkin_time DESC) 
                    FROM checkins 
                    WHERE visitor_id = v.id) as checkin_history
            FROM visitors v
            JOIN expos e ON v.expo_id = e.id
            WHERE v.id = $1 AND v.organizer_id = $2`,
            [id, req.organizer_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Visitor not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching visitor:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/visitors/public
 * Public registration endpoint (no auth required)
 */
router.post('/public', async (req, res) => {
    const { expo_id, source = 'public_form', origin = 'web', send_email = false, ...customFields } = req.body;

    if (!expo_id) {
        return res.status(400).json({ error: 'expo_id is required' });
    }

    try {
        const expoResult = await pool.query('SELECT id, organizer_id, name FROM expos WHERE id = $1', [expo_id]);
        if (expoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Expo not found' });
        }
        const expo = expoResult.rows[0];

        if (customFields.email) {
            const duplicateCheck = await pool.query(
                `SELECT id FROM visitors WHERE expo_id = $1 AND custom_fields->>'email' = $2`,
                [expo_id, customFields.email]
            );
            if (duplicateCheck.rows.length > 0) {
                return res.status(409).json({ error: 'Email already registered for this expo', visitor_id: duplicateCheck.rows[0].id });
            }
        }

        const qrCode = uuidv4();
        const result = await pool.query(
            `INSERT INTO visitors (expo_id, organizer_id, qr_code, source, origin, custom_fields)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [expo_id, expo.organizer_id, qrCode, source, origin, customFields]
        );
        const visitor = result.rows[0];

        let qrCodeDataUrl = null;
        if (send_email || req.query.include_qr === 'true') {
            qrCodeDataUrl = await QRCode.toDataURL(qrCode, { width: 300, margin: 2 });
        }

        if (send_email && customFields.email) {
            console.log(`TODO: Send email to ${customFields.email} with QR code ${qrCode}`);
        }

        res.status(201).json({ 
            message: 'Registration successful',
            visitor: { id: visitor.id, qr_code: visitor.qr_code, ...customFields },
            qr_code_image: qrCodeDataUrl
        });
    } catch (err) {
        console.error('Public visitor registration error:', err);
        res.status(500).json({ error: 'Failed to register visitor' });
    }
});

/**
 * POST /api/visitors
 * Create visitor (authenticated - for admin/import use)
 */
router.post('/', authenticateToken, async (req, res) => {
    const { expo_id, source = 'admin', origin = 'dashboard', custom_fields = {} } = req.body;

    if (!expo_id) {
        return res.status(400).json({ error: 'expo_id is required' });
    }

    try {
        const expoCheck = await pool.query(
            'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
            [expo_id, req.organizer_id]
        );
        if (expoCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied to this expo' });
        }

        const qrCode = uuidv4();
        const result = await pool.query(
            `INSERT INTO visitors (expo_id, organizer_id, qr_code, source, origin, custom_fields)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [expo_id, req.organizer_id, qrCode, source, origin, custom_fields]
        );
        res.status(201).json({ message: 'Visitor created successfully', visitor: result.rows[0] });
    } catch (err) {
        console.error('Error creating visitor:', err);
        res.status(500).json({ error: 'Failed to create visitor' });
    }
});

/**
 * PUT /api/visitors/:id
 * Update visitor information
 */
router.put('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { custom_fields } = req.body;

    if (!custom_fields || Object.keys(custom_fields).length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    try {
        const ownershipCheck = await pool.query(
            'SELECT custom_fields FROM visitors WHERE id = $1 AND organizer_id = $2',
            [id, req.organizer_id]
        );
        if (ownershipCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Visitor not found' });
        }

        const existingFields = ownershipCheck.rows[0].custom_fields || {};
        const mergedFields = { ...existingFields, ...custom_fields };

        const result = await pool.query(
            `UPDATE visitors 
            SET custom_fields = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND organizer_id = $3
            RETURNING *`,
            [mergedFields, id, req.organizer_id]
        );

        res.json({ message: 'Visitor updated successfully', visitor: result.rows[0] });
    } catch (err) {
        console.error('Error updating visitor:', err);
        res.status(500).json({ error: 'Failed to update visitor' });
    }
});

/**
 * DELETE /api/visitors/:id
 * Delete a visitor
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'DELETE FROM visitors WHERE id = $1 AND organizer_id = $2 RETURNING id, custom_fields',
            [id, req.organizer_id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Visitor not found' });
        }
        res.json({
            message: 'Visitor deleted successfully',
            deleted: { id: result.rows[0].id, name: result.rows[0].custom_fields?.name || 'Unknown' }
        });
    } catch (err) {
        console.error('Error deleting visitor:', err);
        if (err.code === '23503') {
            return res.status(400).json({ error: 'Cannot delete visitor with existing check-ins', hint: 'Delete check-in records first' });
        }
        res.status(500).json({ error: 'Failed to delete visitor' });
    }
});

/**
 * GET /api/visitors/export/:format
 * Export visitors in various formats (XLSX, CSV)
 */
router.get('/export/:format', authenticateToken, async (req, res) => {
    const { format } = req.params;
    const { expoId } = req.query;

    if (!['xlsx', 'csv'].includes(format)) {
        return res.status(400).json({ error: 'Invalid format. Use xlsx or csv' });
    }

    try {
        let query, params;
        let filename_prefix = `visitors_organizer_${req.organizer_id}`;

        if (expoId) {
            const expoCheck = await pool.query(
                'SELECT name FROM expos WHERE id = $1 AND organizer_id = $2',
                [expoId, req.organizer_id]
            );
            if (expoCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Access denied to this expo' });
            }
            filename_prefix = `visitors_expo_${expoId}`;
            query = `SELECT v.*, e.name as expo_name FROM visitors v JOIN expos e ON v.expo_id = e.id WHERE v.expo_id = $1 ORDER BY v.created_at DESC`;
            params = [expoId];
        } else {
            query = `SELECT v.*, e.name as expo_name FROM visitors v JOIN expos e ON v.expo_id = e.id WHERE v.organizer_id = $1 ORDER BY e.name, v.created_at DESC`;
            params = [req.organizer_id];
        }

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No visitors found' });
        }

        const exportData = result.rows.map(row => {
            const flatRow = {
                'ID': row.id,
                'QR Code': row.qr_code,
                ...row.custom_fields, // Flatten custom fields
                'Source': row.source,
                'Origin': row.origin,
                'Expo': row.expo_name,
                'Checked In': row.checked_in ? 'Yes' : 'No', // Assuming checked_in is available
                'Registration Date': new Date(row.created_at).toLocaleString()
            };
            return flatRow;
        });

        if (format === 'xlsx') {
            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Visitors');
            const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename_prefix}_${Date.now()}.xlsx"`);
            res.send(buffer);
        } else { // CSV
            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const csv = XLSX.utils.sheet_to_csv(worksheet);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename_prefix}_${Date.now()}.csv"`);
            res.send(csv);
        }
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: 'Failed to export visitors' });
    }
});

/**
 * POST /api/visitors/import
 * Bulk import visitors from CSV/XLSX
 */
router.post('/import', authenticateToken, async (req, res) => {
    const { expo_id, visitors } = req.body;

    if (!expo_id || !visitors || !Array.isArray(visitors)) {
        return res.status(400).json({ error: 'Invalid request', required: { expo_id: 'number', visitors: 'array' } });
    }
    if (visitors.length === 0) {
        return res.status(400).json({ error: 'No visitors to import' });
    }
    if (visitors.length > 5000) {
        return res.status(400).json({ error: 'Too many visitors', message: 'Maximum 5000 visitors per import', received: visitors.length });
    }

    try {
        const expoCheck = await pool.query(
            'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
            [expo_id, req.organizer_id]
        );
        if (expoCheck.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied to this expo' });
        }

        const results = { imported: [], skipped: [], errors: [] };
        await pool.query('BEGIN');

        try {
            for (let i = 0; i < visitors.length; i++) {
                const visitor = visitors[i];
                if (visitor.email) {
                    const duplicateCheck = await pool.query(
                        `SELECT id FROM visitors WHERE expo_id = $1 AND custom_fields->>'email' = $2`,
                        [expo_id, visitor.email]
                    );
                    if (duplicateCheck.rows.length > 0) {
                        results.skipped.push({ row: i + 1, email: visitor.email, reason: 'Duplicate email', existing_id: duplicateCheck.rows[0].id });
                        continue;
                    }
                }

                const qrCode = uuidv4();
                const { source, origin, ...customFields } = visitor;

                try {
                    const result = await pool.query(
                        `INSERT INTO visitors (expo_id, organizer_id, qr_code, source, origin, custom_fields)
                         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, qr_code`,
                        [expo_id, req.organizer_id, qrCode, source || 'import', origin || 'bulk_upload', customFields]
                    );
                    results.imported.push({ row: i + 1, id: result.rows[0].id, qr_code: result.rows[0].qr_code, email: visitor.email });
                } catch (err) {
                    results.errors.push({ row: i + 1, error: err.message, data: visitor });
                }
            }
            await pool.query('COMMIT');

            res.json({
                message: 'Import completed',
                summary: { total: visitors.length, imported: results.imported.length, skipped: results.skipped.length, errors: results.errors.length },
                details: results
            });
        } catch (err) {
            await pool.query('ROLLBACK');
            throw err;
        }
    } catch (err) {
        console.error('Import error:', err);
        res.status(500).json({ error: 'Failed to import visitors' });
    }
});

/**
 * GET /api/visitors/search
 * Search visitors across all expos for the organizer
 */
router.get('/search', authenticateToken, async (req, res) => {
    const { q, limit = 10 } = req.query;
    if (!q || q.length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    try {
        const result = await pool.query(
            `SELECT 
                v.id, v.qr_code, v.custom_fields, v.created_at, e.name as expo_name, e.id as expo_id
            FROM visitors v
            JOIN expos e ON v.expo_id = e.id
            WHERE v.organizer_id = $1
            AND (
                v.custom_fields->>'name' ILIKE $2 OR
                v.custom_fields->>'last_name' ILIKE $2 OR
                v.custom_fields->>'email' ILIKE $2 OR
                v.custom_fields->>'company' ILIKE $2 OR
                v.qr_code = $3
            )
            ORDER BY v.created_at DESC
            LIMIT $4`,
            [req.organizer_id, `%${q}%`, q, limit]
        );
        res.json({
            query: q,
            results: result.rows.map(row => ({ ...row.custom_fields, id: row.id, qr_code: row.qr_code, expo_name: row.expo_name, expo_id: row.expo_id, created_at: row.created_at }))
        });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * GET /api/visitors/stats
 * Get visitor statistics for an expo or organizer
 */
router.get('/stats', authenticateToken, async (req, res) => {
    const { expoId } = req.query;
    try {
        let stats;
        if (expoId) {
            const expoCheck = await pool.query('SELECT id FROM expos WHERE id = $1 AND organizer_id = $2', [expoId, req.organizer_id]);
            if (expoCheck.rows.length === 0) {
                return res.status(403).json({ error: 'Access denied to this expo' });
            }
            stats = await pool.query(`
                SELECT 
                    COUNT(*) as total_visitors,
                    COUNT(DISTINCT custom_fields->>'email') as unique_emails,
                    COUNT(DISTINCT custom_fields->>'company') as unique_companies,
                    COUNT(DISTINCT custom_fields->>'country') as unique_countries,
                    COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as registered_today,
                    (SELECT COUNT(DISTINCT visitor_id) FROM checkins WHERE expo_id = $1) as unique_checkins,
                    json_build_object(
                        'sources', (SELECT json_object_agg(source, count) FROM (SELECT source, COUNT(*) FROM visitors WHERE expo_id = $1 GROUP BY source) s),
                        'countries', (SELECT json_object_agg(country, count) FROM (SELECT custom_fields->>'country' as country, COUNT(*) FROM visitors WHERE expo_id = $1 AND custom_fields->>'country' IS NOT NULL GROUP BY custom_fields->>'country' ORDER BY COUNT(*) DESC LIMIT 10) c),
                        'daily', (SELECT json_agg(json_build_object('date', date, 'count', count) ORDER BY date) FROM (SELECT DATE(created_at) as date, COUNT(*) FROM visitors WHERE expo_id = $1 GROUP BY DATE(created_at)) d)
                    ) as breakdown
                FROM visitors
                WHERE expo_id = $1
            `, [expoId]);
        } else {
            stats = await pool.query(`
                SELECT 
                    COUNT(*) as total_visitors,
                    COUNT(DISTINCT custom_fields->>'email') as unique_emails,
                    (SELECT COUNT(DISTINCT visitor_id) FROM checkins c JOIN visitors v ON c.visitor_id = v.id WHERE v.organizer_id = $1) as total_unique_checkins,
                    json_build_object(
                        'by_expo', (SELECT json_object_agg(name, count) FROM (SELECT e.name, COUNT(v.*) FROM expos e LEFT JOIN visitors v ON e.id = v.expo_id WHERE e.organizer_id = $1 GROUP BY e.name) x)
                    ) as breakdown
                FROM visitors
                WHERE organizer_id = $1
            `, [req.organizer_id]);
        }
        res.json({
            scope: expoId ? 'expo' : 'organizer',
            scope_id: expoId || req.organizer_id,
            statistics: stats.rows[0],
            generated_at: new Date()
        });
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: 'Failed to generate statistics' });
    }
});

module.exports = router;
