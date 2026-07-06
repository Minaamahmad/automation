require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const queue = require('./queue');
const logger = require('./logger');
const status = require('./status');
const { validateEnvironment, startScheduler, processQueue } = require('./index');
const { getPageSummaries } = require('./pages');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_USERNAME = (process.env.AUTH_USERNAME || 'admin').trim();
const AUTH_PASSWORD = (process.env.AUTH_PASSWORD || 'password').trim();
const SESSION_SECRET = (process.env.SESSION_SECRET || 'tiktok-fb-bot-session-secret').trim();
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production';
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === '1' || TRUST_PROXY;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// If running behind a proxy / load balancer (Render, Heroku, nginx), enable trust proxy
if (TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Create Redis client and use Redis-backed session store for production / scaling
let sessionMiddleware;
try {
  const redisClient = createClient({ url: REDIS_URL });
  redisClient.on('error', (err) => {
    console.warn('Redis client error:', err && err.message ? err.message : err);
  });
  // connect asynchronously but don't block startup indefinitely
  redisClient.connect().catch((err) => console.warn('Redis connect failed:', err && err.message ? err.message : err));

  const redisStore = new RedisStore({ client: redisClient });

  sessionMiddleware = session({
    store: redisStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(SESSION_COOKIE_SECURE),
      maxAge: 1000 * 60 * 60 * 8,
    },
  });
} catch (err) {
  console.warn('Failed to initialize Redis session store, falling back to memory store:', err && err.message ? err.message : err);
  sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(SESSION_COOKIE_SECURE),
      maxAge: 1000 * 60 * 60 * 8,
    },
  });
}

app.use(sessionMiddleware);

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

app.get('/api/status', async (req, res) => {
  const pending = await queue.getPendingUrls();
  res.json({
    ok: true,
    schedule: process.env.CRON_SCHEDULE || '0 * * * *',
    pages: getPageSummaries(),
    pending,
    pendingCount: Array.isArray(pending) ? pending.length : 0,
    job: status.getSnapshot(),
    activity: logger.getStructuredLogs(15),
  });
});

app.get('/api/pages', (req, res) => {
  res.json({ ok: true, pages: getPageSummaries() });
});

app.get('/api/queue', async (req, res) => {
  try {
    const items = await queue.getPendingUrls();
    res.json({ ok: true, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/queue/add', async (req, res) => {
  try {
    const urls = req.body.urls || req.body.links || '';
    const tags = req.body.tags || '';
    const page = req.body.page || 'default';
    const result = await queue.appendLinks(urls, tags, page);

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
  // Return recent structured logs if possible
  try {
    res.json({ ok: true, logs: logger.getStructuredLogs(50) });
  } catch (err) {
    res.json({ ok: true, logs: logger.getLogs().slice(-50) });
  }
});

// Health endpoint for readiness checks
app.get('/api/health', (req, res) => {
  const health = {
    ok: true,
    uptime: process.uptime(),
    time: new Date().toISOString(),
  };

  // Redis health (if available)
  try {
    // If Redis client exists on session store, try to report connection status
    const store = req.session?.store || null;
    if (!store && sessionMiddleware && sessionMiddleware.store) {
      // attempt to access underlying Redis client
      const maybeStore = sessionMiddleware.store;
      if (maybeStore && maybeStore.client && typeof maybeStore.client.isOpen !== 'undefined') {
        health.redis = maybeStore.client.isOpen ? 'connected' : 'disconnected';
      }
    }
  } catch (err) {
    // ignore
  }

  res.status(200).json(health);
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
