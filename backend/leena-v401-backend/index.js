// index.js - Main Server File
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import all routers
const authRoutes = require('./routes/auth');
const organizerRoutes = require('./routes/organizers');
const expoRoutes = require('./routes/expos');
const visitorRoutes = require('./routes/visitors');
const formRoutes = require('./routes/forms');
const checkinRoutes = require('./routes/checkins');
const emailTemplateRoutes = require('./routes/emailTemplates');
const emailRoutes = require('./routes/emails');
const reportRoutes = require('./routes/reports'); // <-- YENİ EKLENDİ

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/organizers', organizerRoutes);
app.use('/api/expos', expoRoutes);
app.use('/api/visitors', visitorRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/checkins', checkinRoutes);
app.use('/api/templates', emailTemplateRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/reports', reportRoutes); // <-- YENİ EKLENDİ

// Root endpoint
app.get('/', (req, res) => {
    res.send(`Leena.app v401 API is running on port ${PORT}`);
});

// --- Server Startup ---
app.listen(PORT, () => {
    console.log(`✅ Leena.app v401 backend running on http://localhost:${PORT}`);
});
