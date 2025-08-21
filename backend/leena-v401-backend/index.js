// index.js - Main Server File (FIXED VERSION)
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Global Middleware (ORDER MATTERS!) ---
app.use(cors({
    origin: '*', // In production, specify your frontend URL
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Debug Middleware ---
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- Static Files (if needed) ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Health Check ---
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// --- Import Route Modules ---
let authRoutes, organizerRoutes, expoRoutes, visitorRoutes;
let formRoutes, checkinRoutes, emailTemplateRoutes, emailRoutes, reportRoutes;

try {
    authRoutes = require('./routes/auth');
    console.log('✓ Auth routes loaded');
} catch (err) {
    console.error('✗ Failed to load auth routes:', err.message);
}

try {
    organizerRoutes = require('./routes/organizers');
    console.log('✓ Organizer routes loaded');
} catch (err) {
    console.error('✗ Failed to load organizer routes:', err.message);
}

try {
    expoRoutes = require('./routes/expos');
    console.log('✓ Expo routes loaded');
} catch (err) {
    console.error('✗ Failed to load expo routes:', err.message);
}

try {
    visitorRoutes = require('./routes/visitors');
    console.log('✓ Visitor routes loaded');
} catch (err) {
    console.error('✗ Failed to load visitor routes:', err.message);
}

try {
    formRoutes = require('./routes/forms');
    console.log('✓ Form routes loaded');
} catch (err) {
    console.error('✗ Failed to load form routes:', err.message);
}

try {
    checkinRoutes = require('./routes/checkins');
    console.log('✓ Checkin routes loaded');
} catch (err) {
    console.error('✗ Failed to load checkin routes:', err.message);
}

try {
    emailTemplateRoutes = require('./routes/emailTemplates');
    console.log('✓ Email template routes loaded');
} catch (err) {
    console.error('✗ Failed to load email template routes:', err.message);
}

try {
    emailRoutes = require('./routes/emails');
    console.log('✓ Email routes loaded');
} catch (err) {
    console.error('✗ Failed to load email routes:', err.message);
}

try {
    reportRoutes = require('./routes/reports');
    console.log('✓ Report routes loaded');
} catch (err) {
    console.error('✗ Failed to load report routes:', err.message);
}

// --- Mount Routes (only if successfully loaded) ---
if (authRoutes) app.use('/api/auth', authRoutes);
if (organizerRoutes) app.use('/api/organizers', organizerRoutes);
if (expoRoutes) app.use('/api/expos', expoRoutes);
if (visitorRoutes) app.use('/api/visitors', visitorRoutes);
if (formRoutes) app.use('/api/forms', formRoutes);
if (checkinRoutes) app.use('/api/checkins', checkinRoutes);
if (emailTemplateRoutes) app.use('/api/templates', emailTemplateRoutes);
if (emailRoutes) app.use('/api/emails', emailRoutes);
if (reportRoutes) app.use('/api/reports', reportRoutes);

// --- Root Endpoint ---
app.get('/', (req, res) => {
    res.json({
        message: 'Leena.app v401 API is running',
        version: '4.0.1',
        port: PORT,
        endpoints: {
            auth: '/api/auth',
            organizers: '/api/organizers',
            expos: '/api/expos',
            visitors: '/api/visitors',
            forms: '/api/forms',
            checkins: '/api/checkins',
            templates: '/api/templates',
            emails: '/api/emails',
            reports: '/api/reports'
        }
    });
});

// --- List All Routes (Debug Endpoint) ---
app.get('/api/routes', (req, res) => {
    const routes = [];
    app._router.stack.forEach((middleware) => {
        if (middleware.route) {
            routes.push({
                path: middleware.route.path,
                methods: Object.keys(middleware.route.methods)
            });
        } else if (middleware.name === 'router') {
            middleware.handle.stack.forEach((handler) => {
                if (handler.route) {
                    const path = middleware.regexp.source.match(/\\\/([^\\]+)/);
                    routes.push({
                        path: (path ? '/' + path[1] : '') + handler.route.path,
                        methods: Object.keys(handler.route.methods)
                    });
                }
            });
        }
    });
    res.json(routes);
});

// --- 404 Handler (must be AFTER all routes) ---
app.use((req, res, next) => {
    console.log(`404 - Route not found: ${req.method} ${req.url}`);
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`,
        availableEndpoints: {
            auth: '/api/auth/login, /api/auth/register',
            visitors: '/api/visitors',
            expos: '/api/expos'
        }
    });
});

// --- Error Handler (must be LAST) ---
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// --- Server Startup ---
const server = app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════');
    console.log(`✅ Leena.app v401 backend is running`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📝 View all routes: http://localhost:${PORT}/api/routes`);
    console.log('═══════════════════════════════════════════');
});

// --- Graceful Shutdown ---
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

module.exports = app;
