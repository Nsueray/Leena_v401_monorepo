// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../utils/db');
const sgMail = require('@sendgrid/mail');

// Load environment variables from the backend root
require('dotenv').config({ path: '../.env' });

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/**
* POST /api/auth/login
* Authenticate an organizer and return JWT token
*/
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const result = await pool.query('SELECT * FROM organizers WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const organizer = result.rows[0];

        const match = await bcrypt.compare(password, organizer.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET not defined in environment variables');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const token = jwt.sign(
            {
                organizer_id: organizer.id,
                email: organizer.email,
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            organizer: {
                id: organizer.id,
                name: organizer.name,
                email: organizer.email
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
* POST /api/auth/register
* Register a new organizer
*/
router.post('/register', async (req, res) => {
    const { name, email, password, logo_url } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
        const existingUser = await pool.query('SELECT id FROM organizers WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            'INSERT INTO organizers (name, email, password_hash, logo_url) VALUES ($1, $2, $3, $4) RETURNING id, name, email, logo_url, created_at',
            [name, email, hashedPassword, logo_url || null]
        );

        const newOrganizer = result.rows[0];

        if (process.env.SENDGRID_API_KEY && process.env.SENDER_EMAIL && process.env.ADMIN_EMAIL) {
            try {
                const notificationEmail = {
                    to: process.env.ADMIN_EMAIL,
                    from: process.env.SENDER_EMAIL,
                    subject: 'New Organizer Registered on Leena EMS',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #333;">New Organizer Registration</h2>
                            <div style="background: #f5f5f5; padding: 20px; border-radius: 5px;">
                                <p><strong>Name:</strong> ${name}</p>
                                <p><strong>Email:</strong> ${email}</p>
                                <p><strong>Logo URL:</strong> ${logo_url || 'Not provided'}</p>
                                <p><strong>Registered at:</strong> ${new Date(newOrganizer.created_at).toLocaleString()}</p>
                            </div>
                            <p style="color: #666; font-size: 12px; margin-top: 20px;">
                                This is an automated notification from Leena EMS v401
                            </p>
                        </div>
                    `,
                };

                await sgMail.send(notificationEmail);
                console.log('Registration notification email sent');
            } catch (emailError) {
                console.error('Failed to send notification email:', emailError);
            }
        }

        res.status(201).json({ 
            message: 'Organizer successfully registered',
            organizer: {
                id: newOrganizer.id,
                name: newOrganizer.name,
                email: newOrganizer.email,
                logo_url: newOrganizer.logo_url
            }
        });
    } catch (err) {
        console.error('Registration error:', err);

        if (err.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Email already registered' });
        }

        res.status(500).json({ error: 'Failed to register organizer' });
    }
});

/**
* POST /api/auth/verify
* Verify JWT token validity
*/
router.post('/verify', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET not defined in environment variables');
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const result = await pool.query(
            'SELECT id, name, email FROM organizers WHERE id = $1',
            [decoded.organizer_id]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        res.json({
            valid: true,
            organizer: result.rows[0]
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }

        console.error('Token verification error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
