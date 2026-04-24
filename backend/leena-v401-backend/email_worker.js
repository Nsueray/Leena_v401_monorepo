// email_worker.js
// Leena EMS v403 - Email Queue Worker
// Supports both visitor+template mode and direct html_content mode
// v403: Batch processing support via EMAIL_WORKER_BATCH_SIZE env var

const { Pool } = require('pg');
require('dotenv').config();
const { sendEmail, sendEmailWithReplyTo, processEmailTemplate, formatConferenceTopic } = require('./utils/email');

// --- Database pool (ENV-based SSL handling) ---
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: process.env.PGPORT,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const PROCESS_INTERVAL = 2000;
const MAX_RETRIES = 5;
const BATCH_SIZE = Math.max(1, parseInt(process.env.EMAIL_WORKER_BATCH_SIZE || '1', 10));
let isProcessing = false;

// ============================================================
// FETCH: Lock up to BATCH_SIZE pending rows atomically
// ============================================================

async function fetchNextBatch() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock up to BATCH_SIZE rows atomically
    const lockRes = await client.query(`
      UPDATE email_queue SET status = 'processing'
      WHERE id IN (
        SELECT id FROM email_queue
        WHERE status = 'pending' AND try_count < $1
        ORDER BY created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `, [MAX_RETRIES, BATCH_SIZE]);

    if (lockRes.rows.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    const taskIds = lockRes.rows.map(r => r.id);

    // Fetch full details for all locked rows
    const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(',');
    const res = await client.query(`
      SELECT
        eq.*,
        v.name as visitor_name,
        v.last_name as visitor_last_name,
        v.email as visitor_email,
        v.company as visitor_company,
        v.country as visitor_country,
        v.job_title as visitor_job_title,
        v.badge_id,
        v.qr_code,
        v.badge_url,
        v.custom_fields,
        et.subject as template_subject,
        et.html_content as template_html,
        e.name as expo_name,
        e.organizer_id as expo_organizer_id
      FROM email_queue eq
      LEFT JOIN visitors v ON v.id = eq.visitor_id
      LEFT JOIN email_templates et ON et.id = eq.template_id
      LEFT JOIN expos e ON e.id = eq.expo_id
      WHERE eq.id IN (${placeholders})
    `, taskIds);

    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[EMAIL_WORKER] fetchNextBatch error:', err.message);
    return [];
  } finally {
    client.release();
  }
}

// ============================================================
// STATUS UPDATES (per-email, not batched)
// ============================================================

async function markAsSent(id) {
  await pool.query(`UPDATE email_queue SET status='sent', sent_at=NOW() WHERE id=$1`, [id]);
}

async function markAsFailed(id, message) {
  await pool.query(`
    UPDATE email_queue
    SET status='failed', try_count = try_count + 1, last_try=NOW(), error_message=$2
    WHERE id=$1
  `, [id, message]);
}

// Log send result to email_logs (non-fatal)
async function logToEmailLogs(task, status, recipientEmail, emailSubject) {
  try {
    const organizerId = task.expo_organizer_id || null;
    const email = recipientEmail || task.recipient_email || task.visitor_email || null;
    const message = `Subject: ${emailSubject || 'N/A'} | To: ${email || 'N/A'}`;

    await pool.query(
      `INSERT INTO email_logs (organizer_id, expo_id, visitor_id, template_id, email, status, message, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [organizerId, task.expo_id || null, task.visitor_id || null, task.template_id || null, email, status, message]
    );
  } catch (err) {
    console.warn(`[EMAIL_WORKER] email_logs insert failed (non-fatal): ${err.message}`);
  }
}

// ============================================================
// PROCESS: Single email task (unchanged logic, extracted for batch use)
// ============================================================

async function processTask(task) {
  try {
    let recipientEmail, emailSubject, emailHtml;

    // MODE 1: Direct html_content (for reactivation campaigns, etc.)
    if (task.html_content && task.recipient_email) {
      recipientEmail = task.recipient_email;
      emailSubject = task.subject || 'Notification';
      emailHtml = task.html_content;
    }
    // MODE 2: Visitor + Template (traditional mode)
    else if (task.visitor_id && task.template_id) {
      recipientEmail = task.visitor_email;

      if (!recipientEmail) {
        throw new Error('No visitor email found');
      }

      // Parse custom_fields
      let custom_fields = {};
      try {
        if (task.custom_fields) {
          custom_fields = typeof task.custom_fields === 'string'
            ? JSON.parse(task.custom_fields)
            : task.custom_fields;
        }
      } catch (e) {
        console.warn('⚠️ Error parsing custom_fields:', e.message);
      }

      // Build QR code image tag
      const baseUrl = process.env.BASE_BADGE_URL || 'https://leena.app';
      const qrImageTag = task.qr_code
        ? `<img src="${baseUrl}/api/qr-image/${task.qr_code}" alt="QR Code" style="max-width:200px;">`
        : '';

      // Format conference_topic for multi-topic display
      if (custom_fields.conference_topic) {
        custom_fields.conference_topic = formatConferenceTopic(custom_fields.conference_topic);
      }

      // Template data
      const data = {
        name: task.visitor_name || 'Guest',
        last_name: task.visitor_last_name || '',
        email: task.visitor_email || '',
        company: task.visitor_company || '',
        country: task.visitor_country || '',
        job_title: task.visitor_job_title || '',
        badge_id: task.badge_id || '',
        badge_url: task.badge_url || '',
        expo_name: task.expo_name || '',
        qr_code: qrImageTag,
        date: new Date().toLocaleDateString(),
        ...custom_fields
      };

      emailSubject = processEmailTemplate(task.template_subject || 'Your Badge', data);
      emailHtml = processEmailTemplate(task.template_html || '', data);
    }
    // MODE 3: Fallback - just recipient_email without html_content
    else if (task.recipient_email && task.template_id) {
      recipientEmail = task.recipient_email;

      const data = {
        name: 'Guest',
        email: task.recipient_email,
        expo_name: task.expo_name || '',
        date: new Date().toLocaleDateString()
      };

      emailSubject = processEmailTemplate(task.template_subject || 'Notification', data);
      emailHtml = processEmailTemplate(task.template_html || '', data);
    }
    else {
      throw new Error('Invalid task: missing required fields (need html_content+recipient_email OR visitor_id+template_id)');
    }

    // Send email
    const sent = await sendEmailWithReplyTo(
      recipientEmail,
      emailSubject,
      emailHtml,
      'reply@replies.leena.app'
    );

    if (sent) {
      await markAsSent(task.id);
      await logToEmailLogs(task, 'sent', recipientEmail, emailSubject);
      return { id: task.id, status: 'sent' };
    } else {
      await markAsFailed(task.id, 'sendEmail returned false');
      await logToEmailLogs(task, 'failed', recipientEmail, emailSubject);
      return { id: task.id, status: 'failed' };
    }
  } catch (err) {
    await markAsFailed(task.id, err.message || 'Unknown error');
    await logToEmailLogs(task, 'failed', task.recipient_email || task.visitor_email, err.message);
    return { id: task.id, status: 'failed', error: err.message };
  }
}

// ============================================================
// MAIN LOOP
// ============================================================

async function runWorker() {
  console.log(`🚀 Email worker started (v403). Polling every ${PROCESS_INTERVAL}ms, batch size: ${BATCH_SIZE}`);
  console.log('📧 Supports: visitor+template mode AND direct html_content mode');

  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to database');
  } catch (err) {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
  }

  while (true) {
    if (!isProcessing) {
      isProcessing = true;
      const cycleStart = Date.now();
      try {
        const tasks = await fetchNextBatch();
        if (tasks.length > 0) {
          // Process all tasks in parallel — each has its own error handling
          const results = await Promise.allSettled(tasks.map(t => processTask(t)));

          const sent = results.filter(r => r.status === 'fulfilled' && r.value?.status === 'sent').length;
          const failed = results.filter(r => r.status === 'fulfilled' && r.value?.status === 'failed').length;
          const errors = results.filter(r => r.status === 'rejected').length;
          const elapsed = Date.now() - cycleStart;

          if (tasks.length > 1) {
            console.log(`[CYCLE] Processed ${tasks.length} emails (${sent} sent, ${failed + errors} failed) in ${elapsed}ms`);
          } else {
            // Single email — keep original log style
            const r = results[0];
            if (r.status === 'fulfilled') {
              console.log(`[EMAIL_WORKER] ${r.value?.status === 'sent' ? '✅' : '❌'} Task ${tasks[0].id} ${r.value?.status}`);
            }
          }
        }
      } catch (e) {
        console.error('[EMAIL_WORKER] loop error:', e.message);
      } finally {
        isProcessing = false;
      }
    }
    await new Promise((r) => setTimeout(r, PROCESS_INTERVAL));
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down email worker...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down...');
  await pool.end();
  process.exit(0);
});

runWorker().catch(err => {
  console.error('💥 Fatal error:', err.message);
  process.exit(1);
});
