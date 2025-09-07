// email_worker.js
const { Pool } = require('pg');
require('dotenv').config();
const { sendEmail, processEmailTemplate } = require('./utils/email');

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
let isProcessing = false;

async function fetchNextTask() {
  try {
    const query = `
      SELECT 
        eq.*,
        v.name as visitor_name,
        v.email as visitor_email,
        v.company as visitor_company,
        v.badge_id,
        v.qr_code,
        v.badge_url,
        v.custom_fields,
        et.subject as template_subject,
        et.html_content as template_body,
        e.name as expo_name
      FROM email_queue eq
      LEFT JOIN visitors v ON v.id = eq.visitor_id
      LEFT JOIN email_templates et ON et.id = eq.template_id
      LEFT JOIN expos e ON e.id = eq.expo_id
      WHERE eq.status = 'pending' AND eq.try_count < $1
      ORDER BY eq.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const res = await pool.query(query, [MAX_RETRIES]);
    return res.rows[0] || null;
  } catch (err) {
    console.error('[EMAIL_WORKER] fetchNextTask error:', err.message);
    return null;
  }
}

async function markAsSent(id) {
  await pool.query(`UPDATE email_queue SET status='sent', sent_at=NOW() WHERE id=$1`, [id]);
  console.log(`[EMAIL_WORKER] ✅ Email sent (task ${id})`);
}

async function markAsFailed(id, message) {
  await pool.query(`
    UPDATE email_queue SET status='failed', try_count = try_count + 1, last_try=NOW(), error_message=$2
    WHERE id=$1
  `, [id, message]);
  console.error(`[EMAIL_WORKER] ❌ Failed task ${id}: ${message}`);
}

async function processTask(task) {
  try {
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

    const data = {
      name: task.visitor_name || 'Guest',
      email: task.visitor_email || task.email,
      company: task.visitor_company || '',
      badge_id: task.badge_id || '',
      badge_url: task.badge_url || '',
      expo_name: task.expo_name || '',
      qr_code: `<img src="${process.env.BASE_BADGE_URL}/api/qr-image/${task.qr_code}" alt="QR Code" style="max-width:200px;">`,
      ...custom_fields
    };

    const subject = processEmailTemplate(task.template_subject || 'Your Badge', data);
    const html = processEmailTemplate(task.template_body || '', data);

    const sent = await sendEmail(task.email, subject, html);
    if (sent) {
      await markAsSent(task.id);
    } else {
      await markAsFailed(task.id, 'sendEmail returned false');
    }
  } catch (err) {
    await markAsFailed(task.id, err.message || 'Unknown error');
  }
}

async function runWorker() {
  console.log('🚀 Email worker started. Polling every', PROCESS_INTERVAL, 'ms');

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
      try {
        const task = await fetchNextTask();
        if (task) {
          await processTask(task);
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

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down...');
  await pool.end();
  process.exit(0);
});

runWorker().catch(err => {
  console.error('💥 Fatal:', err.message);
  process.exit(1);
});
