/* Customer console: one customer's view of the same mission replay, built from that customer's experiment spec
   (experiments/<id>.yaml; pick it with ?c=<id>, default the featured customer) plus task-level control of Dexter-L. Every request is signed and evaluated by Sentinel: POST api/arm_task on the live
   server, or the precomputed cases in api/arm_tasks.json on the static site. The task runs against a lab-operations
   snapshot of the twin, independent of the replay clock. Shares replay.js, scene.js and style.css with the console. */
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
  const R = window.Replay, { T0, lerp, clamp, hms, clock, met, esc, nice, lastBefore } = R;
  const PALETTE = ['#3987e5', '#199e70', '#d95926', '#9085e9', '#c98500', '#e0609b'];   // group colours, in spec order
  const PRES_COL = ['#b9a7ff', '#ffb27a', '#7fd4c0', '#f2d16b'];                         // preserved-well rings, in plan order
  const TASK_LABEL = { transfer_to_lab: 'FETCH TO LAB', image: 'IMAGING PASS', return: 'RETURN TO SLOT', full: 'FULL CYCLE' };
  const S = { t: T0, playing: false, speed: 'auto', rate: 1.5, lastWall: performance.now(), lastPanels: 0, dirty: true, error: null, task: null, acked: false, pending: null };

  let M;
  try { M = await R.load('sentinel', (n, e) => { set('ld-msg', 'Waiting for the mission twin…'); set('ld-sub', 'attempt ' + n + ' · ' + e.message); }); }
  catch (e) { set('ld-msg', 'Could not load the mission data'); set('ld-sub', e.message + ' · reload the page to retry'); return; }
  const X = M.x, ev = M.events, F = M.frames;
  const want = new URLSearchParams(location.search).get('c'), SID = X.exps[want] ? want : X.featured;
  if (!SID) { set('ld-msg', 'No customer experiment in this mission'); set('ld-sub', 'add a spec under experiments/'); return; }
  const E = X.exps[SID], EM = E.meta, FAM = EM.family, CUST = EM.customer, MOD = EM.module;
  const BAND = [EM.culture_c - EM.band_c, EM.culture_c + EM.band_c], NDAYS = Math.round(EM.end_h / 24);
  const GROUPS = EM.groups.map((g) => g.id), GNAME = {}, GCOL = {};
  EM.groups.forEach((g, i) => { GNAME[g.id] = g.label || g.id; GCOL[g.id] = PALETTE[i % PALETTE.length]; });
  const TREAT = Object.values(EM.treatments || {})[0] || null, TNAME = TREAT ? TREAT.name : '';
  const lastEvent = (t, pred) => R.lastEvent(M, t, pred);
  const tOf = (pred) => { const e = ev.find(pred); return e ? e.t : Infinity; };
  const feedT = (t) => (t < 0 ? '−' : '') + clock(Math.abs(t));

  const stub = { setPhase() {}, updateLaunch() {}, updateOps() {}, setSolar() {}, setLandingZone() {}, _resize() {} };
  let scene = stub;
  try { scene = new window.Scene3D($('view3d')); } catch (e) { console.warn('3-D view unavailable:', e); $('gl-note').hidden = false; }
  scene.setLandingZone(X.lz);
  $('view3d').addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('gl-note').hidden = false; });
  $('view3d').addEventListener('webglcontextrestored', () => { $('gl-note').hidden = true; });

  // ---------- what this customer cares about, derived once from its spec and the event stream ----------
  const mine = (e) => e.data && e.data.module === MOD;
  const tLift = tOf((e) => e.code === 'LIFTOFF'), tOrbit = tOf((e) => e.code === 'ORBIT' && e.seg === 'ORBIT');
  const tPrep = tOf((e) => e.code === 'RETURN_PREP'), tStageSep = tOf((e) => e.code === 'STAGE_SEP'), tSplash = tOf((e) => e.code === 'SPLASHDOWN');
  const tHand = tOf((e) => e.code === 'SAMPLE_HANDOVER' && mine(e));
  const tLab = tOf((e) => e.code === 'MODE' && /-> CENTRAL_ANALYSIS/.test(e.text));
  const fin = (v) => (v == null ? Infinity : v);
  const tStart = fin(EM.t_start), tThaw = fin(EM.t_thaw), tTreat = fin(EM.t_treat), tPres = fin(EM.t_preserved);
  const STEPS = (EM.t_steps || []).map((s) => ({ t: fin(s.t), at_h: s.at_h, do: s.do }));
  const tFirst = STEPS.length ? STEPS[0].t : Infinity;
  const day1 = (d) => d.toFixed(1);
  const lsText = (EM.launch_storage && EM.launch_storage.kind === 'cryo') ? 'cells frozen' : 'module stowed';
  const nVials = Object.values(EM.cells || {}).reduce((a, c) => a + (c.cryovials || 1), 0);
  document.title = `${CUST} · LELP-1`;
  { const w = document.querySelector('.who');
    w.querySelector('b').textContent = CUST + (EM.contact_role ? ' · ' + EM.contact_role : '');
    w.querySelector('span').textContent = `${EM.title} · ${EM.summary} · module ${MOD} (${EM.size === 'L' ? 'large' : 'medium'} bay) · requests signed with ML-DSA-87`; }
  $('ctl-module').options[0].value = String(MOD); $('ctl-module').options[0].textContent = `Module ${MOD} · yours · ${CUST}`;
  if (Object.keys(X.exps).length > 1) {                       // switch between the customers that have experiments
    const sel = document.createElement('select'); sel.id = 'cust-switch'; sel.setAttribute('aria-label', 'Customer');
    sel.innerHTML = Object.entries(X.exps).map(([id, x]) => `<option value="${esc(id)}"${id === SID ? ' selected' : ''}>${esc(x.meta.customer)} · module ${x.meta.module}</option>`).join('');
    sel.onchange = () => { location.search = '?c=' + encodeURIComponent(sel.value); };
    document.querySelector('#topbar .actions').prepend(sel); }
  // where the module is on its way home (key times from the twin's whole-payload return model)
  const returnState = (t) => t >= tHand ? 'WITH YOUR COURIER' : t >= X.tRecovery ? 'ON THE RECOVERY SHIP' : t >= tSplash ? 'AFLOAT'
    : t >= X.tMain ? 'UNDER MAIN CANOPY' : t >= X.tEI ? 'RE-ENTRY' : t >= X.tInflate ? 'HEAT SHIELD DEPLOYED' : t >= tStageSep ? 'COASTING TO ENTRY' : 'SECURED FOR RETURN';
  const ACT = { media_full: 'full medium change', media_half: 'medium exchange', treat: TNAME ? TNAME + ' dosing' : 'treatment', topup: (TNAME || 'treatment') + ' top-up', differentiate: 'differentiation medium', preserve: 'preservation' };
  const stepWords = (s) => s.do.filter((a) => a !== 'topup' || !s.do.includes('media_half')).map((a) => ACT[a] || a).join(', ');
  // the flow: the spec's own before-launch and after-flight steps around the flight steps the twin runs
  const treatSteps = STEPS.filter((s) => s.do.includes('treat')), diffSteps = STEPS.filter((s) => s.do.includes('differentiate'));
  const nTreated = EM.groups.filter((g) => g.treatment).length;
  const FLOW = [
    ...((EM.flow && EM.flow.before_launch) || []).map((f) => ({ label: f.label, full: f.full || f.label, pre: true })),
    { label: 'Launch · ' + lsText, full: 'Launch: ' + ((EM.launch_storage && EM.launch_storage.text) || 'the module rides to orbit stowed'), a: tLift, b: tOrbit, now: () => 'riding to orbit' },
    { label: `Automated thaw · ${EM.culture_c.toFixed(0)} °C`, full: `Automated thawing of ${nVials} cryovials, then recovery at ${EM.culture_c.toFixed(1)} °C`, a: tStart, b: tFirst,
      now: (t, x) => x && x.phase === 'thawing' ? 'thawing' : 'day ' + day1(x ? x.day : 0) },
    { label: 'Culture · automated media', full: 'Cell culture with automated media exchange: ' + STEPS.filter((s) => !s.do.includes('preserve')).map((s) => `day ${(s.at_h / 24).toFixed(0)} ${stepWords(s)}`).join('; '), a: tThaw, b: tPres, now: (t, x) => 'day ' + day1(x.day) },
    ...diffSteps.map((s) => ({ label: 'Differentiation medium', full: `Day ${(s.at_h / 24).toFixed(0)}: switch to differentiation medium`, a: s.t, b: s.t })),
    ...treatSteps.map((s) => ({ label: `${TNAME ? TNAME[0].toUpperCase() + TNAME.slice(1) : 'Treatment'} · ${nTreated} treated group${nTreated === 1 ? '' : 's'}`,
      full: `Day ${(s.at_h / 24).toFixed(0)}: ${TNAME || 'treatment'} added automatically to ${EM.groups.filter((g) => g.treatment).map((g) => g.label).join(' and ')}` + (TREAT && TREAT.dose ? ` at ${TREAT.dose}` : ''), a: s.t, b: s.t })),
    { label: `Live imaging · ${EM.imaging.instrument}`, full: `Live-cell imaging every ${EM.imaging.every_h} h: ${(EM.imaging.channels || []).join(', ')}`, a: tThaw, b: tPres, now: (t, x) => 'round ' + x.rounds },
    { label: 'Radiation · environment', full: 'Radiation and environmental monitoring: dosimeter, temperature and environment data throughout', a: tStart, b: tPres, now: (t, x) => x.dose.toFixed(2) + ' mGy' },
    { label: 'End · samples preserved', full: `End of experiment (day ${NDAYS}): samples preserved and all data collected`, a: tPres, b: tPres },
    { label: 'Return · inflatable shield', full: 'The whole lab returns under the inflatable heat shield', a: tPrep, b: X.tRecovery, now: (t) => returnState(t).toLowerCase() },
    { label: 'Handed to your courier', full: `Module ${MOD} handed to the ${CUST} courier at ${EM.transport_c.toFixed(0)} °C with its custody ledger`, a: tHand, b: tHand },
    ...((EM.flow && EM.flow.after_flight) || []).map((f) => ({ label: f.label, full: f.full || f.label, post: true })),
  ];
  const JOURNEY = [['LAUNCH', tLift], ['THAW', tThaw], ...(isFinite(tTreat) ? [[(TNAME || 'treatment').toUpperCase(), tTreat]] : []), ['DAY ' + NDAYS, tPres], ['RE-ENTRY', X.tEI], ['HANDOVER', tHand], ['LAB', Infinity], ['RESULT', Infinity]];
  const RETURN = ev.filter((e) => ['RETURN_PREP', 'DEORBIT_BURN', 'STAGE_SEP', 'HIAD_INFLATE', 'ENTRY_INTERFACE', 'PEAK_HEATING', 'MAIN_CHUTE', 'SPLASHDOWN', 'RECOVERY'].includes(e.code) || (e.code === 'SAMPLE_HANDOVER' && mine(e)));
  const AUDIT = ev.filter((e) => e.data && e.data.final && (e.data.target === 'module-' + MOD || e.data.target === 'arm' || (e.data.target === 'platform' && /mode|return_prep|deorbit|passivate|key/.test(e.data.verb))));
  const reDeliv = new RegExp('Module ' + MOD + '\\b|' + CUST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const DELIV = ev.filter((e) => e.code === 'DELIVERED' && reDeliv.test(e.text));
  const ATTACKS = X.atkCmds.filter((e) => e.data.target === 'module-' + MOD);
  const MARKS = ev.filter((e) => e.t >= T0 && ((e.seg === 'CUSTOMER' && (!e.data || !e.data.module || mine(e))) || e.seg === 'RETURN' || (e.data && e.data.target === 'module-' + MOD) || ['LIFTOFF', 'TOUCHDOWN', 'INTRUSION', 'CONTAIN'].includes(e.code) || (e.code === 'ORBIT' && e.seg === 'ORBIT')));
  // preserved-well rings: "N wells <how>" entries of the preservation plan, in order
  const PLAN = []; (EM.preservation || []).forEach((p) => { const m = /^(\d+)\s+wells?\s+(.*)$/.exec(p.sample); if (m) PLAN.push({ n: +m[1], how: m[2] }); });
  const ringOf = (k) => { let i = 0; for (const [j, p] of PLAN.entries()) { if (k < i + p.n) return j; i += p.n; } return -1; };

  $('steps').innerHTML = FLOW.map((s) => `<li class="${s.pre ? 'done' : ''}" title="${esc(s.full)}"><i></i><span>${esc(s.label)}</span><span class="st">${s.pre ? 'before launch' : s.post ? 'after the flight' : '—'}</span></li>`).join('');
  $('journey').innerHTML = JOURNEY.map(([label]) => `<li>${esc(label)}</li>`).join('');
  $('return').innerHTML = RETURN.map((e) => `<div><span class="ft">${feedT(e.t)}</span><span>${esc(e.text)}</span></div>`).join('');
  const lastRow = E.rows[E.rows.length - 1];
  $('after').innerHTML = '<tr><th>SAMPLE · EACH GROUP</th><th>MEASURED</th></tr>' + [{ sample: `${EM.imaging.instrument} archive, ${lastRow[E.ix.rounds]} rounds`, measures: `${FAM.metrics.map((m) => m.name).join(', ')} over ${NDAYS} days` }].concat(EM.preservation || [])
    .map((p) => `<tr><td>${esc(p.sample)}</td><td>${esc(String(p.measures).replace(/alpha/g, 'α'))}</td></tr>`).join('');
  document.querySelector('.note.compare').innerHTML = `<b>Compare</b> ${esc(EM.compare || '')}<br><b>Result</b> ${esc(EM.result || '')} It comes from the lab analysis, not from the twin.`;
  set('scn-note', EM.scenario_note || '');
  set('chart-title', FAM.chart.title); set('img-title', `${String(EM.imaging.instrument).toUpperCase()} · ${GROUPS.length * EM.wells_per_group} WELLS`);
  set('e-img', `every ${EM.imaging.every_h} h`); set('e-clock', EM.protocol_x === 1 ? 'real time' : '×' + EM.protocol_x);
  set('e-cryo-l', `CRYO CASSETTE · ${nVials} cryovials` + (TNAME ? `, then the ${TNAME} aliquots` : ''));
  $('well-legend').innerHTML = '<span>fill = cell cover · colour = group</span>' + PLAN.map((p, k) => `<span><i style="background:${PRES_COL[k % PRES_COL.length]}"></i>${esc(p.how)}</span>`).join('');
  $('track-bands').innerHTML = X.bands.map(([a, b, label, c]) => { const x0 = R.t2x(M, a) * 100, x1 = R.t2x(M, b) * 100; return `<span class="${c}" style="left:${x0.toFixed(2)}%;width:${(x1 - x0).toFixed(2)}%">${label}</span>`; }).join('');
  $('track-marks').innerHTML = MARKS.map((e) => `<i class="${e.level}" style="left:${(R.t2x(M, e.t) * 100).toFixed(2)}%"></i>`).join('');
  $('track-days').innerHTML = (X.days || []).map((d) => { const x = (R.t2x(M, d.t) * 100).toFixed(2); return `<i style="left:${x}%"></i><b style="left:${x}%">${d.label}</b>`; }).join('');

  // ---------- charts ----------
  const size = (svg) => { const r = svg.getBoundingClientRect(); return [Math.max(140, Math.round(r.width)), Math.max(40, Math.round(r.height))]; };
  let chartKey = '', rosKey = '', rateKey = '', wellKey = '';
  const atTransport = (fi) => F[fi].t >= tPres;                     // preserved samples are held at the transport temperature
  function drawTemp(fi, returning) {
    const key = fi + ':' + $('chart-t').clientWidth; if (key === chartKey) return; chartKey = key;
    const i0 = Math.max(0, lastBefore(F, F[fi].t - R.DAY)), stride = Math.max(1, Math.round((fi - i0) / 160)), win = [];   // the last 24 h
    for (let i = i0; i <= fi; i += stride) win.push(F[i].modules[MOD - 1]); win.push(F[fi].modules[MOD - 1]);
    const tc = EM.transport_c, svg = $('chart-t'), [W, H] = size(svg), l = 30, r = 8, tp = 7, b = 7, lo = 0, hi = 42, band = returning || atTransport(fi) ? [tc - 0.5, tc + 0.5] : BAND;
    const px = (k) => l + k / Math.max(win.length - 1, 1) * (W - l - r), py = (v) => H - b - (clamp(v, lo, hi) - lo) / (hi - lo) * (H - tp - b);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<rect x="${l}" y="${py(band[1])}" width="${W - l - r}" height="${py(band[0]) - py(band[1])}" fill="rgba(12,163,12,.16)"/>` +
      [tc, 20, EM.culture_c].map((v) => `<line x1="${l}" x2="${W - r}" y1="${py(v)}" y2="${py(v)}" class="grid"/><text x="${l - 5}" y="${py(v) + 3.5}" text-anchor="end" class="tick">${Math.round(v)}</text>`).join('') +
      `<polyline fill="none" stroke="#3987e5" stroke-width="2" stroke-linejoin="round" points="${win.map((m, k) => px(k).toFixed(1) + ',' + py(m.t).toFixed(1)).join(' ')}"/>` +
      `<circle cx="${px(win.length - 1)}" cy="${py(win[win.length - 1].t)}" r="3.5" fill="#3987e5" stroke="#1d1f21" stroke-width="2"/>`;
  }
  const CH = FAM.chart, SER = { day: E.rows.map((r) => r[E.ix.day]), s: {} };
  for (const g of GROUPS) for (const e of ['flight', 'ground']) SER.s[g + '|' + e] = E.rows.map((r) => r[E.ix[g + '|' + e + '|' + CH.key]]);
  const iThaw = Math.max(0, E.rows.findIndex((r) => r.t >= tThaw));
  function drawRos(t) {
    const svg = $('chart-ros'); if (!svg.clientWidth) return;
    const i = lastBefore(E.rows, t), key = i + ':' + svg.clientWidth; if (key === rosKey) return; rosKey = key;
    const [W, H] = size(svg), l = 30, r = 8, tp = 8, b = 16, [lo, hi] = CH.range;
    const px = (d) => l + d / NDAYS * (W - l - r), py = (v) => H - b - (clamp(v, lo, hi) - lo) / (hi - lo) * (H - tp - b);
    let g = CH.ticks.map((v) => `<line x1="${l}" x2="${W - r}" y1="${py(v)}" y2="${py(v)}" class="grid"/><text x="${l - 5}" y="${py(v) + 3.5}" text-anchor="end" class="tick">${v}</text>`).join('')
      + Array.from({ length: NDAYS + 1 }, (_, d) => `<text x="${px(d).toFixed(1)}" y="${H - 3}" text-anchor="middle" class="tick">${d}</text>`).join('');
    if (EM.treat_h != null) { const d = EM.treat_h / 24; g += `<line x1="${px(d)}" x2="${px(d)}" y1="${tp}" y2="${H - b}" class="guide"/><text x="${px(d) + 3}" y="${tp + 8}" class="tick">${esc((TNAME || 'dose').split(' ')[0].slice(0, 8))}</text>`; }
    if (t >= tThaw && i > iThaw) for (const e of ['ground', 'flight']) for (const gr of GROUPS) {
      const pts = []; for (let k = iThaw; k <= i; k++) pts.push(px(SER.day[k]).toFixed(1) + ',' + py(SER.s[gr + '|' + e][k]).toFixed(1));
      g += `<polyline fill="none" stroke="${GCOL[gr]}" stroke-width="${e === 'flight' ? 1.8 : 1.2}" stroke-linejoin="round"${e === 'ground' ? ' stroke-dasharray="3 3" stroke-opacity=".6"' : ''} points="${pts.join(' ')}"/>`; }
    else g += `<text x="${(l + W - r) / 2}" y="${H / 2}" text-anchor="middle" class="tick">starts at the thaw</text>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
  }
  function drawRate(t) {
    const svg = $('chart-rate'), rr = E.rate; if (!rr || !svg.clientWidth) return;
    const n = Math.round(R.DAY / rr.dt), j = rr.t0 == null ? -1 : Math.min(Math.floor((t - rr.t0) / rr.dt), rr.v.length - 1), key = j + ':' + svg.clientWidth; if (key === rateKey) return; rateKey = key;
    const [W, H] = size(svg), l = 34, r = 8, tp = 7, b = 7, hi = Math.log10(3000);
    const px = (k) => l + (k - (j - n)) / n * (W - l - r), py = (v) => H - b - Math.log10(Math.max(v, 1)) / hi * (H - tp - b);
    let g = [1, 10, 100, 1000].map((v) => `<line x1="${l}" x2="${W - r}" y1="${py(v)}" y2="${py(v)}" class="grid"/><text x="${l - 5}" y="${py(v) + 3.5}" text-anchor="end" class="tick">${v >= 1000 ? '1k' : v}</text>`).join('');
    if (j >= 1) { const pts = []; for (let k = Math.max(0, j - n); k <= j; k++) pts.push(px(k).toFixed(1) + ',' + py(rr.v[k]).toFixed(1));
      g += `<polyline fill="none" stroke="#c98500" stroke-width="1.6" stroke-linejoin="round" points="${pts.join(' ')}"/>`; }
    else g += `<text x="${(l + W - r) / 2}" y="${H / 2}" text-anchor="middle" class="tick">dosimeter log starts at the thaw</text>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
  }
  function drawWells(x) {
    const svg = $('vials'); if (!svg.clientWidth) return;
    const key = (x ? x.phase + ':' + Math.round(x.day * 6) : 'none') + ':' + svg.clientWidth; if (key === wellKey) return; wellKey = key;
    const [W, H] = size(svg), lw = 84, cols = EM.wells_per_group, rows = GROUPS.length, cw = (W - lw) / cols, ch = H / rows, rad = Math.min(cw, ch) * .40, pres = x && x.phase === 'preserved';
    const cover = FAM.cover, via = FAM.viability;
    let g = '';
    GROUPS.forEach((gr, ri) => { const cy = (ri + .5) * ch, f = x && x.g[gr] ? x.g[gr].flight : null, live = f && x.phase !== 'cryo' && x.phase !== 'thawing';
      g += `<text x="2" y="${(cy + 3.5).toFixed(1)}" class="tick" fill="${GCOL[gr]}">${esc(GNAME[gr])}</text>`;
      for (let k = 0; k < cols; k++) { const cx = lw + (k + .5) * cw, v = 1 + .07 * Math.sin((ri * cols + k) * 12.9898 + 4.1), ring = pres ? ringOf(k) : -1;
        g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="#151617" stroke="${ring >= 0 ? PRES_COL[ring % PRES_COL.length] : '#3d4145'}" stroke-width="${ring >= 0 ? 2 : 1}"/>`;
        if (live) g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(Math.sqrt(clamp(f[cover] * v, 0.02, 1)) * rad * .9).toFixed(1)}" fill="${GCOL[gr]}" fill-opacity="${(.2 + .65 * f[via]).toFixed(2)}"/>`; } });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
    set('img-cap', !x || x.phase === 'cryo' ? 'cells still cryopreserved' : x.phase === 'thawing' ? 'thawing' : pres ? `preserved · ${x.rounds} rounds` : `round ${x.rounds} · day ${day1(x.day)}`);
  }

  // ---------- panels ----------
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const fmt = (mt, v) => mt.fmt === 'pct' ? String(Math.round(v * 100)) : mt.fmt === 'x2' ? v.toFixed(2) : v.toFixed(1);
  const cryoText = (t, x) => { const c = x ? x.cryo_c : ((EM.launch_storage && EM.launch_storage.temp_c) || -80) + 0.15 * (Math.max(t, 0) / 3600 + 24);
    return !x || t < (isFinite(tTreat) ? tTreat : tThaw) ? c.toFixed(1) + ' °C' : 'empty'; };
  const nextStep = (x) => { const s = STEPS.find((q) => q.at_h / 24 > x.day + 1e-6); return s ? `next: ${stepWords(s)}, day ${(s.at_h / 24).toFixed(0)}` : ''; };
  function stateChip(t, m, x) {
    if (t >= tPrep) return [returnState(t), t >= tHand ? 'good' : 'info'];
    if (t < 0) return ['ON THE PAD · FROZEN', ''];
    if (!m) return [t < X.tSeco ? 'RIDING TO ORBIT' : 'IN ORBIT · FROZEN', ''];
    if (m.state === 'isolated') return ['ISOLATED', 'bad'];
    if (!x || x.phase === 'cryo') return [m.state === 'stowed' ? 'CRYOPRESERVED' : `FROZEN · BLOCK AT ${EM.culture_c.toFixed(0)} °C`, 'info'];
    if (x.phase === 'thawing') return ['THAWING', 'info'];
    if (x.phase === 'preserved') return ['SAMPLES PRESERVED', EM.preserved_by && EM.preserved_by !== CUST ? 'bad' : 'good'];
    const d = 'DAY ' + Math.floor(x.day);
    if (m.state === 'in_transfer') return [d + ' · WITH THE ARM', 'info'];
    if (m.state === 'in_lab') return [d + ' · IN THE LAB', 'info'];
    return [(x.phase === 'recovery' ? 'RECOVERY' : 'CULTURE') + ' · ' + d, 'good'];
  }
  $('m-day-unit').textContent = 'of ' + NDAYS;
  let auditN = -1, delivN = -1;
  function panels(t, f, fi) {
    set('met-sign', t < 0 ? 'T−' : 'T+'); set('met', clock(t)); set('rate', '×' + (S.rate >= 10 ? Math.round(S.rate) : S.rate.toFixed(1)));
    const phase = t < 0 ? 'PRE-LAUNCH' : t < X.tSeco ? 'LAUNCH' : t < X.opsStart ? 'IN ORBIT' : t >= tHand ? 'COMPLETE' : t >= tSplash ? 'RECOVERY' : t >= X.tEI ? 'RE-ENTRY' : t >= tPrep ? 'RETURNING' : nice(f.platform.mode);
    set('phase-pill', phase); cls('phase-pill', 'chip ' + (t >= tHand ? 'good' : 'info'));
    const m = f ? f.modules[MOD - 1] : null, x = R.expAt(M, t, SID), returning = t >= tPrep, live = x && (x.phase === 'recovery' || x.phase === 'culture' || x.phase === 'preserved');
    const [chip, chipCls] = stateChip(t, m, x); set('m-state', chip); cls('m-state', 'chip push ' + chipCls);
    const tc = EM.transport_c, cc = EM.culture_c, bandTxt = `${cc.toFixed(1)} ± ${EM.band_c}`;
    if (m) {   // the module stays in the lab twin all the way home: live block temperature throughout
      set('m-t', m.t.toFixed(2));
      const inBand = m.t >= BAND[0] && m.t <= BAND[1], atT = Math.abs(m.t - tc) <= 0.5;
      const sub = returning ? (atT ? `transport mode ${tc.toFixed(0)} °C · whole lab returning` : `cooling to ${tc.toFixed(0)} °C transport mode`)
        : x && x.phase === 'preserved' ? (atT ? `preserved samples held at ${tc.toFixed(0)} °C` : `preserved samples cooling to ${tc.toFixed(0)} °C`)
        : m.state === 'stowed' ? 'module not powered yet'
        : !x || x.phase === 'cryo' ? (inBand ? `pre-warmed for the thaw · ${bandTxt}` : `warming to ${cc.toFixed(1)} for the thaw`)
        : inBand ? `inside protocol ${bandTxt}` : m.t > BAND[1] ? `ABOVE protocol ${bandTxt}` : `below protocol ${bandTxt}`;
      set('m-t-sub', sub); cls('m-t-sub', 'hero-sub ' + (/ABOVE|below/.test(sub) ? 'bad' : (inBand || atT) && m.state !== 'stowed' ? 'ok' : ''));
      set('m-seal', m.sealed ? 'SEALED' : 'BREACH'); cls('m-seal', m.sealed ? '' : 'bad');
    } else { ['m-t', 'm-seal'].forEach((id) => set(id, '—')); set('m-t-sub', `protocol ${bandTxt} once in orbit`); cls('m-t-sub', 'hero-sub'); }
    const presDay = EM.t_preserved != null ? E.rows[Math.max(0, lastBefore(E.rows, EM.t_preserved + 61))][E.ix.day] : NDAYS;
    set('m-day', !x || x.phase === 'cryo' ? '—' : day1(x.day));
    set('m-day-sub', !x || x.phase === 'cryo' ? 'starts when you sign the thaw' : x.phase === 'thawing' ? `thawing in the ${cc.toFixed(0)} °C block`
      : x.phase === 'preserved' ? `preserved on day ${day1(presDay)}` + (EM.preserved_by && EM.preserved_by !== CUST ? ' by ' + EM.preserved_by : '')
      : nextStep(x) || `preservation at day ${NDAYS}`);
    const via = live && FAM.viability ? Math.round(mean(GROUPS.map((g) => x.g[g].flight[FAM.viability])) * 100) : null;
    set('m-h', via == null ? '—' : via + ' %'); set('m-dose', x && x.phase !== 'cryo' ? x.dose.toFixed(2) + ' mGy' : '—'); set('m-cryo', cryoText(t, x));
    if (f) drawTemp(fi, returning);
    // flow, journey, return
    FLOW.forEach((s, k) => { if (s.pre) return; const li = $('steps').children[k];
      if (s.post) { cls(li, t >= tHand && k === FLOW.findIndex((q) => q.post) ? 'now' : ''); return; }
      const done = t >= s.b, now = !done && t >= s.a; cls(li, done ? 'done' : now ? 'now' : '');
      set(li.lastElementChild, done ? feedT(s.b) : now ? (s.now ? s.now(t, x) : 'in progress') : '—'); });
    const clk = EM.protocol_x === 1 ? 'real time' : `protocol clock ×${EM.protocol_x}`;
    set('flow-sub', x && x.phase !== 'cryo' ? `${clk} · day ${day1(x.day)} of ${NDAYS}` : clk);
    JOURNEY.forEach(([, tj], k) => cls($('journey').children[k], t >= tj ? 'done' : (k === 0 || t >= JOURNEY[k - 1][1]) ? 'now' : ''));
    RETURN.forEach((e, k) => cls($('return').children[k], t >= e.t ? 'done' : ''));
    // cells
    set('c-rounds', x ? x.rounds : 0); set('c-frames', x ? (x.rounds * (EM.imaging.frames_per_round || 0)).toLocaleString('en-US') : 0); set('c-mb', (x ? x.down_mb : 0).toFixed(1) + ' MB');
    const gk = live ? GROUPS.map((g) => ['flight', 'ground'].map((e) => FAM.metrics.map((mt) => fmt(mt, x.g[g][e][mt.key])).join(',')).join('/')).join(';') : 'none';
    if ($('groups').dataset.k !== gk) { $('groups').dataset.k = gk;
      const cell = (a, b) => `<td class="num"><b>${a}</b><small>${b}</small></td>`;
      $('groups').innerHTML = '<tr><th>GROUP</th>' + FAM.metrics.map((mt) => `<th class="num">${esc(mt.label)}</th>`).join('') + '</tr>' + GROUPS.map((g) => {
        const name = `<td><i class="sw" style="background:${GCOL[g]}"></i>${esc(GNAME[g])}</td>`;
        if (!live) return `<tr>${name}${FAM.metrics.map(() => cell('—', '')).join('')}</tr>`;
        return `<tr>${name}${FAM.metrics.map((mt) => cell(fmt(mt, x.g[g].flight[mt.key]), fmt(mt, x.g[g].ground[mt.key]))).join('')}</tr>`; }).join(''); }
    drawRos(t); drawWells(x);
    const del = DELIV.filter((e) => e.t <= t);
    if (del.length !== delivN) { delivN = del.length; $('deliveries').innerHTML = del.length ? del.slice().reverse().map((e) => `<li><span class="ft">${feedT(e.t)}</span><span>${esc(e.text)}</span></li>`).join('') : '<li><span class="ft">—</span><span>Nothing delivered yet. Per-well metrics come down once a protocol day.</span></li>'; }
    // environment
    set('e-dose', x && x.phase !== 'cryo' ? x.dose.toFixed(2) + ' mGy' : '—'); set('e-saa', x && x.phase !== 'cryo' ? String(x.passes) : '—');
    set('e-rate', x && x.rate != null ? Math.round(x.rate) + (x.rate > 80 ? ' · SAA' : '') : '—'); cls('e-rate', x && x.rate > 80 ? 'warn' : '');
    set('e-t', m ? m.t.toFixed(2) + ' °C' : '—'); set('e-cryo', cryoText(t, x)); set('e-p', m ? m.p + ' kPa' : '—'); set('e-seal', m ? (m.sealed ? 'SEALED' : 'BREACH') : '—');
    set('e-ug', !f ? '—' : t >= tStageSep ? 'returning' : m && m.state === 'in_transfer' ? '≈ 10⁻³ g · arm transfer' : f.platform.arm.busy ? '≈ 10⁻⁴ g · arm moving' : '≈ 10⁻⁵ g · quiet');
    drawRate(t);
    // audit
    const au = AUDIT.filter((e) => e.t <= t);
    if (au.length !== auditN) { auditN = au.length;
      $('audit').innerHTML = au.slice().reverse().map((e) => `<li><span class="ft">${feedT(e.t)}</span><span><span class="chip ${e.data.final}">${e.data.final}</span><span class="fcmd">${esc(e.data.issuer)} → ${esc(e.data.verb)} ${esc(e.data.target)} ${esc(e.data.params || '')}</span><span class="why">via ${esc(e.data.route)} · ${esc(e.data.reasons.slice(-2).join(' · '))}</span></span></li>`).join('');
      set('a-ok', au.filter((e) => e.data.final === 'EXECUTE').length); set('a-bad', au.filter((e) => e.data.final !== 'EXECUTE').length); }
    const led = lastEvent(t, (e) => e.code === 'LEDGER' || e.code === 'LEDGER_TAMPER');
    set('a-ledger', led ? (led.data.ok ? 'VERIFIED' : 'TAMPER') : 'CHAINED');
    // scorecard
    let n = 0, blocked = 0; for (const e of ATTACKS) { if (e.t > t) break; n++; if (e.data.final !== 'EXECUTE') blocked++; }
    const tiles = [['ATTACKS ON YOUR MODULE', t < X.tIntr ? '—' : n ? `${blocked} / ${n} BLOCKED` : 'NONE', t < X.tIntr || !n ? '' : blocked === n ? 'good' : 'bad'],
      ['FLIGHT VIABILITY', via == null ? '—' : via + ' %', via == null ? '' : via > 80 ? 'good' : 'bad'],
      ['CUSTODY LEDGER', led ? (led.data.ok ? 'VERIFIED' : 'TAMPER CAUGHT') : 'HASH-CHAINED', led ? (led.data.ok ? 'good' : 'bad') : ''],
      ['MODULE RETURN', t >= tHand ? 'HANDED OVER' : t >= tPrep ? returnState(t).replace('COASTING TO ENTRY', 'COASTING').replace('HEAT SHIELD DEPLOYED', 'SHIELD DEPLOYED').replace('SECURED FOR RETURN', 'SECURED') : 'PENDING', t >= tHand ? 'good' : '']];
    const html = tiles.map(([l, v, k]) => `<div class="sc ${k}"><span>${l}</span><b>${v}</b></div>`).join('');
    if ($('scorecard').dataset.h !== html) { $('scorecard').innerHTML = html; $('scorecard').dataset.h = html; }
    if (!S.task) { const cap = lastEvent(t, (e) => (e.seg === 'CUSTOMER' && (!e.data || !e.data.module || mine(e))) || e.seg === 'RETURN' || e.seg === 'LAUNCH' || e.seg === 'ORBIT' || (e.data && e.data.target === 'module-' + MOD) || (e.code === 'ARM' && new RegExp('module ' + MOD + '\\b', 'i').test(e.text)));
      set('overlay-caption', cap ? `${nice(cap.code)} · ${cap.text}` : 'Your cells are on the pad inside LELP-1, cryopreserved'); }
  }

  // ---------- Dexter-L tasking through Sentinel ----------
  let staticTasks = null, live = !/\.html$/.test(location.pathname);      // the exported static site has no tasking endpoint
  async function ask(module, task, ack, abort) {
    if (live) try { const r = await fetch('api/arm_task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer: CUST, module, task, ack, abort }) }); if (r.ok) return await r.json(); live = false; } catch (e) { live = false; /* fall through to the precomputed cases */ }
    if (!staticTasks) { try { staticTasks = await (await fetch('api/arm_tasks.json')).json(); } catch (e) { return { error: 'no live server and no precomputed cases' }; } }
    const key = abort ? `${CUST}:${module}:abort:1` : `${CUST}:${module}:${task}:${ack ? 1 : 0}`;
    return staticTasks[key] || staticTasks[`${CUST}:${module}:transfer_to_lab:1`] || { error: 'case not precomputed: ' + key };
  }
  function showVerdict(res, task) {
    const d = res.decision || { final: 'ERROR', A: '—', B: '—', reasons: [res.error || 'no response'] };
    cls('verdict', 'verdict ' + d.final); set('v-final', d.final + (res.abort ? ' · ABORT' : task ? ' · ' + (TASK_LABEL[task] || task) : ''));
    set('v-paths', `A ${d.A} · B ${d.B === 'SKIPPED' ? 'not reached' : d.B}${res.signature_bytes ? ' · ML-DSA-87 ' + res.signature_bytes + ' B' : ''}`);
    set('v-why', (d.reasons || []).slice(-3).join(' · ')); $('v-ack').hidden = d.final !== 'ESCALATED';
  }
  function baseFrame() { const t = S.t >= X.opsStart && S.t < tPrep ? Math.max(S.t, isFinite(tLab) ? tLab + 30 : S.t) : (isFinite(tLab) ? tLab + 30 : X.opsStart + 600); return R.opsFrame(M, t); }
  function startTask(res) {
    const tr = res.trace || []; if (!tr.length) return;
    play(false); S.task = { res, tr, t: 0, end: tr[tr.length - 1].t, hold: 0, base: baseFrame(), aborted: false };
    $('live-chip').hidden = false; set('al-log', ''); S.dirty = true;
  }
  function endTask(msg) { S.task = null; $('live-chip').hidden = true; if (msg) set('al-step', msg); S.dirty = true; }
  function stepTask(dt) {
    const k = S.task, tr = k.tr;
    if (!k.aborted) k.t = Math.min(k.t + dt * 20, k.end);                       // 20x: a full cycle (~11 min) plays in about half a minute
    const i = Math.max(lastBefore(tr, k.t), 0), a = tr[i], b = tr[i + 1] || a, u = b.t > a.t ? clamp((k.t - a.t) / (b.t - a.t), 0, 1) : 0;
    const ringA = a.ring_deg || 0, dr = (((b.ring_deg || 0) - ringA + 540) % 360) - 180;
    const arm = { busy: true, module: MOD, step: a.step, joints: a.joints.map((v, j) => lerp(v, b.joints[j], u)), ring_deg: ringA + dr * u, grip: a.grip, umbilical: a.umbilical, torques: a.torques };
    const base = k.base, states = base.states.slice(); states[MOD - 1] = a.module_state === 'in_transfer' || a.module_state === 'in_lab' ? 'move' : 'good';
    scene.setPhase('ops'); scene.setSolar(true);
    scene.updateOps({ t: base.f.t, modules: base.f.modules, comms: base.f.comms, gate: base.f.gate, platform: Object.assign({}, base.f.platform, { arm }) }, states, [], dt, { cam: 'arm' });
    set('al-step', k.aborted ? 'ABORTED · arm holding position, brakes on' : `${nice(a.step)} · ${Math.round(a.step_t)} / ${a.step_dur} s`); set('al-t', Math.round(k.t) + ' / ' + Math.round(k.end) + ' s');
    $('al-prog').style.width = (k.end ? k.t / k.end * 100 : 0) + '%';
    set('al-grip', a.grip ? 'LATCHED' : 'OPEN'); set('al-umb', a.umbilical ? 'MATED · 28 V' : 'OFF'); set('al-temp', a.module_t.toFixed(2) + ' °C'); set('al-ft', a.ft_n + ' N');
    const log = (k.res.events || []).filter((e) => e.t <= k.t).pop(); if (log) set('al-log', `${Math.round(log.t)} s · ${log.text}`);
    set('overlay-caption', `YOUR TASK · ${TASK_LABEL[k.res.task] || k.res.task} · ${nice(a.step)}`);
    if (!k.aborted && k.t >= k.end) { k.hold += dt; if (k.hold > 2.5) endTask('Task complete · arm stowed, module on its own power'); }
  }
  async function submit(task, ack) {
    const module = +$('ctl-module').value; S.busyAsk = true; $$('.tasks .btn').forEach((b) => { b.disabled = true; });
    const res = await ask(module, task, ack || S.acked, false);
    S.busyAsk = false; $$('.tasks .btn').forEach((b) => { b.disabled = false; });
    const fin = res.decision && res.decision.final; S.pending = fin === 'ESCALATED' ? task : null; showVerdict(res, task);
    if (fin === 'EXECUTE') { if (ack) S.acked = true; startTask(res); }
  }
  $$('.tasks .btn[data-task]').forEach((b) => { b.onclick = () => submit(b.dataset.task, false); });
  $('ctl-ack').onclick = () => { if (S.pending) submit(S.pending, true); };
  $('ctl-abort').onclick = async () => { const res = await ask(+$('ctl-module').value, 'full', true, true); showVerdict(res, null); if (S.task) { S.task.aborted = true; setTimeout(() => { if (S.task && S.task.aborted) endTask('ABORTED · arm holding position, brakes on'); }, 4000); } };

  // ---------- frame loop ----------
  function frame(dt, now) {
    const t = S.t, launch = t < X.opsStart, doPanels = S.dirty || now - S.lastPanels > 120;
    let f = null, fi = -1;
    const cap = launch ? null : R.reentryAt(M, t);
    if (!launch) { const o = R.opsFrame(M, t); f = o.f; fi = o.i;
      if (!S.task && cap) { scene.setPhase('return'); scene.updateReturn(cap, dt); }
      else if (!S.task) { scene.setPhase('ops'); scene.setSolar(!!lastEvent(t, (e) => e.code === 'SOLAR') && t < X.tSep);
        const xs = R.expStates(M, t), me = xs.find((x) => x.id === SID);
        scene.updateOps(o.view, o.states, f.gate.isolated || [], dt, { ret: R.returnState(M, t), cam: 'arm', exps: xs, saa: !!(me && me.saa),
          focusModule: me && me.glow ? MOD : null, dtm: S.playing ? dt * S.rate : 0 }); } }
    else if (!S.task) { const L = R.launchState(M, t); scene.setPhase('launch'); scene.updateLaunch(t > X.tTouch + 20 ? { upper: L.upper, sepAtt: L.sepAtt, sepAge: L.sepAge } : L, !!L.upper, dt); }
    if (doPanels) { $('ret-readout').hidden = !cap || !!S.task; if (cap && !S.task) set('ret-readout', R.reentryReadout(cap)); }
    if (S.task) stepTask(dt);
    $('track-fill').style.width = $('track-head').style.left = (R.t2x(M, t) * 100).toFixed(3) + '%';
    if (doPanels) { panels(t, f, fi); S.lastPanels = now; S.dirty = false;
      const parked = t >= X.tArmPark; if (!S.busyAsk) $$('.tasks .btn').forEach((b) => { b.disabled = parked; });
      set('ctl-note', parked ? 'Dexter-L is parked on the upper stage for the return; it does not come home' : 'task-level requests · each one is signed and has to pass Sentinel'); }
  }
  function tick(now) {
    const dt = Math.min((now - S.lastWall) / 1000, .25); S.lastWall = now;
    try {
      const target = S.speed === 'auto' ? R.autoRate(M, S.t) : S.speed;
      S.rate = S.speed === 'auto' ? (target < S.rate ? target : S.rate + (target - S.rate) * Math.min(1, dt * 5)) : target;   // slow down at once, speed up smoothly
      if (S.playing) { S.t = R.advance(M, S.t, dt * S.rate); if (S.t >= X.tEnd) { S.t = X.tEnd; play(false); } }
      frame(dt, now);
    } catch (e) { if (!S.error) { S.error = e; console.error(e); } }
    requestAnimationFrame(tick);
  }
  function play(on) { if (on && S.task) endTask('Task view closed'); S.playing = on; set('btn-play', on ? '❚❚' : '▶'); $('btn-play').setAttribute('aria-label', on ? 'Pause' : 'Play'); }
  function seek(t) { if (S.task) endTask('Task view closed'); S.t = clamp(t, T0, X.tEnd); auditN = delivN = -1; chartKey = rosKey = rateKey = wellKey = ''; S.dirty = true; if (S.speed === 'auto') S.rate = R.autoRate(M, S.t); }
  $('btn-play').onclick = () => { if (!S.playing && S.t >= X.tEnd - 1) seek(T0); play(!S.playing); };
  $$('#speed button').forEach((b) => { b.onclick = () => { S.speed = b.dataset.speed === 'auto' ? 'auto' : +b.dataset.speed; $$('#speed button').forEach((x) => x.classList.toggle('on', x === b)); }; });
  $$('#right-tabs button').forEach((b) => { b.onclick = () => { $$('#right-tabs button').forEach((x) => x.classList.toggle('on', x === b)); $$('#panel-right .tabpane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; }); rosKey = rateKey = wellKey = ''; S.dirty = true; }; });
  const track = $('track'), tip = $('track-tip'); let dragging = false;
  const trackT = (e) => { const r = track.getBoundingClientRect(); return [R.x2t(M, clamp((e.clientX - r.left) / r.width, 0, 1)), e.clientX - r.left, r.width]; };
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); seek(trackT(e)[0]); });
  track.addEventListener('pointermove', (e) => { const [t, x, w] = trackT(e); if (dragging) seek(t);
    let best = null, bd = 9; for (const m of MARKS) { const d = Math.abs(R.t2x(M, m.t) * w - x); if (d < bd) { bd = d; best = m; } }
    tip.hidden = false; tip.innerHTML = best ? `<b>${met(best.t)}</b>${esc(nice(best.code))} · ${esc(best.text.slice(0, 70))}` : `<b>${met(t)}</b>`;
    const tw = tip.offsetWidth; tip.style.left = clamp(x, tw / 2, w - tw / 2) + 'px'; });
  const endDrag = () => { dragging = false; }; track.addEventListener('pointerup', endDrag); track.addEventListener('pointercancel', endDrag); track.addEventListener('pointerleave', () => { tip.hidden = true; });
  addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'SELECT') return; if (e.code === 'Space') { e.preventDefault(); $('btn-play').click(); } });
  if (window.ResizeObserver) new ResizeObserver(() => { scene._resize(); chartKey = rosKey = rateKey = wellKey = ''; S.dirty = true; }).observe($('center'));
  addEventListener('resize', () => { chartKey = rosKey = rateKey = wellKey = ''; S.dirty = true; });

  seek(T0); document.body.classList.remove('loading');
  requestAnimationFrame((now) => { S.lastWall = now; tick(now); });
  window.__customer = { seek, play, submit, state: S, mission: M };
})();
