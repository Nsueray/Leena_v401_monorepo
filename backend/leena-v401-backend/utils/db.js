// utils/db.js
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' }); // Ensure .env from backend root is loaded

const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'leena_v401',
  password: process.env.PGPASSWORD || '',
  port: process.env.PGPORT || 5432,
});

module.exports = pool;
