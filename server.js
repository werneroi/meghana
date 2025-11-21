require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

// --- Postgres pool ---
// Prefer local DATABASE_URL when available; fall back to Railway in production.
const connectionString =
  process.env.DATABASE_URL || process.env.RAILWAY_DATABASE_URL;
const useRailway = Boolean(
  connectionString && connectionString === process.env.RAILWAY_DATABASE_URL
);

if (!connectionString) {
  throw new Error('DATABASE_URL (local) or RAILWAY_DATABASE_URL (Railway) must be set');
}

const pool = new Pool({
  connectionString,
  ssl: useRailway ? { rejectUnauthorized: false } : false
});

// --- Middlewares ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false // set true + app.set('trust proxy', 1) when behind HTTPS proxy
    }
  })
);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// --- Nodemailer (Gmail) ---
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  connectionTimeout: 15000
});

// --- DB init ---
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS participants (
      id SERIAL PRIMARY KEY,
      code VARCHAR(20) UNIQUE NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      sex VARCHAR(10),
      gender VARCHAR(50),
      gender_other TEXT,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ DB ready');
}

// --- Helpers ---
function generateParticipantCode() {
  // Simple code like P-123456
  const num = Math.floor(100000 + Math.random() * 900000);
  return `P-${num}`;
}

function ensureLoggedIn(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

function ensureAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// --- Routes ---

// Who am I?
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

// Register participant
app.post('/api/register', async (req, res) => {
  try {
    const { email, age, sex, gender, genderOther, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const code = generateParticipantCode();
    const passwordHash = await bcrypt.hash(password, 10);

    const ageInt = age ? parseInt(age, 10) : null;

    const insertQuery = `
      INSERT INTO participants (code, email, age, sex, gender, gender_other, password_hash)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING code, email, created_at;
    `;

    const values = [
      code,
      email,
      isNaN(ageInt) ? null : ageInt,
      sex || null,
      gender || null,
      genderOther || null,
      passwordHash
    ];

    const result = await pool.query(insertQuery, values);
    const participant = result.rows[0];

    // Send email with code + password
    try {
      await transporter.sendMail({
        from: `"Research Study" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: 'Your study login code and password',
        text: `Thank you for joining the study.\n\nYour login code: ${code}\nYour password: ${password}\n\nPlease keep this safe.`,
      });
      console.log('📧 Email sent to', email);
    } catch (err) {
      console.error('❌ Error sending email:', err.message);
      // We DON'T fail the registration if email sending fails
    }

    res.json({
      ok: true,
      code: participant.code,
      email: participant.email,
      createdAt: participant.created_at
    });
  } catch (err) {
    console.error('❌ Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login (admin OR participant)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body; // username = code OR "admin"

    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    // Admin login
    if (
      username === process.env.ADMIN_USER &&
      password === process.env.ADMIN_PASS
    ) {
      req.session.user = {
        role: 'admin',
        username: username
      };
      return res.json({ ok: true, role: 'admin' });
    }

    // Participant login by code
    const query = 'SELECT * FROM participants WHERE code = $1';
    const result = await pool.query(query, [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid code or password' });
    }

    const participant = result.rows[0];
    const isMatch = await bcrypt.compare(password, participant.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid code or password' });
    }

    req.session.user = {
      role: 'participant',
      code: participant.code,
      id: participant.id
    };

    res.json({ ok: true, role: 'participant', code: participant.code });
  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// Admin: list participants
app.get('/api/admin/participants', ensureAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, code, email, age, sex, gender, gender_other, created_at
      FROM participants
      ORDER BY created_at DESC;
    `);
    res.json({ participants: result.rows });
  } catch (err) {
    console.error('❌ Admin participants error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve admin page (basic protection)
app.get('/admin.html', (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/'); // Back to login
  }
  next();
});

// --- Socket.IO test ---
io.on('connection', (socket) => {
  console.log('🟢 Socket connected:', socket.id);

  socket.on('ping', () => {
    console.log('📡 Received ping from', socket.id);
    socket.emit('pong', { time: new Date().toISOString() });
  });

  socket.on('disconnect', () => {
    console.log('🔴 Socket disconnected:', socket.id);
  });
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
// const HOST = process.env.HOST || '0.0.0.0';

initDb()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to init DB:', err);
    process.exit(1);
  });
