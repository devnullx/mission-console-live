/* Mission console: replays the twin's event stream and telemetry frames on its own clock.
   Markup: index.html · styles: style.css · 3-D: scene.js · data: api/mission/{mode}.json (compact; hydrate.js rebuilds it).
   Hooks for recording and debugging: window.__console = { seek, play, setTab, setMode, state, data }. */
(async function () {
  'use strict';
  // build label (web/build.py): reviewers can tell which build they are looking at
  { const bm = document.querySelector('meta[name=build]'), sub = document.querySelector('.brand-sub');
    if (bm) { window.__build = bm.content; document.querySelector('.brand').title = 'build ' + bm.content + ' · ' + bm.dataset.built;
      if (sub) sub.insertAdjacentHTML('beforeend', ` · <span class="build-tag">${bm.content}</span>`); } }
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const set = (id, v) => { const el = typeof id === 'string' ? $(id) : id; if (!el) return; v = String(v); if (el.textContent !== v) el.textContent = v; };
  const cls = (id, c) => { const el = typeof id === 'string' ? $(id) : id; if (el && el.className !== c) el.className = c; };
  const R = window.Replay, { T0, MILESTONES, lerp, clamp, pad2, hms, clock, met, esc, km, nice, lastBefore, sampleAt } = R;

  // ---------- constants ----------
  const PHASES = ['LAUNCH', 'BOOSTER', 'ORBIT', 'OPS', 'RETURN', 'EOM'];
  const PHASE_LABEL = { LAUNCH: 'LAUNCH', BOOSTER: 'BOOSTER LANDING', ORBIT: 'ORBIT INSERTION', OPS: 'LAB OPERATIONS', RETURN: 'PAYLOAD RETURN', EOM: 'MISSION COMPLETE' };
  const ARM_STEPS = ['identify', 'unlock', 'capture', 'transfer', 'dock', 'position', 'analyse', 'return', 'record'];
  const JOINT_LIM = [180, 100, 90, 150, 120, 180, 180];
  const STATIONS = [['ISTRAC', 'ISTRAC Bengaluru', 'IN'], ['LEUK', 'Leuk', 'CH'], ['ESOC', 'ESOC Darmstadt', 'DE'], ['RELAY-1', 'Relay 1', 'ISL'], ['RELAY-2', 'Relay 2', 'ISL']];
  const QUEUE = [['safety', 'SAFETY'], ['housekeeping', 'HOUSEKEEPING'], ['experiment_status', 'EXP. STATUS'], ['science_raw', 'SCIENCE RAW'], ['science_products', 'PRODUCTS'], ['logs', 'LOGS']];
  const OSI = [
    ['7 APP', 'MO 520 · PUS E-70-41C · CFDP 727', 'AND-gate · ML-DSA-87 · ledger'],
    ['6 PRES', 'Space Packet 133.0 · XTCE 660', 'AES-256-GCM per command + sequence'],
    ['5 SESS', 'CFDP transactions · pass schedule', 'ML-KEM-1024 per pass · revocation'],
    ['4 TRAN', 'COP-1 232.1 · CFDP class 2', 'replay counters'],
    ['3 NET', 'IP over CCSDS 702.1 · BPv7 734.2 (DTN)', 'zero-visibility relays · containment'],
    ['2 LINK', 'TC 232.0 · AOS 732.0 · Prox-1 211.0 · SDLS 355.0', 'SDLS keys from the PQ session'],
    ['1 PHY', 'RF 401.0 · S / X / Ka · LDPC 131.0', 'jamming: detect and reroute'],
  ];
  const CAT = { LAUNCH: 'flight', BOOSTER: 'flight', ORBIT: 'flight', RETURN: 'flight', EOM: 'flight', OPS: 'lab', CUSTOMER: 'lab', COMMS: 'comms', SENTINEL: 'sentinel', ATTACK: 'sentinel' };
  const BOOSTER_PHASE = { coast: 'FLIP', boostback: 'DIVERT BURN', entry_coast: 'COAST', entry_burn: 'ENTRY BURN', descent: 'AERO DESCENT', landing_burn: 'LANDING BURN', landed: 'LANDED' };
  const UPPER_PHASE = { burn: 'S2 BURN 1', burn1: 'S2 BURN 1', coast: 'COAST', burn2: 'S2 BURN 2', orbit: 'ORBIT' };

  // ---------- state ----------
  const data = {};
  const S = { mode: 'sentinel', t: T0, playing: false, speed: 'auto', rate: 1.5, lastWall: performance.now(), lastPanels: 0, dirty: true, feedIdx: 0,
              sel: 17, tab: { left: 'dexter', drawer: 'flight' }, follow: { left: true, drawer: true }, phase: null, error: null };
  const D = () => data[S.mode];

  // ---------- data: load + derive ----------
  const load = (mode) => R.load(mode, (n, e) => { set('ld-msg', 'Waiting for the mission twin…'); set('ld-sub', 'attempt ' + n + ' · ' + e.message); });
  const t2x = (t) => R.t2x(D(), t), x2t = (x) => R.x2t(D(), x), lastEvent = (t, pred) => R.lastEvent(D(), t, pred);
  const launchState = (t) => R.launchState(D(), t), autoRate = (t) => R.autoRate(D(), t), moduleState = R.moduleState;

  // ---------- boot ----------
  try { data.sentinel = await load('sentinel'); }
  catch (e) { set('ld-msg', 'Could not load the mission data'); set('ld-sub', e.message + ' · reload the page to retry'); return; }

  const stub = { setPhase() {}, updateLaunch() {}, updateOps() {}, setSolar() {}, setLandingZone() {}, _resize() {} };
  let scene = stub;
  try { scene = new window.Scene3D($('view3d')); } catch (e) { console.warn('3-D view unavailable:', e); $('gl-note').hidden = false; }
  window.scene = scene;
  $('view3d').addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('gl-note').hidden = false; set('gl-note', '3-D view paused by the browser (graphics context lost); telemetry continues.'); });
  $('view3d').addEventListener('webglcontextrestored', () => { $('gl-note').hidden = true; });

  // ---------- static DOM ----------
  $('modgrid').innerHTML = Array.from({ length: 32 }, (_, i) => `<div class="mod" id="mod-${i + 1}" data-id="${i + 1}"><span>${i + 1}</span><span class="mt">—</span></div>`).join('');
  $('arm-steps').innerHTML = ARM_STEPS.map((s) => `<li>${s.toUpperCase()}</li>`).join('');
  $('joints').innerHTML = JOINT_LIM.map((_, k) => `<div><i><b style="height:0"></b></i><em>0°</em>J${k + 1}</div>`).join('');
  $('stations').tBodies[0].innerHTML = STATIONS.map(([id, name, cc]) => `<tr id="st-${id}"><td><b>${name}</b> <span class="cc">${cc}</span></td><td class="opt3" id="stb-${id}">—</td><td class="num opt2" id="str-${id}">—</td>` +
    `<td class="num" id="ste-${id}">—</td><td class="num opt" id="stg-${id}">—</td><td class="num opt3" id="stn-${id}">—</td><td class="num" id="stm-${id}">—</td><td id="sts-${id}">—</td></tr>`).join('');
  $('queue').innerHTML = QUEUE.map(([id, label]) => `<span class="ql">${label}</span><span class="qb"><i id="qb-${id}" style="width:0"></i></span><span class="qv" id="qv-${id}">0.0 MB</span>`).join('');
  $('osi').tBodies[0].innerHTML = OSI.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="sen">${r[2]}</td></tr>`).join('');

  function buildForMode() {          // everything that depends on the loaded mission (rebuilt on a scenario switch)
    const M = D(), X = M.x, meta = M.launch_meta || {}, L = meta.landing;
    $('track-bands').innerHTML = X.bands.map(([a, b, label, c]) => { const x0 = t2x(a) * 100, x1 = t2x(b) * 100; return `<span class="${c}" style="left:${x0.toFixed(2)}%;width:${(x1 - x0).toFixed(2)}%">${label}</span>`; }).join('');
    $('track-marks').innerHTML = X.marks.map((e) => `<i class="${e.level}" style="left:${(t2x(e.t) * 100).toFixed(2)}%"></i>`).join('');
    $('milestones').innerHTML = X.miles.map((m) => `<div id="ms-${m.code}"><span>${m.label}</span><b>${pad2(Math.floor(m.t / 60))}:${pad2(Math.floor(m.t % 60))}</b></div>`).join('');
    $('facts').innerHTML = [['SITE', (meta.site || '').split(' (')[0].replace('APJ Abdul ', '')], ['TARGET ORBIT', meta.orbit || '—'], ['LAUNCH AZIMUTH', (meta.launch_azimuth_deg || '—') + '°'],
      ['LANDING BARGE', X.lz ? X.lz.toFixed(0) + ' km downrange' : '—'], ['STAGE 1', (meta.engines || 9) + ' × Shakti · GP-300'],
      ['LELP-1 PAYLOAD', meta.lelp_kg ? `${meta.lelp_kg.toFixed(0)} kg of ${meta.lelp_allocation_kg.toFixed(0)} kg` : '—'],
      ['DRAG FINS', meta.drag_fins ? `${meta.drag_fins.count} × ${meta.drag_fins.length_m.toFixed(2)} m · ${Math.round(meta.drag_fins.open_deg)}° · drag ×${meta.drag_fins.drag_area_ratio.toFixed(2)}` : '—']].map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');
    $('stab').innerHTML = L ? `Legs 4 × 3.87 m at ${L.deploy_deg}° with telescoping struts · span <b>${L.span_m} m</b> · nozzle clearance <b>${L.nozzle_clearance_m} m</b> · tip-over <b>${L.tip_angle_deg}°</b> against ${L.deck_roll_deg}° deck roll · ${L.leg_load_kn} kN per leg · <b class="${L.stable ? 'ok' : 'bad'}">${L.stable ? 'STABLE' : 'UNSTABLE'}</b>` : '';
    const links = M.frames.length ? M.frames[0].comms.links : {};
    STATIONS.forEach(([id]) => { const l = links[id]; if (!l) return; set('stb-' + id, l.band); set('str-' + id, (l.rate_bps / 1e6).toFixed(1) + ' M / ' + (l.uplink_bps / 1e3).toFixed(0) + ' k'); });
    set('sentinel-sub', S.mode === 'sentinel' ? 'PQ signature AND guardian' : 'baseline: signature only');
    scene.setLandingZone(X.lz);
    chartCache = {}; sparkKey = '';
  }

  // ---------- launch ----------
  function panelLaunch(t, L) {
    const M = D(), X = M.x, meta = M.launch_meta || {}, hero = L.upper || L.stack, b = L.booster;
    set('launch-body', L.upper ? 'VIBHU UPPER STAGE + LELP-1' : `STACK · ${meta.engines || 9} × SHAKTI`);
    set('v-speed', Math.round(hero.speed_ms * 3.6).toLocaleString('en-US')); set('v-alt', hero.alt_km.toFixed(1));
    set('v-dr', km(hero.downrange_km)); set('v-dr-lbl', hero.downrange_km >= 1000 ? 'RANGE' : 'DOWNRANGE'); set('v-thr', Math.round(hero.throttle * 100) + ' %');
    set('v-q', hero.q_kpa.toFixed(1) + ' kPa'); set('v-g', (hero.g_load || 0).toFixed(1) + ' g');
    set('v-prop', hero.prop_pct.toFixed(0) + ' %'); $('m-prop').style.width = clamp(hero.prop_pct, 0, 100) + '%';
    set('v-prop-lbl', L.upper ? 'S2 PROPELLANT' : 'S1 PROPELLANT');
    const pill = L.upper ? (UPPER_PHASE[L.upper.phase] || 'ASCENT') : t < -3 ? 'COUNTDOWN' : t < 0 ? 'IGNITION' : 'ASCENT';
    set('mode-pill', pill); cls('mode-pill', 'chip info');
    // booster recovery
    cls('booster-box', b ? '' : 'off');
    set('booster-phase', b ? (b.fins > 0.01 && b.fins < 0.99 ? 'DRAG FINS OPENING' : b.phase === 'entry_coast' && b.fins >= 0.99 ? 'DRAG FINS OPEN' : BOOSTER_PHASE[b.phase] || nice(b.phase).toUpperCase()) : 'ATTACHED');
    cls('booster-phase', 'chip ' + (!b ? '' : b.phase === 'landed' ? 'good' : 'info'));
    const fins = b ? b.fins || 0 : 0, legs = !b ? 0 : b.phase === 'landed' ? 1 : b.phase === 'landing_burn' ? clamp((1.3 - b.alt_km) / 0.9, 0, 1) : 0;
    if (b) {
      set('b-speed', Math.round(b.speed_ms * 3.6).toLocaleString('en-US') + ' km/h'); set('b-alt', b.alt_km < 10 ? b.alt_km.toFixed(2) + ' km' : b.alt_km.toFixed(1) + ' km');
      const gap = Math.abs(X.lz - b.downrange_km); set('b-dr', b.phase === 'landed' ? 'ON DECK · ' + (meta.touchdown_miss_m != null ? meta.touchdown_miss_m.toFixed(0) + ' m' : '') : gap < 1 ? Math.round(gap * 1000) + ' m' : gap.toFixed(1) + ' km');
      set('b-prop', b.prop_pct.toFixed(1) + ' %'); set('b-g', (b.g_load || 0).toFixed(1) + ' g'); set('b-q', b.q_kpa.toFixed(1) + ' kPa');
      set('b-heat', Math.round(b.heat_kw_m2 || 0) + ' kW/m²'); set('b-thr', Math.round(b.throttle * 100) + ' %');
    } else ['b-speed', 'b-alt', 'b-dr', 'b-prop', 'b-g', 'b-q', 'b-heat', 'b-thr'].forEach((id) => set(id, '—'));
    const dfin = meta.drag_fins || { open_deg: 32 };
    set('b-fins', fins >= .99 ? `OPEN ${Math.round(dfin.open_deg)}° · STEERING` : fins > 0 ? 'OPENING ' + Math.round(fins * dfin.open_deg) + '°' : 'STOWED');
    set('b-legs', legs >= .99 ? 'LOCKED · 115°' : legs > 0 ? 'DEPLOYING ' + Math.round(legs * 115) + '°' : 'STOWED');
    // side-view gauges: both parts hinge near the engine end and lie along the skin, free end up, when stowed
    const gauge = (id, hx, hy, len, deg) => { const a = deg * Math.PI / 180, el = $(id); el.setAttribute('x2', (hx + len * Math.sin(a)).toFixed(1)); el.setAttribute('y2', (hy - len * Math.cos(a)).toFixed(1)); };
    gauge('fins-line', 12, 25, 18, dfin.open_deg * fins); $('fins-svg').classList.toggle('out', fins > .02);
    gauge('legs-line', 12, 16, 15, 115 * legs); $('legs-svg').classList.toggle('out', legs > .02);
    X.miles.forEach((m) => { const el = $('ms-' + m.code); if (el) cls(el, t >= m.t ? 'done' : ''); });
    $('ret-readout').hidden = true;
    const cap = lastEvent(t, (e) => e.seg === 'LAUNCH' || e.seg === 'BOOSTER' || e.seg === 'ORBIT');
    set('overlay-caption', cap ? `${nice(cap.code)} · ${cap.text}` : `${meta.vehicle || 'RUPAK'} on the pad · ${meta.site || ''}`);
    if (S.tab.drawer === 'flight') drawFlight(t);
    hud(t, `${Math.round(hero.speed_ms * 3.6).toLocaleString('en-US')} km/h`, `${hero.alt_km.toFixed(1)} km · ${pill}`, b && b.phase !== 'landed' ? `BOOSTER ${$('booster-phase').textContent} · ${b.alt_km.toFixed(1)} km` : (cap ? nice(cap.code) : ''));
  }

  // ---------- flight charts (SVG drawn at pixel size; planned path faint, flown path solid) ----------
  let chartCache = {};
  const size = (svg) => { const r = svg.getBoundingClientRect(); return [Math.max(140, Math.round(r.width)), Math.max(70, Math.round(r.height))]; };
  function drawFlight(t) {
    const X = D().x, st = X.by.stack || [], up = X.by.upper || [], bo = X.by.booster || [];
    const C1 = '#3987e5', C2 = '#d95926', m = { l: 30, r: 10, t: 8, b: 17 };
    const poly = (pts, color, faint) => pts ? `<polyline fill="none" stroke="${color}" stroke-width="${faint ? 1.2 : 2}" ${faint ? 'stroke-opacity=".38" stroke-dasharray="3 3"' : 'stroke-linejoin="round" stroke-linecap="round"'} points="${pts}"/>` : '';
    const dot = (x, y, color) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" stroke="#1d1f21" stroke-width="2"/>`;
    for (const which of ['traj', 'spd']) {
      const svg = $(which), [W, H] = size(svg), key = which + W + 'x' + H;
      const fx = which === 'traj' ? (s) => s.downrange_km / X.xMax : (s) => s.t / X.tChart, fy = which === 'traj' ? (s) => s.alt_km / X.yMax : (s) => s.speed_ms / 1000 / X.vMax;
      const px = (u) => m.l + u * (W - m.l - m.r), py = (v) => H - m.b - v * (H - m.t - m.b);
      const path = (arr, upTo) => { let out = ''; for (const s of arr) { if (s.t > upTo) break; const u = fx(s); if (u > 1.08) break; out += px(u).toFixed(1) + ',' + py(fy(s)).toFixed(1) + ' '; } return out; };
      if (!chartCache[key]) {   // axes, grid and the planned paths only change with the size
        const xt = which === 'traj' ? [0, X.xMax / 3, 2 * X.xMax / 3, X.xMax].map((v) => [v / X.xMax, Math.round(v)]) : [0, 100, 200, 300, 400, 500].filter((v) => v <= X.tChart).map((v) => [v / X.tChart, v + ' s']);
        const yStep = which === 'traj' ? 50 : 2, yMax = which === 'traj' ? X.yMax : X.vMax, yt = []; for (let v = 0; v <= yMax + 1e-9; v += yStep) yt.push([v / yMax, v]);
        let g = `<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="clip-${which}"><rect x="${m.l}" y="${m.t - 4}" width="${W - m.l - m.r + 6}" height="${H - m.t - m.b + 4}"/></clipPath></defs>`;
        g += yt.map(([v, lab]) => `<line x1="${m.l}" x2="${W - m.r}" y1="${py(v)}" y2="${py(v)}" class="grid"/><text x="${m.l - 5}" y="${py(v) + 3.5}" text-anchor="end" class="tick">${lab}</text>`).join('');
        g += xt.map(([u, lab]) => `<text x="${px(u)}" y="${H - 4}" text-anchor="middle" class="tick">${lab}</text>`).join('');
        if (which === 'traj') g += `<rect x="${px(X.lz / X.xMax) - 7}" y="${py(0) - 2}" width="14" height="4" fill="#fab219"/><text x="${px(X.lz / X.xMax)}" y="${py(0) - 6}" text-anchor="middle" class="tick">BARGE</text>`;
        else g += [['MECO', X.tMeco], ['ENTRY', (X.miles.find((q) => q.code === 'ENTRY_BURN') || {}).t], ['LANDING', X.tLandBurn]].filter((q) => q[1] != null)
          .map(([lab, tt]) => `<line x1="${px(tt / X.tChart)}" x2="${px(tt / X.tChart)}" y1="${m.t + 8}" y2="${H - m.b}" class="guide"/><text x="${px(tt / X.tChart)}" y="${m.t + 5}" text-anchor="middle" class="tick">${lab}</text>`).join('');
        g += `<g clip-path="url(#clip-${which})">` + poly(path(st, 1e9) + path(up, 1e9), C1, true) + poly(path(bo, 1e9), C2, true) + '</g>';
        chartCache[key] = g.replace('<svg xmlns="http://www.w3.org/2000/svg">', '');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      }
      const now = (arr) => (arr.length && t >= arr[0].t ? sampleAt(arr, Math.min(t, arr[arr.length - 1].t)) : null);
      const hs = now(up) || now(st), bs = t >= X.tTouch && bo.length ? bo[bo.length - 1] : now(bo);
      let live = `<g clip-path="url(#clip-${which})">` + poly(path(st, t) + path(up, t), C1) + poly(path(bo, t), C2);
      if (hs && fx(hs) <= 1.02) live += dot(px(fx(hs)), py(fy(hs)), C1);
      if (bs) live += dot(px(Math.min(fx(bs), 1)), py(which === 'spd' && t >= X.tTouch ? 0 : fy(bs)), C2);
      svg.innerHTML = chartCache[key] + live + '</g>';
    }
  }

  // ---------- lab operations ----------
  let opsStates = [], sparkKey = '';
  function panelOps(t, f, fi, capS) {
    const M = D(), p = f.platform, A = p.arm;
    set('plat-mode', nice(p.mode)); set('mode-pill', nice(p.mode)); cls('mode-pill', 'chip');
    set('p-alt', p.alt_km + ' km'); set('p-batt', p.battery + ' %'); set('p-labt', Number(p.lab_t).toFixed(1) + ' °C');
    set('p-sun', p.eclipse ? 'ECLIPSE' : 'SUNLIT'); set('p-active', p.active_modules); set('p-isol', p.isolated.length ? p.isolated.join(', ') : 'none');
    // modules
    const tgt = lastEvent(t, (e) => e.data && e.data.final && e.data.final !== 'EXECUTE' && t - e.t < 25 && /^module-/.test(e.data.target || ''));
    const tgtId = tgt ? +tgt.data.target.split('-')[1] : 0;
    f.modules.forEach((m, k) => { const el = $('mod-' + m.id); cls(el, 'mod ' + opsStates[k] + (m.id === S.sel ? ' sel' : '') + (m.id === tgtId ? ' tgt' : ''));
      set(el.lastChild, m.state === 'stowed' ? m.size : m.t.toFixed(1)); });
    // Dexter-L
    const stepI = ARM_STEPS.indexOf(A.step);
    $$('#arm-steps li').forEach((li, k) => cls(li, A.busy ? (k < stepI ? 'done' : k === stepI ? 'now' : '') : ''));
    set('arm-now', A.released ? 'LEFT WITH THE UPPER STAGE · Dexter-L does not come home' : A.parked ? 'PARKED ON THE UPPER STAGE · latched to the stage grapple post, base latch released' : A.busy ? `MODULE ${A.module} · ${nice(A.task || 'cycle').toUpperCase()} · ${A.step} ${Math.round(A.step_t || 0)} / ${A.step_dur || 0} s${A.requested_by && A.requested_by !== 'MCC' ? ' · for ' + A.requested_by.split(' /')[0] : ''}`
      : `IDLE · stowed, brakes on · ${A.cycles || 0} cycle${A.cycles === 1 ? '' : 's'} flown`);
    if (A.joints) {
      $$('#joints div').forEach((d, k) => { const v = A.joints[k]; d.querySelector('b').style.height = (Math.min(Math.abs(v), JOINT_LIM[k]) / JOINT_LIM[k] * 100) + '%';
        cls(d.querySelector('i'), Math.abs(A.torques[k]) > 0.3 ? 'hot' : ''); set(d.querySelector('em'), v.toFixed(0) + '°'); });
      set('d-ring', Number(A.ring_deg || 0).toFixed(0) + '°'); set('d-tip', A.tip_mps + ' m/s'); set('d-tau', A.tau_max + ' N·m'); set('d-ft', A.ft_n + ' N');
      set('d-grip', A.grip ? 'LATCHED' : 'OPEN'); set('d-umb', A.umbilical ? 'MATED' : 'OFF'); set('d-fid', A.busy ? Math.round(A.fiducial * 100) + ' %' : '—');
      set('d-pow', A.power_w + ' W'); set('d-react', A.reaction_nm + ' N·m'); set('d-cyc', A.cycles);
      $('inhand').hidden = !A.grip;
      if (A.grip && A.module) { const m = f.modules[A.module - 1]; set('ih-name', `Module ${m.id} · ${m.payload.kind} · ${m.customer}`);
        set('ih-det', `${m.payload.mass_kg} kg · ${m.payload.vials} ${m.payload.vessel || 'vials'} · ${m.payload.containment} · ${m.t.toFixed(1)} °C held on umbilical power`); }
    }
    panelModule(f, fi, t);
    // subsystems
    if (p.eps) { const e = p.eps, tc = p.tcs, ad = p.adcs, cd = p.cdh, pr = p.prop;
      set('ss-eps-sun', e.sun); set('ss-eps-gen', e.gen_w + ' W'); set('ss-eps-load', e.load_w + ' W'); set('ss-eps-v', e.bus_v + ' V'); set('ss-eps-soc', e.soc + ' %');
      set('ss-tcs-lab', tc.lab_c + ' °C'); set('ss-tcs-rad', tc.radiator_c + ' °C'); set('ss-tcs-heat', tc.heaters_w + ' W'); set('ss-tcs-bus', tc.bus_c + ' °C');
      set('ss-adcs-mode', ad.mode); set('ss-adcs-err', ad.err_deg + '°'); set('ss-adcs-rate', ad.rate_dps + ' °/s'); set('ss-adcs-rw', Math.round(ad.wheel_rpm.reduce((x, y) => x + y, 0) / ad.wheel_rpm.length) + ' rpm'); set('ss-adcs-arm', (ad.arm_reaction_nm || 0) + ' N·m');
      set('ss-cdh-obc', 'OBC-' + cd.obc); set('ss-cdh-cpu', cd.cpu_pct + ' %'); set('ss-cdh-sto', cd.storage_gb + ' GB'); set('ss-cdh-up', cd.uptime_h + ' h'); set('ss-cdh-led', f.gate.ledger_entries);
      set('ss-prop-kg', pr.prop_kg + ' kg'); set('ss-prop-dv', pr.dv_ms + ' m/s'); set('ss-prop-bar', pr.tank_bar + ' bar'); set('ss-prop-orbit', p.alt_km + ' km SSO'); }
    // ground segment
    const vis = f.comms.visible || [], iso = f.gate.isolated || [];
    STATIONS.forEach(([id]) => { const l = (f.comms.links || {})[id], b = l && l.budget, isIso = iso.includes(id), on = vis.includes(id);
      cls('st-' + id, isIso ? 'isolated' : on ? 'on' : '');
      set('ste-' + id, b ? b.el_deg + '°' : '—'); set('stg-' + id, b ? Math.round(b.range_km).toLocaleString('en-US') + ' km' : '—');
      set('stn-' + id, b ? b.ebn0_db + ' dB' : '—'); set('stm-' + id, b ? '+' + b.margin_db + ' dB' : '—');
      set('sts-' + id, isIso ? 'ISOLATED' : on && l ? `SA ${l.sdls_sa} · ML-KEM-1024` : '—'); cls('sts-' + id, isIso ? 'bad' : on ? '' : 'dim'); });
    const maxQ = Math.max(1e6, ...Object.values(f.comms.queue));
    QUEUE.forEach(([id]) => { const v = f.comms.queue[id] || 0; $('qb-' + id).style.width = (v / maxQ * 100) + '%'; set('qv-' + id, (v / 1e6).toFixed(1) + ' MB'); });
    set('c-total', f.comms.total_mb.toFixed(0) + ' MB'); set('c-relay', f.comms.relayed_mb.toFixed(0) + ' MB');
    $('drawer-note').dataset.k = ''; set('drawer-note', (vis.length ? 'in view: ' + vis.join(' · ') : 'no station in view') + ' · ' + f.comms.queued_packets + ' pkts queued');
    // link stack: the layer the latest refused command was caught on
    const dLast = lastEvent(t, (e) => e.data && e.data.final && e.data.final !== 'EXECUTE' && t - e.t < 90), why = dLast ? dLast.data.reasons.join(' ') : '';
    const hot = !dLast ? -1 : /replay/.test(why) ? 3 : /route|isolated|relay/i.test(why) ? 4 : 0;
    $$('#osi tbody tr').forEach((tr, k) => cls(tr, k === hot ? 'hot' : ''));
    // caption + automatic tab following
    const cap = lastEvent(t, (e) => e.seg === 'OPS' || e.seg === 'ATTACK' || e.seg === 'RETURN' || e.seg === 'CUSTOMER' || e.code === 'CONTAIN');
    set('overlay-caption', cap ? `${nice(cap.code)} · ${cap.text}` : nice(p.mode));
    if (S.follow.left) { if (tgtId) S.sel = tgtId; else if (!A.busy && !lastEvent(t, (e) => e.data && e.data.final && e.data.final !== 'EXECUTE' && t - e.t < 90)) S.sel = 17;
      setTab('left', A.busy ? 'dexter' : 'module', true); }
    if (S.follow.drawer) setTab('drawer', dLast ? 'stack' : 'ground', true);
    $('ret-readout').hidden = !capS; if (capS) set('ret-readout', R.reentryReadout(capS));
    if (capS) hud(t, R.reentryReadout(capS).split(' · ').slice(0, 2).join(' · '), R.reentryReadout(capS).split(' · ').slice(2).join(' · '), cap ? cap.text.slice(0, 90) : '');
    else hud(t, nice(p.mode), A.busy ? `DEXTER-L · MODULE ${A.module} · ${A.step}` : `${p.active_modules} modules active · ${p.eclipse ? 'eclipse' : 'sunlit'}`, cap ? cap.text.slice(0, 90) : '');
  }
  function panelModule(f, fi, t) {
    const m = f.modules[S.sel - 1]; if (!m) return; const pr = m.protocol || {}, st = moduleState(m), pay = m.payload || {};
    set('md-title', 'Module ' + m.id); set('md-size', m.size === 'L' ? 'large bay' : 'medium bay');
    set('md-state', nice(m.state || 'stowed').toUpperCase()); cls('md-state', 'chip ' + ({ good: 'good', warn: 'warn', crit: 'alert', move: 'info', idle: '' }[st]));
    set('md-sub', `${pay.kind || nice(m.exp)} · ${m.customer || 'unassigned'}`);
    set('md-t', m.t.toFixed(2) + ' °C'); set('md-sp', pr.setpoint ? pr.setpoint + ' °C' : '—'); set('md-p', m.p + ' kPa'); set('md-seal', m.sealed ? 'SEALED' : 'BREACH');
    set('md-h', Math.round(m.health * 100) + ' %'); set('md-heat', m.heater_w + ' W'); set('md-proto', pr.mode === 'cycle' ? 'cycling' : 'constant');
    set('md-cyc', pr.mode === 'cycle' ? pr.cycles + (pr.crystal_um ? ' · ' + pr.crystal_um + ' µm' : '') : '—');
    set('md-note', [pay.vials ? pay.vials + ' ' + (pay.vessel || 'vials') : '', pay.mass_kg ? pay.mass_kg + ' kg' : '', pay.containment, pay.interface, pr.groups].filter(Boolean).join(' · '));
    if (S.tab.left !== 'module') return;
    const key = S.mode + ':' + S.sel + ':' + Math.floor(fi / 3); if (key === sparkKey) return; sparkKey = key;
    const svg = $('md-spark'), [W, H] = size(svg), F = D().frames, i0 = Math.max(0, fi - 720), pts = [];
    for (let i = i0; i <= fi; i += 6) pts.push(F[i].modules[S.sel - 1].t);
    pts.push(m.t);
    let lo = Math.min(...pts), hi = Math.max(...pts); if (hi - lo < 1) { const c = (hi + lo) / 2; lo = c - .5; hi = c + .5; }
    const px = (k) => 4 + k / Math.max(pts.length - 1, 1) * (W - 44), py = (v) => H - 5 - (v - lo) / (hi - lo) * (H - 10);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<polyline fill="none" stroke="#3987e5" stroke-width="1.6" stroke-linejoin="round" points="${pts.map((v, k) => px(k).toFixed(1) + ',' + py(v).toFixed(1)).join(' ')}"/>` +
      `<circle cx="${px(pts.length - 1)}" cy="${py(m.t)}" r="3" fill="#3987e5"/><text x="${W - 2}" y="${py(hi) + 4}" text-anchor="end" class="tick">${hi.toFixed(1)}°</text><text x="${W - 2}" y="${py(lo) + 2}" text-anchor="end" class="tick">${lo.toFixed(1)}°</text>`;
  }

  // ---------- Sentinel ----------
  function panelSentinel(t) {
    const M = D(), d = lastEvent(t, (e) => e.data && e.data.final), fi = lastBefore(M.frames, t), g = fi >= 0 ? M.frames[fi].gate : null;
    set('g-exec', g ? g.executed : 0); set('g-block', g ? g.blocked : 0); set('g-held', g ? g.held + g.escalated : 0); set('g-ledger', (g ? g.ledger_entries : 0) + ' entries');
    const pa = $('path-a'), pb = $('path-b'), dec = $('decision');
    if (!d) { cls(pa, 'gate-path'); cls(pb, 'gate-path'); set(pa.children[1], '—'); set(pb.children[1], S.mode === 'baseline' ? 'NOT PRESENT' : '—'); cls(dec, 'decision');
      set(dec.querySelector('.dec-final'), 'NO COMMANDS YET'); set('dec-t', ''); set(dec.children[1], ''); set(dec.children[2], 'Every uplink command must pass both paths before it executes.'); }
    else { const x = d.data;
      cls(pa, 'gate-path ' + (x.A === 'PASS' ? 'pass' : 'block')); set(pa.children[1], x.A);
      cls(pb, 'gate-path ' + ({ PASS: 'pass', VETO: 'block', HOLD: 'hold', ESCALATE: 'hold' }[x.B] || 'skip')); set(pb.children[1], x.B === 'SKIPPED' ? (S.mode === 'baseline' ? 'NOT PRESENT' : 'NOT REACHED') : x.B);
      cls(dec, 'decision ' + x.final); set(dec.querySelector('.dec-final'), x.final); set('dec-t', met(d.t));
      set(dec.children[1], `${x.issuer} → ${x.verb} ${x.target} ${x.params || ''} · via ${x.route}`); set(dec.children[2], x.reasons.slice(-3).join(' · ')); }
    const c = lastEvent(t, (e) => e.code === 'CONTAIN'), box = $('contain'); box.hidden = !c || t - c.t > 900;
    if (c && !box.hidden) { const el = Math.min(t - c.t, c.data.elapsed); set('contain-t', el.toFixed(1));
      const marks = [0, c.data.isolate, c.data.revoke, c.data.elapsed]; $$('.contain-steps span', box).forEach((s, k) => cls(s, el >= marks[k] ? 'done' : '')); set('contain-node', `${c.data.node} · ${c.data.reason}`); }
    const l = lastEvent(t, (e) => e.code === 'LEDGER' || e.code === 'LEDGER_TAMPER'), ls = $('g-ledger-state');
    set(ls, l ? (l.data.ok ? 'CHAIN VERIFIED' : 'TAMPER AT ENTRY ' + l.data.bad) : 'HASH-CHAINED'); cls(ls, 'chip ' + (l ? (l.data.ok ? 'good' : 'alert') : ''));
  }

  // ---------- event feed ----------
  function feedRow(e) {
    const d = e.data && e.data.final ? e.data : null, chip = d ? d.final : ({ alert: 'alert', warn: 'warn', good: 'good' }[e.level] || '');
    const body = d ? `<span class="fcmd">${esc(d.issuer)} → ${esc(d.verb)} ${esc(d.target)} ${esc(d.params || '')}</span><span class="fwhy">A ${d.A} · B ${d.B === 'SKIPPED' ? '—' : d.B} · via ${esc(d.route)} · ${esc(d.reasons[d.reasons.length - 1] || '')}</span>` : esc(e.text);
    return `<li data-cat="${CAT[e.seg] || 'lab'}"><span class="ft">${(e.t < 0 ? '−' : '') + hms(Math.abs(e.t))}</span><span class="fb"><span class="chip ${chip}">${esc(d ? d.final : nice(e.code))}</span>${body}</span></li>`;
  }
  function panelFeed(t) {
    const ev = D().events, feed = $('feed');
    if (S.feedIdx > 0 && ev[S.feedIdx - 1].t > t) { feed.innerHTML = ''; S.feedIdx = 0; }       // scrubbed backwards
    let html = '';
    while (S.feedIdx < ev.length && ev[S.feedIdx].t <= t) { const e = ev[S.feedIdx++]; if (e.code === 'AOS' || e.code === 'LOS' || e.t < T0 - 600) continue; html = feedRow(e) + html; }
    if (html) { feed.insertAdjacentHTML('afterbegin', html); while (feed.children.length > 90) feed.lastChild.remove(); }
  }

  // ---------- scorecard, stepper, clock, HUD ----------
  function panelScore(t, f) {
    const M = D(), X = M.x, sc = M.scorecard, tiles = [];
    if (!X.atk || t < X.tIntr) tiles.push(['ATTACK CMDS EXECUTED', '—', '']);
    else { const done = t >= X.tAtk1; let n = 0, ex = 0; for (const e of X.atkCmds) { if (e.t > t) break; n++; if (e.data.final === 'EXECUTE') ex++; }
      n = done ? sc.attack_commands : Math.min(n, sc.attack_commands); ex = done ? sc.attack_executed : Math.min(ex, sc.attack_executed); tiles.push(['ATTACK CMDS EXECUTED', `${ex} / ${n}`, ex === 0 ? 'good' : 'bad']); }
    const fr = lastEvent(t, (e) => e.code === 'REPLAY' || e.code === 'FORGED');
    tiles.push(['FORGED / REPLAY ACCEPTED', fr ? sc.forged_or_replayed_accepted : '—', fr ? (sc.forged_or_replayed_accepted === 0 ? 'good' : 'bad') : '']);
    const c = lastEvent(t, (e) => e.code === 'CONTAIN' || e.code === 'NO_CONTAINMENT');
    tiles.push(['CONTAINMENT', !c ? '—' : c.code === 'CONTAIN' ? sc.containment_s + ' s' : 'NONE', !c ? '' : c.code === 'CONTAIN' ? 'good' : 'bad']);
    const lost = f ? f.modules.filter((m) => m.health < 0.5).length : 0;
    tiles.push(['CULTURES LOST', f ? lost : '—', f ? (lost === 0 ? 'good' : 'bad') : '']);
    const html = tiles.map(([l, v, k]) => `<div class="sc ${k}"><span>${l}</span><b>${v}</b></div>`).join('');
    if ($('scorecard').dataset.h !== html) { $('scorecard').innerHTML = html; $('scorecard').dataset.h = html; }
  }
  function phaseAt(t) { const X = D().x; return t < X.tMeco ? 0 : t < X.tTouch ? 1 : t < X.opsStart ? 2 : t < X.tReturn ? 3 : t < X.tEom ? 4 : 5; }
  function panelClock(t) {
    set('met-sign', t < 0 ? 'T−' : 'T+'); set('met', clock(t));
    const c = phaseAt(t); S.phase = PHASES[c];
    $$('#segments li').forEach((li, i) => cls(li, i < c ? 'done' : i === c ? 'now' : ''));
    if (c === 5) { set('mode-pill', 'MISSION COMPLETE'); cls('mode-pill', 'chip good'); }
    set('rate', '×' + (S.rate >= 10 ? Math.round(S.rate) : S.rate.toFixed(1)));
  }
  function hud(t, a, b, c) { if (!document.body.classList.contains('cinema')) return;
    set('hud-sign', t < 0 ? 'T−' : 'T+'); set('hud-met', clock(t)); set('hud-seg', PHASE_LABEL[PHASES[phaseAt(t)]]); set('hud-a', a); set('hud-b', b); set('hud-c2', c); }

  // ---------- tabs ----------
  function setTab(group, name, auto) {
    if (!auto) { S.follow[group] = false; $(group + '-auto').classList.remove('on'); }
    if (S.tab[group] === name && auto) return;
    S.tab[group] = name; const bar = $(group + '-tabs');
    $$('button[data-tab]', bar).forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tabpane', bar.parentElement).forEach((p) => { p.hidden = p.dataset.pane !== name; });
    S.dirty = true; sparkKey = '';
  }
  for (const group of ['left', 'drawer']) {
    $$('button[data-tab]', $(group + '-tabs')).forEach((b) => { b.onclick = () => setTab(group, b.dataset.tab, false); });
    $(group + '-auto').onclick = () => { S.follow[group] = !S.follow[group]; $(group + '-auto').classList.toggle('on', S.follow[group]); S.dirty = true; };
  }
  $('modgrid').onclick = (e) => { const el = e.target.closest('.mod'); if (!el) return; S.sel = +el.dataset.id; setTab('left', 'module', false); };
  $$('#feed-filters button').forEach((b) => { b.onclick = () => { $$('#feed-filters button').forEach((x) => x.classList.toggle('on', x === b)); $('feed').dataset.filter = b.dataset.f; }; });

  // ---------- frame loop ----------
  function frame(dt, now) {
    const t = S.t, M = D(), X = M.x, launch = t < X.opsStart, panels = S.dirty || now - S.lastPanels > 110;
    let f = null;
    if (launch) {
      const L = launchState(t);
      if (panels) { $('panel-launch').hidden = false; $('panel-platform').hidden = true; if (S.follow.drawer) setTab('drawer', 'flight', true);
        if ($('drawer-note').dataset.k !== 'legend') { $('drawer-note').dataset.k = 'legend'; $('drawer-note').innerHTML = '<i class="sw" style="background:var(--s1)"></i>stack / upper stage <i class="sw" style="background:var(--s2);margin-left:10px"></i>booster <span style="margin-left:10px">dashed = planned</span>'; } }
      scene.setPhase('launch');
      // 20 s after touchdown the shot leaves the barge and follows the upper stage to orbit
      scene.updateLaunch(t > X.tTouch + 20 ? { upper: L.upper, sepAtt: L.sepAtt, sepAge: L.sepAge } : L, !!L.upper, dt);
      if (panels) panelLaunch(t, L);
    } else {
      const o = R.opsFrame(M, t); f = o.f; opsStates = o.states;
      const panelsNow = panels || S.dirty, cap = R.reentryAt(M, t);
      if (panelsNow) { $('panel-launch').hidden = true; $('panel-platform').hidden = false; }
      if (cap) { scene.setPhase('return'); scene.updateReturn(cap, dt); }      // entry interface to recovery: true-scale return shot
      else { scene.setPhase('ops'); scene.setSolar(!!lastEvent(t, (e) => e.code === 'SOLAR') && t < X.tSep);
        scene.updateOps(o.view, opsStates, f.gate.isolated || [], dt, { ret: R.returnState(M, t) }); }
      if (panelsNow) panelOps(t, f, o.i, cap);
    }
    $('track-fill').style.width = $('track-head').style.left = (t2x(t) * 100).toFixed(3) + '%';
    if (panels || S.dirty) { panelClock(t); panelSentinel(t); panelFeed(t); panelScore(t, f); S.lastPanels = now; S.dirty = false; }
  }
  function tick(now) {
    const dt = Math.min((now - S.lastWall) / 1000, .25); S.lastWall = now;
    try {
      const target = S.speed === 'auto' ? autoRate(S.t) : S.speed;
      S.rate = S.speed === 'auto' ? S.rate + (target - S.rate) * Math.min(1, dt * 5) : target;
      if (S.playing) { S.t += dt * S.rate; if (S.t >= D().x.tEnd) { S.t = D().x.tEnd; play(false); } }
      frame(dt, now);
    } catch (e) { if (!S.error) { S.error = e; console.error(e); } }
    requestAnimationFrame(tick);
  }

  // ---------- transport ----------
  function play(on) { S.playing = on; set('btn-play', on ? '❚❚' : '▶'); $('btn-play').setAttribute('aria-label', on ? 'Pause' : 'Play'); }
  function seek(t) { S.t = clamp(t, T0, D().x.tEnd); $('feed').innerHTML = ''; S.feedIdx = 0; sparkKey = ''; S.dirty = true; if (S.speed === 'auto') S.rate = autoRate(S.t); }
  function jump(dir) { const m = D().x.marks, i = lastBefore(m, S.t + (dir > 0 ? 0.6 : -0.6)), n = m[i + (dir > 0 ? 1 : 0)]; if (dir > 0 ? n : i >= 0) seek((dir > 0 ? n : m[i]).t - 0.5); else if (dir < 0) seek(T0); }
  async function setMode(m) {
    if (!data[m]) { const b = $('btn-' + m), label = b.textContent; b.textContent = 'LOADING…'; try { data[m] = await load(m); } catch (e) { b.textContent = label; return; } b.textContent = label; }
    S.mode = m; document.body.dataset.mode = m; $('btn-sentinel').classList.toggle('on', m === 'sentinel'); $('btn-baseline').classList.toggle('on', m === 'baseline');
    buildForMode(); seek(S.t);
  }
  $('btn-play').onclick = () => { if (!S.playing && S.t >= D().x.tEnd - 1) seek(T0); play(!S.playing); };
  $('btn-next').onclick = () => jump(1); $('btn-prev').onclick = () => jump(-1);
  $$('#speed button').forEach((b) => { b.onclick = () => { S.speed = b.dataset.speed === 'auto' ? 'auto' : +b.dataset.speed; $$('#speed button').forEach((x) => x.classList.toggle('on', x === b)); }; });
  $('btn-sentinel').onclick = () => setMode('sentinel'); $('btn-baseline').onclick = () => setMode('baseline');
  $('btn-broadcast').onclick = () => { document.body.classList.toggle('broadcast'); $('btn-broadcast').classList.toggle('on'); S.dirty = true; };
  const cinema = (on) => { document.body.classList.toggle('cinema', on); $('hud').hidden = !on; S.dirty = true;
    try { if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* fullscreen API not available: the layout still fills the window */ } };
  $('btn-cinema').onclick = () => cinema(!document.body.classList.contains('cinema'));
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('cinema')) cinema(false); });

  // timeline: click or drag to scrub, hover for the nearest event
  const track = $('track'), tip = $('track-tip');
  const trackT = (e) => { const r = track.getBoundingClientRect(); return [x2t(clamp((e.clientX - r.left) / r.width, 0, 1)), e.clientX - r.left, r.width]; };
  let dragging = false;
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); seek(trackT(e)[0]); });
  track.addEventListener('pointermove', (e) => {
    const [t, x, w] = trackT(e); if (dragging) seek(t);
    let best = null, bd = 9; for (const m of D().x.marks) { const d = Math.abs(t2x(m.t) * w - x); if (d < bd) { bd = d; best = m; } }
    tip.hidden = false; tip.innerHTML = best ? `<b>${met(best.t)}</b>${esc(nice(best.code))} · ${esc(best.text.slice(0, 70))}` : `<b>${met(t)}</b>`;
    const tw = tip.offsetWidth; tip.style.left = clamp(x, tw / 2, w - tw / 2) + 'px';
  });
  const endDrag = () => { dragging = false; }; track.addEventListener('pointerup', endDrag); track.addEventListener('pointercancel', endDrag);
  track.addEventListener('pointerleave', () => { tip.hidden = true; });
  addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); $('btn-play').click(); } else if (e.code === 'ArrowRight') { e.preventDefault(); jump(1); } else if (e.code === 'ArrowLeft') { e.preventDefault(); jump(-1); }
    else if (e.key === 'b' || e.key === 'B') $('btn-broadcast').click(); else if (e.key === 'f' || e.key === 'F') $('btn-cinema').click();
    else if (e.key === 'Escape' && document.body.classList.contains('cinema')) cinema(false); });
  if (window.ResizeObserver) new ResizeObserver(() => { scene._resize(); chartCache = {}; sparkKey = ''; S.dirty = true; }).observe($('center'));
  addEventListener('resize', () => { chartCache = {}; sparkKey = ''; S.dirty = true; });

  buildForMode(); seek(T0);
  document.body.classList.remove('loading');
  requestAnimationFrame((now) => { S.lastWall = now; tick(now); });
  window.__console = { seek, play, setTab, setMode, jump, state: S, data };
  window.seekTo = seek; window.replayState = S;       // kept for the recording scripts
})();
