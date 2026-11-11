// Push notifications (Web Push). Works on Android/desktop Chrome, Edge, Firefox,
// and on iPhone once the app is added to the Home Screen (iOS 16.4+).
// Needs HTTPS on the live site; localhost works for testing.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const db = require('./db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');

// VAPID keys identify this server to the push services. They come from .env,
// or are created once and saved in data/vapid.json. Changing them means everyone
// has to turn notifications on again, so keep that file with your backups.
function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
    if (saved.publicKey && saved.privateKey) return saved;
  } catch (e) { /* first run */ }
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

const keys = loadKeys();
const subject = process.env.VAPID_SUBJECT || (process.env.PUBLIC_URL ? process.env.PUBLIC_URL : 'https://office.medialinkers.pk');
webpush.setVapidDetails(subject.startsWith('http') || subject.startsWith('mailto:') ? subject : `https://${subject}`, keys.publicKey, keys.privateKey);

const publicKey = () => keys.publicKey;

// Only accept addresses of the real browser push services, so nobody can make
// the server send requests to internal addresses.
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/i;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
function isValidSubscription(sub) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000) return false;
  let url;
  try { url = new URL(sub.endpoint); } catch (e) { return false; }
  if (url.protocol !== 'https:' || url.port || !PUSH_HOSTS.test(url.hostname)) return false;
  const k = sub.keys || {};
  return typeof k.p256dh === 'string' && typeof k.auth === 'string' && B64URL.test(k.p256dh) && B64URL.test(k.auth)
    && k.p256dh.length >= 80 && k.p256dh.length <= 100 && k.auth.length >= 16 && k.auth.length <= 32;
}

// Send one payload to every phone/browser of an owner ('admin' or an employee id).
async function sendTo(owner, payload) {
  const subs = db.getPushSubs().filter(s => s.owner === owner);
  if (!subs.length) return 0;
  const body = JSON.stringify({ icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', ...payload });
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 6 * 3600, urgency: payload.urgency || 'normal' });
      sent++;
    } catch (err) {
      // 404 / 410: the phone turned notifications off or the app was removed.
      if (err.statusCode === 404 || err.statusCode === 410) db.removePushSub(s.endpoint);
      else console.warn('Push failed:', err.statusCode || '', err.body || err.message);
    }
  }));
  return sent;
}

// Fire-and-forget so a slow push service never slows down a check-in.
function fire(owner, payload) {
  sendTo(owner, payload).catch(err => console.warn('Push error:', err.message));
}

// ---------- Admin ----------
function admin(event, payload) {
  const prefs = db.getSettings().push_admin || {};
  if (event && prefs[event] === false) return;
  fire('admin', { url: '/admin', ...payload });
}

// ---------- Employees ----------
// Saves the in-app notification and, if allowed, pushes it to the employee's phone.
function employee(emp, { title, body = '', kind = 'info', url = '/#home', event = 'decisions', inApp = true }) {
  if (!emp) return;
  if (inApp) db.addNotification({ employee_id: emp.id, title, body, kind });
  const prefs = db.getSettings().push_employee || {};
  if (event && prefs[event] === false) return;
  fire(emp.id, { title, body, url, tag: `${event}-${emp.id}` });
}

function everyone(payload, event = 'announcements') {
  const prefs = db.getSettings().push_employee || {};
  if (event && prefs[event] === false) return;
  for (const emp of db.getEmployees().filter(e => e.status === 'active')) fire(emp.id, payload);
}

module.exports = { publicKey, isValidSubscription, sendTo, admin, employee, everyone };
