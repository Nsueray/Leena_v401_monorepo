const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'leena_v401',
    password: process.env.PGPASSWORD || '',
    port: process.env.PGPORT || 5432,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
    console.log('✓ Database connected successfully');
});

pool.on('error', (err) => {
    console.error('✗ Unexpected database error:', err);
    process.exit(-1);
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('✗ Database connection failed:', err);
    } else {
        console.log('✓ Database connection verified at:', res.rows[0].now);
    }
});

module.exports = pool;
