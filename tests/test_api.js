// API integration test. Runs against a throwaway copy of the data folder,
// so your real data/ is never touched.
//   node tests/test_api.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hazri-test-'));
process.env.DATA_DIR = tmp;
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_PASSWORD = 'admin123';
process.env.TZ = 'Asia/Karachi';
process.env.NODE_ENV = 'test'; // don't pick up production rules from a local .env

const app = require('../server');
const db = require('../src/db');
const E = require('../src/attendanceEngine');

const PORT = 3456;
function request(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: url, headers: { 'Content-Type': 'application/json', ...(payload && { 'Content-Length': Buffer.byteLength(payload) }), ...headers } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch (e) { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed++; console.log(`  ✓ ${name}`); }

const server = app.listen(PORT, async () => {
  try {
    db.updateSettings({ enforce_ip_attendance: true, office_ips: ['127.0.0.1'] });

    const status = await request('GET', '/api/status');
    ok('status endpoint works and sees localhost as office WiFi', status.status === 200 && status.body.isOfficeWifi === true);

    const admin = await request('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
    ok('admin can sign in', admin.status === 200 && admin.body.token);
    const A = { Authorization: `Bearer ${admin.body.token}` };

    const badAdmin = await request('POST', '/api/admin/login', { username: 'admin', password: 'nope' });
    ok('wrong admin password is refused', badAdmin.status === 401);

    const add = await request('POST', '/api/admin/employees/add', { code: 'emp-999', name: 'Tariq Mehmood', designation: 'Content Writer', department: 'Marketing', pin: '4321' }, A);
    ok('admin adds an employee (code upper-cased)', add.status === 200 && add.body.employee.code === 'EMP-999');
    ok('employee PIN is stored hashed, never plain', !JSON.stringify(db.getEmployees()).includes('"pin":'));

    const badPin = await request('POST', '/api/login', { code: 'EMP-999', pin: '0000' });
    ok('wrong PIN is refused', badPin.status === 401);

    const login = await request('POST', '/api/login', { code: 'emp-999', pin: '4321', device_id: 'phone-1' });
    ok('employee signs in with code + PIN', login.status === 200 && login.body.token);
    const U = { Authorization: `Bearer ${login.body.token}` };

    const me = await request('GET', '/api/me', null, U);
    ok('personal dashboard returns name, today and month', me.status === 200 && me.body.employee.name === 'Tariq Mehmood' && me.body.today && me.body.month);

    const blocked = await request('POST', '/api/me/check-in', {}, { ...U, 'X-Forwarded-For': '203.0.113.195' });
    ok('check-in from outside IP (via proxy header) is blocked', blocked.status === 403);

    // X-Forwarded-For is only believed when it comes from our own proxy (Nginx on this machine),
    // so someone on the internet cannot fake the office IP by sending the header themselves.
    const trust = app.get('trust proxy fn');
    ok('X-Forwarded-For is trusted from local Nginx only, not from internet clients', trust('127.0.0.1', 0) === true && trust('203.0.113.9', 0) === false);

    const checkIn = await request('POST', '/api/me/check-in', { note: 'Reached office' }, U);
    ok('check-in from office WiFi works', checkIn.status === 200 && checkIn.body.success);
    const again = await request('POST', '/api/me/check-in', {}, U);
    ok('second check-in the same day is refused', again.status === 400);

    const fine = await request('POST', '/api/admin/fine/adjust', { attendance_id: checkIn.body.record.id, new_fine: 0, note: 'Maaf' }, A);
    ok('admin can waive the fine', fine.status === 200 && fine.body.record.adjusted_fine === 0);

    const notes = await request('GET', '/api/me/notifications', null, U);
    ok('employee is notified about fine decision (welcome note at least)', notes.status === 200 && notes.body.notifications.length >= 1);

    const out = await request('POST', '/api/me/check-out', { note: 'Doctor' }, U);
    ok('check-out works', out.status === 200 && out.body.success);

    const tomorrow = E.addDays(E.dateKey(), 1);
    const leave = await request('POST', '/api/me/requests', { kind: 'leave', type: 'Sick leave', date: tomorrow, end_date: tomorrow, reason: 'Bukhar hai' }, U);
    ok('employee sends a leave request', leave.status === 200 && leave.body.request.status === 'PENDING');
    const review = await request('POST', '/api/admin/leaves/review', { leave_id: leave.body.request.id, status: 'APPROVED', admin_note: 'Get well soon' }, A);
    ok('admin approves the leave', review.status === 200 && review.body.leave.status === 'APPROVED');

    const absent = await request('POST', '/api/admin/fine/adjust', { employee_code: 'EMP-999', date: E.addDays(E.dateKey(), -1), new_fine: 250 }, A);
    ok('admin can set a fine on a day without a record (absent)', absent.status === 200 && absent.body.record.status === 'ABSENT');

    const from = E.addDays(E.dateKey(), -6);
    const rep = await request('GET', `/api/admin/reports?from=${from}&to=${E.dateKey()}`, null, A);
    ok('range report has a row per employee and 7 days', rep.status === 200 && rep.body.data.rows.length === 1 && rep.body.data.dates.length === 7);
    const now = new Date();
    const monthly = await request('GET', `/api/admin/reports/monthly?year=${now.getFullYear()}&month=${now.getMonth() + 1}`, null, A);
    ok('monthly sheet endpoint still works', monthly.status === 200 && Array.isArray(monthly.body.data.report));

    const dash = await request('GET', '/api/admin/dashboard', null, A);
    ok('dashboard returns board, trend and insights', dash.status === 200 && dash.body.board.length === 1 && dash.body.trend.length === 7 && Array.isArray(dash.body.insights));

    db.updateSettings({ bind_device: true });
    await request('POST', '/api/login', { code: 'EMP-999', pin: '4321', device_id: 'phone-1' });
    const other = await request('POST', '/api/login', { code: 'EMP-999', pin: '4321', device_id: 'phone-2' });
    ok('one-phone lock stops sign in from a second phone', other.status === 403);
    await request('POST', '/api/admin/employees/EMP-999/reset-device', {}, A);
    const old = await request('GET', '/api/me', null, U);
    ok('phone reset signs out the old session', old.status === 401);

    const noAuth = await request('GET', '/api/admin/dashboard');
    ok('admin routes need a token', noAuth.status === 401);

    // ---------- Fine payments ----------
    const login2 = await request('POST', '/api/login', { code: 'EMP-999', pin: '4321', device_id: 'phone-3' });
    const U2 = { Authorization: `Bearer ${login2.body.token}` };
    const month = E.dateKey().slice(0, 7);
    await request('POST', '/api/admin/fine/adjust', { attendance_id: checkIn.body.record.id, new_fine: 300, note: 'Test fine' }, A);
    const finesBefore = await request('GET', `/api/admin/fines?month=${month}`, null, A);
    const rowBefore = finesBefore.body.rows.find(r => r.employee.id === 'EMP-999');
    ok('fines page lists fine, paid and due per employee', finesBefore.status === 200 && rowBefore && rowBefore.fine >= 300 && rowBefore.paid === 0);
    const pay = await request('POST', '/api/admin/payments', { employee_id: 'EMP-999', month, amount: 100, note: 'Cash' }, A);
    ok('admin marks part of a fine as paid', pay.status === 200 && pay.body.payment.amount === 100);
    const finesAfter = await request('GET', `/api/admin/fines?month=${month}`, null, A);
    const rowAfter = finesAfter.body.rows.find(r => r.employee.id === 'EMP-999');
    ok('due goes down after a payment', rowAfter.paid === 100 && rowAfter.due === rowBefore.due - 100);
    const meFines = await request('GET', '/api/me', null, U2);
    ok('employee sees what is still due', meFines.status === 200 && meFines.body.fines.totalPaid === 100 && meFines.body.fines.totalDue >= rowAfter.due);
    const undo = await request('DELETE', `/api/admin/payments/${pay.body.payment.id}`, null, A);
    ok('a payment can be removed', undo.status === 200 && db.getPayments().length === 0);

    // Days before the app started tracking never count as absent, even with an old joining date.
    await request('POST', '/api/admin/employees/add', { code: 'EMP-998', name: 'Old Timer', pin: '1111', joined_on: '2024-01-01' }, A);
    const oldMonth = await request('GET', '/api/admin/employees/EMP-998/profile?month=2025-06', null, A);
    ok('months before tracking started have no absents or fines', oldMonth.status === 200 && oldMonth.body.summary.absent === 0 && oldMonth.body.summary.finalFine === 0);

    // ---------- Push subscriptions ----------
    const fakeKeys = { p256dh: 'B' + 'x'.repeat(86), auth: 'a'.repeat(22) };
    const fakeSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: fakeKeys };
    const key = await request('GET', '/api/push/key');
    ok('server shares its public push key', key.status === 200 && typeof key.body.publicKey === 'string' && key.body.publicKey.length > 40);
    const subA = await request('POST', '/api/admin/push/subscribe', { subscription: fakeSub }, A);
    ok('admin device can turn on notifications', subA.status === 200 && db.getPushSubs().some(s => s.owner === 'admin'));
    const subE = await request('POST', '/api/me/push/subscribe', { subscription: { ...fakeSub, endpoint: 'https://fcm.googleapis.com/fcm/send/emp' } }, U2);
    ok('employee phone can turn on notifications', subE.status === 200 && db.getPushSubs().some(s => s.owner === 'EMP-999'));
    const prefs = await request('PUT', '/api/admin/settings', { push_admin: { every_checkin: true, late_checkin: false } }, A);
    ok('admin can choose which events notify', prefs.status === 200 && db.getSettings().push_admin.every_checkin === true && db.getSettings().push_admin.late_checkin === false && db.getSettings().push_admin.leave_request === true);
    await request('POST', '/api/admin/push/unsubscribe', { endpoint: fakeSub.endpoint }, A);
    ok('admin device can turn notifications off', !db.getPushSubs().some(s => s.owner === 'admin'));

    // ---------- Sessions stay signed in ----------
    const auth = require('../src/auth');
    const oldToken = auth.signToken({ role: 'employee', sub: 'EMP-999', v: db.getEmployeeById('EMP-999').session_version || 0 });
    const payload = auth.verifyToken(oldToken);
    ok('sessions last about 400 days', payload.exp - payload.iat >= 399 * 86400);
    const pw = await request('POST', '/api/admin/settings/change-password', { current_password: 'admin123', new_password: 'newpass123' }, A);
    const oldAdmin = await request('GET', '/api/admin/dashboard', null, A);
    const newAdmin = await request('GET', '/api/admin/dashboard', null, { Authorization: `Bearer ${pw.body.token}` });
    ok('changing the admin password signs out other devices but keeps this one', pw.status === 200 && oldAdmin.status === 401 && newAdmin.status === 200);

    // ---------- Security ----------
    ok('an empty office IP list lets nobody check in (fails closed)', E.isAllowedOfficeIP('1.2.3.4', []) === false);
    const crossSite = await request('POST', '/api/me/requests', { kind: 'leave', reason: 'x'.repeat(10) }, { ...U2, Origin: 'https://evil.example' });
    ok('requests from another website are blocked', crossSite.status === 403);
    const ssrf = await request('POST', '/api/me/push/subscribe', { subscription: { endpoint: 'https://169.254.169.254/latest/meta-data', keys: fakeKeys } }, U2);
    const ssrf2 = await request('POST', '/api/me/push/subscribe', { subscription: { endpoint: 'http://127.0.0.1:3112/api/admin', keys: fakeKeys } }, U2);
    ok('push addresses must be real push services (no internal URLs)', ssrf.status === 400 && ssrf2.status === 400);
    const oddType = await request('POST', '/api/me/requests', { kind: 'leave', type: '<img src=x onerror=alert(1)>', date: tomorrow, reason: 'Family event' }, U2);
    ok('request type must be one of the known types', oddType.status === 200 && oddType.body.request.type === 'Sick leave');
    const crypto = require('crypto');
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const b = Buffer.from(JSON.stringify({ role: 'admin', username: 'admin', v: db.getSettings().admin_session_version, exp: 9999999999 })).toString('base64url');
    const forged = `${h}.${b}.${crypto.createHmac('sha256', 'office_attendance_dev_secret_change_me').update(`${h}.${b}`).digest('base64url')}`;
    const forgedRes = await request('GET', '/api/admin/dashboard', null, { Authorization: `Bearer ${forged}` });
    ok('a token signed with the old public default secret is refused', forgedRes.status === 401);
    for (let i = 0; i < 5; i++) await request('POST', '/api/login', { code: 'EMP-998', pin: '0000' });
    const lockedOut = await request('POST', '/api/login', { code: 'EMP-998', pin: '1111' });
    ok('5 wrong PINs lock the account even for the right PIN', lockedOut.status === 429);
    ok('new PINs use the stronger hash', !db.isOldHash(db.getEmployeeById('EMP-998').pin_salt));

    console.log(`\nAll ${passed} API checks passed.\n`);
    server.close(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); });
  } catch (err) {
    console.error('\n✗ API test failed:', err.message);
    server.close(() => { fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
  }
});
