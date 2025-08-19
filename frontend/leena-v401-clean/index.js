const express = require('express');
const cors = require('cors');
const pool = require('./utils/db');
const authRouter = require('./routes/auth');
const exposRouter = require('./routes/expos');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api/expos', exposRouter);
app.use('/api/visitors', require('./routes/visitors'));
app.use('/api/checkins', require('./routes/checkins'));
app.use('/api/templates', require('./routes/emailTemplates'));
app.use('/api/import', require('./routes/import'));
app.use('/api/reports', require('./routes/reports'));

app.get('/', (req, res) => {
  res.send('Leena.app v401 API is running');
});

app.get('/api/organizers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM organizers ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching organizers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/organizers', async (req, res) => {
  try {
    const { name, email, logo_url } = req.body;
    const result = await pool.query(
      'INSERT INTO organizers (name, email, logo_url) VALUES ($1, $2, $3) RETURNING *',
      [name, email, logo_url]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

app.use('/api/auth', authRouter);

app.listen(3000, () => {
  console.log('✅ Leena.app v401 backend running on http://localhost:3000');
});
