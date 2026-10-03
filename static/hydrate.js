/* Rebuilds per-frame module and link objects from the compact mission JSON (sentinel/lelp/mission.py to_json).
   Static facts are shared by reference, so the hydrated mission costs a few MB of memory instead of hundreds. */
window.hydrateMission = function (D) {
  if (!D.static || D._hydrated) return D;
  const ms = D.static.modules, ls = D.static.links;
  for (const f of D.frames) {
    f.modules = f.m.map((a, i) => { const s = ms[i];
      return a ? { id: s.id, size: s.size, exp: s.exp, customer: s.customer, payload: s.payload, t: a[0], p: a[1], sealed: !!a[2], health: a[3], state: a[4], heater_w: a[5],
                   protocol: { mode: s.protocol.mode, groups: s.protocol.groups, endpoint: s.protocol.endpoint, setpoint: a[6], cycles: a[7], crystal_um: a[8] } }
               : { id: s.id, size: s.size, exp: s.exp, customer: s.customer, payload: s.payload, t: 20, p: 101.3, sealed: true, health: 1, state: 'stowed', heater_w: 0,
                   protocol: { mode: s.protocol.mode, groups: s.protocol.groups, endpoint: s.protocol.endpoint, setpoint: 0, cycles: 0, crystal_um: 0 } }; });
    delete f.m;
    const links = {}; const l = f.comms.l || {};
    for (const id in ls) { const b = l[id];
      links[id] = { band: ls[id].band, rate_bps: ls[id].rate_bps, uplink_bps: ls[id].uplink_bps, coding: ls[id].coding, std: ls[id].std, sdls_sa: ls[id].sdls_sa,
                    visible: !!b, pq_session: b ? 'ML-KEM-1024 / AES-256-GCM' : 'idle',
                    budget: b ? { el_deg: b[0], range_km: b[1], ebn0_db: b[2], margin_db: b[3], latency_ms: b[4] } : null }; }
    f.comms.links = links;
  }
  D._hydrated = true; return D;
};
