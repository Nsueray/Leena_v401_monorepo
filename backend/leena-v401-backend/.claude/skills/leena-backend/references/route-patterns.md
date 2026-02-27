# Route Patterns Reference

## Route File Skeleton

```javascript
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// GET endpoint - list with pagination
router.get('/', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        // ...
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

// GET endpoint - single item
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const result = await pool.query(
            'SELECT * FROM my_table WHERE id = $1 AND organizer_id = $2',
            [req.params.id, organizerId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

// POST endpoint - create
router.post('/', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const { name, expo_id } = req.body;

        if (!name || !expo_id) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const result = await pool.query(
            `INSERT INTO my_table (name, expo_id, organizer_id, created_at)
             VALUES ($1, $2, $3, NOW()) RETURNING *`,
            [name, expo_id, organizerId]
        );

        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

// PUT endpoint - update
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const { name } = req.body;

        const result = await pool.query(
            `UPDATE my_table SET name = $1, updated_at = NOW()
             WHERE id = $2 AND organizer_id = $3 RETURNING *`,
            [name, req.params.id, organizerId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }

        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

// DELETE endpoint
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const result = await pool.query(
            'DELETE FROM my_table WHERE id = $1 AND organizer_id = $2',
            [req.params.id, organizerId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
        res.json({ success: true, message: 'Deleted' });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

// PATCH toggle endpoint
router.patch('/:id/toggle', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const result = await pool.query(
            `UPDATE my_table SET is_active = NOT is_active
             WHERE id = $1 AND organizer_id = $2 RETURNING *`,
            [req.params.id, organizerId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

// POST clone endpoint
router.post('/clone/:id', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const { target_expo_id } = req.body;

        const original = await pool.query(
            'SELECT * FROM my_table WHERE id = $1 AND organizer_id = $2',
            [req.params.id, organizerId]
        );
        if (original.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }

        const item = original.rows[0];
        const result = await pool.query(
            `INSERT INTO my_table (name, expo_id, organizer_id, is_active, created_at)
             VALUES ($1, $2, $3, false, NOW()) RETURNING *`,
            [`${item.name} (Clone)`, target_expo_id, organizerId]
        );

        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});

module.exports = router;
```

## index.js Mount Pattern

```javascript
// In index.js, inside the try/catch block:
try {
    const myRoutes = require('./routes/myFile');
    app.use('/api/my-path', myRoutes);
} catch (e) {
    console.error('Failed to load myRoutes:', e.message);
}
```

## Existing Route Mounts (for reference)

| Variable | Path | File |
|----------|------|------|
| authRoutes | /api/auth | routes/auth.js |
| organizerRoutes | /api/organizers | routes/organizers.js |
| expoRoutes | /api/expos | routes/expos.js |
| visitorRoutes | /api/visitors | routes/visitors.js |
| formRoutes | /api/forms | routes/forms.js |
| checkinRoutes | /api/checkins | routes/checkins.js |
| emailTemplateRoutes | /api/email-templates | routes/emailTemplates.js |
| emailSendRoutes | /api/email-send | routes/emailSend.js |
| reportRoutes | /api/reports | routes/reports.js |
| webhookRoutes | /api/webhook | routes/webhook.js |
| terminalRoutes | /api/terminals | routes/terminals.js |
| importCheckinsRoutes | /api/import-checkins | routes/import-checkins.js |
| checkinReportRoutes | /api/checkins/reports | routes/checkinReports.js |
| terminalCheckinRoutes | /api/terminal | routes/terminalCheckins.js |
| emailSegmentRoutes | /api/email-segments | routes/emailSegments.js |
| emailInboundRoutes | /api/email | routes/emailInbound.js |
| leadRoutes | /api/leads | routes/leads.js |
| reactivationRoutes | /api/reactivation | routes/reactivation.js |
| badgeTemplateRoutes | /api/badge-templates | routes/badgeTemplates.js |
