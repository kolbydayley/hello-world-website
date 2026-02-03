const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.DASHBOARD_API_KEY || 'keystone-dash-2026';
const DASH_DIR = path.join(__dirname, 'dashboards');
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'kolby2026';
const COOKIE_SECRET = process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Ensure dashboards directory exists
if (!fs.existsSync(DASH_DIR)) fs.mkdirSync(DASH_DIR, { recursive: true });

// Parse JSON, HTML, and URL-encoded bodies
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ limit: '5mb', type: 'text/html' }));
app.use(express.urlencoded({ extended: false }));

// Trust proxy for secure cookies behind Railway's proxy
app.set('trust proxy', 1);

// --- Auth helpers ---
function createAuthToken() {
  const payload = Date.now().toString();
  const hmac = crypto.createHmac('sha256', COOKIE_SECRET).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

function verifyAuthToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [timestamp, sig] = parts;
  const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(timestamp).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return false;
  const age = Date.now() - parseInt(timestamp, 10);
  return age >= 0 && age < COOKIE_MAX_AGE_MS;
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie;
  if (header) {
    header.split(';').forEach(c => {
      const [k, ...v] = c.trim().split('=');
      if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
    });
  }
  return cookies;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return verifyAuthToken(cookies['dash_session']);
}

function setAuthCookie(res, token) {
  const maxAge = COOKIE_MAX_AGE_MS / 1000; // seconds
  res.setHeader('Set-Cookie',
    `dash_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Path=/`
  );
}

// --- Login page (NO financial data) ---
function renderLoginPage(error) {
  const errorHtml = error
    ? `<div class="error">${error}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login — Keystone Dashboards</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f23;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column}
.lock-icon{font-size:64px;margin-bottom:24px;opacity:0.7}
h2{font-size:1.5rem;margin-bottom:8px}
p{color:#94a3b8;margin-bottom:24px;font-size:0.9rem}
form{display:flex;flex-direction:column;align-items:center}
input[type="password"]{background:#1a1a2e;border:1px solid #2d2d5e;color:#e2e8f0;padding:12px 20px;border-radius:8px;font-size:1rem;width:280px;text-align:center;outline:none;transition:border-color 0.2s}
input[type="password"]:focus{border-color:#00d4ff}
button{margin-top:16px;padding:10px 32px;background:linear-gradient(135deg,#00d4ff,#7c3aed);border:none;color:#fff;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:600;transition:opacity 0.2s}
button:hover{opacity:0.9}
.error{color:#ef4444;font-size:0.85rem;margin-top:12px;min-height:20px}
</style>
</head>
<body>
<div class="lock-icon">🔒</div>
<h2>Financial Dashboard</h2>
<p>Enter password to continue</p>
<form method="POST" action="/d/login">
  <input type="hidden" name="redirect" value="">
  <input type="password" name="password" placeholder="Password" autofocus>
  <button type="submit">Unlock</button>
</form>
${errorHtml}
</body>
</html>`;
}

// --- Auth middleware for /d/*.html routes ---
app.get('/d/:name.html', (req, res, next) => {
  if (isAuthenticated(req)) {
    // Serve the file directly
    const filePath = path.join(DASH_DIR, `${req.params.name}.html`);
    if (fs.existsSync(filePath)) {
      res.type('html').send(fs.readFileSync(filePath, 'utf8'));
    } else {
      res.status(404).send('Dashboard not found');
    }
  } else {
    // Serve login page — NO dashboard data
    const loginHtml = renderLoginPage(null).replace(
      'name="redirect" value=""',
      `name="redirect" value="/d/${req.params.name}.html"`
    );
    res.type('html').send(loginHtml);
  }
});

// --- Login POST endpoint ---
app.post('/d/login', (req, res) => {
  const password = req.body.password;
  const redirect = req.body.redirect || '/';

  if (password === DASHBOARD_PASSWORD) {
    const token = createAuthToken();
    setAuthCookie(res, token);
    res.redirect(302, redirect);
  } else {
    const loginHtml = renderLoginPage('Incorrect password. Try again.').replace(
      'name="redirect" value=""',
      `name="redirect" value="${redirect.replace(/"/g, '&quot;')}"`
    );
    res.type('html').send(loginHtml);
  }
});

// --- Logout endpoint ---
app.get('/d/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'dash_session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
  res.redirect(302, '/');
});

// --- Static files in /d that are NOT .html (CSS, JS, images, etc.) ---
app.use('/d', express.static(DASH_DIR));

// --- Dashboard index ---
app.get('/', (req, res) => {
  const files = fs.readdirSync(DASH_DIR).filter(f => f.endsWith('.html')).sort();
  const cards = files.map(f => {
    const stat = fs.statSync(path.join(DASH_DIR, f));
    const name = f.replace('.html', '').replace(/-/g, ' ');
    return `<a href="/d/${f}" class="card">
      <div class="name">${name}</div>
      <div class="meta">${stat.size > 1024 ? (stat.size/1024).toFixed(1) + ' KB' : stat.size + ' B'} · ${stat.mtime.toISOString().split('T')[0]}</div>
    </a>`;
  }).join('\n');

  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keystone Dashboards</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#111; color:#eee; padding:40px 20px; max-width:600px; margin:0 auto; }
  h1 { font-size:1.5rem; margin-bottom:8px; }
  .sub { color:#888; margin-bottom:32px; font-size:0.9rem; }
  .card { display:block; background:#1a1a2e; border-radius:10px; padding:16px 20px; margin-bottom:12px; text-decoration:none; color:#eee; transition:background 0.2s; }
  .card:hover { background:#252550; }
  .name { font-weight:600; text-transform:capitalize; font-size:1.05rem; }
  .meta { color:#888; font-size:0.8rem; margin-top:4px; }
  .empty { color:#666; font-style:italic; }
</style>
</head><body>
<h1>🌀 Keystone Dashboards</h1>
<p class="sub">Interactive dashboards from your AI assistant</p>
${files.length ? cards : '<p class="empty">No dashboards yet.</p>'}
</body></html>`);
});

// --- API: Push dashboard ---
app.put('/api/dashboard/:name', (req, res) => {
  if (req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  
  const name = req.params.name.replace(/[^a-z0-9-]/gi, '');
  if (!name) return res.status(400).json({ error: 'invalid name' });
  
  const html = typeof req.body === 'string' ? req.body : req.body.html;
  if (!html) return res.status(400).json({ error: 'no html content' });
  
  const filePath = path.join(DASH_DIR, `${name}.html`);
  fs.writeFileSync(filePath, html);
  
  res.json({ ok: true, url: `/d/${name}.html`, size: html.length });
});

// --- API: List dashboards ---
app.get('/api/dashboards', (req, res) => {
  const files = fs.readdirSync(DASH_DIR).filter(f => f.endsWith('.html'));
  res.json(files.map(f => ({
    name: f.replace('.html', ''),
    url: `/d/${f}`,
    size: fs.statSync(path.join(DASH_DIR, f)).size,
    updated: fs.statSync(path.join(DASH_DIR, f)).mtime.toISOString()
  })));
});

// --- API: Delete dashboard ---
app.delete('/api/dashboard/:name', (req, res) => {
  if (req.headers['x-api-key'] !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  const filePath = path.join(DASH_DIR, `${req.params.name}.html`);
  if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); res.json({ ok: true }); }
  else res.status(404).json({ error: 'not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Keystone Dashboards running on port ${PORT}`);
  const files = fs.readdirSync(DASH_DIR).filter(f => f.endsWith('.html'));
  console.log(`Serving ${files.length} dashboards`);
  console.log(`Dashboard auth enabled (cookie-based, 30-day expiry)`);
});
