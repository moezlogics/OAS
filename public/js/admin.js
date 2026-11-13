/* Admin panel: today, attendance, team, requests, fines, reports, settings. */
(function () {
  'use strict';
  const { icon, esc, time12, dateLong, dateMed, dateShort, monthName, rs, duration, mins, ago, greeting, firstName, avatar, pill, fineHtml, api, toast, sheet, confirmSheet, withBusy, calendar, dayDetailHtml, store, applyTheme, THEME_KEY, dateKey, addDays, keyToDate, STATUS, push, install } = window.H;

  const TOKEN_KEY = 'hazri.admin.token';
  let token = store(TOKEN_KEY);
  const $ = s => document.querySelector(s);
  const view = $('#view');
  const state = { today: dateKey(new Date()), officeName: 'Attendance', employees: null, authed: false };
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let refreshTimer = null;

  H.setSessionHandler(t => { token = t; store(TOKEN_KEY, t); });

  // ---------- Install as an app ----------
  const INSTALL_DISMISS_KEY = 'hazri.adminInstallAsked';
  const APP_NAME = 'the admin app';
  function paintInstall() {
    document.querySelectorAll('[data-install]').forEach(b => { b.hidden = install.isStandalone(); });
  }
  document.querySelectorAll('[data-install]').forEach(b => b.addEventListener('click', () => install.start(APP_NAME)));
  install.onChange(() => { paintInstall(); if (state.authed && (parts()[0] || 'dashboard') === 'dashboard') renderDashboard(); });
  function installCard() {
    if (!install.available() || store(INSTALL_DISMISS_KEY)) return '';
    const where = install.device().os === 'desktop' ? 'its own window with a desktop icon' : 'an icon on your home screen';
    return `<div class="notice">${icon('download')}<div class="grow"><b>Install the admin app</b><p>Opens in ${where}. Best for notifications.</p>
      <div class="btn-row" style="margin-top:8px"><button class="btn btn-s btn-primary" data-act="install">Install</button><button class="btn btn-s btn-ghost" data-act="install-later">Not now</button></div></div></div>`;
  }
  const paintIcons = root => root.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
  paintIcons(document);
  paintInstall();

  async function call(path, opts = {}) {
    try {
      return await api(`/api/admin${path}`, { ...opts, token });
    } catch (err) {
      if (err.status === 401) signOut();
      throw err;
    }
  }

  // ---------- Sign in ----------
  function showLogin(msg) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    const err = $('#loginError');
    err.textContent = msg || '';
    err.hidden = !msg;
    $('#loginForm').username.focus();
  }
  async function signOut() {
    const sub = await push.current().catch(() => null);
    token = null;
    state.authed = false;
    store(TOKEN_KEY, null);
    clearInterval(refreshTimer);
    api('/api/admin/logout', { method: 'POST', body: sub ? { endpoint: sub.endpoint } : {} }).catch(() => {});
    if (sub) sub.unsubscribe().catch(() => {});
    showLogin();
  }
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const err = $('#loginError');
    err.hidden = true;
    await withBusy(e.submitter, async () => {
      try {
        const res = await api('/api/admin/login', { method: 'POST', body: { username: f.username.value.trim(), password: f.password.value } });
        token = res.token;
        store(TOKEN_KEY, token);
        f.password.value = '';
        showApp();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  });
  async function confirmSignOut() {
    const r = await confirmSheet({ title: 'Sign out?', sub: 'Notifications on this device will stop.', confirm: 'Sign out', tone: 'solid-danger' });
    if (r.ok) signOut();
  }
  document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', confirmSignOut));

  function showApp() {
    state.authed = true;
    $('#login').hidden = true;
    $('#app').hidden = false;
    route();
    push.sync('/api/admin/push/subscribe', token);
  }

  function setOffice(name) {
    state.officeName = name || 'Attendance';
    document.querySelectorAll('[data-office]').forEach(el => { el.textContent = state.officeName; });
    document.title = `Admin · ${state.officeName}`;
  }
  function setPending(n) {
    document.querySelectorAll('[data-pending]').forEach(el => { el.textContent = n; el.hidden = !n; });
  }

  // Page header: a title row on desktop, the top bar + icon buttons on phones.
  function head(title, sub = '', tools = '', mobileTools = '') {
    $('#pageTitle').textContent = title;
    $('#topActions').innerHTML = mobileTools;
    return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${tools ? `<div class="page-tools">${tools}</div>` : ''}</div>`;
  }
  const iconBtn = (act, name, label) => `<button class="icon-btn" data-act="${act}" aria-label="${esc(label)}">${icon(name)}</button>`;

  // ---------- Router ----------
  const parts = () => location.hash.replace('#', '').split('/');
  const TABS = { dashboard: 'Home', attendance: 'Attendance', team: 'Team', requests: 'Requests', fines: 'Fines', reports: 'Reports', settings: 'Settings' };
  function route() {
    if (!state.authed) return showLogin();
    const [tab = 'dashboard', arg] = parts();
    const t = TABS[tab] ? tab : 'dashboard';
    const inMore = ['fines', 'reports', 'settings'].includes(t);
    $('#pageTitle').textContent = TABS[t];
    $('#topActions').innerHTML = '';
    document.querySelectorAll('[data-tab]').forEach(a => {
      const on = a.dataset.tab === t || (a.dataset.tab === 'more' && inMore);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    clearInterval(refreshTimer);
    window.scrollTo(0, 0);
    const views = { dashboard: renderDashboard, attendance: renderAttendance, team: renderTeam, requests: renderRequests, fines: renderFines, reports: renderReports, settings: renderSettings };
    views[t](arg);
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', () => $('.mtop')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });

  $('#moreBtn').addEventListener('click', () => {
    const s = sheet({
      title: 'More',
      body: `<div class="list more-list">
        <a class="row" href="#fines">${icon('wallet')}<span class="grow">Fines</span>${icon('right', 'chev')}</a>
        <a class="row" href="#reports">${icon('chart')}<span class="grow">Reports</span>${icon('right', 'chev')}</a>
        <a class="row" href="#settings">${icon('settings')}<span class="grow">Settings</span>${icon('right', 'chev')}</a>
        ${install.isStandalone() ? '' : `<button class="row" data-inst>${icon('download')}<span class="grow">Install app</span></button>`}
        <button class="row" data-out>${icon('logout')}<span class="grow">Sign out</span></button>
      </div>`
    });
    s.el.querySelectorAll('a.row').forEach(a => a.addEventListener('click', () => s.close()));
    s.el.querySelector('[data-out]').addEventListener('click', () => { s.close(); confirmSignOut(); });
    s.el.querySelector('[data-inst]')?.addEventListener('click', () => { s.close(); install.start(APP_NAME); });
  });

  function loading(h = 240) { view.innerHTML = `<div class="skeleton" style="height:${h}px;margin-top:8px"></div>`; }
  function failed(err) { view.innerHTML = `<div class="empty"><h3>Could not load</h3><p>${esc(err.message)}</p><button class="btn" style="margin-top:12px" data-act="reload">Try again</button></div>`; }

  async function employees(force = false) {
    if (!state.employees || force) state.employees = (await call('/employees')).employees;
    return state.employees;
  }

  // Shared click handling inside the view and the top bar.
  function onAct(e) {
    const p = e.target.closest('[data-profile]');
    if (p) return openProfile(p.dataset.profile);
    const r = e.target.closest('[data-review]');
    if (r) return reviewRequest(r.dataset.review, r.dataset.st);
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'reload') location.reload();
    if (act === 'announce') openAnnouncement();
    if (act === 'manual') openManual({});
    if (act === 'add-emp') openEmployeeForm();
    if (act === 'push-on') enablePush(a);
    if (act === 'install') install.start(APP_NAME);
    if (act === 'install-later') { store(INSTALL_DISMISS_KEY, '1'); a.closest('.notice').remove(); }
  }
  view.addEventListener('click', onAct);
  $('#topActions').addEventListener('click', onAct);

  async function enablePush(btn) {
    await withBusy(btn, async () => {
      try {
        await push.enable('/api/admin/push/subscribe', token);
        toast('Notifications are on for this device.');
        route();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }
  async function pushCard() {
    if (push.permission() === 'denied') return '';
    if (!push.supported() && !push.needsInstall()) return '';
    const sub = await push.current().catch(() => null);
    if (sub && push.permission() === 'granted') return '';
    return `<div class="notice">${icon('bell')}<div class="grow"><b>Get notified on this device</b><p>New leave requests, late check-ins, a morning summary and missed check-outs.</p>
      <button class="btn btn-s btn-primary" data-act="push-on">Turn on notifications</button></div></div>`;
  }

  // =====================================================================
  // Home
  // =====================================================================
  async function renderDashboard() {
    if (!view.querySelector('.big-stats')) loading(320);
    let d;
    try { d = await call('/dashboard'); } catch (err) { return failed(err); }
    if (parts()[0] && parts()[0] !== 'dashboard') return;
    setOffice(d.officeName);
    setPending(d.pendingCount);
    state.today = d.today;
    const s = d.summary;
    const now = new Date();
    const expected = s.totalEmployees - s.leave;

    const order = { LATE: 0, NOT_YET: 1, ABSENT: 2, PENDING: 3, PRESENT: 4, LEAVE: 5, OFF: 6, HOLIDAY: 7, NA: 8 };
    const board = [...d.board].sort((a, b) => (order[a.day.status] ?? 9) - (order[b.day.status] ?? 9) || a.employee.name.localeCompare(b.employee.name));
    const rows = board.map(({ employee: e, day }) => {
      const sub = day.checkIn ? `In ${time12(day.checkIn)}${day.checkOut ? `, out ${time12(day.checkOut)}` : ''}` : esc(e.designation || '');
      return `<button class="row" data-profile="${esc(e.id)}">${avatar(e)}<span class="grow"><span class="title">${esc(e.name)}</span><span class="sub">${sub}</span></span><span class="end">${pill(day.status, day.status === 'LATE' ? `${mins(day.lateMinutes)} late` : undefined)}${day.fine ? `<span class="small">${fineHtml(day)}</span>` : ''}</span></button>`;
    }).join('');

    const pend = d.pending.map(l => `
      <div class="req">
        <div class="who">${avatar({ name: l.employee_name, avatar_color: (d.board.find(b => b.employee.id === l.employee_id) || {}).employee?.avatar_color })}
          <div class="grow"><b>${esc(l.employee_name)}</b><small>${esc(l.type)}, ${l.end_date !== l.date ? `${dateShort(l.date)} – ${dateShort(l.end_date)}` : dateMed(l.date)}</small></div></div>
        <p style="margin:8px 0">${esc(l.reason)}</p>
        <div class="btn-row"><button class="btn btn-s btn-good" data-review="${esc(l.id)}" data-st="APPROVED">${icon('check', 'icon-s')}Approve</button><button class="btn btn-s" data-review="${esc(l.id)}" data-st="REJECTED">Reject</button></div>
      </div>`).join('');

    const pwNote = s.passwordIsInitial ? `<div class="notice bad">${icon('lock')}<div class="grow"><b>Change the first admin password</b><p>You are still using the password from setup.</p><a class="btn btn-s btn-primary" href="#settings">Change it now</a></div></div>` : '';
    const offNote = d.isOffDay && !s.present ? `<div class="notice">${icon('party')}<p><b>${esc(d.holidayName || 'Day off')}</b> The office is closed today.</p></div>` : '';
    const promo = installCard() || await pushCard();

    view.innerHTML = `
      ${head('Home', `${greeting(now)}. ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`,
        `<button class="btn btn-s" data-act="announce">${icon('megaphone', 'icon-s')}Announcement</button><button class="btn btn-s btn-primary" data-act="manual">${icon('plus', 'icon-s')}Add attendance</button>`,
        iconBtn('announce', 'megaphone', 'Send announcement') + iconBtn('manual', 'plus', 'Add attendance'))}
      ${pwNote}
      ${offNote}
      <div class="big-stats">
        <a class="big-stat" href="#attendance"><b class="good">${s.present}<span style="display:inline;font-size:18px;color:var(--muted)"> / ${expected}</span></b><span>In office</span></a>
        <a class="big-stat" href="#attendance"><b class="${s.late ? 'warn' : ''}">${s.late}</b><span>Late</span></a>
        <a class="big-stat" href="#attendance"><b>${s.notYet}</b><span>Not in yet</span></a>
        <a class="big-stat" href="#attendance"><b class="${s.absent ? 'bad' : ''}">${s.absent}</b><span>Absent${s.leave ? `, ${s.leave} on leave` : ''}</span></a>
      </div>
      ${promo}
      <div class="cols">
        <div class="col">
          ${d.pendingCount ? `<section class="card"><div class="card-head"><h3>Needs your decision (${d.pendingCount})</h3>${d.pendingCount > d.pending.length ? '<a href="#requests">See all</a>' : ''}</div>${pend}</section>` : ''}
          <section class="card flush">
            <div class="card-head"><h3>Today</h3><a href="#attendance">Full list</a></div>
            <div class="list">${rows || '<div class="empty"><p>Add people in Team first.</p></div>'}</div>
          </section>
        </div>
        <div class="col">
          <section class="card">
            <div class="card-head"><h3>Fines</h3><a href="#fines">Collect</a></div>
            <div class="stats three">
              <div class="stat"><b>${rs(s.finesToday)}</b><span>Today</span></div>
              <div class="stat"><b>${rs(s.finesMonth)}</b><span>This month</span></div>
              <div class="stat"><b class="${s.finesDueMonth ? 'bad' : 'good'}">${rs(s.finesDueMonth)}</b><span>Not paid</span></div>
            </div>
            <div style="margin-top:8px">
              <div class="kv"><span>On time this month</span><b>${s.punctualityMonth === null ? '—' : s.punctualityMonth + '%'}</b></div>
              <div class="kv"><span>Checked out today</span><b>${s.checkedOut} of ${s.present}</b></div>
            </div>
          </section>
          ${d.insights.length ? `<section class="card"><div class="card-head"><h3>Worth a look</h3></div>${d.insights.map(i => `<div class="tip ${i.tone}"><i></i><p>${esc(i.text)}</p></div>`).join('')}</section>` : ''}
        </div>
      </div>`;

    refreshTimer = setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.overlay')) renderDashboard(); }, 60000);
  }

  // =====================================================================
  // Attendance (any date)
  // =====================================================================
  let attFilter = 'all';
  async function renderAttendance(arg) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : state.today;
    loading(300);
    let d;
    try { d = await call(`/attendance?date=${date}`); } catch (err) { return failed(err); }
    if (parts()[0] !== 'attendance') return;

    const filters = [['all', 'All'], ['PRESENT', 'On time'], ['LATE', 'Late'], ['NOT_YET', 'Not in yet'], ['ABSENT', 'Absent'], ['LEAVE', 'Leave'], ['fined', 'With fine']];
    function matches(r, f) {
      if (f === 'all') return true;
      if (f === 'fined') return r.day.fine > 0;
      if (f === 'LEAVE') return r.day.status === 'LEAVE' || r.day.status === 'PENDING';
      return r.day.status === f;
    }
    const count = f => d.rows.filter(r => matches(r, f)).length;
    const dateNav = `<div class="date-nav">
        <button class="icon-btn" data-go="${addDays(d.date, -1)}" aria-label="Previous day">${icon('left')}</button>
        <input type="date" value="${d.date}" max="${state.today}" aria-label="Pick a date" id="attDate">
        <button class="icon-btn" data-go="${addDays(d.date, 1)}" aria-label="Next day" ${d.date >= state.today ? 'disabled' : ''}>${icon('right')}</button>
      </div>`;

    view.innerHTML = `
      ${head('Attendance', `${dateLong(d.date)}${d.isToday ? ' (today)' : ''}`,
        `${d.isToday ? '' : `<button class="btn btn-s" data-go="${state.today}">Today</button>`}<button class="btn btn-s btn-primary" data-act="manual">${icon('plus', 'icon-s')}Add attendance</button>`,
        iconBtn('manual', 'plus', 'Add attendance'))}
      <div style="display:flex;gap:8px">${dateNav}${d.isToday ? '' : `<button class="btn" data-go="${state.today}">Today</button>`}</div>
      <div class="chips scroll" role="group" aria-label="Filter">${filters.map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${attFilter === k}">${l}<b>${count(k)}</b></button>`).join('')}</div>
      ${count('fined') ? `<button class="btn btn-s btn-ghost" id="waiveDay" style="justify-self:start">Waive all fines on this day (${rs(d.rows.reduce((t, r) => t + (r.day.fine || 0), 0))})</button>` : ''}
      <section class="card flush" id="attList"></section>`;

    function paint() {
      const rows = d.rows.filter(r => matches(r, attFilter));
      const box = $('#attList');
      if (!rows.length) { box.innerHTML = '<div class="empty"><p>No one here.</p></div>'; return; }
      const fineable = r => ['PRESENT', 'LATE', 'ABSENT'].includes(r.day.status);
      const notes = r => [r.day.note ? `<b>Reason:</b> ${esc(r.day.note)}` : '', r.day.checkoutNote ? `<b>Left early:</b> ${esc(r.day.checkoutNote)}` : '', r.day.fineNote ? `<b>Note:</b> ${esc(r.day.fineNote)}` : '', r.day.reason ? esc(r.day.reason) : ''].filter(Boolean).join('<br>');
      const label = r => r.day.status === 'LATE' ? `${mins(r.day.lateMinutes)} late` : r.day.status === 'LEAVE' ? r.day.leaveType : undefined;
      const outCell = r => r.day.checkOut ? time12(r.day.checkOut) + (r.day.earlyCheckout ? ' <span class="warn small">early</span>' : '') : r.day.missedCheckout ? '<span class="bad">Missed</span>' : r.day.checkIn ? 'Still in' : '—';
      box.innerHTML = `<div>${rows.map(r => `
        <div class="att-item">
          <div class="att-top"><button class="who grow" data-profile="${esc(r.employee.id)}">${avatar(r.employee)}<span style="min-width:0"><b>${esc(r.employee.name)}</b><small>${esc(r.employee.designation || r.employee.code)}</small></span></button>${pill(r.day.status, label(r))}</div>
          ${r.day.checkIn || r.day.fine ? `<div class="att-meta"><div><span>In</span>${r.day.checkIn ? time12(r.day.checkIn) : '—'}${r.day.manual ? ' <span class="small">(admin)</span>' : ''}</div><div><span>Out</span>${outCell(r)}</div>${r.day.hours ? `<div><span>Hours</span>${duration(r.day.hours)}</div>` : ''}<div><span>Fine</span>${fineHtml(r.day)}</div></div>` : ''}
          ${notes(r) ? `<div class="note-line">${notes(r)}</div>` : ''}
          <div class="att-actions">${fineable(r) ? `<button class="btn btn-s" data-fine="${esc(r.employee.id)}">Change fine</button>` : ''}<button class="btn btn-s btn-ghost" data-edit="${esc(r.employee.id)}">${icon('edit', 'icon-s')}Edit</button></div>
        </div>`).join('')}</div>`;
    }
    paint();

    view.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { location.hash = `#attendance/${b.dataset.go}`; }));
    $('#waiveDay')?.addEventListener('click', () => waiveFines({ date: d.date }, `all fines on ${dateLong(d.date)}`, () => renderAttendance(d.date)));
    $('#attDate').addEventListener('change', e => { if (e.target.value) location.hash = `#attendance/${e.target.value}`; });
    view.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
      attFilter = b.dataset.filter;
      view.querySelectorAll('[data-filter]').forEach(x => x.setAttribute('aria-pressed', x === b));
      paint();
    }));
    $('#attList').addEventListener('click', e => {
      const f = e.target.closest('[data-fine]');
      const ed = e.target.closest('[data-edit]');
      if (f) { const r = d.rows.find(x => x.employee.id === f.dataset.fine); openFine(r.employee, r.day, () => renderAttendance(d.date)); }
      if (ed) { const r = d.rows.find(x => x.employee.id === ed.dataset.edit); openManual({ employee: r.employee, day: r.day, date: d.date, done: () => renderAttendance(d.date) }); }
    });
    if (d.isToday) refreshTimer = setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.overlay')) renderAttendance(d.date); }, 90000);
  }

  // ---------- Fine decision ----------
  function openFine(emp, day, done) {
    const auto = Number(day.autoFine || 0);
    const current = Number(day.fine || 0);
    const why = [day.note && `Reason: "${esc(day.note)}"`, day.reason && esc(day.reason)].filter(Boolean).join('<br>');
    const s = sheet({
      title: `Fine for ${firstName(emp.name)}`,
      sub: `${dateLong(day.date)}. ${day.status === 'LATE' ? `${mins(day.lateMinutes)} late.` : day.status === 'ABSENT' ? 'Absent.' : 'On time.'}${day.missedCheckout ? ' Did not check out.' : ''}`,
      body: `
        ${why ? `<div class="notice" style="margin-bottom:12px">${icon('info')}<p>${why}</p></div>` : ''}
        <div style="margin-bottom:12px">
          <div class="kv"><span>Fine by the rules</span><b>${rs(auto)}</b></div>
          ${day.adjusted ? `<div class="kv"><span>Current fine</span><b>${rs(current)}</b></div>` : ''}
        </div>
        <form id="fineForm" novalidate>
          <div class="field"><span>New fine</span>
            <div class="chips" style="margin-bottom:8px">
              <button type="button" class="chip" data-amt="0">Waive (Rs 0)</button>
              ${auto ? `<button type="button" class="chip" data-amt="${Math.round(auto / 2)}">Half (${rs(Math.round(auto / 2))})</button><button type="button" class="chip" data-amt="${auto}">Full (${rs(auto)})</button>` : ''}
            </div>
            <input class="input" name="amount" type="number" min="0" step="10" inputmode="numeric" value="${current}" required>
          </div>
          <label class="field"><span>Note for the employee</span><input class="input" name="note" maxlength="200" placeholder="For example: it was raining, waived this time"></label>
          ${day.adjusted ? `<button type="button" class="btn btn-ghost btn-block" data-reset style="margin-top:4px">Use the rules again (${rs(auto)})</button>` : ''}
          <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save fine</button></div>
        </form>`
    });
    const form = s.el.querySelector('#fineForm');
    form.addEventListener('click', async e => {
      const c = e.target.closest('[data-amt]');
      if (c) { form.amount.value = c.dataset.amt; form.querySelectorAll('[data-amt]').forEach(x => x.setAttribute('aria-pressed', x === c)); }
      const r = e.target.closest('[data-reset]');
      if (r) await withBusy(r, async () => {
        try {
          const res = await call('/fine/adjust', { method: 'POST', body: { reset: true, ...(day.attendanceId ? { attendance_id: day.attendanceId } : { employee_code: emp.code, date: day.date }) } });
          toast(res.message); s.close(); done && done();
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try {
          const body = { new_fine: form.amount.value, note: form.note.value, ...(day.attendanceId ? { attendance_id: day.attendanceId } : { employee_code: emp.code, date: day.date }) };
          const res = await call('/fine/adjust', { method: 'POST', body });
          toast(res.message);
          s.close();
          done && done();
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // ---------- Waive many fines at once ----------
  async function waiveFines(body, what, done) {
    const r = await confirmSheet({
      title: 'Waive fines?', sub: `This sets ${what} to Rs 0. Each person gets a notification.`, confirm: 'Waive', tone: 'good',
      extra: '<label class="field"><span>Note for employees (optional)</span><input class="input" data-value maxlength="200" placeholder="For example: heavy rain today"></label>'
    });
    if (!r.ok) return;
    try { toast((await call('/fines/waive', { method: 'POST', body: { ...body, note: r.value } })).message); done && done(); } catch (err) { toast(err.message, 'bad'); }
  }

  // ---------- Manual entry ----------
  async function openManual({ employee, day, date, done }) {
    let list;
    try { list = (await employees()).filter(e => e.status === 'active' || (employee && e.id === employee.id)); } catch (err) { return toast(err.message, 'bad'); }
    const d = day || {};
    const t = x => (x ? new Date(x).toTimeString().slice(0, 5) : '');
    let mode = d.status === 'ABSENT' ? 'absent' : d.status === 'LEAVE' ? 'leave' : 'present';
    const s = sheet({
      title: employee ? `Attendance for ${firstName(employee.name)}` : 'Add attendance',
      sub: 'For a dead phone or a forgotten check-in.',
      body: `<form id="manForm" novalidate>
        <label class="field"><span>Employee</span><select class="input" name="emp" ${employee ? 'disabled' : ''}>${list.map(e => `<option value="${esc(e.code)}" ${employee && e.id === employee.id ? 'selected' : ''}>${esc(e.name)} (${esc(e.code)})</option>`).join('')}</select></label>
        <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${date || state.today}" max="${state.today}"></label>
        <div class="seg" role="group" aria-label="Status" style="margin-bottom:14px"><button type="button" data-mode="present" aria-pressed="${mode === 'present'}">Present</button><button type="button" data-mode="absent" aria-pressed="${mode === 'absent'}">Absent</button><button type="button" data-mode="leave" aria-pressed="${mode === 'leave'}">Leave</button></div>
        <label class="field" data-leave><span>Leave type</span><select class="input" name="leave_type">${['Casual leave', 'Sick leave', 'Annual leave', 'Field work', 'Emergency'].map(t => `<option>${t}</option>`).join('')}</select></label>
        <div class="row-2" data-times><label class="field"><span>Check in</span><input class="input" type="time" name="in" value="${t(d.checkIn) || '09:30'}"></label><label class="field"><span>Check out</span><input class="input" type="time" name="out" value="${t(d.checkOut)}"></label></div>
        <label class="field"><span>Fine</span><input class="input" type="number" min="0" step="10" name="fine" placeholder="Leave empty to use the rules" value="${d.adjusted ? d.fine : ''}"></label>
        <label class="field"><span>Note</span><input class="input" name="note" maxlength="200" placeholder="For example: phone battery was dead"></label>
        <div class="sheet-actions">${d.attendanceId ? '<button type="button" class="btn btn-danger" data-del>Delete record</button>' : '<button type="button" class="btn" data-close>Cancel</button>'}<button class="btn btn-primary" type="submit">Save</button></div>
      </form>`
    });
    const form = s.el.querySelector('#manForm');
    const syncMode = () => { form.querySelector('[data-times]').hidden = mode !== 'present'; form.querySelector('[data-leave]').hidden = mode !== 'leave'; form.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode)); };
    syncMode();
    form.addEventListener('click', async e => {
      const m = e.target.closest('[data-mode]');
      if (m) { mode = m.dataset.mode; syncMode(); }
      if (e.target.closest('[data-del]')) {
        const ok = await confirmSheet({ title: 'Delete this record?', sub: 'The check-in and check-out for this day will be removed.', confirm: 'Delete', tone: 'solid-danger' });
        if (!ok.ok) return;
        try { await call(`/attendance/${encodeURIComponent(d.attendanceId)}`, { method: 'DELETE' }); toast('Record deleted.'); s.close(); done && done(); } catch (err) { toast(err.message, 'bad'); }
      }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = { employee_code: employee ? employee.code : form.emp.value, date: form.date.value, status: mode === 'absent' ? 'ABSENT' : mode === 'leave' ? 'LEAVE' : undefined, leave_type: form.leave_type.value, check_in_time: form.in.value, check_out_time: form.out.value, fine: form.fine.value, note: form.note.value };
      await withBusy(e.submitter, async () => {
        try {
          const res = await call('/attendance/manual-mark', { method: 'POST', body });
          toast(res.message);
          s.close();
          if (done) done(); else route();
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // =====================================================================
  // Team
  // =====================================================================
  let teamQuery = '';
  async function renderTeam(arg) {
    loading(300);
    let list;
    try { list = await employees(true); } catch (err) { return failed(err); }
    if (parts()[0] !== 'team') return;
    const active = list.filter(e => e.status === 'active').length;
    view.innerHTML = `
      ${head('Team', `${active} active${list.length > active ? `, ${list.length - active} inactive` : ''}`, `<button class="btn btn-s btn-primary" data-act="add-emp">${icon('plus', 'icon-s')}Add employee</button>`, iconBtn('add-emp', 'plus', 'Add employee'))}
      <label class="search">${icon('search', 'icon-s')}<input class="input" type="search" placeholder="Search by name, code or department" value="${esc(teamQuery)}" id="teamSearch" aria-label="Search team"></label>
      <section class="card flush"><div class="list" id="people"></div></section>`;
    function paint() {
      const q = teamQuery.toLowerCase();
      const rows = list.filter(e => !q || [e.name, e.code, e.department, e.designation].join(' ').toLowerCase().includes(q))
        .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1));
      $('#people').innerHTML = rows.length ? rows.map(e => {
        const p = e.month.punctuality;
        return `<button class="row ${e.status !== 'active' ? 'inactive' : ''}" data-profile="${esc(e.id)}">${avatar(e)}
          <span class="grow"><span class="title">${esc(e.name)}</span><span class="sub">${esc(e.designation || '')} · ${esc(e.code)}</span></span>
          <span class="end">${e.status === 'active' ? pill(e.today.status) : pill('NA', 'Inactive')}<span class="small muted">${p === null ? '' : `${p}% on time`}</span></span></button>`;
      }).join('') : `<div class="empty"><h3>No one found</h3><p>${list.length ? 'Try another name.' : 'Add your first employee. They sign in with their code and PIN.'}</p></div>`;
    }
    paint();
    $('#teamSearch').addEventListener('input', e => { teamQuery = e.target.value; paint(); });
    if (arg) openProfile(arg);
  }

  function openEmployeeForm(emp) {
    const isNew = !emp;
    const colors = ['#2E4BD6', '#12805C', '#B4540A', '#7A3FC4', '#0E7490', '#BE185D', '#4D7C0F', '#9F1239'];
    let color = emp ? emp.avatar_color : null;
    const s = sheet({
      title: isNew ? 'Add employee' : `Edit ${firstName(emp.name)}`,
      sub: isNew ? 'They sign in on their phone with this code and PIN.' : '',
      body: `<form id="empForm" novalidate>
        <div class="row-2">
          <label class="field"><span>Employee code</span><input class="input" name="code" value="${esc(emp ? emp.code : '')}" ${isNew ? '' : 'readonly'} placeholder="EMP-107" required style="text-transform:uppercase"></label>
          <label class="field"><span>${isNew ? 'PIN' : 'New PIN'}</span><input class="input" name="pin" inputmode="numeric" maxlength="6" placeholder="${isNew ? '1234' : 'Leave empty to keep'}"></label>
        </div>
        <label class="field"><span>Full name</span><input class="input" name="name" value="${esc(emp ? emp.name : '')}" required></label>
        <div class="row-2">
          <label class="field"><span>Job title</span><input class="input" name="designation" value="${esc(emp ? emp.designation : '')}" placeholder="Web Developer"></label>
          <label class="field"><span>Department</span><input class="input" name="department" value="${esc(emp ? emp.department : '')}" placeholder="Software"></label>
        </div>
        <div class="row-2">
          <label class="field"><span>Phone</span><input class="input" name="phone" type="tel" value="${esc(emp ? emp.phone : '')}" placeholder="0300-1234567"></label>
          <label class="field"><span>Joining date</span><input class="input" name="joined_on" type="date" value="${esc(emp && emp.joined_on ? emp.joined_on : state.today)}"></label>
        </div>
        ${isNew ? '' : `<div class="field"><span>Colour</span><div class="chips">${colors.map(c => `<button type="button" class="chip" data-color="${c}" aria-pressed="${(color || '').toLowerCase() === c.toLowerCase()}" aria-label="Colour ${c}" style="width:36px;height:36px;padding:0;background:${c};border-color:${c};${(color || '').toLowerCase() === c.toLowerCase() ? 'outline:2px solid var(--ink);outline-offset:2px' : ''}"></button>`).join('')}</div></div>`}
        <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">${isNew ? 'Add employee' : 'Save'}</button></div>
      </form>`
    });
    const form = s.el.querySelector('#empForm');
    form.addEventListener('click', e => {
      const c = e.target.closest('[data-color]');
      if (c) { color = c.dataset.color; form.querySelectorAll('[data-color]').forEach(x => { x.setAttribute('aria-pressed', x === c); x.style.outline = x === c ? '2px solid var(--ink)' : ''; x.style.outlineOffset = '2px'; }); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const v = n => form[n].value.trim();
      if (!v('code') || !v('name')) return toast('Code and name are required.', 'warn');
      if (v('pin') && !/^\d{4,6}$/.test(v('pin'))) return toast('PIN must be 4 to 6 digits.', 'warn');
      const body = { code: v('code'), name: v('name'), designation: v('designation'), department: v('department'), phone: v('phone'), joined_on: v('joined_on'), pin: v('pin') || undefined, avatar_color: color || undefined };
      await withBusy(e.submitter, async () => {
        try {
          const res = isNew ? await call('/employees/add', { method: 'POST', body: { ...body, pin: body.pin || '1234' } }) : await call(`/employees/${encodeURIComponent(emp.id)}`, { method: 'PUT', body });
          toast(isNew ? `${res.message} PIN: ${body.pin || '1234'}` : res.message);
          s.close();
          state.employees = null;
          if (parts()[0] === 'team') renderTeam(isNew ? undefined : emp.id);
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  async function openProfile(id, month) {
    const s = sheet({ title: 'Profile', wide: true, body: '<div class="skeleton" style="height:360px"></div>' });
    await paintProfile(s, id, month);
  }

  async function paintProfile(s, id, month) {
    let p, fines;
    try {
      [p, fines] = await Promise.all([
        call(`/employees/${encodeURIComponent(id)}/profile${month ? `?month=${month}` : ''}`),
        call(`/employees/${encodeURIComponent(id)}/fines`)
      ]);
    } catch (err) { s.body.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`; return; }
    const e = p.employee;
    const sm = p.summary;
    const m = p.from.slice(0, 7);
    s.el.querySelector('.sheet-head h3').textContent = e.name;
    const fineMonths = fines.months.filter(x => x.fine || x.paid);
    s.body.innerHTML = `
      <div class="profile-top">${avatar(e, 'avatar-l')}<div><b>${esc(e.designation || '')}${e.department ? `, ${esc(e.department)}` : ''}</b><p class="muted small">${esc(e.code)}${e.phone ? ` · ${esc(e.phone)}` : ''}</p><p class="muted small">${e.last_login_at ? `Last signed in ${ago(e.last_login_at)}` : 'Has not signed in yet'}${e.has_device ? ' · phone linked' : ''}</p></div></div>
      <div class="profile-cols">
        <div>
          <div class="month-bar" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <button class="icon-btn" data-pm="-1" aria-label="Previous month">${icon('left')}</button><b>${monthName(p.from)}</b><button class="icon-btn" data-pm="1" aria-label="Next month" ${m >= state.today.slice(0, 7) ? 'disabled' : ''}>${icon('right')}</button>
          </div>
          <div data-cal></div>
          <div class="stats" style="margin-top:12px">
            <div class="stat"><b>${sm.present}</b><span>Present</span></div>
            <div class="stat"><b class="${sm.late ? 'warn' : ''}">${sm.late}</b><span>Late</span></div>
            <div class="stat"><b class="${sm.absent ? 'bad' : ''}">${sm.absent}</b><span>Absent</span></div>
            <div class="stat"><b>${sm.leave}</b><span>Leave</span></div>
          </div>
        </div>
        <div>
          <div class="card-head"><h3>Fines</h3>${fines.totalDue ? pill('DUE', `${rs(fines.totalDue)} due`) : pill('PAID', 'All paid')}</div>
          ${sm.finalFine ? `<button class="btn btn-s btn-ghost" data-waive-month style="margin:-4px 0 6px -12px">Waive all ${monthName(p.from)} fines (${rs(sm.finalFine)})</button>` : ''}
          ${fineMonths.length ? fineMonths.map(x => `
            <div class="kv" style="align-items:center"><span>${monthName(x.month + '-01')}<br><small class="muted">${rs(x.fine)} fine${x.paid ? `, ${rs(x.paid)} paid` : ''}</small></span>
              ${x.due ? `<button class="btn btn-s btn-good" data-pay="${x.month}">Mark ${rs(x.due)} paid</button>` : '<span class="good small">Paid</span>'}</div>`).join('') : '<p class="muted">No fines yet.</p>'}
          <div style="margin-top:12px">
            <div class="kv"><span>On time</span><b>${sm.punctuality === null ? '—' : sm.punctuality + '%'}</b></div>
            <div class="kv"><span>On-time streak</span><b>${p.streak.current} days (best ${p.streak.best})</b></div>
            ${sm.avgCheckIn ? `<div class="kv"><span>Usual arrival</span><b>${time12(sm.avgCheckIn)}</b></div>` : ''}
            <div class="kv"><span>Late this month</span><b>${mins(sm.lateMinutes)}</b></div>
          </div>
          ${p.issues.length ? `<h4 style="margin:14px 0 2px;font-size:16px">This month</h4><div class="list">${p.issues.slice(0, 8).map(i => `<div class="row" style="min-height:48px"><div class="grow"><span class="title">${esc(i.type)}</span><span class="sub">${dateMed(i.date)}${i.detail ? `, ${esc(i.detail)}` : ''}</span></div>${i.fine ? `<b class="nowrap">${rs(i.fine)}</b>` : ''}</div>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="action-row">
        <button class="btn btn-s" data-pa="edit">${icon('edit', 'icon-s')}Edit / PIN</button>
        ${e.has_device ? `<button class="btn btn-s" data-pa="device">${icon('phone', 'icon-s')}Reset phone</button>` : ''}
        <button class="btn btn-s" data-pa="status">${e.status === 'active' ? 'Deactivate' : 'Activate'}</button>
        <button class="btn btn-s btn-danger" data-pa="delete">${icon('trash', 'icon-s')}Delete</button>
      </div>`;
    s.body.querySelector('[data-cal]').appendChild(calendar(p.days, {
      todayKey: state.today,
      onPick: day => openAdminDay(e, day, () => paintProfile(s, id, m))
    }));
    s.body.querySelectorAll('[data-pm]').forEach(b => b.addEventListener('click', () => {
      const d = keyToDate(p.from); d.setMonth(d.getMonth() + Number(b.dataset.pm));
      paintProfile(s, id, dateKey(d).slice(0, 7));
    }));
    s.body.querySelector('[data-waive-month]')?.addEventListener('click', () => waiveFines({ employee_id: e.id, month: m }, `all of ${esc(firstName(e.name))}'s fines for ${monthName(p.from)}`, () => paintProfile(s, id, m)));
    s.body.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
      const x = fines.months.find(y => y.month === b.dataset.pay);
      openPayment(e, x, () => paintProfile(s, id, m));
    }));
    s.body.querySelector('.action-row').addEventListener('click', async ev => {
      const a = ev.target.closest('[data-pa]');
      if (!a) return;
      const act = a.dataset.pa;
      try {
        if (act === 'edit') { s.close(); openEmployeeForm(e); return; }
        if (act === 'device') {
          const ok = await confirmSheet({ title: 'Reset phone?', sub: `${esc(firstName(e.name))} can sign in on any phone next time. The old phone is signed out.`, confirm: 'Reset' });
          if (!ok.ok) return;
          toast((await call(`/employees/${encodeURIComponent(e.id)}/reset-device`, { method: 'POST' })).message);
        }
        if (act === 'status') {
          const next = e.status === 'active' ? 'inactive' : 'active';
          if (next === 'inactive') {
            const ok = await confirmSheet({ title: `Deactivate ${firstName(e.name)}?`, sub: 'They cannot sign in and won\'t appear in reports. Their old records are kept.', confirm: 'Deactivate' });
            if (!ok.ok) return;
          }
          toast((await call(`/employees/${encodeURIComponent(e.id)}`, { method: 'PUT', body: { status: next } })).message);
        }
        if (act === 'delete') {
          const ok = await confirmSheet({ title: `Delete ${e.name}?`, sub: 'This removes the employee for good. Deactivating is usually better, so old reports stay correct.', confirm: 'Delete', tone: 'solid-danger' });
          if (!ok.ok) return;
          toast((await call(`/employees/${encodeURIComponent(e.id)}`, { method: 'DELETE' })).message);
          s.close();
        } else {
          await paintProfile(s, id, m);
        }
        state.employees = null;
        if (parts()[0] === 'team') renderTeam();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  function openAdminDay(emp, day, done) {
    const fineable = ['PRESENT', 'LATE', 'ABSENT'].includes(day.status);
    const editable = day.date <= state.today && day.status !== 'NA';
    const s = sheet({
      title: `${firstName(emp.name)}, ${dateMed(day.date)}`,
      body: `${dayDetailHtml(day)}<div class="sheet-actions">${editable ? '<button class="btn" data-edit>Edit</button>' : ''}${fineable ? '<button class="btn btn-primary" data-fine>Change fine</button>' : ''}</div>`
    });
    s.el.querySelector('[data-fine]')?.addEventListener('click', () => { s.close(); openFine(emp, day, done); });
    s.el.querySelector('[data-edit]')?.addEventListener('click', () => { s.close(); openManual({ employee: emp, day, date: day.date, done }); });
  }

  // =====================================================================
  // Fines: record payments, see what is still due
  // =====================================================================
  let finesMonth = null;
  async function renderFines(arg) {
    if (/^\d{4}-\d{2}$/.test(arg || '')) finesMonth = arg;
    const month = finesMonth || state.today.slice(0, 7);
    loading(300);
    let d;
    try { d = await call(`/fines?month=${month}`); } catch (err) { return failed(err); }
    if (parts()[0] !== 'fines') return;
    const T = d.totals;
    const shift = n => { const x = keyToDate(`${month}-01`); x.setMonth(x.getMonth() + n); return dateKey(x).slice(0, 7); };
    view.innerHTML = `
      ${head('Fines', 'Mark fines as paid and see what is still due.')}
      <div class="date-nav">
        <button class="icon-btn" data-fm="${shift(-1)}" aria-label="Previous month">${icon('left')}</button>
        <input type="month" id="fineMonth" value="${month}" max="${state.today.slice(0, 7)}" aria-label="Month">
        <button class="icon-btn" data-fm="${shift(1)}" aria-label="Next month" ${month >= state.today.slice(0, 7) ? 'disabled' : ''}>${icon('right')}</button>
      </div>
      <div class="stats three">
        <div class="stat"><b>${rs(T.fine)}</b><span>Fines</span></div>
        <div class="stat"><b class="good">${rs(T.paid)}</b><span>Paid</span></div>
        <div class="stat"><b class="${T.due ? 'bad' : 'good'}">${rs(T.due)}</b><span>Not paid</span></div>
      </div>
      <section class="card flush">
        <div class="card-head"><h3>${monthName(month + '-01')}</h3></div>
        <div class="list">${d.rows.length ? d.rows.map((r, i) => `
          <div class="row">${avatar(r.employee)}
            <span class="grow"><span class="title">${esc(r.employee.name)}</span><span class="sub">${r.due ? `<b class="bad">${rs(r.due)} due</b>${r.paid ? `, ${rs(r.paid)} paid` : ''}` : r.fine ? `${rs(r.fine)}, all paid` : 'No fine'}${r.totalDue > r.due ? `<br>${rs(r.totalDue - r.due)} due from earlier months` : ''}</span></span>
            ${r.due ? `<button class="btn btn-s btn-good" data-payrow="${i}">Mark paid</button>` : r.fine ? pill('PAID', 'Paid') : ''}
          </div>`).join('') : '<div class="empty"><p>No one to show.</p></div>'}</div>
      </section>
      ${d.payments.length ? `<section class="card flush"><div class="card-head"><h3>Payments recorded</h3></div><div class="list">${d.payments.map(p => `
        <div class="row"><span class="grow"><span class="title">${esc(p.employee_name)} · ${rs(p.amount)}</span><span class="sub">${dateMed(p.paid_at.slice(0, 10))}${p.note ? `, ${esc(p.note)}` : ''}</span></span>
          <button class="icon-btn" data-undo="${esc(p.id)}" aria-label="Remove payment">${icon('trash', 'icon-s')}</button></div>`).join('')}</div></section>` : ''}`;

    view.querySelectorAll('[data-fm]').forEach(b => b.addEventListener('click', () => { location.hash = `#fines/${b.dataset.fm}`; }));
    $('#fineMonth').addEventListener('change', e => { if (e.target.value) location.hash = `#fines/${e.target.value}`; });
    view.querySelectorAll('[data-payrow]').forEach(b => b.addEventListener('click', () => {
      const r = d.rows[Number(b.dataset.payrow)];
      openPayment(r.employee, { month, fine: r.fine, paid: r.paid, due: r.due }, () => renderFines(month));
    }));
    view.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Remove this payment?', sub: 'The amount will show as not paid again.', confirm: 'Remove', tone: 'solid-danger' });
      if (!ok.ok) return;
      try { toast((await call(`/payments/${encodeURIComponent(b.dataset.undo)}`, { method: 'DELETE' })).message); renderFines(month); } catch (err) { toast(err.message, 'bad'); }
    }));
  }

  function openPayment(emp, m, done) {
    const s = sheet({
      title: `Fine paid by ${firstName(emp.name)}`,
      sub: monthName(m.month + '-01'),
      body: `
        <div style="margin-bottom:12px">
          <div class="kv"><span>Fine</span><b>${rs(m.fine)}</b></div>
          ${m.paid ? `<div class="kv"><span>Already paid</span><b class="good">${rs(m.paid)}</b></div>` : ''}
          <div class="kv"><span>Still due</span><b class="bad">${rs(m.due)}</b></div>
        </div>
        <form id="payForm" novalidate>
          <div class="field"><span>Amount received</span>
            <div class="chips" style="margin-bottom:8px">
              <button type="button" class="chip" data-amt="${m.due}" aria-pressed="true">Full (${rs(m.due)})</button>
              ${m.due >= 200 ? `<button type="button" class="chip" data-amt="${Math.round(m.due / 2)}">Half (${rs(Math.round(m.due / 2))})</button>` : ''}
            </div>
            <input class="input" name="amount" type="number" min="1" step="10" inputmode="numeric" value="${m.due}" required>
          </div>
          <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="200" placeholder="For example: cash"></label>
          <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-good" type="submit">${icon('check', 'icon-s')}Mark as paid</button></div>
        </form>`
    });
    const form = s.el.querySelector('#payForm');
    form.addEventListener('click', e => {
      const c = e.target.closest('[data-amt]');
      if (c) { form.amount.value = c.dataset.amt; form.querySelectorAll('[data-amt]').forEach(x => x.setAttribute('aria-pressed', x === c)); }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try {
          const res = await call('/payments', { method: 'POST', body: { employee_id: emp.id, month: m.month, amount: form.amount.value, note: form.note.value } });
          toast(res.message);
          s.close();
          done && done();
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // =====================================================================
  // Requests
  // =====================================================================
  let reqFilter = 'PENDING';
  async function renderRequests() {
    loading(260);
    let r;
    try { r = await call('/leaves'); } catch (err) { return failed(err); }
    if (parts()[0] !== 'requests') return;
    const all = r.leaves;
    const pendingN = all.filter(l => l.status === 'PENDING').length;
    setPending(pendingN);
    view.innerHTML = `
      ${head('Requests', 'Leave requests and reasons for late or missed days.')}
      <div class="seg" role="group" aria-label="Filter">
        ${[['PENDING', `Pending${pendingN ? ` (${pendingN})` : ''}`], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['all', 'All']].map(([k, l]) => `<button data-rf="${k}" aria-pressed="${reqFilter === k}">${l}</button>`).join('')}
      </div>
      <section class="card" id="reqBox"></section>`;
    function paint() {
      const list = all.filter(l => reqFilter === 'all' || l.status === reqFilter);
      $('#reqBox').innerHTML = list.length ? list.map(l => `
        <div class="req">
          <div class="who">${avatar({ name: l.employee_name, avatar_color: l.avatar_color })}<div class="grow"><b>${esc(l.employee_name)}</b><small>${esc(l.type)}${l.kind === 'excuse' ? ' (reason)' : ''}, ${l.end_date !== l.date ? `${dateShort(l.date)} – ${dateShort(l.end_date)}` : dateMed(l.date)} · ${ago(l.created_at)}</small></div>${pill(l.status, l.status === 'PENDING' ? 'Pending' : undefined)}</div>
          <p style="margin:8px 0 0">${esc(l.reason)}</p>
          ${l.admin_note ? `<div class="note-line">You: ${esc(l.admin_note)}${l.fine_applied ? ` (fine ${rs(l.fine_applied)})` : ''}</div>` : ''}
          ${l.status !== 'PENDING' ? `<div class="btn-row" style="margin-top:8px"><button class="btn btn-s btn-ghost" data-review="${esc(l.id)}" data-st="${l.status === 'APPROVED' ? 'REJECTED' : 'APPROVED'}">Change to ${l.status === 'APPROVED' ? 'rejected' : 'approved'}</button><button class="btn btn-s btn-ghost btn-danger" data-del-req="${esc(l.id)}">${icon('trash', 'icon-s')}Delete</button></div>` : ''}
          ${l.status === 'PENDING' ? `<div class="btn-row" style="margin-top:10px"><button class="btn btn-s btn-good" data-review="${esc(l.id)}" data-st="APPROVED">${icon('check', 'icon-s')}Approve</button><button class="btn btn-s" data-review="${esc(l.id)}" data-st="REJECTED">Reject</button></div>` : ''}
        </div>`).join('')
        : `<div class="empty"><h3>${reqFilter === 'PENDING' ? 'All done' : 'Nothing here'}</h3><p>${reqFilter === 'PENDING' ? 'New requests show up here. Turn on notifications in Settings to hear about them.' : ''}</p></div>`;
    }
    paint();
    $('#reqBox').addEventListener('click', async e => {
      const b = e.target.closest('[data-del-req]');
      if (!b) return;
      const ok = await confirmSheet({ title: 'Delete this request?', sub: 'If it was an approved leave, those days count normally again.', confirm: 'Delete', tone: 'solid-danger' });
      if (!ok.ok) return;
      try { toast((await call(`/leaves/${encodeURIComponent(b.dataset.delReq)}`, { method: 'DELETE' })).message); renderRequests(); } catch (err) { toast(err.message, 'bad'); }
    });
    view.querySelectorAll('[data-rf]').forEach(b => b.addEventListener('click', () => { reqFilter = b.dataset.rf; view.querySelectorAll('[data-rf]').forEach(x => x.setAttribute('aria-pressed', x === b)); paint(); }));
  }

  async function reviewRequest(id, status) {
    let leave;
    try { leave = (await call('/leaves')).leaves.find(l => l.id === id); } catch (err) { return toast(err.message, 'bad'); }
    if (!leave) return toast('Request not found.', 'bad');
    let dayFine = null;
    if (leave.kind === 'excuse') {
      try {
        const a = await call(`/attendance?date=${leave.date}`);
        const row = a.rows.find(x => x.employee.id === leave.employee_id);
        if (row && row.day.checkIn) dayFine = row.day;
      } catch (e) { /* optional */ }
    }
    const approve = status === 'APPROVED';
    const s = sheet({
      title: `${approve ? 'Approve' : 'Reject'}: ${leave.type}`,
      sub: `${esc(leave.employee_name)}, ${leave.end_date !== leave.date ? `${dateShort(leave.date)} – ${dateShort(leave.end_date)}` : dateLong(leave.date)}`,
      body: `<div class="notice" style="margin-bottom:14px">${icon('info')}<p>${esc(leave.reason)}</p></div>
        <form id="revForm" novalidate>
          ${leave.kind === 'excuse' && dayFine ? `<div class="field"><span>Fine for that day (now ${rs(dayFine.fine)})</span>
              <div class="chips" style="margin-bottom:8px"><button type="button" class="chip" data-amt="0">Waive</button>${dayFine.autoFine ? `<button type="button" class="chip" data-amt="${Math.round(dayFine.autoFine / 2)}">Half</button><button type="button" class="chip" data-amt="${dayFine.autoFine}">Full</button>` : ''}</div>
              <input class="input" type="number" min="0" step="10" name="dayFine" value="${approve ? 0 : dayFine.fine}"></div>` : ''}
          ${leave.kind === 'leave' ? `<label class="field"><span>Fine (usually 0)</span><input class="input" type="number" min="0" step="10" name="fine" value="0"></label>` : ''}
          <label class="field"><span>Note for the employee</span><input class="input" name="note" maxlength="200" placeholder="${approve ? 'For example: get well soon' : 'For example: please tell us a day before'}"></label>
          <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn ${approve ? 'btn-good' : 'btn-solid-danger'}" type="submit">${approve ? 'Approve' : 'Reject'}</button></div>
        </form>`
    });
    const form = s.el.querySelector('#revForm');
    form.addEventListener('click', e => { const c = e.target.closest('[data-amt]'); if (c) form.dayFine.value = c.dataset.amt; });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await withBusy(e.submitter, async () => {
        try {
          const res = await call('/leaves/review', { method: 'POST', body: { leave_id: id, status, admin_note: form.note.value, fine_applied: form.fine ? form.fine.value : 0, day_fine: form.dayFine ? form.dayFine.value : undefined } });
          toast(res.message);
          s.close();
          route();
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // ---------- Announcement ----------
  function openAnnouncement() {
    const s = sheet({
      title: 'Send an announcement',
      sub: 'Everyone gets a notification. It stays on their home screen for 7 days.',
      body: `<form id="annForm" novalidate>
        <label class="field"><span>Title</span><input class="input" name="title" maxlength="140" required placeholder="For example: Office opens at 10 tomorrow"></label>
        <label class="field"><span>Details (optional)</span><textarea class="input" name="body" maxlength="600"></textarea></label>
        <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary" type="submit">${icon('send', 'icon-s')}Send</button></div>
      </form>`
    });
    s.el.querySelector('#annForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      if (!f.title.value.trim()) return toast('Write a title.', 'warn');
      await withBusy(e.submitter, async () => {
        try { const res = await call('/announcements', { method: 'POST', body: { title: f.title.value, body: f.body.value } }); toast(res.message); s.close(); if (parts()[0] === 'settings') renderSettings(); } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // =====================================================================
  // Reports
  // =====================================================================
  const rep = { mode: 'monthly', anchor: null };
  function weekStart(key) { const d = keyToDate(key); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return dateKey(d); }
  function rangeFor() {
    const a = rep.anchor || state.today;
    if (rep.mode === 'daily') return { from: a, to: a };
    if (rep.mode === 'weekly') { const f = weekStart(a); return { from: f, to: addDays(f, 6) }; }
    const [y, m] = a.split('-').map(Number);
    return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: dateKey(new Date(y, m, 0)) };
  }
  const CODE = { PRESENT: 'P', LATE: 'L', ABSENT: 'A', LEAVE: 'LV', PENDING: 'LV?', OFF: '', HOLIDAY: 'H', UPCOMING: '', NOT_YET: '', NA: '' };

  async function renderReports() {
    if (!rep.anchor) rep.anchor = state.today;
    const { from, to } = rangeFor();
    view.innerHTML = `
      ${head('Reports', 'Daily, weekly or monthly. Download for Excel or print.', `<button class="btn btn-s" id="csvBtn">${icon('download', 'icon-s')}Excel (CSV)</button><button class="btn btn-s" data-print>${icon('printer', 'icon-s')}Print</button>`,
        `<button class="icon-btn" id="csvBtnM" aria-label="Download for Excel">${icon('download')}</button>`)}
      <div class="seg no-print" role="group" aria-label="Report type">${[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([k, l]) => `<button data-mode="${k}" aria-pressed="${rep.mode === k}">${l}</button>`).join('')}</div>
      <div class="date-nav no-print"><button class="icon-btn" data-shift="-1" aria-label="Previous">${icon('left')}</button>
        ${rep.mode === 'monthly' ? `<input type="month" id="repPick" value="${from.slice(0, 7)}" aria-label="Month">` : `<input type="date" id="repPick" value="${from}" aria-label="Date">`}
        <button class="icon-btn" data-shift="1" aria-label="Next">${icon('right')}</button></div>
      <div id="repBody" style="display:grid;gap:12px"><div class="skeleton" style="height:300px"></div></div>`;

    view.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { rep.mode = b.dataset.mode; renderReports(); }));
    view.querySelectorAll('[data-shift]').forEach(b => b.addEventListener('click', () => {
      const n = Number(b.dataset.shift);
      if (rep.mode === 'daily') rep.anchor = addDays(rep.anchor, n);
      else if (rep.mode === 'weekly') rep.anchor = addDays(rep.anchor, 7 * n);
      else { const d = keyToDate(from); d.setMonth(d.getMonth() + n); rep.anchor = dateKey(d); }
      renderReports();
    }));
    $('#repPick').addEventListener('change', e => { if (!e.target.value) return; rep.anchor = rep.mode === 'monthly' ? `${e.target.value}-01` : e.target.value; renderReports(); });
    view.querySelector('[data-print]').addEventListener('click', () => window.print());

    let data;
    try { data = (await call(`/reports?from=${from}&to=${to}`)).data; } catch (err) { $('#repBody').innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`; return; }
    if (parts()[0] !== 'reports') return;
    $('#csvBtn').addEventListener('click', () => downloadCSV(data));
    $('#topActions').querySelector('#csvBtnM')?.addEventListener('click', () => downloadCSV(data));

    const T = data.totals;
    const hasPay = !!data.month;
    const title = rep.mode === 'daily' ? dateLong(from) : rep.mode === 'weekly' ? `${dateShort(from)} – ${dateShort(to)}` : monthName(from);
    const rows = data.rows;
    const summaryTable = `
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Employee</th><th class="num">Present</th><th class="num">Late</th><th class="num">Absent</th><th class="num">Leave</th><th class="num">Late min</th><th class="num">No check-out</th><th class="num">Hours</th><th class="num">On time</th><th class="num">Fine</th>${hasPay ? '<th class="num">Paid</th><th class="num">Due</th>' : ''}</tr></thead>
        <tbody>${rows.map(r => { const s = r.summary; return `<tr>
          <td><button class="who" data-profile="${esc(r.employee.id)}">${avatar(r.employee, 'avatar-s')}<span><b>${esc(r.employee.name)}</b></span></button></td>
          <td class="num">${s.present}</td><td class="num">${s.late || '—'}</td><td class="num ${s.absent ? 'bad' : ''}">${s.absent || '—'}</td><td class="num">${s.leave + s.pending || '—'}</td>
          <td class="num">${s.lateMinutes || '—'}</td><td class="num">${s.missedCheckouts || '—'}</td><td class="num">${s.hours}</td><td class="num">${s.punctuality === null ? '—' : s.punctuality + '%'}</td>
          <td class="num"><b>${rs(s.finalFine)}</b></td>${hasPay ? `<td class="num good">${s.paid ? rs(s.paid) : '—'}</td><td class="num ${s.due ? 'bad' : ''}">${s.due ? rs(s.due) : '—'}</td>` : ''}</tr>`; }).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${T.present}</td><td class="num">${T.late}</td><td class="num">${T.absent}</td><td class="num">${T.leave + T.pending}</td><td class="num">${T.lateMinutes}</td><td class="num">${T.missedCheckouts}</td><td class="num">${T.hours}</td><td class="num">${T.punctuality === null ? '—' : T.punctuality + '%'}</td><td class="num">${rs(T.finalFine)}</td>${hasPay ? `<td class="num">${rs(T.paid)}</td><td class="num">${rs(T.due)}</td>` : ''}</tr></tfoot>
      </table></div>`;

    let detail = '';
    if (rep.mode === 'daily') {
      detail = `<section class="card"><div class="card-head"><h3>Day details</h3></div><div class="table-wrap"><table class="tbl">
        <thead><tr><th>Employee</th><th>Status</th><th>In</th><th>Out</th><th class="num">Hours</th><th>Note</th><th class="num">Fine</th></tr></thead>
        <tbody>${rows.map(r => { const d = r.days[0]; return `<tr><td>${esc(r.employee.name)}</td><td>${pill(d.status, d.status === 'LATE' ? `${mins(d.lateMinutes)} late` : d.label)}</td><td class="nowrap">${d.checkIn ? time12(d.checkIn) : '—'}</td><td class="nowrap">${d.checkOut ? time12(d.checkOut) : d.missedCheckout ? 'Missed' : '—'}</td><td class="num">${d.hours ? duration(d.hours) : '—'}</td><td class="small">${esc([d.note, d.fineNote, d.reason].filter(Boolean).join(' / '))}</td><td class="num">${fineHtml(d)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    } else {
      const headCells = data.dates.map(k => { const off = data.offDays.includes(k) || data.holidays[k]; return `<th class="${off ? 'we' : ''}" title="${esc(data.holidays[k] || dateMed(k))}">${Number(k.slice(8))}<br><span style="font-weight:400">${keyToDate(k).toLocaleDateString('en-GB', { weekday: 'narrow' })}</span></th>`; }).join('');
      detail = `<section class="card"><div class="card-head"><h3>Day by day</h3></div>
        <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="name">Employee</th>${headCells}<th class="tot">Present</th><th class="tot">Late</th><th class="tot">Absent</th><th class="tot">Fine</th></tr></thead>
        <tbody>${rows.map((r, ri) => `<tr><td class="name">${esc(r.employee.name)}</td>${r.days.map((d, di) => `<td><button class="cell c-${d.status} ${d.fine ? 'fined' : ''}" data-cell="${ri}:${di}" title="${esc(`${dateMed(d.date)}: ${STATUS[d.status] || d.status}${d.checkIn ? `, ${time12(d.checkIn)}` : ''}${d.fine ? `, ${rs(d.fine)}` : ''}`)}" ${['OFF', 'UPCOMING', 'NA'].includes(d.status) ? 'tabindex="-1"' : ''}>${CODE[d.status] ?? ''}</button></td>`).join('')}<td class="tot first">${r.summary.present}</td><td class="tot">${r.summary.late}</td><td class="tot">${r.summary.absent}</td><td class="tot">${rs(r.summary.finalFine)}</td></tr>`).join('')}</tbody></table></div>
        <div class="legend"><span>P on time</span><span>L late</span><span>A absent</span><span>LV leave</span><span>H holiday</span><span>red line = fine</span></div></section>`;
    }

    const withIssues = rows.filter(r => r.issues.length);
    const issues = withIssues.length ? `<section class="card"><div class="card-head"><h3>Who missed what</h3></div>${withIssues.map(r => {
      const s = r.summary;
      return `<details class="issue"><summary>${avatar(r.employee, 'avatar-s')}<span class="grow"><b>${esc(r.employee.name)}</b><span class="small muted" style="display:block">${[s.absent && `${s.absent} absent`, s.late && `${s.late} late`, s.leave && `${s.leave} leave`, s.missedCheckouts && `${s.missedCheckouts} no check-out`].filter(Boolean).join(', ') || 'Minor issues'}</span></span><b class="nowrap">${rs(s.finalFine)}</b></summary>
        <div class="list">${r.issues.map(i => `<div class="row"><span class="nowrap small" style="width:90px;flex:none">${dateMed(i.date)}</span><div class="grow"><span class="title">${esc(i.type)}</span>${i.detail ? `<span class="sub">${esc(i.detail)}</span>` : ''}</div>${i.fine ? `<b class="nowrap">${rs(i.fine)}</b>` : ''}</div>`).join('')}</div></details>`;
    }).join('')}</section>` : '';

    $('#repBody').innerHTML = `
      <div class="print-only"><h2>${esc(state.officeName)} attendance report</h2><p>${title}</p></div>
      <section class="card">
        <div class="card-head"><h3>${title}</h3><span class="muted small">${rows.length} employees</span></div>
        <div class="stats" style="margin-bottom:14px">
          <div class="stat"><b>${T.present}</b><span>Present days</span></div>
          <div class="stat"><b class="${T.late ? 'warn' : ''}">${T.late}</b><span>Late</span></div>
          <div class="stat"><b class="${T.absent ? 'bad' : ''}">${T.absent}</b><span>Absent</span></div>
          <div class="stat"><b>${rs(T.finalFine)}</b><span>${hasPay ? `${rs(T.due)} not paid` : 'Fines'}</span></div>
        </div>
        ${summaryTable}
      </section>
      ${detail}
      ${issues}`;
    $('#repBody').querySelectorAll('[data-cell]').forEach(b => b.addEventListener('click', () => {
      const [ri, di] = b.dataset.cell.split(':').map(Number);
      const r = rows[ri];
      const d = r.days[di];
      if (['OFF', 'UPCOMING', 'NA'].includes(d.status)) return;
      openAdminDay(r.employee, d, () => renderReports());
    }));
  }

  function downloadCSV(data) {
    // Text that starts with = + - @ could run as a formula in Excel, so prefix it with '.
    const q = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [];
    const multi = data.dates.length > 1;
    const hasPay = !!data.month;
    const headRow = ['Code', 'Name', 'Department'];
    if (multi) headRow.push(...data.dates.map(k => `${Number(k.slice(8))} ${keyToDate(k).toLocaleDateString('en-GB', { weekday: 'short' })}`));
    else headRow.push('Status', 'Check in', 'Check out', 'Hours', 'Note');
    headRow.push('Present', 'On time', 'Late', 'Absent', 'Leave', 'Late minutes', 'Missed check-outs', 'Total hours', 'On time %', 'Fine by rules', 'Final fine');
    if (hasPay) headRow.push('Paid', 'Due');
    lines.push(headRow.map(q).join(','));
    for (const r of data.rows) {
      const s = r.summary;
      const row = [r.employee.code, r.employee.name, r.employee.department];
      if (multi) row.push(...r.days.map(d => CODE[d.status] ?? ''));
      else { const d = r.days[0]; row.push(STATUS[d.status] || d.status, d.checkIn ? time12(d.checkIn) : '', d.checkOut ? time12(d.checkOut) : '', d.hours ? d.hours.toFixed(1) : '', [d.note, d.fineNote, d.reason].filter(Boolean).join(' / ')); }
      row.push(s.present, s.onTime, s.late, s.absent, s.leave + s.pending, s.lateMinutes, s.missedCheckouts, s.hours, s.punctuality ?? '', s.autoFine, s.finalFine);
      if (hasPay) row.push(s.paid, s.due);
      lines.push(row.map(q).join(','));
    }
    lines.push('');
    lines.push('Issues');
    lines.push(['Code', 'Name', 'Date', 'Issue', 'Detail', 'Fine'].map(q).join(','));
    for (const r of data.rows) for (const i of r.issues) lines.push([r.employee.code, r.employee.name, i.date, i.type, i.detail, i.fine].map(q).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `attendance_${data.from}_to_${data.to}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Report downloaded. Open it in Excel.');
  }

  // =====================================================================
  // Settings
  // =====================================================================
  const ADMIN_EVENTS = [
    ['leave_request', 'Leave requests and reasons', 'When someone asks for leave or explains a late day.'],
    ['late_checkin', 'Late check-ins', 'Who came late, by how much, and the fine.'],
    ['morning_summary', 'Morning summary', '30 minutes after start: who is in, late, or not in yet.'],
    ['missed_checkout', 'Missed check-outs', 'One hour after closing: who forgot to check out.'],
    ['early_checkout', 'Early check-outs', 'When someone leaves before closing time.'],
    ['device_blocked', 'Sign-in on a new phone', 'When someone is blocked by the one-phone rule.'],
    ['wifi_blocked', 'Check-in blocked', 'When someone can\'t check in because their network isn\'t on the office list.'],
    ['every_checkin', 'Every check-in', 'Also notify for on-time check-ins. Can be a lot.']
  ];
  const EMP_EVENTS = [
    ['checkin_reminder', 'Check-in reminder', '15 minutes before start, if not checked in.'],
    ['checkout_reminder', 'Check-out reminder', 'At closing time, if still checked in.'],
    ['decisions', 'Replies from you', 'Leave approved or rejected, fine changed, fine paid.'],
    ['announcements', 'Announcements', 'When you send an announcement.']
  ];
  const sw = (name, on, title, sub, attrs = '') => `<label class="switch-row"><span class="grow"><b>${title}</b><span>${sub}</span></span><span class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} ${attrs}><i></i></span></label>`;

  async function renderSettings() {
    loading(400);
    let r, ann, dev;
    try { [r, ann, dev] = await Promise.all([call('/settings'), call('/announcements'), call('/push/devices')]); } catch (err) { return failed(err); }
    if (parts()[0] !== 'settings') return;
    const s = r.settings;
    setOffice(s.office_name);
    const ips = [...s.office_ips];
    const holidays = [...s.holidays];
    const offDays = new Set(s.weekly_off_days);
    const myIP = r.currentAdminIP;
    const sub = await push.current().catch(() => null);
    const thisOn = !!sub && push.permission() === 'granted';
    const theme = store(THEME_KEY) || 'system';
    const pushHelp = push.needsInstall() ? 'On iPhone: tap Share, then "Add to Home Screen", and open the app from there.'
      : !push.supported() ? 'This browser does not support notifications. Use Chrome, Edge or Safari on iPhone (from the Home Screen).'
      : push.permission() === 'denied' ? 'Blocked. Allow notifications for this site in the browser settings.'
      : `${dev.devices.length} admin device${dev.devices.length === 1 ? '' : 's'} on. ${dev.employeesOn} employee${dev.employeesOn === 1 ? '' : 's'} have turned them on.`;

    view.innerHTML = `
      ${head('Settings', 'Office hours, fines, WiFi lock and notifications.')}
      ${r.ipLooksWrong ? `<div class="notice bad">${icon('alert')}<div><b>The server can't see your real IP</b><p>Your IP shows as ${esc(myIP)}, which means Nginx isn't passing the visitor's IP. Fix the Nginx setup (see README) before using the WiFi lock.</p></div></div>` : ''}
      <section class="card">
        <div class="card-head"><h3>Notifications</h3></div>
        <label class="switch-row" style="padding-top:0"><span class="grow"><b>On this device</b><span>${pushHelp}</span></span><span class="switch"><input type="checkbox" id="pushThis" ${thisOn ? 'checked' : ''} ${!push.supported() || push.permission() === 'denied' ? 'disabled' : ''} aria-label="Notifications on this device"><i></i></span></label>
        ${thisOn ? '<button class="btn btn-s" id="pushTest" style="margin-top:4px">Send a test notification</button>' : ''}
      </section>

      <form id="setForm" novalidate style="display:grid;gap:12px">
        <div class="settings-grid">
          <section class="card">
            <div class="card-head"><h3>Notify me about</h3></div>
            ${ADMIN_EVENTS.map(([k, t, d]) => sw(`pa_${k}`, s.push_admin[k], t, d)).join('')}
          </section>
          <section class="card">
            <div class="card-head"><h3>Notify employees about</h3></div>
            ${EMP_EVENTS.map(([k, t, d]) => sw(`pe_${k}`, s.push_employee[k], t, d)).join('')}
          </section>

          <section class="card">
            <div class="card-head"><h3>Office and hours</h3></div>
            <label class="field"><span>Office name</span><input class="input" name="office_name" value="${esc(s.office_name)}" maxlength="80"></label>
            <div class="row-3">
              <label class="field"><span>Start</span><input class="input" type="time" name="office_start_time" value="${esc(s.office_start_time)}"></label>
              <label class="field"><span>Closing</span><input class="input" type="time" name="office_end_time" value="${esc(s.office_end_time)}"></label>
              <label class="field"><span>Grace (min)</span><input class="input" type="number" min="0" max="60" name="grace_minutes" value="${esc(s.grace_minutes)}"></label>
            </div>
            <div class="field" style="margin-bottom:0"><span>Weekly off days</span><div class="days">${WEEKDAYS.map((d, i) => `<button type="button" class="chip" data-day="${i}" aria-pressed="${offDays.has(i)}">${d.slice(0, 3)}</button>`).join('')}</div></div>
          </section>

          <section class="card">
            <div class="card-head"><h3>Fines</h3></div>
            <p class="muted small" style="margin-bottom:12px">Example: office starts ${time12(s.office_start_time)}. One minute late is ${rs(s.fine_per_hour)}, and each further hour adds ${rs(s.fine_per_hour)}.</p>
            <div class="row-3">
              <label class="field"><span>Per hour late</span><input class="input" type="number" min="0" step="10" name="fine_per_hour" value="${esc(s.fine_per_hour)}"></label>
              <label class="field"><span>No check-out</span><input class="input" type="number" min="0" step="10" name="missed_checkout_fine" value="${esc(s.missed_checkout_fine)}"></label>
              <label class="field"><span>Absent</span><input class="input" type="number" min="0" step="10" name="absent_fine" value="${esc(s.absent_fine)}"></label>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><h3>Office WiFi lock</h3></div>
            <p class="muted small">Check-in only works from these networks. Sit in the office on the WiFi and tap "Add this network".</p>
            <div class="notice ${r.onOfficeNetwork ? 'good' : 'warn'}" style="margin-top:10px">${icon(r.onOfficeNetwork ? 'wifi' : 'wifiOff')}<div><b>${r.onOfficeNetwork ? 'You are on an office network' : 'This network is not on the list'}</b><p>Your network: ${esc(r.currentNetwork)}${r.currentNetwork.includes(':') ? ' (IPv6: the whole network is saved, because phone addresses change every few hours)' : ''}</p></div></div>
            <div class="ip-list" id="ipList"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input class="input" id="ipInput" placeholder="e.g. 182.180.11.45 or 192.168.1.0/24" style="flex:1;min-width:180px">
              <button type="button" class="btn" id="ipAdd">Add</button>
            </div>
            <button type="button" class="btn btn-primary btn-block" id="ipMine" style="margin-top:8px">${icon('wifi', 'icon-s')}Add this network (${esc(r.currentNetwork)})</button>
            <p class="muted small" style="margin-top:6px">Office has two internet lines? Add the network once from each line.</p>
            <div style="margin-top:8px">
              ${sw('enforce_ip_attendance', s.enforce_ip_attendance, 'Check-in only on office WiFi', 'If off, people can check in from any internet.')}
              ${sw('bind_device', s.bind_device, 'One phone per employee', 'Stops someone checking in for a colleague. Reset the phone in Team if someone changes it.')}
              ${sw('enforce_ip_admin', s.enforce_ip_admin, 'Admin panel only on office WiFi', 'Add your own IP first, or you will be locked out.')}
            </div>
            ${r.blocked.length ? `<div class="card-head" style="margin-top:12px"><h3>Recently blocked</h3></div>
              <p class="muted small">If these people were in the office, add their network.</p>
              <div class="list">${r.blocked.slice(0, 6).map(b => `<div class="row"><span class="grow"><span class="title">${esc(b.network)}</span><span class="sub">${esc(b.employee_name)} · ${ago(b.at)}</span></span><button type="button" class="btn btn-s" data-add-net="${esc(b.network)}">Add</button></div>`).join('')}</div>` : ''}
          </section>

          <section class="card">
            <div class="card-head"><h3>Automatic office IP</h3></div>
            <p class="muted small">If your internet's IP keeps changing, use this. An office computer (or the router) opens a secret link every few minutes, and the app always knows the office's current IP.</p>
            ${r.officeLink ? `
              <label class="field" style="margin-top:10px"><span>Secret link (keep private)</span><input class="input" id="officeLink" readonly value="${esc(r.officeLink)}"></label>
              <div class="btn-row"><button type="button" class="btn btn-s" id="copyLink">Copy link</button><button type="button" class="btn btn-s" id="copyTask">Copy Windows command</button><button type="button" class="btn btn-s btn-ghost btn-danger" id="linkOff">Turn off</button></div>
              <p class="muted small" style="margin-top:10px">On an office PC that stays on, open Command Prompt as admin and paste the Windows command once. It opens the link every 5 minutes. Routers with "DDNS / custom URL" can open the link too.</p>
              <div style="margin-top:8px">${r.autoOfficeIPs.length ? r.autoOfficeIPs.slice().reverse().map(a => `<div class="kv"><span>${esc(a.ip)}</span><span>${ago(a.seen_at)}</span></div>`).join('') : '<p class="muted small">Waiting for the first report from the office…</p>'}</div>`
            : '<button type="button" class="btn btn-block" id="linkOn" style="margin-top:10px">Create the office link</button>'}
          </section>

          <section class="card">
            <div class="card-head"><h3>Holidays</h3></div>
            <p class="muted small">No one is marked absent on these days.</p>
            <div class="list" id="holList"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
              <input class="input" type="date" id="holDate" style="width:auto;flex:1;min-width:150px">
              <input class="input" id="holName" placeholder="e.g. Eid ul Fitr" style="flex:2;min-width:150px">
              <button type="button" class="btn" id="holAdd">${icon('plus', 'icon-s')}Add</button>
            </div>
          </section>
        </div>
        <div class="save-bar"><button class="btn btn-primary btn-lg" type="submit">Save settings</button></div>
      </form>

      <div class="settings-grid">
        <section class="card">
          <div class="card-head"><h3>Announcements</h3><button class="btn btn-s" data-act="announce">${icon('megaphone', 'icon-s')}New</button></div>
          <div class="list" id="annList">${ann.announcements.length ? ann.announcements.map(a => `<div class="row"><div class="grow"><span class="title">${esc(a.title)}</span><span class="sub">${a.body ? esc(a.body) + ' · ' : ''}${ago(a.created_at)}</span></div><button class="icon-btn" data-ann-del="${esc(a.id)}" aria-label="Remove announcement">${icon('trash', 'icon-s')}</button></div>`).join('') : '<p class="muted small">No announcements yet.</p>'}</div>
        </section>
        <section class="card">
          <div class="card-head"><h3>Data</h3></div>
          <p class="muted small">Everything is saved in JSON files on the server. A backup is made every night at 11:30 PM (last 14 days kept).</p>
          <div class="btn-row" style="margin-top:10px"><a class="btn btn-s" href="/api/admin/backup" download>${icon('download', 'icon-s')}Download backup</a></div>
          <div class="kv" style="margin-top:10px"><span>Counting started</span><b>${s.tracking_started_on ? dateMed(s.tracking_started_on) : '—'}</b></div>
          <button type="button" class="btn btn-block btn-danger" id="resetAll" style="margin-top:10px">${icon('trash', 'icon-s')}Reset all data (fresh start)</button>
        </section>
        <section class="card">
          <div class="card-head"><h3>Admin password</h3></div>
          <form id="pwForm" novalidate>
            <div class="row-2">
              <label class="field"><span>Current</span><input class="input" type="password" name="cur" autocomplete="current-password"></label>
              <label class="field"><span>New</span><input class="input" type="password" name="next" autocomplete="new-password" minlength="8"></label>
            </div>
            <button class="btn btn-block" type="submit">${icon('lock', 'icon-s')}Change password</button>
            <p class="muted small" style="margin-top:8px">Other devices will be signed out.</p>
          </form>
        </section>
        <section class="card">
          <div class="card-head"><h3>Appearance</h3></div>
          <div class="seg" role="group" aria-label="Theme">${['system', 'light', 'dark'].map(v => `<button type="button" data-theme-set="${v}" aria-pressed="${theme === v}">${v === 'system' ? 'Auto' : v === 'light' ? 'Light' : 'Dark'}</button>`).join('')}</div>
        </section>
      </div>`;

    const paintIPs = () => {
      $('#ipList').innerHTML = ips.length ? ips.map((ip, i) => `<span class="ip-chip">${esc(ip)}${ip === myIP ? ' <span class="small muted">(you)</span>' : ''}<button type="button" data-ip-del="${i}" aria-label="Remove ${esc(ip)}">${icon('x', 'icon-s')}</button></span>`).join('') : '<p class="muted small">No IPs yet. Add one before turning on the WiFi lock.</p>';
    };
    const paintHol = () => {
      holidays.sort((a, b) => a.date.localeCompare(b.date));
      $('#holList').innerHTML = holidays.length ? holidays.map((h, i) => `<div class="row"><span class="nowrap" style="width:110px;flex:none">${dateMed(h.date)}</span><span class="grow">${esc(h.name)}${h.date < state.today ? ' <span class="small muted">(past)</span>' : ''}</span><button type="button" class="icon-btn" data-hol-del="${i}" aria-label="Remove">${icon('trash', 'icon-s')}</button></div>`).join('') : '<p class="muted small" style="padding:8px 0">No holidays added.</p>';
    };
    paintIPs();
    paintHol();

    $('#pushThis').addEventListener('change', async ev => {
      const box = ev.target;
      box.disabled = true;
      try {
        if (box.checked) { await push.enable('/api/admin/push/subscribe', token); toast('Notifications are on for this device.'); }
        else { await push.disable('/api/admin/push/unsubscribe', token); toast('Notifications are off for this device.'); }
        renderSettings();
      } catch (err) { box.checked = !box.checked; box.disabled = false; toast(err.message, 'bad'); }
    });
    $('#pushTest')?.addEventListener('click', async ev => {
      await withBusy(ev.currentTarget, async () => {
        try { toast((await call('/push/test', { method: 'POST' })).message); } catch (err) { toast(err.message, 'bad'); }
      });
    });
    view.querySelectorAll('[data-theme-set]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.themeSet;
      store(THEME_KEY, v === 'system' ? null : v);
      applyTheme(v);
      view.querySelectorAll('[data-theme-set]').forEach(x => x.setAttribute('aria-pressed', x === b));
    }));

    const form = $('#setForm');
    form.addEventListener('click', e => {
      const d = e.target.closest('[data-day]');
      if (d) { const i = Number(d.dataset.day); if (offDays.has(i)) offDays.delete(i); else offDays.add(i); d.setAttribute('aria-pressed', offDays.has(i)); }
      const ipd = e.target.closest('[data-ip-del]');
      if (ipd) { ips.splice(Number(ipd.dataset.ipDel), 1); paintIPs(); }
      const hd = e.target.closest('[data-hol-del]');
      if (hd) { holidays.splice(Number(hd.dataset.holDel), 1); paintHol(); }
    });
    const addIP = v => { v = v.trim(); if (!v) return; if (!ips.includes(v)) ips.push(v); paintIPs(); };
    $('#ipAdd').addEventListener('click', () => { addIP($('#ipInput').value); $('#ipInput').value = ''; });
    $('#ipInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#ipAdd').click(); } });
    $('#ipMine').addEventListener('click', () => { addIP(r.currentNetwork); toast(`${r.currentNetwork} added. Remember to save.`); });
    view.querySelectorAll('[data-add-net]').forEach(b => b.addEventListener('click', async () => {
      try { toast((await call('/office-ips/add', { method: 'POST', body: { network: b.dataset.addNet } })).message); renderSettings(); } catch (err) { toast(err.message, 'bad'); }
    }));
    $('#linkOn')?.addEventListener('click', async () => { try { toast((await call('/office-link', { method: 'POST' })).message); renderSettings(); } catch (err) { toast(err.message, 'bad'); } });
    $('#linkOff')?.addEventListener('click', async () => {
      const ok = await confirmSheet({ title: 'Turn off the office link?', sub: 'IPs reported by it are removed. Networks you added by hand stay.', confirm: 'Turn off', tone: 'solid-danger' });
      if (ok.ok) try { toast((await call('/office-link', { method: 'DELETE' })).message); renderSettings(); } catch (err) { toast(err.message, 'bad'); }
    });
    const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg); } catch (e) { $('#officeLink').select(); toast('Select the link and copy it.', 'warn'); } };
    $('#copyLink')?.addEventListener('click', () => copy(r.officeLink, 'Link copied.'));
    $('#copyTask')?.addEventListener('click', () => copy(`schtasks /create /tn "Office attendance IP" /sc minute /mo 5 /ru SYSTEM /f /tr "curl.exe -s \\"${r.officeLink}\\""`, 'Windows command copied.'));
    $('#resetAll').addEventListener('click', openReset);
    $('#holAdd').addEventListener('click', () => {
      const date = $('#holDate').value;
      if (!date) return toast('Pick a date.', 'warn');
      holidays.push({ date, name: $('#holName').value.trim() || 'Holiday' });
      $('#holDate').value = ''; $('#holName').value = '';
      paintHol();
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = form;
      if (f.enforce_ip_admin.checked && !ips.some(ip => ip === myIP || (ip.endsWith('*') && myIP.startsWith(ip.slice(0, -1))) || ip.includes('/'))) {
        const ok = await confirmSheet({ title: 'Your IP is not in the list', sub: `Limiting the admin panel to office WiFi may lock you (${esc(myIP)}) out. Save anyway?`, confirm: 'Save anyway', tone: 'solid-danger' });
        if (!ok.ok) return;
      }
      const group = (prefix, list) => Object.fromEntries(list.map(([k]) => [k, f[`${prefix}${k}`].checked]));
      const body = {
        office_name: f.office_name.value, office_start_time: f.office_start_time.value, office_end_time: f.office_end_time.value,
        grace_minutes: f.grace_minutes.value, fine_per_hour: f.fine_per_hour.value, missed_checkout_fine: f.missed_checkout_fine.value, absent_fine: f.absent_fine.value,
        enforce_ip_attendance: f.enforce_ip_attendance.checked, enforce_ip_admin: f.enforce_ip_admin.checked, bind_device: f.bind_device.checked,
        office_ips: ips, holidays, weekly_off_days: [...offDays],
        push_admin: group('pa_', ADMIN_EVENTS), push_employee: group('pe_', EMP_EVENTS)
      };
      await withBusy(e.submitter || form.querySelector('[type=submit]'), async () => {
        try { const res = await call('/settings', { method: 'PUT', body }); toast(res.message); setOffice(body.office_name); } catch (err) { toast(err.message, 'bad'); }
      });
    });

    $('#annList').addEventListener('click', async e => {
      const b = e.target.closest('[data-ann-del]');
      if (!b) return;
      try { await call(`/announcements/${encodeURIComponent(b.dataset.annDel)}`, { method: 'DELETE' }); toast('Announcement removed.'); renderSettings(); } catch (err) { toast(err.message, 'bad'); }
    });
    $('#pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      await withBusy(e.submitter, async () => {
        try {
          const res = await call('/settings/change-password', { method: 'POST', body: { current_password: f.cur.value, new_password: f.next.value } });
          if (res.token) { token = res.token; store(TOKEN_KEY, token); }
          toast(res.message);
          f.reset();
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // ---------- Fresh start ----------
  function openReset() {
    const s = sheet({
      title: 'Reset all data?',
      sub: 'For a fresh start after testing. A backup is saved first.',
      body: `<form id="resetForm" novalidate>
        <div class="notice bad" style="margin-bottom:14px">${icon('alert')}<p>This deletes all attendance, fines, payments, requests and notifications. Settings stay.</p></div>
        <label class="field"><span>Start counting from</span><input class="input" type="date" name="start" value="${state.today}"><small>Days before this are never counted as absent.</small></label>
        <label class="switch-row" style="padding-top:0"><span class="grow"><b>Also remove all employees</b><span>Leave off to keep the team and their PINs.</span></span><span class="switch"><input type="checkbox" name="emps"><i></i></span></label>
        <label class="field" style="margin-top:8px"><span>Your admin password</span><input class="input" type="password" name="pw" autocomplete="current-password"></label>
        <label class="field"><span>Type RESET to confirm</span><input class="input" name="confirm" autocomplete="off" autocapitalize="characters"></label>
        <div class="sheet-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-solid-danger" type="submit">Reset everything</button></div>
      </form>`
    });
    s.el.querySelector('#resetForm').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      await withBusy(e.submitter, async () => {
        try {
          const res = await call('/reset', { method: 'POST', body: { start_date: f.start.value, remove_employees: f.emps.checked, password: f.pw.value, confirm: f.confirm.value } });
          toast(res.message);
          s.close();
          state.employees = null;
          location.hash = '#dashboard';
          route();
        } catch (err) { toast(err.message, 'bad'); }
      });
    });
  }

  // ---------- Boot ----------
  (async function boot() {
    push.register();
    // Use the saved session (token or cookie); only ask to sign in if the server says so.
    try {
      await api('/api/admin/push/devices', { token });
      showApp();
    } catch (err) {
      if (err.status === 401) { token = null; store(TOKEN_KEY, null); return showLogin(); }
      if (token) showApp(); else showLogin(err.status === 403 ? err.message : '');
    }
  })();
})();
