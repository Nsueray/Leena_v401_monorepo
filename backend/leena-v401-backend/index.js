const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = 3000;

// --- Veritabanı ve Middleware'i Doğrudan Bu Dosyada Tanımlıyoruz ---

const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT,
});

function authenticateToken(req, res, next) {
    console.log('>>> [DEBUG] Authenticate Token Middleware çalıştı.');
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error('>>> [DEBUG] Token doğrulama hatası:', err.message);
            return res.sendStatus(403);
        }
        req.organizer_id = decoded.organizer_id;
        console.log(`>>> [DEBUG] Token doğrulandı. Organizer ID: ${req.organizer_id}`);
        next();
    });
}

// --- Ana Uygulama ---
app.use(cors());
app.use(express.json());

// --- Ziyaretçi Ekleme API'sini Doğrudan Tanımlıyoruz ---
app.post('/api/visitors', authenticateToken, async (req, res) => {
    console.log('>>> [DEBUG] /api/visitors endpointi çalıştı.');
    const { expo_id, custom_fields = {} } = req.body;

    if (!expo_id) {
        return res.status(400).json({ error: 'expo_id is required' });
    }

    try {
        console.log(`>>> [DEBUG] Sahiplik kontrol ediliyor: expo_id=${expo_id}, organizer_id=${req.organizer_id}`);
        const expoCheck = await pool.query(
            'SELECT id FROM expos WHERE id = $1 AND organizer_id = $2',
            [expo_id, req.organizer_id]
        );

        console.log(`>>> [DEBUG] Sahiplik sorgusu sonucu: ${expoCheck.rowCount} satır bulundu.`);
        if (expoCheck.rowCount === 0) {
            return res.status(403).json({ error: 'Access denied to this expo' });
        }

        // Bu testte QR kodu şimdilik önemli değil, sabit bir değer verelim
        const qrCode = 'test-qr-' + Date.now(); 
        const result = await pool.query(
            `INSERT INTO visitors (expo_id, organizer_id, qr_code, custom_fields)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [expo_id, req.organizer_id, qrCode, custom_fields]
        );

        console.log('>>> [DEBUG] Ziyaretçi başarıyla eklendi.');
        res.status(201).json({ message: 'Visitor created successfully (Single File Test)', visitor: result.rows[0] });

    } catch (err) {
        console.error('>>> [DEBUG] Ziyaretçi eklerken HATA:', err);
        res.status(500).json({ error: 'Failed to create visitor' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Leena.app v401 backend (TEK DOSYA TEST MODU) çalışıyor http://localhost:${PORT}`);
});
