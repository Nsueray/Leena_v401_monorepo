// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '../.env' });

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
        next();
    });
}

module.exports = authenticateToken;
