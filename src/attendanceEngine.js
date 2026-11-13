const db = require('./db');

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------
// Express's req.ip honours the "trust proxy" setting in server.js, so a client
// cannot fake their IP with an X-Forwarded-For header. Behind Cloudflare, set
// IP_HEADER=cf-connecting-ip so the real visitor IP is read from that header.
function getClientIP(req) {
  let ip = '';
  const header = (process.env.IP_HEADER || '').toLowerCase();
  if (header && req.headers[header]) {
    ip = String(req.headers[header]).split(',')[0];
  } else {
    ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
  }
  ip = ip.trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function isAllowedOfficeIP(clientIP, officeIPs) {
  if (!clientIP) return false;
  // Fail closed: no office IPs means no one is on the office WiFi.
  if (!Array.isArray(officeIPs) || officeIPs.length === 0) return false;

  const client = clientIP.trim().toLowerCase();
  const isLocal = v => v === '127.0.0.1' || v === '::1' || v === 'localhost';

  for (const raw of officeIPs) {
    const allowed = String(raw).trim().toLowerCase().replace(/^::ffff:/, '');
    if (!allowed) continue;
    if (client === allowed) return true;
    if (isLocal(client) && isLocal(allowed)) return true;
    if (allowed.endsWith('*') && client.startsWith(allowed.slice(0, -1))) return true;
    if (ipInCIDR(client, allowed)) return true; // CIDR ranges, and exact matches in any IPv6 spelling
  }
  return false;
}

// IPv4 or IPv6 address -> { v: 4|6, n: BigInt } (null if not an address).
function parseIP(ip) {
  ip = String(ip || '').trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some(p => p > 255)) return null;
    return { v: 4, n: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n) };
  }
  if (!ip.includes(':') || !/^[0-9a-f:]+$/.test(ip)) return null;
  const [head, tail = null] = ip.split('::');
  if (ip.split('::').length > 2) return null;
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const missing = 8 - h.length - t.length;
  if (tail === null ? h.length !== 8 : missing < 1) return null;
  const groups = [...h, ...Array(tail === null ? 0 : missing).fill('0'), ...t];
  if (groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return { v: 6, n: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n) };
}

function ipInCIDR(ip, cidr) {
  const [range, bitsStr] = String(cidr).split('/');
  const a = parseIP(ip);
  const r = parseIP(range);
  if (!a || !r || a.v !== r.v) return false;
  const size = a.v === 4 ? 32 : 128;
  const bits = bitsStr === undefined ? size : Number(bitsStr);
  if (!(bits >= 0 && bits <= size)) return false;
  const shift = BigInt(size - bits);
  return (a.n >> shift) === (r.n >> shift);
}

// What to save for "Add my IP". IPv6 addresses change every few hours on phones,
// so for IPv6 we save the office's whole network (/64) instead of one address.
function officeNetworkFor(ip) {
  const p = parseIP(ip);
  if (!p) return ip;
  if (p.v === 4) return String(ip).replace(/^::ffff:/, '');
  const prefix = p.n >> 64n;
  const groups = [];
  for (let i = 3; i >= 0; i--) groups.push(((prefix >> BigInt(i * 16)) & 0xffffn).toString(16));
  return `${groups.join(':')}::/64`;
}

// All office IPs: the ones the admin added plus the ones reported by the automatic
// office link in the last 3 days (for internet connections whose IP keeps changing).
function officeIPs(settings) {
  const cutoff = Date.now() - 3 * 86400000;
  const auto = (settings.auto_office_ips || []).filter(a => new Date(a.seen_at).getTime() > cutoff).map(a => a.ip);
  return [...(settings.office_ips || []), ...auto];
}

// ---------------------------------------------------------------------------
// Time helpers (server runs in the office timezone — see server.js)
// ---------------------------------------------------------------------------
function parseTimeToMinutes(timeStr) {
  const [h, m] = String(timeStr || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
}

function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, n) {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

function eachDay(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}

// ---------------------------------------------------------------------------
// Fine rules
// ---------------------------------------------------------------------------
// Up to 09:30:59 is on time. 09:31 = Rs 100, and every further started hour adds Rs 100:
// 09:31–10:30 → 100, 10:31–11:30 → 200, 11:31–12:30 → 300 …
function calculateLateFine(checkInDate, settings) {
  const finePerHour = Number(settings.fine_per_hour) || 100;
  const graceMinutes = Number(settings.grace_minutes) || 0;
  const startMinutes = parseTimeToMinutes(settings.office_start_time || '09:30') + graceMinutes;

  const lateMinutes = minutesOfDay(checkInDate) - startMinutes;
  if (lateMinutes <= 0) {
    return { isLate: false, lateMinutes: 0, slabs: 0, fine: 0, status: 'PRESENT' };
  }
  const slabs = Math.ceil(lateMinutes / 60);
  return { isLate: true, lateMinutes, slabs, fine: slabs * finePerHour, status: 'LATE' };
}

// What would the fine be if the employee checked in right now — and when does it go up next?
function finePreview(now, settings) {
  const current = calculateLateFine(now, settings);
  const startMinutes = parseTimeToMinutes(settings.office_start_time || '09:30') + (Number(settings.grace_minutes) || 0);
  const nowMin = minutesOfDay(now);
  let nextChangeAt;
  if (!current.isLate) nextChangeAt = startMinutes + 1;
  else nextChangeAt = startMinutes + current.slabs * 60 + 1;
  return {
    fineNow: current.fine,
    lateMinutes: current.lateMinutes,
    minutesToStart: Math.max(0, startMinutes - nowMin),
    nextFine: (current.slabs + 1) * (Number(settings.fine_per_hour) || 100),
    minutesToNextFine: Math.max(0, nextChangeAt - nowMin)
  };
}

function evaluateCheckout(checkOutDate, settings) {
  const diff = minutesOfDay(checkOutDate) - parseTimeToMinutes(settings.office_end_time || '17:00');
  if (diff < 0) return { isEarly: true, earlyMinutes: Math.abs(diff), status: 'EARLY_CHECKOUT' };
  return { isEarly: false, earlyMinutes: 0, status: 'NORMAL_CHECKOUT' };
}

// ---------------------------------------------------------------------------
// Day resolution — the single source of truth for "what happened on this day"
// ---------------------------------------------------------------------------
function buildContext(now = new Date()) {
  const settings = db.getSettings();
  const attIndex = new Map();
  for (const a of db.getAttendance()) {
    attIndex.set(`${a.employee_id}|${a.date}`, a);
    if (a.employee_code && a.employee_code !== a.employee_id) attIndex.set(`${a.employee_code}|${a.date}`, a);
  }
  const holidays = new Map((settings.holidays || []).map(h => [h.date, h.name || 'Holiday']));
  return {
    settings,
    attIndex,
    leaves: db.getLeaves(),
    holidays,
    now,
    todayKey: dateKey(now),
    nowMinutes: minutesOfDay(now),
    endMinutes: parseTimeToMinutes(settings.office_end_time || '17:00'),
    startMinutes: parseTimeToMinutes(settings.office_start_time || '09:30')
  };
}

function leaveFor(emp, key, ctx) {
  // Prefer the decided request over a pending one when several overlap.
  const matches = ctx.leaves.filter(l =>
    l.kind === 'leave' &&
    (l.employee_id === emp.id || l.employee_code === emp.code) &&
    l.date <= key && (l.end_date || l.date) >= key &&
    l.status !== 'CANCELLED'
  );
  return matches.find(l => l.status === 'APPROVED') || matches.find(l => l.status === 'PENDING') || matches.find(l => l.status === 'REJECTED') || null;
}

function isOffDay(key, ctx) {
  return (ctx.settings.weekly_off_days || []).includes(keyToDate(key).getDay());
}

function hoursBetween(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, (new Date(b) - new Date(a)) / 3600000);
}

function resolveDay(emp, key, ctx) {
  const s = ctx.settings;
  const isToday = key === ctx.todayKey;
  const isPast = key < ctx.todayKey;
  const isFuture = key > ctx.todayKey;
  const dayOver = isPast || (isToday && ctx.nowMinutes >= ctx.endMinutes);
  const base = { date: key, day: Number(key.slice(8)), weekday: keyToDate(key).getDay() };

  // Nothing counts before the person joined, or before the app started tracking.
  const startKey = [emp.joined_on, s.tracking_started_on].filter(Boolean).sort().pop();
  if (startKey && key < startKey) return { ...base, status: 'NA', fine: 0, autoFine: 0 };

  const att = ctx.attIndex.get(`${emp.id}|${key}`) || ctx.attIndex.get(`${emp.code}|${key}`);
  const hasAdjust = att && att.adjusted_fine !== null && att.adjusted_fine !== undefined;

  if (att && att.check_in) {
    const missedCheckout = !att.check_out && isPast;
    const autoFine = (Number(att.auto_fine) || 0) + (missedCheckout ? Number(s.missed_checkout_fine) || 0 : 0);
    return {
      ...base,
      status: att.status === 'LATE' ? 'LATE' : 'PRESENT',
      attendanceId: att.id,
      checkIn: att.check_in,
      checkOut: att.check_out,
      lateMinutes: att.late_minutes || 0,
      earlyCheckout: !!att.is_early_checkout,
      earlyMinutes: att.early_minutes || 0,
      missedCheckout,
      awaitingCheckout: !att.check_out && isToday,
      hours: att.check_out ? hoursBetween(att.check_in, att.check_out) : (isToday ? hoursBetween(att.check_in, ctx.now) : 0),
      autoFine,
      fine: hasAdjust ? Number(att.adjusted_fine) : autoFine,
      adjusted: hasAdjust,
      fineNote: att.fine_note || null,
      note: att.employee_note || null,
      checkoutNote: att.checkout_note || null,
      manual: att.check_in_ip === 'MANUAL_ENTRY_BY_SIR' || att.check_in_ip === 'MANUAL_ENTRY',
      ip: att.check_in_ip || null
    };
  }

  // Sir marked this day absent manually (and may have set a custom fine).
  if (att && att.status === 'ABSENT') {
    const autoFine = Number(s.absent_fine) || 0;
    return { ...base, status: 'ABSENT', attendanceId: att.id, autoFine, fine: hasAdjust ? Number(att.adjusted_fine) : autoFine, adjusted: hasAdjust, fineNote: att.fine_note || null };
  }

  if (ctx.holidays.has(key)) return { ...base, status: 'HOLIDAY', label: ctx.holidays.get(key), fine: 0, autoFine: 0 };
  if (isOffDay(key, ctx)) return { ...base, status: 'OFF', label: 'Weekly off', fine: 0, autoFine: 0 };

  const leave = leaveFor(emp, key, ctx);
  if (leave && leave.status === 'APPROVED') {
    return { ...base, status: 'LEAVE', leaveType: leave.type, reason: leave.reason, requestId: leave.id, fine: Number(leave.fine_applied) || 0, autoFine: 0 };
  }

  if (isFuture) return { ...base, status: 'UPCOMING', pendingLeave: !!(leave && leave.status === 'PENDING'), fine: 0, autoFine: 0 };
  if (!dayOver) return { ...base, status: 'NOT_YET', pendingLeave: !!(leave && leave.status === 'PENDING'), fine: 0, autoFine: 0 };

  // Never absent on (or before) the day the person was added to the app:
  // they couldn't have checked in, so it isn't their fault.
  const addedKey = emp.created_at ? dateKey(new Date(emp.created_at)) : null;
  if (addedKey && key <= addedKey) return { ...base, status: 'NA', label: 'Added this day', fine: 0, autoFine: 0 };

  if (leave && leave.status === 'PENDING') {
    return { ...base, status: 'PENDING', leaveType: leave.type, reason: leave.reason, requestId: leave.id, fine: 0, autoFine: 0 };
  }

  const autoFine = Number(s.absent_fine) || 0;
  return {
    ...base,
    status: 'ABSENT',
    autoFine,
    fine: autoFine,
    reason: leave && leave.status === 'REJECTED' ? `Leave rejected: ${leave.reason}` : null
  };
}

function emptySummary() {
  return {
    workingDays: 0, present: 0, onTime: 0, late: 0, absent: 0, leave: 0, pending: 0,
    off: 0, lateMinutes: 0, lateFine: 0, missedCheckouts: 0, earlyCheckouts: 0, hours: 0,
    autoFine: 0, finalFine: 0, punctuality: null, attendanceRate: null, avgCheckIn: null
  };
}

function summarize(days) {
  const sum = emptySummary();
  let checkInMinutesTotal = 0;
  for (const d of days) {
    sum.autoFine += d.autoFine || 0;
    sum.finalFine += d.fine || 0;
    switch (d.status) {
      case 'PRESENT':
      case 'LATE':
        sum.present++;
        sum.workingDays++;
        if (d.status === 'LATE') { sum.late++; sum.lateMinutes += d.lateMinutes || 0; sum.lateFine += d.fine || 0; } else sum.onTime++;
        if (d.missedCheckout) sum.missedCheckouts++;
        if (d.earlyCheckout) sum.earlyCheckouts++;
        sum.hours += d.hours || 0;
        if (d.checkIn) checkInMinutesTotal += minutesOfDay(new Date(d.checkIn));
        break;
      case 'ABSENT': sum.absent++; sum.workingDays++; break;
      case 'LEAVE': sum.leave++; sum.workingDays++; break;
      case 'PENDING': sum.pending++; sum.workingDays++; break;
      case 'OFF':
      case 'HOLIDAY': sum.off++; break;
      default: break;
    }
  }
  sum.hours = Math.round(sum.hours * 10) / 10;
  if (sum.present > 0) {
    sum.punctuality = Math.round((sum.onTime / sum.present) * 100);
    const avg = Math.round(checkInMinutesTotal / sum.present);
    sum.avgCheckIn = `${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}`;
  }
  const counted = sum.present + sum.absent;
  if (counted > 0) sum.attendanceRate = Math.round((sum.present / counted) * 100);
  return sum;
}

function issuesFrom(days) {
  const issues = [];
  for (const d of days) {
    if (d.status === 'LATE') issues.push({ date: d.date, type: 'Late', detail: `${d.lateMinutes} min late${d.note ? ` — "${d.note}"` : ''}`, fine: d.fine });
    if (d.missedCheckout) issues.push({ date: d.date, type: 'Missed check-out', detail: 'Did not check out', fine: Number(db.getSettings().missed_checkout_fine) || 0 });
    if (d.earlyCheckout) issues.push({ date: d.date, type: 'Early check-out', detail: `Left ${d.earlyMinutes} min early${d.checkoutNote ? ` — "${d.checkoutNote}"` : ''}`, fine: 0 });
    if (d.status === 'ABSENT') issues.push({ date: d.date, type: 'Absent', detail: d.reason || 'No check-in and no leave', fine: d.fine });
    if (d.status === 'LEAVE') issues.push({ date: d.date, type: `Leave (${d.leaveType || 'General'})`, detail: d.reason || '', fine: d.fine });
    if (d.status === 'PENDING') issues.push({ date: d.date, type: 'Leave pending', detail: d.reason || '', fine: 0 });
  }
  return issues;
}

function publicEmployee(emp) {
  return {
    id: emp.id,
    code: emp.code,
    name: emp.name,
    designation: emp.designation,
    department: emp.department,
    phone: emp.phone,
    avatar_color: emp.avatar_color,
    joined_on: emp.joined_on,
    status: emp.status,
    has_device: !!emp.device_id,
    created_at: emp.created_at
  };
}

function employeeRange(emp, from, to, ctx = buildContext()) {
  const days = eachDay(from, to).map(k => resolveDay(emp, k, ctx));
  return { days, summary: summarize(days), issues: issuesFrom(days) };
}

// Range report for every active employee — powers daily, weekly and monthly reports.
function buildReport(from, to, { includeInactive = false } = {}) {
  const ctx = buildContext();
  const employees = db.getEmployees().filter(e => includeInactive || e.status === 'active');
  const dates = eachDay(from, to);
  const rows = employees.map(emp => {
    const r = employeeRange(emp, from, to, ctx);
    return { employee: publicEmployee(emp), ...r };
  });
  const totals = summarize(rows.flatMap(r => r.days));
  return {
    from, to, dates,
    holidays: Object.fromEntries(dates.filter(d => ctx.holidays.has(d)).map(d => [d, ctx.holidays.get(d)])),
    offDays: dates.filter(d => isOffDay(d, ctx)),
    totals,
    rows
  };
}

// Kept for the old monthly sheet shape.
function generateMonthlyReport(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
  const r = buildReport(from, to);
  return {
    year, month, daysInMonth: r.dates.length,
    report: r.rows.map(row => ({ employee: row.employee, summary: row.summary, issues: row.issues, days: Object.fromEntries(row.days.map(d => [d.day, d])) }))
  };
}

// ---------------------------------------------------------------------------
// Personal insights
// ---------------------------------------------------------------------------
// On-time streak: consecutive working days checked in on time. Leaves, offs and
// holidays don't break it; a late arrival or absence does.
function onTimeStreak(emp, ctx) {
  let streak = 0;
  let best = 0;
  let run = 0;
  let counting = true;
  for (let i = 0; i < 120; i++) {
    const key = addDays(ctx.todayKey, -i);
    const d = resolveDay(emp, key, ctx);
    if (d.status === 'NA') break;
    if (['OFF', 'HOLIDAY', 'LEAVE', 'NOT_YET', 'UPCOMING', 'PENDING'].includes(d.status)) continue;
    if (d.status === 'PRESENT') {
      run++;
      if (counting) streak++;
    } else {
      counting = false;
      run = 0;
    }
    best = Math.max(best, run);
  }
  return { current: streak, best: Math.max(best, streak) };
}

function monthBounds(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

function employeeInsights(emp, ctx, monthSummary, streak) {
  const tips = [];
  const s = monthSummary;
  if (streak.current >= 3) tips.push({ tone: 'good', text: `On time ${streak.current} days in a row. Keep it going.` });
  if (s.present >= 3 && s.punctuality === 100) tips.push({ tone: 'good', text: 'Not late once this month. Great work.' });
  if (s.late >= 3) tips.push({ tone: 'warn', text: `Late ${s.late} times this month (Rs ${s.lateFine || 0}). Leaving home 5 minutes earlier would save this.` });
  if (s.missedCheckouts > 0) tips.push({ tone: 'warn', text: `You forgot to check out on ${s.missedCheckouts} day${s.missedCheckouts === 1 ? '' : 's'}. Each one costs Rs ${ctx.settings.missed_checkout_fine}.` });
  if (s.avgCheckIn) {
    const avg = parseTimeToMinutes(s.avgCheckIn);
    const diff = ctx.startMinutes - avg;
    if (diff > 0) tips.push({ tone: 'info', text: `You usually arrive at ${format12(s.avgCheckIn)}, ${diff} minutes before start.` });
  }
  if (s.absent > 0) tips.push({ tone: 'warn', text: `Absent without leave on ${s.absent} day${s.absent === 1 ? '' : 's'}. Send a leave request in advance next time.` });
  return tips.slice(0, 3);
}

function format12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Admin dashboard insights across the team.
function teamInsights(ctx) {
  const tips = [];
  const { from } = monthBounds(ctx.todayKey);
  const report = buildReport(from, ctx.todayKey);
  const rows = report.rows.filter(r => r.summary.present + r.summary.absent > 0);

  const punctual = rows.filter(r => r.summary.present >= 3).sort((a, b) => (b.summary.punctuality - a.summary.punctuality) || (b.summary.present - a.summary.present))[0];
  if (punctual && punctual.summary.punctuality >= 80) {
    tips.push({ tone: 'good', text: `${punctual.employee.name} was on time ${punctual.summary.punctuality}% of days this month.` });
  }

  const weekFrom = addDays(ctx.todayKey, -6);
  const lateThisWeek = report.rows
    .map(r => ({ r, late: r.days.filter(d => d.date >= weekFrom && d.status === 'LATE').length }))
    .filter(x => x.late >= 2)
    .sort((a, b) => b.late - a.late);
  for (const x of lateThisWeek.slice(0, 2)) tips.push({ tone: 'warn', text: `${x.r.employee.name} was late ${x.late} times this week.` });

  const yesterday = addDays(ctx.todayKey, -1);
  const missed = report.rows.filter(r => r.days.some(d => d.date === yesterday && d.missedCheckout));
  if (missed.length) tips.push({ tone: 'warn', text: `Forgot to check out yesterday: ${missed.map(r => r.employee.name.split(' ')[0]).join(', ')}.` });

  // Fines so far this month vs the same days last month.
  const lastMonthDay = keyToDate(ctx.todayKey);
  lastMonthDay.setMonth(lastMonthDay.getMonth() - 1);
  const lmKey = dateKey(lastMonthDay);
  const lm = monthBounds(lmKey);
  const prev = buildReport(lm.from, lmKey);
  const nowFine = report.totals.finalFine;
  const prevFine = prev.totals.finalFine;
  if (prevFine > 0 && nowFine !== prevFine) {
    const pct = Math.round(Math.abs(nowFine - prevFine) / prevFine * 100);
    tips.push({ tone: nowFine < prevFine ? 'good' : 'info', text: `Fines so far this month: Rs ${nowFine}, ${pct}% ${nowFine < prevFine ? 'less' : 'more'} than this time last month.` });
  }

  const pending = ctx.leaves.filter(l => l.status === 'PENDING').length;
  if (pending) tips.push({ tone: 'info', text: `${pending} request${pending === 1 ? ' is' : 's are'} waiting for your decision.` });

  return tips.slice(0, 5);
}

// Fines, payments and what is still due, month by month (up to 12 months back).
function fineBalance(emp, ctx = buildContext()) {
  const payments = db.getPayments().filter(p => p.employee_id === emp.id);
  const firstAtt = db.getAttendance().filter(a => a.employee_id === emp.id || a.employee_code === emp.code).map(a => a.date).sort()[0];
  let start = [emp.joined_on, ctx.settings.tracking_started_on].filter(Boolean).sort().pop() || firstAtt || ctx.todayKey;
  const limit = (() => { const d = keyToDate(ctx.todayKey); d.setMonth(d.getMonth() - 11); d.setDate(1); return dateKey(d); })();
  if (start < limit) start = limit;
  const months = [];
  for (let k = `${start.slice(0, 7)}-01`; k <= ctx.todayKey; ) {
    const b = monthBounds(k);
    const to = b.to < ctx.todayKey ? b.to : ctx.todayKey;
    const fine = employeeRange(emp, b.from, to, ctx).summary.finalFine;
    const month = k.slice(0, 7);
    const paid = payments.filter(p => p.month === month).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    months.push({ month, fine, paid, due: Math.max(0, fine - paid) });
    const d = keyToDate(k); d.setMonth(d.getMonth() + 1); k = dateKey(d);
  }
  const totalFine = months.reduce((s, m) => s + m.fine, 0);
  const totalPaid = months.reduce((s, m) => s + m.paid, 0);
  const totalDue = months.reduce((s, m) => s + m.due, 0);
  return { months: months.reverse(), totalFine, totalPaid, totalDue, payments: payments.sort((a, b) => b.paid_at.localeCompare(a.paid_at)).slice(0, 30) };
}

module.exports = {
  fineBalance,
  getClientIP,
  isAllowedOfficeIP,
  officeIPs,
  officeNetworkFor,
  parseIP,
  calculateLateFine,
  finePreview,
  evaluateCheckout,
  parseTimeToMinutes,
  dateKey,
  addDays,
  eachDay,
  monthBounds,
  buildContext,
  resolveDay,
  summarize,
  employeeRange,
  buildReport,
  generateMonthlyReport,
  onTimeStreak,
  employeeInsights,
  teamInsights,
  publicEmployee,
  format12
};
