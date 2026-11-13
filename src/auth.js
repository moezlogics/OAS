const crypto = require('crypto');
const db = require('./db');
const { getClientIP, isAllowedOfficeIP, officeIPs, officeNetworkFor, dateKey } = require('./attendanceEngine');

const fs = require('fs');
const path = require('path');

// The secret that signs sessions. Never a value anyone can guess:
// use JWT_SECRET from .env if it is long enough, otherwise create a random one
// once and keep it in data/.session_secret (readable only by the app).
const PLACEHOLDERS = new Set(['change_me_to_a_long_random_value', 'office_attendance_dev_secret_change_me']);
function loadSecret() {
  const env = String(process.env.JWT_SECRET || '').trim();
  if (env.length >= 32 && !PLACEHOLDERS.has(env)) return env;
  if (env && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: JWT_SECRET in .env is missing, a placeholder or shorter than 32 characters. Using a random secret saved in data/.session_secret instead.');
  }
  if (env && process.env.NODE_ENV !== 'production' && !PLACEHOLDERS.has(env)) return env; // tests / local only
  const file = path.join(db.DATA_DIR, '.session_secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch (e) { /* first run */ }
  const fresh = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, fresh, { mode: 0o600 });
  return fresh;
}
const JWT_SECRET = loadSecret();

// Once someone signs in, the device stays signed in. A session lasts 400 days
// (the longest a browser keeps a cookie) and renews itself on every visit,
// so people who open the app at least once a year never have to sign in again.
const SESSION_DAYS = 400;
const RENEW_AFTER_SECONDS = 3 * 86400;

function signToken(payload, expiresInHours = SESSION_DAYS * 24) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Math.round(expiresInHours * 3600);
  const body = Buffer.from(JSON.stringify({ ...payload, iat, exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function tokenFrom(req, cookieName) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return req.cookies ? req.cookies[cookieName] : null;
}

// Issue a session: sets an httpOnly cookie and returns the token (the app also keeps a copy).
function startSession(req, res, cookieName, payload) {
  const token = signToken(payload);
  res.cookie(cookieName, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_DAYS * 86400000 });
  return token;
}

// Quietly renew an older session so it never runs out while the app is in use.
function maybeRenew(req, res, cookieName, payload) {
  const age = Math.floor(Date.now() / 1000) - (payload.iat || 0);
  if (age < RENEW_AFTER_SECONDS) return;
  const { iat, exp, ...rest } = payload;
  const token = startSession(req, res, cookieName, rest);
  res.setHeader('X-Session-Token', token);
}

// ---------- Brute-force protection for PIN / password ----------
// Three counters, so guessing doesn't work by switching accounts or IPs:
//   same account + same IP : 5 wrong tries  -> locked 10 min
//   same IP, any account   : 20 wrong tries in 15 min -> locked 30 min
//   same account, any IP   : 15 wrong tries in 30 min -> locked 15 min
const MIN = 60 * 1000;
const RULES = {
  pair: { max: 5, window: 10 * MIN, lock: 10 * MIN },
  ip: { max: 20, window: 15 * MIN, lock: 30 * MIN },
  account: { max: 15, window: 30 * MIN, lock: 15 * MIN }
};
const attempts = new Map();
const keysFor = (account, ip) => ({ pair: `p|${account}|${ip}`, ip: `i|${ip}`, account: `a|${account}` });

function lockMessage(until) {
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  return `Too many wrong tries. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
}
function loginGuard(account, ip) {
  const now = Date.now();
  for (const key of Object.values(keysFor(account, ip))) {
    const rec = attempts.get(key);
    if (rec && rec.lockedUntil > now) return lockMessage(rec.lockedUntil);
  }
  return null;
}
function loginFailed(account, ip) {
  const now = Date.now();
  let left = RULES.pair.max;
  for (const [kind, key] of Object.entries(keysFor(account, ip))) {
    const rule = RULES[kind];
    let rec = attempts.get(key);
    if (!rec || now - rec.first > rule.window) rec = { count: 0, first: now, lockedUntil: 0 };
    rec.count++;
    if (rec.count >= rule.max) { rec.lockedUntil = now + rule.lock; rec.count = 0; rec.first = now; }
    attempts.set(key, rec);
    if (kind === 'pair') left = rec.lockedUntil > now ? 0 : rule.max - rec.count;
  }
  return left;
}
function loginSucceeded(account, ip) {
  const k = keysFor(account, ip);
  attempts.delete(k.pair);
  attempts.delete(k.account);
}
// Forget old entries so memory can't grow without limit.
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of attempts) if (rec.lockedUntil < now && now - rec.first > 30 * MIN) attempts.delete(key);
  if (attempts.size > 50000) attempts.clear();
}, 10 * MIN).unref();

// ---------- Admin ----------
function requireAdmin(req, res, next) {
  const payload = verifyToken(tokenFrom(req, 'admin_token'));
  const settings = db.getSettings();
  if (!payload || payload.role !== 'admin' || (payload.v || 0) !== (settings.admin_session_version || 0)) {
    return res.status(401).json({ success: false, message: 'Please sign in again.' });
  }
  req.admin = payload;

  if (settings.enforce_ip_admin) {
    const clientIP = getClientIP(req);
    if (!isAllowedOfficeIP(clientIP, officeIPs(settings))) {
      return res.status(403).json({ success: false, message: `The admin panel only opens on the office WiFi. Your IP: ${clientIP}`, clientIP });
    }
  }
  maybeRenew(req, res, 'admin_token', payload);
  next();
}

// ---------- Employee ----------
function requireEmployee(req, res, next) {
  const payload = verifyToken(tokenFrom(req, 'emp_token'));
  if (!payload || payload.role !== 'employee') {
    return res.status(401).json({ success: false, message: 'Please sign in again.' });
  }
  const emp = db.getEmployeeById(payload.sub);
  if (!emp || emp.status !== 'active') {
    return res.status(401).json({ success: false, message: 'Your account is not active. Please contact the admin.' });
  }
  // A PIN change or phone reset bumps the version and signs out old sessions.
  if ((emp.session_version || 0) !== (payload.v || 0)) {
    return res.status(401).json({ success: false, message: 'You were signed out. Please sign in again.' });
  }
  req.employee = emp;
  maybeRenew(req, res, 'emp_token', payload);
  next();
}

function requireOfficeIP(req, res, next) {
  const settings = db.getSettings();
  const clientIP = getClientIP(req);
  req.clientIP = clientIP;
  if (settings.enforce_ip_attendance && !isAllowedOfficeIP(clientIP, officeIPs(settings))) {
    // Remember it so the admin can add the network with one tap if it really is the office.
    const network = officeNetworkFor(clientIP);
    if (req.employee) {
      db.addBlocked({ ip: clientIP, network, employee_id: req.employee.id, employee_name: req.employee.name });
      const key = `${dateKey()}:blocked:${network}`;
      if (!db.wasPushSent(key)) {
        db.markPushSent(key);
        require('./push').admin('wifi_blocked', {
          title: 'Check-in blocked',
          body: `${req.employee.name} tried to check in from network ${network}. If they are in the office, add it in Settings → Office WiFi.`,
          url: '/admin#settings', tag: `blocked-${network}`
        });
      }
    }
    return res.status(403).json({
      success: false,
      isOfficeWifi: false,
      clientIP,
      message: `You are not on the office WiFi (your network: ${clientIP}). Turn off mobile data and connect to the office WiFi. If you are in the office, tell the admin.`
    });
  }
  next();
}

module.exports = {
  SESSION_DAYS,
  signToken,
  verifyToken,
  startSession,
  requireAdmin,
  requireEmployee,
  requireOfficeIP,
  loginGuard,
  loginFailed,
  loginSucceeded
};
