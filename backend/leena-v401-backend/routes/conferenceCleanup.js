const express = require('express');
const router = express.Router();
const pool = require('../utils/db');
const authMiddleware = require('../middleware/authMiddleware');

// ============================================================
// GET /expos — Expo list with conference data flag
// ============================================================

router.get('/expos', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id, e.name, e.start_date, e.end_date,
        EXISTS(
          SELECT 1 FROM visitors v
          WHERE v.expo_id = e.id
            AND v.custom_fields->>'conference_topic' IS NOT NULL
            AND v.custom_fields->>'conference_topic' <> ''
        ) AS has_conference_data
      FROM expos e
      WHERE e.organizer_id = $1
      ORDER BY e.start_date DESC
    `, [req.organizer_id]);

    res.json({ expos: result.rows });
  } catch (err) {
    console.error('[conference-cleanup] GET /expos error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load expos' });
  }
});

// ============================================================
// GET /canonical-topics?expo_id=X — Canonical topic list from active conference form
// ============================================================

router.get('/canonical-topics', authMiddleware, async (req, res) => {
  try {
    const expo_id = parseInt(req.query.expo_id);
    if (!expo_id) return res.status(400).json({ success: false, message: 'expo_id is required' });

    // Verify organizer ownership
    const expoCheck = await pool.query('SELECT id FROM expos WHERE id = $1 AND organizer_id = $2', [expo_id, req.organizer_id]);
    if (expoCheck.rows.length === 0) return res.status(403).json({ success: false, message: 'Expo not found or not yours' });

    // Find active conference form and extract conference_topic options
    const result = await pool.query(`
      SELECT
        f.id AS form_id,
        f.name AS form_name,
        (
          SELECT field->'options'
          FROM jsonb_array_elements(f.fields) AS field
          WHERE field->>'name' = 'conference_topic'
          LIMIT 1
        ) AS topic_options
      FROM forms f
      WHERE f.expo_id = $1
        AND f.visitor_type = 'conference'
        AND f.is_active = true
      LIMIT 1
    `, [expo_id]);

    if (result.rows.length === 0 || !result.rows[0].topic_options) {
      return res.status(404).json({ success: false, message: 'No active conference registration form with topic dropdown for this expo' });
    }

    const row = result.rows[0];
    res.json({
      form_id: row.form_id,
      form_name: row.form_name,
      canonical_topics: row.topic_options
    });
  } catch (err) {
    console.error('[conference-cleanup] GET /canonical-topics error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load canonical topics' });
  }
});

// ============================================================
// GET /topic-variants?expo_id=X — All distinct topic variants with counts
// ============================================================

router.get('/topic-variants', authMiddleware, async (req, res) => {
  try {
    const expo_id = parseInt(req.query.expo_id);
    if (!expo_id) return res.status(400).json({ success: false, message: 'expo_id is required' });

    // Verify organizer ownership
    const expoCheck = await pool.query('SELECT id FROM expos WHERE id = $1 AND organizer_id = $2', [expo_id, req.organizer_id]);
    if (expoCheck.rows.length === 0) return res.status(403).json({ success: false, message: 'Expo not found or not yours' });

    // 1. Canonical topics from active conference form
    const canonicalRes = await pool.query(`
      SELECT jsonb_array_elements_text(field->'options') AS topic
      FROM forms f, jsonb_array_elements(f.fields) AS field
      WHERE f.expo_id = $1
        AND f.visitor_type = 'conference'
        AND f.is_active = true
        AND field->>'name' = 'conference_topic'
    `, [expo_id]);
    const canonicalSet = new Set(canonicalRes.rows.map(r => r.topic));
    const canonical_topics = Array.from(canonicalSet);

    // 2. Visitor variants (unnest multi-topic with " || " separator)
    const variantRes = await pool.query(`
      SELECT
        TRIM(unnest(string_to_array(custom_fields->>'conference_topic', ' || '))) AS topic,
        COUNT(DISTINCT id)::int AS visitor_count
      FROM visitors
      WHERE expo_id = $1
        AND custom_fields->>'conference_topic' IS NOT NULL
        AND custom_fields->>'conference_topic' <> ''
      GROUP BY 1
      ORDER BY visitor_count DESC
    `, [expo_id]);

    // 3. Certificate counts per topic (exact match)
    const certRes = await pool.query(`
      SELECT conference_topic AS topic, COUNT(*)::int AS cert_count
      FROM conference_certificates
      WHERE expo_id = $1
      GROUP BY conference_topic
    `, [expo_id]);
    const certMap = {};
    certRes.rows.forEach(r => { certMap[r.topic] = r.cert_count; });

    // Build variants array
    const variants = variantRes.rows.map(r => ({
      topic: r.topic,
      visitor_count: r.visitor_count,
      cert_count: certMap[r.topic] || 0,
      is_canonical: canonicalSet.has(r.topic)
    }));

    res.json({ canonical_topics, variants });
  } catch (err) {
    console.error('[conference-cleanup] GET /topic-variants error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load topic variants' });
  }
});

// ============================================================
// GET /visitors?expo_id=X&topic=Y — Visitors with a specific topic variant
// ============================================================

router.get('/visitors', authMiddleware, async (req, res) => {
  try {
    const expo_id = parseInt(req.query.expo_id);
    const topic = (req.query.topic || '').trim();
    if (!expo_id) return res.status(400).json({ success: false, message: 'expo_id is required' });
    if (!topic) return res.status(400).json({ success: false, message: 'topic is required' });

    // Verify organizer ownership
    const expoCheck = await pool.query('SELECT id FROM expos WHERE id = $1 AND organizer_id = $2', [expo_id, req.organizer_id]);
    if (expoCheck.rows.length === 0) return res.status(403).json({ success: false, message: 'Expo not found or not yours' });

    // Escape LIKE wildcards in topic string
    const escapedTopic = topic.replace(/[%_\\]/g, '\\$&');

    const result = await pool.query(`
      SELECT
        id, name, email, company,
        custom_fields->>'conference_topic' AS full_topic_field,
        (custom_fields->>'conference_topic' LIKE '%||%') AS is_multi_topic
      FROM visitors
      WHERE expo_id = $1
        AND (
          custom_fields->>'conference_topic' = $2
          OR custom_fields->>'conference_topic' LIKE $3 || ' || %'
          OR custom_fields->>'conference_topic' LIKE '% || ' || $3 || ' || %'
          OR custom_fields->>'conference_topic' LIKE '% || ' || $3
        )
      ORDER BY id
    `, [expo_id, topic, escapedTopic]);

    res.json({
      topic,
      visitor_count: result.rows.length,
      visitors: result.rows
    });
  } catch (err) {
    console.error('[conference-cleanup] GET /visitors error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load visitors' });
  }
});

// ============================================================
// POST /bulk-update — Rename topic variant to canonical (dry_run + execute)
// ============================================================

router.post('/bulk-update', authMiddleware, async (req, res) => {
  try {
    const { expo_id, visitor_ids, old_topic, new_topic, mode } = req.body;

    // --- Validation ---
    if (!expo_id || !Number.isInteger(expo_id)) return res.status(400).json({ success: false, message: 'expo_id is required (integer)' });
    if (!Array.isArray(visitor_ids) || visitor_ids.length === 0) return res.status(400).json({ success: false, message: 'visitor_ids is required (non-empty array)' });
    if (visitor_ids.length > 1000) return res.status(400).json({ success: false, message: 'visitor_ids max 1000 per request' });
    if (!visitor_ids.every(id => Number.isInteger(id))) return res.status(400).json({ success: false, message: 'All visitor_ids must be integers' });
    if (!old_topic || typeof old_topic !== 'string' || !old_topic.trim()) return res.status(400).json({ success: false, message: 'old_topic is required' });
    if (!new_topic || typeof new_topic !== 'string' || !new_topic.trim()) return res.status(400).json({ success: false, message: 'new_topic is required' });
    if (old_topic.trim() === new_topic.trim()) return res.status(400).json({ success: false, message: 'old_topic and new_topic must be different' });
    if (mode !== 'dry_run' && mode !== 'execute') return res.status(400).json({ success: false, message: "mode must be 'dry_run' or 'execute'" });

    const trimOld = old_topic.trim();
    const trimNew = new_topic.trim();

    // --- Organizer ownership ---
    const expoCheck = await pool.query('SELECT id FROM expos WHERE id = $1 AND organizer_id = $2', [expo_id, req.organizer_id]);
    if (expoCheck.rows.length === 0) return res.status(403).json({ success: false, message: 'Expo not found or not yours' });

    // --- Canonical validation: new_topic must be in form dropdown ---
    const canonicalRes = await pool.query(`
      SELECT jsonb_array_elements_text(field->'options') AS topic
      FROM forms f, jsonb_array_elements(f.fields) AS field
      WHERE f.expo_id = $1
        AND f.visitor_type = 'conference'
        AND f.is_active = true
        AND field->>'name' = 'conference_topic'
    `, [expo_id]);
    const canonicalSet = new Set(canonicalRes.rows.map(r => r.topic));
    if (!canonicalSet.has(trimNew)) {
      return res.status(400).json({ success: false, message: 'new_topic is not in the canonical list for this expo' });
    }

    // --- Visitor ownership: all visitor_ids must belong to this expo ---
    const visitorCheck = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM visitors WHERE id = ANY($1::int[]) AND expo_id = $2',
      [visitor_ids, expo_id]
    );
    if (visitorCheck.rows[0].cnt !== visitor_ids.length) {
      return res.status(403).json({ success: false, message: 'Some visitor_ids do not belong to this expo' });
    }

    // --- Conflict detection: visitors who already have a cert for new_topic ---
    const conflictRes = await pool.query(
      'SELECT DISTINCT visitor_id FROM conference_certificates WHERE expo_id = $1 AND visitor_id = ANY($2::int[]) AND conference_topic = $3',
      [expo_id, visitor_ids, trimNew]
    );
    const conflict_visitor_ids = conflictRes.rows.map(r => r.visitor_id);

    // --- Impact measurement ---
    const nonConflictIds = visitor_ids.filter(id => !conflict_visitor_ids.includes(id));

    const certsToUpdateRes = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM conference_certificates WHERE expo_id = $1 AND visitor_id = ANY($2::int[]) AND conference_topic = $3',
      [expo_id, nonConflictIds.length > 0 ? nonConflictIds : [0], trimOld]
    );
    const certificates_to_update = certsToUpdateRes.rows[0].cnt;

    const certsToDeleteRes = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM conference_certificates WHERE expo_id = $1 AND visitor_id = ANY($2::int[]) AND conference_topic = $3',
      [expo_id, conflict_visitor_ids.length > 0 ? conflict_visitor_ids : [0], trimOld]
    );
    const certificates_to_delete = certsToDeleteRes.rows[0].cnt;

    const visitorsAffectedRes = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM visitors WHERE id = ANY($1::int[]) AND expo_id = $2 AND custom_fields->>'conference_topic' IS NOT NULL",
      [visitor_ids, expo_id]
    );
    const visitors_affected = visitorsAffectedRes.rows[0].cnt;

    // --- Dry run response ---
    if (mode === 'dry_run') {
      return res.json({
        mode: 'dry_run',
        will_affect: {
          visitors: visitors_affected,
          certificates_to_update,
          certificates_to_delete
        },
        conflicts: {
          count: conflict_visitor_ids.length,
          visitor_ids: conflict_visitor_ids,
          message: conflict_visitor_ids.length > 0
            ? 'These visitors already have certificates for new_topic. If executed, their old certificates will be deleted.'
            : 'No conflicts detected.'
        }
      });
    }

    // --- Execute ---
    const client = await pool.connect();
    let visitors_updated = 0;
    let certificates_updated = 0;
    let certificates_deleted = 0;

    try {
      await client.query('BEGIN');

      // Step 1: Delete conflict certificates (old_topic certs for visitors who already have new_topic cert)
      if (conflict_visitor_ids.length > 0) {
        const deleteRes = await client.query(
          'DELETE FROM conference_certificates WHERE expo_id = $1 AND visitor_id = ANY($2::int[]) AND conference_topic = $3',
          [expo_id, conflict_visitor_ids, trimOld]
        );
        certificates_deleted = deleteRes.rowCount;
      }

      // Step 2: Update non-conflict certificates (rename old_topic → new_topic)
      const nonConflictIds = visitor_ids.filter(id => !conflict_visitor_ids.includes(id));
      if (nonConflictIds.length > 0) {
        const updateCertRes = await client.query(
          'UPDATE conference_certificates SET conference_topic = $1 WHERE expo_id = $2 AND visitor_id = ANY($3::int[]) AND conference_topic = $4',
          [trimNew, expo_id, nonConflictIds, trimOld]
        );
        certificates_updated = updateCertRes.rowCount;
      }

      // Step 3: Segment-aware visitor custom_fields update
      const CHUNK_SIZE = 100;
      for (let i = 0; i < visitor_ids.length; i += CHUNK_SIZE) {
        const chunk = visitor_ids.slice(i, i + CHUNK_SIZE);

        const visitorsRes = await client.query(
          "SELECT id, custom_fields->>'conference_topic' AS topic_str FROM visitors WHERE id = ANY($1::int[]) AND expo_id = $2 AND custom_fields->>'conference_topic' IS NOT NULL",
          [chunk, expo_id]
        );

        for (const v of visitorsRes.rows) {
          const raw = v.topic_str;
          if (!raw || !raw.trim()) continue;

          let newTopicStr;

          // Edge case: JSON array format (e.g. visitor 48478)
          if (raw.trim().startsWith('[')) {
            try {
              const arr = JSON.parse(raw);
              if (!Array.isArray(arr)) {
                console.warn('[conference-cleanup] visitor', v.id, 'has non-array JSON topic, skipping');
                continue;
              }
              const replaced = arr.map(t => typeof t === 'string' && t.trim() === trimOld ? trimNew : t);
              newTopicStr = replaced.join(' || ');
            } catch (e) {
              console.warn('[conference-cleanup] visitor', v.id, 'has unparseable JSON topic, skipping:', e.message);
              continue;
            }
          } else {
            // Normal " || " separated format
            const segments = raw.split(' || ').map(s => s.trim());
            const replaced = segments.map(s => s === trimOld ? trimNew : s);
            newTopicStr = replaced.join(' || ');
          }

          // Skip if unchanged (perf optimization)
          if (newTopicStr === raw) continue;

          await client.query(
            "UPDATE visitors SET custom_fields = jsonb_set(custom_fields, '{conference_topic}', to_jsonb($1::text)) WHERE id = $2",
            [newTopicStr, v.id]
          );
          visitors_updated++;
        }
      }

      await client.query('COMMIT');
    } catch (execErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw execErr;
    } finally {
      client.release();
    }

    res.json({
      mode: 'execute',
      success: true,
      affected: {
        visitors_updated,
        certificates_updated,
        certificates_deleted
      },
      conflicts_resolved: conflict_visitor_ids.length
    });

  } catch (err) {
    console.error('[conference-cleanup] POST /bulk-update error:', err.message);
    res.status(500).json({ success: false, message: 'Bulk update failed' });
  }
});

module.exports = router;
