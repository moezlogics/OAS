const assert = require('assert');
const { calculateLateFine, evaluateCheckout, isAllowedOfficeIP } = require('../src/attendanceEngine');

console.log('🧪 Running Attendance Engine & Fine Rule Verification Tests...\n');

const settings = {
  office_start_time: '09:30',
  grace_minutes: 0,
  fine_per_hour: 100,
  office_end_time: '17:00'
};

// 1. Time Check: 09:29:00 (On-time, 0 fine)
{
  const d = new Date(2026, 10, 11, 9, 29, 0);
  const result = calculateLateFine(d, settings);
  console.log(`[TEST 1] Check-in 09:29:00 -> isLate: ${result.isLate}, fine: Rs ${result.fine}`);
  assert.strictEqual(result.isLate, false);
  assert.strictEqual(result.fine, 0);
  assert.strictEqual(result.status, 'PRESENT');
}

// 2. Time Check: 09:30:00 (Exact 9:30, 0 fine)
{
  const d = new Date(2026, 10, 11, 9, 30, 0);
  const result = calculateLateFine(d, settings);
  console.log(`[TEST 2] Check-in 09:30:00 -> isLate: ${result.isLate}, fine: Rs ${result.fine}`);
  assert.strictEqual(result.isLate, false);
  assert.strictEqual(result.fine, 0);
  assert.strictEqual(result.status, 'PRESENT');
}

// 3. Time Check: 09:31:00 (1 min late -> Rs 100 fine)
{
  const d = new Date(2026, 10, 11, 9, 31, 0);
  const result = calculateLateFine(d, settings);
  console.log(`[TEST 3] Check-in 09:31:00 -> isLate: ${result.isLate}, lateMinutes: ${result.lateMinutes}m, fine: Rs ${result.fine}`);
  assert.strictEqual(result.isLate, true);
  assert.strictEqual(result.lateMinutes, 1);
  assert.strictEqual(result.fine, 100);
  assert.strictEqual(result.status, 'LATE');
}

// 4. Time Check: 10:30:00 (60 mins late -> Rs 100 fine, 1st hour slab)
{
  const d = new Date(2026, 10, 11, 10, 30, 0);
  const result = calculateLateFine(d, settings);
  console.log(`[TEST 4] Check-in 10:30:00 -> isLate: ${result.isLate}, lateMinutes: ${result.lateMinutes}m, fine: Rs ${result.fine}`);
  assert.strictEqual(result.isLate, true);
  assert.strictEqual(result.lateMinutes, 60);
  assert.strictEqual(result.fine, 100);
}

// 5. Time Check: 10:31:00 (61 mins late -> Rs 200 fine, 2nd hour slab)
{
  const d = new Date(2026, 10, 11, 10, 31, 0);
  const result = calculateLateFine(d, settings);
  console.log(`[TEST 5] Check-in 10:31:00 -> isLate: ${result.isLate}, lateMinutes: ${result.lateMinutes}m, fine: Rs ${result.fine}`);
  assert.strictEqual(result.isLate, true);
  assert.strictEqual(result.lateMinutes, 61);
  assert.strictEqual(result.fine, 200);
}

// 6. Time Check: 11:30:00 (120 mins late -> Rs 200 fine)
{
  const d = new Date(2026, 10, 11, 11, 30, 0);
  const result = calculateLateFine(d, settings);
  console.log(`[TEST 6] Check-in 11:30:00 -> isLate: ${result.isLate}, lateMinutes: ${result.lateMinutes}m, fine: Rs ${result.fine}`);
  assert.strictEqual(result.isLate, true);
  assert.strictEqual(result.lateMinutes, 120);
  assert.strictEqual(result.fine, 200);
}

// 7. Time Check: 11:31:00 (121 mins late -> Rs 300 fine, 3rd hour slab)
{
  const d = new Date(2026, 10, 11, 11, 31, 0);
  const result = calculateLateFine(d, settings);
  console.log(`[TEST 7] Check-in 11:31:00 -> isLate: ${result.isLate}, lateMinutes: ${result.lateMinutes}m, fine: Rs ${result.fine}`);
  assert.strictEqual(result.isLate, true);
  assert.strictEqual(result.lateMinutes, 121);
  assert.strictEqual(result.fine, 300);
}

// 8. Checkout Evaluation Check
{
  const normalCheckout = new Date(2026, 10, 11, 17, 5, 0);
  const earlyCheckout = new Date(2026, 10, 11, 16, 30, 0);

  const res1 = evaluateCheckout(normalCheckout, settings);
  console.log(`[TEST 8a] Checkout 17:05:00 -> isEarly: ${res1.isEarly}`);
  assert.strictEqual(res1.isEarly, false);

  const res2 = evaluateCheckout(earlyCheckout, settings);
  console.log(`[TEST 8b] Checkout 16:30:00 -> isEarly: ${res2.isEarly}, earlyMinutes: ${res2.earlyMinutes}m`);
  assert.strictEqual(res2.isEarly, true);
  assert.strictEqual(res2.earlyMinutes, 30);
}

// 9. Office WiFi IP Restriction Check
{
  const allowedIPs = ['182.180.50.25', '119.160.10.15', '127.0.0.1'];

  const officeUser = isAllowedOfficeIP('182.180.50.25', allowedIPs);
  const mobileDataUser = isAllowedOfficeIP('110.38.19.4', allowedIPs);
  const homeWifiUser = isAllowedOfficeIP('39.50.12.8', allowedIPs);

  console.log(`[TEST 9] Office WiFi IP match: ${officeUser}`);
  console.log(`[TEST 9] Mobile Data IP match: ${mobileDataUser}`);
  console.log(`[TEST 9] Home WiFi IP match: ${homeWifiUser}`);

  assert.strictEqual(officeUser, true);
  assert.strictEqual(mobileDataUser, false);
  assert.strictEqual(homeWifiUser, false);
}

// 10. Day rules: missed check-out, holiday, weekly off, approved leave, absent
{
  const { resolveDay } = require('../src/attendanceEngine');
  const s = { ...settings, missed_checkout_fine: 100, absent_fine: 500, weekly_off_days: [0] };
  const emp = { id: 'E1', code: 'E1', joined_on: '2026-01-01' };
  const att = new Map([
    ['E1|2026-11-10', { id: 'a1', status: 'LATE', check_in: '2026-11-10T04:45:00.000Z', check_out: null, late_minutes: 15, auto_fine: 100 }],
    ['E1|2026-11-06', { id: 'a2', status: 'LATE', check_in: '2026-11-06T05:00:00.000Z', check_out: '2026-11-06T12:00:00.000Z', late_minutes: 30, auto_fine: 100, adjusted_fine: 0 }]
  ]);
  const ctx = {
    settings: s, attIndex: att, holidays: new Map([['2026-11-09', 'Iqbal Day']]),
    leaves: [{ kind: 'leave', employee_id: 'E1', date: '2026-11-04', end_date: '2026-11-05', status: 'APPROVED', type: 'Sick leave' }],
    now: new Date(2026, 10, 11, 10, 0), todayKey: '2026-11-11', nowMinutes: 600, endMinutes: 1020, startMinutes: 570
  };
  const missed = resolveDay(emp, '2026-11-10', ctx);
  console.log(`[TEST 10a] Late + forgot check-out -> fine Rs ${missed.fine}`);
  assert.strictEqual(missed.missedCheckout, true);
  assert.strictEqual(missed.fine, 200);
  const waived = resolveDay(emp, '2026-11-06', ctx);
  console.log(`[TEST 10b] Sir waived fine -> Rs ${waived.fine}`);
  assert.strictEqual(waived.fine, 0);
  assert.strictEqual(resolveDay(emp, '2026-11-09', ctx).status, 'HOLIDAY');
  assert.strictEqual(resolveDay(emp, '2026-11-08', ctx).status, 'OFF');
  assert.strictEqual(resolveDay(emp, '2026-11-05', ctx).status, 'LEAVE');
  const absent = resolveDay(emp, '2026-11-07', ctx);
  console.log(`[TEST 10c] No check-in, no leave -> ${absent.status}, Rs ${absent.fine}`);
  assert.strictEqual(absent.status, 'ABSENT');
  assert.strictEqual(absent.fine, 500);
  assert.strictEqual(resolveDay(emp, '2026-11-11', ctx).status, 'NOT_YET');
  console.log('[TEST 10d] Holiday, Sunday, leave and "not in yet" all resolve correctly');
}

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 100% compliant with specifications.');
