// routes/auth.js
const express = require('express');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const router = express.Router();
const pool = require('../utils/db');
const sgMail = require('@sendgrid/mail');

console.log('>>> CHECKPOINT 2 (auth.js): This file is being loaded by the server.');

// Initialize SendGrid
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/**
* POST /api/auth/login
* Authenticate an organizer and return JWT token
*/
router.post('/login', async (req, res) => {
    console.log('>>> CHECKPOINT 3 (auth.js): /login endpoint reached!');
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
    console.log('>>> CHECKPOINT 4 (auth.js): /register endpoint reached!');
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
                    html: `<div>...email content...</div>`,
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

        if (err.code === '23505') {
            return res.status(409).json({ error: 'Email already registered' });
        }

        res.status(500).json({ error: 'Failed to register organizer' });
    }
});

// I am removing the /verify endpoint temporarily to simplify debugging.
// We can add it back later.

module.exports = router;
