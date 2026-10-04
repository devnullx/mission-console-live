/* LELP-1 mission simulation page (lab/simulate.html): plays the mission configured in configure.html (same URL hash) end
   to end: late load, the RUPAK launch, orbit and checkout, the customer's protocol day by day, the return under the
   inflatable heat shield, recovery, handover and the lab. The engine is lab/sim.js; this file draws it: ground-track map,
   launch and entry charts, protocol strip, temperature / dose / data charts, the CAD (cad.js) with the part each step
   works, the Sentinel command log and the mission report. Presentation mode plays the whole mission in about two minutes. */
(async function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400, pad = (x) => String(Math.floor(x)).padStart(2, '0');
  const f0 = (x) => Math.round(x).toLocaleString('en-GB'), f1 = (x) => Number(x).toFixed(1), f2 = (x) => Number(x).toFixed(2);
  const clock = (a) => `${pad(a / 3600)}:${pad(a % 3600 / 60)}:${pad(a % 60)}`;
  const met = (s) => { const a = Math.abs(s), d = Math.floor(a / DAY); return (s < 0 ? 'L−' : 'T+') + (d ? `${d}d ` : '') + clock(a - d * DAY); };
  const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  const x = (lon) => lon + 180, y = (lat) => 90 - lat;

  let D, SD;
  try { [D, SD] = await Promise.all(['data.json', 'sim.json'].map((u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(u); return r.json(); }))); }
  catch (err) { $('#sim-sub').textContent = 'Could not load the simulation data. Reload the page.'; return; }

  // ---------- the configuration: the configurator's URL hash ----------
  const byId = Object.fromEntries(D.experiments.map((q) => [q.id, q]));
  const H = new URLSearchParams(location.hash.slice(1));
  const eid = byId[H.get('e')] ? H.get('e') : 'stem-cell-organoids', e = byId[eid];
  const mode = H.get('m') === 'own' ? 'own' : 'bay', AR = D.arch[eid] || {};
  const canA = AR.arch === 'A' || (AR.options || []).includes('A');
  let arch = ['A', 'B', 'C'].includes(H.get('a')) ? H.get('a') : (AR.arch || 'C');
  if (arch === 'A' && !canA) arch = AR.arch || 'C';
  const days = Math.min(mode === 'bay' ? D.max_days : 30, Math.max(1, +H.get('d') || e.protocol.duration_days));
  const temp = H.get('t') != null && H.get('t') !== '' && isFinite(+H.get('t')) ? +H.get('t') : e.protocol.temp_c;
  const launch = /^\d{4}-\d{2}-\d{2}$/.test(H.get('l') || '') ? H.get('l') : '2026-12-01';
  const furnace = mode === 'own' && (H.get('f') === '1' || (e.services || {}).hot === 'new');
  const cfg = { mode, exp: e, days, temp, arch, launch, furnace };
  let SIM;
  try { SIM = LelpSim.build(D, SD, cfg); } catch (err) { $('#sim-sub').textContent = 'The simulation could not be built for this configuration: ' + err.message; return; }
  const M = SIM.M, own = mode === 'own', cube = SIM.cube, T = D.twin;
  const satName = own ? 'SP-' + D.codes[eid] + (arch === 'A' ? '-6U' : '') : 'LELP-1';
  const hash = location.hash.replace(/^#/, '');
  $('#sim-back').href = 'configure.html#' + hash.replace(/(^|&)s=\d/, '$1s=4');

  // ---------- header and readiness review ----------
  $('#sim-h1').textContent = e.title;
  $('#sim-sub').innerHTML = `${own ? `Your own satellite <b>${esc(satName)}</b> (${arch === 'A' ? 'in-flight only' : arch === 'B' ? 'samples return' : 'live return'})` : `LELP-1, large bay 19`}
    · ${days} days at ${temp} °C · launch ${esc(launch)} ${utc(M.t0).slice(11, 16)} UTC on RUPAK · <a href="${esc(eid)}.html">experiment page</a>`;
  document.title = `${e.title} · mission simulation · LELP-1`;
  $('#sim-ready').innerHTML = `<div class="card"><div class="sim-go"><span class="chip ${SIM.go ? 'good' : 'bad'}">${SIM.go ? 'GO' : 'NO-GO'}</span>
    <b>Mission readiness review</b><span class="small">launch window ${utc(M.t0)}: the pad passes under the dawn-dusk plane</span></div>
    <ul class="sim-checks">${SIM.ready.map((r) => `<li class="${r.ok ? 'ok' : 'no'}"><b>${r.ok ? '✓' : '✗'} ${esc(r.check)}</b> ${esc(r.detail)}</li>`).join('')}</ul>
    ${SIM.go ? '' : `<p>This configuration cannot fly as set. <a href="${esc($('#sim-back').href)}">Change it in the configurator</a> (an experiment that needs the furnace flies on its own satellite).</p>`}</div>`;

  // ---------- the phase bar (presentation time) ----------
  const L = SIM.playLen;
  $('#sim-phases').innerHTML = SIM.phases.map((p) => { const a = SIM.toPlay(p.s0) / L * 100, b = SIM.toPlay(p.s1) / L * 100;
    return `<div class="ph ph-${p.id}" style="left:${a.toFixed(2)}%;width:${(b - a).toFixed(2)}%" data-s="${p.s0}"><span>${esc(p.name)}</span></div>`; }).join('')
    + SIM.events.filter((v) => v.big).map((v) => `<i style="left:${(SIM.toPlay(v.s) / L * 100).toFixed(2)}%" title="${esc(v.title)}"></i>`).join('');

  // ---------- views ----------
  const st0 = SD.stations.filter((q) => q.kind === 'ground');
  const fp = LelpPlan.Orbit.footprint(D.orbit.alt_km, 5);
  const grat = [];
  for (let lo = -150; lo <= 150; lo += 30) grat.push(`M${x(lo)},0V180`);
  for (let la = -60; la <= 60; la += 30) grat.push(`M0,${y(la)}H360`);
  const saaR = Math.sqrt(Math.log(SD.dose.saa_peak / SD.dose.saa_flag));
  const R = SD.recovery, lm = SD.launch_meta;
  const mapSvg = `<svg class="sim-map" viewBox="0 0 360 180" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Ground track map">
    <rect width="360" height="180" class="ocean"/><path class="grat" d="${grat.join('')}"/><path class="land" d="${SD.land}"/><path class="night" id="m-night"/>
    <ellipse class="saa" cx="${x(SD.dose.saa_lon)}" cy="${y(SD.dose.saa_lat)}" rx="${(SD.dose.saa_dlon * saaR).toFixed(1)}" ry="${(SD.dose.saa_dlat * saaR).toFixed(1)}"/>
    <text class="lbl saa-l" x="${x(SD.dose.saa_lon)}" y="${y(SD.dose.saa_lat) + 2}">SAA</text>
    ${st0.map((q) => `<ellipse class="fp" id="fp-${q.id}" cx="${x(q.lon)}" cy="${y(q.lat)}" rx="${(fp / Math.cos(q.lat * Math.PI / 180)).toFixed(1)}" ry="${fp.toFixed(1)}"/>
      <circle class="gs" cx="${x(q.lon)}" cy="${y(q.lat)}" r="1.3"/><text class="lbl" x="${x(q.lon) + 2}" y="${y(q.lat) + (q.id === 'LEUK' ? 4.5 : -2)}">${esc(q.name.split(' ')[0])}</text>`).join('')}
    ${cube ? '' : `<rect class="rz" x="${x(R.lon[0])}" y="${y(R.lat[1])}" width="${R.lon[1] - R.lon[0]}" height="${R.lat[1] - R.lat[0]}"/><text class="lbl" x="${x(R.lon[0])}" y="${y(R.lat[0]) + 6}">recovery zone</text>`}
    <path class="site" d="M${x(lm.site_lon)},${y(lm.site_lat) - 2.4}l2,3.6h-4z"/><text class="lbl" x="${x(lm.site_lon) + 2.5}" y="${y(lm.site_lat) + 1}">RUPAK</text>
    <path class="trk past" id="m-past"/><path class="trk next" id="m-next"/><path class="trk asc" id="m-asc"/><path class="trk ret" id="m-ret"/>
    <g id="m-splash" visibility="hidden"><circle class="splash" r="2.2"/></g>
    <circle class="halo" id="m-halo" r="5"/><circle class="sat" id="m-sat" r="1.9"/>
  </svg><div class="sim-hud" id="m-hud"></div>`;
  // the ascent: altitude against downrange for the first 520 s (booster back on the barge), from the launch twin
  const A = SIM.stack.concat(SIM.upper).filter((r) => r[0] <= 520), Bo = SIM.booster;
  const ax = { x1: Math.max(...A.map((r) => r[2]), ...Bo.map((r) => r[2])) * 1.05, y1: Math.max(...A.map((r) => r[1]), ...Bo.map((r) => r[1])) * 1.12 };
  const ascX = (km) => 60 + km / ax.x1 * 900, ascY = (km) => 380 - km / ax.y1 * 340;
  const poly = (rows, fx, fy) => rows.map((r, i) => `${i ? 'L' : 'M'}${fx(r).toFixed(1)},${fy(r).toFixed(1)}`).join('');
  const tick = (v, a, b) => v.map((q) => `<g><line x1="${a(q)[0]}" y1="${a(q)[1]}" x2="${b(q)[0]}" y2="${b(q)[1]}" class="ax"/></g>`).join('');
  const niceStep = (span, n) => { const r = span / n, p = 10 ** Math.floor(Math.log10(r)); return [1, 2, 5, 10].map((k) => k * p).find((k) => k >= r); };
  const xs = []; for (let v = 0; v <= ax.x1; v += niceStep(ax.x1, 6)) xs.push(v);
  const ys = []; for (let v = 0; v <= ax.y1; v += niceStep(ax.y1, 5)) ys.push(v);
  const LAB = { MAXQ: ['MAX-Q', 8, 4], MECO: ['MECO · SEPARATION', 10, 16], BOOSTBACK_END: ['DIVERT BURN', 10, -2], FINS_DEPLOY: ['DRAG FINS', 10, -4],
    ENTRY_BURN: ['ENTRY BURN', 10, 0], TOUCHDOWN: ['BARGE LANDING', 10, -8], SECO1: ['SECO-1', -14, -12] };
  const levs = SD.launch_events.filter((v) => v[0] > 0 && v[0] <= 520 && LAB[v[2]]);
  const at = (rows, t) => LelpSim.rowAt(rows, t);
  const ascSvg = `<svg class="sim-chart" viewBox="0 0 1000 420" role="img" aria-label="Launch trajectory">
    ${tick(xs, (v) => [ascX(v), 40], (v) => [ascX(v), 380])}${tick(ys, (v) => [60, ascY(v)], (v) => [960, ascY(v)])}
    ${xs.map((v) => `<text class="tk" x="${ascX(v)}" y="400">${f0(v)}</text>`).join('')}${ys.map((v) => `<text class="tk" x="52" y="${ascY(v) + 4}" text-anchor="end">${f0(v)}</text>`).join('')}
    <text class="axl" x="510" y="418">downrange, km</text><text class="axl" x="14" y="30">altitude, km</text>
    <path class="p-stack" d="${poly(SIM.stack, (r) => ascX(r[2]), (r) => ascY(r[1]))}"/><path class="p-upper" d="${poly(SIM.upper.filter((r) => r[0] <= 520), (r) => ascX(r[2]), (r) => ascY(r[1]))}"/>
    <path class="p-boost" d="${poly(Bo, (r) => ascX(r[2]), (r) => ascY(r[1]))}"/>
    ${levs.map(([t, seg, code]) => { const r = at(seg === 'BOOSTER' ? Bo : t <= SIM.stack[SIM.stack.length - 1][0] ? SIM.stack : SIM.upper, t);
      const [name, dx, dy] = LAB[code];
      return `<g class="ev"><circle cx="${ascX(r[2]).toFixed(1)}" cy="${ascY(r[1]).toFixed(1)}" r="4"/><text x="${(ascX(r[2]) + dx).toFixed(1)}" y="${(ascY(r[1]) + dy).toFixed(1)}"${dx < 0 ? ' text-anchor="end"' : ''}>${name}</text></g>`; }).join('')}
    <text class="note" x="950" y="60" text-anchor="end">upper stage: coast to apogee, circularise at T+${Math.round(T.t_orbit_s / 60)} min, ${f0(lm.insertion_km)} km downrange</text>
    <circle class="m-up" id="a-up" r="7"/><circle class="m-bo" id="a-bo" r="6"/>
  </svg><div class="sim-hud" id="a-hud"></div>`;
  // the return: altitude, heat flux and deceleration through entry, from the twin's return model
  const RR = SD.ret, eiRel = M.entry - M.deorbit, r0 = Math.max(0, eiRel - 150), r1 = RR[RR.length - 1][0];
  const RW = RR.filter((r) => r[0] >= r0 && r[0] <= r1), hq = Math.max(...RW.map((r) => r[5])), gq = Math.max(...RW.map((r) => r[4]));
  const enX = (t) => 60 + (t - r0) / (r1 - r0) * 880, enY = (km) => 380 - Math.min(km, 140) / 140 * 340;
  const enH = (q) => 380 - q / hq * 300, enG = (g) => 380 - g / (gq * 1.1) * 300;
  const rets = SD.ret_events.filter((v) => v[0] >= r0);
  const entSvg = `<svg class="sim-chart" viewBox="0 0 1000 420" role="img" aria-label="Return trajectory">
    ${tick([0, 20, 40, 60, 80, 100, 120], (v) => [60, enY(v)], (v) => [940, enY(v)])}${[0, 20, 40, 60, 80, 100, 120].map((v) => `<text class="tk" x="52" y="${enY(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <text class="axl" x="14" y="30">altitude, km</text><text class="axl" x="500" y="418">minutes after the deorbit burn</text>
    ${[...Array(Math.floor((r1 - r0) / 300) + 1).keys()].map((k) => { const t = Math.ceil(r0 / 300) * 300 + k * 300; return t > r1 ? '' : `<text class="tk" x="${enX(t)}" y="400" text-anchor="middle">${Math.round(t / 60)}</text>`; }).join('')}
    <path class="p-heat" d="${poly(RW, (r) => enX(r[0]), (r) => enH(r[5]))}L${enX(RW[RW.length - 1][0])},380L${enX(RW[0][0])},380Z"/>
    <path class="p-g" d="${poly(RW, (r) => enX(r[0]), (r) => enG(r[4]))}"/><path class="p-alt" d="${poly(RW, (r) => enX(r[0]), (r) => enY(r[1]))}"/>
    <text class="leg heat" x="950" y="60" text-anchor="end">heat flux, peak ${f0(SD.ret_meta.peak_heat_kw_m2)} kW/m²</text><text class="leg g" x="950" y="80" text-anchor="end">deceleration, peak ${f1(SD.ret_meta.peak_g)} g</text>
    ${rets.filter(([t]) => t <= r1).map(([t, code]) => { const end = enX(t) > 840; return `<g class="ev"><line x1="${enX(t)}" y1="40" x2="${enX(t)}" y2="380"/><text x="${enX(t) + (end ? -4 : 4)}" y="${end ? 140 : 52}"${end ? ' text-anchor="end"' : ''}>${esc(code.replace(/_/g, ' '))}</text></g>`; }).join('')}
    <line class="cur" id="e-cur" y1="40" y2="380"/><circle class="m-up" id="e-pt" r="7"/>
  </svg><div class="sim-hud" id="e-hud"></div>`;
  const handSvg = () => {
    const rows = cube ? [] : [[M.splash, 'Splashdown', M.splashPt ? `${f1(Math.abs(M.splashPt.lat))}° ${M.splashPt.lat < 0 ? 'S' : 'N'}, ${f1(M.splashPt.lon)}° E, ${R.name}` : ''],
      [M.splash + (own ? 0 : (SD.ret_events.find((v) => v[1] === 'RECOVERY') || [0])[0] - (SD.ret_events.find((v) => v[1] === 'SPLASHDOWN') || [0])[0]), own ? 'Capsule recovered' : 'Lab craned aboard', own ? 'the ship homes on the capsule beacon' : 'all modules on the recovery ship'],
      [M.hand, 'Handover', `your courier takes the ${own ? 'samples' : 'module'} with the signed custody ledger, at ${e.sample_return.temp_c} °C`],
      [M.lab, 'In your lab', `latest arrival for this protocol: ${e.sample_return.max_hours} h after splashdown`]];
    return `<div class="sim-hand"><ol>${rows.map(([s, a, b]) => `<li data-s="${s}"><span class="mono">${met(s)}</span><b>${esc(a)}</b><p>${esc(b)}</p></li>`).join('')}</ol>
      <div class="post"><h4>Your post-flight analysis</h4><ul>${e.post_flight.map((q) => `<li><b>${esc(q.name)}</b> ${esc(q.method)}</li>`).join('')}</ul></div></div>`;
  };
  // ---------- 3-D: the console's launch and return shots (web/static/scene.js through replay.js) on this mission's clock ----------
  // The launch is the twin's RUPAK flight as the console plays it; on LELP-1 the return is the twin's Return Module, moved to
  // this mission's deorbit time. A dedicated satellite's capsule is not the Return Module, so its return stays a chart.
  let Mx = null, scene3d = null, ready3d = false;
  const W3 = $('#sim-3dw'), C3 = $('#sim-3dc');
  const loadScript = (src) => new Promise((ok, no) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = no; document.head.appendChild(el); });
  window.SCENE_BASE = '../';
  const ret3d = !own && !cube;
  (async () => {
    try {
      if (!window.THREE) throw new Error('three.js');
      await loadScript(`../static/replay.js?v=${encodeURIComponent(D.build)}`);
      await loadScript(`../static/scene.js?v=${encodeURIComponent(D.build)}`);
      const Wt = SD.twin, row = (cols, r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]));
      const shift = ret3d ? M.deorbit - Wt.reentry_meta.t_deorbit : null;
      const events = Wt.events.filter((q) => q[1] !== 'RETURN' || (shift != null && q[2] !== 'RETURN_PREP'))
        .map(([t, seg, code, text, level]) => ({ t: seg === 'RETURN' ? t + shift : t, seg, code, text, level, data: {} }));
      const reentry = shift == null ? [] : Wt.reentry.map((r) => { const o = row(Wt.reentry_cols, r); o.t += shift; return o; });
      const rm = shift == null ? null : Object.fromEntries(Object.entries(Wt.reentry_meta).map(([k, v]) => [k, /^t_/.test(k) && typeof v === 'number' ? v + shift : v]));
      Mx = Replay.prepare({ events, launch: Wt.launch.map((r) => row(Wt.launch_cols, r)), frames: [], reentry, reentry_meta: rm, experiments: {}, launch_meta: Wt.launch_meta, featured: null });
      ready3d = true; force = true; shown = '';
    } catch (err) { $('#d-note').textContent = '3-D view unavailable: ' + err.message; }
  })();
  const inLaunch3d = (s) => s >= -60 && s < T.t_orbit_s + 30;
  const inReturn3d = (s) => ret3d && Mx && Mx.x.retShot && s >= Mx.x.retShot[0] && s < Mx.x.retShot[1];
  function draw3d(st, dt) {
    if (!Mx) return;
    if (!scene3d) {
      try { scene3d = new Scene3D(C3); scene3d.setLandingZone(Mx.x.lz); } catch (err) { $('#d-note').textContent = '3-D view needs WebGL.'; ready3d = false; return; }
    }
    if (C3.clientWidth && (C3.width !== Math.round(C3.clientWidth * Math.min(devicePixelRatio, 2)))) scene3d._resize();
    const s = st.s;
    if (!inLaunch3d(s) && inReturn3d(s)) {
      const cap = Replay.reentryAt(Mx, s);
      scene3d.setPhase('return'); scene3d.updateReturn(cap, dt);
      $('#d-hud').innerHTML = `<span>${esc(Replay.reentryReadout(cap))}</span>`;
      $('#d-note').textContent = 'LELP-1 Return Module from the twin\'s return model: heat shield, plasma, main canopy, splashdown, recovery ship (drawn 40x, positions true scale)';
      return;
    }
    const t = Math.max(Replay.T0, Math.min(s, T.t_orbit_s + 30));
    const L = Replay.launchState(Mx, t);
    scene3d.setPhase('launch');
    scene3d.updateLaunch(t > Mx.x.tTouch + 20 ? { upper: L.upper, sepAtt: L.sepAtt, sepAge: L.sepAge } : L, !!L.upper, dt);
    const b = L.booster, u = L.upper || L.stack;
    $('#d-hud').innerHTML = `<span><b>${f1(u.alt_km)}</b> km</span><span><b>${u.speed_ms >= 1000 ? f2(u.speed_ms / 1000) + '</b> km/s' : f0(u.speed_ms) + '</b> m/s'}</span>`
      + `<span><b>${f1(u.g_load || 0)}</b> g</span>${u.q_kpa ? `<span><b>${f1(u.q_kpa)}</b> kPa</span>` : ''}`
      + (b && t < Mx.x.tTouch + 20 ? `<span class="bo">booster ${b.phase === 'landed' ? 'on the barge' : `<b>${f1(b.alt_km)}</b> km, <b>${f0(b.speed_ms)}</b> m/s`}</span>` : '');
    $('#d-note').textContent = own ? 'RUPAK from the launch twin, team CAD (drawn 40x, positions true scale); your satellite rides on the upper stage'
      : 'RUPAK from the launch twin with the team CAD: booster back to the barge on its legs, drag fins open at 100 km (drawn 40x, positions true scale)';
  }

  let view = 'auto', shown = '';
  const VIEW = $('#sim-view');
  function setView(v) {
    if (v === shown) return;
    shown = v;
    const is3d = v === '3d';
    W3.hidden = !is3d; VIEW.hidden = is3d;
    if (is3d) { $('#sim-viewnote').textContent = 'The console\'s 3-D shot on this mission\'s clock'; trackKey = ''; return; }
    VIEW.innerHTML = v === 'ascent' ? ascSvg : v === 'entry' ? entSvg : v === 'hand' ? handSvg() : mapSvg;
    $('#sim-viewnote').textContent = v === 'ascent' ? 'RUPAK launch twin: stack, upper stage and the booster flying back to the barge'
      : v === 'entry' ? `Return model of the twin${own ? ' (your capsule copies LELP-1’s profile: same orbit and ballistic coefficient)' : ''}`
      : v === 'hand' ? 'Recovery, custody and your lab' : 'Ground track, night side, South Atlantic Anomaly and ground-station coverage';
    trackKey = '';
  }
  $$('#sim-tabs button').forEach((b) => { b.onclick = () => { view = b.dataset.v; $$('#sim-tabs button').forEach((q) => q.classList.toggle('on', q === b)); force = true; }; });
  const autoView = (s) => (inLaunch3d(s) ? (ready3d ? '3d' : s < 520 ? 'ascent' : 'map')
    : inReturn3d(s) && ready3d ? '3d' : !cube && s >= M.entry - 150 && s < M.splash ? 'entry' : !cube && s >= M.splash ? 'hand' : 'map');

  // ground-track pieces split where they cross the map edge
  const path = (pts) => { let d = '', px = null; for (const [lo, la] of pts) { const X = x(lo), Y = y(la); d += (px == null || Math.abs(X - px) > 180 ? 'M' : 'L') + X.toFixed(1) + ',' + Y.toFixed(1); px = X; } return d; };
  const ascPts = []; for (let t = 0; t <= T.t_orbit_s; t += 15) { const p = SIM.pos(t); ascPts.push([t, p.lon, p.lat]); }
  const retPts = []; if (!cube) for (let t = M.deorbit; t <= M.splash; t += 20) { const p = SIM.pos(t); retPts.push([t, p.lon, p.lat]); }
  const G = SIM.G;
  let trackKey = '';
  function night(ms) {
    const ss = LelpPlan.Orbit.subsolar(ms), dec = Math.sign(ss.lat || 1) * Math.max(Math.abs(ss.lat), 0.05) * Math.PI / 180;
    let d = '';
    for (let lo = -180; lo <= 180; lo += 3) { const la = Math.atan(-Math.cos((lo - ss.lon) * Math.PI / 180) / Math.tan(dec)) * 180 / Math.PI; d += (d ? 'L' : 'M') + x(lo).toFixed(1) + ',' + y(la).toFixed(1); }
    const edge = dec > 0 ? 180 : 0;
    return d + `L360,${edge}L0,${edge}Z`;
  }
  function drawMap(st) {
    const s = st.s, p = st.p;
    $('#m-sat').setAttribute('cx', x(p.lon)); $('#m-sat').setAttribute('cy', y(p.lat)); $('#m-halo').setAttribute('cx', x(p.lon)); $('#m-halo').setAttribute('cy', y(p.lat));
    $('#m-halo').setAttribute('class', 'halo' + (st.contact.length ? ' on' : '') + (st.inSaa ? ' saa' : ''));
    $('#m-night').setAttribute('d', night(st.utc));
    st0.forEach((q) => { const el = $('#fp-' + q.id); if (el) el.setAttribute('class', 'fp' + (st.contact.includes(q.name) ? ' on' : '')); });
    const key = Math.floor(s / 60);
    if (key !== trackKey) {
      trackKey = key;
      const inOrb = s >= T.t_orbit_s && s < SIM.sEnd, k = Math.round((s - G.s0) / 60);
      const per = Math.round(D.orbit.period_min);
      const seg = (a, b) => { const out = []; for (let i = Math.max(0, a); i <= Math.min(G.lat.length - 1, b); i++) out.push([G.lon[i], G.lat[i]]); return out; };
      $('#m-past').setAttribute('d', inOrb ? path(seg(k - per, k)) : '');
      $('#m-next').setAttribute('d', inOrb ? path(seg(k, k + per)) : '');
      $('#m-asc').setAttribute('d', s >= 0 && s < T.t_orbit_s + 3600 ? path(ascPts.filter((q) => q[0] <= s).map((q) => [q[1], q[2]])) : '');
      $('#m-ret').setAttribute('d', !cube && s >= M.deorbit ? path(retPts.filter((q) => q[0] <= s).map((q) => [q[1], q[2]])) : '');
      const sp = $('#m-splash');
      if (!cube && M.splashPt && s >= M.deorbit) { sp.setAttribute('visibility', 'visible'); sp.firstElementChild.setAttribute('cx', x(M.splashPt.lon)); sp.firstElementChild.setAttribute('cy', y(M.splashPt.lat)); }
      else sp.setAttribute('visibility', 'hidden');
    }
    $('#m-hud').innerHTML = hud(st);
  }
  function hud(st) {
    const p = st.p;
    return `<span><b>${p.alt >= 1 ? f0(p.alt) : f2(p.alt)}</b> km</span><span><b>${p.speed >= 1000 ? f2(p.speed / 1000) + '</b> km/s' : f0(p.speed) + '</b> m/s'}</span>`
      + `<span><b>${f1(p.g)}</b> g</span>${p.q ? `<span><b>${f1(p.q)}</b> kPa</span>` : ''}${p.heat > 1 ? `<span><b>${f0(p.heat)}</b> kW/m²</span>` : ''}`
      + `<span>${f1(Math.abs(p.lat))}°${p.lat < 0 ? 'S' : 'N'} ${f1(Math.abs(p.lon))}°${p.lon < 0 ? 'W' : 'E'}</span>`;
  }
  function drawAscent(st) {
    const s = st.s, u = at(s <= SIM.stack[SIM.stack.length - 1][0] ? SIM.stack : SIM.upper, Math.max(0, Math.min(520, s))), b = at(Bo, s);
    $('#a-up').setAttribute('cx', ascX(u[2])); $('#a-up').setAttribute('cy', ascY(u[1]));
    const bo = $('#a-bo'); bo.setAttribute('visibility', s > SIM.stack[SIM.stack.length - 1][0] ? 'visible' : 'hidden');
    bo.setAttribute('cx', ascX(b[2])); bo.setAttribute('cy', ascY(b[1]));
    $('#a-hud').innerHTML = hud(st) + (s > SIM.stack[SIM.stack.length - 1][0] && s < 500 ? `<span class="bo">booster <b>${f1(b[1])}</b> km, <b>${f0(b[3])}</b> m/s</span>` : '');
  }
  function drawEntry(st) {
    const t = Math.max(r0, Math.min(r1, st.s - M.deorbit)), r = at(RR, t);
    $('#e-cur').setAttribute('x1', enX(t)); $('#e-cur').setAttribute('x2', enX(t));
    $('#e-pt').setAttribute('cx', enX(t)); $('#e-pt').setAttribute('cy', enY(r[1]));
    $('#e-hud').innerHTML = hud(st) + (r[6] ? `<span>Mach <b>${f1(r[6])}</b></span>` : '');
  }

  // ---------- protocol strip ----------
  const steps = SIM.events.filter((v) => v.kind === 'proto' && v.s >= SIM.sStart - 120);
  const pX = (s) => (s - SIM.sStart) / (M.end - SIM.sStart) * 100;
  const ROLE = { sample__: ['Samples', 'r-sample'], fluid__: ['Fluidics', 'r-fluid'], imaging__: ['Imaging', 'r-imaging'], thermal__: ['Temperature', 'r-thermal'] };
  $('#sim-proto').innerHTML = `<div class="sim-proto-h"><h3>Your protocol: ${days} days at ${temp} °C</h3><span class="small" id="p-now"></span></div>
    <div class="sim-ruler">${[...Array(Math.ceil(days) + 1).keys()].map((d) => `<i style="left:${pX(SIM.sStart + d * DAY)}%"><span>day ${d}</span></i>`).join('')}
      ${steps.map((v, k) => `<b class="${(ROLE[v.role] || ROLE.sample__)[1]}" style="left:${Math.max(0, Math.min(100, pX(v.s))).toFixed(2)}%" title="${esc(v.title + ': ' + v.text)}" data-k="${k}"></b>`).join('')}
      <em id="p-cur"></em></div>
    <ol class="sim-steps" id="p-steps">${steps.map((v, k) => `<li data-k="${k}"><span class="chip ${(ROLE[v.role] || ROLE.sample__)[1]}">${(ROLE[v.role] || ROLE.sample__)[0]}</span><b>${esc(v.title)}</b> ${esc(v.text)}</li>`).join('')}</ol>`;
  let stepK = -2;

  // ---------- charts: sample temperature, dose, data ----------
  const B = SIM.B, cW = 300, cH = 110, tA = SIM.tStart, tB = SIM.tEnd;
  const cx = (s) => 30 + (s - tA) / (tB - tA) * (cW - 36);
  function chart(id, title, series, unit) {
    const all = series.flatMap((q) => q.v), lo = Math.min(0, ...all), hi = Math.max(...all) * 1.08 || 1;
    const cy = (v) => cH - 16 - (v - lo) / (hi - lo) * (cH - 30);
    const ticks = [lo, (lo + hi) / 2, hi].map((v) => `<text class="tk" x="27" y="${cy(v) + 3}" text-anchor="end">${Math.abs(hi) >= 100 ? f0(v) : f1(v)}</text>`).join('');
    const lines = series.map((q) => `<path class="${q.cls}" d="${q.t.map((s, i) => `${i ? 'L' : 'M'}${cx(s).toFixed(1)},${cy(q.v[i]).toFixed(1)}`).join('')}"/>`).join('');
    const band = `<rect class="band" x="${cx(SIM.sStart)}" y="8" width="${Math.max(0, cx(M.end) - cx(SIM.sStart))}" height="${cH - 24}"/>`;
    return `<div class="card sim-c"><h3>${title}</h3><svg viewBox="0 0 ${cW} ${cH}">${band}${ticks}${lines}<line class="cur" id="${id}-cur" y1="8" y2="${cH - 16}"/>
      <text class="tk" x="30" y="${cH - 3}">L−1 d</text><text class="tk" x="${cW - 6}" y="${cH - 3}" text-anchor="end">${cube ? 'end' : 'lab'}</text></svg><div class="v mono" id="${id}-v">${unit}</div></div>`;
  }
  const sample = (arr, s0, step, n) => { const t = [], v = []; const k = Math.max(1, Math.floor(arr.length / n)); for (let i = 0; i < arr.length; i += k) { t.push(s0 + i * step); v.push(arr[i]); } return { t, v }; };
  const sT = sample(B.temp, B.s0, 60, 500), sS = sample(B.set, B.s0, 60, 500), sDn = sample(B.down, B.s0, 60, 500);
  const sDo = sample(G.dose, G.s0, 60, 500);
  $('#sim-charts').innerHTML = chart('c-t', 'Sample temperature, °C', [{ cls: 'set', ...sS }, { cls: 'act', ...sT }], '')
    + chart('c-d', 'Absorbed dose in the module, mGy', [{ cls: 'act', ...sDo }], '')
    + chart('c-x', 'Data downlinked to you, MB', [{ cls: 'act', ...sDn }], '');

  // ---------- 3-D ----------
  const views = own ? [{ name: satName, label: 'Your satellite', kind: 'sat' }].concat(arch === 'A' ? [] : [{ name: satName + '-entry', base: satName, label: 'Entry', kind: 'entry' }])
    : [{ name: 'LELP-1', label: 'LELP-1', kind: 'sat' }, { name: 'LELP-1-entry', base: 'LELP-1', label: 'Return', kind: 'entry' }];
  if ((D.modules || []).includes(eid)) views.push({ name: 'MOD-' + eid, label: 'Your module', kind: 'module' });
  let cadWant = '', cadHl = null;
  function cad(st) {
    if (!window.LelpCad) return;
    const ph = st.phase.id, mod = views.find((v) => v.kind === 'module');
    let want = views[0].name, hl = '';
    if (mod && (ph === 'load' || ph === 'protocol' || ph === 'manifest' || ph === 'recovery' || ph === 'lab')) { want = mod.name; hl = ph === 'protocol' && st.step ? (st.step.role || 'sample__') : 'sample__'; }
    if (!cube && st.s >= M.deorbit + 600 && st.s < M.splash + 1800) want = views.find((v) => v.kind === 'entry') ? views.find((v) => v.kind === 'entry').name : want;
    if (want !== cadWant) {
      cadWant = want;
      if (LelpCad.name !== want) { const i = views.findIndex((v) => v.name === want); if (LelpCad.name == null || !views.some((v) => v.name === LelpCad.name)) LelpCad.views(views, i); else LelpCad.select(want); }
      $('#sim-3d-h').textContent = want.startsWith('MOD-') ? 'Your module in CAD: the part at work is blue' : own ? 'Your satellite in CAD' : 'LELP-1 in CAD: your bay is blue';
      if (!own) LelpCad.mark([19]);
    }
    if (hl !== cadHl) { cadHl = hl; LelpCad.highlight(hl); }
  }

  // ---------- telemetry and the log ----------
  const tm = $('#sim-tm');
  function telemetry(st) {
    const p = st.p, link = st.contact.length ? st.contact.join(', ') : st.s >= T.t_orbit_s && st.s < SIM.sEnd ? 'none: data waits on board' : '-';
    const rows = [['Mission time', met(st.s)], ['UTC', utc(st.utc).slice(5)], ['Phase', st.phase.name],
      ['Altitude', p.alt >= 1 ? `${f0(p.alt)} km` : `${f0(p.alt * 1000)} m`], ['Speed', p.speed >= 1000 ? `${f2(p.speed / 1000)} km/s` : `${f0(p.speed)} m/s`],
      ['Acceleration', `${f1(p.g)} g`], ['Position', `${f1(Math.abs(p.lat))}°${p.lat < 0 ? 'S' : 'N'} ${f1(Math.abs(p.lon))}°${p.lon < 0 ? 'W' : 'E'}`],
      ['Sunlight', st.sunlit == null ? '-' : st.sunlit ? 'sunlit' : '<span class="chip warn">ECLIPSE</span>'], ['Ground contact', esc(link)],
      ['Sample temperature', `${f1(st.temp)} °C <span class="small">set ${f1(st.set)}</span>`], ...(st.cryo != null ? [['Cryo cassette', '−80 °C, passive']] : []),
      ['Dose', `${f2(st.dose)} mGy${st.inSaa ? ' <span class="chip warn">SAA</span>' : ''} <span class="small">${f1(st.doseRate)} µGy/h</span>`],
      ['Data to you', `${f1(st.down)} MB <span class="small">${f1(st.queued)} MB queued · ${f1(st.raw / 1000)} GB raw kept on board</span>`],
      ['Module power', `${f1(st.power)} W`], ['Sentinel', `${st.sentinel.signed} signed commands · ${st.sentinel.executed} executed${st.sentinel.held ? ` · ${st.sentinel.held} held or escalated` : ''}`]];
    tm.innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  }
  const LOG = $('#sim-log');
  let logN = -2;
  function log(st) {
    if (st.last === logN) return;
    logN = st.last;
    const out = [];
    for (let i = st.last; i >= 0 && out.length < 40; i--) {
      const v = SIM.events[i], c = v.cmd;
      out.push(`<li class="k-${v.kind}${v.big ? ' big' : ''}"><span class="mono">${met(v.s)}</span><b>${esc(v.title)}</b><p>${esc(v.text)}</p>${c ? `<p class="sig"><span>ML-DSA-87 ${c.sig} B</span><span>A ${esc(c.A)}</span><span>B ${esc(c.B)}</span><span class="chip ${c.final === 'EXECUTE' ? 'good' : 'warn'}">${esc(c.final)}</span><span class="src">${c.src === 'twin' ? 'from the twin run' : 'Sentinel rules'}</span></p>` : ''}</li>`);
    }
    LOG.innerHTML = out.join('');
  }
  const CAP = $('#sim-caption');
  let capKey = '';
  function caption(st) {
    let v = null;
    for (let i = st.last; i >= 0; i--) { const q = SIM.events[i]; if (SIM.toPlay(st.s) - SIM.toPlay(q.s) > 5) break; if (q.big || q.kind === 'proto' || q.kind === 'cmd') { v = q; break; } }
    let html;
    if (v) html = `<b>${esc(v.title)}</b><span>${esc(v.text)}</span>`;
    else if (st.phase.id === 'protocol') { const d = (st.s - SIM.sStart) / DAY; html = `<b>Day ${Math.floor(d) + 1} of ${days}</b><span>${f1(st.temp)} °C · ${f2(st.dose)} mGy · ${f1(st.down)} MB to you${st.step ? ' · last step: ' + esc(st.step.title) : ''}</span>`; }
    else html = `<b>${esc(st.phase.name)}</b><span>${esc(M.ev.filter((q) => q[0] <= st.s).pop() ? M.ev.filter((q) => q[0] <= st.s).pop()[2] : '')}</span>`;
    if (html !== capKey) { capKey = html; CAP.innerHTML = html; }
  }
  function proto(st) {
    let k = -1; steps.forEach((v, i) => { if (v.s <= st.s) k = i; });
    $('#p-cur').style.left = `${Math.max(0, Math.min(100, pX(st.s)))}%`;
    $('#p-now').textContent = st.s < SIM.sStart ? `starts ${met(SIM.sStart)}` : st.s < M.end ? `day ${f1((st.s - SIM.sStart) / DAY)} of ${days}` : 'preserved';
    if (k !== stepK) {
      stepK = k;
      $$('#p-steps li').forEach((li) => li.classList.toggle('on', +li.dataset.k === k));
      const li = $(`#p-steps li[data-k="${k}"]`); if (li) li.parentElement.scrollTop = li.offsetTop - li.parentElement.offsetTop - 30;
    }
  }

  // ---------- the report ----------
  const rep = SIM.report;
  function report() {
    const card = (h, rows) => `<div class="card"><h3>${h}</h3><table class="tbl">${rows.filter(Boolean).map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table></div>`;
    const ug = own && arch !== 'A' ? 'free-flyer: about 10⁻⁷ g quasi-steady' : own ? 'CubeSat, no arm' : 'about 7 × 10⁻⁷ g quasi-steady; quiet windows around the arm';
    $('#sim-report').innerHTML = `<h2>${cube ? 'Mission complete: your readings are on the ground' : 'Mission complete: your samples are in your lab'}</h2>
      <p class="lede small-lede">${esc(e.title)} · ${days} days at ${temp} °C on ${own ? esc(satName) : 'LELP-1, bay 19'}. Every number below comes from this run of the simulation.</p>
      <div class="sim-rep">
      ${card('Timeline', [['Launch', utc(M.t0)], ['Your start', utc(SIM.t0 + SIM.sStart * 1000) + (rep.start_held_min ? ` (held ${rep.start_held_min} min for temperature)` : '')], ['Preservation', utc(M.t0 + M.end * 1000)],
        !cube && ['Deorbit burn', utc(M.t0 + M.deorbit * 1000) + (rep.deorbit_wait_h > 0.2 ? ` (waited ${rep.deorbit_wait_h} h for the recovery-zone orbit)` : '')],
        !cube && ['Splashdown', utc(M.t0 + M.splash * 1000) + (M.splashPt ? ` at ${f1(Math.abs(M.splashPt.lat))}°${M.splashPt.lat < 0 ? 'S' : 'N'} ${f1(M.splashPt.lon)}°E` : '')],
        !cube && ['Handover', utc(M.t0 + M.hand * 1000)], !cube && ['In your lab (latest)', utc(M.t0 + M.lab * 1000)]])}
      ${card('Environment', [['Absorbed dose', `${f2(rep.dose_mgy)} mGy (before start ${f2(rep.dose_split_mgy.before_start)}, in protocol ${f2(rep.dose_split_mgy.during_protocol)}, after ${f2(rep.dose_split_mgy.after)})`],
        ['South Atlantic Anomaly', `${rep.saa_passes} passes`], ['Eclipse', rep.eclipse_min ? `${f0(rep.eclipse_min)} min in the Earth's shadow` : 'none: always in sunlight'],
        ['Microgravity', ug], rep.temp_c && ['Sample temperature', `${rep.temp_c.mean} °C mean (set ${rep.temp_c.set}, ${rep.temp_c.min} to ${rep.temp_c.max})`],
        ['Launch', `peak ${f1(rep.launch_peak_g)} g, max-Q ${f1(rep.max_q_kpa)} kPa`], rep.entry && ['Entry', `peak ${f1(rep.entry.peak_g)} g, ${f0(rep.entry.peak_heat_kw_m2)} kW/m² on the heat shield, splashdown ${f1(rep.entry.splash_ms)} m/s`]])}
      ${card('Your data', [['Imaging rounds', `${rep.imaging_rounds} (every ${SD.imaging.every_h} h, the twin's default plan)`], ['Downlinked to you', `${f1(rep.downlinked_mb)} MB of metrics and thumbnails`],
        ['Kept on board', `${f1(rep.raw_on_board_mb / 1000)} GB of raw frames, ${cube ? 'not returned' : 'home with the samples'}`], rep.latency_h && ['Latency', `${rep.latency_h.mean} h mean, ${rep.latency_h.max} h worst`],
        ['Passes', `${rep.passes} contacts, ${rep.passes_science} able to carry science`]])}
      ${card('Sentinel', [['Commands', `${rep.commands} signed with ML-DSA-87 (${SD.pq.dsa_signature} B each), all checked by both paths`], ['Human approvals', `${rep.escalated} irreversible commands escalated and approved`],
        ['Blocked', `${rep.blocked}`], ['Custody', cube ? 'no physical return' : 'ledger signed from late load to the courier; chain verified at handover']])}
      </div>
      <p class="small">Not simulated: the science outcome. This run computes where the spacecraft is, the light, the passes, the dose, the temperature, the data and the commands; it
      does not invent results. Launch and return trajectories, events and the commissioning verdicts come from the mission twin; the dose model is the twin's dosimeter
      placeholder until a dosimeter flies.</p>
      <p><button type="button" class="btn" id="r-dl">Download the mission report (JSON)</button> <a class="btn ghost" href="${esc($('#sim-back').href)}">Back to the configurator</a>
      <a class="btn ghost" href="../index.html">Watch the reference mission webcast</a></p>`;
    $('#r-dl').onclick = () => {
      const file = { generated_by: 'LELP-1 mission simulation, build ' + D.build, configuration: { experiment: eid, mode, architecture: own ? arch : null, days, temp_c: temp, launch_date: launch },
        readiness: SIM.ready, report: rep, events: SIM.events.map((v) => ({ utc: new Date(M.t0 + v.s * 1000).toISOString(), t_s: Math.round(v.s), kind: v.kind, title: v.title, text: v.text, sentinel: v.cmd || undefined })) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `lelp1-simulation-${eid}.json` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
  }
  report();

  // ---------- playback ----------
  let s = -DAY, playing = false, speed = 'auto', lastT = null, force = true, shownS = null;
  const btn = $('#sim-play');
  btn.disabled = !SIM.go;
  const setPlaying = (v) => { playing = v && SIM.go; btn.textContent = playing ? '❚❚ Pause' : s >= SIM.tEnd ? '↻ Run again' : s > -DAY ? '▶ Continue' : '▶ Run the mission'; };
  btn.onclick = () => { if (s >= SIM.tEnd) s = -DAY; setPlaying(!playing); };
  $('#sim-restart').onclick = () => { s = -DAY; force = true; $('#sim-report').hidden = true; setPlaying(SIM.go); };
  $('#sim-skip').onclick = () => { $('#sim-report').hidden = false; $('#sim-report').scrollIntoView({ behavior: 'smooth' }); };
  $$('#sim-speed button').forEach((b) => { b.onclick = () => { speed = b.dataset.v === 'auto' ? 'auto' : +b.dataset.v; $$('#sim-speed button').forEach((q) => q.classList.toggle('on', q === b)); }; });
  const bar = $('#sim-bar');
  const seek = (ev) => { const r = bar.getBoundingClientRect(); s = SIM.toMission(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * L); force = true; };
  bar.addEventListener('pointerdown', (ev) => { seek(ev); bar.setPointerCapture(ev.pointerId); bar.onpointermove = seek; });
  bar.addEventListener('pointerup', () => { bar.onpointermove = null; });
  function render() {
    const st = SIM.state(s);
    $('#sim-met').textContent = met(s); $('#sim-utc').textContent = utc(st.utc);
    const pc = $('#sim-phase'); pc.textContent = st.phase.name.toUpperCase();
    $('#sim-cursor').style.left = `${(SIM.toPlay(s) / L * 100).toFixed(2)}%`;
    setView(view === 'auto' ? autoView(s) : view === 'entry' && cube ? 'map' : view === '3d' && !ready3d ? 'map' : view);
    if (shown === '3d') draw3d(st, frameDt); else if (shown === 'map') drawMap(st); else if (shown === 'ascent') drawAscent(st); else if (shown === 'entry') drawEntry(st);
    else if (shown === 'hand') $$('.sim-hand li').forEach((li) => li.classList.toggle('on', +li.dataset.s <= s));
    telemetry(st); log(st); caption(st); proto(st); cad(st);
    for (const id of ['c-t', 'c-d', 'c-x']) { const c = $(`#${id}-cur`); if (c) { c.setAttribute('x1', cx(s)); c.setAttribute('x2', cx(s)); } }
    $('#c-t-v').textContent = `${f1(st.temp)} °C`; $('#c-d-v').textContent = `${f2(st.dose)} mGy`; $('#c-x-v').textContent = `${f1(st.down)} MB`;
  }
  let frameDt = 1 / 60;
  function frame(now) {
    frameDt = lastT == null ? 1 / 60 : Math.min(0.1, (now - lastT) / 1000);
    if (playing) {
      const dt = frameDt;
      s = speed === 'auto' ? SIM.toMission(SIM.toPlay(s) + dt) : s + dt * speed;
      if (s >= SIM.tEnd - 1e-6) { s = SIM.tEnd; setPlaying(false); $('#sim-report').hidden = false; }
    }
    lastT = now;
    if (playing || force || shownS !== s || (shown === '3d' && scene3d)) { force = false; shownS = s; render(); }
    requestAnimationFrame(frame);
  }
  if (isFinite(+H.get('at')) && H.get('at') !== null) { s = Math.max(-DAY, Math.min(SIM.tEnd, +H.get('at'))); if (s >= SIM.tEnd) $('#sim-report').hidden = false; }   // a shared moment
  setPlaying(false);
  if (H.get('play') === '1' && SIM.go) setPlaying(true);
  requestAnimationFrame(frame);
  // test hook: seek renders at once, so a hidden tab (no animation frames) can be checked too
  window.__lelpSim = { sim: SIM, seek: (t) => { s = t; force = false; shownS = s; render(); }, play: () => setPlaying(true), get s() { return s; } };
})();
