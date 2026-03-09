// utils/db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'leena_v401',
  password: process.env.PGPASSWORD || '',
  port: process.env.PGPORT || 5432,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 30000
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err);
});

module.exports = pool;
