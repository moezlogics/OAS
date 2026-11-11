/* Shared helpers for the employee app and the admin panel. */
(function () {
  'use strict';

  // ---------- Theme ----------
  const THEME_KEY = 'hazri.theme';
  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { return null; }
    return value;
  }
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(store(THEME_KEY));

  // ---------- Icons (24px line icons) ----------
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    inbox: '<path d="M4 13.5 6.5 5h11L20 13.5V19H4z"/><path d="M4 13.5h5l1 2h4l1-2h5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    wifi: '<path d="M2.5 8.5a14 14 0 0 1 19 0M5.5 12a9.5 9.5 0 0 1 13 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
    wifiOff: '<path d="m3 3 18 18M8.5 15.5a5 5 0 0 1 6-.8M5.5 12a9.5 9.5 0 0 1 4.3-2.3M2.5 8.5A14 14 0 0 1 7 5.7M14.5 9.7a9.5 9.5 0 0 1 4 2.3M21.5 8.5a14 14 0 0 0-8.7-3.9"/><circle cx="12" cy="19" r="1"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    login: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16.5 14.5 12 10 7.5M14.5 12H3"/>',
    logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 16.5 19.5 12 15 7.5M19.5 12H9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    left: '<path d="m14.5 6-6 6 6 6"/>',
    right: '<path d="m9.5 6 6 6-6 6"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 20h16"/>',
    printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5"/>',
    megaphone: '<path d="M3 10v4l11 5V5z"/><path d="M14 8.5a4 4 0 0 1 0 7M6.5 15.5 8 21h3l-1.2-4.2"/>',
    flame: '<path d="M12 21c4 0 7-2.7 7-6.8 0-3.6-2.6-6-4.2-8.2-.4 2.2-1.6 3.5-2.8 4C12 7 10.7 4.6 9 3c0 4-4 6.3-4 11.2C5 18.3 8 21 12 21z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5M12 17.5v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.5"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18h2"/>',
    more: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/><path d="M6 6l9-3 1.5 3"/>',
    bellOff: '<path d="M6 9a6 6 0 0 1 9.4-4.9M18 9c0 6 2.5 7.5 2.5 7.5H8M10 20a2 2 0 0 0 4 0M3 3l18 18"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
    share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/>',
    party: '<path d="M4 20 9 7l8 8z"/><path d="M14 4.5c.5 1.5 0 3-1.5 4M19.5 10c-1.5-.5-3 0-4 1.5M18 3.5v1M21 7h-1M15.5 2.5h0"/>'
  };
  function icon(name, cls = '') {
    return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
  }

  // ---------- Formatting ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const keyToDate = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (key, n) => { const d = keyToDate(key); d.setDate(d.getDate() + n); return dateKey(d); };

  function time12(v) {
    if (!v) return '—';
    let h, m;
    if (/^\d{2}:\d{2}$/.test(v)) [h, m] = v.split(':').map(Number);
    else { const d = new Date(v); h = d.getHours(); m = d.getMinutes(); }
    return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  const dateLong = key => keyToDate(key).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateMed = key => keyToDate(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const dateShort = key => keyToDate(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const monthName = key => keyToDate(key).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const rs = n => `Rs ${Number(n || 0).toLocaleString('en-PK')}`;
  function duration(hours) {
    if (!hours || hours < 0) return '0m';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return h ? `${h}h ${pad(m)}m` : `${m}m`;
  }
  function mins(n) {
    if (n < 60) return `${n} min`;
    const h = Math.floor(n / 60);
    return `${h}h ${pad(n % 60)}m`;
  }
  function ago(iso) {
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) { const h = Math.floor(s / 3600); return `${h} hour${h === 1 ? '' : 's'} ago`; }
    if (s < 86400 * 7) { const d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`; }
    return dateShort(iso.slice(0, 10));
  }
  function greeting(d = new Date()) {
    const h = d.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }
  const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const firstName = name => String(name || '').split(/\s+/)[0] || '';
  function avatar(emp, size = '') {
    return `<span class="avatar ${size}" style="--c:${esc(emp.avatar_color || '#2b4acb')}" aria-hidden="true">${esc(initials(emp.name || emp.employee_name))}</span>`;
  }

  const STATUS = {
    PRESENT: 'On time', LATE: 'Late', ABSENT: 'Absent', LEAVE: 'Leave', PENDING: 'Leave pending',
    OFF: 'Day off', HOLIDAY: 'Holiday', UPCOMING: 'Upcoming', NOT_YET: 'Not in yet', NA: 'Not joined',
    APPROVED: 'Approved', REJECTED: 'Rejected'
  };
  const pill = (status, label) => `<span class="pill st-${status}">${esc(label || STATUS[status] || status)}</span>`;
  function fineHtml(day) {
    if (!day) return '';
    const f = Number(day.fine || 0);
    const auto = Number(day.autoFine || 0);
    if (day.adjusted && auto !== f) return `<span class="fine"><s>${rs(auto)}</s>${rs(f)}</span>`;
    return f ? `<span class="fine">${rs(f)}</span>` : '<span class="fine zero">—</span>';
  }

  // ---------- Network ----------
  // Called when the server renews a session, so the app can keep the new token.
  let onSessionToken = null;
  function setSessionHandler(fn) { onSessionToken = fn; }

  async function api(path, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(path, { method, headers, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      const err = new Error('Could not reach the server. Check your internet connection.');
      err.status = 0;
      throw err;
    }
    const renewed = res.headers.get('X-Session-Token');
    if (renewed && onSessionToken) onSessionToken(renewed);
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || data.success === false) {
      const err = new Error(data.message || `Something went wrong (${res.status}).`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- Toast ----------
  function toast(message, tone = 'good') {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.innerHTML = `${icon(tone === 'good' ? 'checkCircle' : tone === 'bad' ? 'alert' : 'info')}<span>${esc(message)}</span>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // ---------- Sheet (bottom sheet on phones, dialog on desktop) ----------
  function sheet({ title, sub = '', body = '', wide = false, onOpen } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-head">
          <div><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ''}</div>
          <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
        </div>
        <div class="sheet-body"></div>
      </div>`;
    const bodyEl = overlay.querySelector('.sheet-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    const prevFocus = document.activeElement;
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    const first = overlay.querySelector('.sheet-body input, .sheet-body textarea, .sheet-body select');
    if (first && window.matchMedia('(min-width: 720px)').matches) first.focus();
    else overlay.querySelector('.sheet').focus?.();
    const api = { el: overlay, body: bodyEl, close };
    if (onOpen) onOpen(api);
    return api;
  }

  function confirmSheet({ title, sub = '', confirm = 'Yes', tone = 'primary', extra = '' }) {
    return new Promise(resolve => {
      let done = false;
      const s = sheet({
        title, sub,
        body: `${extra}<div class="sheet-actions"><button class="btn" data-close>Cancel</button><button class="btn btn-${tone}" data-ok>${esc(confirm)}</button></div>`
      });
      s.el.querySelector('[data-ok]').addEventListener('click', () => {
        done = true;
        const field = s.el.querySelector('[data-value]');
        resolve({ ok: true, value: field ? field.value : undefined });
        s.close();
      });
      const obs = new MutationObserver(() => {
        if (!document.body.contains(s.el)) { obs.disconnect(); if (!done) resolve({ ok: false }); }
      });
      obs.observe(document.body, { childList: true });
    });
  }

  async function withBusy(btn, fn) {
    if (!btn) return fn();
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    try { return await fn(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); if (document.body.contains(btn)) btn.innerHTML = old; }
  }

  // ---------- Month calendar ----------
  function calendar(days, { todayKey, onPick } = {}) {
    const wrap = document.createElement('div');
    if (!days.length) return wrap;
    const first = keyToDate(days[0].date);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const heads = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="cal-head">${d}</div>`).join('');
    const blanks = '<div class="cal-day blank"></div>'.repeat(lead);
    const cells = days.map((d, i) => {
      const label = `${dateLong(d.date)}: ${STATUS[d.status] || d.status}${d.fine ? `, ${rs(d.fine)} fine` : ''}`;
      const mark = d.fine ? '<i class="mark"></i>' : '';
      return `<button type="button" class="cal-day c-${d.status} ${d.date === todayKey ? 'is-today' : ''}" data-i="${i}" aria-label="${esc(label)}">${d.day}${mark}</button>`;
    }).join('');
    wrap.innerHTML = `<div class="cal">${heads}${blanks}${cells}</div>
      <div class="legend">
        <span><i style="background:var(--ontime-soft);box-shadow:inset 0 0 0 1.5px var(--ontime)"></i>On time</span>
        <span><i style="background:var(--late-soft);box-shadow:inset 0 0 0 1.5px var(--late)"></i>Late</span>
        <span><i style="background:var(--absent-soft);box-shadow:inset 0 0 0 1.5px var(--absent)"></i>Absent</span>
        <span><i style="background:var(--leave-soft);box-shadow:inset 0 0 0 1.5px var(--leave)"></i>Leave</span>
        <span><i style="background:var(--absent);border-radius:50%;width:7px;height:7px"></i>Fine</span>
      </div>`;
    wrap.addEventListener('click', e => {
      const b = e.target.closest('.cal-day[data-i]');
      if (b && onPick) onPick(days[Number(b.dataset.i)]);
    });
    return wrap;
  }

  // Detail lines for one day (used in sheets).
  function dayDetailHtml(d) {
    const rows = [];
    const row = (k, v) => rows.push(`<div class="kv"><span>${k}</span><span>${v}</span></div>`);
    row('Status', pill(d.status, d.label || (d.leaveType && d.status !== 'PRESENT' && d.status !== 'LATE' ? d.leaveType : undefined)));
    if (d.checkIn) row('Check-in', time12(d.checkIn));
    if (d.checkIn) row('Check-out', d.checkOut ? time12(d.checkOut) : d.missedCheckout ? '<span class="bad">Missed</span>' : 'Not yet');
    if (d.hours) row('Hours worked', duration(d.hours));
    if (d.lateMinutes) row('Late', mins(d.lateMinutes));
    if (d.earlyCheckout) row('Left early', mins(d.earlyMinutes));
    if (d.status !== 'OFF' && d.status !== 'HOLIDAY' && d.status !== 'UPCOMING' && d.status !== 'NOT_YET') row('Fine', fineHtml(d));
    let notes = '';
    if (d.note) notes += `<div class="notice" style="margin-top:12px">${icon('info')}<div><b>Reason given</b><p>${esc(d.note)}</p></div></div>`;
    if (d.reason) notes += `<div class="notice" style="margin-top:12px">${icon('info')}<div><b>Details</b><p>${esc(d.reason)}</p></div></div>`;
    if (d.fineNote) notes += `<div class="notice ${d.fine ? 'warn' : ''}" style="margin-top:12px">${icon('edit')}<div><b>Admin's note</b><p>${esc(d.fineNote)}</p></div></div>`;
    return `<div>${rows.join('')}</div>${notes}`;
  }

  // ---------- Push notifications ----------
  const push = {
    supported() {
      return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    },
    // iPhone only allows notifications once the app is on the Home Screen.
    needsInstall() {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
      return ios && !standalone;
    },
    permission() { return 'Notification' in window ? Notification.permission : 'unsupported'; },
    async register() {
      if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
      try { return await navigator.serviceWorker.register('/sw.js'); } catch (e) { return null; }
    },
    async current() {
      if (!push.supported()) return null;
      const reg = await navigator.serviceWorker.getRegistration('/');
      return reg ? reg.pushManager.getSubscription() : null;
    },
    async enable(subscribePath, token) {
      if (push.needsInstall()) throw new Error('On iPhone, first tap Share, then "Add to Home Screen". Open the app from the Home Screen and turn on notifications there.');
      if (!push.supported()) throw new Error('This browser does not support notifications. Try Chrome.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in your browser settings.');
      const reg = (await push.register()) || (await navigator.serviceWorker.ready);
      await navigator.serviceWorker.ready;
      const { publicKey } = await api('/api/push/key');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api(subscribePath, { method: 'POST', body: { subscription: sub.toJSON() }, token });
      return sub;
    },
    async disable(unsubscribePath, token) {
      const sub = await push.current();
      if (!sub) return;
      await api(unsubscribePath, { method: 'POST', body: { endpoint: sub.endpoint }, token }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    },
    // Re-send an existing subscription so the server always has it.
    async sync(subscribePath, token) {
      try {
        if (!push.supported() || Notification.permission !== 'granted') return false;
        const sub = await push.current();
        if (!sub) return false;
        await api(subscribePath, { method: 'POST', body: { subscription: sub.toJSON() }, token });
        return true;
      } catch (e) { return false; }
    }
  };
  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  // ---------- Install as an app (PWA) ----------
  // Chrome, Edge and Android offer a real install prompt; we keep it and show
  // it when the person taps "Install app". iPhone and some browsers have no
  // prompt, so we show short steps instead.
  let deferredPrompt = null;
  const installListeners = [];
  const fireInstall = () => installListeners.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; fireInstall(); });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    store('hazri.installed', '1');
    fireInstall();
    toast('App installed. Open it from your home screen or desktop.');
  });

  const install = {
    isStandalone() {
      return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: minimal-ui)').matches || window.navigator.standalone === true;
    },
    // True when it makes sense to suggest installing (not already in the app, not just installed).
    available() { return !install.isStandalone() && !store('hazri.installed'); },
    canPrompt() { return !!deferredPrompt; },
    onChange(fn) { installListeners.push(fn); },
    device() {
      const ua = navigator.userAgent;
      const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (ios) return { os: 'ios', browser: /CriOS|FxiOS|EdgiOS/i.test(ua) ? 'other' : 'safari' };
      if (/android/i.test(ua)) return { os: 'android', browser: /SamsungBrowser/i.test(ua) ? 'samsung' : /Firefox/i.test(ua) ? 'firefox' : 'chrome' };
      const browser = /Edg\//.test(ua) ? 'edge' : /Firefox/i.test(ua) ? 'firefox' : /Chrome/i.test(ua) ? 'chrome' : /Safari/i.test(ua) ? 'safari' : 'other';
      return { os: 'desktop', browser };
    },
    // Call straight from a click handler (the browser needs a real tap).
    async start(appName) {
      if (deferredPrompt) {
        const p = deferredPrompt;
        deferredPrompt = null;
        p.prompt();
        const choice = await p.userChoice.catch(() => ({ outcome: 'dismissed' }));
        fireInstall();
        return choice.outcome;
      }
      install.help(appName);
      return 'help';
    },
    help(appName = 'the app') {
      const d = install.device();
      const shareIcon = icon('share', 'icon-s');
      let steps;
      let note = '';
      if (d.os === 'ios') {
        steps = [
          `Tap the <b>Share</b> button ${shareIcon} at the bottom of ${d.browser === 'safari' ? 'Safari' : 'the browser'}.`,
          'Scroll down and tap <b>Add to Home Screen</b>.',
          'Tap <b>Add</b>. Open it from your Home Screen from now on.'
        ];
        note = 'Notifications on iPhone only work when the app is opened from the Home Screen.';
        if (d.browser !== 'safari') note = 'If you don’t see "Add to Home Screen", open this page in Safari and try again. ' + note;
      } else if (d.os === 'android') {
        steps = d.browser === 'samsung'
          ? ['Tap the menu <b>≡</b> at the bottom.', 'Tap <b>Add page to</b>, then <b>Home screen</b>.', 'Open it from your home screen from now on.']
          : ['Tap the menu <b>⋮</b> at the top right.', 'Tap <b>Install app</b> or <b>Add to Home screen</b>.', 'Tap <b>Install</b>. Open it from your home screen from now on.'];
      } else if (d.browser === 'chrome' || d.browser === 'edge') {
        steps = [
          `Click the install icon ${icon('download', 'icon-s')} at the right end of the address bar.`,
          `Or open the menu <b>⋮</b>${d.browser === 'edge' ? ' → <b>Apps</b> → <b>Install this site as an app</b>' : ' → <b>Cast, save and share</b> → <b>Install page as app</b>'}.`,
          'It opens in its own window and gets an icon on your desktop and taskbar.'
        ];
      } else if (d.browser === 'safari') {
        steps = ['In the menu bar, click <b>File</b> → <b>Add to Dock</b>.', 'Click <b>Add</b>. Open it from the Dock from now on.'];
      } else {
        steps = ['This browser can’t install apps.', 'Open this page in <b>Chrome</b> or <b>Edge</b>, then click the install icon in the address bar.'];
      }
      sheet({
        title: `Install ${appName}`,
        sub: 'It opens like a normal app, with its own icon.',
        body: `<ol class="steps">${steps.map(s => `<li><span>${s}</span></li>`).join('')}</ol>${note ? `<p class="muted small" style="margin-top:12px">${note}</p>` : ''}<div class="sheet-actions"><button class="btn btn-primary" data-close>Got it</button></div>`
      });
    }
  };

  window.H = {
    push, install, setSessionHandler,
    icon, esc, pad, keyToDate, dateKey, addDays, time12, dateLong, dateMed, dateShort, monthName,
    rs, duration, mins, ago, greeting, initials, firstName, avatar, STATUS, pill, fineHtml,
    api, toast, sheet, confirmSheet, withBusy, calendar, dayDetailHtml, store, applyTheme, THEME_KEY
  };
})();
