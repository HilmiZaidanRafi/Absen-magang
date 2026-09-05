const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('../db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret-key-absensi',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Routing file statis jika ada (frontend)
app.use(express.static(path.join(__dirname, '../public')));

// Contoh Endpoint Tes
app.get('/api/users', async (req, res) => {
  try {
    const result = await db.execute('SELECT id, username, nama, role FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Jalankan server lokal jika tidak melalui Vercel serverless
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;