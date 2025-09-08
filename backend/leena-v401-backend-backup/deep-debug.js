// deep-debug.js - Detaylı bağlantı analizi
require('dotenv').config();
const { Client } = require('pg');
const net = require('net');
const tls = require('tls');
const dns = require('dns').promises;

// Renkli console için
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
};

function log(message, type = 'info') {
  const color = {
    error: colors.red,
    success: colors.green,
    warning: colors.yellow,
    info: colors.blue
  }[type] || colors.reset;
  
  console.log(`${color}${message}${colors.reset}`);
}

// 1. DNS Çözümleme Testi
async function testDNS() {
  log('\n🔍 DNS Çözümleme Testi', 'info');
  const host = process.env.PGHOST || 'dpg-d2smv175r7bs73al6scg.oregon-postgres.render.com';
  
  try {
    const addresses = await dns.resolve4(host);
    log(`✅ DNS çözümlendi: ${host} → ${addresses.join(', ')}`, 'success');
    return addresses[0];
  } catch (error) {
    log(`❌ DNS çözümleme hatası: ${error.message}`, 'error');
    return null;
  }
}

// 2. Port Erişim Testi
function testPort(host, port) {
  return new Promise((resolve) => {
    log(`\n🔌 Port ${port} Erişim Testi`, 'info');
    
    const socket = new net.Socket();
    let connected = false;
    
    socket.setTimeout(5000);
    
    socket.on('connect', () => {
      connected = true;
      log(`✅ Port ${port} açık ve erişilebilir`, 'success');
      socket.destroy();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      log(`⏱️ Port ${port} zaman aşımı (5 saniye)`, 'warning');
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', (error) => {
      if (!connected) {
        log(`❌ Port hatası: ${error.message}`, 'error');
        resolve(false);
      }
    });
    
    socket.connect(port, host);
  });
}

// 3. SSL/TLS Handshake Testi
function testSSL(host, port) {
  return new Promise((resolve) => {
    log(`\n🔐 SSL/TLS Handshake Testi`, 'info');
    
    const options = {
      host: host,
      port: port,
      rejectUnauthorized: false,
      timeout: 10000
    };
    
    const socket = tls.connect(options, () => {
      log(`✅ SSL bağlantısı kuruldu`, 'success');
      log(`   Protokol: ${socket.getProtocol()}`, 'info');
      log(`   Cipher: ${socket.getCipher()?.name}`, 'info');
      
      const cert = socket.getPeerCertificate();
      if (cert) {
        log(`   Sertifika CN: ${cert.subject?.CN || 'N/A'}`, 'info');
        log(`   Sertifika Geçerlilik: ${cert.valid_from} - ${cert.valid_to}`, 'info');
      }
      
      socket.end();
      resolve(true);
    });
    
    socket.on('error', (error) => {
      log(`❌ SSL hatası: ${error.message}`, 'error');
      resolve(false);
    });
    
    socket.on('timeout', () => {
      log(`⏱️ SSL zaman aşımı`, 'warning');
      socket.destroy();
      resolve(false);
    });
  });
}

// 4. PostgreSQL Protokol Testi (StartupMessage)
function testPostgresProtocol(host, port) {
  return new Promise((resolve) => {
    log(`\n🐘 PostgreSQL Protokol Testi`, 'info');
    
    const socket = new net.Socket();
    let dataReceived = false;
    
    socket.setTimeout(5000);
    
    socket.on('connect', () => {
      // PostgreSQL SSL Request paketi gönder
      const sslRequestPacket = Buffer.from([
        0x00, 0x00, 0x00, 0x08,  // Paket uzunluğu (8 byte)
        0x04, 0xd2, 0x16, 0x2f   // SSL request kodu (1234.5679)
      ]);
      
      socket.write(sslRequestPacket);
      log(`📤 SSL request gönderildi`, 'info');
    });
    
    socket.on('data', (data) => {
      dataReceived = true;
      const response = data.toString('utf8', 0, 1);
      
      if (response === 'S') {
        log(`✅ Sunucu SSL destekliyor`, 'success');
      } else if (response === 'N') {
        log(`⚠️ Sunucu SSL desteklemiyor`, 'warning');
      } else {
        log(`❓ Beklenmeyen yanıt: ${data.toString('hex')}`, 'warning');
      }
      
      socket.destroy();
      resolve(response === 'S');
    });
    
    socket.on('timeout', () => {
      if (!dataReceived) {
        log(`⏱️ PostgreSQL protokol zaman aşımı`, 'warning');
      }
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', (error) => {
      log(`❌ Protokol hatası: ${error.message}`, 'error');
      resolve(false);
    });
    
    socket.connect(port, host);
  });
}

// 5. Farklı pg Client Konfigürasyonları
async function testPgConfigurations() {
  log(`\n🔧 PostgreSQL Client Konfigürasyon Testleri`, 'info');
  
  const host = process.env.PGHOST || 'dpg-d2smv175r7bs73al6scg.oregon-postgres.render.com';
  const configs = [
    {
      name: 'Basit SSL',
      config: {
        host,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        port: parseInt(process.env.PGPORT || '5432'),
        ssl: true
      }
    },
    {
      name: 'SSL rejectUnauthorized: false',
      config: {
        host,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        port: parseInt(process.env.PGPORT || '5432'),
        ssl: { rejectUnauthorized: false }
      }
    },
    {
      name: 'SSL require mode',
      config: {
        host,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        port: parseInt(process.env.PGPORT || '5432'),
        ssl: {
          rejectUnauthorized: false,
          require: true,
          mode: 'require'
        }
      }
    },
    {
      name: 'Connection String',
      config: {
        connectionString: `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${host}:${process.env.PGPORT}/${process.env.PGDATABASE}?sslmode=require`,
        ssl: { rejectUnauthorized: false }
      }
    },
    {
      name: 'TLS v1.2 Zorlama',
      config: {
        host,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        port: parseInt(process.env.PGPORT || '5432'),
        ssl: {
          rejectUnauthorized: false,
          minVersion: 'TLSv1.2',
          maxVersion: 'TLSv1.2'
        }
      }
    }
  ];
  
  for (const { name, config } of configs) {
    log(`\n📝 Test: ${name}`, 'info');
    
    const client = new Client(config);
    
    try {
      // Timeout ekle
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout (10s)')), 10000)
      );
      
      await Promise.race([
        client.connect(),
        timeoutPromise
      ]);
      
      const res = await client.query('SELECT NOW()');
      log(`✅ Başarılı! Sunucu zamanı: ${res.rows[0].now}`, 'success');
      await client.end();
      return true;
    } catch (error) {
      log(`❌ Başarısız: ${error.message}`, 'error');
      try { await client.end(); } catch {}
    }
  }
  
  return false;
}

// 6. Alternatif Port Testi
async function testAlternativePorts() {
  log(`\n🔀 Alternatif Port Testi`, 'info');
  
  const host = process.env.PGHOST || 'dpg-d2smv175r7bs73al6scg.oregon-postgres.render.com';
  const ports = [5432, 5433, 30000]; // Render bazen farklı portlar kullanabilir
  
  for (const port of ports) {
    const isOpen = await testPort(host, port);
    if (isOpen) {
      log(`✅ Port ${port} üzerinden bağlantı kurulabilir`, 'success');
    }
  }
}

// Ana test fonksiyonu
async function runDeepDebug() {
  console.clear();
  log('🚀 DERİNLEMESİNE BAĞLANTI ANALİZİ', 'info');
  log('=' .repeat(50), 'info');
  
  // Ortam bilgileri
  log('\n📊 Ortam Bilgileri:', 'info');
  log(`   Node Version: ${process.version}`, 'info');
  log(`   pg Version: ${require('pg/package.json').version}`, 'info');
  log(`   Platform: ${process.platform}`, 'info');
  log(`   Host: ${process.env.PGHOST}`, 'info');
  log(`   Port: ${process.env.PGPORT}`, 'info');
  log(`   Database: ${process.env.PGDATABASE}`, 'info');
  log(`   User: ${process.env.PGUSER}`, 'info');
  
  // Test 1: DNS
  const ip = await testDNS();
  if (!ip) {
    log('\n❌ DNS çözümlenemedi. İnternet bağlantınızı kontrol edin.', 'error');
    return;
  }
  
  // Test 2: Port erişimi
  const portOpen = await testPort(ip, process.env.PGPORT || 5432);
  if (!portOpen) {
    log('\n❌ Port erişilemiyor. Firewall veya network problemi olabilir.', 'error');
    
    // Alternatif portları dene
    await testAlternativePorts();
    return;
  }
  
  // Test 3: SSL
  const sslWorks = await testSSL(ip, process.env.PGPORT || 5432);
  
  // Test 4: PostgreSQL protokol
  const pgProtocol = await testPostgresProtocol(ip, process.env.PGPORT || 5432);
  
  // Test 5: pg client konfigürasyonları
  const clientWorks = await testPgConfigurations();
  
  // Sonuç
  log('\n' + '=' .repeat(50), 'info');
  log('📋 ÖZET', 'info');
  
  if (clientWorks) {
    log('✅ Bağlantı başarılı!', 'success');
  } else {
    log('\n🔧 ÖNERİLER:', 'warning');
    
    if (!sslWorks) {
      log('1. SSL handshake başarısız. Node.js SSL ayarlarını kontrol edin:', 'warning');
      log('   export NODE_TLS_REJECT_UNAUTHORIZED=0', 'info');
      log('   export NODE_OPTIONS="--tls-min-v1.0"', 'info');
    }
    
    if (!pgProtocol) {
      log('2. PostgreSQL protokolü yanıt vermiyor. Render Dashboard\'dan:', 'warning');
      log('   - Database durumunu kontrol edin (Available olmalı)', 'info');
      log('   - External connections aktif mi kontrol edin', 'info');
    }
    
    log('\n3. pg modülünü güncelleyin:', 'warning');
    log('   npm uninstall pg', 'info');
    log('   npm install pg@latest', 'info');
    
    log('\n4. Render Support ile iletişime geçin ve şu bilgileri paylaşın:', 'warning');
    log('   - Database ID: dpg-d2smv175r7bs73al6scg', 'info');
    log('   - Connection terminated unexpectedly hatası', 'info');
    log('   - External connection kullanıyorsunuz', 'info');
  }
}

// Çalıştır
runDeepDebug().catch(console.error);
