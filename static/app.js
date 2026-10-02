/* Mission console: replays the twin's event stream + frames with its own clock. */
(async function () {
  const $ = (id) => document.getElementById(id);
  const data = {};
  for (const m of ['sentinel', 'baseline']) data[m] = await (await fetch('api/mission/' + m + '.json')).json();

  const S = { mode: 'sentinel', t: 0, playing: false, speed: 20, lastWall: performance.now(), feedIdx: 0, lastDecision: null };
  const scene = new Scene3D($('view3d')); window.scene = scene;
  const SEG_ORDER = ['LAUNCH', 'BOOSTER', 'ORBIT', 'OPS', 'COMMS', 'SENTINEL', 'RETURN', 'EOM'];
  const ARM = ['identify', 'unlock', 'capture', 'transfer', 'dock', 'position', 'analyse', 'return', 'record'];
  const STATIONS = [['ISTRAC', 'ISTRAC Bengaluru', 'IN'], ['LEUK', 'Leuk', 'CH'], ['ESOC', 'ESOC Darmstadt', 'DE'], ['RELAY-1', 'Relay 1', 'MESH'], ['RELAY-2', 'Relay 2', 'MESH']];
  const QUEUE = [['safety', 'SAFETY'], ['housekeeping', 'HOUSEKEEPING'], ['experiment_status', 'EXP. STATUS'], ['science_raw', 'SCIENCE RAW'], ['science_products', 'PRODUCTS'], ['logs', 'LOGS']];

  const D = () => data[S.mode];
  const tEnd = () => D().events[D().events.length - 1].t + 30;
  const opsStart = () => D().frames[0].t;
  const fmtT = (t) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return [h, m, s].map(x => String(x).padStart(2, '0')).join(':'); };
  const lastBefore = (arr, t, key = 't') => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (arr[mid][key] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; } return r; };

  // ---------- static build ----------
  $('stations').innerHTML = STATIONS.map(s => `<div class="station" id="st-${s[0]}"><span class="flag">${s[2]}</span><b>${s[1]}</b><span class="det" id="std-${s[0]}">—</span><span class="det" id="stb-${s[0]}">—</span></div>`).join('');
  $('queue').innerHTML = QUEUE.map(q => `<span class="ql">${q[1]}</span><span class="qb"><i id="qb-${q[0]}" style="width:0"></i></span><span class="qv" id="qv-${q[0]}">0 MB</span>`).join('');
  $('arm-steps').innerHTML = ARM.map(() => '<span></span>').join('');
  const JN = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7'];
  $('joints').innerHTML = JN.map(j => `<div><i><b style="height:0"></b></i><em>0°</em>${j}</div>`).join('');
  $('modgrid').innerHTML = Array.from({ length: 32 }, (_, i) => `<div class="mod" id="mod-${i + 1}"><span>${i + 1}</span><span class="mt">—</span></div>`).join('');
  $('traj-legend').innerHTML = `<span><i style="background:var(--s1)"></i>stack / upper stage</span><span><i style="background:var(--s2)"></i>booster</span>`;

  function buildTimeline() {
    const end = tEnd();
    $('track-marks').innerHTML = D().events.filter(e => e.level !== 'info' || ['LIFTOFF', 'MECO', 'SEP', 'SECO'].includes(e.code))
      .map(e => `<i class="${e.level}" style="left:${(e.t / end * 100).toFixed(2)}%" title="${fmtT(e.t)} ${e.code}"></i>`).join('');
    const segs = {}; D().events.forEach(e => { if (!(e.seg in segs)) segs[e.seg] = e.t; });
    let lastX = -10;
    $('track-segs').innerHTML = Object.entries(segs).filter(([k]) => k !== 'COMMS' && k !== 'SENTINEL' && k !== 'ATTACK')
      .map(([k, t]) => { const x = t / end * 100; if (x - lastX < 5) return ''; lastX = x; return `<span style="left:${x.toFixed(2)}%">${k === 'RETURN' ? 'SAMPLE RETURN' : k}</span>`; }).join('');
    const sc = D().scorecard, good = S.mode === 'sentinel';
    $('scorecard').innerHTML = [
      ['ATTACK CMDS EXECUTED', `${sc.attack_executed} / ${sc.attack_commands}`, sc.attack_executed === 0],
      ['FORGED / REPLAY ACCEPTED', sc.forged_or_replayed_accepted, sc.forged_or_replayed_accepted === 0],
      ['CONTAINMENT', sc.containment_s == null ? 'none' : sc.containment_s + ' s', sc.containment_s != null],
      ['CULTURES LOST', sc.cultures_lost, sc.cultures_lost === 0],
    ].map(([l, v, ok]) => `<div class="sc ${ok ? 'good' : 'bad'}"><span>${l}</span><b>${v}</b></div>`).join('');
  }

  // ---------- render ----------
  function render() {
    const t = S.t, ev = D().events, end = tEnd();
    $('met').textContent = fmtT(t);
    $('track-fill').style.width = (t / end * 100) + '%';
    // segments
    let cur = 'LAUNCH'; for (const e of ev) { if (e.t > t) break; if (SEG_ORDER.includes(e.seg)) cur = e.seg; }
    const launchDone = t > opsStart();
    if (launchDone && cur !== 'EOM') cur = (lastEvent(t, e => e.seg === 'RETURN' && e.code !== 'SAMPLE_HANDOVER')) ? 'RETURN'
      : (lastEvent(t, e => e.seg === 'SENTINEL' && e.code !== 'EXECUTE' && e.code !== 'PLAN' && t - e.t < 120)) ? 'SENTINEL'
      : (lastEvent(t, e => e.seg === 'COMMS' && e.code === 'DELIVERED' && t - e.t < 60)) ? 'COMMS' : 'OPS';
    document.querySelectorAll('#segments span').forEach(s => { const i = SEG_ORDER.indexOf(s.dataset.seg), c = SEG_ORDER.indexOf(cur); s.className = i < c ? 'done' : i === c ? 'now' : ''; });

    if (!launchDone) renderLaunch(t); else renderOps(t);
    renderSentinel(t); renderFeed(t);
    if (document.body.classList.contains('cinema')) {
      $('hud-met').textContent = fmtT(t); $('hud-seg').textContent = cur === 'RETURN' ? 'SAMPLE RETURN' : cur === 'BOOSTER' ? 'BOOSTER RTLS' : cur === 'OPS' ? 'LAB OPS' : cur;
      if (!launchDone) { $('hud-a').textContent = $('v-speed').textContent + ' km/h'; $('hud-b').textContent = $('v-alt').textContent + ' km · ' + $('mode-pill').textContent; $('hud-c2').textContent = $('booster-phase').textContent !== '—' ? 'BOOSTER ' + $('booster-phase').textContent + ' · ' + $('b-alt').textContent : $('overlay-caption').textContent; }
      else { $('hud-a').textContent = $('mode-pill').textContent; $('hud-b').textContent = $('arm-now').textContent; $('hud-c2').textContent = $('overlay-caption').textContent.slice(0, 90); }
    }
  }
  function lastEvent(t, pred) { const ev = D().events; for (let i = lastBefore(ev, t); i >= 0; i--) if (pred(ev[i])) return ev[i]; return null; }

  // ----- launch -----
  const byBody = {};
  function indexLaunch() { for (const m of ['sentinel', 'baseline']) { byBody[m] = {}; for (const s of data[m].launch) (byBody[m][s.body] = byBody[m][s.body] || []).push(s); } }
  function renderLaunch(t) {
    $('panel-launch').hidden = false; $('panel-platform').hidden = true; scene.setPhase('launch');
    const L = byBody[S.mode], latest = {}; for (const b in L) { const i = lastBefore(L[b], t); if (i >= 0) latest[b] = L[b][i]; }
    const hasSep = !!latest.upper;
    const hero = hasSep ? latest.upper : latest.stack;
    $('launch-body').textContent = hasSep ? 'UPPER STAGE + LELP' : 'STACK';
    if (hero) {
      $('v-speed').textContent = Math.round(hero.speed_ms * 3.6).toLocaleString(); $('v-alt').textContent = hero.alt_km.toFixed(1);
      $('v-dr').textContent = hero.downrange_km.toFixed(1) + ' km'; $('v-thr').textContent = Math.round(hero.throttle * 100) + ' %';
      $('v-prop').textContent = hero.prop_pct.toFixed(1) + ' %'; $('v-q').textContent = hero.q_kpa.toFixed(1) + ' kPa';
      $('m-prop').style.width = hero.prop_pct + '%';
    }
    $('mode-pill').textContent = hero ? hero.phase.toUpperCase().replace('_', ' ') : 'PAD';
    const b = latest.booster; $('booster-box').style.opacity = b ? 1 : .35;
    $('booster-phase').textContent = b ? b.phase.toUpperCase().replace('_', ' ') : '—';
    if (b) { $('b-speed').textContent = Math.round(b.speed_ms * 3.6).toLocaleString() + ' km/h'; $('b-alt').textContent = b.alt_km.toFixed(1) + ' km';
      $('b-dr').textContent = Math.abs(b.downrange_km).toFixed(1) + ' km'; $('b-prop').textContent = b.prop_pct.toFixed(1) + ' %';
      $('b-fins').textContent = b.fins >= 1 ? 'DEPLOYED' : b.fins > 0 ? 'DEPLOYING' : 'STOWED'; $('b-g').textContent = (b.g_load || 0).toFixed(1) + ' g';
      $('b-q').textContent = b.q_kpa.toFixed(1) + ' kPa'; $('b-heat').textContent = Math.round(b.heat_kw_m2 || 0) + ' kW/m²';
      document.querySelectorAll('#fins i').forEach(f => f.style.transform = `rotate(${90 - 90 * (b.fins || 0)}deg)`); }
    drawTraj(t, L);
    scene.setLandingZone((D().launch_meta || {}).landing_zone_km || 0);
    scene.updateLaunch(latest, hasSep);
    $('overlay-caption').textContent = hasSep ? `BOOSTER TO DOWNRANGE BARGE AT ${(D().launch_meta || {}).landing_zone_km || '—'} KM (BAY OF BENGAL) · UPPER STAGE: BURN, COAST, CIRCULARISE AT 800 KM` : `ASCENT FROM APJ ABDUL KALAM ISLAND, ODISHA · ${(D().launch_meta || {}).engines || 28} × SHAKTI LOX/ETHANOL`;
  }
  function drawTraj(t, L) {
    const xmax = Math.max(220, ...['stack', 'upper', 'booster'].flatMap(b => (L[b] || []).filter(s => s.t <= t).map(s => Math.abs(s.downrange_km))));
    const W = 320, H = 150, px = (x) => 20 + x / xmax * (W - 30), py = (y) => H - 18 - y / 210 * (H - 28);
    const line = (arr, color) => { const pts = arr.filter(s => s.t <= t).map(s => `${px(Math.abs(s.downrange_km)).toFixed(1)},${py(s.alt_km).toFixed(1)}`); return pts.length > 1 ? `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${pts.join(' ')}"/>` : ''; };
    const dot = (arr, color) => { const i = lastBefore(arr, t); if (i < 0) return ''; const s = arr[i]; return `<circle cx="${px(Math.abs(s.downrange_km))}" cy="${py(s.alt_km)}" r="4" fill="${color}" stroke="#1a1a19" stroke-width="2"/>`; };
    const grid = [0, 50, 100, 150, 200].map(y => `<line x1="20" x2="${W - 10}" y1="${py(y)}" y2="${py(y)}" stroke="#2e2e2c"/><text x="2" y="${py(y) + 3}" font-size="8" fill="#8a897f" font-family="IBM Plex Mono">${y}</text>`).join('')
      + [0, Math.round(xmax / 2 / 50) * 50, Math.round(xmax / 50) * 50].map(x => `<text x="${px(x) - 6}" y="${H - 4}" font-size="8" fill="#8a897f" font-family="IBM Plex Mono">${x}</text>`).join('');
    $('traj').innerHTML = grid + line(L.stack || [], '#3987e5') + line(L.upper || [], '#3987e5') + line(L.booster || [], '#d95926') + dot(L.upper || L.stack || [], '#3987e5') + dot(L.booster || [], '#d95926')
      + `<text x="${W - 60}" y="12" font-size="8" fill="#8a897f" font-family="IBM Plex Mono">ALT km / DOWNRANGE km</text>`;
  }

  // ----- ops -----
  function moduleState(m) {
    if (m.state === 'isolated' || m.health < 0.5) return 'crit';
    if (m.state === 'in_transfer' || m.state === 'in_lab') return 'move';
    if (!m.state || m.state === 'stowed') return 'idle';
    if (m.health < 0.9 || !m.sealed) return 'warn';
    return 'good';
  }
  let lastFrameT = -1;
  function renderOps(t) {
    $('panel-launch').hidden = true; $('panel-platform').hidden = false; scene.setPhase('ops');
    const F = D().frames, i = lastBefore(F, t); if (i < 0) return; const f = F[i], p = f.platform;
    $('plat-mode').textContent = p.mode; $('mode-pill').textContent = p.mode;
    $('p-alt').textContent = p.alt_km + ' km'; $('p-batt').textContent = p.battery + ' %'; $('p-labt').textContent = p.lab_t + ' °C';
    $('p-sun').textContent = p.eclipse ? 'ECLIPSE' : 'SUNLIT'; $('p-active').textContent = p.active_modules; $('p-isol').textContent = p.isolated.length ? p.isolated.join(', ') : 'none';
    const stepI = ARM.indexOf(p.arm.step), A = p.arm;
    document.querySelectorAll('#arm-steps span').forEach((s, k) => s.className = A.busy ? (k < stepI ? 'done' : k === stepI ? 'now' : '') : '');
    $('arm-now').textContent = A.busy ? `module ${A.module} · ${A.step} · ${Math.round(A.step_t || 0)} / ${A.step_dur || 0} s` : `idle · stowed · ${A.cycles || 0} cycles`;
    if (A.joints) {
      document.querySelectorAll('#joints div').forEach((d, k) => { const lim = [180, 100, 90, 150, 120, 180, 180][k]; const v = A.joints[k];
        d.querySelector('b').style.height = (Math.min(Math.abs(v), lim) / lim * 100) + '%'; d.querySelector('i').className = Math.abs(A.torques[k]) > 0.3 ? 'hot' : ''; d.querySelector('em').textContent = v.toFixed(0) + '°'; });
      $('d-tau').textContent = A.tau_max + ' N·m'; $('d-tip').textContent = A.tip_mps + ' m/s'; $('d-ft').textContent = `${A.ft_n} N · ${A.ft_nm} N·m`;
      $('d-fid').textContent = A.busy ? Math.round(A.fiducial * 100) + ' %' : '—'; $('d-grip').textContent = `${A.grip ? 'LATCHED' : 'OPEN'} · ${A.umbilical ? 'MATED' : 'OFF'}`;
      $('d-pow').textContent = `${A.power_w} W · ${A.brakes ? 'ON' : 'OFF'}`; $('d-react').textContent = A.reaction_nm + ' N·m'; $('d-cyc').textContent = A.cycles;
      const ih = $('inhand'); ih.hidden = !A.grip;
      if (A.grip && A.module) { const m = f.modules[A.module - 1]; $('ih-name').textContent = `Module ${m.id} · ${m.payload.kind} · ${m.customer}`;
        $('ih-det').textContent = `${m.payload.mass_kg} kg · ${m.payload.vials} vials · ${m.payload.containment} · ${m.t} °C on umbilical power · ${m.protocol && m.protocol.mode === 'cycle' ? 'thermal-cycling protocol' : 'constant-temperature protocol'}`; }
    }
    const states = f.modules.map(moduleState);
    if (f.t !== lastFrameT) {
      f.modules.forEach((m, k) => { const el = $('mod-' + m.id); el.className = 'mod ' + states[k]; el.lastChild.textContent = m.state === 'stowed' ? m.size : m.t.toFixed(1) + '°'; el.title = `${m.exp} · ${m.t} °C · ${m.p} kPa · health ${m.health}` + (m.protocol ? ` · ${m.protocol.mode === 'cycle' ? 'thermal cycling (eclipse-synced), ' + m.protocol.cycles + ' cycles' : 'constant ' + m.protocol.setpoint + ' °C'}${m.protocol.crystal_um ? ' · crystals ' + m.protocol.crystal_um + ' µm' : ''}` : ''); });
      lastFrameT = f.t;
    }
    // comms
    const vis = f.comms.visible, iso = f.gate.isolated;
    STATIONS.forEach(s => { const el = $('st-' + s[0]); el.className = 'station' + (iso.includes(s[0]) ? ' isolated' : vis.includes(s[0]) ? ' on' : '');
      const L = (f.comms.links || {})[s[0]]; if (!L) return;
      $('std-' + s[0]).textContent = `${L.band} · ${(L.rate_bps / 1e6).toFixed(1)} Mbps ↓ ${(L.uplink_bps / 1e3).toFixed(0)} kbps ↑ · ${L.coding}`;
      const b = L.budget; $('stb-' + s[0]).innerHTML = b ? `el ${b.el_deg}° · ${b.range_km} km · Eb/N0 <b>${b.ebn0_db}</b> dB · margin <b>${b.margin_db}</b> dB · SA${L.sdls_sa} · ${L.pq_session}` : `${L.std}`; });
    // subsystems
    const ss = p.eps ? p : null;
    if (ss) { const e = p.eps, tc = p.tcs, ad = p.adcs, cd = p.cdh, pr = p.prop;
      $('ss-eps-sun').textContent = e.sun; $('ss-eps-gen').textContent = e.gen_w + ' W'; $('ss-eps-load').textContent = e.load_w + ' W'; $('ss-eps-v').textContent = e.bus_v + ' V'; $('ss-eps-soc').textContent = e.soc + ' %';
      $('ss-tcs-lab').textContent = tc.lab_c + ' °C'; $('ss-tcs-rad').textContent = tc.radiator_c + ' °C'; $('ss-tcs-heat').textContent = tc.heaters_w + ' W'; $('ss-tcs-bus').textContent = tc.bus_c + ' °C';
      $('ss-adcs-mode').textContent = ad.mode; $('ss-adcs-err').textContent = ad.err_deg + '°'; $('ss-adcs-rate').textContent = ad.rate_dps + ' °/s'; $('ss-adcs-rw').textContent = ad.wheel_rpm.join(' / ') + ' rpm'; $('ss-adcs-orbit').textContent = p.alt_km + ' km';
      $('ss-cdh-obc').textContent = 'OBC-' + cd.obc; $('ss-cdh-cpu').textContent = cd.cpu_pct + ' %'; $('ss-cdh-sto').textContent = cd.storage_gb + ' GB'; $('ss-cdh-up').textContent = cd.uptime_h + ' h'; $('ss-cdh-led').textContent = f.gate.ledger_entries + ' entries';
      $('ss-prop-kg').textContent = pr.prop_kg + ' kg'; $('ss-prop-dv').textContent = pr.dv_ms + ' m/s'; $('ss-prop-bar').textContent = pr.tank_bar + ' bar'; $('ss-prop-next').textContent = 'orbit trim T+' + fmtT(Math.ceil((t + 1) / 7200) * 7200); }
    // OSI stack: highlight the layer the latest Sentinel decision acted on
    const dLast = lastEvent(t, e => e.data && e.data.final && t - e.t < 60);
    const hot = !dLast ? -1 : dLast.data.reasons.some(r => /signature|identity|replay|key does not/.test(r)) ? (dLast.data.reasons.some(r => /replay/.test(r)) ? 3 : 0) : dLast.data.reasons.some(r => /route|isolated/.test(r)) ? 4 : 0;
    document.querySelectorAll('#osi li').forEach((li, k) => li.classList.toggle('hot', k === hot));
    const maxQ = Math.max(1e6, ...Object.values(f.comms.queue));
    QUEUE.forEach(q => { const v = f.comms.queue[q[0]] || 0; $('qb-' + q[0]).style.width = (v / maxQ * 100) + '%'; $('qv-' + q[0]).textContent = (v / 1e6).toFixed(1) + ' MB'; });
    $('c-total').textContent = f.comms.total_mb + ' MB'; $('c-relay').textContent = f.comms.relayed_mb + ' MB'; $('c-q').textContent = f.comms.queued_packets;
    scene.setSolar(!!lastEvent(t, e => e.code === 'SOLAR'));
    const rc = lastEvent(t, e => e.seg === 'RETURN' || e.code === 'SAMPLE_HANDOVER');
    const capsuleState = !rc ? 'docked' : { CAPSULE_LOAD: 'docked', CAPSULE_SEP: 'sep', DEORBIT_BURN: 'deorbit', ENTRY_INTERFACE: 'entry', PEAK_HEATING: 'entry', DROGUE: 'chute', MAIN_CHUTE: 'chute', SPLASHDOWN: 'landed', RECOVERY: 'landed', SAMPLE_HANDOVER: 'landed' }[rc.code] || 'docked';
    scene.updateOps(f, states, iso, 1 / 60, { capsuleState });
    const cap = lastEvent(t, e => e.seg === 'OPS' || e.seg === 'ATTACK' || e.seg === 'RETURN' || e.seg === 'CUSTOMER' || e.code === 'CONTAIN');
    $('overlay-caption').textContent = cap ? `${cap.code} · ${cap.text}` : `${p.mode}`;
  }

  // ----- sentinel panel -----
  function renderSentinel(t) {
    const d = lastEvent(t, e => e.data && e.data.final);
    const F = D().frames, fi = lastBefore(F, t); const g = fi >= 0 ? F[fi].gate : null;
    if (g) { $('g-exec').textContent = g.executed; $('g-block').textContent = g.blocked; $('g-held').textContent = g.held + g.escalated; $('g-ledger').textContent = g.ledger_entries + ' entries'; }
    const pa = $('path-a'), pb = $('path-b'), dec = $('decision');
    if (!d) { pa.className = 'gate-path'; pb.className = 'gate-path'; return; }
    const x = d.data;
    pa.className = 'gate-path ' + (x.A === 'PASS' ? 'pass' : 'block'); pa.lastElementChild.textContent = x.A;
    pb.className = 'gate-path ' + ({ PASS: 'pass', VETO: 'block', HOLD: 'hold', ESCALATE: 'hold', SKIPPED: 'skip' }[x.B] || 'skip'); pb.lastElementChild.textContent = x.B === 'SKIPPED' ? (S.mode === 'baseline' ? 'NOT PRESENT' : 'NOT REACHED') : x.B;
    dec.className = 'decision ' + x.final; dec.children[0].textContent = x.final;
    dec.children[1].textContent = `${x.issuer} → ${x.verb} ${x.target} ${x.params || ''}  [via ${x.route}]`;
    dec.children[2].textContent = x.reasons.slice(-3).join(' · ');
    const c = lastEvent(t, e => e.code === 'CONTAIN');
    const box = $('contain'); box.hidden = !c || t - c.t > 900;
    if (c) { const el = Math.min(t - c.t, c.data.elapsed); $('contain-t').textContent = el.toFixed(1);
      const steps = box.querySelectorAll('.contain-steps span'); const marks = [0, c.data.isolate, c.data.revoke, c.data.elapsed];
      steps.forEach((s, k) => s.className = el >= marks[k] ? 'done' : ''); $('contain-node').textContent = `${c.data.node} · ${c.data.reason}`; }
    const l = lastEvent(t, e => e.code === 'LEDGER' || e.code === 'LEDGER_TAMPER');
    const ls = $('g-ledger-state'); if (l) { ls.textContent = l.data.ok ? 'CHAIN OK' : 'TAMPER DETECTED @' + l.data.bad; ls.className = 'pill ' + (l.data.ok ? 'ok' : 'bad'); }
  }

  // ----- feed -----
  function renderFeed(t) {
    const ev = D().events, feed = $('feed');
    if (S.feedIdx > 0 && ev[S.feedIdx - 1].t > t) { feed.innerHTML = ''; S.feedIdx = 0; }     // scrubbed backwards
    while (S.feedIdx < ev.length && ev[S.feedIdx].t <= t) {
      const e = ev[S.feedIdx++]; if (e.code === 'AOS' || e.code === 'LOS') continue;
      const li = document.createElement('li'); li.className = e.level;
      li.innerHTML = `<span class="ft">${fmtT(e.t)}</span><span><span class="fc">${e.code}</span>${e.text}</span>`;
      feed.prepend(li); if (feed.children.length > 60) feed.lastChild.remove();
    }
  }

  // ---------- clock ----------
  function tick(now) {
    const dt = (now - S.lastWall) / 1000; S.lastWall = now;
    if (S.playing) { S.t += dt * S.speed; if (S.t > tEnd()) { S.t = tEnd(); S.playing = false; $('btn-play').textContent = '▶'; } }
    render(); requestAnimationFrame(tick);
  }
  function seek(t) { S.t = Math.max(0, Math.min(t, tEnd())); $('feed').innerHTML = ''; $('feed').scrollTop = 0; S.feedIdx = 0; lastFrameT = -1; }
  function setMode(m) { S.mode = m; document.body.dataset.mode = m; $('btn-sentinel').classList.toggle('on', m === 'sentinel'); $('btn-baseline').classList.toggle('on', m === 'baseline'); buildTimeline(); seek(S.t); }

  $('btn-play').onclick = () => { S.playing = !S.playing; $('btn-play').textContent = S.playing ? '❚❚' : '▶'; };
  $('speed').onchange = (e) => S.speed = +e.target.value;
  const jump = (dir) => { const ev = D().events.filter(e => e.level !== 'info' || e.seg !== 'COMMS'); const i = lastBefore(ev, S.t + (dir > 0 ? 0.01 : -0.01)); const n = ev[i + dir]; if (n) seek(n.t - 0.5); };
  $('btn-next').onclick = () => jump(1); $('btn-prev').onclick = () => jump(-1);
  $('btn-broadcast').onclick = () => document.body.classList.toggle('broadcast');
  const cinema = (on) => { document.body.classList.toggle('cinema', on); $('hud').hidden = !on; dispatchEvent(new Event('resize'));
    try { if (on && !document.fullscreenElement) document.documentElement.requestFullscreen(); else if (!on && document.fullscreenElement) document.exitFullscreen(); } catch (e) {} };
  $('btn-cinema').onclick = () => cinema(!document.body.classList.contains('cinema'));
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('cinema')) cinema(false); });
  $('btn-sentinel').onclick = () => setMode('sentinel'); $('btn-baseline').onclick = () => setMode('baseline');
  $('track').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * tEnd()); };
  addEventListener('keydown', (e) => { if (e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); $('btn-play').click(); } else if (e.code === 'ArrowRight') jump(1); else if (e.code === 'ArrowLeft') jump(-1);
    else if (e.key === 'b' || e.key === 'B') $('btn-broadcast').click(); else if (e.key === 'f' || e.key === 'F') $('btn-cinema').click();
    else if (e.key === 'Escape' && document.body.classList.contains('cinema')) cinema(false); });

  indexLaunch(); buildTimeline(); seek(0); requestAnimationFrame(tick);
})();
