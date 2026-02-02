const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.DASHBOARD_API_KEY || 'keystone-dash-2026';
const DASH_DIR = path.join(__dirname, 'dashboards');

// Ensure dashboards directory exists
if (!fs.existsSync(DASH_DIR)) fs.mkdirSync(DASH_DIR, { recursive: true });

// Parse JSON and large HTML bodies
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ limit: '5mb', type: 'text/html' }));

// --- Static dashboard serving ---
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
});
