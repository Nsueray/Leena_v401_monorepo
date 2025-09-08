require('dotenv').config();
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;

const client = new Client({
  connectionString,
  ssl: {
    require: true,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2'  // yeni ekledik
  },
  connectionTimeoutMillis: 10000
});

(async () => {
  try {
    await client.connect();
    console.log('✅ Bağlantı başarılı!\n');

    const res = await client.query('SELECT NOW()');
    console.log('⏰ Sunucu zamanı:', res.rows[0].now);

    const tables = ['organizers', 'expos', 'visitors', 'email_templates', 'forms', 'checkins'];
    for (const table of tables) {
      try {
        const count = await client.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`📊 ${table}: ${count.rows[0].count} kayıt`);
      } catch (e) {
        console.log(`⚠️  ${table}: Tabloya erişilemedi (${e.message})`);
      }
    }

    await client.end();
  } catch (err) {
    console.error('❌ Hata:', err.message);
  }
})();
