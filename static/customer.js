/* Customer panel: one customer's view of the same mission replay (module 17, Adriana / Zurich Biotech Lab). */
(async function () {
  const $ = (id) => document.getElementById(id);
  const D = await (await fetch('api/mission/sentinel.json')).json();
  const CUST = 'Adriana / Zurich Biotech Lab', MOD = 17;
  const S = { t: 0, playing: false, speed: 60, lastWall: performance.now() };
  const fmtT = (t) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return [h, m, s].map(x => String(x).padStart(2, '0')).join(':'); };
  const lastBefore = (arr, t, key = 't') => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid][key] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; } return r; };
  const tEnd = D.events[D.events.length - 1].t + 30;
  const opsStart = D.frames[0].t;
  const evs = (t, pred) => D.events.filter(e => e.t <= t && pred(e));

  const STEPS = [
    ['Launch, LELP-1 to 800 km', e => e.code === 'ORBIT'],
    ['Module 17 activated, environment stabilising', e => e.code === 'EXECUTE' && e.data.verb === 'activate_module' && e.data.target === 'module-17'],
    ['Step 2: organoid culture at 37.0 °C', e => e.code === 'PROTOCOL'],
    ['Imaging cycle 1', e => e.code === 'IMAGING'],
    ['Central-lab analysis (robotic transfer)', e => e.code === 'ANALYSIS'],
    ['Analysis report delivered to Switzerland', e => e.code === 'DELIVERED' && /Adriana/.test(e.text)],
    ['Sealed into return capsule', e => e.code === 'CAPSULE_LOAD'],
    ['Re-entry and splashdown', e => e.code === 'SPLASHDOWN'],
    ['Samples handed over', e => e.code === 'SAMPLE_HANDOVER'],
  ];
  const JOURNEY = [['🚀', 'LAUNCH', e => e.code === 'LIFTOFF'], ['🛰', 'ORBIT', e => e.code === 'ORBIT'], ['🧫', 'CULTURE', e => e.code === 'PROTOCOL'],
    ['🔬', 'LAB', e => e.code === 'ANALYSIS'], ['📡', 'DATA', e => e.code === 'DELIVERED' && /Adriana/.test(e.text)], ['🪂', 'RETURN', e => e.code === 'SPLASHDOWN'], ['🤝', 'HANDOVER', e => e.code === 'SAMPLE_HANDOVER']];
  const RETURN_CODES = ['CAPSULE_LOAD', 'CAPSULE_SEP', 'DEORBIT_BURN', 'ENTRY_INTERFACE', 'PEAK_HEATING', 'DROGUE', 'MAIN_CHUTE', 'SPLASHDOWN', 'RECOVERY', 'SAMPLE_HANDOVER'];
  const returnEvents = D.events.filter(e => RETURN_CODES.includes(e.code));

  $('steps').innerHTML = STEPS.map(s => `<li><i></i><span>${s[0]}</span><span class="st">—</span></li>`).join('');
  $('journey').innerHTML = JOURNEY.map(j => `<div><b>${j[0]}</b>${j[1]}</div>`).join('');
  $('return').innerHTML = returnEvents.map(e => `<div data-t="${e.t}"><span class="ft">${fmtT(e.t)}</span><span>${e.text}</span></div>`).join('');
  $('track-marks').innerHTML = D.events.filter(e => e.seg === 'CUSTOMER' || e.seg === 'RETURN' || (e.data && e.data.target === 'module-17'))
    .map(e => `<i class="${e.level}" style="left:${(e.t / tEnd * 100).toFixed(2)}%"></i>`).join('');
  $('cust-fp').textContent = 'ML-DSA-87 · ' + Math.abs(hash(CUST)).toString(16).slice(0, 12);
  function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

  const affects = (e) => e.data && e.data.final && (e.data.target === 'module-17' || e.data.target === 'platform' && /mode|capsule|passivate|key/.test(e.data.verb) || e.data.target === 'arm');
  let auditCount = 0, delivCount = 0;

  function render() {
    const t = S.t;
    $('met').textContent = fmtT(t); $('track-fill').style.width = (t / tEnd * 100) + '%';
    const fi = lastBefore(D.frames, t);
    const f = fi >= 0 ? D.frames[fi] : null; const m = f ? f.modules[MOD - 1] : null;
    const phase = t < opsStart ? (evs(t, e => e.code === 'ORBIT').length ? 'IN ORBIT' : 'LAUNCH') : (evs(t, e => e.code === 'SAMPLE_HANDOVER').length ? 'COMPLETE' : evs(t, e => e.code === 'CAPSULE_SEP').length ? 'RETURNING' : f.platform.mode);
    $('phase-pill').textContent = phase;
    if (m) {
      $('m-t').textContent = m.t.toFixed(2); $('m-h').textContent = Math.round(m.health * 100);
      $('m-h-sub').textContent = m.health > 0.9 ? 'nominal' : m.health > 0.5 ? 'stress, check protocol' : 'culture lost';
      $('m-p').textContent = m.p + ' kPa'; $('m-seal').textContent = m.sealed ? 'SEALED' : 'BREACH'; $('m-state').textContent = m.state.toUpperCase(); $('m-heat').textContent = m.heater_w + ' W';
      drawCharts(t, fi);
    }
    STEPS.forEach((s, k) => { const li = $('steps').children[k]; const hit = D.events.find(e => e.t <= t && s[1](e)); const next = !hit && (k === 0 || D.events.find(e => e.t <= t && STEPS[k - 1][1](e)));
      li.className = hit ? 'done' : next ? 'now' : ''; li.lastElementChild.textContent = hit ? fmtT(hit.t) : next ? 'in progress' : '—'; });
    JOURNEY.forEach((j, k) => { const el = $('journey').children[k]; const hit = D.events.find(e => e.t <= t && j[2](e)); const prev = k === 0 || D.events.find(e => e.t <= t && JOURNEY[k - 1][2](e)); el.className = hit ? 'done' : prev ? 'now' : ''; });
    [...$('return').children].forEach(d => d.classList.toggle('done', +d.dataset.t <= t));
    // deliveries
    const del = evs(t, e => e.code === 'DELIVERED' && (/Adriana|Module 17/.test(e.text)));
    if (del.length !== delivCount) { delivCount = del.length; $('deliveries').innerHTML = del.map(e => `<li><span class="ft">${fmtT(e.t)}</span><span>${e.text}</span></li>`).reverse().join(''); }
    const imaging = evs(t, e => e.code === 'IMAGING').reduce((a, e) => a + (e.data.frames || 0), 0) + (evs(t, e => e.code === 'ANALYSIS').length ? 96 : 0);
    $('d-n').textContent = del.length; $('d-frames').textContent = imaging; $('d-mb').textContent = (del.length * 48 + (del.some(e => /raw/.test(e.text)) ? 172 : 0)) + ' MB';
    // audit
    const au = evs(t, affects);
    if (au.length !== auditCount) { auditCount = au.length;
      $('audit').innerHTML = au.slice().reverse().map(e => `<li class="${e.data.final}"><span class="ft">${fmtT(e.t)}</span><span><span class="verdict">${e.data.final}</span>${e.data.issuer} → ${e.data.verb} ${e.data.target} ${e.data.params || ''} <em>via ${e.data.route}</em><span class="why">${e.data.reasons.slice(-2).join(' · ')}</span></span></li>`).join('');
      $('a-ok').textContent = au.filter(e => e.data.final === 'EXECUTE').length; $('a-bad').textContent = au.filter(e => e.data.final !== 'EXECUTE').length; }
    const l = evs(t, e => e.code === 'LEDGER' || e.code === 'LEDGER_TAMPER').pop();
    $('a-ledger').textContent = l ? (l.data.ok ? `${l.data.entries} entries · OK` : 'TAMPER DETECTED') : '—';
    const sc = D.scorecard;
    $('scorecard').innerHTML = [['ATTACKS ON YOUR DATA BLOCKED', `${sc.attack_blocked_or_held} / ${sc.attack_commands}`, true], ['CULTURES LOST', sc.cultures_lost, sc.cultures_lost === 0],
      ['CUSTODY LEDGER', sc.ledger_ok ? 'VERIFIED' : 'BROKEN', sc.ledger_ok], ['SAMPLE RETURN', evs(t, e => e.code === 'SAMPLE_HANDOVER').length ? 'DELIVERED' : 'PENDING', true]]
      .map(([l, v, ok]) => `<div class="sc ${ok ? 'good' : 'bad'}"><span>${l}</span><b>${v}</b></div>`).join('');
  }
  function drawCharts(t, fi) {
    const win = D.frames.slice(Math.max(0, fi - 720), fi + 1);   // 2 h at 10 s frames
    const W = 360, line = (H, get, lo, hi, color, band) => {
      const px = (i) => 8 + i / Math.max(win.length - 1, 1) * (W - 16), py = (v) => H - 14 - (v - lo) / (hi - lo) * (H - 24);
      const pts = win.map((f, i) => `${px(i).toFixed(1)},${py(Math.max(lo, Math.min(hi, get(f.modules[MOD - 1])))).toFixed(1)}`).join(' ');
      const bandSvg = band ? `<rect x="8" y="${py(band[1])}" width="${W - 16}" height="${py(band[0]) - py(band[1])}" fill="rgba(12,163,12,.12)"/>` : '';
      return `${bandSvg}<line x1="8" x2="${W - 8}" y1="${py(lo)}" y2="${py(lo)}" stroke="#2e2e2c"/><text x="2" y="${py(hi) + 4}" font-size="8" fill="#8a897f" font-family="IBM Plex Mono">${hi}</text><text x="2" y="${py(lo)}" font-size="8" fill="#8a897f" font-family="IBM Plex Mono">${lo}</text><polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${pts}"/>`;
    };
    $('chart-t').innerHTML = line(120, m => m.t, 30, 46, '#3987e5', [36.5, 37.5]);
    $('chart-h').innerHTML = line(70, m => m.health * 100, 0, 100, '#199e70');
  }
  function tick(now) { const dt = (now - S.lastWall) / 1000; S.lastWall = now; if (S.playing) { S.t = Math.min(S.t + dt * S.speed, tEnd); } render(); requestAnimationFrame(tick); }
  $('btn-play').onclick = () => { S.playing = !S.playing; $('btn-play').textContent = S.playing ? '❚❚' : '▶'; };
  $('speed').onchange = (e) => S.speed = +e.target.value;
  $('track').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); S.t = (e.clientX - r.left) / r.width * tEnd; auditCount = -1; delivCount = -1; };
  addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target.tagName !== 'SELECT') { e.preventDefault(); $('btn-play').click(); } });
  requestAnimationFrame(tick);

  // ---------------- CONTROL DEXTER-L: task-level requests through Sentinel ----------------
  let staticTasks = null; try { staticTasks = await (await fetch('api/arm_tasks.json')).json(); } catch (e) {}
  const JN = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7'];
  $('ctl-joints').innerHTML = JN.map(j => `<div><i><b style="height:0"></b></i><em>0°</em>${j}</div>`).join('');
  const ctl = { playing: null, pending: null };
  async function ask(customer, module, task, ack, abort) {
    try {
      const r = await fetch('/api/arm_task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer, module, task, ack, abort }) });
      if (r.ok) return await r.json();
    } catch (e) {}
    if (!staticTasks) return { error: 'no server and no precomputed cases' };
    const key = abort ? `${customer}:${module}:abort:1` : `${customer}:${module}:${task}:${ack ? 1 : 0}`;
    return staticTasks[key] || staticTasks[`${customer}:17:${task}:${ack ? 1 : 0}`] || { error: 'case not precomputed: ' + key };
  }
  function showVerdict(res) {
    const v = $('verdict'); v.hidden = false; const d = res.decision || { final: 'ERROR', A: '—', B: '—', reasons: [res.error || 'no response'] };
    v.className = 'verdict ' + d.final; v.querySelector('.v-final').textContent = d.final + (res.abort ? ' · ABORT' : ` · ${res.task || ''}`);
    v.querySelector('.v-paths').textContent = `A ${d.A} · B ${d.B}${res.signature_bytes ? ' · ML-DSA-87 ' + res.signature_bytes + ' B' : ''}`;
    v.querySelector('.v-why').textContent = (d.reasons || []).slice(-3).join(' · ');
    v.querySelector('.v-ack').hidden = d.final !== 'ESCALATED';
  }
  function drawArm(j) {
    // side view in the plane of the arm: shoulder at (rho 0.62, z 1.45); L1 .52, L2 .98, L3 .15 (metres); 90 px per metre
    const R = Math.PI / 180, S = 90, ox = 180, oy = 230, sgn = Math.cos(j[0] * R) >= 0 ? 1 : -1;
    const P = (rho, z) => [ox + rho * S, oy - z * S];
    const p0 = [0.62, 1.45], a1 = j[1] * R, a2 = a1 + j[3] * R, a3 = a2 + j[4] * R;
    const p1 = [p0[0] + 0.52 * Math.cos(a1) * sgn, p0[1] + 0.52 * Math.sin(a1)];
    const p2 = [p1[0] + 0.98 * Math.cos(a2) * sgn, p1[1] + 0.98 * Math.sin(a2)];
    const p3 = [p2[0] + 0.15 * Math.cos(a3) * sgn, p2[1] + 0.15 * Math.sin(a3)];
    const layers = [[0, .25], [.25, .5], [.5, .95], [.95, 1.4]];
    const mods = layers.map(([a, b]) => `<rect x="${P(.35, b)[0]}" y="${P(.35, b)[1]}" width="${.23 * S}" height="${(b - a) * S - 2}" fill="#3a3122" stroke="#5a4a2a"/><rect x="${P(-.58, b)[0]}" y="${P(-.58, b)[1]}" width="${.23 * S}" height="${(b - a) * S - 2}" fill="#3a3122" stroke="#5a4a2a"/>`).join('');
    const seg = (a, b, w, c) => `<line x1="${P(...a)[0]}" y1="${P(...a)[1]}" x2="${P(...b)[0]}" y2="${P(...b)[1]}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
    $('arm-svg').innerHTML = `<rect x="${P(-.35, 1.5)[0]}" y="${P(-.35, 1.5)[1]}" width="${.7 * S}" height="${1.5 * S}" fill="#23262b"/>${mods}` +
      `<rect x="${P(-.68, 2.0)[0]}" y="${P(-.68, 2.0)[1]}" width="${1.36 * S}" height="${.5 * S}" fill="rgba(159,195,232,.15)" stroke="#5a7ca0"/>` +
      `<rect x="${P(-.25, 1.63)[0]}" y="${P(-.25, 1.63)[1]}" width="${.5 * S}" height="3" fill="#9aa0aa"/>` +
      seg(p0, p1, 6, '#e8e8e2') + seg(p1, p2, 5, '#e8e8e2') + seg(p2, p3, 4, '#3a3f47') +
      `<circle cx="${P(...p0)[0]}" cy="${P(...p0)[1]}" r="5" fill="#3a3f47"/><circle cx="${P(...p1)[0]}" cy="${P(...p1)[1]}" r="4" fill="#3a3f47"/><circle cx="${P(...p2)[0]}" cy="${P(...p2)[1]}" r="3" fill="#3a3f47"/>` +
      `<text x="6" y="12" font-size="9" fill="#8a897f" font-family="IBM Plex Mono">SIDE VIEW · metres</text>`;
  }
  function play(res) {
    const tr = res.trace || []; $('armlive').hidden = false; $('al-log').innerHTML = '';
    let i = 0, logged = 0; if (ctl.playing) clearInterval(ctl.playing);
    const total = tr.length ? tr[tr.length - 1].t : 0;
    ctl.playing = setInterval(() => {
      if (i >= tr.length) { clearInterval(ctl.playing); ctl.playing = null; $('al-step').textContent = 'task complete · arm holding'; return; }
      const f = tr[i++];
      $('al-step').textContent = `${f.step} · ${Math.round(f.step_t)} / ${f.step_dur} s`; $('al-t').textContent = `${f.t} s`;
      $('al-prog').style.width = (total ? f.t / total * 100 : 0) + '%';
      document.querySelectorAll('#ctl-joints div').forEach((d, k) => { const lim = [180, 100, 90, 150, 120, 180, 180][k]; d.querySelector('b').style.height = (Math.min(Math.abs(f.joints[k]), lim) / lim * 100) + '%'; d.querySelector('em').textContent = f.joints[k].toFixed(0) + '°'; d.querySelector('i').className = Math.abs(f.torques[k]) > 0.3 ? 'hot' : ''; });
      $('al-ft').textContent = `${f.ft_n} N`; $('al-tip').textContent = `${f.tip_mps} m/s`; $('al-grip').textContent = `${f.grip ? 'LATCHED' : 'OPEN'} · ${f.umbilical ? 'MATED' : 'OFF'}`;
      $('al-fid').textContent = Math.round(f.fiducial * 100) + ' %'; $('al-temp').textContent = f.module_t.toFixed(2) + ' °C'; $('al-pow').textContent = f.power_w + ' W';
      drawArm(f.joints);
      while (logged < (res.events || []).length && res.events[logged].t <= f.t) { const e = res.events[logged++]; const li = document.createElement('li'); li.innerHTML = `<span class="ft">${e.t}s</span>${e.text}`; $('al-log').prepend(li); }
    }, 200);   // 10x: trace samples are 2 s apart
  }
  async function submit(task, ack) {
    const customer = CUST, module = +$('ctl-module').value;
    document.querySelectorAll('.tasks button').forEach(b => b.disabled = true);
    const res = await ask(customer, module, task, ack, false);
    document.querySelectorAll('.tasks button').forEach(b => b.disabled = false);
    ctl.pending = res.decision && res.decision.final === 'ESCALATED' ? { task } : null;
    showVerdict(res);
    if (res.decision && res.decision.final === 'EXECUTE') play(res); else { $('armlive').hidden = !ctl.playing; }
  }
  document.querySelectorAll('.tasks button[data-task]').forEach(b => b.onclick = () => submit(b.dataset.task, false));
  $('ctl-ack').onclick = () => { if (ctl.pending) submit(ctl.pending.task, true); };
  $('ctl-abort').onclick = async () => { if (ctl.playing) { clearInterval(ctl.playing); ctl.playing = null; }
    const res = await ask(CUST, +$('ctl-module').value, 'full', true, true); showVerdict(res);
    $('al-step').textContent = 'ABORT acknowledged · arm holding position, brakes on'; $('armlive').hidden = false; };
  drawArm([0, -80, 0, -140, 40, 0, 0]);
})();
