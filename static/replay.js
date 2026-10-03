/* Shared replay core for the mission console (app.js) and the customer console (customer.js).
   Loads the compact mission JSON (hydrate.js), derives the timeline (key times, non-linear time axis, pacing windows,
   vehicle attitudes) and answers "what is the state at time t" for the launch samples and the lab frames. No DOM. */
(function () {
  'use strict';
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
  const pad2 = (x) => String(x).padStart(2, '0');
  const hms = (s) => { s = Math.max(0, Math.floor(s)); return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s % 3600 / 60)) + ':' + pad2(s % 60); };
  const clock = (t) => hms(t < 0 ? Math.ceil(-t) : t);
  const met = (t) => (t < 0 ? 'T−' : 'T+') + clock(t);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const km = (x) => Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') + ' km' : x.toFixed(1) + ' km';
  const nice = (s) => String(s || '').replace(/_/g, ' ');
  const lastBefore = (arr, t) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };

  const T0 = -15;                                         // the replay starts at T-15 s
  const MILESTONES = [['LIFTOFF', 'LIFTOFF'], ['MAXQ', 'MAX-Q'], ['MECO', 'MECO'], ['SEP', 'STAGE SEP'], ['BOOSTBACK_START', 'DIVERT BURN'], ['FINS_DEPLOY', 'DRAG FINS'], ['SECO1', 'SECO-1'],
    ['ENTRY_BURN', 'ENTRY BURN'], ['LANDING_BURN', 'LANDING BURN'], ['TOUCHDOWN', 'TOUCHDOWN'], ['SES2', 'SES-2'], ['ORBIT', 'ORBIT']];
  const CAPSULE = { CAPSULE_LOAD: 'docked', CAPSULE_SEP: 'sep', DEORBIT_BURN: 'deorbit', ENTRY_INTERFACE: 'entry', PEAK_HEATING: 'entry', DROGUE: 'chute', MAIN_CHUTE: 'chute', SPLASHDOWN: 'landed', RECOVERY: 'landed', SAMPLE_HANDOVER: 'landed' };

  async function load(mode, onRetry) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch('api/mission/' + mode + '.json');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return prepare(window.hydrateMission(await r.json()));
      } catch (e) {
        if (attempt >= 12) throw e;
        if (onRetry) onRetry(attempt + 2, e);
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
  }
  function prepare(M) {
    M.events.sort((a, b) => a.t - b.t);
    const ev = M.events, tOf = (code, dflt) => { const e = ev.find((x) => x.code === code && x.seg !== 'OPS'); return e ? e.t : dflt; };
    const by = {}; for (const s of M.launch) (by[s.body] = by[s.body] || []).push(s);
    const st = by.stack || [], up = by.upper || [], bo = by.booster || [];
    const tEnd = ev[ev.length - 1].t + 30, opsStart = M.frames.length ? M.frames[0].t : tEnd;
    const X = M.x = { by, tEnd, opsStart, tMeco: up.length ? up[0].t : tOf('MECO', 135), tSep: tOf('SEP', 140), tFlip: tOf('BOOSTBACK_START', 141),
      tFins: tOf('FINS_DEPLOY', 300), tLandBurn: tOf('LANDING_BURN', 460), tTouch: tOf('TOUCHDOWN', tOf('HARD_LANDING', bo.length ? bo[bo.length - 1].t : 500)),
      tSeco: tOf('SECO', opsStart), tReturn: tOf('CAPSULE_LOAD', Infinity), tEom: tOf('END', tEnd), tIntr: tOf('INTRUSION', Infinity), lz: (M.launch_meta || {}).landing_zone_km || 0 };
    // attitudes (rad from the local vertical towards downrange): stack flies prograde, the upper stage pitches to its burn
    // attitude, the booster flips, holds engines-first through the divert burn and then points retrograde down to the deck
    const dir = (arr, i, w) => { const a = arr[Math.max(i - w, 0)], b = arr[Math.min(i + w, arr.length - 1)]; return [b.downrange_km - a.downrange_km, b.alt_km - a.alt_km]; };
    st.forEach((s, i) => { const [dx, dy] = dir(st, i, 3); s.att = Math.atan2(dx, Math.max(dy, 1e-6)); });
    X.sepAtt = st.length ? st[st.length - 1].att : 0.8;
    up.forEach((s) => { s.att = lerp(X.sepAtt, 1.52, smooth((s.t - X.tMeco) / 10)); });
    bo.forEach((s, i) => { const [dx, dy] = dir(bo, i, 1);
      s.att = s.phase === 'coast' ? lerp(X.sepAtt, -Math.PI / 2, smooth((s.t - X.tMeco) / Math.max(X.tFlip - X.tMeco, 1)))
        : s.phase === 'boostback' || dy >= 0 ? -Math.PI / 2 : Math.atan2(-dx, -dy) * clamp(s.speed_ms / 40, 0, 1); });
    // the attack window gets its own stretch of the timeline; launch and coast are stretched and compressed
    const cm = M.capsule_meta || null;
    X.cap = (M.capsule || []).slice().sort((a, b) => a.t - b.t);
    X.tEI = cm ? cm.t_entry_interface : Infinity; X.tDrogue = cm ? cm.t_drogue : Infinity; X.tMain = cm ? cm.t_main : Infinity;
    X.tSplash = cm ? cm.t_splash : Infinity; X.tRecovery = cm ? cm.t_recovery : Infinity; X.tPeak = tOf('PEAK_HEATING', Infinity);
    X.retShot = cm && X.cap.length ? [X.tEI - 20, X.tRecovery + 60] : null;
    X.atk = isFinite(X.tIntr);
    if (X.atk) { X.tAtk0 = X.tIntr - 30;
      X.tAtk1 = Math.max(...ev.filter((e) => e.t >= X.tIntr && e.t < X.tIntr + 900 && (e.seg === 'ATTACK' || e.code === 'CONTAIN' || e.code === 'KEYS' || e.code === 'LEDGER_TAMPER')).map((e) => e.t)) + 30;
      const a = X.tAtk0 - opsStart, b = tEnd - X.tAtk1, xa = .30 + .62 * a / (a + b);
      X.kT = [T0, X.tTouch + 20, opsStart, X.tAtk0, X.tAtk1, tEnd]; X.kX = [0, .24, .30, xa, xa + .08, 1];
      X.atkCmds = ev.filter((e) => e.data && e.data.final && e.data.route !== 'ground' && e.t >= X.tIntr);
    } else { X.kT = [T0, X.tTouch + 20, opsStart, tEnd]; X.kX = [0, .24, .30, 1]; X.atkCmds = []; }
    X.bands = [[T0, X.tMeco, 'ASCENT', ''], [X.tMeco, X.tTouch + 20, 'BOOSTER LANDING', 'b-booster'], [X.tTouch + 20, opsStart, 'COAST', '']];
    const opsEnd = Math.min(X.tReturn, tEnd);
    if (X.atk) X.bands.push([opsStart, X.tAtk0, 'LAB OPERATIONS', ''], [X.tAtk0, X.tAtk1, 'ATTACK', 'b-sentinel'], [X.tAtk1, opsEnd, 'LAB OPERATIONS', '']);
    else X.bands.push([opsStart, opsEnd, 'LAB OPERATIONS', '']);
    if (isFinite(X.tReturn)) X.bands.push([X.tReturn, X.tEom, 'SAMPLE RETURN', 'b-return'], [X.tEom, tEnd, '', '']);
    const KEY = new Set(MILESTONES.map((m) => m[0]));
    X.marks = ev.filter((e) => e.t >= T0 && ((KEY.has(e.code) && e.seg !== 'OPS') || e.code === 'SOLAR' || e.code === 'KEYS' || e.seg === 'ATTACK' || e.seg === 'RETURN' || e.seg === 'CUSTOMER'
      || (e.level !== 'info' && e.seg !== 'COMMS' && e.code !== 'EXECUTE' && e.code !== 'SESSION')));
    X.miles = MILESTONES.map(([code, label]) => ({ code, label, t: tOf(code, null) })).filter((m) => m.t != null).sort((a, b) => a.t - b.t);
    // director pacing (speed AUTO): slow windows around the moments worth watching
    X.slow = [];
    for (const e of ev) { if (e.t < opsStart || (X.atk && e.t >= X.tAtk0 && e.t <= X.tAtk1)) continue;
      if (['FAULT', 'ISOLATE', 'SOLAR', 'END'].includes(e.code) || e.seg === 'RETURN' || e.seg === 'CUSTOMER' || (e.data && e.data.final && e.data.final !== 'EXECUTE')) X.slow.push([e.t - 20, e.t + 40, 15]); }
    if (X.atk) X.slow.push([X.tAtk0 + 15, X.tAtk1 - 10, 5]);
    // chart extents
    const ceilTo = (v, step) => Math.ceil(v / step) * step;
    X.xMax = ceilTo(Math.max(120, ...bo.map((s) => s.downrange_km)) * 1.1, 100);
    X.yMax = ceilTo(Math.max(60, ...bo.map((s) => s.alt_km), ...st.map((s) => s.alt_km)) * 1.15, 50);
    X.tChart = X.tTouch + 20;
    X.vMax = Math.max(2, Math.ceil(Math.max(...st.map((s) => s.speed_ms), ...up.filter((s) => s.t <= X.tChart).map((s) => s.speed_ms), 1000) / 1000 * 1.04));
    return M;
  }
  const pw = (xs, ys, v) => { if (v <= xs[0]) return ys[0]; for (let i = 1; i < xs.length; i++) if (v <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (v - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[ys.length - 1]; };
  const t2x = (M, t) => pw(M.x.kT, M.x.kX, t), x2t = (M, x) => pw(M.x.kX, M.x.kT, x);
  const lastEvent = (M, t, pred) => { const ev = M.events; for (let i = lastBefore(ev, t); i >= 0; i--) if (pred(ev[i])) return ev[i]; return null; };

  const NUM = ['alt_km', 'speed_ms', 'downrange_km', 'prop_pct', 'q_kpa', 'g_load', 'fins', 'heat_kw_m2', 'att'];
  function sampleAt(arr, t) {
    const i = lastBefore(arr, t); if (i < 0) return null;
    const a = arr[i], b = arr[i + 1]; if (!b || b.t - a.t > 30) return a;
    const k = (t - a.t) / (b.t - a.t), o = { t, body: a.body, phase: a.phase, throttle: a.throttle };
    for (const f of NUM) o[f] = lerp(a[f] || 0, b[f] || 0, k);
    return o;
  }
  function launchState(M, t) {
    const X = M.x, st = X.by.stack || [], up = X.by.upper || [], bo = X.by.booster || [], L = { sepAtt: X.sepAtt, sepAge: t - X.tMeco, finsAge: t - X.tFins, touchAge: t - X.tTouch };
    if (up.length && t >= up[0].t) {
      L.upper = t > up[up.length - 1].t ? Object.assign({}, up[up.length - 1], { throttle: 0, phase: 'orbit', g_load: 0 }) : sampleAt(up, t);
      if (bo.length && t >= bo[0].t) L.booster = t >= X.tTouch
        ? Object.assign({}, bo[bo.length - 1], { phase: 'landed', landed: true, throttle: 0, speed_ms: 0, alt_km: 0, q_kpa: 0, g_load: 1, heat_kw_m2: 0, fins: 1, att: 0 }) : sampleAt(bo, t);
    } else if (!st.length || t < st[0].t) {
      const full = st.length ? st[0].throttle : 1;   // pumps spin up and the cluster ignites at T-3 s
      L.stack = { t, body: 'stack', phase: t < -3 ? 'countdown' : 'ignition', alt_km: 0, speed_ms: 0, downrange_km: 0, throttle: t < -3 ? 0 : full * clamp((t + 3) / 3, .15, 1), prop_pct: 100, q_kpa: 0, g_load: 1, fins: 0, heat_kw_m2: 0, att: 0 };
    } else L.stack = sampleAt(st, t);
    return L;
  }
  function moduleState(m) {
    if (m.state === 'isolated' || m.health < 0.5) return 'crit';
    if (m.state === 'in_transfer' || m.state === 'in_lab') return 'move';
    if (!m.state || m.state === 'stowed') return 'idle';
    if (m.health < 0.9 || !m.sealed) return 'warn';
    return 'good';
  }
  function opsFrame(M, t) {         // the lab frame at t, with the arm pose interpolated towards the next frame
    const F = M.frames, i = Math.max(lastBefore(F, t), 0), f = F[i], n = F[i + 1];
    if (!M._ops || M._ops.i !== i) M._ops = { i, states: f.modules.map(moduleState) };
    const states = M._ops.states, a = f.platform.arm, b = n && n.platform.arm;
    if (!b || !a.joints || !b.joints || (!a.busy && !b.busy)) return { f, view: f, i, states };
    const k = clamp((t - f.t) / (n.t - f.t), 0, 1), dr = ((b.ring_deg - a.ring_deg + 540) % 360) - 180;
    const arm = Object.assign({}, a, { joints: a.joints.map((v, j) => lerp(v, b.joints[j], k)), ring_deg: a.ring_deg + dr * k });
    return { f, i, states, view: { t: f.t, modules: f.modules, comms: f.comms, gate: f.gate, platform: Object.assign({}, f.platform, { arm }) } };
  }
  const CAPNUM = ['alt_km', 'speed_ms', 'x_km', 'fpa_deg', 'g_load', 'heat_kw_m2', 'mach'];
  function capsuleAt(M, t) {      // capsule state for the 3-D return shot, or null outside it
    const X = M.x, C = X.cap; if (!X.retShot || t < X.retShot[0] || t >= X.retShot[1]) return null;
    const i = lastBefore(C, t), a = C[Math.max(i, 0)], b = C[i + 1], cm = M.capsule_meta, o = {};
    if (!b || t >= X.tSplash) Object.assign(o, C[C.length - 1]);
    else { const k = clamp((t - a.t) / (b.t - a.t), 0, 1); for (const f of CAPNUM) o[f] = lerp(a[f], b[f], k); }
    o.phase = t < X.tEI ? 'coast' : t < X.tDrogue ? 'entry' : t < X.tMain ? 'drogue' : t < X.tSplash ? 'main' : 'floating';
    return Object.assign(o, { t, tDrogue: X.tDrogue, tMain: X.tMain, tSplash: X.tSplash, tRecovery: X.tRecovery,
      splashKm: cm.splash_downrange_km, shipKm: cm.ship_offset_km, shipMs: cm.ship_speed_ms });
  }
  function capsuleState(M, t) { const rc = lastEvent(M, t, (e) => e.seg === 'RETURN' || e.code === 'SAMPLE_HANDOVER'); return rc ? CAPSULE[rc.code] || 'docked' : 'docked'; }
  function autoRate(M, t) {
    const X = M.x;
    if (t < 0) return 1.5;
    if (t < X.tMeco - 4) return 8;
    if (t < X.tFlip + 9) return 2;                   // MECO, separation, flip, divert burn
    if (t < X.tFins - 12) return 30;                 // coast over the top
    if (t < X.tFins + 9) return 1.2;                 // drag fins open: close-up, close to real time
    if (t < X.tLandBurn - 5) return 10;              // fins, entry burn, aerodynamic descent
    if (t < X.tTouch + 12) return 3;                 // landing burn and touchdown
    if (t < X.tSeco - 40) return 300;                // upper-stage coast to apogee
    if (t < X.opsStart) return 20;                   // circularisation
    if (X.retShot && t >= X.retShot[0] && t < X.retShot[1]) {   // the return shot: entry, drogue, main, splashdown, ship
      if (t < X.tDrogue - 8) return Math.abs(t - X.tPeak) < 40 ? 8 : 15;
      if (t < X.tMain - 5) return 25;
      if (t < X.tSplash - 20) return 20;
      if (t < X.tSplash + 15) return 8;
      return 120;
    }
    for (const [a, b, v] of X.slow) if (t >= a && t <= b) return v;
    const F = M.frames, i = lastBefore(F, t);
    return i >= 0 && F[i].platform.arm.busy ? 40 : 300;
  }
  const CAP_PHASE = { coast: 'COASTING TO ENTRY', entry: 'ENTRY', drogue: 'DROGUE', main: 'MAIN CANOPY', floating: 'IN THE WATER' };
  function capsuleReadout(c) {      // one line of live capsule numbers for the 3-D view
    if (c.t >= c.tRecovery) return 'CAPSULE ABOARD THE RECOVERY SHIP · cold chain 4 °C';
    if (c.phase === 'floating') return `CAPSULE IN THE WATER · recovery ship ${Math.max(0, c.shipKm - (c.t - c.tSplash) * c.shipMs / 1000).toFixed(1)} km away`;
    const alt = c.alt_km >= 10 ? c.alt_km.toFixed(1) : c.alt_km.toFixed(2), v = c.speed_ms >= 1000 ? (c.speed_ms / 1000).toFixed(2) + ' km/s' : Math.round(c.speed_ms) + ' m/s';
    const q = c.heat_kw_m2 >= 1000 ? (c.heat_kw_m2 / 1000).toFixed(2) + ' MW/m²' : c.heat_kw_m2 >= 1 ? Math.round(c.heat_kw_m2) + ' kW/m²' : '';
    return ['CAPSULE · ' + CAP_PHASE[c.phase], alt + ' km', v, c.g_load >= 0.05 ? c.g_load.toFixed(1) + ' g' : '', q].filter(Boolean).join(' · ');
  }
  window.Replay = { T0, MILESTONES, lerp, clamp, smooth, pad2, hms, clock, met, esc, km, nice, lastBefore, load, prepare, t2x, x2t, lastEvent,
                    sampleAt, launchState, moduleState, opsFrame, capsuleState, capsuleAt, capsuleReadout, autoRate };
})();
