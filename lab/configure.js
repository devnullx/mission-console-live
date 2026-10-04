/* LELP-1 mission configurator (lab/configure.html): 1 satellite -> 2 experiment -> 3 protocol and payload guide -> 4 mission.
   Data: data.json from scripts/build_lab_site.py (catalog entries, free-flyer sizing parameters, orbit, eclipse by day of year,
   the twin's launch and return timeline). size() mirrors sentinel/lelp/freeflyer.py; tests/test_catalog.py checks they agree. */
(async function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f0 = (x) => Math.round(x).toLocaleString('en-GB'), f1 = (x) => Number(x).toFixed(1), f2 = (x) => Number(x).toFixed(2);
  const G0 = 9.80665, DAY = 86400;
  let D;
  try { D = await (await fetch('data.json', { cache: 'no-cache' })).json(); }
  catch (e) { $('.cfg-main').innerHTML = '<p>Could not load the configurator data. Reload the page.</p>'; return; }
  const EXPS = D.experiments, byId = Object.fromEntries(EXPS.map((e) => [e.id, e])), ICD = D.icd.L, T = D.twin;
  const [TLO, THI] = D.temp_range;

  // ---------- state, shareable through the URL hash ----------
  const S = { step: 1, mode: 'bay', n: 1, centrifuge: false, xband: false, furnace: false, arch: null, exp: null, days: null, temp: null, launch: '2026-12-01' };
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('m') === 'own') S.mode = 'own';
    S.n = Math.min(4, Math.max(1, +h.get('n') || 1)); S.centrifuge = h.get('c') === '1'; S.xband = h.get('x') === '1'; S.furnace = h.get('f') === '1';
    if (['A', 'B', 'C'].includes(h.get('a'))) S.arch = h.get('a');
    if (byId[h.get('e')]) { S.exp = h.get('e'); S.days = +h.get('d') || null; S.temp = h.get('t') != null ? +h.get('t') : null; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(h.get('l') || '')) S.launch = h.get('l');
    S.step = Math.min(4, Math.max(1, +h.get('s') || 1));
  } catch (e) { /* defaults */ }
  const hashOf = () => {
    const h = new URLSearchParams({ s: S.step, m: S.mode, n: S.n, c: +S.centrifuge, x: +S.xband, f: +S.furnace, l: S.launch });
    if (S.exp) { h.set('e', S.exp); if (S.days) h.set('d', S.days); if (S.temp != null) h.set('t', S.temp); }
    if (S.arch) h.set('a', S.arch);
    return h.toString();
  };
  const save = () => history.replaceState(null, '', '#' + hashOf());

  // ---------- the experiment as configured ----------
  const exp = () => (S.exp ? byId[S.exp] : null);
  const maxDays = () => (S.mode === 'bay' ? D.max_days : 30);
  const days = () => { const e = exp(); return Math.min(maxDays(), S.days || (e ? e.protocol.duration_days : 7)); };
  const temp = () => { const e = exp(); return S.temp != null ? S.temp : e ? e.protocol.temp_c : 37; };
  const hot = () => { const e = exp(); return !!(e && e.services && e.services.hot === 'new'); };
  const module = () => { const e = exp(); return e ? { name: e.title + ' module', kg: e.module.mass_kg, w: e.module.power_peak_w } : { name: 'large-bay module at its limits', kg: ICD.mass_kg, w: ICD.power_w }; };

  // ---------- dedicated satellite sizing: mirrors sentinel/lelp/freeflyer.py ----------
  // mirrors sentinel/lelp/freeflyer.py size(): architecture A (in-flight-only CubeSat), B (sample-only return), C (live return)
  function size(e, opt) {
    const P = D.params, C = D.centrifuge, F = D.furnace, AR = (e && D.arch && D.arch[e.id]) || null;
    const arch = opt.arch || (AR ? AR.arch : 'C'), n = opt.n || (AR && AR.modules) || 1;
    const mod = e ? { name: e.title + ' module', kg: e.module.mass_kg, w: e.module.power_peak_w } : { name: 'large-bay module at its limits', kg: ICD.mass_kg, w: ICD.power_w };
    const pay = [];
    for (let i = 0; i < n; i++) pay.push([mod.name + (n > 1 ? ' ' + (i + 1) : ''), mod.kg, mod.w, 'module']);
    if (opt.centrifuge) pay.push([C.name, C.kg, C.w, 'centrifuge']);
    if (opt.furnace) pay.push([F.name, F.kg, F.w, 'furnace']);
    const xband = !!(opt.xband || opt.furnace), cf = !!opt.centrifuge;
    if (arch === 'A') return { arch: 'A', form: D.cubesat.form, mWet: D.cubesat.wet_kg, basis: D.cubesat.basis, pay, xband, n: 0, capItems: [], busItems: [] };
    // what comes home and what stays: returns per source, times the number of modules for the module's own items
    let rets = arch === 'B' || arch === 'C' ? ((AR && AR.returns) || []).map((r) => [r[0], +r[1], r[2] || 'module']) : [];
    rets = rets.filter((r) => (r[2] === 'module') || (r[2] === 'centrifuge' && cf) || (r[2] === 'furnace' && opt.furnace))
      .flatMap((r) => r[2] === 'module' && n > 1 ? Array.from({ length: n }, (_, i) => [r[0] + ' ' + (i + 1), r[1], 'module']) : [r]);
    if (!rets.length) rets = pay.map((p) => [p[0], p[1], p[3]]);
    const busItems = [];
    for (const k of ['module', 'centrifuge', 'furnace']) {
      const have = pay.filter((p) => p[3] === k).reduce((a, p) => a + p[1], 0);
      if (!have) continue;
      const back = rets.filter((r) => r[2] === k).reduce((a, r) => a + r[1], 0);
      if (have - back > 1e-9) busItems.push([k, have - back]);
    }
    if (arch === 'B' && AR && AR.transfer) busItems.push(['cassette transfer mechanism (rotor to capsule)', P.transfer_kg]);
    const capItems = rets.map((r) => [r[0], r[1]]);
    if (arch === 'B') capItems.push(['sample drawer, optical window, dry-break couplings', P.drawer_kg], ['drawer thermoelectric block', P.drawer_tec_kg]);
    const nTec = pay.filter((p) => p[3] !== 'furnace').length;
    const fe = Math.max(...D.eclipse), te = fe * D.orbit.period_min, period = D.orbit.period_min * 60;
    const plPeak = pay.reduce((a, p) => a + p[2], 0) + P.tec_peak_w * nTec + (cf ? C.counter_w : 0);
    let plAvg = pay.filter((p) => p[3] !== 'furnace').reduce((a, p) => a + P.payload_duty * p[2], 0) + P.tec_avg_w * nTec + (cf ? C.counter_w : 0);
    if (opt.furnace) plAvg += F.kwh_per_day * 1000 / 24;
    const pAvg = plAvg + P.bus_avg_w + (xband ? P.xband_avg_w : 0), pPeak = plPeak + P.bus_peak_w;
    const pSa = P.power_margin * pAvg * (fe / P.xe + (1 - fe) / P.xd) / (1 - fe);
    const area = pSa / (P.solar_const_w_m2 * P.cell_eff * P.packing * P.temp_loss), arrayKg = pSa / P.array_w_per_kg;
    const eEcl = pAvg * te / 60 / (P.dod_cycling * P.discharge_eff), eAsc = (P.tec_peak_w * nTec + P.bus_avg_w) * P.ascent_h / P.dod_once;
    let eFur = 0;
    if (opt.furnace) {        // time-stepped run from eclipse exit: melt-back, then solidification; array only in sunlight
      const pBase = pAvg - F.kwh_per_day * 1000 / 24, pSun = pSa * P.xd, melt = F.run_h * 3600;
      const total = melt + (F.kwh_per_day * 1000 - F.w * F.run_h) / F.solid_w * 3600;
      let en = 0, worst = 0;
      for (let t = 0; t < total; t += 30) {
        const load = pBase + (t < melt ? F.w : F.solid_w), sun = (t % period) / period < 1 - fe;
        en = Math.max(0, en + (load - (sun ? pSun : 0)) * 30 / 3600); worst = Math.max(worst, en);
      }
      eFur = worst / P.dod_once;
    }
    const eB = Math.max(eEcl, eAsc, eFur, 100), battKg = eB / P.batt_wh_per_kg + 0.5;
    const eCap = (((AR && AR.hold_w) || (arch === 'B' ? P.drawer_tec_avg_w : P.tec_avg_w * nTec)) + P.cap_avionics_w) * P.return_hold_h / P.dod_once;
    const inner = capItems.reduce((a, c) => a + c[1], 0) + P.cap_avionics_kg + P.cap_thermal_kg + eCap / P.batt_wh_per_kg;
    const mCap = Math.max(P.cap_min_kg, inner / (1 - P.f_tps - P.f_recovery - P.f_cap_struct) * (1 + P.system_margin));
    const dia = Math.sqrt(4 * mCap / (Math.PI * P.cd * P.beta_kg_m2));
    const fixed = busItems.reduce((a, b) => a + b[1], 0) + P.obc_radio_kg + (xband ? P.xband_kg : 0) + P.adcs_kg + (cf ? C.counter_kg : 0)
      + P.thermal_kg + P.thermal_kg_per_w * pAvg + P.sep_kg + P.launch_if_kg + arrayKg + battKg;
    const ratio = Math.exp(P.dv_ms / (P.isp_s * G0)) - 1;
    let mProp = 0, mDry = 0;
    for (let i = 0; i < 60; i++) { mDry = (mCap + (fixed + P.prop_dry_fixed_kg + P.prop_dry_frac * mProp) * (1 + P.system_margin)) / (1 - P.struct_frac - P.harness_frac); mProp = mDry * ratio; }
    const mWet = mDry + mProp, nThr = Math.max(1, Math.ceil(mWet * P.dv_ms / (0.1 * period) / P.thrust_n));
    const r = 6378137 + D.orbit.alt_km * 1e3, nn = Math.sqrt(3.986004418e14 / (r * r * r));
    return { arch, pay, xband, n: pay.length, cf, furnace: !!opt.furnace, pAvg, pPeak, pSa, area, eB, mCap, dia, eCap, mDry, mProp, mWet, nThr,
             burn: mWet * P.dv_ms / (nThr * P.thrust_n), gg: 2 * nn * nn * P.payload_offset_m / G0, capItems, busItems,
             retKg: capItems.reduce((a, c) => a + c[1], 0) };
  }
  window.__lelpSize = size;   // for the parity test
  const canA = (e) => !!(e && D.arch[e.id] && (D.arch[e.id].arch === 'A' || (D.arch[e.id].options || []).includes('A')));
  const archOf = () => { const e = exp(), a = e && D.arch[e.id] ? D.arch[e.id].arch : 'C'; return S.arch && (S.arch !== 'A' || canA(e)) ? S.arch : a; };
  const sz = () => size(exp(), Object.assign({}, S, { arch: archOf() }));
  const drawData = (z) => z.arch === 'A' ? { name: 'Your satellite', arch: 'A', wetKg: z.mWet, form: z.form }
    : { name: 'Your satellite', arch: z.arch, capD: z.dia, capKg: z.mCap, wetKg: z.mWet, busKg: z.mDry - z.mCap, arrayM2: z.area, arrayW: z.pSa, battWh: z.eB,
        nThr: z.nThr, xband: z.xband, furnace: z.furnace, centrifuge: z.cf, lit: !!(exp() && exp().services && exp().services.light === 'new'), retKg: z.retKg };

  const bayMass = () => {     // LELP-1 launch mass with your bays in place of default payload sheets
    const m = module(), C = D.centrifuge;
    return T.lelp_launch_kg + S.n * (m.kg - T.bay_default_kg) + (S.centrifuge ? C.kg - T.bay_default_kg : 0);
  };

  // ---------- fit checks (the same limits as the customer-spec checker) ----------
  function checks() {
    const e = exp(), m = module(), out = [];
    out.push(['Module mass', m.kg <= ICD.mass_kg + 1e-9 ? 'ok' : 'fail', `${f1(m.kg)} of ${f1(ICD.mass_kg)} kg`]);
    out.push(['Module peak power', m.w <= ICD.power_w ? 'ok' : 'fail', `${f0(m.w)} of ${f0(ICD.power_w)} W`]);
    const t = temp();
    if (t >= TLO && t <= THI) out.push(['Temperature', 'ok', `${t} °C in the bay block (${TLO} to ${THI} °C)`]);
    else out.push(['Temperature', hot() ? 'new' : 'fail', hot() ? `${t} °C from the module's own hot zone: a new bay type` : `${t} °C is outside ${TLO} to ${THI} °C`]);
    const dd = days();
    if (S.mode === 'bay') out.push(['Duration', dd <= D.max_days ? 'ok' : 'fail', `${dd} days; LELP-1 runs up to ${D.max_days}`]);
    else out.push(['Duration', e && dd > e.protocol.duration_days ? 'warn' : 'ok', e && dd > e.protocol.duration_days ? `${dd} days: longer than the ${e.protocol.duration_days}-day template, so media and reservoirs must be re-sized (not modelled)` : `${dd} days`]);
    if (S.mode === 'bay') { const lm = bayMass(); out.push(['LELP-1 launch mass', lm <= T.lelp_alloc_kg ? 'ok' : 'fail', `${f1(lm)} of ${f0(T.lelp_alloc_kg)} kg with your bays`]); }
    if (S.mode === 'bay' && S.furnace) out.push(['Metallic furnace', 'fail', 'needs about 200 W and two slots: only on your own satellite']);
    if (e) { const r = e.sample_return; out.push(['Return temperature', r.temp_c >= TLO && r.temp_c <= THI ? 'ok' : 'warn', `${r.temp_c} °C, lab within ${r.max_hours} h`]); }
    return out;
  }
  const CHIP = { ok: ['FITS', 'good'], fail: ['NO', 'bad'], warn: ['CHECK', 'warn'], new: ['NEW BAY TYPE', 'warn'] };
  const checkTable = () => `<table class="tbl chk">${checks().map(([a, s, b]) => `<tr><td>${esc(a)}</td><td><span class="chip ${CHIP[s][1]}">${CHIP[s][0]}</span></td><td>${esc(b)}</td></tr>`).join('')}</table>`;

  // ---------- step 1: the satellite ----------
  function svgSat() {
    if (S.mode === 'bay') {
      const cells = [];
      for (let k = 0; k < 32; k++) {
        const col = k % 8, row = Math.floor(k / 8), x = 104 + col * 19, y = 52 + row * 30;
        const mine = k >= 18 && k < 18 + S.n, cf = S.centrifuge && k === 18 + S.n;
        cells.push(`<rect x="${x}" y="${y}" width="16" height="26" rx="2" class="${mine ? 'b-mine' : cf ? 'b-cf' : 'b-std'}"/>`);
      }
      return `<svg viewBox="0 0 360 230" class="satsvg" role="img" aria-label="LELP-1 with your bays highlighted">
        <rect x="96" y="40" width="168" height="134" rx="8" class="hull"/>${cells.join('')}
        <rect x="120" y="22" width="120" height="14" rx="5" class="hiad"/><text x="180" y="16" class="lbl" text-anchor="middle">packed heat shield, 2.6 m when inflated</text>
        <rect x="150" y="174" width="60" height="44" class="stage"/><text x="180" y="227" class="lbl" text-anchor="middle">RUPAK upper stage</text>
        <rect x="10" y="96" width="82" height="22" class="wing"/><rect x="268" y="96" width="82" height="22" class="wing"/>
        <text x="300" y="70" class="lbl">your bays</text><rect x="284" y="62" width="10" height="10" class="b-mine"/>
        ${S.centrifuge ? '<text x="300" y="88" class="lbl">1 g centrifuge</text><rect x="284" y="80" width="10" height="10" class="b-cf"/>' : ''}
      </svg>`;
    }
    if (window.LelpSatDraw) return window.LelpSatDraw(drawData(sz()));
    const z = sz(), wing = 40 + z.area * 120, cap = 50 + z.dia * 60;
    const mods = z.pay.map((p, i) => `<rect x="${180 - z.pay.length * 9 + i * 18}" y="${82 - cap / 4}" width="14" height="14" rx="2" class="${/centrifuge/.test(p[0]) ? 'b-cf' : /furnace/.test(p[0]) ? 'b-hot' : 'b-mine'}"/>`).join('');
    return `<svg viewBox="0 0 360 230" class="satsvg" role="img" aria-label="Your dedicated satellite">
      <path d="M${180 - cap / 2} ${110} Q180 ${110 - cap * 0.95} ${180 + cap / 2} ${110} Z" class="capsule"/>${mods}
      <rect x="150" y="112" width="60" height="62" rx="4" class="hull"/>
      <rect x="${150 - wing}" y="132" width="${wing}" height="20" class="wing"/><rect x="210" y="132" width="${wing}" height="20" class="wing"/>
      <rect x="168" y="174" width="24" height="10" class="stage"/>
      <text x="180" y="200" class="lbl" text-anchor="middle">${f0(z.mWet)} kg at launch · capsule Ø ${f2(z.dia)} m · array ${f2(z.area)} m²</text>
    </svg>`;
  }
  function step1() {
    const own = S.mode === 'own', z = own ? sz() : null, e = exp();
    return `<h2>1 · Choose how your experiment flies</h2>
    <div class="modes">
      <label class="mode${!own ? ' on' : ''}"><input type="radio" name="mode" value="bay"${!own ? ' checked' : ''}><b>A bay on LELP-1</b>
        <span>Share the 32-bay lab: launch on RUPAK, up to ${D.max_days} days at ${D.orbit.alt_km} km, the whole lab comes home. The efficient way to fly a ${f0(ICD.mass_kg)} kg payload.</span></label>
      <label class="mode${own ? ' on' : ''}"><input type="radio" name="mode" value="own"${own ? ' checked' : ''}><b>Your own satellite</b>
        <span>A dedicated free-flyer sized around your payload: your schedule, up to 30 days, a quieter ride, room for a furnace or a centrifuge.</span></label>
    </div>
    <div class="opts">
      <label>${own ? 'Payload modules' : 'Bays'} <input type="number" id="o-n" min="1" max="4" value="${S.n}"></label>
      <label><input type="checkbox" id="o-c"${S.centrifuge ? ' checked' : ''}> 1 g centrifuge ${own ? 'module' : 'positions'} <small>in-flight 1 g control</small></label>
      ${own ? `<label><input type="checkbox" id="o-x"${S.xband ? ' checked' : ''}> X-band downlink <small>for video</small></label>
      <label><input type="checkbox" id="o-f"${S.furnace ? ' checked' : ''}${hot() || S.furnace ? '' : ' disabled'}> Metallic furnace <small>${hot() ? 'about 200 W, 700 to 800 °C' : 'for solidification experiments'}</small></label>` : ''}
    </div>
    ${own ? `<div class="opts arch"><span>What comes home</span>${[['B', 'samples only'], ['C', 'the live culture system'], ['A', 'nothing: read in orbit']]
      .filter(([k]) => k !== 'A' || canA(e))
      .map(([k, t]) => `<label><input type="radio" name="arch" value="${k}"${archOf() === k ? ' checked' : ''}> <span class="archchip ${k}">${k}</span> ${t}</label>`).join('')}
      ${e && D.arch[e.id] ? `<small>recommended for this experiment: ${D.arch[e.id].arch} (${esc(D.arch[e.id].why)})</small>` : ''}</div>` : ''}
    <div class="satview">${svgSat()}
      <div class="satnums">${own && z.arch === 'A' ? `
        <div><span>Satellite</span><b>${esc(z.form)}</b></div><div><span>Launch mass</span><b>about ${f0(z.mWet)} kg</b></div>
        <div><span>Return</span><b>none: data only</b></div><div><span>Heritage</span><b>EcAMSat, 2017</b></div>` : own ? `
        <div><span>Launch mass</span><b>${f1(z.mWet)} kg</b></div><div><span>Return capsule</span><b>${f1(z.mCap)} kg · Ø ${f2(z.dia)} m</b></div>
        <div><span>Comes home</span><b>${f1(z.retKg)} kg ${z.arch === 'C' ? 'live, powered' : 'of samples'}</b></div><div><span>Service module</span><b>${f1(z.mDry - z.mCap)} kg</b></div>
        <div><span>Array</span><b>${f0(z.pSa)} W · ${f2(z.area)} m²</b></div><div><span>Battery</span><b>${f0(z.eB)} Wh</b></div>
        <div><span>Propellant</span><b>${f1(z.mProp)} kg for ${f0(D.params.dv_ms)} m/s</b></div><div><span>Load avg / peak</span><b>${f0(z.pAvg)} / ${f0(z.pPeak)} W</b></div>` : `
        <div><span>Your bays</span><b>${S.n}${S.centrifuge ? ' + centrifuge' : ''} of 32</b></div><div><span>LELP-1 launch mass</span><b>${f1(bayMass())} of ${f0(T.lelp_alloc_kg)} kg</b></div>
        <div><span>Per bay</span><b>${f1(ICD.mass_kg)} kg · ${f0(ICD.power_w)} W · ${ICD.wells} wells</b></div><div><span>Bay temperature</span><b>${TLO} to ${THI} °C</b></div>`}
      </div></div>
    <p class="small">${own ? `Sized for ${e ? esc(e.title) : 'a large-bay module at its limits (load an experiment in step 2 to size it for yours)'} by the same model as <a href="satellites.html#method">the fifteen dedicated designs</a>. First-order estimates.` : 'Bays are booked in the large-bay rows from bay 19 (17 and 18 fly RadSenRegen and Bengaluru Biosciences in the twin); every manifest is checked against the 250 kg allocation.'}</p>`;
  }

  // ---------- step 2: load an experiment ----------
  function step2() {
    const e = exp();
    const card = (x) => `<button type="button" class="xcard pick${x.id === S.exp ? ' on' : ''}${x.area ? ' must' : ''}" data-id="${esc(x.id)}">
      <span class="n mono">${String(x.n).padStart(2, '0')}</span><span class="f">${esc(x.area || x.field)}</span><h3>${esc(x.title)}</h3>
      <span class="meta"><span class="chip">${x.protocol.temp_c} °C</span><span class="chip">${x.protocol.duration_days} days</span>${x.services && x.services.hot === 'new' ? '<span class="chip warn">new bay type</span>' : ''}</span></button>`;
    const tune = e ? `<div class="loaded card"><h3>Loaded: ${esc(e.title)}</h3><p>${esc(e.why)}</p>
      <div class="opts"><label>Days in orbit <input type="number" id="o-d" min="1" max="${maxDays()}" value="${days()}"></label>
      <label>Temperature °C <input type="number" id="o-t" min="${hot() ? 20 : TLO}" max="${hot() ? 90 : THI}" step="0.5" value="${temp()}"></label>
      <button type="button" class="btn ghost" id="o-reset">Template values</button></div>${checkTable()}</div>` : '<p class="sub">Pick a template. Its protocol, module and payload instructions load into steps 3 and 4.</p>';
    return `<h2>2 · Load an experiment</h2>${tune}
      <h3 class="area-h">Core capability areas</h3><div class="xgrid">${EXPS.filter((x) => x.area).map(card).join('')}</div>
      <h3 class="area-h">More experiments</h3><div class="xgrid">${EXPS.filter((x) => !x.area).map(card).join('')}</div>`;
  }

  // ---------- step 3: protocol and payload guide ----------
  const scaledSteps = (e) => LelpPlan.scaledSteps(e, days());
  function guide(e) {
    const p = e.protocol, r = e.sample_return, m = e.module;
    const first = p.launch_state.split(/\.\s|;\s/)[0];          // the primary launch state; later sentences are options
    const live = /\blive\b/i.test(first), cryo = !live && /cryopreserv|-80 ?c|−80/i.test(first);
    const res = m.items.filter((i) => /reservoir|fluid|medium|media|fixative/i.test(i.item)).map((i) => i.item);
    const own = S.mode === 'own';
    return [
      ['Check your payload', `Build or order the module to the ${own ? 'payload' : 'large-bay'} interface: at most ${f1(ICD.mass_kg)} kg and ${f0(ICD.power_w)} W peak, inside BSL-2 triple containment. The template module is ${f1(m.mass_kg)} kg and ${f0(m.power_peak_w)} W: ${m.items.map((i) => i.item).join('; ')}.`],
      ['Prepare your samples', `${p.sample.replace(/\.$/, '')}. ${cryo ? 'Cryopreserve them and ship them on dry ice to the integration site. They ride in the passive −80 °C cassette and the bay thaws them automatically after you sign the start.' : `Launch state: ${p.launch_state.replace(/\.$/, '')}.`}`],
      ['Prepare the ground control', e.ground_control],
      ['Fill the cassette and the reservoirs', `${p.container.replace(/\.$/, '')}.${res.length ? ' Fill: ' + res.join('; ') + '.' : ''}`],
      ['Seal and check', 'Close the containment, run the pressure-decay leak check, weigh the module and run the power-on check on the integration stand. The integration team signs the custody ledger.'],
      ['Hand it over', cryo ? `Hand over the cryo cassette and the module 24 h before launch (late load). The cassette holds −80 °C passively; the bay is set to ${temp()} °C for the thaw.`
        : live ? `Hand over up to 24 h before launch (late load; mature tissue up to 48 h). The bay is powered on the pad and through ascent at the launch temperature in your protocol.` : 'Hand over up to 24 h before launch with the rest of the payload.'],
      ['Sign your start', 'After orbit insertion you sign the start command with your own ML-DSA-87 key. Sentinel checks that the bay is yours and that it is ready (for cells: the culture block at temperature) before anything runs.'],
      ['Follow it from the ground', `Every day you receive: ${e.in_flight.map((x) => x.name).join('; ')}. You can preserve early${own ? '' : ' or book arm passes to the central microscope'}; every command is signed and checked.`],
      ['Collect your samples', `The courier receives your ${own ? 'capsule payload' : 'module'} on the recovery ship about ${Math.round(T.handover_after_splash_s / 60)} min after splashdown, at ${r.temp_c} °C, with the signed custody ledger. ${r.note}`],
      ['Analyse', `In your lab: ${e.post_flight.map((x) => x.name).join('; ')}.`],
    ];
  }
  function step3() {
    const e = exp();
    if (!e) return '<h2>3 · Protocol and payload guide</h2><p class="sub">Load an experiment in step 2 first.</p>';
    const st = scaledSteps(e), scaled = days() !== e.protocol.duration_days;
    return `<h2>3 · Your experiment: ${esc(e.title)}</h2>
      <p class="lede small-lede">${esc(e.why)}</p>
      <div class="two"><div><h3>Protocol${scaled ? ` · scaled from the ${e.protocol.duration_days}-day template to ${days()} days` : ''}</h3>
        <p><b>Sample.</b> ${esc(e.protocol.sample)} <b>Light and gas.</b> ${esc(e.protocol.light_gas)}</p>
        <ol class="timeline">${st.map((s) => `<li><span class="mono">day ${s.day}</span><p>${esc(s.action)}</p></li>`).join('')}</ol></div>
      <div><h3>Measured in orbit</h3><ul class="meas">${e.in_flight.map((x) => `<li><b>${esc(x.name)}</b> ${esc(x.method)}</li>`).join('')}</ul>
        <h3>Measured after the return</h3><ul class="meas">${e.post_flight.map((x) => `<li><b>${esc(x.name)}</b> ${esc(x.method)}</li>`).join('')}</ul>
        <h3>Fit</h3>${checkTable()}</div></div>
      <h2 class="guide-h">Payload guide: place your cells, and it is good to go</h2>
      <ol class="guide">${guide(e).map(([a, b]) => `<li><b>${esc(a)}</b><p>${esc(b)}</p></li>`).join('')}</ol>
      ${(D.modules || []).includes(e.id) ? '<p class="small">Your payload module is drawn below: what you fill before handover is blue. <a href="' + esc(e.id) + '.html#module-cad">Checks and parts list</a>.</p>' : ''}
      <p class="small">Template researched and fact-checked against its sources (<a href="${esc(e.id)}.html">full page with references</a>). Limits: ${esc(e.limitations[0] || '')}</p>`;
  }

  // ---------- step 4: the mission that follows (lab_plan.js: launch window, timeline, recovery-zone deorbit) ----------
  const mission = () => LelpPlan.timeline(D, { mode: S.mode, days: days(), exp: exp(), arch: archOf(), launch: S.launch });
  const when = (t0, s) => { const d = new Date(t0 + s * 1000); return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; };
  const rel = (s) => { const a = Math.abs(s), dd = Math.floor(a / DAY), h = Math.floor(a % DAY / 3600), m = Math.floor(a % 3600 / 60); return (s < 0 ? 'L−' : 'T+') + (dd ? dd + ' d ' : '') + h + ' h ' + String(m).padStart(2, '0') + ' min'; };
  function step4() {
    const M = mission(), own = S.mode === 'own', z = own ? sz() : null;
    const span = M.ev[M.ev.length - 1][0] - M.ev[0][0];
    const bar = M.ev.map(([s, a]) => `<i style="left:${((s - M.ev[0][0]) / span * 100).toFixed(2)}%" title="${esc(a)}"></i>`).join('');
    return `<h2>4 · Your mission</h2>
      <div class="opts"><label>Launch date <input type="date" id="o-l" value="${S.launch}" min="2026-10-04"></label></div>
      <div class="facts">${[
        ['Flies on', own ? `your own satellite, ${f0(z.mWet)} kg` : `LELP-1, ${S.n} bay${S.n > 1 ? 's' : ''}`],
        ['Orbit', `${D.orbit.alt_km} km dawn-dusk SSO, ${f1(D.orbit.period_min)} min`],
        ['In orbit', `${f1((M.splash - D.twin.t_orbit_s) / DAY)} days`],
        ['Eclipses', M.eclMin > 0.5 ? `up to ${f0(M.eclMin)} min per orbit` : 'none: always in sunlight'],
        ['Radiation', `about ${f1(M.doseMgy)} mGy (model value)`],
        ['Microgravity', own && z.arch !== 'A' ? `about ${(z.gg * 1e7).toFixed(1)} × 10⁻⁷ g quasi-steady; vibration from wheels${S.centrifuge ? ' and the centrifuge' : ''} dominates` : own ? 'free-flyer, no robotic arm' : 'about 7 × 10⁻⁷ g quasi-steady; quiet windows around the arm'],
      ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
      <div class="mbar">${bar}</div>
      <table class="tbl mission"><thead><tr><th>When</th><th>Mission time</th><th>Event</th><th></th></tr></thead><tbody>
      ${M.ev.map(([s, a, b]) => `<tr><td class="mono">${when(M.t0, s)}</td><td class="mono">${rel(s)}</td><td><b>${esc(a)}</b></td><td>${b}</td></tr>`).join('')}</tbody></table>
      <p class="small">${M.cube ? 'Your CubeSat reads the experiment in orbit and sends the results down every day; nothing comes back, so post-flight assays need a bay on LELP-1 or a sample-return satellite.' : own ? `Your satellite flies your protocol only. The deorbit and entry copy LELP-1's (same orbit and ballistic coefficient); the capsule's smaller nose sees about twice LELP-1's peak heat flux, and an unguided capsule lands tens of km from its aim point, so recovery takes hours. Deorbit burn about ${f0(sz().burn)} s on ${sz().nThr} × 22 N thrusters.` : `On LELP-1 the lab stays in orbit until the longest protocol on board is preserved (${f1(M.labDays)} days with this manifest), then returns. The twin's 21-minute handover assumes the ship waits at the predicted splash point.`} Launch, return and handover times come from a run of the mission twin.</p>
      <div class="sim-cta"><a class="btn" href="simulate.html#${esc(hashOf())}">▶ Run the mission simulation</a><a class="btn ghost" href="../portal.html#book=${encodeURIComponent(hashOf())}">Book this mission</a>
        <span class="small">Launch, orbit, your protocol day by day, the return and the handover, played end to end from the twin's models.</span></div>
      <p><button type="button" class="btn ghost" id="o-dl">Download your mission file (JSON)</button></p>`;
  }

  // ---------- summary and download ----------
  function summary() {
    const e = exp(), own = S.mode === 'own', z = own ? sz() : null, M = mission(), bad = checks().some((c) => c[1] === 'fail');
    return `<h3>Your mission</h3><dl>
      <dt>Satellite</dt><dd>${own ? `own ${z.arch === 'A' ? 'CubeSat' : 'free-flyer'} (${z.arch}) · ${f0(z.mWet)} kg` : `LELP-1 · ${S.n} bay${S.n > 1 ? 's' : ''}`}${S.centrifuge ? ' · 1 g control' : ''}${own && S.furnace ? ' · furnace' : ''}</dd>
      <dt>Experiment</dt><dd>${e ? esc(e.title) : '<i>not loaded</i>'}</dd>
      <dt>Protocol</dt><dd>${days()} days at ${temp()} °C</dd>
      <dt>Launch</dt><dd>${esc(S.launch)}</dd><dt>${M.cube ? 'Last reading' : 'Splashdown'}</dt><dd>${when(M.t0, M.cube ? M.end : M.splash).slice(0, 10)}</dd>
      <dt>Fit</dt><dd>${bad ? '<span class="chip bad">CHECK STEP 2</span>' : '<span class="chip good">FLYABLE</span>'}</dd></dl>
      ${e ? `<p><a class="btn" href="simulate.html#${esc(hashOf())}">▶ Simulate this mission</a> <a class="btn ghost" href="../portal.html#book=${encodeURIComponent(hashOf())}">Book this mission</a></p>` : ''}
      <p><button type="button" class="btn ghost" id="o-dl2">Download (JSON)</button></p>
      <p class="small">Share this configuration: the page address keeps it.</p>`;
  }
  function download() {
    const e = exp(), own = S.mode === 'own', z = own ? sz() : null, M = mission();
    const file = {
      generated_by: 'LELP-1 mission configurator, build ' + D.build, mode: own ? 'dedicated satellite' : 'LELP-1 bays',
      satellite: own && z.arch === 'A' ? { architecture: 'A, in-flight only', form: z.form, launch_kg: z.mWet, basis: z.basis }
        : own ? { architecture: z.arch, launch_kg: +f1(z.mWet), capsule_kg: +f1(z.mCap), capsule_diameter_m: +f2(z.dia), comes_home: z.capItems.map(([n, kg]) => ({ item: n, kg })), stays_in_service_module: z.busItems.map(([n, kg]) => ({ item: n, kg: +f2(kg) })), array_w: Math.round(z.pSa), array_m2: +f2(z.area), battery_wh: Math.round(z.eB), propellant_kg: +f1(z.mProp), thrusters: z.nThr, note: 'first-order estimate' }
        : { bays: S.n, centrifuge_positions: S.centrifuge, lelp1_launch_kg: +f1(bayMass()) },
      experiment: e ? { template: e.id, title: e.title, days: days(), temp_c: temp(), protocol: scaledSteps(e), in_flight: e.in_flight, post_flight: e.post_flight, sample_return: e.sample_return, ground_control: e.ground_control, payload_guide: guide(e).map(([a, b]) => ({ step: a, text: b })) } : null,
      checks: checks().map(([a, s, b]) => ({ check: a, status: s, detail: b })),
      mission: M.ev.map(([s, a, b]) => ({ utc: when(M.t0, s), t_s: s, event: a, detail: String(b).replace(/<[^>]+>/g, '') })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `lelp1-mission-${S.exp || 'draft'}.json` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- render and wire ----------
  const STEPS = { 1: step1, 2: step2, 3: step3, 4: step4 };
  let lastCad = '';
  function render() {
    for (const k of [1, 2, 3, 4]) { const sec = $(`.cfg-step[data-step="${k}"]`); sec.hidden = k !== S.step; if (k === S.step) sec.innerHTML = STEPS[k](); }
    $$('#cfg-steps li').forEach((li) => { const k = +li.dataset.step; li.classList.toggle('on', k === S.step); li.classList.toggle('done', k < S.step); });
    $('#cfg-sum').innerHTML = summary();
    const cad = $('.cfg-cad'), e = exp();
    if (cad) {
      const show = S.step === 1 && S.mode === 'own' && !!e && !!window.LelpCad;
      const showMod = S.step === 3 && !!e && !!window.LelpCad && (D.modules || []).includes(e.id);
      const note = cad.querySelector('.cfg-cad-note');
      cad.hidden = !show && !showMod;
      if (window.LelpCad && S.mode !== 'bay') window.LelpCad.mark([]);
      if (window.LelpCad) window.LelpCad.highlight(showMod ? 'sample__' : '');
      if (showMod) {
        cad.querySelector('h3').textContent = 'Your payload module in CAD: what you load is blue';
        if (note) note.textContent = 'Every item in the module sheet, packed into the bay (cad/build_modules.py). Blue: the cassette, plates, chips or cryo cassette you fill before handover. Front panel left off so the inside shows.';
        const nm = 'MOD-' + e.id;
        if (nm !== lastCad) { lastCad = nm; window.LelpCad.views([{ name: nm, label: 'Payload module', kind: 'module' }]); }
      } else if (note) note.textContent = 'Parametric CadQuery model of the baseline design (catalog options); the numbers above follow your options. STEP for engineering, GLB for viewing.';
      if (show) { const nm = 'SP-' + D.codes[e.id] + (archOf() === 'A' ? '-6U' : ''); if (nm !== lastCad) { lastCad = nm; window.LelpCad.show(nm, archOf() !== 'A'); } }
      const showBay = S.step === 1 && S.mode === 'bay' && !!window.LelpCad;
      if (showBay) {
        cad.hidden = false; cad.querySelector('h3').textContent = 'LELP-1 in CAD: your bays in blue';
        if (lastCad !== 'LELP-1') { lastCad = 'LELP-1'; window.LelpCad.show('LELP-1', true); }
        window.LelpCad.mark(Array.from({ length: S.n + (S.centrifuge ? 1 : 0) }, (_, i) => 19 + i));
      } else if (show) cad.querySelector('h3').textContent = "CAD of this experiment's baseline satellite";
    }
    $('#cfg-prev').disabled = S.step === 1; $('#cfg-next').textContent = S.step === 4 ? 'Start over' : 'Next →';
    save(); wire();
  }
  function setExp(id) {
    S.exp = id; S.days = null; S.temp = null; S.arch = null; S.n = (D.arch[id] && D.arch[id].modules) || 1;
    const e = byId[id], sv = e.services || {};
    S.centrifuge = sv.centrifuge === 'new'; S.xband = sv.video === 'opt' || sv.video === 'new'; S.furnace = S.mode === 'own' && sv.hot === 'new';
  }
  function wire() {
    $$('input[name="mode"]').forEach((r) => { r.onchange = () => { S.mode = r.value; if (S.mode === 'bay') S.furnace = false; else if (hot()) S.furnace = true; render(); }; });
    $$('input[name="arch"]').forEach((r) => { r.onchange = () => { S.arch = r.value; render(); }; });
    const num = (id, fn) => { const el = $(id); if (el) el.onchange = () => { fn(el); render(); }; };
    num('#o-n', (el) => { S.n = Math.min(4, Math.max(1, Math.round(+el.value || 1))); });
    num('#o-d', (el) => { S.days = Math.min(maxDays(), Math.max(1, Math.round(+el.value || 1))); });
    num('#o-t', (el) => { const v = +el.value; S.temp = isFinite(v) ? v : null; });
    num('#o-l', (el) => { if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) S.launch = el.value; });
    const chk = (id, key) => { const el = $(id); if (el) el.onchange = () => { S[key] = el.checked; render(); }; };
    chk('#o-c', 'centrifuge'); chk('#o-x', 'xband'); chk('#o-f', 'furnace');
    $$('.pick').forEach((b) => { b.onclick = () => { setExp(b.dataset.id); render(); }; });
    const rs = $('#o-reset'); if (rs) rs.onclick = () => { setExp(S.exp); render(); };
    ['#o-dl', '#o-dl2'].forEach((id) => { const el = $(id); if (el) el.onclick = download; });
  }
  $('#cfg-prev').onclick = () => { S.step = Math.max(1, S.step - 1); render(); window.scrollTo({ top: $('.cfg').offsetTop - 70 }); };
  $('#cfg-next').onclick = () => { S.step = S.step === 4 ? 1 : S.step + 1; render(); window.scrollTo({ top: $('.cfg').offsetTop - 70 }); };
  $$('#cfg-steps li').forEach((li) => { li.onclick = () => { S.step = +li.dataset.step; render(); }; });
  render();
})();
