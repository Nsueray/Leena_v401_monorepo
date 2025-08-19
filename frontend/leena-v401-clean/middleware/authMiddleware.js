// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const pool = require('../utils/db');
require('dotenv').config();

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token missing' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.organizer_id = decoded.organizer_id;

    // RLS için organizer_id değerini doğrudan sorguya yerleştiriyoruz (parametrik değil!)
    await pool.query(`SET LOCAL leena.organizer_id = '${decoded.organizer_id}'`);

    next();
  } catch (err) {
    console.error('Token auth error:', err);
    res.status(403).json({ error: 'Invalid token' });
  }
};

module.exports = authenticateToken;
