# Database Query Patterns

## Connection (utils/db.js)

```javascript
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

module.exports = pool;
```

Usage: `const pool = require('../utils/db');`

## Simple Query

```javascript
const result = await pool.query('SELECT * FROM visitors WHERE id = $1', [visitorId]);
const visitor = result.rows[0]; // single row
const visitors = result.rows;    // all rows
```

## Parameterized Insert

```javascript
const result = await pool.query(`
    INSERT INTO visitors (name, email, expo_id, organizer_id, qr_code, badge_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING id
`, [name, email, expoId, organizerId, qrCode, badgeId]);

const newId = result.rows[0].id;
```

## Dynamic WHERE with $idx Pattern

```javascript
let whereClause = 'WHERE organizer_id = $1 AND expo_id = $2';
const params = [organizerId, expoId];
let idx = 3;

if (status) {
    whereClause += ` AND status = $${idx}`;
    params.push(status);
    idx++;
}

if (search) {
    whereClause += ` AND email ILIKE $${idx}`;
    params.push(`%${search}%`);
    idx++;
}

// For LIMIT/OFFSET append at end
const rows = await pool.query(
    `SELECT * FROM my_table ${whereClause} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
);
```

## Transaction Pattern

```javascript
const client = await pool.connect();
try {
    await client.query('BEGIN');

    const result1 = await client.query('INSERT INTO ...', [...]);
    const result2 = await client.query('UPDATE ...', [...]);

    await client.query('COMMIT');
    return result1.rows[0];
} catch (e) {
    await client.query('ROLLBACK');
    throw e;
} finally {
    client.release();
}
```

## FOR UPDATE SKIP LOCKED (email_worker pattern)

```javascript
const client = await pool.connect();
try {
    await client.query('BEGIN');
    const task = await client.query(`
        UPDATE email_queue SET status = 'processing'
        WHERE id = (
            SELECT id FROM email_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING *
    `);
    await client.query('COMMIT');
    return task.rows[0] || null;
} catch (e) {
    await client.query('ROLLBACK');
    throw e;
} finally {
    client.release();
}
```

## COALESCE Update (preserve existing values)

```javascript
await pool.query(`
    UPDATE visitors SET
        name = COALESCE($1, name),
        company = COALESCE($2, company),
        country = COALESCE($3, country),
        job_title = COALESCE($4, job_title),
        updated_at = NOW()
    WHERE id = $5
`, [name || null, company || null, country || null, jobTitle || null, visitorId]);
```

## JSONB Operations

```javascript
// Read specific key
`SELECT custom_fields->>'conference_topic' as conference_topic FROM visitors`

// Filter by JSONB key
`WHERE custom_fields->>'conference_topic' = $1`

// Merge JSONB (preserve + add)
`UPDATE visitors SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $1::jsonb`

// Insert JSONB
`INSERT INTO visitors (..., custom_fields) VALUES (..., $1::jsonb)`
// Pass: JSON.stringify(customFieldsObject)
```

## ON CONFLICT Upsert

```javascript
await pool.query(`
    INSERT INTO visitor_event_status (visitor_id, expo_id, checked_in, last_checkin_time, checkin_count)
    VALUES ($1, $2, true, NOW(), 1)
    ON CONFLICT (visitor_id, expo_id)
    DO UPDATE SET
        checked_in = true,
        checkin_count = visitor_event_status.checkin_count + 1,
        last_checkin_time = NOW()
`, [visitorId, expoId]);
```

## Aggregate with LEFT JOIN

```javascript
const result = await pool.query(`
    SELECT
        custom_fields->>'conference_topic' as topic,
        COUNT(*) as registered_count,
        COUNT(DISTINCT c.visitor_id) as checked_in_count
    FROM visitors v
    LEFT JOIN checkins c ON v.id = c.visitor_id AND c.expo_id = v.expo_id
    WHERE v.expo_id = $1 AND v.organizer_id = $2
        AND v.custom_fields->>'conference_topic' IS NOT NULL
    GROUP BY custom_fields->>'conference_topic'
    ORDER BY registered_count DESC
`, [expoId, organizerId]);
```

## COUNT for Pagination

```javascript
const countResult = await pool.query(
    `SELECT COUNT(*) FROM my_table ${whereClause}`,
    params  // same params array, no limit/offset
);
const total = parseInt(countResult.rows[0].count);
const totalPages = Math.ceil(total / limit);
```
