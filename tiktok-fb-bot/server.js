require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const queue = require('./queue');
const logger = require('./logger');
const { validateEnvironment, startScheduler, processQueue } = require('./index');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_USERNAME = (process.env.AUTH_USERNAME || 'admin').trim();
const AUTH_PASSWORD = (process.env.AUTH_PASSWORD || 'change-me').trim();
const SESSION_SECRET = (process.env.SESSION_SECRET || 'tiktok-fb-bot-session-secret').trim();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.user === AUTH_USERNAME) {
    return next();
  }

  if (req.accepts('html')) {
    return res.redirect('/login.html');
  }

  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

app.get('/api/auth/status', (req, res) => {
  res.json({ ok: true, authenticated: Boolean(req.session && req.session.user), user: req.session?.user || null });
});

app.post('/api/auth/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = (req.body.password || '').trim();

  if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
    req.session.user = username;
    return res.json({ ok: true, user: username });
  }

  return res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ ok: false, error: 'Failed to logout' });
    }

    return res.json({ ok: true });
  });
});

app.use('/api', requireAuth);

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    schedule: process.env.CRON_SCHEDULE || '0 * * * *',
    pending: queue.getPendingUrls(),
    logs: logger.getLogs().slice(-10),
  });
});

app.get('/api/queue', (req, res) => {
  res.json({ ok: true, items: queue.getPendingUrls() });
});

app.post('/api/queue/add', async (req, res) => {
  try {
    const links = req.body.links || '';
    const result = queue.appendLinks(links);

    if (result.added > 0) {
      await processQueue();
    }

    res.json({ ok: true, ...result, started: result.added > 0 });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/queue/process', async (req, res) => {
  try {
    await processQueue();
    res.json({ ok: true, pending: queue.getPendingUrls() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/logs', (req, res) => {
  res.json({ ok: true, logs: logger.getLogs().slice(-50) });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/login.html', (req, res) => {
  if (req.session && req.session.user === AUTH_USERNAME) {
    return res.redirect('/');
  }

  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function startServer() {
  validateEnvironment();
  startScheduler();

  app.listen(PORT, () => {
    console.log(`\n🌐 Web dashboard is running on http://localhost:${PORT}`);
    console.log('📱 Open this in your phone browser or on any machine on the same network.\n');
  });
}

startServer();
