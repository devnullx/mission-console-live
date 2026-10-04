/* LELP-1 mission plan, shared by the configurator (configure.js) and the mission simulation (sim.js): the launch window
   into the dawn-dusk plane, the mission timeline from the twin's event offsets, the protocol scaled to the chosen days, and
   the deorbit opportunity that puts the splashdown in the recovery zone.
   Orbit geometry: circular orbit on a spherical Earth, the ascending node locked to the mean Sun (sun-synchronous at the
   twin's LTAN), Greenwich sidereal time and a low-precision solar ephemeris (Astronomical Almanac, about 0.01 deg).
   Runs in the browser (window.LelpPlan) and in node (require) for the tests. */
(function (root) {
  'use strict';
  const DAY = 86400, D2R = Math.PI / 180, MU = 3.986004418e14, RE = 6378137, RE_KM = 6378.137;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const wrap180 = (d) => ((d + 180) % 360 + 360) % 360 - 180;
  const jd = (ms) => ms / 86400000 + 2440587.5;
  const gmst = (ms) => ((280.46061837 + 360.98564736629 * (jd(ms) - 2451545.0)) % 360) * D2R;

  function sun(ms) {
    const n = jd(ms) - 2451545.0, L = (280.460 + 0.9856474 * n) * D2R, g = (357.528 + 0.9856003 * n) * D2R;
    const lam = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R, eps = (23.439 - 4e-7 * n) * D2R;
    return { ra: Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec: Math.asin(Math.sin(eps) * Math.sin(lam)),
             v: [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)] };
  }

  const Orbit = {
    sun, gmst, RE_KM,
    period(o) { const r = RE + o.alt_km * 1000; return 2 * Math.PI * Math.sqrt(r * r * r / MU); },
    speed(o) { return Math.sqrt(MU / (RE + o.alt_km * 1000)); },
    raan(ms, o) { return sun(ms).ra + (o.ltan_h - 12) * 15 * D2R; },              // sun-synchronous: the node follows the Sun
    normal(ms, o) { const W = Orbit.raan(ms, o), i = o.inc_deg * D2R; return [Math.sin(i) * Math.sin(W), -Math.sin(i) * Math.cos(W), Math.cos(i)]; },
    eci(u, ms, o, altKm) {           // position at argument of latitude u (rad), metres, inertial frame
      const r = RE + 1000 * (altKm == null ? o.alt_km : altKm), W = Orbit.raan(ms, o), i = o.inc_deg * D2R;
      const cu = Math.cos(u), su = Math.sin(u), cW = Math.cos(W), sW = Math.sin(W), ci = Math.cos(i), si = Math.sin(i);
      return [r * (cW * cu - sW * su * ci), r * (sW * cu + cW * su * ci), r * su * si];
    },
    geo(p, ms) { const r = Math.hypot(p[0], p[1], p[2]); return { lat: Math.asin(p[2] / r) / D2R, lon: wrap180((Math.atan2(p[1], p[0]) - gmst(ms)) / D2R) }; },
    site(lat, lon, ms) { const a = lat * D2R, b = lon * D2R + gmst(ms); return [RE * Math.cos(a) * Math.cos(b), RE * Math.cos(a) * Math.sin(b), RE * Math.sin(a)]; },
    argLat(p, ms, o) { const W = Orbit.raan(ms, o), n = [Math.cos(W), Math.sin(W), 0], m = cross(Orbit.normal(ms, o), n); return Math.atan2(dot(p, m), dot(p, n)); },
    sunlit(p, ms) {                  // cylindrical Earth shadow
      const s = sun(ms).v, k = dot(p, s);
      if (k > 0) return true;
      return Math.hypot(p[0] - k * s[0], p[1] - k * s[1], p[2] - k * s[2]) > RE;
    },
    elevation(p, g) {                // elevation (deg) of the spacecraft p seen from the ground point g, both inertial
      const d = [p[0] - g[0], p[1] - g[1], p[2] - g[2]], n = Math.hypot(d[0], d[1], d[2]), r = Math.hypot(g[0], g[1], g[2]);
      return Math.asin(dot(d, g) / (n * r)) / D2R;
    },
    subsolar(ms) { const s = sun(ms); return { lat: s.dec / D2R, lon: wrap180((s.ra - gmst(ms)) / D2R) }; },
    footprint(altKm, maskDeg) {      // ground radius (deg of arc) inside which a station sees the spacecraft above its mask
      const e = maskDeg * D2R; return (Math.acos(RE_KM / (RE_KM + altKm) * Math.cos(e)) - e) / D2R;
    },
  };

  // The launch window on a date: the moment the launch site, turning with the Earth, crosses the dawn-dusk plane on its
  // descending side (the twin flies south-south-west from Odisha, azimuth 192 deg).
  function launchWindow(day0, o, site) {
    const f = (ms) => dot(Orbit.site(site.lat, site.lon, ms), Orbit.normal(ms, o));
    for (let s = 0; s < DAY; s += 120) {
      let lo = day0 + s * 1000, hi = lo + 120000, flo = f(lo);
      if (flo * f(hi) > 0) continue;
      for (let k = 0; k < 32; k++) { const m = (lo + hi) / 2, fm = f(m); if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; } }
      const t = (lo + hi) / 2, r = Orbit.site(site.lat, site.lon, t), v = cross(Orbit.normal(t, o), r);
      const lam = Math.atan2(r[1], r[0]), ph = site.lat * D2R;
      if (dot(v, [-Math.sin(ph) * Math.cos(lam), -Math.sin(ph) * Math.sin(lam), Math.cos(ph)]) < 0) return Math.round(t / 1000) * 1000;
    }
    return day0;
  }

  // where the spacecraft is on its orbit, from the launch site at liftoff to orbit insertion half an orbit later
  function track(D, t0) {
    const o = D.orbit, G = D.geo, T = D.twin;
    const uSite = Orbit.argLat(Orbit.site(G.site.lat, G.site.lon, t0), t0, o);
    const uIns = uSite + G.insertion_km / RE_KM, n = 2 * Math.PI / Orbit.period(o);
    return { uSite, uIns, n, u: (s) => uIns + n * (s - T.t_orbit_s) };
  }

  // the first deorbit burn at or after from_s whose splashdown, the twin's return profile later, lands in the recovery zone
  function deorbitFor(D, t0, trk, from_s) {
    const o = D.orbit, G = D.geo, R = G.recovery, du = G.ret_dx_km / RE_KM, dt = D.twin.splash_after_deorbit_s;
    for (let s = from_s; s < from_s + 2 * DAY; s += 20) {
      const ms = t0 + (s + dt) * 1000, g = Orbit.geo(Orbit.eci(trk.u(s) + du, ms, o, 0), ms);
      if (g.lat >= R.lat[0] && g.lat <= R.lat[1] && g.lon >= R.lon[0] && g.lon <= R.lon[1]) return { s, lat: g.lat, lon: g.lon };
    }
    return { s: from_s, lat: null, lon: null };
  }

  function scaledSteps(e, days) {
    const d0 = e.protocol.duration_days, k = days / d0;
    return e.protocol.steps.map((s) => ({ day: s.day <= 0 || Math.abs(k - 1) < 1e-9 ? s.day : Math.round(s.day * k * 2) / 2, action: s.action }));
  }

  // cfg: {mode: 'bay' | 'own', days, exp (catalog entry or null), arch ('A' | 'B' | 'C'), launch: 'YYYY-MM-DD'}
  function timeline(D, cfg) {
    const T = D.twin, e = cfg.exp, own = cfg.mode === 'own', d = cfg.days;
    const day0 = Date.parse(cfg.launch + 'T00:00:00Z'), t0 = launchWindow(day0, D.orbit, D.geo.site), trk = track(D, t0);
    const start = own ? T.t_orbit_s + 2 * DAY : T.t_ops_s + T.start_after_s;        // own satellite: 2 days of checkout first
    const labDays = own ? d : Math.max(d, T.manifest_days);
    const end = start + d * DAY, endLab = start + labDays * DAY;
    const doyOf = (ms) => Math.floor((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)) / (DAY * 1000)) % 365;
    const eclOver = (s1) => { let m = 0; for (let x = 0; x <= s1; x += DAY) m = Math.max(m, D.eclipse[doyOf(t0 + x * 1000)]); return m * D.orbit.period_min; };
    const launchTxt = `${String(new Date(t0).getUTCHours()).padStart(2, '0')}:${String(new Date(t0).getUTCMinutes()).padStart(2, '0')} UTC, when the pad passes under the dawn-dusk plane`;
    if (own && cfg.arch === 'A') {        // in-flight only: no capsule, the satellite re-enters and burns up after the protocol
      const ev = [[-24 * 3600, 'Late load', 'your fluidic card goes into the CubeSat'], [0, 'Launch', `rideshare on RUPAK, ${launchTxt}`],
        [T.t_orbit_s, 'Orbit', `${D.orbit.alt_km} km dawn-dusk sun-synchronous`], [start, 'Your start', 'you sign it; Sentinel checks it'],
        [end, 'Your last reading', `after ${d} days; results downlinked daily`], [end + DAY, 'End of mission', 'deorbit or passivation; the CubeSat burns up on re-entry']];
      return { ev, t0, trk, start, end, endLab: end, prep: end, deorbit: end + DAY, wait: 0, entry: end + DAY, splash: end + DAY, hand: end + DAY, lab: end + DAY,
               eclMin: eclOver(end), doseMgy: T.dose_mgy_day * (end - T.t_orbit_s) / DAY, labDays: d, cube: true, splashPt: null };
    }
    const prep = endLab + T.prep_after_end_s, plannedBurn = prep + T.deorbit_after_prep_s, opp = deorbitFor(D, t0, trk, plannedBurn);
    const deorbit = opp.s, wait = deorbit - plannedBurn, entry = deorbit + T.entry_after_deorbit_s;
    const splash = deorbit + T.splash_after_deorbit_s, hand = splash + (own ? D.params.return_hold_h * 3600 : T.handover_after_splash_s);
    const lab = hand + (e ? e.sample_return.max_hours * 3600 : 48 * 3600);
    const waitTxt = wait > 600 ? `, timed for splashdown in the recovery zone (${Math.round(wait / 3600 * 10) / 10} h after return prep)` : '';
    const ev = [[-24 * 3600, 'Late load', own ? 'your module goes into the capsule' : 'your module goes into its bay'], [0, 'Launch on RUPAK', `${launchTxt}; the reusable booster flies back`],
      [T.t_orbit_s, 'Orbit', `${D.orbit.alt_km} km dawn-dusk sun-synchronous`], [T.t_ops_s, own ? 'Satellite checkout (2 days)' : 'Lab power-on', own ? 'arrays out, Sun acquired, payload held at temperature' : 'bays at their setpoints, dosimeter logging'],
      [start, 'Your start', 'you sign it; Sentinel checks it'], [end, 'Your preservation', `after ${d} days`],
      ...(own || endLab === end ? [] : [[endLab, 'Lab operations end', `the longest protocol on board (${T.manifest_driver}, ${T.manifest_days} days)`]]),
      [deorbit, 'Deorbit burn', (own ? 'service module, then the capsule separates' : 'upper stage, then the lab separates') + waitTxt],
      [entry, 'Entry', `inflatable heat shield, about ${Number(T.peak_g).toFixed(1)} g peak in the twin's model`],
      [splash, 'Splashdown', own ? 'under the parachute; the capsule beacon guides the ship' : `${Number(T.splash_ms).toFixed(1)} m/s next to the recovery ship`],
      [hand, 'Your courier', own ? `latest: the capsule holds temperature for ${D.params.return_hold_h} h` : 'custody ledger signed'], [lab, 'In your lab', 'latest arrival for this protocol']];
    return { ev, t0, trk, start, end, endLab, prep, deorbit, wait, entry, splash, hand, lab, eclMin: eclOver(splash),
             doseMgy: T.dose_mgy_day * (deorbit - T.t_ops_s) / DAY, labDays, cube: false, splashPt: opp.lat == null ? null : { lat: opp.lat, lon: opp.lon } };
  }

  const api = { Orbit, launchWindow, track, deorbitFor, scaledSteps, timeline, DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LelpPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
