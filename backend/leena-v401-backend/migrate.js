// migrate.js
// Leena EMS v401 PostgreSQL Migration via DATABASE_URL (.env)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Check DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not defined in your .env file');
  process.exit(1);
}

// Read SQL file
const sqlPath = path.join(__dirname, 'initial.sql');
if (!fs.existsSync(sqlPath)) {
  console.error('❌ Migration file not found:', sqlPath);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf-8');

// Setup connection via DATABASE_URL
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  console.log('🔄 Starting migration via DATABASE_URL...');
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL');
    
    console.log('🚀 Running migration...');
    await client.query(sql);
    console.log('✅ Migration completed successfully!');

  } catch (err) {
    console.error('❌ Migration failed:', err.message || err);
  } finally {
    await client.end();
    console.log('🔌 Connection closed.');
  }
})();
