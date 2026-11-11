/* The day ribbon: the office day from 30 min before start until closing,
   split into fine zones (free, Rs 100, Rs 200 …) with a "now" needle and
   the employee's own check-in / check-out marks. */
(function () {
  'use strict';
  const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const label = (m, ampm) => { const h = Math.floor(m / 60); const mm = m % 60; return `${h % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ampm ? (h >= 12 ? ' PM' : ' AM') : ''}`; };
  const minOf = iso => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

  function ribbon({ startTime = '09:30', endTime = '17:00', finePerHour = 100, graceMinutes = 0, now = new Date(), checkIn = null, checkOut = null, compact = false }) {
    const start = toMin(startTime) + Number(graceMinutes || 0);
    const end = toMin(endTime);
    const from = start - 30;
    const span = end - from;
    const pct = m => Math.max(0, Math.min(100, ((m - from) / span) * 100));

    // Zones: free, then one per started hour (max 4 shown, the rest merged).
    const zones = [{ a: from, b: start, cls: 'z-free', text: 'Rs 0' }];
    for (let k = 1; k <= 4; k++) {
      const a = start + (k - 1) * 60;
      if (a >= end) break;
      let b = Math.min(start + k * 60, end);
      let text = String(k * finePerHour);
      if (k === 4 && start + k * 60 < end) { b = end; text += '+'; }
      zones.push({ a, b, cls: `z-${k}`, text });
    }

    const nowMin = now.getHours() * 60 + now.getMinutes();
    const inMin = checkIn ? minOf(checkIn) : null;
    const outMin = checkOut ? minOf(checkOut) : null;
    const ticks = [start, ...zones.slice(1).map(z => z.b)].filter((v, i, a) => a.indexOf(v) === i);

    const zonesHtml = zones.map(z => { const w = pct(z.b) - pct(z.a); return `<div class="zone ${z.cls}" style="left:${pct(z.a)}%;width:${w}%">${w >= 9 ? `<span>${z.text}</span>` : ''}</div>`; }).join('');
    const ticksHtml = ticks.map((t, i) => `<span class="tick" style="left:${pct(t)}%">${label(t, i === ticks.length - 1)}</span>`).join('');
    let marks = '';
    if (inMin !== null) {
      const stop = outMin !== null ? outMin : Math.min(nowMin, end);
      if (stop > inMin) marks += `<div class="worked" style="left:${pct(inMin)}%;width:${pct(stop) - pct(inMin)}%"></div>`;
      marks += `<div class="rb-pin rb-in" style="left:${pct(inMin)}%" title="Check-in"></div>`;
      if (outMin !== null) marks += `<div class="rb-pin rb-out" style="left:${pct(outMin)}%" title="Check-out"></div>`;
    }
    const showNow = nowMin >= from - 60 && nowMin <= end + 60 && outMin === null;
    const np = pct(nowMin);
    const needle = showNow ? `<div class="needle ${np > 88 ? 'r' : np < 12 ? 'l' : ''}" style="left:${np}%"><b>Now</b></div>` : '';

    const desc = `Office day from ${label(start, true)} to ${label(end, true)}. No fine until ${label(start, true)}, then Rs ${finePerHour} for every hour late.`;
    return `<div class="ribbon ${compact ? 'compact' : ''}" role="img" aria-label="${desc}">
      <div class="track">${zonesHtml}${marks}${needle}</div>
      <div class="ticks">${ticksHtml}</div>
    </div>`;
  }

  window.Ribbon = { render: ribbon };
})();
