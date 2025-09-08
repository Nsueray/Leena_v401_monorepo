const jwt = require('jsonwebtoken');
require('dotenv').config();

const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'No token provided' 
            });
        }

        jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, decoded) => {
            if (err) {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Invalid or expired token' 
                });
            }
            
            req.user = {
                id: decoded.id || decoded.organizer_id || decoded.userId,
                email: decoded.email,
                organizer_id: decoded.organizer_id || decoded.id
            };
            
            next();
        });
    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: 'Authentication error' 
        });
    }
};

module.exports = authMiddleware;
