/* Employee app: sign in once, then one screen for today with one big button. */
(function () {
  'use strict';
  const { icon, esc, time12, dateLong, dateMed, dateShort, monthName, rs, duration, mins, ago, greeting, firstName, avatar, pill, fineHtml, api, toast, sheet, confirmSheet, withBusy, calendar, dayDetailHtml, store, applyTheme, THEME_KEY, dateKey, push, install } = window.H;

  const TOKEN_KEY = 'hazri.emp.token';
  const DEVICE_KEY = 'hazri.device';
  const CODE_KEY = 'hazri.lastCode';
  const PUSH_DISMISS_KEY = 'hazri.pushAsked';
  const INSTALL_DISMISS_KEY = 'hazri.installAsked';

  let token = store(TOKEN_KEY);
  const state = { me: null, offset: 0, status: null, historyMonth: null, lastFetch: 0 };
  const $ = sel => document.querySelector(sel);
  const view = $('#view');
  const TITLES = { home: 'Today', history: 'History', requests: 'Requests', profile: 'Profile' };

  // The server renews the session quietly; keep the newest token.
  H.setSessionHandler(t => { token = t; store(TOKEN_KEY, t); });

  // ---------- Utilities ----------
  function deviceId() {
    let id = store(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      store(DEVICE_KEY, id);
    }
    return id;
  }
  const now = () => new Date(Date.now() + state.offset);
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const minOfDay = d => d.getHours() * 60 + d.getMinutes();
  const ordinal = n => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  function syncClock(serverTime) { if (serverTime) state.offset = new Date(serverTime).getTime() - Date.now(); }

  async function call(path, opts = {}) {
    try {
      return await api(path, { ...opts, token });
    } catch (err) {
      if (err.status === 401) signOut(err.message);
      throw err;
    }
  }

  document.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });

  // ---------- Sign in ----------
  async function showLogin(message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    const codeInput = $('#loginCode');
    codeInput.value = store(CODE_KEY) || '';
    showLoginError(message || '');
    paintLoginInstall();
    (codeInput.value ? $('#loginPin') : codeInput).focus();
    try {
      state.status = await api('/api/status');
      syncClock(state.status.serverTime);
      $('#loginOffice').textContent = state.status.officeName || 'Attendance';
      document.title = `${state.status.officeName || 'Attendance'}`;
      const w = state.status;
      $('#loginWifi').innerHTML = w.ipEnforced
        ? `<span class="wifi-line ${w.isOfficeWifi ? 'ok' : 'no'}">${icon(w.isOfficeWifi ? 'wifi' : 'wifiOff', 'icon-s')}${w.isOfficeWifi ? 'Connected to office WiFi' : 'Not on office WiFi. You can sign in, but check-in needs office WiFi.'}</span>`
        : '';
    } catch (e) { /* offline: the form still works when back */ }
  }

  function paintLoginInstall() {
    const box = $('#loginInstall');
    box.innerHTML = install.isStandalone() ? '' : `<button type="button" class="btn btn-ghost" id="installBtn">${icon('download', 'icon-s')}Install the app on this ${install.device().os === 'desktop' ? 'computer' : 'phone'}</button>`;
    const b = $('#installBtn');
    if (b) b.addEventListener('click', () => install.start('the app'));
  }
  install.onChange(() => {
    if (!$('#login').hidden) paintLoginInstall();
    else if (state.me && (currentTab() === 'home' || currentTab() === 'profile')) route();
  });

  function showLoginError(msg) {
    const el = $('#loginError');
    el.textContent = msg;
    el.hidden = !msg;
  }

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('#loginCode').value.trim().toUpperCase();
    const pin = $('#loginPin').value.trim();
    if (!code || !pin) return showLoginError('Enter your employee code and PIN.');
    showLoginError('');
    const btn = e.submitter || $('#loginForm button');
    await withBusy(btn, async () => {
      btn.textContent = 'Signing in…';
      try {
        const res = await api('/api/login', { method: 'POST', body: { code, pin, device_id: deviceId() } });
        token = res.token;
        store(TOKEN_KEY, token);
        store(CODE_KEY, code);
        $('#loginPin').value = '';
        await loadMe();
        showApp();
      } catch (err) {
        showLoginError(err.message);
        $('#loginPin').select();
      }
    });
  });

  async function signOut(message) {
    const sub = await push.current().catch(() => null);
    token = null;
    store(TOKEN_KEY, null);
    state.me = null;
    api('/api/logout', { method: 'POST', body: sub ? { endpoint: sub.endpoint } : {} }).catch(() => {});
    if (sub) sub.unsubscribe().catch(() => {});
    clearInterval(appTimer);
    showLogin(message);
  }

  // ---------- App shell ----------
  let appTimer = null;
  async function loadMe() {
    const me = await call('/api/me');
    syncClock(me.serverTime);
    state.me = me;
    state.lastFetch = Date.now();
    return me;
  }

  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    paintChrome();
    route();
    push.sync('/api/me/push/subscribe', token);
    clearInterval(appTimer);
    appTimer = setInterval(async () => {
      if (currentTab() !== 'home') return;
      if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > 60000) {
        try { await loadMe(); paintChrome(); } catch (e) { /* keep showing last data */ }
      }
      paintHero();
    }, 15000);
  }

  function paintChrome() {
    const me = state.me;
    document.title = me.officeName || 'Attendance';
    $('#bellBtn').innerHTML = `${icon('bell')}${me.unread ? `<span class="dot">${me.unread > 9 ? '9+' : me.unread}</span>` : ''}`;
    $('#bellBtn').setAttribute('aria-label', me.unread ? `Notifications, ${me.unread} new` : 'Notifications');
  }

  const currentTab = () => (location.hash.replace('#', '') || 'home').split('/')[0];

  function route() {
    if (!state.me) return;
    const tab = TITLES[currentTab()] ? currentTab() : 'home';
    $('#pageTitle').textContent = TITLES[tab];
    document.querySelectorAll('[data-tab]').forEach(a => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    window.scrollTo(0, 0);
    if (tab === 'history') renderHistory();
    else if (tab === 'requests') renderRequests();
    else if (tab === 'profile') renderProfile();
    else renderHome();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', () => $('.topbar')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.me && Date.now() - state.lastFetch > 30000) {
      try { await loadMe(); paintChrome(); if (currentTab() === 'home') renderHome(); } catch (e) { /* ignore */ }
    }
  });
  $('#bellBtn').addEventListener('click', openNotifications);

  // ---------- Today card ----------
  function heroModel() {
    const me = state.me;
    const t = me.timings;
    const d = me.today;
    const n = now();
    const nowMin = minOfDay(n);
    const start = toMin(t.startTime) + (t.graceMinutes || 0);
    const end = toMin(t.endTime);
    const canMark = me.wifi.canMark;
    const wifiHint = canMark ? '' : `<p class="today-hint">${icon('wifiOff', 'icon-s')}Connect to the office WiFi and turn off mobile data.</p><p class="muted small center">Your network: ${esc(me.wifi.clientIP)}. In the office? Tell the admin, they can add it.</p>`;
    const m = { tone: 'good', kicker: '', head: '', sub: '', action: '', times: '' };

    if (d.status === 'OFF' || d.status === 'HOLIDAY') {
      return { ...m, tone: 'off', kicker: d.status === 'HOLIDAY' ? 'Holiday' : 'Day off', head: 'No work today', sub: d.status === 'HOLIDAY' ? `${esc(d.label)}. Enjoy your day.` : 'Enjoy your day off. See you next working day.', ribbon: false };
    }
    if (d.status === 'LEAVE') {
      return { ...m, tone: 'calm', kicker: esc(d.leaveType || 'Leave'), head: 'You are on leave', sub: 'Your leave was approved. Take care.', ribbon: false };
    }

    if (d.checkIn) {
      const late = d.status === 'LATE';
      m.tone = late ? 'warn' : 'good';
      m.times = `<div class="today-times">
        <div><span>Check in</span><b>${time12(d.checkIn)}</b></div>
        <div><span>Check out</span><b>${d.checkOut ? time12(d.checkOut) : '—'}</b></div>
        <div><span>Fine</span><b class="${d.fine ? 'bad' : ''}">${rs(d.fine)}</b></div>
      </div>`;
      const explain = late && !d.note ? `<button class="btn btn-ghost" data-act="explain">Tell the admin why you were late</button>` : '';

      if (d.checkOut) {
        return { ...m, kicker: `${icon('checkCircle', 'icon-s')}Done for today`, head: duration(d.hours), sub: `You worked from ${time12(d.checkIn)} to ${time12(d.checkOut)}.`, action: explain ? `<div class="today-action">${explain}</div>` : '' };
      }

      const worked = (n - new Date(d.checkIn)) / 3600000;
      const arrival = me.arrival ? ` You were ${ordinal(me.arrival.position)} to arrive today.` : '';
      m.kicker = late ? `${icon('clock', 'icon-s')}${mins(d.lateMinutes)} late` : `${icon('checkCircle', 'icon-s')}On time`;
      m.head = duration(worked);
      if (nowMin < end) {
        m.sub = `Working now.${arrival} Office closes at <b>${time12(t.endTime)}</b> (${mins(end - nowMin)} left).`;
        m.action = `<div class="today-action"><button class="btn btn-lg btn-block" data-act="checkout" ${canMark ? '' : 'disabled'}>${icon('logout')}Check out</button>${explain}${wifiHint}</div>`;
      } else {
        m.sub = `It's closing time. Check out before you leave, or a <b>${rs(t.missedCheckoutFine)}</b> fine is added.`;
        m.action = `<div class="today-action"><button class="btn btn-primary btn-lg btn-block" data-act="checkout" ${canMark ? '' : 'disabled'}>${icon('logout')}Check out</button>${explain}${wifiHint}</div>`;
      }
      return m;
    }

    if (d.status === 'ABSENT' || d.status === 'PENDING') {
      const pending = d.status === 'PENDING';
      return {
        ...m, tone: pending ? 'calm' : 'bad',
        kicker: pending ? 'Leave request pending' : 'No check-in today',
        head: pending ? 'Waiting for the admin' : 'Marked absent',
        sub: pending ? 'Your leave request is with the admin.' : `If you had a reason, send a leave request. Otherwise a <b>${rs(d.fine)}</b> fine applies.`,
        action: pending ? '' : '<div class="today-action"><button class="btn btn-lg btn-block" data-act="leave">Send a leave request</button></div>'
      };
    }

    // Not checked in yet
    const pendingNote = d.pendingLeave ? `<div class="notice" style="margin-top:12px">${icon('info')}<p>Your leave request for today is pending.</p></div>` : '';
    if (nowMin <= start) {
      const left = start - nowMin;
      if (left > 150) {
        m.kicker = 'Good morning';
        m.head = `Office at ${time12(t.startTime)}`;
        m.sub = `Check in when you arrive. No fine until <b>${time12(hhmm(start))}</b>.`;
      } else {
        m.kicker = `${icon('clock', 'icon-s')}Time left to be on time`;
        m.head = left > 0 ? mins(left) : 'Check in now';
        m.sub = `Check in by <b>${time12(hhmm(start))}</b> for no fine.`;
      }
      m.action = `<div class="today-action"><button class="btn btn-good btn-lg btn-block" data-act="checkin" ${canMark ? '' : 'disabled'}>${icon('login')}Check in</button>${wifiHint}</div>${pendingNote}`;
    } else {
      const lateBy = nowMin - start;
      const slabs = Math.ceil(lateBy / 60);
      const fineNow = slabs * t.finePerHour;
      const nextAt = start + slabs * 60 + 1;
      m.tone = 'warn';
      m.kicker = `${icon('clock', 'icon-s')}${mins(lateBy)} late`;
      m.head = `${rs(fineNow)} fine`;
      m.sub = nextAt < end
        ? `Check in as soon as you can. After <b>${time12(hhmm(nextAt))}</b> it goes up to <b>${rs(fineNow + t.finePerHour)}</b>.`
        : 'Check in as soon as you can.';
      m.action = `<div class="today-action"><button class="btn btn-warn btn-lg btn-block" data-act="checkin" ${canMark ? '' : 'disabled'}>${icon('login')}Check in</button>${wifiHint}</div>${pendingNote}`;
    }
    return m;
  }

  function paintHero() {
    const box = $('#hero');
    if (!box || !state.me) return;
    const m = heroModel();
    const me = state.me;
    box.className = `today s-${m.tone}`;
    box.innerHTML = `
      <p class="today-kicker">${m.kicker}</p>
      <h2 class="today-head">${m.head}</h2>
      <p class="today-sub">${m.sub}</p>
      ${m.ribbon === false || me.today.checkIn ? '' : Ribbon.render({ ...me.timings, now: now(), checkIn: me.today.checkIn, checkOut: me.today.checkOut })}
      ${m.times}
      ${m.action}`;
  }

  view.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'checkin') checkIn(act);
    else if (a === 'checkout') checkOut(act);
    else if (a === 'explain') openRequestForm({ kind: 'excuse', type: 'Late arrival', date: state.me.today.date });
    else if (a === 'leave') openRequestForm({ kind: 'leave', type: 'Emergency', date: state.me.today.date });
    else if (a === 'push-on') turnOnPush(act);
    else if (a === 'push-later') { store(PUSH_DISMISS_KEY, '1'); act.closest('.notice').remove(); }
    else if (a === 'install') install.start('the app');
    else if (a === 'install-later') { store(INSTALL_DISMISS_KEY, '1'); act.closest('.notice').remove(); }
  });

  async function checkIn(btn) {
    const t = state.me.timings;
    const start = toMin(t.startTime) + (t.graceMinutes || 0);
    const lateBy = minOfDay(now()) - start;
    let note = '';
    if (lateBy > 0) {
      const fine = Math.ceil(lateBy / 60) * t.finePerHour;
      const r = await confirmSheet({
        title: `${rs(fine)} fine`,
        sub: `You are ${mins(lateBy)} late. Add a reason and the admin may reduce or waive the fine.`,
        confirm: 'Check in',
        tone: 'warn',
        extra: '<label class="field"><span>Reason (optional)</span><textarea class="input" data-value maxlength="300" placeholder="For example: heavy traffic on the main road"></textarea></label>'
      });
      if (!r.ok) return;
      note = r.value || '';
    }
    await withBusy(btn, async () => {
      btn.textContent = 'Checking in…';
      try {
        const res = await call('/api/me/check-in', { method: 'POST', body: { note } });
        toast(res.message, res.late ? 'warn' : 'good');
        if (navigator.vibrate) navigator.vibrate(30);
        await loadMe();
        renderHome();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  async function checkOut(btn) {
    const t = state.me.timings;
    const left = toMin(t.endTime) - minOfDay(now());
    let note = '';
    if (left > 0) {
      const r = await confirmSheet({
        title: 'Check out early?',
        sub: `Office closes at ${time12(t.endTime)}, ${mins(left)} from now. This will be saved as an early check-out.`,
        confirm: 'Check out',
        extra: '<label class="field"><span>Reason</span><textarea class="input" data-value maxlength="300" placeholder="For example: doctor\'s appointment"></textarea></label>'
      });
      if (!r.ok) return;
      note = r.value || '';
    }
    await withBusy(btn, async () => {
      btn.textContent = 'Checking out…';
      try {
        const res = await call('/api/me/check-out', { method: 'POST', body: { note } });
        toast(res.message, 'good');
        await loadMe();
        renderHome();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  // ---------- Push ----------
  function pushPrompt() {
    const me = state.me;
    if (me.pushOn || store(PUSH_DISMISS_KEY) || push.permission() === 'denied') return '';
    if (!push.supported() || push.needsInstall()) return '';
    return `<div class="notice">${icon('bell')}<div class="grow"><b>Get reminders</b><p>A reminder before office starts, one at closing time, and updates when the admin replies.</p>
      <div class="btn-row" style="margin-top:8px"><button class="btn btn-s btn-primary" data-act="push-on">Turn on</button><button class="btn btn-s btn-ghost" data-act="push-later">Not now</button></div></div></div>`;
  }

  function installCard() {
    if (!install.available() || store(INSTALL_DISMISS_KEY)) return '';
    const ios = install.device().os === 'ios';
    return `<div class="notice">${icon('phone')}<div class="grow"><b>Install the app</b><p>Open it from your ${install.device().os === 'desktop' ? 'desktop' : 'home screen'} like any other app.${ios ? ' On iPhone this is also needed for reminders.' : ''}</p>
      <div class="btn-row" style="margin-top:8px"><button class="btn btn-s btn-primary" data-act="install">${icon('download', 'icon-s')}Install</button><button class="btn btn-s btn-ghost" data-act="install-later">Not now</button></div></div></div>`;
  }

  async function turnOnPush(btn) {
    await withBusy(btn, async () => {
      try {
        await push.enable('/api/me/push/subscribe', token);
        state.me.pushOn = true;
        toast('Notifications are on.');
        if (currentTab() === 'home') renderHome(); else if (currentTab() === 'profile') renderProfile();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  // ---------- Home ----------
  function renderHome() {
    const me = state.me;
    const s = me.month;
    const n = now();
    const wifi = me.wifi;
    const wifiChip = wifi.ipEnforced
      ? `<span class="wifi-line ${wifi.isOfficeWifi ? 'ok' : 'no'}">${icon(wifi.isOfficeWifi ? 'wifi' : 'wifiOff', 'icon-s')}${wifi.isOfficeWifi ? 'Office WiFi' : 'Not on office WiFi'}</span>`
      : '';
    const ann = me.announcement ? `<div class="notice">${icon('megaphone')}<div><b>${esc(me.announcement.title)}</b>${me.announcement.body ? `<p>${esc(me.announcement.body)}</p>` : ''}</div></div>` : '';
    const due = me.fines.totalDue;

    const streak = me.streak.current > 0
      ? `<div class="streak"><div class="streak-num">${icon('flame')}${me.streak.current}</div><div><b>${me.streak.current === 1 ? 'day' : 'days in a row'} on time</b><p class="muted small">Best: ${me.streak.best} day${me.streak.best === 1 ? '' : 's'}</p></div></div>`
      : `<div class="streak cold"><div class="streak-num">${icon('flame')}0</div><div><b>Start a new streak</b><p class="muted small">Arrive before ${time12(me.timings.startTime)} on your next working day.</p></div></div>`;
    const tip = me.insights[0] ? `<div class="tip ${me.insights[0].tone}" style="margin-top:8px;padding-bottom:0"><i></i><p>${esc(me.insights[0].text)}</p></div>` : '';

    view.innerHTML = `
      <div class="hello">
        <h2>${greeting(n)}, ${esc(firstName(me.employee.name))}</h2>
        <p><span>${n.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>${wifiChip}</p>
      </div>
      ${ann}
      <section id="hero" class="today" aria-live="polite"></section>
      ${installCard()}
      ${pushPrompt()}
      <section class="card">
        <div class="card-head"><h3>${n.toLocaleDateString('en-GB', { month: 'long' })} so far</h3><a href="#history">Details</a></div>
        <div class="stats">
          <div class="stat"><b>${s.present}</b><span>Present</span></div>
          <div class="stat"><b class="${s.late ? 'warn' : ''}">${s.late}</b><span>Late</span></div>
          <div class="stat"><b class="${s.absent ? 'bad' : ''}">${s.absent}</b><span>Absent</span></div>
          <div class="stat"><b class="${s.finalFine ? 'bad' : ''}">${rs(s.finalFine)}</b><span>Fine</span></div>
        </div>
        ${due ? `<a class="row" href="#profile" style="margin-top:8px;border-top:1px solid var(--line)">${icon('wallet')}<span class="grow"><span class="title">Fine to pay</span><span class="sub">All months, after payments</span></span><b class="bad nowrap">${rs(due)}</b></a>` : ''}
      </section>
      <section class="card">${streak}${tip}</section>
      ${me.nextHoliday ? `<section class="card"><div class="streak">${icon('party')}<div><b>${esc(me.nextHoliday.name)}</b><p class="muted small">Holiday on ${dateLong(me.nextHoliday.date)}</p></div></div></section>` : ''}`;
    paintHero();
  }

  function openDay(d) {
    const canExplain = d.date <= state.me.today.date && (d.status === 'LATE' || d.status === 'ABSENT' || d.missedCheckout || d.earlyCheckout);
    const s = sheet({
      title: dateLong(d.date),
      body: `${dayDetailHtml(d)}${canExplain ? '<div class="sheet-actions"><button class="btn btn-primary" data-explain>Send a reason to the admin</button></div>' : ''}`
    });
    const b = s.el.querySelector('[data-explain]');
    if (b) b.addEventListener('click', () => {
      s.close();
      if (d.status === 'ABSENT') openRequestForm({ kind: 'leave', type: 'Emergency', date: d.date });
      else openRequestForm({ kind: 'excuse', type: d.missedCheckout ? 'Missed check-out' : d.earlyCheckout && d.status !== 'LATE' ? 'Early check-out' : 'Late arrival', date: d.date });
    });
  }

  // ---------- History ----------
  async function renderHistory() {
    const month = state.historyMonth || state.me.today.date.slice(0, 7);
    state.historyMonth = month;
    const thisMonth = state.me.today.date.slice(0, 7);
    view.innerHTML = `
      <div class="month-bar">
        <button class="icon-btn" data-m="-1" aria-label="Previous month">${icon('left')}</button>
        <h2>${monthName(month + '-01')}</h2>
        <button class="icon-btn" data-m="1" aria-label="Next month" ${month >= thisMonth ? 'disabled' : ''}>${icon('right')}</button>
      </div>
      <section class="card" id="calBox"><div class="skeleton" style="height:300px"></div></section>
      <section class="card" id="sumBox"><div class="skeleton" style="height:60px"></div></section>
      <section class="card" id="issueBox" hidden></section>`;
    view.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
      const d = H.keyToDate(month + '-01');
      d.setMonth(d.getMonth() + Number(b.dataset.m));
      state.historyMonth = dateKey(d).slice(0, 7);
      renderHistory();
    }));

    try {
      const r = await call(`/api/me/history?month=${month}`);
      if (currentTab() !== 'history' || state.historyMonth !== month) return;
      const s = r.summary;
      const due = Math.max(0, s.finalFine - (r.paid || 0));
      $('#calBox').innerHTML = '';
      $('#calBox').appendChild(calendar(r.days, { todayKey: state.me.today.date, onPick: openDay }));
      $('#sumBox').innerHTML = `
        <div class="stats">
          <div class="stat"><b>${s.present}</b><span>Present</span></div>
          <div class="stat"><b class="${s.late ? 'warn' : ''}">${s.late}</b><span>Late</span></div>
          <div class="stat"><b class="${s.absent ? 'bad' : ''}">${s.absent}</b><span>Absent</span></div>
          <div class="stat"><b>${s.leave}</b><span>Leave</span></div>
        </div>
        <div style="margin-top:10px">
          <div class="kv"><span>Total fine</span><b>${rs(s.finalFine)}</b></div>
          ${s.autoFine !== s.finalFine ? `<div class="kv"><span>Waived by admin</span><b class="good">${rs(s.autoFine - s.finalFine)}</b></div>` : ''}
          ${s.finalFine ? `<div class="kv"><span>Paid</span><b class="good">${rs(r.paid || 0)}</b></div><div class="kv"><span>Still to pay</span><b class="${due ? 'bad' : 'good'}">${due ? rs(due) : 'Nothing'}</b></div>` : ''}
          <div class="kv"><span>Hours worked</span><b>${s.hours}h</b></div>
          ${s.avgCheckIn ? `<div class="kv"><span>Usual arrival</span><b>${time12(s.avgCheckIn)}</b></div>` : ''}
        </div>`;
      const box = $('#issueBox');
      box.hidden = false;
      box.innerHTML = r.issues.length
        ? `<div class="card-head"><h3>Things to note</h3></div><div class="list">${r.issues.map(i => `
            <div class="row"><div class="grow"><span class="title">${esc(i.type)}</span><span class="sub">${dateMed(i.date)}${i.detail ? `, ${esc(i.detail)}` : ''}</span></div>${i.fine ? `<b class="nowrap">${rs(i.fine)}</b>` : ''}</div>`).join('')}</div>`
        : `<div class="empty"><h3>All good</h3><p>Nothing to note this month.</p></div>`;
    } catch (err) {
      $('#calBox').innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    }
  }

  // ---------- Requests ----------
  async function renderRequests() {
    view.innerHTML = `
      <button class="btn btn-primary btn-lg btn-block" id="newReq">${icon('plus')}New request</button>
      <section class="card" id="reqList"><div class="skeleton" style="height:120px"></div></section>`;
    $('#newReq').addEventListener('click', () => openRequestForm({}));
    try {
      const r = await call('/api/me/requests');
      if (currentTab() !== 'requests') return;
      const list = r.requests;
      $('#reqList').innerHTML = list.length ? `<div>${list.map(l => `
        <div class="req">
          <div class="req-top">
            <div><b>${esc(l.type)}</b><div class="muted small">${l.end_date && l.end_date !== l.date ? `${dateShort(l.date)} – ${dateShort(l.end_date)}` : dateMed(l.date)}, sent ${ago(l.created_at)}</div></div>
            ${pill(l.status, l.status === 'PENDING' ? 'Pending' : undefined)}
          </div>
          <p>${esc(l.reason)}</p>
          ${l.admin_note ? `<div class="reply"><b>Admin:</b> ${esc(l.admin_note)}</div>` : ''}
          ${l.status === 'PENDING' ? `<button class="btn btn-s btn-ghost btn-danger" data-cancel="${esc(l.id)}" style="margin:6px 0 0 -12px">Cancel request</button>` : ''}
        </div>`).join('')}</div>`
        : `<div class="empty"><h3>No requests yet</h3><p>Need a day off, or want to explain a late day? Send a request.</p></div>`;
      $('#reqList').querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Cancel this request?', sub: 'The admin will no longer see it.', confirm: 'Cancel request', tone: 'solid-danger' });
        if (!ok.ok) return;
        try { const res = await call(`/api/me/requests/${b.dataset.cancel}`, { method: 'DELETE' }); toast(res.message); renderRequests(); } catch (err) { toast(err.message, 'bad'); }
      }));
    } catch (err) {
      $('#reqList').innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    }
  }

  function openRequestForm({ kind = 'leave', type, date }) {
    const today = state.me.today.date;
    const leaveTypes = ['Sick leave', 'Casual leave', 'Annual leave', 'Field work', 'Emergency'];
    const excuseTypes = ['Late arrival', 'Missed check-out', 'Early check-out', 'Other'];
    let k = kind;
    let chosen = type || (k === 'leave' ? 'Casual leave' : 'Late arrival');

    const s = sheet({ title: 'New request', sub: 'The admin gets it right away.', body: '<form id="reqForm" novalidate></form>' });
    const form = s.el.querySelector('#reqForm');
    function paint() {
      const types = k === 'leave' ? leaveTypes : excuseTypes;
      if (!types.includes(chosen)) chosen = types[0];
      form.innerHTML = `
        <div class="seg" role="group" aria-label="Request type" style="margin-bottom:16px">
          <button type="button" data-k="leave" aria-pressed="${k === 'leave'}">Leave</button>
          <button type="button" data-k="excuse" aria-pressed="${k === 'excuse'}">Explain a day</button>
        </div>
        <div class="field"><span>Type</span><div class="chips">${types.map(t => `<button type="button" class="chip" data-t="${t}" aria-pressed="${t === chosen}">${t}</button>`).join('')}</div></div>
        ${k === 'leave'
          ? `<div class="row-2"><label class="field"><span>From</span><input class="input" type="date" name="date" value="${date || today}" required></label><label class="field"><span>To</span><input class="input" type="date" name="end_date" value="${date || today}"></label></div>`
          : `<label class="field"><span>Which day</span><input class="input" type="date" name="date" value="${date || today}" max="${today}" required></label>`}
        <label class="field"><span>Reason</span><textarea class="input" name="reason" maxlength="600" required placeholder="${k === 'leave' ? 'For example: I have a fever, the doctor advised rest' : 'For example: my bike had a flat tyre'}"></textarea></label>
        <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">${icon('send', 'icon-s')}Send</button></div>`;
    }
    paint();
    form.addEventListener('click', e => {
      const kb = e.target.closest('[data-k]');
      const tb = e.target.closest('[data-t]');
      if (kb) { const reason = form.reason.value; k = kb.dataset.k; paint(); form.reason.value = reason; }
      if (tb) { chosen = tb.dataset.t; form.querySelectorAll('[data-t]').forEach(c => c.setAttribute('aria-pressed', c.dataset.t === chosen)); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = { kind: k, type: chosen, date: form.date.value, end_date: form.end_date ? form.end_date.value : undefined, reason: form.reason.value };
      if (body.reason.trim().length < 3) { toast('Please write a short reason.', 'warn'); form.reason.focus(); return; }
      await withBusy(e.submitter, async () => {
        try {
          const res = await call('/api/me/requests', { method: 'POST', body });
          toast(res.message);
          s.close();
          await loadMe().catch(() => {});
          if (currentTab() === 'requests') renderRequests();
          else if (currentTab() === 'home') renderHome();
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // ---------- Profile ----------
  async function renderProfile() {
    const me = state.me;
    const e = me.employee;
    const t = me.timings;
    const f = me.fines;
    const theme = store(THEME_KEY) || 'system';
    const off = (t.weeklyOffDays || []).map(d => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]).join(', ') || 'None';
    const sub = await push.current().catch(() => null);
    const pushOn = !!sub && push.permission() === 'granted';
    const pushHelp = push.needsInstall()
      ? 'On iPhone: tap Share, then "Add to Home Screen". Open the app from there to turn this on.'
      : !push.supported() ? 'This browser does not support notifications.'
      : push.permission() === 'denied' ? 'Blocked in browser settings. Allow notifications for this site first.'
      : 'Reminders to check in and out, and replies from the admin.';

    view.innerHTML = `
      <div class="profile-head">${avatar(e, 'avatar-l')}<div class="grow"><h2>${esc(e.name)}</h2><p class="muted">${esc(e.designation || '')}${e.department ? `, ${esc(e.department)}` : ''}</p></div></div>

      <section class="card">
        <div class="card-head"><h3>Fines</h3>${f.totalDue ? pill('DUE', `${rs(f.totalDue)} to pay`) : pill('PAID', 'All paid')}</div>
        ${f.months.filter(m => m.fine || m.paid).length ? f.months.filter(m => m.fine || m.paid).map(m => `
          <div class="kv"><span>${monthName(m.month + '-01')}</span><span class="nowrap">${rs(m.fine)}${m.paid ? ` <span class="good small">− ${rs(m.paid)} paid</span>` : ''}${m.due ? '' : ' <span class="good small">✓</span>'}</span></div>`).join('')
          : '<p class="muted">No fines. Keep it up.</p>'}
        ${f.totalDue ? '<p class="muted small" style="margin-top:8px">Pay the admin. They will mark it as paid here.</p>' : ''}
      </section>

      ${install.isStandalone() ? '' : `<section class="card"><button class="row" data-act="install" style="padding:0;min-height:44px">${icon('download')}<span class="grow"><span class="title">Install the app</span><span class="sub">Get an icon on your ${install.device().os === 'desktop' ? 'desktop' : 'home screen'}</span></span>${icon('right', 'chev')}</button></section>`}

      <section class="card">
        <label class="switch-row" style="padding-top:0">
          ${icon(pushOn ? 'bell' : 'bellOff')}
          <span class="grow"><b>Notifications</b><span>${pushHelp}</span></span>
          <span class="switch"><input type="checkbox" id="pushToggle" ${pushOn ? 'checked' : ''} ${!push.supported() || push.permission() === 'denied' ? 'disabled' : ''} aria-label="Notifications"><i></i></span>
        </label>
      </section>

      <section class="card">
        <div class="kv"><span>Employee code</span><b>${esc(e.code)}</b></div>
        ${e.phone ? `<div class="kv"><span>Phone</span><span>${esc(e.phone)}</span></div>` : ''}
        ${e.joined_on ? `<div class="kv"><span>Joined</span><span>${H.keyToDate(e.joined_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>` : ''}
        <div class="kv"><span>Office hours</span><span>${time12(t.startTime)} – ${time12(t.endTime)}</span></div>
        <div class="kv"><span>Weekly off</span><span>${off}</span></div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Fine rules</h3></div>
        <div class="kv"><span>Check in by ${time12(t.startTime)}${t.graceMinutes ? ` (+${t.graceMinutes} min)` : ''}</span><b>Rs 0</b></div>
        <div class="kv"><span>Each hour late (even 1 minute)</span><b>${rs(t.finePerHour)}</b></div>
        <div class="kv"><span>Forgot to check out</span><b>${rs(t.missedCheckoutFine)}</b></div>
        <div class="kv"><span>Absent without leave</span><b>${rs(t.absentFine)}</b></div>
        <p class="muted small" style="margin-top:6px">Check-in only works on the office WiFi. The admin can reduce or waive any fine.</p>
      </section>

      <section class="card">
        <div class="card-head"><h3>Appearance</h3></div>
        <div class="seg" role="group" aria-label="Theme">
          ${['system', 'light', 'dark'].map(v => `<button type="button" data-theme-set="${v}" aria-pressed="${theme === v}">${v === 'system' ? 'Auto' : v === 'light' ? 'Light' : 'Dark'}</button>`).join('')}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Change PIN</h3></div>
        <form id="pinForm" novalidate>
          <div class="row-2">
            <label class="field"><span>Current PIN</span><input class="input" name="current" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" required></label>
            <label class="field"><span>New PIN</span><input class="input" name="next" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required></label>
          </div>
          <button class="btn btn-block" type="submit">Save new PIN</button>
        </form>
      </section>

      <button class="btn btn-block btn-danger" id="signOut">${icon('logout')}Sign out</button>`;

    view.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.themeSet;
      store(THEME_KEY, v === 'system' ? null : v);
      applyTheme(v);
      view.querySelectorAll('[data-theme-set]').forEach(x => x.setAttribute('aria-pressed', x === b));
    }));
    $('#pushToggle').addEventListener('change', async ev => {
      const box = ev.target;
      box.disabled = true;
      try {
        if (box.checked) { await push.enable('/api/me/push/subscribe', token); state.me.pushOn = true; toast('Notifications are on.'); }
        else { await push.disable('/api/me/push/unsubscribe', token); state.me.pushOn = false; toast('Notifications are off.'); }
      } catch (err) { box.checked = !box.checked; toast(err.message, 'bad'); }
      box.disabled = false;
    });
    $('#signOut').addEventListener('click', async () => {
      const r = await confirmSheet({ title: 'Sign out?', sub: 'You will need your code and PIN to sign in again.', confirm: 'Sign out', tone: 'solid-danger' });
      if (r.ok) signOut();
    });
    $('#pinForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const fm = ev.target;
      if (!/^\d{4,6}$/.test(fm.next.value)) { toast('The new PIN must be 4 to 6 digits.', 'warn'); return; }
      await withBusy(ev.submitter, async () => {
        try {
          const res = await call('/api/me/pin', { method: 'POST', body: { current_pin: fm.current.value, new_pin: fm.next.value } });
          token = res.token;
          store(TOKEN_KEY, token);
          fm.reset();
          toast(res.message);
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // ---------- Notifications ----------
  async function openNotifications() {
    const s = sheet({ title: 'Notifications', body: '<div class="skeleton" style="height:120px"></div>' });
    try {
      const r = await call('/api/me/notifications');
      const seen = r.seenAt || '';
      s.body.innerHTML = r.notifications.length ? `<div>${r.notifications.map(n => `
        <div class="ntf ${esc(n.kind)} ${n.created_at <= seen ? 'seen' : ''}"><i></i><div><b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}<small>${n.kind === 'announcement' ? 'Announcement, ' : ''}${ago(n.created_at)}</small></div></div>`).join('')}</div>`
        : '<div class="empty"><h3>You\'re all caught up</h3><p>Admin replies and announcements show up here.</p></div>';
      if (r.unread) {
        await call('/api/me/notifications/seen', { method: 'POST' });
        state.me.unread = 0;
        paintChrome();
      }
    } catch (err) {
      s.body.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    }
  }

  // ---------- Boot ----------
  (async function boot() {
    push.register();
    // Try the saved session first (token or cookie). Only show sign-in if the server says so.
    try {
      const me = await api('/api/me', { token });
      syncClock(me.serverTime);
      state.me = me;
      state.lastFetch = Date.now();
      showApp();
    } catch (err) {
      if (err.status === 401) { token = null; store(TOKEN_KEY, null); return showLogin(); }
      if (token && err.status === 0) {
        // Offline: stay signed in and offer a retry instead of the sign-in form.
        $('#login').hidden = true;
        $('#app').hidden = false;
        view.innerHTML = `<div class="empty" style="padding-top:80px"><h3>You are offline</h3><p>${esc(err.message)}</p><button class="btn btn-primary" style="margin-top:14px" id="retryBtn">Try again</button></div>`;
        $('#retryBtn').addEventListener('click', () => location.reload());
        return;
      }
      showLogin(token ? err.message : '');
    }
  })();
})();
