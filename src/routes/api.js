const express = require('express');
const router = express.Router();
const db = require('../db');
const E = require('../attendanceEngine');
const push = require('../push');
const { startSession, requireEmployee, requireOfficeIP, loginGuard, loginFailed, loginSucceeded } = require('../auth');

const LEAVE_TYPES = ['Sick leave', 'Casual leave', 'Annual leave', 'Field work', 'Emergency'];
const EXCUSE_TYPES = ['Late arrival', 'Missed check-out', 'Early check-out', 'Other'];
const prettyDate = key => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const first = name => String(name || '').split(' ')[0];
const DUMMY = db.hashPassword('not-a-real-pin');

function timings(settings) {
  return {
    startTime: settings.office_start_time,
    endTime: settings.office_end_time,
    finePerHour: Number(settings.fine_per_hour) || 0,
    graceMinutes: Number(settings.grace_minutes) || 0,
    missedCheckoutFine: Number(settings.missed_checkout_fine) || 0,
    absentFine: Number(settings.absent_fine) || 0,
    weeklyOffDays: settings.weekly_off_days
  };
}

function wifiState(req, settings) {
  const clientIP = E.getClientIP(req);
  const onOffice = E.isAllowedOfficeIP(clientIP, E.officeIPs(settings));
  return { clientIP, isOfficeWifi: onOffice, ipEnforced: !!settings.enforce_ip_attendance, canMark: !settings.enforce_ip_attendance || onOffice };
}

// ---------- Public status (sign-in screen) ----------
router.get('/status', (req, res) => {
  const settings = db.getSettings();
  res.json({
    success: true,
    serverTime: new Date().toISOString(),
    officeName: settings.office_name,
    ...wifiState(req, settings),
    timings: timings(settings)
  });
});

router.get('/push/key', (req, res) => res.json({ success: true, publicKey: push.publicKey() }));

// ---------- Automatic office link ----------
// An office PC or the router opens this URL every few minutes. Whatever public IP it
// comes from is saved as an office IP, so a changing office IP never breaks check-in.
function officeLink(req, res) {
  const key = String(req.query.key || '');
  const saved = db.getSettings().office_link_key || '';
  const a = Buffer.from(key);
  const b = Buffer.from(saved);
  if (!saved || a.length !== b.length || !require('crypto').timingSafeEqual(a, b)) {
    return res.status(403).type('text/plain').send('Wrong or old link. Copy the link again from Settings.');
  }
  const ip = E.getClientIP(req);
  const network = E.officeNetworkFor(ip);
  db.recordAutoOfficeIP(network);
  res.type('text/plain').send(`OK, office network saved: ${network}`);
}
router.get('/office-ip', officeLink);
router.post('/office-ip', officeLink);

// ---------- Employee sign in ----------
router.post('/login', (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 40);
  const pin = String(req.body.pin || '').trim().slice(0, 20);
  const deviceId = String(req.body.device_id || '').slice(0, 80);
  if (!code || !pin) return res.status(400).json({ success: false, message: 'Enter your employee code and PIN.' });

  const ip = E.getClientIP(req);
  const locked = loginGuard(`emp:${code}`, ip);
  if (locked) return res.status(429).json({ success: false, message: locked });

  const emp = db.getEmployeeById(code);
  // Same work whether or not the code exists, so timing doesn't reveal valid codes.
  const pinOk = emp ? db.verifyPin(emp, pin) : (db.verifyPassword(pin, DUMMY.hash, DUMMY.salt), false);
  if (!emp || emp.status !== 'active' || !pinOk) {
    const left = loginFailed(`emp:${code}`, ip);
    return res.status(401).json({ success: false, message: left > 0 ? `Wrong code or PIN. ${left} tr${left === 1 ? 'y' : 'ies'} left.` : 'Wrong code or PIN.' });
  }

  const settings = db.getSettings();
  if (settings.bind_device && deviceId) {
    if (emp.device_id && emp.device_id !== deviceId) {
      push.admin('device_blocked', {
        title: 'Sign-in blocked on a new phone',
        body: `${emp.name} tried to sign in on another phone. Reset their phone in Team if they changed it.`,
        url: '/admin#team', tag: `device-${emp.id}`
      });
      return res.status(403).json({ success: false, message: 'This account is linked to another phone. Ask the admin to reset your phone.' });
    }
    if (!emp.device_id) db.updateEmployee(emp.id, { device_id: deviceId });
  }

  loginSucceeded(`emp:${code}`, ip);
  // Upgrade old, weaker PIN hashes on a successful sign-in.
  db.updateEmployee(emp.id, { last_login_at: new Date().toISOString(), ...(db.isOldHash(emp.pin_salt) && { pin }) });
  const token = startSession(req, res, 'emp_token', { role: 'employee', sub: emp.id, v: emp.session_version || 0 });
  res.json({ success: true, token, employee: E.publicEmployee(emp) });
});

router.post('/logout', (req, res) => {
  res.clearCookie('emp_token');
  if (req.body && req.body.endpoint) db.removePushSub(String(req.body.endpoint));
  res.json({ success: true });
});

// Everything below needs a signed-in employee.
router.use('/me', requireEmployee);

function arrivalRank(emp, todayKey) {
  const today = db.getAttendanceByDate(todayKey).filter(a => a.check_in).sort((a, b) => new Date(a.check_in) - new Date(b.check_in));
  const idx = today.findIndex(a => a.employee_id === emp.id || a.employee_code === emp.code);
  return idx === -1 ? null : { position: idx + 1, of: today.length };
}

function notificationsFor(emp) {
  const all = db.getNotifications()
    .filter(n => n.employee_id === emp.id || n.employee_id === 'all')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const seen = emp.notifications_seen_at || '';
  return { list: all.slice(0, 40), unread: all.filter(n => n.created_at > seen).length };
}

// ---------- Personal dashboard ----------
router.get('/me', (req, res) => {
  const emp = req.employee;
  const settings = db.getSettings();
  const now = new Date();
  const ctx = E.buildContext(now);
  const today = E.resolveDay(emp, ctx.todayKey, ctx);

  const month = E.monthBounds(ctx.todayKey);
  const monthSoFar = E.employeeRange(emp, month.from, ctx.todayKey, ctx);
  const streak = E.onTimeStreak(emp, ctx);
  const recent = E.employeeRange(emp, E.addDays(ctx.todayKey, -13), ctx.todayKey, ctx).days.reverse();
  const notes = notificationsFor(emp);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const announcement = notes.list.find(n => n.employee_id === 'all' && n.kind === 'announcement' && n.created_at > weekAgo) || null;
  const pendingRequests = ctx.leaves.filter(l => l.employee_id === emp.id && l.status === 'PENDING').length;
  const nextHoliday = (settings.holidays || []).filter(h => h.date > ctx.todayKey).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  const balance = E.fineBalance(emp, ctx);

  res.json({
    success: true,
    serverTime: now.toISOString(),
    officeName: settings.office_name,
    employee: E.publicEmployee(emp),
    wifi: wifiState(req, settings),
    timings: timings(settings),
    today,
    preview: E.finePreview(now, settings),
    arrival: arrivalRank(emp, ctx.todayKey),
    month: { ...monthSoFar.summary, paid: db.paidFor(emp.id, ctx.todayKey.slice(0, 7)) },
    fines: { totalDue: balance.totalDue, totalPaid: balance.totalPaid, months: balance.months.slice(0, 6) },
    streak,
    insights: E.employeeInsights(emp, ctx, monthSoFar.summary, streak),
    recent,
    unread: notes.unread,
    announcement,
    pendingRequests,
    nextHoliday,
    pushOn: db.getPushSubs().some(s => s.owner === emp.id)
  });
});

router.get('/me/history', (req, res) => {
  const emp = req.employee;
  const ctx = E.buildContext();
  const monthKey = /^\d{4}-\d{2}$/.test(req.query.month || '') ? `${req.query.month}-01` : ctx.todayKey;
  const { from, to } = E.monthBounds(monthKey);
  const r = E.employeeRange(emp, from, to, ctx);
  res.json({ success: true, from, to, ...r, paid: db.paidFor(emp.id, from.slice(0, 7)) });
});

// ---------- Check in / out ----------
router.post('/me/check-in', requireOfficeIP, (req, res) => {
  const emp = req.employee;
  const now = new Date();
  const todayKey = E.dateKey(now);
  const existing = db.getAttendanceByEmployeeAndDate(emp.id, todayKey);
  if (existing && existing.check_in) {
    return res.status(400).json({ success: false, message: `You already checked in today at ${E.format12(new Date(existing.check_in).toTimeString().slice(0, 5))}.` });
  }

  const settings = db.getSettings();
  const late = E.calculateLateFine(now, settings);
  const note = String(req.body.note || '').trim().slice(0, 300) || null;

  const record = db.recordAttendance({
    ...(existing || {}),
    id: `att_${todayKey}_${emp.code}`,
    date: todayKey,
    employee_id: emp.id,
    employee_code: emp.code,
    employee_name: emp.name,
    check_in: now.toISOString(),
    check_in_ip: req.clientIP,
    check_out: null,
    check_out_ip: null,
    status: late.status,
    late_minutes: late.lateMinutes,
    slabs: late.slabs,
    auto_fine: late.fine,
    adjusted_fine: existing ? existing.adjusted_fine ?? null : null,
    fine_note: existing ? existing.fine_note || null : null,
    employee_note: note
  });

  const time = E.format12(now.toTimeString().slice(0, 5));
  if (late.isLate) {
    push.admin('late_checkin', {
      title: `${emp.name} is ${late.lateMinutes} min late`,
      body: `Checked in at ${time}. Fine Rs ${late.fine}.${note ? ` Reason: ${note}` : ''}`,
      url: '/admin#attendance', tag: `late-${emp.id}`
    });
  } else {
    push.admin('every_checkin', { title: `${emp.name} checked in`, body: `On time at ${time}.`, url: '/admin#attendance', tag: `in-${emp.id}` });
  }

  res.json({
    success: true,
    late: late.isLate,
    message: late.isLate ? `Checked in at ${time}. You are ${late.lateMinutes} min late (Rs ${late.fine} fine).` : `Checked in at ${time}. You are on time.`,
    record,
    arrival: arrivalRank(emp, todayKey)
  });
});

router.post('/me/check-out', requireOfficeIP, (req, res) => {
  const emp = req.employee;
  const now = new Date();
  const todayKey = E.dateKey(now);
  const existing = db.getAttendanceByEmployeeAndDate(emp.id, todayKey);
  if (!existing || !existing.check_in) return res.status(400).json({ success: false, message: 'You have not checked in today. Check in first.' });
  if (existing.check_out) return res.status(400).json({ success: false, message: 'You already checked out today.' });

  const settings = db.getSettings();
  const ev = E.evaluateCheckout(now, settings);
  const note = String(req.body.note || '').trim().slice(0, 300);
  const record = db.recordAttendance({
    ...existing,
    check_out: now.toISOString(),
    check_out_ip: req.clientIP,
    is_early_checkout: ev.isEarly,
    early_minutes: ev.earlyMinutes,
    ...(note && { checkout_note: note })
  });
  const hours = (now - new Date(existing.check_in)) / 3600000;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (ev.isEarly) {
    push.admin('early_checkout', {
      title: `${emp.name} left ${ev.earlyMinutes} min early`,
      body: `Checked out at ${E.format12(now.toTimeString().slice(0, 5))}.${note ? ` Reason: ${note}` : ''}`,
      url: '/admin#attendance', tag: `early-${emp.id}`
    });
  }
  res.json({
    success: true,
    message: ev.isEarly ? `Checked out ${ev.earlyMinutes} min early. You worked ${h}h ${m}m today.` : `Checked out. You worked ${h}h ${m}m today. See you tomorrow!`,
    record
  });
});

// ---------- Requests (leave / excuse) ----------
router.get('/me/requests', (req, res) => {
  const list = db.getLeaves().filter(l => l.employee_id === req.employee.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json({ success: true, requests: list, leaveTypes: LEAVE_TYPES, excuseTypes: EXCUSE_TYPES });
});

router.post('/me/requests', (req, res) => {
  const emp = req.employee;
  const kind = req.body.kind === 'excuse' ? 'excuse' : 'leave';
  const allowed = kind === 'leave' ? LEAVE_TYPES : EXCUSE_TYPES;
  const type = allowed.includes(String(req.body.type || '').trim()) ? String(req.body.type).trim() : allowed[0];
  const reason = String(req.body.reason || '').trim().slice(0, 600);
  const date = String(req.body.date || '').trim() || E.dateKey();
  let endDate = kind === 'leave' ? String(req.body.end_date || '').trim() || date : date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return res.status(400).json({ success: false, message: 'Pick a valid date.' });
  if (endDate < date) endDate = date;
  if (E.eachDay(date, endDate).length > 31) return res.status(400).json({ success: false, message: 'One request can cover at most 31 days.' });
  if (reason.length < 3) return res.status(400).json({ success: false, message: 'Please write a short reason.' });
  const pendingCount = db.getLeaves().filter(l => l.employee_id === emp.id && l.status === 'PENDING').length;
  if (pendingCount >= 10) return res.status(429).json({ success: false, message: 'You already have 10 requests waiting. Wait for the admin to reply first.' });

  const leave = db.addLeave({ employee_id: emp.id, employee_code: emp.code, employee_name: emp.name, kind, type, date, end_date: endDate, reason, fine_applied: 0, status: 'PENDING' });

  // Attach an excuse to that day's attendance so the admin sees it next to the fine.
  if (kind === 'excuse') {
    const att = db.getAttendanceByEmployeeAndDate(emp.id, date);
    if (att) db.recordAttendance({ ...att, employee_note: reason });
  }

  const range = endDate !== date ? `${prettyDate(date)} – ${prettyDate(endDate)}` : prettyDate(date);
  push.admin('leave_request', {
    title: kind === 'leave' ? `${emp.name} asked for leave` : `${first(emp.name)} sent a reason`,
    body: `${type}, ${range}: ${reason}`,
    url: '/admin#requests', tag: `req-${leave.id}`, urgency: 'high'
  });
  res.json({ success: true, message: 'Request sent to the admin.', request: leave });
});

router.delete('/me/requests/:id', (req, res) => {
  const leave = db.getLeaves().find(l => l.id === req.params.id && l.employee_id === req.employee.id);
  if (!leave) return res.status(404).json({ success: false, message: 'Request not found.' });
  if (leave.status !== 'PENDING') return res.status(400).json({ success: false, message: 'This request has already been decided.' });
  db.deleteLeave(leave.id);
  res.json({ success: true, message: 'Request cancelled.' });
});

// ---------- Notifications ----------
router.get('/me/notifications', (req, res) => {
  const n = notificationsFor(req.employee);
  res.json({ success: true, notifications: n.list, unread: n.unread, seenAt: req.employee.notifications_seen_at || null });
});

router.post('/me/notifications/seen', (req, res) => {
  db.updateEmployee(req.employee.id, { notifications_seen_at: new Date().toISOString() });
  res.json({ success: true });
});

router.post('/me/push/subscribe', (req, res) => {
  const sub = req.body.subscription;
  if (!push.isValidSubscription(sub)) return res.status(400).json({ success: false, message: 'Notifications could not be turned on on this phone.' });
  db.savePushSub({ owner: req.employee.id, subscription: sub, ua: req.headers['user-agent'] });
  res.json({ success: true, message: 'Notifications are on.' });
});

router.post('/me/push/unsubscribe', (req, res) => {
  if (req.body.endpoint) db.removePushSub(String(req.body.endpoint));
  res.json({ success: true, message: 'Notifications are off on this phone.' });
});

// ---------- Profile ----------
router.post('/me/pin', (req, res) => {
  const emp = req.employee;
  const current = String(req.body.current_pin || '');
  const next = String(req.body.new_pin || '');
  if (!db.verifyPin(emp, current)) return res.status(401).json({ success: false, message: 'Your current PIN is wrong.' });
  if (!/^\d{4,6}$/.test(next)) return res.status(400).json({ success: false, message: 'The new PIN must be 4 to 6 digits.' });
  const updated = db.updateEmployee(emp.id, { pin: next, session_version: (emp.session_version || 0) + 1 });
  const token = startSession(req, res, 'emp_token', { role: 'employee', sub: emp.id, v: updated.session_version });
  res.json({ success: true, message: 'PIN changed. Other phones were signed out.', token });
});

module.exports = router;
