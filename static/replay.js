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
  const DAY = 86400;
  const clock = (t) => { if (t >= DAY) { const d = Math.floor(t / DAY); return d + 'd ' + hms(t - d * DAY); } return hms(t < 0 ? Math.ceil(-t) : t); };
  const met = (t) => (t < 0 ? 'T−' : 'T+') + clock(t);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const km = (x) => Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') + ' km' : x.toFixed(1) + ' km';
  const nice = (s) => String(s || '').replace(/_/g, ' ');
  const lastBefore = (arr, t) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; };

  const T0 = -15;                                         // the replay starts at T-15 s
  const MILESTONES = [['LIFTOFF', 'LIFTOFF'], ['MAXQ', 'MAX-Q'], ['MECO', 'MECO'], ['SEP', 'STAGE SEP'], ['BOOSTBACK_START', 'DIVERT BURN'], ['FINS_DEPLOY', 'DRAG FINS'], ['SECO1', 'SECO-1'],
    ['ENTRY_BURN', 'ENTRY BURN'], ['LANDING_BURN', 'LANDING BURN'], ['TOUCHDOWN', 'TOUCHDOWN'], ['SES2', 'SES-2'], ['ORBIT', 'ORBIT']];

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
      tSeco: tOf('SECO', opsStart), tReturn: tOf('RETURN_PREP', Infinity), tEom: tOf('END', tEnd), tIntr: tOf('INTRUSION', Infinity), lz: (M.launch_meta || {}).landing_zone_km || 0 };
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
    // whole-payload return (sentinel/lelp/reentry.py): key times and the window of the true-scale return shot
    const rm = M.reentry_meta || null;
    X.ret = (M.reentry || []).slice().sort((a, b) => a.t - b.t);
    X.tArmPark = rm && rm.t_arm_park ? rm.t_arm_park : Infinity; X.tSep = rm ? rm.t_stage_sep : Infinity; X.tInflate = rm ? rm.t_inflate : Infinity; X.inflateS = rm ? rm.inflate_s : 90;
    X.tEI = rm ? rm.t_entry_interface : Infinity; X.tMain = rm ? rm.t_main : Infinity;
    X.tSplash = rm ? rm.t_splash : Infinity; X.tRecovery = rm ? rm.t_recovery : Infinity; X.tPeak = tOf('PEAK_HEATING', Infinity);
    X.retShot = rm && X.ret.length ? [X.tEI - 20, tEnd + 1] : null;     // to the end: once aboard the ship the lab never goes back to orbit
    X.atk = isFinite(X.tIntr);
    // multi-day mission (lab operations last as long as the experiments, sentinel/lelp/mission.py): day-0 setup, quiet days,
    // the attack and the return each get their own stretch of the track
    const opsEnd = Math.min(X.tReturn, tEnd), tSetup = Math.min(opsStart + 3 * 3600, opsEnd), tRetW = isFinite(X.tReturn) ? X.tReturn - 600 : tEnd;
    X.tSetup = tSetup;
    if (X.atk) { X.tAtk0 = X.tIntr - 30;
      X.tAtk1 = Math.max(...ev.filter((e) => e.t >= X.tIntr && e.t < X.tIntr + 900 && (e.seg === 'ATTACK' || e.code === 'CONTAIN' || e.code === 'KEYS' || e.code === 'LEDGER_TAMPER')).map((e) => e.t)) + 30;
      X.atkCmds = ev.filter((e) => e.data && e.data.final && e.data.route !== 'ground' && e.t >= X.tIntr);
    } else X.atkCmds = [];
    if (X.atk && X.tAtk0 > tSetup && X.tAtk1 < tRetW) {
      const a = X.tAtk0 - tSetup, b = tRetW - X.tAtk1, xa = .35 + (.86 - .06 - .35) * a / (a + b);
      X.kT = [T0, X.tTouch + 20, opsStart, tSetup, X.tAtk0, X.tAtk1, tRetW, tEnd]; X.kX = [0, .22, .27, .35, xa, xa + .06, .86, 1];
    } else if (tRetW > tSetup) { X.kT = [T0, X.tTouch + 20, opsStart, tSetup, tRetW, tEnd]; X.kX = [0, .22, .27, .35, .86, 1]; }
    else { X.kT = [T0, X.tTouch + 20, opsStart, tEnd]; X.kX = [0, .24, .30, 1]; }
    X.bands = [[T0, X.tMeco, 'ASCENT', ''], [X.tMeco, X.tTouch + 20, 'BOOSTER LANDING', 'b-booster'], [X.tTouch + 20, opsStart, 'COAST', ''], [opsStart, tSetup, 'SETUP · THAW', '']];
    if (X.atk) X.bands.push([tSetup, X.tAtk0, 'LAB OPERATIONS', ''], [X.tAtk0, X.tAtk1, 'ATTACK', 'b-sentinel'], [X.tAtk1, opsEnd, 'LAB OPERATIONS', '']);
    else X.bands.push([tSetup, opsEnd, 'LAB OPERATIONS', '']);
    X.days = []; for (let d = 1; d * DAY < opsEnd; d++) X.days.push({ t: d * DAY, label: 'FD' + (d + 1) });   // flight days from launch
    if (isFinite(X.tReturn)) X.bands.push([X.tReturn, X.tEom, 'PAYLOAD RETURN', 'b-return'], [X.tEom, tEnd, '', '']);
    const KEY = new Set(MILESTONES.map((m) => m[0]));
    X.marks = ev.filter((e) => e.t >= T0 && ((KEY.has(e.code) && e.seg !== 'OPS') || e.code === 'SOLAR' || e.code === 'KEYS' || e.seg === 'ATTACK' || e.seg === 'RETURN' || e.seg === 'CUSTOMER'
      || (e.level !== 'info' && e.seg !== 'COMMS' && e.code !== 'EXECUTE' && e.code !== 'SESSION')));
    X.miles = MILESTONES.map(([code, label]) => ({ code, label, t: tOf(code, null) })).filter((m) => m.t != null).sort((a, b) => a.t - b.t);
    // director pacing (speed AUTO): slow windows around the moments worth watching
    X.slow = [];
    for (const e of ev) { if (e.t < opsStart || (X.atk && e.t >= X.tAtk0 && e.t <= X.tAtk1)) continue;
      if (['FAULT', 'ISOLATE', 'SOLAR', 'END'].includes(e.code) || e.seg === 'RETURN' || (e.seg === 'CUSTOMER' && !['IMAGING', 'MEDIA'].includes(e.code))
          || (e.data && e.data.final && e.data.final !== 'EXECUTE')) X.slow.push([e.t - 20, e.t + 40, 15]); }
    if (X.atk) X.slow.push([X.tAtk0 + 15, X.tAtk1 - 10, 5]);
    X.slow.sort((a, b) => a[0] - b[0]);
    // customer experiments (experiments/*.yaml via sentinel/lelp/experiment.py): one row per protocol hour, dose rate every 10 s
    X.exps = {};
    for (const [id, E] of Object.entries(M.experiments || {})) { if (!E.rows || !E.rows.length) continue;
      E.ix = {}; E.cols.forEach((c, i) => { E.ix[c] = i; }); E.rows.forEach((r) => { r.t = r[0]; }); X.exps[id] = E; }
    X.featured = M.featured && X.exps[M.featured] ? M.featured : (Object.keys(X.exps)[0] || null);
    for (const E of Object.values(X.exps)) { const m = E.meta, step = m.imaging.every_h * 3600 / m.protocol_x;  // imaging rounds, for the flash
      E.rounds = []; if (m.t_start != null && m.t_end != null) for (let tr = m.t_start; tr <= (m.t_preserved != null ? m.t_preserved : m.t_end) + 1; tr += step) E.rounds.push({ t: tr }); }
    // pacing changes playback must not skip at high speed: every slow window and director shot starts here
    X.stops = [...X.slow.map((w) => w[0]), X.tArmPark - 5, X.tSep - 10, X.tInflate - 10, X.retShot ? X.retShot[0] : Infinity, tSetup, X.tAtk0 || Infinity]
      .filter((v) => isFinite(v)).sort((a, b) => a - b);
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
    if (!b || !a.joints || !b.joints || a.joints.every((v, j) => Math.abs(v - b.joints[j]) < 0.05)) return { f, view: f, i, states };
    const k = clamp((t - f.t) / (n.t - f.t), 0, 1), dr = ((b.ring_deg - a.ring_deg + 540) % 360) - 180;
    const arm = Object.assign({}, a, { joints: a.joints.map((v, j) => lerp(v, b.joints[j], k)), ring_deg: a.ring_deg + dr * k });
    return { f, i, states, view: { t: f.t, modules: f.modules, comms: f.comms, gate: f.gate, platform: Object.assign({}, f.platform, { arm }) } };
  }
  const RETNUM = ['alt_km', 'speed_ms', 'x_km', 'fpa_deg', 'g_load', 'heat_kw_m2', 'mach'];
  function reentryAt(M, t) {      // Return Module state for the 3-D return shot, or null outside it
    const X = M.x, C = X.ret; if (!X.retShot || t < X.retShot[0] || t >= X.retShot[1]) return null;
    const i = lastBefore(C, t), a = C[Math.max(i, 0)], b = C[i + 1], rm = M.reentry_meta, o = {};
    if (!b || t >= X.tSplash) Object.assign(o, C[C.length - 1]);
    else { const k = clamp((t - a.t) / (b.t - a.t), 0, 1); for (const f of RETNUM) o[f] = lerp(a[f], b[f], k); }
    o.phase = t < X.tEI ? 'coast' : t < X.tMain ? 'entry' : t < X.tSplash ? 'main' : 'floating';
    return Object.assign(o, { t, tMain: X.tMain, tSplash: X.tSplash, tRecovery: X.tRecovery,
      splashKm: rm.splash_downrange_km, shipKm: rm.ship_offset_km, shipMs: rm.ship_speed_ms });
  }
  function returnState(M, t) {    // for the orbital scene: stage separated, heat shield inflation 0..1
    const X = M.x;
    return { armParked: t >= X.tArmPark, sep: t >= X.tSep, sepAge: Math.max(0, t - X.tSep), inflate: t < X.tInflate ? 0 : clamp((t - X.tInflate) / X.inflateS, 0.001, 1) };
  }
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
      if (t < X.tMain - 8) return Math.abs(t - X.tPeak) < 40 ? 8 : 15;
      if (t < X.tSplash - 20) return 20;
      if (t < X.tSplash + 15) return 8;
      return 120;
    }
    if (t < X.tSetup) return 300;                                                     // day 0: commissioning, module activation, thaws
    if (t >= X.tArmPark - 5 && t < X.tArmPark + 50) return 8;                        // Dexter-L parks itself on the upper stage
    if (t >= X.tSep - 10 && t < X.tSep + 60) return 10;                              // the lab leaves the upper stage
    if (t >= X.tInflate - 10 && t < X.tInflate + X.inflateS + 15) return 10;         // the heat shield inflates
    for (const [a, b, v] of X.slow) if (t >= a && t <= b) return v;
    const F = M.frames, i = lastBefore(F, t);
    return i >= 0 && F[i].platform.arm.busy ? 40 : 3600;                            // quiet days: an hour a second
  }
  function advance(M, t, step) {    // move playback forward without jumping over the start of a slow window or a director shot
    const S = M.x.stops; let lo = 0, hi = S.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (S[m] <= t + 1e-6) lo = m + 1; else hi = m; }
    return lo < S.length && S[lo] < t + step ? S[lo] : t + step;
  }
  function expStates(M, t) {        // what each experiment module is doing now, for the 3-D view
    const out = [];
    for (const [id, E] of Object.entries(M.x.exps)) { const m = E.meta, x = expAt(M, t, id); if (!x) continue;
      let glow = null;
      if (m.t_start != null && t >= m.t_start - 5 && t < m.t_thaw + 60) glow = 'thaw';
      for (const st of m.t_steps || []) if (st.t != null && t >= st.t - 5 && t < st.t + 50) glow = st.do.includes('preserve') ? 'preserve' : st.do.includes('treat') ? 'treat' : 'media';
      const i = lastBefore(E.rounds, t);
      out.push({ id, module: m.module, phase: x.phase, glow, lastRound: i >= 0 ? E.rounds[i].t : null, rate: x.rate, saa: x.rate != null && x.rate > 80, day: x.day, dose: x.dose });
    }
    return out;
  }
  function expAt(M, t, id) {      // one customer's protocol state at t: rows interpolated, phase from the key times
    const E = M.x.exps[id || M.x.featured]; if (!E) return null;
    const rows = E.rows, i = lastBefore(rows, t); if (i < 0) return null;
    const a = rows[i], b = rows[i + 1] || a, k = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0, ix = E.ix, m = E.meta;
    const v = (c) => lerp(a[ix[c]], b[ix[c]], k);
    const pres = m.t_preserved != null && t >= m.t_preserved;
    const first = m.t_steps && m.t_steps.length ? m.t_steps[0].t : Infinity;     // recovery lasts until the first scheduled step
    const phase = m.t_start == null || t < m.t_start ? 'cryo' : t < m.t_thaw ? 'thawing' : pres ? 'preserved' : t < first ? 'recovery' : 'culture';
    const o = { t, phase, day: v('day'), block_c: v('block_c'), cryo_c: v('cryo_c'), dose: v('dose_mgy'), passes: a[ix.saa_passes], rounds: a[ix.rounds],
                down_mb: a[ix.down_mb], health: v('health'), rate: null, g: {},
                split: null };
    if (ix.dose_frozen != null) {   // dose by phase, consistent with the interpolated total: frozen, in culture, preserved
      const z = rows[rows.length - 1], F = z[ix.dose_frozen], C = z[ix.dose_culture], tot = o.dose;
      o.split = m.t_thaw == null || t < m.t_thaw ? [tot, 0, 0] : !pres ? [F, Math.max(0, tot - F), 0] : [F, C, Math.max(0, tot - F - C)]; }
    const rr = E.rate, j = rr && rr.t0 != null ? Math.floor((t - rr.t0) / rr.dt) : -1;
    if (j >= 0 && j < rr.v.length) o.rate = rr.v[j];             // the dosimeter logs from lab power-on to entry
    for (const g of m.groups) { o.g[g.id] = {}; for (const e of m.envs) { const q = o.g[g.id][e] = {}; for (const mt of m.family.metrics) q[mt.key] = v(g.id + '|' + e + '|' + mt.key); } }
    return o;
  }
  const RET_PHASE = { coast: 'COASTING TO ENTRY', entry: 'ENTRY', main: 'MAIN CANOPY', floating: 'AFLOAT' };
  function reentryReadout(c) {      // one line of live Return Module numbers for the 3-D view
    if (c.t >= c.tRecovery) return 'LELP-1 ABOARD THE RECOVERY SHIP · all 32 modules';
    if (c.phase === 'floating') return `LELP-1 AFLOAT ON ITS AEROSHELL · recovery ship ${Math.max(0, c.shipKm - (c.t - c.tSplash) * c.shipMs / 1000).toFixed(1)} km away`;
    const alt = c.alt_km >= 10 ? c.alt_km.toFixed(1) : c.alt_km.toFixed(2), v = c.speed_ms >= 1000 ? (c.speed_ms / 1000).toFixed(2) + ' km/s' : Math.round(c.speed_ms) + ' m/s';
    const q = c.heat_kw_m2 >= 1000 ? (c.heat_kw_m2 / 1000).toFixed(2) + ' MW/m²' : c.heat_kw_m2 >= 1 ? Math.round(c.heat_kw_m2) + ' kW/m²' : '';
    return ['LELP-1 · ' + RET_PHASE[c.phase], alt + ' km', v, c.g_load >= 0.05 ? c.g_load.toFixed(1) + ' g' : '', q].filter(Boolean).join(' · ');
  }
  window.Replay = { T0, MILESTONES, lerp, clamp, smooth, pad2, hms, clock, met, esc, km, nice, lastBefore, load, prepare, t2x, x2t, lastEvent,
                    sampleAt, launchState, moduleState, opsFrame, returnState, reentryAt, reentryReadout, autoRate, expAt, advance, expStates, DAY };
})();
