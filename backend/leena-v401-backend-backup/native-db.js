// native-db.js
require('dotenv').config();
const PG = require('pg-native');

const connectionString = process.env.DATABASE_URL;

async function run() {
  console.log('🔧 Native PostgreSQL bağlantı testi başlıyor...\n');

  const db = new PG();

  try {
    db.connectSync(connectionString);
    console.log('✅ Bağlantı başarılı!');

    const rows = db.querySync('SELECT NOW()');
    console.log('⏰ Sunucu zamanı:', rows[0].now);

    const tables = ['organizers', 'expos', 'visitors', 'email_templates', 'forms', 'checkins'];
    for (const table of tables) {
      try {
        const count = db.querySync(`SELECT COUNT(*) FROM ${table}`);
        console.log(`📊 ${table}: ${count[0].count} kayıt`);
      } catch (e) {
        console.log(`⚠️  ${table}: Tablo bulunamadı veya hata: ${e.message}`);
      }
    }

    db.end();
  } catch (err) {
    console.error('❌ Hata:', err.message);
  }
}

run();
