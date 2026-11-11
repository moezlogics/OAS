// Timed push notifications. Checks once a minute; each one goes out once per day.
//   start - 15 min : remind employees who have not checked in
//   start + 30 min : morning summary for the admin
//   closing time   : remind employees who are still checked in to check out
//   closing + 60   : tell the admin who forgot to check out
const db = require('./db');
const E = require('./attendanceEngine');
const push = require('./push');

const fmt = m => E.format12(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const names = list => {
  const first = list.map(x => x.employee.name.split(' ')[0]);
  return first.length <= 4 ? first.join(', ') : `${first.slice(0, 4).join(', ')} +${first.length - 4} more`;
};

function once(key, fn) {
  if (db.wasPushSent(key)) return;
  db.markPushSent(key);
  fn();
}

function tick(now = new Date()) {
  const ctx = E.buildContext(now);
  const s = ctx.settings;
  const today = ctx.todayKey;
  if (ctx.holidays.has(today) || (s.weekly_off_days || []).includes(now.getDay())) return;

  const start = ctx.startMinutes + (Number(s.grace_minutes) || 0);
  const end = ctx.endMinutes;
  const nowMin = ctx.nowMinutes;
  const people = db.getEmployees().filter(e => e.status === 'active').map(emp => ({ employee: emp, day: E.resolveDay(emp, today, ctx) }));
  const due = (at, windowMin = 20) => nowMin >= at && nowMin < at + windowMin;

  if (due(start - 15)) {
    once(`${today}:checkin_reminder`, () => {
      for (const p of people.filter(x => x.day.status === 'NOT_YET')) {
        push.employee(p.employee, {
          title: 'Time to check in',
          body: `Office starts at ${fmt(start)}. Check in on time to avoid a fine.`,
          event: 'checkin_reminder', inApp: false, url: '/#home'
        });
      }
    });
  }

  if (due(start + 30, 60)) {
    once(`${today}:morning_summary`, () => {
      const inOffice = people.filter(x => x.day.status === 'PRESENT' || x.day.status === 'LATE');
      const late = people.filter(x => x.day.status === 'LATE');
      const notIn = people.filter(x => x.day.status === 'NOT_YET');
      const onLeave = people.filter(x => x.day.status === 'LEAVE');
      const parts = [`${inOffice.length} of ${people.length - onLeave.length} in office`];
      if (late.length) parts.push(`${late.length} late`);
      if (onLeave.length) parts.push(`${onLeave.length} on leave`);
      push.admin('morning_summary', {
        title: 'Morning summary',
        body: `${parts.join(', ')}.${notIn.length ? ` Not in yet: ${names(notIn)}.` : ' Everyone is in.'}`,
        url: '/admin#attendance', tag: 'morning-summary'
      });
    });
  }

  if (due(end, 30)) {
    once(`${today}:checkout_reminder`, () => {
      for (const p of people.filter(x => x.day.checkIn && !x.day.checkOut)) {
        push.employee(p.employee, {
          title: 'Don’t forget to check out',
          body: `It’s ${fmt(end)}. Check out before you leave, or a Rs ${Number(s.missed_checkout_fine) || 0} fine is added.`,
          event: 'checkout_reminder', inApp: false, url: '/#home'
        });
      }
    });
  }

  if (due(end + 60, 120)) {
    once(`${today}:missed_checkout`, () => {
      const missing = people.filter(x => x.day.checkIn && !x.day.checkOut);
      if (!missing.length) return;
      push.admin('missed_checkout', {
        title: `${missing.length} forgot to check out`,
        body: `${names(missing)} did not check out today.`,
        url: '/admin#attendance', tag: 'missed-checkout'
      });
    });
  }
}

let timer = null;
function start() {
  if (timer) return;
  const run = () => { try { tick(); } catch (err) { console.warn('Scheduler error:', err.message); } };
  timer = setInterval(run, 60 * 1000);
  setTimeout(run, 5000);
}

module.exports = { start, tick };
