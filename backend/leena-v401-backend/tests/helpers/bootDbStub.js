// tests/helpers/bootDbStub.js — `node -r` ile yüklenir; index.js'i GERÇEK süreçte, test DB'ye
// bağlı açar. utils/db.js SSL zorunlu tutar, yerel test Postgres'i SSL'siz → diğer suite'lerin
// require.cache deseniyle SSL'siz test pool'u yerine konur. Ürün kodu değişmez.
const path = require('path');
const BE = path.join(__dirname, '..', '..');
const { Pool } = require(path.join(BE, 'node_modules/pg'));
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/ell_comm_test' });
const dbPath = require.resolve(path.join(BE, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
