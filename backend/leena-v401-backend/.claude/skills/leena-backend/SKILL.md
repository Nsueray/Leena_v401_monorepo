---
name: leena-backend
description: >
  USE THIS SKILL whenever creating or modifying a backend route, endpoint, middleware,
  or database query in Leena EMS. Covers route file structure, auth middleware usage,
  DB query patterns, pagination, email sending, and error handling conventions.
  TRIGGER: any task involving routes/, middleware/, utils/, email_worker.js, or index.js.
---

> **Last verified:** v402 (March 2026)
> Update this skill whenever routes, schema, or frontend patterns change.

# Leena Backend Patterns

## Route File Structure

Every route file follows this exact skeleton:

```javascript
const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');
// Optional imports:
// const { processEmailTemplate, sendEmail, sendEmailWithReplyTo } = require('../utils/email');
// const { generateQRCode } = require('../utils/qrcode');
// const { v4: uuidv4 } = require('uuid');

// Routes here...

module.exports = router;
```

### Mounting in index.js

New routes MUST be mounted in `index.js` using the try/catch pattern:

```javascript
try {
    const myRoutes = require('./routes/myFile');
    app.use('/api/my-path', myRoutes);
} catch (e) {
    console.error('Failed to load myRoutes:', e.message);
}
```

Mount order matters — add new routes AFTER existing ones, BEFORE inline routes (line ~107).

---

## Authentication Middleware

### authMiddleware.js (PRIMARY — use this one)

```javascript
const authMiddleware = require('../middleware/authMiddleware');
router.get('/endpoint', authMiddleware, async (req, res) => {
    const organizerId = req.organizer_id;  // ← set by middleware
    // ...
});
```

- Reads `Authorization: Bearer <token>` header
- Decodes JWT → sets `req.organizer_id` (integer)
- Returns 401 JSON on failure
- **Use this for ALL new admin routes**

### terminalAuth.js (terminal-only routes)

```javascript
const terminalAuth = require('../middleware/terminalAuth');
router.post('/checkin', terminalAuth, async (req, res) => {
    const terminal = req.terminal;  // ← full terminal object
    // terminal.id, terminal.expo_id, terminal.hall_name, terminal.terminal_key
});
```

- Reads `x-terminal-key` header
- Returns camelCase responses (qrCode, lastName, etc.)

### Public endpoints (no auth)

No middleware needed. Examples: `/api/visitors/public`, `/api/leads/auth`, badge endpoints.

---

## Database Query Patterns

### Connection

```javascript
const pool = require('../utils/db');
// Single query:
const result = await pool.query('SELECT ...', [param1, param2]);
// Transaction:
const client = await pool.connect();
try {
    await client.query('BEGIN');
    // ... queries ...
    await client.query('COMMIT');
} catch (e) {
    await client.query('ROLLBACK');
    throw e;
} finally {
    client.release();
}
```

### Pagination Pattern (CRITICAL — copy this exactly)

```javascript
router.get('/list', authMiddleware, async (req, res) => {
    const organizerId = req.organizer_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const expoId = req.query.expo_id;

    if (!expoId) {
        return res.status(400).json({ success: false, message: 'expo_id required' });
    }

    // Dynamic filter building
    let whereClause = 'WHERE t.organizer_id = $1 AND t.expo_id = $2';
    const params = [organizerId, expoId];
    let idx = 3;

    if (req.query.status) {
        whereClause += ` AND t.status = $${idx}`;
        params.push(req.query.status);
        idx++;
    }

    if (req.query.search) {
        whereClause += ` AND t.name ILIKE $${idx}`;
        params.push(`%${req.query.search}%`);
        idx++;
    }

    // Count
    const countResult = await pool.query(
        `SELECT COUNT(*) FROM my_table t ${whereClause}`, params
    );
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    // Fetch
    const result = await pool.query(
        `SELECT t.id, t.name, ...
         FROM my_table t
         LEFT JOIN other_table o ON t.other_id = o.id
         ${whereClause}
         ORDER BY t.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
    );

    res.json({
        success: true,
        data: result.rows,
        total,
        page,
        totalPages
    });
});
```

Key rules:
- `$${idx}` for dynamic parameter indexing
- `[...params, limit, offset]` spread at end
- Always `Math.max(1, ...)` for page, `Math.min(50, ...)` for limit
- Always include COUNT query + totalPages

### Upsert Pattern (email + expo_id unique)

```javascript
const existing = await pool.query(
    `SELECT id, qr_code, badge_url FROM visitors
     WHERE LOWER(email) = LOWER($1) AND expo_id = $2`,
    [email, expo_id]
);

if (existing.rows.length > 0) {
    // UPDATE — preserve QR code, COALESCE for optional fields
    await pool.query(`
        UPDATE visitors SET
            name = COALESCE($1, name),
            company = COALESCE($2, company),
            updated_at = NOW()
        WHERE id = $3
    `, [name, company, existing.rows[0].id]);
} else {
    // INSERT — new UUID for qr_code
    const qr_code = uuidv4();
    const badge_id = qr_code.substring(0, 8);
    await pool.query(`
        INSERT INTO visitors (name, email, qr_code, badge_id, expo_id, organizer_id, ...)
        VALUES ($1, $2, $3, $4, $5, $6, ...)
    `, [name, email, qr_code, badge_id, expo_id, organizerId, ...]);
}
```

**CRITICAL**: Never overwrite existing qr_code on update. Always use COALESCE for optional fields.

---

## Response Format

### Standard success:
```javascript
res.json({ success: true, message: 'Done', data: result.rows });
```

### Standard error:
```javascript
res.status(400).json({ success: false, message: 'Specific error description' });
```

### Paginated response:
```javascript
res.json({ success: true, data: rows, total, page, totalPages });
// Some endpoints use specific keys: logs, visitors, templates instead of data
```

### Error handling wrapper:
```javascript
router.get('/endpoint', authMiddleware, async (req, res) => {
    try {
        // ... logic ...
    } catch (err) {
        console.error('Error doing X:', err);
        res.status(500).json({ success: false, message: 'Failed to do X' });
    }
});
```

---

## Email Sending

### Via email_queue (CORRECT way):

```javascript
await pool.query(`
    INSERT INTO email_queue (visitor_id, template_id, status, created_at)
    VALUES ($1, $2, 'pending', NOW())
`, [visitorId, templateId]);
```

### Direct HTML mode (for custom content):

```javascript
await pool.query(`
    INSERT INTO email_queue (recipient_email, subject, html_content, status, created_at)
    VALUES ($1, $2, $3, 'pending', NOW())
`, [email, subject, htmlContent]);
```

### Template processing:

```javascript
const { processEmailTemplate } = require('../utils/email');

const emailData = {
    name: visitor.name || 'Guest',
    email: visitor.email,
    company: visitor.company || '',
    expo_name: expo.name,
    date: new Date().toLocaleDateString(),
    qr_code: qrCode ? `<img src="${baseUrl}/api/qr-image/${qrCode}" ...>` : '',
    badge_url: badgeUrl || '',
    ...customFields  // spread custom_fields for {{any_field}} placeholders
};

const html = processEmailTemplate(template.html_content, emailData);
const subject = processEmailTemplate(template.subject, emailData);
```

### QR code in emails — ALWAYS as img tag:
```javascript
const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
const qrHtml = `<img src="${baseUrl}/api/qr-image/${qrCode}" alt="QR Code" style="max-width: 200px;">`;
```

---

## Clone Endpoint Pattern

```javascript
router.post('/clone/:id', authMiddleware, async (req, res) => {
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
    const result = await pool.query(`
        INSERT INTO my_table (name, expo_id, organizer_id, is_active, ...)
        VALUES ($1, $2, $3, false, ...)
        RETURNING *
    `, [`${item.name} (Clone)`, target_expo_id, organizerId, ...]);

    res.json({ success: true, item: result.rows[0] });
});
```

Key: Clone always sets `is_active: false`. Terminal clone generates new `terminal_key` (uuidv4).

---

## Naming Conventions

- Route files: camelCase (`emailSend.js`, `badgeTemplates.js`)
- DB columns: snake_case (`organizer_id`, `visitor_type`, `created_at`)
- API paths: kebab-case (`/api/email-send/history`, `/api/badge-templates`)
- Response keys: snake_case for paginated endpoints, camelCase for terminal endpoints
- JS variables: camelCase (`organizerId`, `expoId`, `whereClause`)

See also: `references/` folder for detailed patterns.
