const express = require('express');
const router = express.Router();
const db = require('../db');
const E = require('../attendanceEngine');
const push = require('../push');
const { startSession, requireAdmin, loginGuard, loginFailed, loginSucceeded } = require('../auth');

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const isTime = v => /^\d{2}:\d{2}$/.test(String(v || ''));
const prettyDate = key => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// ---------- Login ----------
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Enter your username and password.' });

  const settings = db.getSettings();
  const clientIP = E.getClientIP(req);
  if (settings.enforce_ip_admin && !E.isAllowedOfficeIP(clientIP, settings.office_ips)) {
    return res.status(403).json({ success: false, message: `Admin sign-in only works on the office WiFi. Your IP: ${clientIP}` });
  }

  const locked = loginGuard('admin', clientIP);
  if (locked) return res.status(429).json({ success: false, message: locked });

  const passOk = db.verifyPassword(String(password).slice(0, 200), settings.admin_password_hash, settings.admin_password_salt);
  if (String(username) !== settings.admin_username || !passOk) {
    loginFailed('admin', clientIP);
    return res.status(401).json({ success: false, message: 'Wrong username or password.' });
  }
  loginSucceeded('admin', clientIP);
  if (db.isOldHash(settings.admin_password_salt)) {
    const up = db.hashPassword(String(password));
    db.updateSettings({ admin_password_hash: up.hash, admin_password_salt: up.salt });
  }

  const token = startSession(req, res, 'admin_token', { role: 'admin', username: settings.admin_username, v: settings.admin_session_version || 0 });
  res.json({ success: true, token, user: { username: settings.admin_username, role: 'admin' } });
});

router.post('/logout', (req, res) => {
  res.clearCookie('admin_token');
  if (req.body && req.body.endpoint) db.removePushSub(String(req.body.endpoint));
  res.json({ success: true });
});

router.use(requireAdmin);

function activeEmployees() {
  return db.getEmployees().filter(e => e.status === 'active');
}

// ---------- Dashboard ----------
router.get('/dashboard', (req, res) => {
  const ctx = E.buildContext();
  const settings = ctx.settings;
  const employees = activeEmployees();

  const board = employees.map(emp => ({ employee: E.publicEmployee(emp), day: E.resolveDay(emp, ctx.todayKey, ctx) }));
  const count = st => board.filter(b => b.day.status === st).length;
  const checkedOut = board.filter(b => b.day.checkOut).length;

  // Last 7 days trend (oldest first)
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const key = E.addDays(ctx.todayKey, -i);
    const days = employees.map(emp => E.resolveDay(emp, key, ctx));
    trend.push({
      date: key,
      onTime: days.filter(d => d.status === 'PRESENT').length,
      late: days.filter(d => d.status === 'LATE').length,
      absent: days.filter(d => d.status === 'ABSENT').length,
      leave: days.filter(d => d.status === 'LEAVE' || d.status === 'PENDING').length,
      off: days.every(d => d.status === 'OFF' || d.status === 'HOLIDAY' || d.status === 'NA'),
      fine: days.reduce((s, d) => s + (d.fine || 0), 0)
    });
  }

  const month = E.monthBounds(ctx.todayKey);
  const monthReport = E.buildReport(month.from, ctx.todayKey);

  const pending = ctx.leaves.filter(l => l.status === 'PENDING').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const monthKey = ctx.todayKey.slice(0, 7);
  const finesDueMonth = monthReport.rows.reduce((s, r) => s + Math.max(0, r.summary.finalFine - db.paidFor(r.employee.id, monthKey)), 0);

  res.json({
    success: true,
    today: ctx.todayKey,
    serverTime: new Date().toISOString(),
    officeName: settings.office_name,
    timings: { startTime: settings.office_start_time, endTime: settings.office_end_time },
    isOffDay: ctx.holidays.has(ctx.todayKey) || (settings.weekly_off_days || []).includes(new Date().getDay()),
    holidayName: ctx.holidays.get(ctx.todayKey) || null,
    summary: {
      totalEmployees: employees.length,
      present: count('PRESENT') + count('LATE'),
      onTime: count('PRESENT'),
      late: count('LATE'),
      absent: count('ABSENT'),
      notYet: count('NOT_YET'),
      leave: count('LEAVE') + count('PENDING'),
      checkedOut,
      finesToday: board.reduce((s, b) => s + (b.day.fine || 0), 0),
      finesMonth: monthReport.totals.finalFine,
      finesDueMonth,
      passwordIsInitial: !!settings.admin_password_initial,
      punctualityMonth: monthReport.totals.punctuality
    },
    board,
    trend,
    insights: E.teamInsights(ctx),
    pending: pending.slice(0, 6),
    pendingCount: pending.length
  });
});

// ---------- Attendance for any date (every employee, absent ones included) ----------
router.get('/attendance', (req, res) => {
  const ctx = E.buildContext();
  const date = isDate(req.query.date) ? req.query.date : ctx.todayKey;
  const employees = db.getEmployees().filter(e => e.status === 'active' || ctx.attIndex.has(`${e.id}|${date}`));
  const rows = employees.map(emp => ({ employee: E.publicEmployee(emp), day: E.resolveDay(emp, date, ctx) }));
  res.json({ success: true, date, isToday: date === ctx.todayKey, rows });
});

// ---------- Sir decides the fine for any day ----------
router.post('/fine/adjust', (req, res) => {
  const { attendance_id, employee_code, date, new_fine, note } = req.body;
  if (new_fine === undefined || new_fine === null || new_fine === '' || Number(new_fine) < 0 || Number.isNaN(Number(new_fine))) {
    return res.status(400).json({ success: false, message: 'Enter the fine amount (0 = waive).' });
  }

  let record = attendance_id ? db.getAttendance().find(a => a.id === attendance_id) : null;
  let emp;
  if (!record) {
    emp = db.getEmployeeById(employee_code);
    if (!emp || !isDate(date)) return res.status(404).json({ success: false, message: 'Record not found.' });
    record = db.getAttendanceByEmployeeAndDate(emp.id, date) || {
      // An absent day has no record yet — create an override so Sir's fine sticks.
      id: `att_${date}_${emp.code}`, date, employee_id: emp.id, employee_code: emp.code, employee_name: emp.name,
      check_in: null, check_out: null, status: 'ABSENT', late_minutes: 0, auto_fine: 0
    };
  } else {
    emp = db.getEmployeeById(record.employee_id);
  }

  const ctx = E.buildContext();
  const before = emp ? E.resolveDay(emp, record.date, ctx).fine : record.auto_fine;
  const amount = Math.round(Number(new_fine));
  const saved = db.recordAttendance({
    ...record,
    adjusted_fine: amount,
    fine_note: String(note || '').trim() || (amount === 0 ? 'Fine waived by admin' : `Admin changed the fine from Rs ${before} to Rs ${amount}`),
    fine_adjusted_at: new Date().toISOString()
  });

  if (emp && before !== amount) {
    push.employee(emp, {
      kind: amount < before ? 'good' : 'info',
      title: amount === 0 ? `Your fine for ${prettyDate(record.date)} was waived` : `Your fine for ${prettyDate(record.date)} is now Rs ${amount}`,
      body: saved.fine_note,
      url: '/#history'
    });
  }
  res.json({ success: true, message: amount === 0 ? 'Fine waived.' : `Fine set to Rs ${amount}.`, record: saved });
});

// ---------- Manual entry (forgot to check in, phone dead, etc.) ----------
router.post('/attendance/manual-mark', (req, res) => {
  const { employee_code, date, check_in_time, check_out_time, status, fine, note } = req.body;
  const emp = db.getEmployeeById(employee_code);
  if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
  if (!isDate(date)) return res.status(400).json({ success: false, message: 'Pick a date.' });

  const settings = db.getSettings();
  const existing = db.getAttendanceByEmployeeAndDate(emp.id, date) || {};
  const base = { ...existing, id: `att_${date}_${emp.code}`, date, employee_id: emp.id, employee_code: emp.code, employee_name: emp.name };
  const hasFine = fine !== undefined && fine !== null && fine !== '';

  let record;
  if (status === 'ABSENT') {
    record = { ...base, check_in: null, check_out: null, status: 'ABSENT', late_minutes: 0, auto_fine: 0, adjusted_fine: hasFine ? Number(fine) : null };
  } else {
    if (!isTime(check_in_time)) return res.status(400).json({ success: false, message: 'Enter the check-in time.' });
    const inDate = new Date(`${date}T${check_in_time}:00`);
    const late = E.calculateLateFine(inDate, settings);
    const outDate = isTime(check_out_time) ? new Date(`${date}T${check_out_time}:00`) : null;
    const ev = outDate ? E.evaluateCheckout(outDate, settings) : { isEarly: false, earlyMinutes: 0 };
    record = {
      ...base,
      check_in: inDate.toISOString(),
      check_in_ip: 'MANUAL_ENTRY_BY_SIR',
      check_out: outDate ? outDate.toISOString() : null,
      check_out_ip: outDate ? 'MANUAL_ENTRY_BY_SIR' : null,
      status: late.status,
      late_minutes: late.lateMinutes,
      slabs: late.slabs,
      auto_fine: late.fine,
      is_early_checkout: ev.isEarly,
      early_minutes: ev.earlyMinutes,
      adjusted_fine: hasFine ? Number(fine) : null
    };
  }
  record.fine_note = String(note || '').trim() ? `Added by admin: ${String(note).trim()}` : 'Added by admin';
  const saved = db.recordAttendance(record);
  push.employee(emp, { kind: 'info', title: `Admin updated your attendance for ${prettyDate(date)}`, body: record.fine_note, url: '/#history' });
  res.json({ success: true, message: 'Attendance saved.', record: saved });
});

router.delete('/attendance/:id', (req, res) => {
  db.deleteAttendance(req.params.id);
  res.json({ success: true, message: 'Record removed.' });
});

// ---------- Employees ----------
router.get('/employees', (req, res) => {
  const ctx = E.buildContext();
  const month = E.monthBounds(ctx.todayKey);
  const employees = db.getEmployees().map(emp => {
    const r = E.employeeRange(emp, month.from, ctx.todayKey, ctx);
    return { ...E.publicEmployee(emp), today: E.resolveDay(emp, ctx.todayKey, ctx), month: r.summary, last_login_at: emp.last_login_at || null };
  });
  res.json({ success: true, employees });
});

router.get('/employees/:id/profile', (req, res) => {
  const emp = db.getEmployeeById(req.params.id);
  if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
  const ctx = E.buildContext();
  const monthKey = /^\d{4}-\d{2}$/.test(req.query.month || '') ? `${req.query.month}-01` : ctx.todayKey;
  const { from, to } = E.monthBounds(monthKey);
  const r = E.employeeRange(emp, from, to, ctx);
  const requests = ctx.leaves.filter(l => l.employee_id === emp.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);
  res.json({ success: true, employee: { ...E.publicEmployee(emp), last_login_at: emp.last_login_at || null }, from, to, ...r, streak: E.onTimeStreak(emp, ctx), requests });
});

router.post('/employees/add', (req, res) => {
  const { code, name, designation, department, phone, pin, joined_on } = req.body;
  if (!code || !name) return res.status(400).json({ success: false, message: 'Code and name are required.' });
  if (pin && !/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ success: false, message: 'PIN must be 4 to 6 digits.' });
  try {
    const emp = db.addEmployee({ code, name, designation, department, phone, pin: pin || '1234', joined_on: isDate(joined_on) ? joined_on : E.dateKey() });
    db.addNotification({ employee_id: emp.id, kind: 'good', title: `Welcome, ${emp.name.split(' ')[0]}!`, body: 'Check in every morning on the office WiFi. You can change your PIN in Profile.' });
    res.json({ success: true, message: `${emp.name} was added.`, employee: E.publicEmployee(emp) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put('/employees/:id', (req, res) => {
  const { name, designation, department, phone, pin, status, joined_on, avatar_color } = req.body;
  if (pin && !/^\d{4,6}$/.test(String(pin))) return res.status(400).json({ success: false, message: 'PIN must be 4 to 6 digits.' });
  try {
    const current = db.getEmployeeById(req.params.id);
    if (!current) throw new Error('Employee not found.');
    const updated = db.updateEmployee(req.params.id, {
      ...(name && { name: String(name).trim() }),
      ...(designation !== undefined && { designation: String(designation).trim() }),
      ...(department !== undefined && { department: String(department).trim() }),
      ...(phone !== undefined && { phone: String(phone).trim() }),
      ...(isDate(joined_on) && { joined_on }),
      ...(avatar_color && /^#[0-9a-f]{6}$/i.test(avatar_color) && { avatar_color }),
      ...(pin && { pin: String(pin).trim(), session_version: (current.session_version || 0) + 1 }),
      ...((status === 'active' || status === 'inactive') && { status })
    });
    res.json({ success: true, message: 'Saved.', employee: E.publicEmployee(updated) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/employees/:id/reset-device', (req, res) => {
  const emp = db.getEmployeeById(req.params.id);
  if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
  db.updateEmployee(emp.id, { device_id: null, session_version: (emp.session_version || 0) + 1 });
  res.json({ success: true, message: `${emp.name} can now sign in on a new phone.` });
});

router.delete('/employees/:id', (req, res) => {
  db.deleteEmployee(req.params.id);
  db.removePushSubsFor(String(req.params.id).toUpperCase());
  res.json({ success: true, message: 'Employee deleted.' });
});

// ---------- Reports (daily / weekly / monthly / any range) ----------
router.get('/reports', (req, res) => {
  const today = E.dateKey();
  let from = isDate(req.query.from) ? req.query.from : E.monthBounds(today).from;
  let to = isDate(req.query.to) ? req.query.to : E.monthBounds(today).to;
  if (to < from) [from, to] = [to, from];
  if (E.eachDay(from, to).length > 62) return res.status(400).json({ success: false, message: 'A report can cover at most 62 days.' });
  const data = E.buildReport(from, to);
  // A full calendar month also shows how much of each person's fine is paid.
  const mb = E.monthBounds(from);
  if (from === mb.from && to === mb.to) {
    const month = from.slice(0, 7);
    data.month = month;
    for (const r of data.rows) {
      r.summary.paid = db.paidFor(r.employee.id, month);
      r.summary.due = Math.max(0, r.summary.finalFine - r.summary.paid);
    }
    data.totals.paid = data.rows.reduce((s, r) => s + r.summary.paid, 0);
    data.totals.due = data.rows.reduce((s, r) => s + r.summary.due, 0);
  }
  res.json({ success: true, data });
});

router.get('/reports/monthly', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year, 10) || now.getFullYear();
  const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
  res.json({ success: true, data: E.generateMonthlyReport(year, month) });
});

// ---------- Requests (leaves & excuses) ----------
router.get('/leaves', (req, res) => {
  const employees = new Map(db.getEmployees().map(e => [e.id, e]));
  const leaves = db.getLeaves()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(l => ({ ...l, avatar_color: employees.get(l.employee_id)?.avatar_color || '#6b7280' }));
  res.json({ success: true, leaves });
});

router.post('/leaves/review', (req, res) => {
  const { leave_id, status, fine_applied, admin_note, day_fine } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ success: false, message: 'Choose approve or reject.' });
  try {
    const leave = db.updateLeave(leave_id, {
      status,
      fine_applied: Number(fine_applied || 0),
      admin_note: String(admin_note || '').trim(),
      reviewed_at: new Date().toISOString()
    });

    // For an excuse Sir can set that day's fine in the same step.
    if (leave.kind === 'excuse' && day_fine !== undefined && day_fine !== null && day_fine !== '') {
      const att = db.getAttendanceByEmployeeAndDate(leave.employee_id, leave.date);
      if (att) db.recordAttendance({ ...att, adjusted_fine: Number(day_fine), fine_note: leave.admin_note || `Reason ${status === 'APPROVED' ? 'accepted' : 'not accepted'}, fine Rs ${Number(day_fine)}`, fine_adjusted_at: new Date().toISOString() });
    }

    const range = leave.end_date && leave.end_date !== leave.date ? `${prettyDate(leave.date)} – ${prettyDate(leave.end_date)}` : prettyDate(leave.date);
    push.employee(db.getEmployeeById(leave.employee_id), {
      kind: status === 'APPROVED' ? 'good' : 'warn',
      title: `${leave.type} (${range}) ${status === 'APPROVED' ? 'approved' : 'rejected'}`,
      body: leave.admin_note || '',
      url: '/#requests'
    });
    res.json({ success: true, message: status === 'APPROVED' ? 'Approved.' : 'Rejected.', leave });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ---------- Announcements ----------
router.get('/announcements', (req, res) => {
  const list = db.getNotifications().filter(n => n.employee_id === 'all').sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json({ success: true, announcements: list });
});

router.post('/announcements', (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 140);
  const body = String(req.body.body || '').trim().slice(0, 600);
  if (!title) return res.status(400).json({ success: false, message: 'Write a title for the announcement.' });
  const n = db.addNotification({ employee_id: 'all', kind: 'announcement', title, body });
  push.everyone({ title, body, url: '/#home', tag: `ann-${n.id}` });
  res.json({ success: true, message: 'Sent to everyone.', announcement: n });
});

router.delete('/announcements/:id', (req, res) => {
  db.deleteNotification(req.params.id);
  res.json({ success: true, message: 'Announcement removed.' });
});

// ---------- Settings ----------
router.get('/settings', (req, res) => {
  const s = db.getSettings();
  res.json({
    success: true,
    settings: {
      office_name: s.office_name,
      office_ips: s.office_ips,
      office_start_time: s.office_start_time,
      grace_minutes: s.grace_minutes,
      fine_per_hour: s.fine_per_hour,
      office_end_time: s.office_end_time,
      missed_checkout_fine: s.missed_checkout_fine,
      absent_fine: s.absent_fine,
      enforce_ip_attendance: s.enforce_ip_attendance,
      enforce_ip_admin: s.enforce_ip_admin,
      weekly_off_days: s.weekly_off_days,
      holidays: [...(s.holidays || [])].sort((a, b) => a.date.localeCompare(b.date)),
      bind_device: s.bind_device,
      admin_username: s.admin_username,
      push_admin: s.push_admin,
      push_employee: s.push_employee
    },
    currentAdminIP: E.getClientIP(req),
    // On a live server the admin's IP should never look local. If it does, Nginx isn't passing the real IP.
    ipLooksWrong: process.env.NODE_ENV === 'production' && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(E.getClientIP(req))
  });
});

router.put('/settings', (req, res) => {
  const b = req.body;
  let ips = null;
  if (Array.isArray(b.office_ips)) ips = b.office_ips;
  else if (typeof b.office_ips === 'string') ips = b.office_ips.split(/[\n,]/);
  if (ips) ips = ips.map(ip => String(ip).trim()).filter(Boolean);

  const num = v => (v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Math.max(0, Number(v)));
  const holidays = Array.isArray(b.holidays)
    ? b.holidays.filter(h => h && isDate(h.date)).map(h => ({ date: h.date, name: String(h.name || 'Holiday').trim().slice(0, 60) }))
    : undefined;
  const offDays = Array.isArray(b.weekly_off_days) ? [...new Set(b.weekly_off_days.map(Number).filter(n => n >= 0 && n <= 6))] : undefined;

  const current = db.getSettings();
  const finalIps = ips || current.office_ips;
  const lockOn = b.enforce_ip_attendance !== undefined ? !!b.enforce_ip_attendance : current.enforce_ip_attendance;
  const adminLockOn = b.enforce_ip_admin !== undefined ? !!b.enforce_ip_admin : current.enforce_ip_admin;
  if ((lockOn || adminLockOn) && finalIps.length === 0) {
    return res.status(400).json({ success: false, message: 'Add at least one office IP before turning on the WiFi lock.' });
  }
  if (ips && ips.some(ip => ip.length > 60 || !/^[0-9a-fA-F:.*\/]+$/.test(ip))) {
    return res.status(400).json({ success: false, message: 'One of the office IPs is not valid.' });
  }

  const updated = db.updateSettings(curr => {
    const next = { ...curr };
    if (b.office_name) next.office_name = String(b.office_name).trim().slice(0, 80);
    if (ips) next.office_ips = ips;
    if (isTime(b.office_start_time)) next.office_start_time = b.office_start_time;
    if (isTime(b.office_end_time)) next.office_end_time = b.office_end_time;
    for (const k of ['grace_minutes', 'fine_per_hour', 'missed_checkout_fine', 'absent_fine']) {
      const v = num(b[k]);
      if (v !== undefined) next[k] = v;
    }
    for (const k of ['enforce_ip_attendance', 'enforce_ip_admin', 'bind_device']) {
      if (b[k] !== undefined) next[k] = Boolean(b[k]);
    }
    for (const group of ['push_admin', 'push_employee']) {
      if (b[group] && typeof b[group] === 'object') {
        next[group] = { ...curr[group] };
        for (const k of Object.keys(curr[group])) if (b[group][k] !== undefined) next[group][k] = Boolean(b[group][k]);
      }
    }
    if (holidays) next.holidays = holidays;
    if (offDays) next.weekly_off_days = offDays;
    return next;
  });

  res.json({ success: true, message: 'Settings saved.', settings: { ...updated, admin_password_hash: undefined, admin_password_salt: undefined } });
});

router.post('/settings/change-password', (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ success: false, message: 'Enter both passwords.' });
  if (String(new_password).length < 8) return res.status(400).json({ success: false, message: 'The new password must be at least 8 characters.' });
  if (String(new_password).length > 200) return res.status(400).json({ success: false, message: 'The new password is too long.' });
  const s = db.getSettings();
  if (!db.verifyPassword(current_password, s.admin_password_hash, s.admin_password_salt)) {
    return res.status(401).json({ success: false, message: 'Your current password is wrong.' });
  }
  const updated = db.setAdminPassword(String(new_password));
  // Sign out every other device, keep this one signed in.
  const token = startSession(req, res, 'admin_token', { role: 'admin', username: updated.admin_username, v: updated.admin_session_version });
  res.json({ success: true, message: 'Password changed. Other devices were signed out.', token });
});

// ---------- Fine payments ----------
// Fine, paid and due for every employee for one month.
router.get('/fines', (req, res) => {
  const ctx = E.buildContext();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : ctx.todayKey.slice(0, 7);
  const { from, to } = E.monthBounds(`${month}-01`);
  const end = to < ctx.todayKey ? to : ctx.todayKey;
  const payments = db.getPayments();
  const rows = db.getEmployees()
    .filter(e => e.status === 'active' || payments.some(p => p.employee_id === e.id && p.month === month))
    .map(emp => {
      const fine = from > ctx.todayKey ? 0 : E.employeeRange(emp, from, end, ctx).summary.finalFine;
      const paid = payments.filter(p => p.employee_id === emp.id && p.month === month).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      return { employee: E.publicEmployee(emp), fine, paid, due: Math.max(0, fine - paid), totalDue: E.fineBalance(emp, ctx).totalDue };
    })
    .sort((a, b) => b.due - a.due || a.employee.name.localeCompare(b.employee.name));
  const totals = rows.reduce((t, r) => ({ fine: t.fine + r.fine, paid: t.paid + r.paid, due: t.due + r.due }), { fine: 0, paid: 0, due: 0 });
  res.json({ success: true, month, rows, totals, payments: payments.filter(p => p.month === month).sort((a, b) => b.paid_at.localeCompare(a.paid_at)) });
});

router.get('/employees/:id/fines', (req, res) => {
  const emp = db.getEmployeeById(req.params.id);
  if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
  res.json({ success: true, employee: E.publicEmployee(emp), ...E.fineBalance(emp) });
});

router.post('/payments', (req, res) => {
  const emp = db.getEmployeeById(req.body.employee_id);
  if (!emp) return res.status(404).json({ success: false, message: 'Employee not found.' });
  const month = String(req.body.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ success: false, message: 'Pick a month.' });
  const amount = Math.round(Number(req.body.amount));
  if (!amount || amount < 0) return res.status(400).json({ success: false, message: 'Enter the amount paid.' });
  const note = String(req.body.note || '').trim().slice(0, 200);
  const p = db.addPayment({ employee_id: emp.id, employee_name: emp.name, month, amount, note });
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  push.employee(emp, { kind: 'good', title: `Fine payment received: Rs ${amount}`, body: `For ${monthLabel}.${note ? ` ${note}` : ''}`, url: '/#profile' });
  res.json({ success: true, message: `Rs ${amount} marked as paid.`, payment: p });
});

router.delete('/payments/:id', (req, res) => {
  const p = db.deletePayment(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: 'Payment not found.' });
  res.json({ success: true, message: 'Payment removed.' });
});

// ---------- Push notifications for the admin ----------
router.post('/push/subscribe', (req, res) => {
  const sub = req.body.subscription;
  if (!push.isValidSubscription(sub)) return res.status(400).json({ success: false, message: 'Notifications could not be turned on on this device.' });
  db.savePushSub({ owner: 'admin', subscription: sub, ua: req.headers['user-agent'] });
  res.json({ success: true, message: 'Notifications are on for this device.' });
});

router.post('/push/unsubscribe', (req, res) => {
  if (req.body.endpoint) db.removePushSub(String(req.body.endpoint));
  res.json({ success: true, message: 'Notifications are off for this device.' });
});

router.get('/push/devices', (req, res) => {
  const subs = db.getPushSubs();
  const devices = subs.filter(s => s.owner === 'admin').map(s => ({ endpoint: s.endpoint, ua: s.ua, created_at: s.created_at }));
  const employeesOn = new Set(subs.filter(s => s.owner !== 'admin').map(s => s.owner)).size;
  res.json({ success: true, devices, employeesOn });
});

router.post('/push/test', async (req, res) => {
  const sent = await push.sendTo('admin', { title: 'Test notification', body: 'Notifications are working on this device.', url: '/admin', tag: 'test' });
  if (!sent) return res.status(400).json({ success: false, message: 'No device has notifications turned on yet.' });
  res.json({ success: true, message: `Sent to ${sent} device${sent === 1 ? '' : 's'}.` });
});


module.exports = router;
