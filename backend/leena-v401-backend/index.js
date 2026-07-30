const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Test Database Connection ---
const pool = require('./utils/db');
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Database connection failed:', err);
    } else {
        console.log('✓ Database connected successfully');
        console.log('✓ Database connection verified at:', res.rows[0].now);
    }
});

// --- Global Middleware (ORDER MATTERS!) ---
const allowedOrigins = ['https://leena.app', 'https://www.leena.app'];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS not allowed from this origin: ' + origin));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// --- Debug Middleware ---
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- Static Files ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// --- Health Check ---
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// --- Import Route Modules ---
let authRoutes, organizerRoutes, expoRoutes, visitorRoutes;
let referenceRoutes; // Expo Operations — reference data (countries/sectors dropdowns)
let partnerRoutes, clusterRoutes; // Expo Operations — partners + clusters CRUD
let formRoutes, checkinRoutes, emailTemplateRoutes, emailSendRoutes, reportRoutes, webhookRoutes;
let terminalRoutes;
let importCheckinsRoutes;
let checkinReportRoutes;
let terminalCheckinRoutes; // ✅ v402 Mini
let emailSegmentRoutes; // ✅ v402 Mini - Email Segments
let emailInboundRoutes; // ✅ Inbound Email (NEW)
let reactivationRoutes; // ✅ v402 - Reactivation Campaigns

try { authRoutes = require('./routes/auth'); console.log('✓ Auth routes loaded'); } catch (err) { console.error('✗ Failed to load auth routes:', err.message); }
try { organizerRoutes = require('./routes/organizers'); console.log('✓ Organizer routes loaded'); } catch (err) { console.error('✗ Failed to load organizer routes:', err.message); }
try { expoRoutes = require('./routes/expos'); console.log('✓ Expo routes loaded'); } catch (err) { console.error('✗ Failed to load expo routes:', err.message); }
try { referenceRoutes = require('./routes/reference'); console.log('✓ Reference routes loaded'); } catch (err) { console.error('✗ Failed to load reference routes:', err.message); }
try { partnerRoutes = require('./routes/partners'); console.log('✓ Partner routes loaded'); } catch (err) { console.error('✗ Failed to load partner routes:', err.message); }
try { clusterRoutes = require('./routes/clusters'); console.log('✓ Cluster routes loaded'); } catch (err) { console.error('✗ Failed to load cluster routes:', err.message); }
let contractRoutes;
try { contractRoutes = require('./routes/contracts'); console.log('✓ Contract routes loaded'); } catch (err) { console.error('✗ Failed to load contract routes:', err.message); }
let salesAgentRoutes;
try { salesAgentRoutes = require('./routes/salesAgents'); console.log('✓ Sales agent routes loaded'); } catch (err) { console.error('✗ Failed to load sales agent routes:', err.message); }
let commissionRoutes;
try { commissionRoutes = require('./routes/commissions'); console.log('✓ Commission routes loaded'); } catch (err) { console.error('✗ Failed to load commission routes:', err.message); }
let payoutRoutes;
try { payoutRoutes = require('./routes/payouts'); console.log('✓ Payout routes loaded'); } catch (err) { console.error('✗ Failed to load payout routes:', err.message); }
let officeRoutes;
try { officeRoutes = require('./routes/offices'); console.log('✓ Office routes loaded'); } catch (err) { console.error('✗ Failed to load office routes:', err.message); }
let cashForecastRoutes;
try { cashForecastRoutes = require('./routes/cashForecast'); console.log('✓ Cash forecast routes loaded'); } catch (err) { console.error('✗ Failed to load cash forecast routes:', err.message); }
try { visitorRoutes = require('./routes/visitors'); console.log('✓ Visitor routes loaded'); } catch (err) { console.error('✗ Failed to load visitor routes:', err.message); }
try { formRoutes = require('./routes/forms'); console.log('✓ Form routes loaded'); } catch (err) { console.error('✗ Failed to load form routes:', err.message); }
try { checkinRoutes = require('./routes/checkins'); console.log('✓ Checkin routes loaded'); } catch (err) { console.error('✗ Failed to load checkin routes:', err.message); }
try { emailTemplateRoutes = require('./routes/emailTemplates'); console.log('✓ Email template routes loaded'); } catch (err) { console.error('✗ Failed to load email template routes:', err.message); }
try { emailSendRoutes = require('./routes/emailSend'); console.log('✓ Email send routes loaded'); } catch (err) { console.error('✗ Failed to load email send routes:', err.message); }
try { reportRoutes = require('./routes/reports'); console.log('✓ Report routes loaded'); } catch (err) { console.error('✗ Failed to load report routes:', err.message); }
try { webhookRoutes = require('./routes/webhook'); console.log('✓ Webhook route loaded'); } catch (err) { console.error('✗ Failed to load webhook route:', err.message); }
try { terminalRoutes = require('./routes/terminals'); console.log('✓ Terminal routes loaded'); } catch (err) { console.error('✗ Failed to load terminal routes:', err.message); }
try { importCheckinsRoutes = require('./routes/import-checkins'); console.log('✓ Import Checkins route loaded'); } catch (err) { console.error('✗ Failed to load import-checkins route:', err.message); }
try { checkinReportRoutes = require('./routes/checkinReports'); console.log('✓ Checkin Reports route loaded'); } catch (err) { console.error('✗ Failed to load checkinReports route:', err.message); }
try { terminalCheckinRoutes = require('./routes/terminalCheckins'); console.log('✓ Terminal Checkin routes loaded (v402)'); } catch (err) { console.error('✗ Failed to load terminalCheckins routes:', err.message); }
try { emailSegmentRoutes = require('./routes/emailSegments'); console.log('✓ Email Segment routes loaded (v402)'); } catch (err) { console.error('✗ Failed to load emailSegments routes:', err.message); }
try { emailInboundRoutes = require('./routes/emailInbound'); console.log('✓ Email Inbound routes loaded'); } catch (err) { console.error('✗ Failed to load emailInbound routes:', err.message); }
let leadRoutes;
try { leadRoutes = require('./routes/leads'); console.log('✓ Lead scanner routes loaded'); } catch (err) { console.error('✗ Failed to load lead routes:', err.message); }
try { reactivationRoutes = require('./routes/reactivation'); console.log('✓ Reactivation routes loaded (v402)'); } catch (err) { console.error('✗ Failed to load reactivation routes:', err.message); }
let badgeTemplateRoutes;
try { badgeTemplateRoutes = require('./routes/badgeTemplates'); console.log('✓ Badge Template routes loaded'); } catch (err) { console.error('✗ Failed to load badgeTemplates routes:', err.message); }
let conferenceCertRoutes;
try { conferenceCertRoutes = require('./routes/conferenceCertificates'); console.log('✓ Conference Certificate routes loaded'); } catch (err) { console.error('✗ Failed to load conferenceCertificates routes:', err.message); }
let floorplanRoutes;
try { floorplanRoutes = require('./routes/floorplan'); console.log('✓ Floor Plan routes loaded'); } catch (err) { console.error('✗ Failed to load floorplan routes:', err.message); }
let exhibitorRoutes;
try { exhibitorRoutes = require('./routes/exhibitors'); console.log('✓ Exhibitor routes loaded'); } catch (err) { console.error('✗ Failed to load exhibitor routes:', err.message); }
let campaignRoutes;
try { campaignRoutes = require('./routes/campaigns'); console.log('✓ Campaign routes loaded (v403)'); } catch (err) { console.error('✗ Failed to load campaign routes:', err.message); }
let emailTrackingRoutes;
try { emailTrackingRoutes = require('./routes/emailTracking'); console.log('✓ Email tracking routes loaded (v403)'); } catch (err) { console.error('✗ Failed to load email tracking routes:', err.message); }
let conferenceCleanupRoutes;
try { conferenceCleanupRoutes = require('./routes/conferenceCleanup'); console.log('✓ Conference Cleanup routes loaded'); } catch (err) { console.error('✗ Failed to load conference cleanup routes:', err.message); }

// --- Mount Routes ---
if (authRoutes) app.use('/api/auth', authRoutes);
if (organizerRoutes) app.use('/api/organizers', organizerRoutes);
if (expoRoutes) app.use('/api/expos', expoRoutes);
if (referenceRoutes) app.use('/api/reference', referenceRoutes);
if (partnerRoutes) app.use('/api/partners', partnerRoutes);
if (clusterRoutes) app.use('/api/clusters', clusterRoutes);
if (visitorRoutes) app.use('/api/visitors', visitorRoutes);
if (formRoutes) app.use('/api/forms', formRoutes);
if (checkinRoutes) app.use('/api/checkins', checkinRoutes);
if (emailTemplateRoutes) app.use('/api/email-templates', emailTemplateRoutes);
if (emailSendRoutes) app.use('/api/email-send', emailSendRoutes);
if (reportRoutes) app.use('/api/reports', reportRoutes);
if (webhookRoutes) app.use('/api/webhook', webhookRoutes);
if (terminalRoutes) app.use('/api/terminals', terminalRoutes);
if (importCheckinsRoutes) app.use('/api/import-checkins', importCheckinsRoutes);
if (checkinReportRoutes) app.use('/api/checkins/reports', checkinReportRoutes);
if (terminalCheckinRoutes) app.use('/api/terminal', terminalCheckinRoutes); // ✅ v402 Mini
if (emailSegmentRoutes) app.use('/api/email-segments', emailSegmentRoutes); // ✅ v402 Mini - Email Segments
if (emailInboundRoutes) app.use('/api/email', emailInboundRoutes);
if (leadRoutes) app.use('/api/leads', leadRoutes); // ✅ Inbound Email
if (reactivationRoutes) app.use('/api/reactivation', reactivationRoutes); // ✅ Reactivation Campaigns
if (badgeTemplateRoutes) app.use('/api/badge-templates', badgeTemplateRoutes); // ✅ Badge Templates
if (conferenceCertRoutes) app.use('/api/conference-certificates', conferenceCertRoutes); // ✅ Conference Certificates
if (floorplanRoutes) app.use('/api/floorplan', floorplanRoutes); // ✅ Floor Plan Builder
if (exhibitorRoutes) app.use('/api/exhibitors', exhibitorRoutes); // ✅ Exhibitor Management
if (campaignRoutes) app.use('/api/campaigns', campaignRoutes); // ✅ v403 Email Campaigns
if (emailTrackingRoutes) app.use('/api/email-track', emailTrackingRoutes); // ✅ v403 Email Tracking (public)
if (conferenceCleanupRoutes) app.use('/api/conference-cleanup', conferenceCleanupRoutes); // ✅ Conference Topic Cleanup
if (contractRoutes) app.use('/api/contracts', contractRoutes); // ✅ LEENA-native Convert endpoint
if (salesAgentRoutes) app.use('/api/sales-agents', salesAgentRoutes);
if (commissionRoutes) app.use('/api/commissions', commissionRoutes); // ✅ M2 cut-period commission report
if (payoutRoutes) app.use('/api/agents', payoutRoutes); // ✅ PAYOUT P1 agent payout + statement
if (officeRoutes) app.use('/api/offices', officeRoutes); // ✅ PS1 offices reference (read-only)
if (cashForecastRoutes) app.use('/api/cash-forecast', cashForecastRoutes); // ✅ PS3-B cash forecast (office x due, EUR, derived)

// --- EXTRA ROUTE for /api/templates (for form-builder dropdown) ---
const authMiddleware = require('./middleware/authMiddleware');
app.get('/api/templates', authMiddleware, async (req, res) => {
    try {
        const organizerId = req.organizer_id;
        const query = `
            SELECT id, name, subject
            FROM email_templates
            WHERE organizer_id = $1 AND is_active = true
            ORDER BY created_at DESC
        `;
        const result = await pool.query(query, [organizerId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching /api/templates:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch templates'
        });
    }
});

// ✅ --- QR Code dynamic image endpoint ---
app.get('/api/qr-image/:qrcode', async (req, res) => {
    try {
        const QRCode = require('qrcode');
        const buffer = await QRCode.toBuffer(req.params.qrcode, {
            width: 300,
            margin: 2
        });
        res.setHeader('Content-Type', 'image/png');
        res.send(buffer);
    } catch (error) {
        res.status(500).send('QR Error');
    }
});

// --- Root Endpoint ---
app.get('/', (req, res) => {
    res.json({
        message: 'Leena.app v402 API is running',
        version: '4.0.2',
        port: PORT,
        endpoints: {
            auth: '/api/auth',
            organizers: '/api/organizers',
            expos: '/api/expos',
            visitors: '/api/visitors',
            forms: '/api/forms',
            checkins: '/api/checkins',
            email_templates: '/api/email-templates',
            email_send: '/api/email-send',
            email_segments: '/api/email-segments',
            reports: '/api/reports',
            webhook: '/api/webhook/zoho/:organizerId/:expoId',
            terminals: '/api/terminals',
            terminal_checkins: '/api/terminal',
            import_checkins: '/api/import-checkins',
            checkin_reports: '/api/checkins/reports',
            email_inbound: '/api/email/inbound',
            reactivation: '/api/reactivation',
            badge_templates: '/api/badge-templates'
        }
    });
});

// --- 404 Handler ---
app.use((req, res, next) => {
    console.log(`404 - Route not found: ${req.method} ${req.url}`);
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`
    });
});

// --- Error Handler ---
app.use((err, req, res, next) => {
    console.error('Error:', err);

    const status = err && err.status ? err.status : 500;
    const message = err && err.message ? err.message : 'Internal Server Error';

    res.status(status).json({
        error: message,
        stack:
            process.env.NODE_ENV === 'development' && err && err.stack
                ? err.stack
                : undefined
    });
});

// --- Server Start ---
const server = app.listen(PORT, () => {
    console.log('═══════════════════════════════════════');
    console.log(`✅ Leena.app v402 backend is running`);
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('═══════════════════════════════════════');
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
