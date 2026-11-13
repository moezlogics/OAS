// Fills data/ with realistic demo data from 1 October until today.
// WARNING: this replaces employees, attendance, requests and notifications.
//   node scripts/seed_demo_data.js
process.env.TZ = process.env.TZ || 'Asia/Karachi';
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const E = require('../src/attendanceEngine');

const DATA = path.join(__dirname, '..', 'data');
const OFFICE_IP = '182.180.11.45';

// Deterministic pseudo-random so the demo looks the same every time.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const people = [
  { code: 'EMP-101', name: 'Muhammad Ali', designation: 'Senior Developer', department: 'Software', phone: '0300-1234567', pin: '1234', punctual: 0.92 },
  { code: 'EMP-102', name: 'Usman Khan', designation: 'UI/UX Designer', department: 'Creative', phone: '0312-9876543', pin: '2345', punctual: 0.7 },
  { code: 'EMP-103', name: 'Fatima Noor', designation: 'HR & Operations', department: 'Management', phone: '0321-4567890', pin: '3456', punctual: 0.98 },
  { code: 'EMP-104', name: 'Bilal Tariq', designation: 'Digital Marketing', department: 'Marketing', phone: '0333-7654321', pin: '4567', punctual: 0.6 },
  { code: 'EMP-105', name: 'Ayesha Siddiqui', designation: 'Accounts Officer', department: 'Finance', phone: '0345-2233445', pin: '5678', punctual: 0.88 },
  { code: 'EMP-106', name: 'Hamza Raza', designation: 'Sales Executive', department: 'Sales', phone: '0301-5566778', pin: '6789', punctual: 0.8, joined_on: '2026-10-20' }
];

fs.writeFileSync(path.join(DATA, 'employees.json'), '[]');
fs.writeFileSync(path.join(DATA, 'notifications.json'), '[]');
fs.writeFileSync(path.join(DATA, 'payments.json'), '[]');
fs.writeFileSync(path.join(DATA, 'push_subscriptions.json'), '[]');
for (const p of people) db.addEmployee({ ...p, joined_on: p.joined_on || '2026-01-15' });
// Demo people were "added" long ago, so their past days count normally.
for (const p of people) db.updateEmployee(p.code, { created_at: `${p.joined_on || '2026-09-30'}T03:00:00.000Z` });

db.updateSettings(s => ({
  ...s,
  office_name: 'Media Linkers',
  tracking_started_on: '2026-10-01',
  holidays: [
    { date: '2026-11-09', name: 'Iqbal Day' },
    { date: '2026-12-25', name: 'Quaid-e-Azam Day' }
  ],
  weekly_off_days: [0]
}));

const settings = db.getSettings();
const now = new Date();
const todayKey = E.dateKey(now);
const holidays = new Set(settings.holidays.map(h => h.date));
const attendance = [];
const leaves = [];

const at = (key, h, m) => new Date(`${key}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(rand() * 59)).padStart(2, '0')}`);
const excuses = ['Traffic block on Canal Road', 'Flat tyre on my bike', 'Dropped the kids at school', 'The metro was late', 'Heavy rain'];

function addDay(p, key, inDate, outDate, note) {
  const late = E.calculateLateFine(inDate, settings);
  const ev = outDate ? E.evaluateCheckout(outDate, settings) : { isEarly: false, earlyMinutes: 0 };
  attendance.push({
    id: `att_${key}_${p.code}`, date: key, employee_id: p.code, employee_code: p.code, employee_name: p.name,
    check_in: inDate.toISOString(), check_in_ip: OFFICE_IP,
    check_out: outDate ? outDate.toISOString() : null, check_out_ip: outDate ? OFFICE_IP : null,
    status: late.status, late_minutes: late.lateMinutes, slabs: late.slabs, auto_fine: late.fine,
    adjusted_fine: null, fine_note: null, employee_note: note || null,
    is_early_checkout: ev.isEarly, early_minutes: ev.earlyMinutes,
    created_at: inDate.toISOString(), updated_at: (outDate || inDate).toISOString()
  });
}

for (const key of E.eachDay('2026-10-01', E.addDays(todayKey, -1))) {
  const dow = new Date(`${key}T12:00:00`).getDay();
  if (dow === 0 || holidays.has(key)) continue;
  for (const p of people) {
    if (p.joined_on && key < p.joined_on) continue;
    const r = rand();
    if (p.code === 'EMP-104' && (key === '2026-11-05' || key === '2026-10-14')) continue; // unannounced absence
    if (p.code === 'EMP-102' && key === '2026-11-04') {
      leaves.push({ id: `req_${key}_${p.code}`, kind: 'leave', employee_id: p.code, employee_code: p.code, employee_name: p.name, date: key, end_date: key, type: 'Sick leave', reason: 'Viral fever, the doctor advised one day of rest.', fine_applied: 0, status: 'APPROVED', admin_note: 'Get well soon', created_at: `${key}T07:40:00.000Z`, reviewed_at: `${key}T09:10:00.000Z` });
      continue;
    }
    if (p.code === 'EMP-105' && key >= '2026-10-22' && key <= '2026-10-24') {
      if (key === '2026-10-22') leaves.push({ id: `req_${key}_${p.code}`, kind: 'leave', employee_id: p.code, employee_code: p.code, employee_name: p.name, date: '2026-10-22', end_date: '2026-10-24', type: 'Annual leave', reason: 'Family wedding in Multan.', fine_applied: 0, status: 'APPROVED', created_at: '2026-10-15T08:00:00.000Z', reviewed_at: '2026-10-15T11:00:00.000Z' });
      continue;
    }

    let inDate;
    let note = null;
    if (r < p.punctual) {
      inDate = at(key, 9, 5 + Math.floor(rand() * 25)); // 9:05–9:29
    } else {
      const lateBy = rand() < 0.75 ? 1 + Math.floor(rand() * 35) : 61 + Math.floor(rand() * 60);
      const t = 9 * 60 + 30 + lateBy;
      inDate = at(key, Math.floor(t / 60), t % 60);
      if (rand() < 0.6) note = excuses[Math.floor(rand() * excuses.length)];
    }
    const forgotOut = rand() < 0.03;
    const early = rand() < 0.05;
    const outDate = forgotOut ? null : early ? at(key, 16, 10 + Math.floor(rand() * 40)) : at(key, 17, Math.floor(rand() * 25));
    addDay(p, key, inDate, outDate, note);
  }
}

// Admin's past decisions on a few fines.
const lates = attendance.filter(a => a.status === 'LATE' && a.employee_note);
lates.slice(0, 3).forEach((a, i) => {
  a.adjusted_fine = i === 0 ? 0 : 50;
  a.fine_note = i === 0 ? 'It was raining, waived' : 'First time, half fine';
  a.fine_adjusted_at = a.updated_at;
});

// Today: a realistic morning.
const nowMin = now.getHours() * 60 + now.getMinutes();
const todayIsWork = new Date().getDay() !== 0 && !holidays.has(todayKey);
if (todayIsWork && nowMin > 9 * 60) {
  const plan = [['EMP-101', 9, 12], ['EMP-103', 9, 4], ['EMP-105', 9, 21], ['EMP-102', 9, 47, 'Traffic block near Canal Road'], ['EMP-106', 9, 26]];
  for (const [code, h, m, note] of plan) {
    if (h * 60 + m > nowMin) continue;
    addDay(people.find(p => p.code === code), todayKey, at(todayKey, h, m), null, note);
  }
}

// Open requests waiting for the admin.
const tomorrow = E.addDays(todayKey, 1);
leaves.push({ id: 'req_demo_pending_1', kind: 'leave', employee_id: 'EMP-104', employee_code: 'EMP-104', employee_name: 'Bilal Tariq', date: E.addDays(todayKey, 2), end_date: E.addDays(todayKey, 3), type: 'Casual leave', reason: 'Family land matter in my village, I need 2 days.', fine_applied: 0, status: 'PENDING', created_at: new Date(Date.now() - 3600000).toISOString() });
const usmanLate = attendance.filter(a => a.employee_code === 'EMP-102' && a.status === 'LATE').pop();
if (usmanLate) {
  leaves.push({ id: 'req_demo_pending_2', kind: 'excuse', employee_id: 'EMP-102', employee_code: 'EMP-102', employee_name: 'Usman Khan', date: usmanLate.date, end_date: usmanLate.date, type: 'Late arrival', reason: usmanLate.employee_note || 'Traffic jam', fine_applied: 0, status: 'PENDING', created_at: usmanLate.check_in });
}
leaves.push({ id: 'req_demo_rejected', kind: 'leave', employee_id: 'EMP-104', employee_code: 'EMP-104', employee_name: 'Bilal Tariq', date: '2026-10-14', end_date: '2026-10-14', type: 'Casual leave', reason: 'Personal work', fine_applied: 0, status: 'REJECTED', admin_note: 'Please tell us a day before', created_at: '2026-10-14T10:00:00.000Z', reviewed_at: '2026-10-14T12:00:00.000Z' });

db.saveAttendance(attendance);
db.saveLeaves(leaves);

// A few fines already paid for last month.
const lastMonth = E.addDays(`${todayKey.slice(0, 7)}-01`, -1).slice(0, 7);
db.addPayment({ employee_id: 'EMP-101', employee_name: 'Muhammad Ali', month: lastMonth, amount: 300, note: 'Cash' });
db.addPayment({ employee_id: 'EMP-103', employee_name: 'Fatima Noor', month: lastMonth, amount: 100, note: 'Cash' });

db.addNotification({ employee_id: 'all', kind: 'announcement', title: 'Friday prayer break: 12:30 to 2:00', body: 'Work starts again at 2. Check-out is still at 5.' });
db.addNotification({ employee_id: 'EMP-102', kind: 'good', title: 'Sick leave (4 Nov) approved', body: 'Get well soon' });

console.log(`Seeded ${people.length} employees, ${attendance.length} attendance records, ${leaves.length} requests.`);
console.log('Demo PINs: EMP-101 → 1234, EMP-102 → 2345, EMP-103 → 3456, EMP-104 → 4567, EMP-105 → 5678, EMP-106 → 6789');
