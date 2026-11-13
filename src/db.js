const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---------- Password / PIN hashing ----------
const HASH_ITERATIONS = 120000;
function iterationsFor(salt) {
  const m = /^i(\d+)\./.exec(String(salt));
  return m ? Number(m[1]) : 10000; // older records used 10,000
}
function hashPassword(password, salt = null) {
  if (!salt) salt = `i${HASH_ITERATIONS}.${crypto.randomBytes(16).toString('hex')}`;
  const hash = crypto.pbkdf2Sync(String(password), salt, iterationsFor(salt), 64, 'sha512').toString('hex');
  return { hash, salt };
}
const isOldHash = salt => iterationsFor(salt) < HASH_ITERATIONS;

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const check = crypto.pbkdf2Sync(String(password), salt, iterationsFor(salt), 64, 'sha512').toString('hex');
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- JSON file storage (atomic writes) ----------
function safeWriteJSON(filePath, data) {
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function readJSON(filePath, defaultData = null) {
  if (!fs.existsSync(filePath)) {
    if (defaultData !== null) {
      safeWriteJSON(filePath, defaultData);
      return JSON.parse(JSON.stringify(defaultData));
    }
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return defaultData;
  }
}

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const EMPLOYEES_FILE = path.join(DATA_DIR, 'employees.json');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');
const LEAVES_FILE = path.join(DATA_DIR, 'leaves.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const PUSH_FILE = path.join(DATA_DIR, 'push_subscriptions.json');
const PUSH_STATE_FILE = path.join(DATA_DIR, 'push_state.json');
const FIRST_PASSWORD_FILE = path.join(DATA_DIR, 'FIRST_ADMIN_PASSWORD.txt');
const BLOCKED_FILE = path.join(DATA_DIR, 'blocked_checkins.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// Soft, readable avatar colours — one is picked per employee.
const AVATAR_COLORS = ['#2E4BD6', '#12805C', '#B4540A', '#7A3FC4', '#0E7490', '#BE185D', '#4D7C0F', '#9F1239'];

const DEFAULT_SETTINGS = {
  office_name: 'Media Linkers',
  // Live server starts with no office IP: nobody can check in until the admin adds the office IP.
  office_ips: process.env.NODE_ENV === 'production' ? [] : ['127.0.0.1', '::1'],
  enforce_ip_attendance: true,
  enforce_ip_admin: false,
  office_start_time: '09:30',
  grace_minutes: 0,
  fine_per_hour: 100,
  office_end_time: '17:00',
  missed_checkout_fine: 100,
  absent_fine: 500,
  weekly_off_days: [0], // 0 = Sunday
  holidays: [], // [{ date: 'YYYY-MM-DD', name: 'Quaid Day' }]
  bind_device: false, // one phone per employee
  timezone: 'Asia/Karachi',
  admin_username: 'admin',
  admin_session_version: 0,
  admin_password_initial: false, // true until the admin changes the first password
  auto_office_ips: [], // [{ ip, seen_at }] reported by the automatic office link
  office_link_key: null, // secret for the automatic office link (created from Settings)
  tracking_started_on: null, // days before this never count as absent (set on first run)
  // Push notifications. Each switch can be turned off from Settings.
  push_admin: {
    leave_request: true,     // someone asks for leave or explains a late / missed day
    late_checkin: true,      // someone checks in late
    every_checkin: false,    // every single check-in (noisy, off by default)
    early_checkout: true,    // someone leaves before closing time
    morning_summary: true,   // 30 min after start: who is in, late, not in yet
    missed_checkout: true,   // 1 hour after closing: who forgot to check out
    device_blocked: true,    // someone tried to sign in on a second phone
    wifi_blocked: true       // check-in blocked from a network that isn't on the office list
  },
  push_employee: {
    checkin_reminder: true,  // 15 min before start, if not checked in yet
    checkout_reminder: true, // at closing time, if checked in but not out
    decisions: true,         // leave approved / rejected, fine changed, fine paid
    announcements: true      // admin announcements
  }
};

function normalizeSettings(s) {
  const merged = { ...DEFAULT_SETTINGS, ...s };
  if (!Array.isArray(merged.weekly_off_days)) merged.weekly_off_days = [0];
  if (!Array.isArray(merged.holidays)) merged.holidays = [];
  if (!Array.isArray(merged.office_ips)) merged.office_ips = [];
  if (!Array.isArray(merged.auto_office_ips)) merged.auto_office_ips = [];
  merged.push_admin = { ...DEFAULT_SETTINGS.push_admin, ...(s && s.push_admin) };
  merged.push_employee = { ...DEFAULT_SETTINGS.push_employee, ...(s && s.push_employee) };
  return merged;
}

// Employees: PINs are stored hashed. Older files kept plain PINs, so migrate them on read.
function normalizeEmployee(e, index = 0) {
  const emp = { ...e };
  if (emp.pin && !emp.pin_hash) {
    const { hash, salt } = hashPassword(emp.pin);
    emp.pin_hash = hash;
    emp.pin_salt = salt;
  }
  delete emp.pin;
  if (!emp.avatar_color) emp.avatar_color = AVATAR_COLORS[index % AVATAR_COLORS.length];
  if (!emp.joined_on) emp.joined_on = null;
  if (!emp.status) emp.status = 'active';
  return emp;
}

// Requests (leaves + excuses). Older files used status PENDING_REVIEW and type "Late Excuse".
function normalizeLeave(l) {
  const leave = { ...l };
  if (!leave.kind) leave.kind = /excuse/i.test(leave.type || '') ? 'excuse' : 'leave';
  if (!leave.status || leave.status === 'PENDING_REVIEW') leave.status = 'PENDING';
  if (!leave.end_date) leave.end_date = leave.date;
  return leave;
}

// ADMIN_PASSWORD from .env. Used on the first start, and again every time its value
// changes in .env (so editing .env + restarting always resets the admin password).
// A password changed in Settings stays until ADMIN_PASSWORD in .env is changed again.
const MIN_ADMIN_PASSWORD = 8;
const envFingerprint = v => crypto.createHash('sha256').update(`admin-env:${v}`).digest('hex');
function envAdminPassword() {
  const v = String(process.env.ADMIN_PASSWORD || '').trim();
  if (!v) return null;
  if (v.length < MIN_ADMIN_PASSWORD) {
    console.warn(`\n  ADMIN_PASSWORD in .env is shorter than ${MIN_ADMIN_PASSWORD} characters, so it was NOT used.\n  Use a longer one and restart, or run: npm run reset-admin -- "NewPassword"\n`);
    return null;
  }
  return v;
}

function initDB() {
  const existing = readJSON(SETTINGS_FILE);
  const fromEnv = envAdminPassword();
  if (!existing) {
    let first = fromEnv;
    let initial = false;
    if (!first) {
      initial = true;
      if (process.env.NODE_ENV === 'production') {
        // No usable password in .env: make a random one and leave it in a private file.
        first = crypto.randomBytes(9).toString('base64url');
        fs.writeFileSync(FIRST_PASSWORD_FILE, `Admin username: admin\nFirst password: ${first}\n\nSign in at /admin and change it in Settings. This file is deleted when you do.\n`, { mode: 0o600 });
        console.warn(`\n  First admin password saved in ${FIRST_PASSWORD_FILE}\n`);
      } else {
        first = 'admin123'; // local testing only
      }
    }
    const admin = hashPassword(first);
    safeWriteJSON(SETTINGS_FILE, {
      ...DEFAULT_SETTINGS, tracking_started_on: localDateKey(), admin_password_initial: initial,
      admin_password_hash: admin.hash, admin_password_salt: admin.salt,
      admin_password_env: fromEnv ? envFingerprint(fromEnv) : null
    });
    if (fromEnv) console.log('  Admin password set from ADMIN_PASSWORD in .env.');
  } else {
    const s = normalizeSettings(existing);
    if (fromEnv && s.admin_password_env !== envFingerprint(fromEnv)) {
      // .env has a new admin password: use it (unless it is already the current one).
      if (!verifyPassword(fromEnv, s.admin_password_hash, s.admin_password_salt)) {
        const up = hashPassword(fromEnv);
        s.admin_password_hash = up.hash;
        s.admin_password_salt = up.salt;
        s.admin_session_version = (s.admin_session_version || 0) + 1; // sign out old admin sessions
      }
      s.admin_password_env = envFingerprint(fromEnv);
      s.admin_password_initial = false;
      try { fs.unlinkSync(FIRST_PASSWORD_FILE); } catch (e) { /* not there */ }
      console.log('  Admin password updated from ADMIN_PASSWORD in .env.');
    }
    if (!s.tracking_started_on) {
      // Older installs: start from the first attendance record, or today.
      const first = (readJSON(ATTENDANCE_FILE) || []).map(a => a.date).filter(Boolean).sort()[0];
      s.tracking_started_on = first || localDateKey();
    }
    safeWriteJSON(SETTINGS_FILE, s);
  }

  const employees = readJSON(EMPLOYEES_FILE, []);
  const needsMigration = employees.some(e => e.pin || !e.avatar_color);
  if (needsMigration) safeWriteJSON(EMPLOYEES_FILE, employees.map(normalizeEmployee));

  readJSON(ATTENDANCE_FILE, []);
  readJSON(LEAVES_FILE, []);
  readJSON(NOTIFICATIONS_FILE, []);
  readJSON(PAYMENTS_FILE, []);
  readJSON(PUSH_FILE, []);
}

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

// Set a new admin password (used by Settings and by "npm run reset-admin").
function setAdminPassword(password) {
  const pw = String(password || '');
  if (pw.length < MIN_ADMIN_PASSWORD) throw new Error(`The password must be at least ${MIN_ADMIN_PASSWORD} characters.`);
  const current = normalizeSettings(readJSON(SETTINGS_FILE) || {});
  const { hash, salt } = hashPassword(pw);
  const updated = { ...current, admin_password_hash: hash, admin_password_salt: salt, admin_session_version: (current.admin_session_version || 0) + 1, admin_password_initial: false };
  safeWriteJSON(SETTINGS_FILE, updated);
  try { fs.unlinkSync(FIRST_PASSWORD_FILE); } catch (e) { /* not there */ }
  return updated;
}

const db = {
  initDB,
  setAdminPassword,
  MIN_ADMIN_PASSWORD,
  hashPassword,
  verifyPassword,
  isOldHash,
  DATA_DIR,
  BACKUP_DIR,
  FIRST_PASSWORD_FILE,
  AVATAR_COLORS,

  // ---------- Settings ----------
  getSettings() {
    return normalizeSettings(readJSON(SETTINGS_FILE) || {});
  },
  updateSettings(updater) {
    const current = this.getSettings();
    const updated = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
    safeWriteJSON(SETTINGS_FILE, updated);
    return updated;
  },

  // ---------- Employees ----------
  getEmployees() {
    return (readJSON(EMPLOYEES_FILE) || []).map(normalizeEmployee);
  },
  getEmployeeById(id) {
    if (!id) return null;
    const key = String(id).trim().toUpperCase();
    return this.getEmployees().find(e => String(e.id).toUpperCase() === key || String(e.code).toUpperCase() === key) || null;
  },
  saveEmployees(employees) {
    safeWriteJSON(EMPLOYEES_FILE, employees);
    return employees;
  },
  addEmployee(data) {
    const employees = this.getEmployees();
    const code = String(data.code).trim().toUpperCase();
    if (employees.some(e => e.code.toUpperCase() === code)) {
      throw new Error(`Employee code "${code}" already exists.`);
    }
    const { hash, salt } = hashPassword(data.pin || '1234');
    const newEmp = {
      id: code,
      code,
      name: String(data.name).trim(),
      designation: data.designation ? String(data.designation).trim() : 'Staff',
      department: data.department ? String(data.department).trim() : 'General',
      phone: data.phone ? String(data.phone).trim() : '',
      pin_hash: hash,
      pin_salt: salt,
      avatar_color: AVATAR_COLORS[employees.length % AVATAR_COLORS.length],
      joined_on: data.joined_on || null,
      status: 'active',
      device_id: null,
      created_at: new Date().toISOString()
    };
    employees.push(newEmp);
    this.saveEmployees(employees);
    return newEmp;
  },
  updateEmployee(id, updates) {
    const employees = this.getEmployees();
    const key = String(id).toUpperCase();
    const index = employees.findIndex(e => e.id.toUpperCase() === key || e.code.toUpperCase() === key);
    if (index === -1) throw new Error('Employee not found.');
    const next = { ...employees[index], ...updates };
    if (updates.pin) {
      const { hash, salt } = hashPassword(updates.pin);
      next.pin_hash = hash;
      next.pin_salt = salt;
      delete next.pin;
    }
    employees[index] = next;
    this.saveEmployees(employees);
    return next;
  },
  deleteEmployee(id) {
    const key = String(id).toUpperCase();
    this.saveEmployees(this.getEmployees().filter(e => e.id.toUpperCase() !== key && e.code.toUpperCase() !== key));
    return true;
  },
  verifyPin(emp, pin) {
    return verifyPassword(pin, emp.pin_hash, emp.pin_salt);
  },

  // ---------- Attendance ----------
  getAttendance() {
    return readJSON(ATTENDANCE_FILE) || [];
  },
  saveAttendance(list) {
    safeWriteJSON(ATTENDANCE_FILE, list);
    return list;
  },
  getAttendanceByDate(dateStr) {
    return this.getAttendance().filter(a => a.date === dateStr);
  },
  getAttendanceByEmployeeAndDate(employeeId, dateStr) {
    return this.getAttendance().find(a => (a.employee_id === employeeId || a.employee_code === employeeId) && a.date === dateStr) || null;
  },
  recordAttendance(record) {
    const list = this.getAttendance();
    const index = list.findIndex(a => a.id === record.id);
    const now = new Date().toISOString();
    if (index >= 0) list[index] = { ...list[index], ...record, updated_at: now };
    else list.push({ ...record, created_at: now, updated_at: now });
    this.saveAttendance(list);
    return index >= 0 ? list[index] : list[list.length - 1];
  },
  deleteAttendance(id) {
    this.saveAttendance(this.getAttendance().filter(a => a.id !== id));
  },

  // ---------- Requests: leaves & excuses ----------
  getLeaves() {
    return (readJSON(LEAVES_FILE) || []).map(normalizeLeave);
  },
  saveLeaves(leaves) {
    safeWriteJSON(LEAVES_FILE, leaves);
    return leaves;
  },
  addLeave(record) {
    const leaves = this.getLeaves();
    const leave = normalizeLeave({ id: newId('req'), created_at: new Date().toISOString(), ...record });
    leaves.push(leave);
    this.saveLeaves(leaves);
    return leave;
  },
  updateLeave(id, updates) {
    const leaves = this.getLeaves();
    const idx = leaves.findIndex(l => l.id === id);
    if (idx === -1) throw new Error('Request not found.');
    leaves[idx] = { ...leaves[idx], ...updates };
    this.saveLeaves(leaves);
    return leaves[idx];
  },
  deleteLeave(id) {
    this.saveLeaves(this.getLeaves().filter(l => l.id !== id));
  },

  // ---------- Notifications & announcements ----------
  // employee_id = 'all' means an announcement for everyone.
  getNotifications() {
    return readJSON(NOTIFICATIONS_FILE) || [];
  },
  addNotification({ employee_id, title, body = '', kind = 'info' }) {
    const list = this.getNotifications();
    const n = { id: newId('ntf'), employee_id, title, body, kind, created_at: new Date().toISOString() };
    list.push(n);
    // Keep the file small: last 1000 notifications are plenty.
    safeWriteJSON(NOTIFICATIONS_FILE, list.slice(-1000));
    return n;
  },
  deleteNotification(id) {
    safeWriteJSON(NOTIFICATIONS_FILE, this.getNotifications().filter(n => n.id !== id));
  },

  // ---------- Fine payments ----------
  // Each payment settles fines for one month: { employee_id, month: 'YYYY-MM', amount, note }.
  getPayments() {
    return readJSON(PAYMENTS_FILE) || [];
  },
  addPayment({ employee_id, employee_name, month, amount, note = '' }) {
    const list = this.getPayments();
    const p = { id: newId('pay'), employee_id, employee_name, month, amount: Math.round(Number(amount) || 0), note, paid_at: new Date().toISOString() };
    list.push(p);
    safeWriteJSON(PAYMENTS_FILE, list);
    return p;
  },
  deletePayment(id) {
    const list = this.getPayments();
    const p = list.find(x => x.id === id) || null;
    safeWriteJSON(PAYMENTS_FILE, list.filter(x => x.id !== id));
    return p;
  },
  paidFor(employeeId, month) {
    return this.getPayments().filter(p => p.employee_id === employeeId && p.month === month).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  },

  // ---------- Office network helpers ----------
  // Blocked check-ins, so the admin can see which network people are really on.
  getBlocked() {
    return readJSON(BLOCKED_FILE) || [];
  },
  addBlocked({ ip, network, employee_id, employee_name }) {
    const list = this.getBlocked().filter(b => !(b.network === network && b.employee_id === employee_id));
    list.push({ ip, network, employee_id, employee_name, at: new Date().toISOString() });
    safeWriteJSON(BLOCKED_FILE, list.slice(-30));
  },
  clearBlocked(network) {
    safeWriteJSON(BLOCKED_FILE, network ? this.getBlocked().filter(b => b.network !== network) : []);
  },
  // Called by the automatic office link: remember the office's current public IP.
  recordAutoOfficeIP(network) {
    return this.updateSettings(s => {
      const list = (s.auto_office_ips || []).filter(a => a.ip !== network);
      list.push({ ip: network, seen_at: new Date().toISOString() });
      return { ...s, auto_office_ips: list.slice(-6) };
    });
  },

  // ---------- Backups ----------
  // One JSON file with everything (except secrets), in data/backups/.
  snapshot() {
    const out = { created_at: new Date().toISOString(), version: 1 };
    for (const [key, file] of Object.entries({ settings: SETTINGS_FILE, employees: EMPLOYEES_FILE, attendance: ATTENDANCE_FILE, leaves: LEAVES_FILE, payments: PAYMENTS_FILE, notifications: NOTIFICATIONS_FILE })) {
      out[key] = readJSON(file);
    }
    return out;
  },
  backup(label = 'daily', keep = 14) {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(BACKUP_DIR, `${label}-${stamp}.json`);
    safeWriteJSON(file, this.snapshot());
    const old = fs.readdirSync(BACKUP_DIR).filter(n => n.startsWith(`${label}-`)).sort();
    for (const n of old.slice(0, Math.max(0, old.length - keep))) fs.unlinkSync(path.join(BACKUP_DIR, n));
    return file;
  },

  // ---------- Fresh start ----------
  // Clears attendance, fines, requests, payments and notifications. Employees and
  // settings stay (unless removeEmployees). Nothing before startDate counts.
  resetData({ startDate, removeEmployees = false }) {
    const backupFile = this.backup('before-reset', 10);
    safeWriteJSON(ATTENDANCE_FILE, []);
    safeWriteJSON(LEAVES_FILE, []);
    safeWriteJSON(PAYMENTS_FILE, []);
    safeWriteJSON(NOTIFICATIONS_FILE, []);
    safeWriteJSON(BLOCKED_FILE, []);
    safeWriteJSON(PUSH_STATE_FILE, { sent: {} });
    if (removeEmployees) {
      safeWriteJSON(EMPLOYEES_FILE, []);
      safeWriteJSON(PUSH_FILE, this.getPushSubs().filter(x => x.owner === 'admin'));
    } else {
      safeWriteJSON(EMPLOYEES_FILE, this.getEmployees().map(e => ({ ...e, notifications_seen_at: null })));
    }
    this.updateSettings(s => ({ ...s, tracking_started_on: startDate }));
    return backupFile;
  },

  // ---------- Push subscriptions ----------
  // owner is 'admin' or an employee id. One row per browser/phone.
  getPushSubs() {
    return readJSON(PUSH_FILE) || [];
  },
  savePushSub({ owner, subscription, ua = '' }) {
    let list = this.getPushSubs().filter(x => x.endpoint !== subscription.endpoint);
    const row = { id: newId('push'), owner, endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, ua: String(ua).slice(0, 160), created_at: new Date().toISOString() };
    list.push(row);
    // Keep at most 5 devices per person (the newest).
    const mine = list.filter(x => x.owner === owner);
    if (mine.length > 5) { const drop = new Set(mine.slice(0, mine.length - 5).map(x => x.endpoint)); list = list.filter(x => !drop.has(x.endpoint)); }
    safeWriteJSON(PUSH_FILE, list);
    return row;
  },
  removePushSub(endpoint) {
    safeWriteJSON(PUSH_FILE, this.getPushSubs().filter(x => x.endpoint !== endpoint));
  },
  removePushSubsFor(owner) {
    safeWriteJSON(PUSH_FILE, this.getPushSubs().filter(x => x.owner !== owner));
  },

  // Small memory for scheduled pushes, so each reminder goes out once a day.
  getPushState() {
    return readJSON(PUSH_STATE_FILE, { sent: {} });
  },
  markPushSent(key) {
    const st = this.getPushState();
    st.sent = st.sent || {};
    st.sent[key] = new Date().toISOString();
    // Forget anything older than 10 days.
    const cutoff = Date.now() - 10 * 86400000;
    for (const k of Object.keys(st.sent)) if (new Date(st.sent[k]).getTime() < cutoff) delete st.sent[k];
    safeWriteJSON(PUSH_STATE_FILE, st);
  },
  wasPushSent(key) {
    const st = this.getPushState();
    return !!(st.sent && st.sent[key]);
  }
};

db.initDB();

module.exports = db;
