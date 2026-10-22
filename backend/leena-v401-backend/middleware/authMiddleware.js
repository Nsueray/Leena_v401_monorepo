// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const pool = require('../utils/db');
require('dotenv').config({ path: '../.env' });

// Paket 2 (KAPI-2): token users oturumuna aitse (user_id taşıyorsa) kullanıcının AKTİF olduğu
// her istekte doğrulanır — pasifleştirilen kullanıcının eldeki token'ı hemen 401 alır
// (leena-fetch 401'de oturumu kapatır). Klasik organizer token'ı (user_id YOK) eskisi gibi:
// DB'ye gidilmez, davranış birebir. req.user_id yalnız users oturumunda konur (ek alan).
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) {
        return res.sendStatus(401); // Unauthorized
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.sendStatus(403); // Forbidden
        }
        req.organizer_id = decoded.organizer_id;
        if (!decoded.user_id) return next();
        pool.query('SELECT is_active FROM users WHERE id = $1 AND organizer_id = $2', [decoded.user_id, decoded.organizer_id])
            .then((r) => {
                if (!r.rows.length || !r.rows[0].is_active) return res.sendStatus(401);
                req.user_id = decoded.user_id;
                next();
            })
            .catch(next);
    });
}

module.exports = authenticateToken;
