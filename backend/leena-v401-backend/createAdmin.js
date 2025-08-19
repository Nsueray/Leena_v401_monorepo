const bcrypt = require('bcrypt');
const pool = require('./utils/db');
require('dotenv').config();

async function createAdmin() {
  const name = 'Elan Expo';
  const email = 'admin@leena.app';
  const logo_url = 'https://example.com/logo.png';
  const plainPassword = 'Eliz2025';

  try {
    const password_hash = await bcrypt.hash(plainPassword, 10);

    const result = await pool.query(
      'INSERT INTO organizers (name, email, logo_url, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, email, logo_url, password_hash]
    );

    console.log('✅ Admin user created:', result.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating admin user:', err);
    process.exit(1);
  }
}

createAdmin();
