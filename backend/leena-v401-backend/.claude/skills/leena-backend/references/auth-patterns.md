# Authentication Patterns

## 1. authMiddleware.js (PRIMARY — use for all new admin routes)

```javascript
// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.organizer_id = decoded.organizer_id;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};
```

**Usage in routes:**
```javascript
const authMiddleware = require('../middleware/authMiddleware');

router.get('/endpoint', authMiddleware, async (req, res) => {
    const organizerId = req.organizer_id;  // ← integer, set by middleware
    // Always use req.organizer_id, never req.user.id
});
```

## 2. auth.js (Alternative — used by some older routes)

```javascript
// middleware/auth.js
// Sets req.user = { id, email, organizer_id }
// More flexible payload parsing: decoded.id || decoded.organizer_id || decoded.userId
```

**⚠️ Avoid using this for new routes.** Use authMiddleware.js instead.

## 3. terminalAuth.js (Terminal-only routes)

```javascript
// middleware/terminalAuth.js
// Reads x-terminal-key header
// Validates against terminals table
// Sets req.terminal = full terminal object
```

**Usage:**
```javascript
const terminalAuth = require('../middleware/terminalAuth');

router.post('/checkin', terminalAuth, async (req, res) => {
    const terminal = req.terminal;
    // terminal.id, terminal.expo_id, terminal.hall_name, terminal.terminal_key
    // ⚠️ Terminal endpoints return camelCase (qrCode, lastName)
});
```

## JWT Token Structure

Created in `routes/auth.js` POST /login:

```javascript
const token = jwt.sign(
    { organizer_id: organizer.id, email: organizer.email },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
);
```

## Frontend Auth Flow

```javascript
// Login stores:
localStorage.setItem('token', data.token);
localStorage.setItem('organizer', JSON.stringify(data.organizer));
localStorage.setItem('organizerId', data.organizer.id);

// Every admin page checks:
const token = localStorage.getItem('token');
if (!token) { window.location.href = 'login.html'; return; }

// API calls include:
headers: { 'Authorization': `Bearer ${token}` }

// Logout:
localStorage.clear();
window.location.href = 'login.html';
```

## Public Endpoints (No Auth)

These endpoints have NO middleware:
- `POST /api/visitors/public` — public form submission
- `POST /api/leads/auth` — exhibitor QR login
- `POST /api/leads/scan` — lead scanning
- `GET /api/leads/list` — lead list
- `GET /api/reactivation/verify/:token` — token verification
- `POST /api/reactivation/activate` — activation
- `GET /api/visitors/badge/:qr_code` — badge display
- `GET /api/forms/public/:id` — public form view

## Security Rules

1. ALWAYS use `req.organizer_id` (from authMiddleware), never `req.user?.id`
2. ALWAYS scope queries with `AND organizer_id = $X` for admin endpoints
3. ALWAYS scope queries with `AND expo_id = $X` when expo context is relevant
4. Badge endpoint: use explicit column SELECT, never SELECT * (PII protection)
5. JWT expiry is 30 days — frontend won't detect expired token until API call fails
