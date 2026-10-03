/* Customer console: one customer's view of the same mission replay (module 17, Adriana / Zurich Biotech Lab) plus
   task-level control of Dexter-L. Every request is signed and evaluated by Sentinel: POST api/arm_task on the live
   server, or the precomputed cases in api/arm_tasks.json on the static site. The task runs against a lab-operations
   snapshot of the twin, independent of the replay clock. Shares replay.js, scene.js and style.css with the console. */
(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const set = (id, v) => { const el = typeof id === 'string' ? $(id) : id; if (!el) return; v = String(v); if (el.textContent !== v) el.textContent = v; };
  const cls = (id, c) => { const el = typeof id === 'string' ? $(id) : id; if (el && el.className !== c) el.className = c; };
  const R = window.Replay, { T0, lerp, clamp, hms, clock, met, esc, nice, lastBefore } = R;
  const CUST = 'Adriana / Zurich Biotech Lab', MOD = 17, BAND = [36.7, 37.3];
  const TASK_LABEL = { transfer_to_lab: 'FETCH TO LAB', image: 'IMAGING PASS', return: 'RETURN TO SLOT', full: 'FULL CYCLE' };
  const S = { t: T0, playing: false, speed: 'auto', rate: 1.5, lastWall: performance.now(), lastPanels: 0, dirty: true, error: null, task: null, acked: false, pending: null };

  let M;
  try { M = await R.load('sentinel', (n, e) => { set('ld-msg', 'Waiting for the mission twin…'); set('ld-sub', 'attempt ' + n + ' · ' + e.message); }); }
  catch (e) { set('ld-msg', 'Could not load the mission data'); set('ld-sub', e.message + ' · reload the page to retry'); return; }
  const X = M.x, ev = M.events, F = M.frames;
  const lastEvent = (t, pred) => R.lastEvent(M, t, pred);
  const tOf = (pred) => { const e = ev.find(pred); return e ? e.t : Infinity; };
  const feedT = (t) => (t < 0 ? '−' : '') + hms(Math.abs(t));

  const stub = { setPhase() {}, updateLaunch() {}, updateOps() {}, setSolar() {}, setLandingZone() {}, _resize() {} };
  let scene = stub;
  try { scene = new window.Scene3D($('view3d')); } catch (e) { console.warn('3-D view unavailable:', e); $('gl-note').hidden = false; }
  scene.setLandingZone(X.lz);
  $('view3d').addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('gl-note').hidden = false; });
  $('view3d').addEventListener('webglcontextrestored', () => { $('gl-note').hidden = true; });

  // ---------- what this customer cares about, derived once from the event stream ----------
  const STEPS = [
    ['Launch to the 550 km orbit', (e) => e.code === 'ORBIT' && e.seg === 'ORBIT'],
    ['Module 17 activated', (e) => e.code === 'EXECUTE' && e.data.verb === 'activate_module' && e.data.target === 'module-17'],
    ['Culture at 37.0 °C, 5 % CO₂', (e) => e.code === 'PROTOCOL'],
    ['Imaging cycle 1', (e) => e.code === 'IMAGING'],
    ['Central-lab analysis by Dexter-L', (e) => e.code === 'ANALYSIS'],
    ['Report delivered to Zurich', (e) => e.code === 'DELIVERED' && /Adriana/.test(e.text)],
    ['Secured for return with the whole lab', (e) => e.code === 'RETURN_PREP'],
    ['Re-entry, inflatable shield', (e) => e.code === 'SPLASHDOWN'],
    ['Module handed to your courier', (e) => e.code === 'SAMPLE_HANDOVER'],
  ].map(([label, pred]) => ({ label, t: tOf(pred) }));
  const JOURNEY = [['LAUNCH', (e) => e.code === 'LIFTOFF'], ['ORBIT', (e) => e.code === 'ORBIT' && e.seg === 'ORBIT'], ['CULTURE', (e) => e.code === 'PROTOCOL'], ['LAB', (e) => e.code === 'ANALYSIS'],
    ['DATA', (e) => e.code === 'DELIVERED' && /Adriana/.test(e.text)], ['RE-ENTRY', (e) => e.code === 'SPLASHDOWN'], ['HANDOVER', (e) => e.code === 'SAMPLE_HANDOVER']].map(([label, pred]) => ({ label, t: tOf(pred) }));
  const RETURN = ev.filter((e) => ['RETURN_PREP', 'DEORBIT_BURN', 'STAGE_SEP', 'HIAD_INFLATE', 'ENTRY_INTERFACE', 'PEAK_HEATING', 'MAIN_CHUTE', 'SPLASHDOWN', 'RECOVERY', 'SAMPLE_HANDOVER'].includes(e.code));
  const AUDIT = ev.filter((e) => e.data && e.data.final && (e.data.target === 'module-' + MOD || e.data.target === 'arm' || (e.data.target === 'platform' && /mode|return_prep|deorbit|passivate|key/.test(e.data.verb))));
  const DELIV = ev.filter((e) => e.code === 'DELIVERED' && /Adriana|Module 17/.test(e.text));
  const IMAGING = ev.filter((e) => e.code === 'IMAGING'), ANALYSIS = ev.find((e) => e.code === 'ANALYSIS');
  const ATTACK17 = X.atkCmds.filter((e) => e.data.target === 'module-' + MOD);
  const tPrep = tOf((e) => e.code === 'RETURN_PREP'), tStageSep = tOf((e) => e.code === 'STAGE_SEP'), tSplash = tOf((e) => e.code === 'SPLASHDOWN'), tHand = tOf((e) => e.code === 'SAMPLE_HANDOVER');
  const tLab = tOf((e) => e.code === 'MODE' && /-> CENTRAL_ANALYSIS/.test(e.text));
  // where the module is on its way home (key times from the twin's whole-payload return model)
  const returnState = (t) => t >= tHand ? 'WITH YOUR COURIER' : t >= X.tRecovery ? 'ON THE RECOVERY SHIP' : t >= tSplash ? 'AFLOAT'
    : t >= X.tMain ? 'UNDER MAIN CANOPY' : t >= X.tEI ? 'RE-ENTRY' : t >= X.tInflate ? 'HEAT SHIELD DEPLOYED' : t >= tStageSep ? 'COASTING TO ENTRY' : 'SECURED FOR RETURN';
  const MARKS = ev.filter((e) => e.t >= T0 && (e.seg === 'CUSTOMER' || e.seg === 'RETURN' || (e.data && e.data.target === 'module-' + MOD) || ['LIFTOFF', 'TOUCHDOWN', 'INTRUSION', 'CONTAIN'].includes(e.code) || (e.code === 'ORBIT' && e.seg === 'ORBIT')));

  $('steps').innerHTML = STEPS.map((s) => `<li><i></i><span>${s.label}</span><span class="st">—</span></li>`).join('');
  $('journey').innerHTML = JOURNEY.map((j) => `<li>${j.label}</li>`).join('');
  $('return').innerHTML = RETURN.map((e) => `<div><span class="ft">${feedT(e.t)}</span><span>${esc(e.text)}</span></div>`).join('');
  $('track-bands').innerHTML = X.bands.map(([a, b, label, c]) => { const x0 = R.t2x(M, a) * 100, x1 = R.t2x(M, b) * 100; return `<span class="${c}" style="left:${x0.toFixed(2)}%;width:${(x1 - x0).toFixed(2)}%">${label}</span>`; }).join('');
  $('track-marks').innerHTML = MARKS.map((e) => `<i class="${e.level}" style="left:${(R.t2x(M, e.t) * 100).toFixed(2)}%"></i>`).join('');

  // ---------- charts ----------
  const size = (svg) => { const r = svg.getBoundingClientRect(); return [Math.max(140, Math.round(r.width)), Math.max(40, Math.round(r.height))]; };
  let chartKey = '';
  function drawCharts(fi, returning) {
    const key = fi + ':' + $('chart-t').clientWidth; if (key === chartKey) return; chartKey = key;
    const i0 = Math.max(0, fi - 720), win = []; for (let i = i0; i <= fi; i += 4) win.push(F[i].modules[MOD - 1]); win.push(F[fi].modules[MOD - 1]);
    const draw = (id, get, lo, hi, color, band, ticks) => {
      const svg = $(id), [W, H] = size(svg), l = 30, r = 8, tp = 7, b = 7;
      const px = (k) => l + k / Math.max(win.length - 1, 1) * (W - l - r), py = (v) => H - b - (clamp(v, lo, hi) - lo) / (hi - lo) * (H - tp - b);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = (band ? `<rect x="${l}" y="${py(band[1])}" width="${W - l - r}" height="${py(band[0]) - py(band[1])}" fill="rgba(12,163,12,.16)"/>` : '') +
        ticks.map((v) => `<line x1="${l}" x2="${W - r}" y1="${py(v)}" y2="${py(v)}" class="grid"/><text x="${l - 5}" y="${py(v) + 3.5}" text-anchor="end" class="tick">${v}</text>`).join('') +
        `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${win.map((m, k) => px(k).toFixed(1) + ',' + py(get(m)).toFixed(1)).join(' ')}"/>` +
        `<circle cx="${px(win.length - 1)}" cy="${py(get(win[win.length - 1]))}" r="3.5" fill="${color}" stroke="#1d1f21" stroke-width="2"/>`;
    };
    draw('chart-t', (m) => m.t, 0, 42, '#3987e5', returning ? [3.5, 4.5] : BAND, [4, 20, 37]);
    draw('chart-h', (m) => m.health * 100, 0, 100, '#199e70', null, [0, 50, 100]);
  }
  let vialKey = '';
  function drawVials(t) {
    // schematic of the 24 vials: organoid diameter from the twin's analysis result (+9 % at the central-lab analysis)
    const img = IMAGING.filter((e) => e.t <= t), an = ANALYSIS && ANALYSIS.t <= t ? ANALYSIS : null, key = img.length + ':' + (an ? 1 : 0) + ':' + $('vials').clientWidth;
    if (key === vialKey) return; vialKey = key;
    const svg = $('vials'), [W, H] = size(svg), cols = 8, rows = 3, cw = W / cols, ch = H / rows, d1 = an ? an.data.diameter_um : 0, d0 = d1 ? d1 / 1.09 : 378, d = an ? d1 : d0;
    let g = '';
    for (let i = 0; i < 24; i++) { const cx = (i % cols + .5) * cw, cy = (Math.floor(i / cols) + .5) * ch, well = Math.min(cw, ch) * .42, v = 1 + .07 * Math.sin(i * 12.9898 + 4.1);
      g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${well.toFixed(1)}" fill="#151617" stroke="#3d4145"/>`;
      if (img.length) g += `<circle cx="${(cx + Math.sin(i * 7.3) * 2).toFixed(1)}" cy="${(cy + Math.cos(i * 5.1) * 2).toFixed(1)}" r="${(well * .62 * d * v / 412).toFixed(1)}" fill="#199e70" fill-opacity="${an ? .85 : .6}" stroke="#5fce5f" stroke-opacity=".5"/>`; }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = g;
    set('img-cap', an ? `analysis T+${hms(an.t)} · ${an.data.diameter_um} µm · viability ${Math.round(an.data.viability * 100)} %` : img.length ? `cycle ${img.length} · T+${hms(img[img.length - 1].t)} · ≈ ${Math.round(d0)} µm` : 'no frames yet');
  }

  // ---------- panels ----------
  let auditN = -1, delivN = -1;
  function panels(t, f, fi) {
    set('met-sign', t < 0 ? 'T−' : 'T+'); set('met', clock(t)); set('rate', '×' + (S.rate >= 10 ? Math.round(S.rate) : S.rate.toFixed(1)));
    const phase = t < 0 ? 'PRE-LAUNCH' : t < X.tSeco ? 'LAUNCH' : t < X.opsStart ? 'IN ORBIT' : t >= tHand ? 'COMPLETE' : t >= tSplash ? 'RECOVERY' : t >= X.tEI ? 'RE-ENTRY' : t >= tPrep ? 'RETURNING' : nice(f.platform.mode);
    set('phase-pill', phase); cls('phase-pill', 'chip ' + (t >= tHand ? 'good' : 'info'));
    const m = f ? f.modules[MOD - 1] : null, returning = t >= tPrep;
    if (m) {   // the module stays in the lab twin all the way home: live temperature throughout
      set('m-t', m.t.toFixed(2));
      if (returning) {
        const ok = Math.abs(m.t - 4) <= 0.5;
        set('m-t-sub', ok ? 'transport mode 4 °C · whole lab returning' : 'cooling to 4 °C transport mode'); cls('m-t-sub', 'hero-sub ' + (ok ? 'ok' : ''));
        set('m-state', returnState(t)); cls('m-state', 'chip push ' + (t >= tHand ? 'good' : 'info'));
      } else {
        const ok = m.state === 'stowed' || (m.t >= BAND[0] && m.t <= BAND[1]);
        set('m-t-sub', m.state === 'stowed' ? 'not activated yet' : ok ? 'inside protocol 37.0 ± 0.3' : m.t < BAND[0] ? 'warming up to 37.0 ± 0.3' : 'ABOVE protocol 37.0 ± 0.3'); cls('m-t-sub', 'hero-sub ' + (m.state === 'stowed' ? '' : ok ? 'ok' : m.t > BAND[1] ? 'bad' : ''));
        set('m-state', { stowed: 'STOWED', active: 'CULTURE RUNNING', in_transfer: 'WITH THE ARM', in_lab: 'IN CENTRAL LAB', isolated: 'ISOLATED' }[m.state] || nice(m.state).toUpperCase());
        cls('m-state', 'chip push ' + (m.state === 'active' ? 'good' : m.state === 'stowed' ? '' : 'info'));
      }
      set('m-p', m.p + ' kPa'); set('m-seal', m.sealed ? 'SEALED' : 'BREACH'); set('m-heat', m.heater_w + ' W'); set('m-sp', m.protocol && m.protocol.setpoint ? m.protocol.setpoint + ' °C' : '—');
    } else {
      ['m-t', 'm-p', 'm-seal', 'm-heat', 'm-sp'].forEach((id) => set(id, '—')); set('m-t-sub', 'protocol 37.0 ± 0.3 once in orbit'); cls('m-t-sub', 'hero-sub');
      set('m-state', t < 0 ? 'ON THE PAD' : t < X.tSeco ? 'RIDING TO ORBIT' : 'IN ORBIT'); cls('m-state', 'chip push');
    }
    const health = m ? Math.round(m.health * 100) : null;
    set('m-h', health == null ? '—' : health);
    set('m-h-sub', health == null ? 'culture health index from the twin' : (ANALYSIS && t >= ANALYSIS.t ? `measured viability ${Math.round(ANALYSIS.data.viability * 100)} % at T+${hms(ANALYSIS.t)}` : health > 90 ? 'nominal' : health > 50 ? 'stressed' : 'culture lost'));
    cls('m-h-sub', 'hero-sub ' + (health == null ? '' : health > 90 ? 'ok' : 'bad'));
    if (f) drawCharts(fi, returning);
    STEPS.forEach((s, k) => { const li = $('steps').children[k], done = t >= s.t, now = !done && (k === 0 || t >= STEPS[k - 1].t); cls(li, done ? 'done' : now ? 'now' : ''); set(li.lastElementChild, done ? feedT(s.t) : now ? 'in progress' : '—'); });
    JOURNEY.forEach((j, k) => cls($('journey').children[k], t >= j.t ? 'done' : (k === 0 || t >= JOURNEY[k - 1].t) ? 'now' : ''));
    RETURN.forEach((e, k) => cls($('return').children[k], t >= e.t ? 'done' : ''));
    // data
    const del = DELIV.filter((e) => e.t <= t), img = IMAGING.filter((e) => e.t <= t);
    if (del.length !== delivN) { delivN = del.length; $('deliveries').innerHTML = del.length ? del.slice().reverse().map((e) => `<li><span class="ft">${feedT(e.t)}</span><span>${esc(e.text)}</span></li>`).join('') : '<li><span class="ft">—</span><span>Nothing delivered yet. Reports arrive after the central-lab analysis.</span></li>'; }
    set('d-n', del.length); set('d-frames', img.reduce((a, e) => a + (e.data.frames || 0), 0));
    set('d-mb', img.reduce((a, e) => a + (+(/(\d+) MB/.exec(e.text) || [0, 0])[1]), 0) + ' MB');
    drawVials(t);
    // audit
    const au = AUDIT.filter((e) => e.t <= t);
    if (au.length !== auditN) { auditN = au.length;
      $('audit').innerHTML = au.slice().reverse().map((e) => `<li><span class="ft">${feedT(e.t)}</span><span><span class="chip ${e.data.final}">${e.data.final}</span><span class="fcmd">${esc(e.data.issuer)} → ${esc(e.data.verb)} ${esc(e.data.target)} ${esc(e.data.params || '')}</span><span class="why">via ${esc(e.data.route)} · ${esc(e.data.reasons.slice(-2).join(' · '))}</span></span></li>`).join('');
      set('a-ok', au.filter((e) => e.data.final === 'EXECUTE').length); set('a-bad', au.filter((e) => e.data.final !== 'EXECUTE').length); }
    const led = lastEvent(t, (e) => e.code === 'LEDGER' || e.code === 'LEDGER_TAMPER');
    set('a-ledger', led ? (led.data.ok ? 'VERIFIED' : 'TAMPER') : 'CHAINED');
    // scorecard
    let n = 0, blocked = 0; for (const e of ATTACK17) { if (e.t > t) break; n++; if (e.data.final !== 'EXECUTE') blocked++; }
    const tiles = [['ATTACKS ON YOUR MODULE', t < X.tIntr ? '—' : `${blocked} / ${n} BLOCKED`, t < X.tIntr ? '' : blocked === n ? 'good' : 'bad'],
      ['CULTURE HEALTH', health == null ? '—' : health + ' %', health == null ? '' : health > 90 ? 'good' : 'bad'],
      ['CUSTODY LEDGER', led ? (led.data.ok ? 'VERIFIED' : 'TAMPER CAUGHT') : 'HASH-CHAINED', led ? (led.data.ok ? 'good' : 'bad') : ''],
      ['MODULE RETURN', t >= tHand ? 'HANDED OVER' : t >= tPrep ? returnState(t).replace('COASTING TO ENTRY', 'COASTING').replace('HEAT SHIELD DEPLOYED', 'SHIELD DEPLOYED').replace('SECURED FOR RETURN', 'SECURED') : 'PENDING', t >= tHand ? 'good' : '']];
    const html = tiles.map(([l, v, k]) => `<div class="sc ${k}"><span>${l}</span><b>${v}</b></div>`).join('');
    if ($('scorecard').dataset.h !== html) { $('scorecard').innerHTML = html; $('scorecard').dataset.h = html; }
    if (!S.task) { const cap = lastEvent(t, (e) => e.seg === 'CUSTOMER' || e.seg === 'RETURN' || e.seg === 'LAUNCH' || e.seg === 'ORBIT' || (e.data && e.data.target === 'module-' + MOD) || (e.code === 'ARM' && /17/.test(e.text)));
      set('overlay-caption', cap ? `${nice(cap.code)} · ${cap.text}` : 'Your payload is on the pad inside LELP-1'); }
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
      else if (!S.task) { scene.setPhase('ops'); scene.setSolar(!!lastEvent(t, (e) => e.code === 'SOLAR') && t < X.tSep); scene.updateOps(o.view, o.states, f.gate.isolated || [], dt, { ret: R.returnState(M, t), cam: 'arm' }); } }
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
      S.rate = S.speed === 'auto' ? S.rate + (target - S.rate) * Math.min(1, dt * 5) : target;
      if (S.playing) { S.t += dt * S.rate; if (S.t >= X.tEnd) { S.t = X.tEnd; play(false); } }
      frame(dt, now);
    } catch (e) { if (!S.error) { S.error = e; console.error(e); } }
    requestAnimationFrame(tick);
  }
  function play(on) { if (on && S.task) endTask('Task view closed'); S.playing = on; set('btn-play', on ? '❚❚' : '▶'); $('btn-play').setAttribute('aria-label', on ? 'Pause' : 'Play'); }
  function seek(t) { if (S.task) endTask('Task view closed'); S.t = clamp(t, T0, X.tEnd); auditN = delivN = -1; chartKey = vialKey = ''; S.dirty = true; if (S.speed === 'auto') S.rate = R.autoRate(M, S.t); }
  $('btn-play').onclick = () => { if (!S.playing && S.t >= X.tEnd - 1) seek(T0); play(!S.playing); };
  $$('#speed button').forEach((b) => { b.onclick = () => { S.speed = b.dataset.speed === 'auto' ? 'auto' : +b.dataset.speed; $$('#speed button').forEach((x) => x.classList.toggle('on', x === b)); }; });
  $$('#right-tabs button').forEach((b) => { b.onclick = () => { $$('#right-tabs button').forEach((x) => x.classList.toggle('on', x === b)); $$('#panel-right .tabpane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; }); vialKey = ''; S.dirty = true; }; });
  const track = $('track'), tip = $('track-tip'); let dragging = false;
  const trackT = (e) => { const r = track.getBoundingClientRect(); return [R.x2t(M, clamp((e.clientX - r.left) / r.width, 0, 1)), e.clientX - r.left, r.width]; };
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); seek(trackT(e)[0]); });
  track.addEventListener('pointermove', (e) => { const [t, x, w] = trackT(e); if (dragging) seek(t);
    let best = null, bd = 9; for (const m of MARKS) { const d = Math.abs(R.t2x(M, m.t) * w - x); if (d < bd) { bd = d; best = m; } }
    tip.hidden = false; tip.innerHTML = best ? `<b>${met(best.t)}</b>${esc(nice(best.code))} · ${esc(best.text.slice(0, 70))}` : `<b>${met(t)}</b>`;
    const tw = tip.offsetWidth; tip.style.left = clamp(x, tw / 2, w - tw / 2) + 'px'; });
  const endDrag = () => { dragging = false; }; track.addEventListener('pointerup', endDrag); track.addEventListener('pointercancel', endDrag); track.addEventListener('pointerleave', () => { tip.hidden = true; });
  addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'SELECT') return; if (e.code === 'Space') { e.preventDefault(); $('btn-play').click(); } });
  if (window.ResizeObserver) new ResizeObserver(() => { scene._resize(); chartKey = vialKey = ''; S.dirty = true; }).observe($('center'));
  addEventListener('resize', () => { chartKey = vialKey = ''; S.dirty = true; });

  seek(T0); document.body.classList.remove('loading');
  requestAnimationFrame((now) => { S.lastWall = now; tick(now); });
  window.__customer = { seek, play, submit, state: S, mission: M };
})();
