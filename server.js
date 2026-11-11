// Load .env without extra dependencies.
const path = require('path');
require('./src/env').loadEnv(path.join(__dirname, '.env'));

// All dates and fine times follow the office clock, even if the server is in another country.
process.env.TZ = process.env.TZ || process.env.OFFICE_TIMEZONE || 'Asia/Karachi';

const express = require('express');
const os = require('os');
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3112;

// Only trust X-Forwarded-For from Nginx on this same machine.
// This stops anyone from faking the office IP by sending the header themselves.
// (Docker sets TRUST_PROXY=uniquelocal because Nginx reaches the container over the Docker network.)
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.disable('x-powered-by');

app.use(express.json({ limit: '100kb' }));

// ---------- Security headers ----------
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// ---------- Block requests from other websites ----------
// A page on another site can't make the browser change anything here (CSRF).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (e) { /* bad origin */ }
    if (host !== req.headers.host) return res.status(403).json({ success: false, message: 'Request blocked.' });
  }
  if (req.headers['content-length'] && req.headers['content-length'] !== '0' && !req.is('application/json')) {
    return res.status(415).json({ success: false, message: 'Bad request.' });
  }
  next();
});

// ---------- Simple rate limit: 300 API calls per minute per IP ----------
const hits = new Map();
app.use('/api', (req, res, next) => {
  const ip = req.ip || '';
  const now = Date.now();
  let rec = hits.get(ip);
  if (!rec || now - rec.start > 60000) { rec = { start: now, count: 0 }; hits.set(ip, rec); }
  if (++rec.count > 300) return res.status(429).json({ success: false, message: 'Too many requests. Wait a minute and try again.' });
  next();
});
setInterval(() => { const now = Date.now(); for (const [ip, rec] of hits) if (now - rec.start > 60000) hits.delete(ip); }, 60000).unref();

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Files are sent relative to public/ so a dot-folder higher up the path (e.g. ~/.config) can't block them.
const PUBLIC = path.join(__dirname, 'public');

// Install manifests (app name follows the office name in Settings).
const { manifest } = require('./src/manifest');
app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify(manifest('employee'))));
app.get('/admin.webmanifest', (req, res) => res.type('application/manifest+json').send(JSON.stringify(manifest('admin'))));
// The service worker must never be cached, so app updates reach phones quickly.
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile('sw.js', { root: PUBLIC });
});

app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: 0 }));

app.use('/api/admin', adminRoutes);
app.use('/api', apiRoutes);
app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Not found' }));

app.get('/admin', (req, res) => res.sendFile('admin.html', { root: PUBLIC }));
app.get('/sheet', (req, res) => res.redirect('/admin#reports'));
app.use((req, res) => res.sendFile('index.html', { root: PUBLIC }));

// Friendly JSON errors instead of stack traces.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, message: err.type === 'entity.parse.failed' ? 'Bad request.' : 'Something went wrong on the server. Please try again.' });
});

function networkAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

if (require.main === module) {
  require('./src/scheduler').start();
  // On the live server, listen on localhost only: the internet reaches the app through Nginx.
  const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
  app.listen(PORT, HOST, () => {
    const lan = networkAddresses()[0];
    console.log('──────────────────────────────────────────────');
    console.log(' Office attendance is running');
    console.log(` Employees:  http://localhost:${PORT}/`);
    console.log(` Admin:      http://localhost:${PORT}/admin`);
    if (lan) console.log(` On LAN:     http://${lan}:${PORT}/`);
    console.log(` Timezone:   ${process.env.TZ}`);
    console.log('──────────────────────────────────────────────');
  });
}

module.exports = app;
