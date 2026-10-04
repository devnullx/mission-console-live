/* LELP-1 mission simulation engine (lab/simulate.html): the configured mission, end to end, computed in the browser.
   Inputs: data.json (catalog, configurator parameters, the twin's timeline) and sim.json (from a run of the mission twin:
   the RUPAK launch, the LELP-1 return, the commissioning commands Sentinel passed, ground stations, dosimeter model).
   What is computed here: the launch window and the orbit (lab_plan.js), position, sunlight and station passes every minute,
   the absorbed dose with the twin's dosimeter model (sentinel/lelp/experiment.py dose_rate: cosmic rays plus the South
   Atlantic Anomaly), the culture block temperature with the twin's thermoelectric loop (sentinel/lelp/station.py: slew
   limited to 0.125 degC/s, proportional gain 0.02/s) on the protocol's setpoints, imaging data
   through the downlink queue, and the command log through Sentinel's checks. What is the twin's own output: the launch and
   return trajectories, events and the commissioning verdicts. Not simulated: the science outcome. No result is invented.
   Runs in the browser (window.LelpSim) and in node (require) for the tests. */
(function (root) {
  'use strict';
  const P = root.LelpPlan || (typeof require !== 'undefined' ? require('./lab_plan.js') : null);
  const O = P.Orbit, DAY = 86400, GRID = 60;                         // series every minute
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function rowAt(rows, t) {                                          // linear interpolation in [t, ...] rows
    if (t <= rows[0][0]) return rows[0];
    const n = rows.length;
    if (t >= rows[n - 1][0]) return rows[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rows[m][0] <= t) lo = m; else hi = m; }
    const a = rows[lo], b = rows[hi], k = (t - a[0]) / (b[0] - a[0]);
    return a.map((v, i) => (typeof v === 'number' && typeof b[i] === 'number' ? v + (b[i] - v) * k : k < 0.5 ? v : b[i]));
  }
  function doseRate(lat, lon, q) {                                   // uGy/h inside the module: sentinel/lelp/experiment.py dose_rate
    const gcr = q.gcr_eq + (q.gcr_pole - q.gcr_eq) * Math.min(Math.abs(lat) / 65, 1) ** 2;
    const dl = ((lon - q.saa_lon + 540) % 360) - 180;
    const saa = q.saa_peak * Math.exp(-(((lat - q.saa_lat) / q.saa_dlat) ** 2) - (dl / q.saa_dlon) ** 2);
    return [gcr + saa, saa > q.saa_flag];
  }
  // the temperature a protocol launches at: the first stated temperature that is not the -80 C cassette or a melting point
  function holdTemp(e) {
    const s = e.protocol.launch_state, cryo = /cryopreserv|-80 ?c|−80/i.test(s.split(/\.\s|;\s/)[0]);
    if (cryo) return { c: 4, cryo: true, live: false };              // media and fixatives wait at 4 C; the cells ride at -80 C
    const live = /\blive\b/i.test(s);
    const re = /(melts?\s+(?:near|at)\s+)?(-?\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*°?\s*C\b/g;
    let m;
    while ((m = re.exec(s))) {
      if (m[1]) continue;
      const a = +m[2], b = m[3] ? +m[3] : a;
      if (a <= -60) continue;
      return { c: (a + b) / 2, cryo: false, live };
    }
    return { c: e.protocol.temp_c, cryo: false, live };
  }
  // which part of the payload module a protocol step works (glTF node prefixes from cad/build_modules.py)
  function roleOf(a) {
    if (/thaw|seed|frozen|cryo|load/i.test(a)) return 'sample__';
    if (/medium|media|exchange|feed|wash|rinse|fix|pfa|paraformaldehyde|stabil|rnalater|preserv|inject|dos(e|ing)|add |pump|perfus|flow|aliquot|collect/i.test(a)) return 'fluid__';
    if (/imag|microscop|brightfield|fluoresc|camera|photo|scan|score|optical|light|led|blue/i.test(a)) return 'imaging__';
    if (/temperature|warm|cool|heat|ramp|°c|\b\d+ ?c\b|melt|pull|solidif/i.test(a)) return 'thermal__';
    return 'sample__';
  }

  function build(D, SD, cfg) {
    const e = cfg.exp, own = cfg.mode === 'own', T = D.twin, o = D.orbit, ICD = D.icd.L;
    const M = P.timeline(D, cfg), cube = M.cube, trk = M.trk, t0 = M.t0, ms = (s) => t0 + s * 1000;
    const tempC = cfg.temp, days = cfg.days, mod = e.module, hold = holdTemp(e), retC = e.sample_return.temp_c;
    const L = SD.launch, stack = L.stack, upper = L.upper, booster = L.booster, tSep = stack[stack.length - 1][0];
    const sEnd = cube ? M.end + DAY : M.deorbit;                       // last second on orbit
    const tEnd = cube ? M.end + DAY : M.lab;
    const x0 = SD.ret[0][2], period = O.period(o), insAlt = SD.launch_meta.insertion_alt_km;
    const trimEnd = T.t_ops_s + 3 * 3600;

    // ---------- readiness review: the checks a flight would need before late load ----------
    const furnace = own && !!cfg.furnace;
    const ready = [
      ['Temperature', tempC >= D.temp_range[0] && tempC <= D.temp_range[1] || (furnace && tempC <= 80),
        furnace ? `${tempC} °C in the furnace` : `${tempC} °C, the bay holds ${D.temp_range[0]}-${D.temp_range[1]} °C`],
      ['Module mass', own || mod.mass_kg <= ICD.mass_kg + 1e-9, `${mod.mass_kg} kg${own ? '' : `, large bay ${ICD.mass_kg} kg`}`],
      ['Module power', own || mod.power_peak_w <= ICD.power_w + 1e-9, `${mod.power_peak_w} W peak${own ? '' : `, large bay ${ICD.power_w} W`}`],
      ['Duration', days <= (own ? 30 : D.max_days), `${days} days${own ? ', own satellite up to 30' : `, LELP-1 up to ${D.max_days}`}`],
      ['Return', cube || retC != null, cube ? 'in-flight only: nothing comes back' : `samples home at ${retC} °C within ${e.sample_return.max_hours} h`],
      ['Recovery zone', cube || !!M.splashPt, cube ? 'no capsule' : M.splashPt ? `deorbit timed for ${SD.recovery.name}` : 'no deorbit opportunity found'],
    ].map(([k, ok, d]) => ({ check: k, ok: !!ok, detail: d }));
    const go = ready.every((r) => r.ok);

    // ---------- where the spacecraft is ----------
    function pos(s) {
      let lat, lon, alt, speed = 0, g = 0, q = 0, heat = 0, mach = 0, body = 'pad', down = 0;
      if (s < 0) { lat = SD.launch_meta.site_lat; lon = SD.launch_meta.site_lon; alt = 0; g = 1; }
      else if (s < T.t_orbit_s) {
        const r = rowAt(s <= tSep ? stack : upper, s);
        alt = r[1]; down = r[2]; speed = r[3]; g = r[4]; q = r[5]; heat = r[6]; body = s <= tSep ? 'stack' : 'upper';
        const gg = O.geo(O.eci(trk.uSite + down / O.RE_KM, ms(s), o, alt), ms(s)); lat = gg.lat; lon = gg.lon;
      } else if (cube || s < M.deorbit) {
        alt = o.alt_km + (insAlt - o.alt_km) * clamp(1 - (s - T.t_orbit_s) / (trimEnd - T.t_orbit_s), 0, 1);
        speed = O.speed(Object.assign({}, o, { alt_km: alt })); body = 'orbit';
        const gg = O.geo(O.eci(trk.u(s), ms(s), o, alt), ms(s)); lat = gg.lat; lon = gg.lon;
      } else if (s <= M.splash) {
        const r = rowAt(SD.ret, s - M.deorbit);
        alt = r[1]; speed = r[3]; g = r[4]; heat = r[5]; mach = r[6]; body = r[7];
        const gg = O.geo(O.eci(trk.u(M.deorbit) + (r[2] - x0) / O.RE_KM, ms(s), o, alt), ms(s)); lat = gg.lat; lon = gg.lon;
      } else { lat = M.splashPt ? M.splashPt.lat : 0; lon = M.splashPt ? M.splashPt.lon : 0; alt = 0; body = s < M.hand ? 'sea' : 'courier'; g = 1; }
      return { lat, lon, alt, speed, g, q, heat, mach, body, down };
    }

    // ---------- every minute in orbit: position, sunlight, passes, dose ----------
    const n = Math.floor((sEnd - T.t_orbit_s) / GRID) + 1;
    const G = { s0: T.t_orbit_s, lat: new Float32Array(n), lon: new Float32Array(n), sun: new Uint8Array(n), st: new Int8Array(n), dose: new Float64Array(n), saa: new Uint8Array(n) };
    const ground = SD.stations.filter((x) => x.kind === 'ground'), relays = SD.stations.filter((x) => x.kind === 'relay');
    const science = SD.stations.map((x) => x.kind === 'relay' || /X/.test(x.band));       // ISTRAC is S-band TT&C: commands and housekeeping
    let dose = 0, prev = null;
    const doseSplit = [0, 0, 0], saaPasses = [], passes = [], open = {};
    let eclS = 0;
    for (let k = 0; k < n; k++) {
      const s = G.s0 + k * GRID, p = pos(s), t = ms(s), r = O.eci(cube || s < M.deorbit ? trk.u(s) : 0, t, o, p.alt);
      G.lat[k] = p.lat; G.lon[k] = p.lon;
      const lit = O.sunlit(r, t); G.sun[k] = lit ? 1 : 0; if (!lit) eclS += GRID;
      let best = -1, bestRate = 0;
      SD.stations.forEach((x, i) => {
        let vis;
        if (x.kind === 'ground') vis = O.elevation(r, O.site(x.lat, x.lon, t)) > x.mask_deg;
        else { const ph = (((s - T.t_orbit_s) / period) % 1 + 1) % 1, a = x.phase, b = x.phase + x.fraction; vis = (ph >= a && ph < b) || (ph + 1 >= a && ph + 1 < b); }
        if (vis) {
          if (!open[x.id]) open[x.id] = { id: x.id, name: x.name, kind: x.kind, s0: s, s1: s, rate: x.rate_bps };
          open[x.id].s1 = s + GRID;
          if (science[i] && x.rate_bps > bestRate) { best = i; bestRate = x.rate_bps; }
        } else if (open[x.id]) { passes.push(open[x.id]); delete open[x.id]; }
      });
      G.st[k] = best;
      const [rate, inSaa] = doseRate(p.lat, p.lon, SD.dose);
      G.saa[k] = inSaa ? 1 : 0;
      if (inSaa && !(prev && prev.saa)) saaPasses.push(s);
      if (s >= T.t_ops_s) {                                            // the dosimeter logs from power-on (the twin's convention)
        const dd = rate * GRID / 3600 / 1000;                          // mGy
        dose += dd;
        doseSplit[s < M.start ? 0 : s < M.end ? 1 : 2] += dd;
      }
      G.dose[k] = dose;
      prev = { saa: inSaa };
    }
    Object.values(open).forEach((x) => passes.push(x));
    passes.sort((a, b) => a.s0 - b.s0);

    // ---------- culture block temperature, power and data, stepped every minute from late load to the lab ----------
    const tStart = -DAY, nb = Math.floor((tEnd - tStart) / GRID) + 1, BAND = 0.3;
    const B = { s0: tStart, temp: new Float32Array(nb), set: new Float32Array(nb), pw: new Float32Array(nb), raw: new Float32Array(nb), q: new Float32Array(nb), down: new Float32Array(nb) };
    const im = SD.imaging, every = im.every_h * 3600, P0 = D.params;
    const rounds = [];
    for (let s = M.start; s < M.end; s += every) rounds.push(s);
    const queue = [], lat = [];
    let tB = hold.c, raw = 0, down = 0, ri = 0, readyAt = null;
    const avgW = P0.payload_duty * mod.power_peak_w + P0.tec_avg_w;
    for (let k = 0; k < nb; k++) {
      const s = tStart + k * GRID, set = s >= T.t_ops_s && s < M.end ? tempC : s >= M.end ? retC : hold.c;
      for (let j = 0; j < GRID / 5; j++) tB += clamp(0.02 * (set - tB), -0.125, 0.125) * 5;     // the twin's loop, 5 s sub-steps
      B.temp[k] = tB; B.set[k] = set;
      if (readyAt == null && s >= T.t_ops_s && Math.abs(tB - tempC) <= BAND) readyAt = s;
      while (ri < rounds.length && rounds[ri] <= s) { raw += im.raw_mb; queue.push({ t: rounds[ri], mb: im.down_mb }); ri++; }
      const inRound = rounds.length && s >= M.start && s < M.end && ((s - M.start) % every) < 900;
      B.pw[k] = s < M.start ? (s >= T.t_ops_s || hold.live ? P0.tec_avg_w : 0) : s < M.end ? (inRound ? mod.power_peak_w + P0.tec_avg_w : avgW) : (s < M.splash ? P0.tec_avg_w : 0);
      if (s >= T.t_orbit_s && s < sEnd) {
        const kk = Math.floor((s - G.s0) / GRID), st = kk >= 0 && kk < n ? G.st[kk] : -1;
        if (st >= 0) {
          let cap = SD.stations[st].rate_bps * GRID / 8e6;
          while (cap > 0 && queue.length) { const x = queue[0], tk = Math.min(cap, x.mb); x.mb -= tk; cap -= tk; down += tk; if (x.mb <= 1e-9) { lat.push(s - x.t); queue.shift(); } }
        }
      }
      B.raw[k] = raw; B.down[k] = down; B.q[k] = queue.reduce((a, x) => a + x.mb, 0);
    }

    // ---------- events: the twin's launch and return, the commands Sentinel checks, the protocol, the data ----------
    const ev = [], PQ = SD.pq, cust = own ? 'Your lab' : 'Your lab', bay = own ? null : 19;
    const push = (s, kind, title, text, extra) => ev.push(Object.assign({ s, kind, title, text }, extra || {}));
    const verdict = (issuer, verb, target, params, A, B2, final, src) => ({ cmd: { issuer, verb, target, params, A, B: B2, final, sig: PQ.dsa_signature, src } });
    for (const st of P.scaledSteps(e, days).filter((x) => x.day < -1)) push(-DAY - 600, 'ground', `Ground, day ${st.day}`, st.action);
    push(-DAY, 'custody', own ? 'Late load into the capsule' : `Late load into bay ${bay}`,
      `${mod.mass_kg} kg module sealed in BSL-2 triple containment, leak-checked and weighed; the custody ledger opens with your signature and the integration team's (ML-DSA-87, ${PQ.dsa_signature} B each)`
      + (hold.cryo ? '; cells ride in the passive -80 °C cassette' : `; bay held at ${hold.c} °C`), { phase: 'load' });
    for (const st of P.scaledSteps(e, days).filter((x) => x.day >= -1 && x.day <= 0)) push(st.day === 0 ? 0 : -DAY + 300, 'proto', `Protocol, day ${st.day}`, st.action, { role: roleOf(st.action) });
    for (const [t, seg, code, text] of SD.launch_events) {
      if (t < -60) continue;
      const tx = code === 'ORBIT' ? (own ? 'Orbit insertion confirmed; your satellite separates from the upper stage' : text) : text;
      push(t, seg === 'BOOSTER' ? 'booster' : 'launch', code.replace(/_/g, ' '), tx, { big: ['LIFTOFF', 'MAXQ', 'MECO', 'SEP', 'TOUCHDOWN', 'ORBIT'].includes(code) });
    }
    if (own) {
      const seq = [[0, 'MCC-Bengaluru', 'set_mode', 'satellite', 'mode=COMMISSIONING'], [60, 'MCC-Bengaluru', 'deploy_solar', 'satellite', ''],
        [600, 'MCC-Bengaluru', 'sun_acquire', 'adcs', 'mode=SUN_POINT'], [3600, 'MCC-Bengaluru', 'payload_power', 'payload', `setpoint_c=${tempC}`],
        [DAY, 'MCC-Bengaluru', 'checkout_report', 'satellite', 'all subsystems nominal']];
      for (const [r, who, verb, tgt, par] of seq) push(T.t_ops_s + r, 'cmd', `${verb} ${tgt}`, `${who} signs ${verb}${par ? ' ' + par : ''}`, verdict(who, verb, tgt, par, 'PASS', 'PASS', 'EXECUTE', 'rules'));
    } else {
      for (const [r, who, verb, tgt, par, fin, A, B2] of SD.commissioning) push(T.t_ops_s + r, 'cmd', `${verb} ${tgt}`, `${who} signs ${verb} ${tgt}${par ? ' ' + par : ''}`, verdict(who, verb, tgt, par, A, B2, fin, 'twin'));
      push(T.t_ops_s + 1300, 'cmd', `activate_module module-${bay}`, `MCC-Bengaluru powers your bay ${bay}: culture block to ${tempC} °C`, verdict('MCC-Bengaluru', 'activate_module', `module-${bay}`, `setpoint_c=${tempC}`, 'PASS', 'PASS', 'EXECUTE', 'rules'));
    }
    // your start: Sentinel holds it until the culture block is at temperature (the twin's thaw interlock)
    const sStart = Math.max(M.start, readyAt == null ? M.start : readyAt);
    const tgt = own ? 'payload' : `module-${bay}`;
    if (sStart > M.start + 60) push(M.start, 'cmd', `exp_protocol start ${tgt}`, `${cust} signs the start; HELD: culture block ${(B.temp[Math.floor((M.start - tStart) / GRID)] || 0).toFixed(1)} °C, not yet at ${tempC} °C`, verdict(cust, 'exp_protocol', tgt, 'step=start', 'PASS', 'HOLD', 'HELD', 'rules'));
    push(sStart, 'cmd', `exp_protocol start ${tgt}`, `${cust} signs the start of “${e.title}” with your own key; Sentinel checks the signature, that ${own ? 'the payload' : `bay ${bay}`} is yours and that it is at ${tempC} °C`,
      Object.assign(verdict(cust, 'exp_protocol', tgt, 'step=start', 'PASS', 'PASS', 'EXECUTE', 'rules'), { big: true }));
    if (hold.cryo) push(sStart + 60, 'proto', 'Automatic thaw', 'Cells leave the -80 °C cassette: thaw, dilution and wash into the culture cassette', { role: 'sample__' });
    for (const st of P.scaledSteps(e, days).filter((x) => x.day >= 1)) {
      const s = Math.min(sStart + (st.day - 1) * DAY + 1800, M.end - 600);
      push(s, 'proto', `Protocol, day ${st.day}`, st.action, { role: roleOf(st.action) });
    }
    for (let dd = 1; dd <= Math.ceil((M.end - sStart) / DAY); dd++) {
      const s1 = Math.min(sStart + dd * DAY, M.end - 1), s0 = s1 - DAY;
      const k0 = clamp(Math.floor((s0 - tStart) / GRID), 0, nb - 1), k1 = clamp(Math.floor((s1 - tStart) / GRID), 0, nb - 1);
      const g0 = clamp(Math.floor((s0 - G.s0) / GRID), 0, n - 1), g1 = clamp(Math.floor((s1 - G.s0) / GRID), 0, n - 1);
      const mb = B.down[k1] - B.down[k0], dmg = G.dose[g1] - G.dose[g0], saa = saaPasses.filter((x) => x >= s0 && x < s1).length;
      const used = [...new Set(passes.filter((x) => x.s1 > s0 && x.s0 < s1 && science[SD.stations.findIndex((y) => y.id === x.id)]).map((x) => x.name.split(' ')[0]))];
      push(s1, 'data', `Day ${dd} downlink`, `${Math.round(every ? DAY / every : 0)} imaging rounds; ${mb.toFixed(1)} MB of metrics and thumbnails to you via ${used.join(', ') || 'the next pass'}; ${dmg.toFixed(2)} mGy today, ${saa} South Atlantic Anomaly passes`);
    }
    push(M.end, 'proto', 'Preservation', `Your protocol ends after ${days} days: samples fixed or stabilised and held at ${retC} °C for the return`, { role: 'fluid__', big: true });
    if (cube) {
      push(M.end + 3600, 'data', 'Last readings', 'The last in-flight readings and the full log go down; the CubeSat is passivated and re-enters later, burning up');
    } else {
      if (!own && M.endLab > M.end + 60) push(M.end + 60, 'ops', 'The lab flies on', `LELP-1 stays in orbit until the longest protocol on board ends (${T.manifest_driver}, ${T.manifest_days} days); your bay holds ${retC} °C`);
      push(M.prep, 'cmd', 'set_mode END_OF_MISSION', 'MCC-Bengaluru starts the return', verdict('MCC-Bengaluru', 'set_mode', own ? 'satellite' : 'platform', 'mode=END_OF_MISSION', 'PASS', 'PASS', 'EXECUTE', 'rules'));
      push(M.prep + 30, 'cmd', 'return_prep', own ? 'Samples to the capsule drawer at the return temperature; human approval' : 'All modules latched for entry loads; human approval for an irreversible command',
        verdict('MCC-Bengaluru', 'return_prep', own ? 'satellite' : 'platform', 'intent=payload return', 'PASS', 'ESCALATE', 'EXECUTE', 'rules'));
      if (M.wait > 600) push(M.prep + 60, 'ops', 'Waiting for the right orbit', `The burn waits ${(M.wait / 3600).toFixed(1)} h for the pass that brings you down in the recovery zone (${SD.recovery.name})`);
      push(M.deorbit - 30, 'cmd', 'deorbit_burn', 'MCC-Bengaluru, with a second operator\'s approval', verdict('MCC-Bengaluru', 'deorbit_burn', own ? 'satellite' : 'platform', 'dv_ms=150', 'PASS', 'ESCALATE', 'EXECUTE', 'rules'));
      const ownTxt = { DEORBIT_BURN: 'Deorbit burn by the service module, 150 m/s retrograde', STAGE_SEP: 'The capsule separates; the service module stays behind and burns up',
        HIAD_INFLATE: 'Capsule oriented for entry', ARM_PARK: null, RECOVERY: 'The recovery ship reaches the capsule by its beacon (an unguided capsule lands tens of km from its aim point)' };
      for (const [r, code, text] of SD.ret_events) {
        let tx = text;
        if (own) { if (ownTxt[code] === null) continue; tx = ownTxt[code] || text.replace(/whole lab|Return Module|the lab/gi, 'the capsule').replace(/223 kg behind a 2\.6 m aeroshell/, 'the capsule'); }
        push(M.deorbit + (code === 'RECOVERY' && own ? Math.min(r, M.hand - M.deorbit - 600) : r), 'return', code.replace(/_/g, ' '), tx, { big: ['DEORBIT_BURN', 'ENTRY_INTERFACE', 'PEAK_HEATING', 'MAIN_CHUTE', 'SPLASHDOWN'].includes(code) });
      }
      push(M.hand, 'custody', 'Handover to your courier', `Your ${own ? 'samples' : 'module'} at ${retC} °C with the custody ledger: every signature from late load to the ship verified (ML-DSA-87)`, { big: true });
      push(M.lab, 'custody', 'In your lab', `Within ${e.sample_return.max_hours} h of splashdown. Post-flight: ${e.post_flight.map((x) => x.name).join('; ')}`, { big: true });
    }
    ev.sort((a, b) => a.s - b.s);
    ev.forEach((x, i) => { x.i = i; });

    // ---------- phases and the presentation clock ----------
    const ph = [['load', 'Late load', -DAY, -60], ['launch', 'Launch', -60, T.t_orbit_s], ['checkout', own ? 'Orbit and checkout' : 'Orbit and lab power-on', T.t_orbit_s, sStart],
      ['protocol', 'Your protocol', sStart, M.end]];
    if (cube) ph.push(['end', 'Last readings', M.end, tEnd]);
    else {
      if (M.endLab > M.end + 60) ph.push(['manifest', 'The lab flies on', M.end, M.endLab]);
      ph.push(['return', 'Return', ph[ph.length - 1][3], M.splash], ['recovery', 'Recovery and handover', M.splash, M.hand], ['lab', 'To your lab', M.hand, M.lab]);
    }
    const phases = ph.filter((x) => x[3] > x[2]).map(([id, name, s0, s1]) => ({ id, name, s0, s1 }));
    // the launch paced like the console's director (web/static/replay.js autoRate): close to real time through MECO, the
    // separation and flip, the drag fins and the landing; fast over the coasts
    const te = (code, dflt) => { const v = SD.launch_events.find((q) => q[2] === code); return v ? v[0] : dflt; };
    const tMeco = te('MECO', 135), tFlip = te('BOOSTBACK_START', 141), tFins = te('FINS_DEPLOY', 306), tLand = te('LANDING_BURN', 475), tTouch = te('TOUCHDOWN', 495), tSes2 = te('SES2', T.t_orbit_s - 4);
    const segs = [[-DAY, -60, 3], [-60, -3, 3], [-3, tMeco - 4, 9], [tMeco - 4, tFlip + 9, 7], [tFlip + 9, tFins - 12, 4], [tFins - 12, tFins + 9, 6],
      [tFins + 9, tLand - 5, 5], [tLand - 5, tTouch + 12, 7], [tTouch + 12, tSes2 - 30, 4], [tSes2 - 30, T.t_orbit_s + 30, 4],
      [T.t_orbit_s + 30, sStart, own ? 7 : 6], [sStart, M.end, clamp(days * 2.4, 14, 40)]];
    if (cube) segs.push([M.end, tEnd, 4]);
    else {
      const rel = (code, dflt) => { const v = SD.ret_events.find((q) => q[1] === code); return M.deorbit + (v ? v[0] : dflt); };
      const tEI = M.entry, tMain = rel('MAIN_CHUTE', 2728), tRec = Math.min(rel('RECOVERY', 4332), M.hand - 60);
      segs.push([M.end, M.endLab, M.endLab > M.end + 60 ? 4 : 0], [M.endLab, M.deorbit, 5], [M.deorbit, tEI - 20, 6], [tEI - 20, tMain - 8, 12],
        [tMain - 8, M.splash - 20, 8], [M.splash - 20, M.splash + 15, 6], [M.splash + 15, tRec + 30, 5], [tRec + 30, M.hand, 2], [M.hand, M.lab, 4]);
    }
    const pace = segs.filter((x) => x[1] > x[0] && x[2] > 0);
    let acc = 0;
    pace.forEach((x) => { x.p0 = acc; acc += x[2]; x.p1 = acc; });
    const toMission = (p) => { const x = pace.find((y) => p < y.p1) || pace[pace.length - 1]; const k = clamp((p - x.p0) / (x.p1 - x.p0), 0, 1); return x[0] + (x[1] - x[0]) * k; };
    const toPlay = (s) => { const x = pace.find((y) => s < y[1]) || pace[pace.length - 1]; const k = clamp((s - x[0]) / (x[1] - x[0]), 0, 1); return x.p0 + (x.p1 - x.p0) * k; };

    // ---------- state at any mission second ----------
    function state(s) {
      const p = pos(s), kg = clamp(Math.round((s - G.s0) / GRID), 0, n - 1), kb = clamp(Math.round((s - tStart) / GRID), 0, nb - 1);
      const inOrbit = s >= T.t_orbit_s && s < sEnd;
      const st = inOrbit ? G.st[kg] : -1;
      const contact = inOrbit ? passes.filter((x) => s >= x.s0 && s < x.s1).map((x) => x.name) : [];
      const [rate, inSaa] = inOrbit ? doseRate(p.lat, p.lon, SD.dose) : [0, false];
      const phase = phases.find((x) => s >= x.s0 && s < x.s1) || phases[phases.length - 1];
      let last = -1; for (let i = 0; i < ev.length && ev[i].s <= s; i++) last = i;
      const step = ev.filter((x) => x.kind === 'proto' && x.s <= s).pop() || null;
      const cmds = ev.filter((x) => x.cmd && x.s <= s);
      return { s, utc: ms(s), p, phase, sunlit: inOrbit ? !!G.sun[kg] : s < 0 || s > M.splash ? null : true, contact, link: st >= 0 ? SD.stations[st] : null,
               doseRate: rate, inSaa, dose: s < G.s0 ? 0 : G.dose[s >= sEnd ? n - 1 : kg], temp: B.temp[kb], set: B.set[kb], power: B.pw[kb],
               raw: B.raw[kb], queued: B.q[kb], down: B.down[kb], cryo: hold.cryo && s < sStart + 60 ? -80 : null, last, step,
               sentinel: { signed: cmds.length, executed: cmds.filter((x) => x.cmd.final === 'EXECUTE').length, held: cmds.filter((x) => x.cmd.final !== 'EXECUTE').length } };
    }

    const protoT = []; for (let k = 0; k < nb; k++) { const s = tStart + k * GRID; if (s >= sStart && s < M.end) protoT.push(B.temp[k]); }
    const report = {
      launch_utc: new Date(t0).toISOString(), window: 'launch site passes under the dawn-dusk plane (descending)',
      orbit: `${o.alt_km} km, ${o.inc_deg} deg, LTAN ${o.ltan_h}:00`, protocol_days: days, start_utc: new Date(ms(sStart)).toISOString(), end_utc: new Date(ms(M.end)).toISOString(),
      deorbit_utc: cube ? null : new Date(ms(M.deorbit)).toISOString(), deorbit_wait_h: cube ? 0 : +(M.wait / 3600).toFixed(2),
      splash_utc: cube ? null : new Date(ms(M.splash)).toISOString(), splash: M.splashPt, handover_utc: cube ? null : new Date(ms(M.hand)).toISOString(),
      dose_mgy: +dose.toFixed(3), dose_split_mgy: { before_start: +doseSplit[0].toFixed(3), during_protocol: +doseSplit[1].toFixed(3), after: +doseSplit[2].toFixed(3) },
      saa_passes: saaPasses.length, eclipse_min: Math.round(eclS / 60), passes: passes.length, passes_science: passes.filter((x) => science[SD.stations.findIndex((y) => y.id === x.id)]).length,
      imaging_rounds: rounds.length, raw_on_board_mb: Math.round(raw), downlinked_mb: +down.toFixed(1),
      latency_h: lat.length ? { mean: +(lat.reduce((a, b) => a + b, 0) / lat.length / 3600).toFixed(2), max: +(Math.max(...lat) / 3600).toFixed(2) } : null,
      temp_c: protoT.length ? { set: tempC, mean: +(protoT.reduce((a, b) => a + b, 0) / protoT.length).toFixed(2), min: +Math.min(...protoT).toFixed(2), max: +Math.max(...protoT).toFixed(2) } : null,
      start_held_min: Math.round((sStart - M.start) / 60),
      commands: ev.filter((x) => x.cmd).length, escalated: ev.filter((x) => x.cmd && x.cmd.B === 'ESCALATE').length, blocked: ev.filter((x) => x.cmd && x.cmd.final === 'BLOCKED').length,
      launch_peak_g: Math.max(...stack.map((r) => r[4]), ...upper.map((r) => r[4])), max_q_kpa: Math.max(...stack.map((r) => r[5])),
      entry: cube ? null : { peak_g: SD.ret_meta.peak_g, peak_heat_kw_m2: SD.ret_meta.peak_heat_kw_m2, blackout_s: SD.ret_meta.blackout_s, splash_ms: SD.ret_meta.splash_speed_ms },
    };
    return { cfg, e, M, own, cube, go, ready, phases, events: ev, passes, saaPasses, G, B, rounds, pace, playLen: acc, toMission, toPlay, state, pos, report,
             t0, sStart, tStart, tEnd, sEnd, hold, booster, stack, upper };
  }

  const api = { build, rowAt, doseRate, holdTemp, roleOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LelpSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
