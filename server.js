require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
// const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
const { Resend } = require('resend');

let emailService = null;

if (process.env.RESEND_API_KEY) {
  emailService = new Resend(process.env.RESEND_API_KEY);
  console.log('✅ Resend email service configured');
} else {
  console.log('⚠️ Email not configured (RESEND_API_KEY missing)');
}

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

// --- Postgres pool ---
// Prefer local DATABASE_URL when available; fall back to Railway in production.
// const connectionString =
//   process.env.DATABASE_URL || process.env.RAILWAY_DATABASE_URL;
// const useRailway = Boolean(
//   connectionString && connectionString === process.env.RAILWAY_DATABASE_URL
// );

// if (!connectionString) {
//   throw new Error('DATABASE_URL (local) or RAILWAY_DATABASE_URL (Railway) must be set');
// }

// const pool = new Pool({
//   connectionString,
//   ssl: useRailway ? { rejectUnauthorized: false } : false
// });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Middlewares ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// app.use(
//   session({
//     secret: process.env.SESSION_SECRET || 'dev-secret',
//     store: new PgSession({
//       pool,
//       tableName: 'session',
//       createTableIfMissing: true
//     }),
//     resave: false,
//     saveUninitialized: false,
//     cookie: {
//       secure: false // set true + app.set('trust proxy', 1) when behind HTTPS proxy
//     }
//   })
// );
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
      secure: process.env.NODE_ENV === 'production', // true in production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// --- Nodemailer (Gmail) ---
// let transporter;
// try {
//   if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
//     transporter = nodemailer.createTransport({
//       service: 'gmail', // This automatically sets host and port
//       auth: {
//         user: process.env.GMAIL_USER,
//         pass: process.env.GMAIL_PASS
//       }
//     });
    
//     // Verify connection configuration
//     transporter.verify(function (error, success) {
//       if (error) {
//         console.error('❌ Email configuration error:', error);
//       } else {
//         console.log('✅ Email server is ready to send messages');
//       }
//     });
//   } else {
//     console.log('⚠️ Email not configured (GMAIL_USER or GMAIL_PASS missing)');
//   }
// } catch (err) {
//   console.error('⚠️ Failed to configure email:', err.message);
// }
// try {
//   if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
//     transporter = nodemailer.createTransport({
//       host: 'smtp.gmail.com',
//       port: 465, // Use 465 instead of 587
//       secure: true, // true for 465, false for other ports
//       auth: {
//         user: process.env.GMAIL_USER,
//         pass: process.env.GMAIL_PASS
//       },
//       tls: {
//         rejectUnauthorized: true
//       }
//     });
    
//     // Verify connection configuration
//     transporter.verify(function (error, success) {
//       if (error) {
//         console.error('❌ Email configuration error:', error.message);
//       } else {
//         console.log('✅ Email server is ready to send messages');
//       }
//     });
//   } else {
//     console.log('⚠️ Email not configured (GMAIL_USER or GMAIL_PASS missing)');
//   }
// } catch (err) {
//   console.error('⚠️ Failed to configure email:', err.message);
// }


async function initDb() {
  try {
    console.log('📊 Starting database initialization...');
    
    // Test connection first
    const testResult = await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful:', testResult.rows[0].now);
    
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
    console.log('✅ Participants table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS forms (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        release_at TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Forms table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS form_questions (
        id SERIAL PRIMARY KEY,
        form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        required BOOLEAN DEFAULT FALSE,
        options JSONB DEFAULT '[]'::jsonb,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Form questions table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS form_responses (
        id SERIAL PRIMARY KEY,
        form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
        participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
        participant_code TEXT,
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(form_id, participant_id)
      );
    `);
    console.log('✅ Form responses table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS form_answers (
        id SERIAL PRIMARY KEY,
        response_id INTEGER REFERENCES form_responses(id) ON DELETE CASCADE,
        question_id INTEGER REFERENCES form_questions(id) ON DELETE CASCADE,
        participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE,
        participant_code TEXT,
        answer_text TEXT,
        answer_json JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Form answers table ready');

    // Backfill columns if the tables already existed without the new fields
    await pool.query(
      `ALTER TABLE form_responses ADD COLUMN IF NOT EXISTS participant_code TEXT`
    );
    await pool.query(
      `ALTER TABLE form_answers ADD COLUMN IF NOT EXISTS participant_id INTEGER REFERENCES participants(id) ON DELETE CASCADE`
    );
    await pool.query(
      `ALTER TABLE form_answers ADD COLUMN IF NOT EXISTS participant_code TEXT`
    );
    
    // Check if session table exists
    const sessionCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'session'
      );
    `);
    console.log('✅ Session table check:', sessionCheck.rows[0].exists);
    
    console.log('✅ DB initialization complete');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    console.error('Full error:', error);
    throw error;
  }
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

const ALLOWED_QUESTION_TYPES = new Set([
  'short_text',
  'long_text',
  'select_one',
  'select_multiple',
  'dropdown'
]);

function normalizeQuestions(questions = []) {
  if (!Array.isArray(questions)) {
    throw new Error('Questions must be an array');
  }
  return questions.map((q, idx) => {
    const { label, type, required = false, options = [], sortOrder = idx } = q;
    if (!label || !type) throw new Error('Each question needs a label and type');
    if (!ALLOWED_QUESTION_TYPES.has(type)) throw new Error(`Invalid question type: ${type}`);
    const opts = Array.isArray(options)
      ? options.filter((o) => o && String(o).trim() !== '').map((o) => String(o))
      : [];
    return {
      label: String(label),
      type,
      required: Boolean(required),
      options: opts,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : idx
    };
  });
}

function validateAnswers(formQuestions, answers) {
  const answerMap = {};
  formQuestions.forEach((q) => {
    const raw = answers[q.id];
    if (q.required && (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0))) {
      throw new Error(`Question "${q.label}" is required`);
    }
    if (raw === undefined || raw === null || raw === '') {
      answerMap[q.id] = { answer_text: null, answer_json: null };
      return;
    }

    if (q.type === 'select_multiple') {
      if (!Array.isArray(raw)) throw new Error(`Question "${q.label}" expects an array`);
      answerMap[q.id] = { answer_text: null, answer_json: raw };
    } else if (q.type === 'short_text' || q.type === 'long_text') {
      answerMap[q.id] = { answer_text: String(raw), answer_json: null };
    } else {
      // single choice/dropdown
      answerMap[q.id] = { answer_text: String(raw), answer_json: null };
    }
  });
  return answerMap;
}

// --- Routes ---

// Who am I?
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

// --- Admin: Forms CRUD ---
app.post('/api/admin/forms', ensureAdmin, async (req, res) => {
  try {
    const { title, description, releaseAt, isActive = true, questions = [] } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const normalizedQuestions = normalizeQuestions(questions);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const formResult = await client.query(
        `INSERT INTO forms (title, description, release_at, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [title, description || null, releaseAt ? new Date(releaseAt) : new Date(), Boolean(isActive)]
      );
      const form = formResult.rows[0];

      const insertedQuestions = [];
      for (const q of normalizedQuestions) {
        const qRes = await client.query(
          `INSERT INTO form_questions (form_id, label, type, required, options, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [form.id, q.label, q.type, q.required, JSON.stringify(q.options), q.sortOrder]
        );
        insertedQuestions.push(qRes.rows[0]);
      }

      await client.query('COMMIT');
      res.json({ form, questions: insertedQuestions });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Create form error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.put('/api/admin/forms/:id', ensureAdmin, async (req, res) => {
  const formId = parseInt(req.params.id, 10);
  if (isNaN(formId)) return res.status(400).json({ error: 'Invalid form id' });

  try {
    const { title, description, releaseAt, isActive = true, questions = [] } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const normalizedQuestions = normalizeQuestions(questions);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const formResult = await client.query(
        `UPDATE forms
         SET title = $1, description = $2, release_at = $3, is_active = $4, updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [title, description || null, releaseAt ? new Date(releaseAt) : new Date(), Boolean(isActive), formId]
      );
      if (formResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Form not found' });
      }

      await client.query('DELETE FROM form_questions WHERE form_id = $1', [formId]);

      const insertedQuestions = [];
      for (const q of normalizedQuestions) {
        const qRes = await client.query(
          `INSERT INTO form_questions (form_id, label, type, required, options, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [formId, q.label, q.type, q.required, JSON.stringify(q.options), q.sortOrder]
        );
        insertedQuestions.push(qRes.rows[0]);
      }

      await client.query('COMMIT');
      res.json({ form: formResult.rows[0], questions: insertedQuestions });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Update form error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.get('/api/admin/forms', ensureAdmin, async (req, res) => {
  try {
    const formsResult = await pool.query(
      'SELECT * FROM forms ORDER BY release_at DESC, id DESC'
    );
    const forms = formsResult.rows;
    if (forms.length === 0) return res.json({ forms: [] });

    const formIds = forms.map((f) => f.id);
    const qsResult = await pool.query(
      'SELECT * FROM form_questions WHERE form_id = ANY($1) ORDER BY sort_order, id',
      [formIds]
    );
    const grouped = {};
    qsResult.rows.forEach((q) => {
      grouped[q.form_id] = grouped[q.form_id] || [];
      grouped[q.form_id].push(q);
    });

    const withQuestions = forms.map((f) => ({
      ...f,
      questions: grouped[f.id] || []
    }));
    res.json({ forms: withQuestions });
  } catch (err) {
    console.error('❌ List forms error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/forms/:id', ensureAdmin, async (req, res) => {
  const formId = parseInt(req.params.id, 10);
  if (isNaN(formId)) return res.status(400).json({ error: 'Invalid form id' });
  try {
    const formResult = await pool.query('SELECT * FROM forms WHERE id = $1', [formId]);
    if (formResult.rowCount === 0) return res.status(404).json({ error: 'Form not found' });
    const qsResult = await pool.query(
      'SELECT * FROM form_questions WHERE form_id = $1 ORDER BY sort_order, id',
      [formId]
    );
    res.json({ form: { ...formResult.rows[0], questions: qsResult.rows } });
  } catch (err) {
    console.error('❌ Get form error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Admin: DB explorer (public schema) ---
app.get('/api/admin/db/tables', ensureAdmin, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    res.json({ tables: result.rows.map((r) => r.tablename) });
  } catch (err) {
    console.error('❌ List tables error:', err.message);
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/db/table/:name', ensureAdmin, async (req, res) => {
  const table = req.params.name;
  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }
  try {
    const tablesResult = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`,
      [table]
    );
    if (tablesResult.rowCount === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    const columnsResult = await pool.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_schema = 'public' AND table_name = $1 
       ORDER BY ordinal_position`,
      [table]
    );
    const columns = columnsResult.rows.map((r) => r.column_name);

    const rowsResult = await pool.query(`SELECT * FROM ${table} ORDER BY 1 DESC LIMIT 200`);
    res.json({ columns, rows: rowsResult.rows });
  } catch (err) {
    console.error(`❌ Table fetch error for table "${table}":`, err.message);
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Participant: available forms + responses ---
app.get('/api/forms/available', ensureLoggedIn, async (req, res) => {
  if (req.session.user.role !== 'participant') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const formsResult = await pool.query(
      `SELECT * FROM forms 
       WHERE is_active = TRUE AND release_at <= NOW()
       ORDER BY release_at DESC, id DESC`
    );
    const forms = formsResult.rows;
    if (forms.length === 0) return res.json({ forms: [] });
    const formIds = forms.map((f) => f.id);
    const qsResult = await pool.query(
      'SELECT * FROM form_questions WHERE form_id = ANY($1) ORDER BY sort_order, id',
      [formIds]
    );
    const grouped = {};
    qsResult.rows.forEach((q) => {
      const options = Array.isArray(q.options) ? q.options : q.options ? q.options : [];
      grouped[q.form_id] = grouped[q.form_id] || [];
      grouped[q.form_id].push({ ...q, options });
    });

    const withQuestions = forms.map((f) => ({
      ...f,
      questions: grouped[f.id] || []
    }));
    res.json({ forms: withQuestions });
  } catch (err) {
    console.error('❌ Available forms error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/forms/:id/response', ensureLoggedIn, async (req, res) => {
  if (req.session.user.role !== 'participant') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const formId = parseInt(req.params.id, 10);
  if (isNaN(formId)) return res.status(400).json({ error: 'Invalid form id' });
  try {
    const responseResult = await pool.query(
      'SELECT * FROM form_responses WHERE form_id = $1 AND participant_id = $2',
      [formId, req.session.user.id]
    );
    if (responseResult.rowCount === 0) return res.json({ response: null });
    const response = responseResult.rows[0];
    const answersResult = await pool.query(
      'SELECT question_id, answer_text, answer_json FROM form_answers WHERE response_id = $1',
      [response.id]
    );
    const answers = {};
    answersResult.rows.forEach((a) => {
      answers[a.question_id] = a.answer_json !== null ? a.answer_json : a.answer_text;
    });
    res.json({ response: { id: response.id, answers } });
  } catch (err) {
    console.error('❌ Get response error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/forms/:id/responses', ensureLoggedIn, async (req, res) => {
  if (req.session.user.role !== 'participant') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const formId = parseInt(req.params.id, 10);
  if (isNaN(formId)) return res.status(400).json({ error: 'Invalid form id' });

  try {
    const formResult = await pool.query(
      `SELECT * FROM forms WHERE id = $1 AND is_active = TRUE AND release_at <= NOW()`,
      [formId]
    );
    if (formResult.rowCount === 0) return res.status(404).json({ error: 'Form not available' });

    const questionsResult = await pool.query(
      'SELECT * FROM form_questions WHERE form_id = $1 ORDER BY sort_order, id',
      [formId]
    );
    const questions = questionsResult.rows;
    const answersInput = req.body.answers || {};
    const processedAnswers = validateAnswers(questions, answersInput);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let responseId;
      const existing = await client.query(
        'SELECT id FROM form_responses WHERE form_id = $1 AND participant_id = $2',
        [formId, req.session.user.id]
      );
      if (existing.rowCount === 0) {
        const insert = await client.query(
          `INSERT INTO form_responses (form_id, participant_id, participant_code)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [formId, req.session.user.id, req.session.user.code || null]
        );
        responseId = insert.rows[0].id;
      } else {
        responseId = existing.rows[0].id;
        await client.query(
          'UPDATE form_responses SET updated_at = NOW(), participant_code = $2 WHERE id = $1',
          [responseId, req.session.user.code || null]
        );
        await client.query('DELETE FROM form_answers WHERE response_id = $1', [responseId]);
      }

      for (const q of questions) {
        const prepared = processedAnswers[q.id] || { answer_text: null, answer_json: null };
        let jsonVal = null;
        if (prepared.answer_json !== null && prepared.answer_json !== undefined) {
          try {
            jsonVal = JSON.stringify(prepared.answer_json);
          } catch (e) {
            console.error('❌ Failed to stringify answer_json for question', q.id, e);
            jsonVal = null;
          }
        }
        await client.query(
          `INSERT INTO form_answers (response_id, question_id, participant_id, participant_code, answer_text, answer_json)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [responseId, q.id, req.session.user.id, req.session.user.code || null, prepared.answer_text, jsonVal]
        );
      }

      await client.query('COMMIT');
      res.json({ ok: true, responseId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('❌ Submit response error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
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
    // Send email with code + password
if (emailService) {
  try {
    await emailService.emails.send({
      from: 'Research Study <no-reply@ifshealers.com>', // Free domain from Resend
      to: email,
      subject: 'Your study login code and password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Thank you for joining the study!</h2>
          <p style="font-size: 16px;">Your login credentials have been generated:</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 10px 0;"><strong>Login Code:</strong> <code style="background-color: #fff; padding: 5px 10px; border-radius: 3px;">${code}</code></p>
            <p style="margin: 10px 0;"><strong>Password:</strong> <code style="background-color: #fff; padding: 5px 10px; border-radius: 3px;">${password}</code></p>
          </div>
          <p style="color: #666; font-size: 14px;">Please keep this information safe and do not share it with anyone.</p>
        </div>
      `
    });
    console.log('📧 Email sent successfully to', email);
  } catch (err) {
    console.error('❌ Error sending email:', err.message);
    console.error('Full error:', err);
    // Don't fail registration if email fails
  }
} else {
  console.log('⚠️ Email not sent (email service not configured)');
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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
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

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('❌ Reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`👋 ${signal} signal received: closing HTTP server`);
  server.close(() => {
    console.log('💤 HTTP server closed');
    io.close(() => {
      console.log('💤 Socket.IO server closed');
    });
  });
  try {
    await pool.end();
    console.log('💤 Database pool closed');
  } catch (err) {
    console.error('⚠️ Error closing DB pool:', err);
  }
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

initDb()
  .then(() => {
    const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
  console.log(`🏥 Health check available at http://${HOST}:${PORT}/health`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔌 Ready to accept connections`);
});

// Add error handler for server
server.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});
  })
  .catch((err) => {
    console.error('❌ Failed to init DB:', err);
    process.exit(1);
  });
