/* Customer portal (portal.html), test build. Onboarding with test accounts that stay in this browser; the signed-in
   customer's experiments played from the mission twin, as of the last contact (camera frame, readouts, protocol,
   Sentinel log); data downloads built from the twin's data; test-mode billing; signed requests with the verdict the
   constitution would give (sentinel/firewall/gate.py). Shares hydrate.js and replay.js with the consoles. */
(async function () {
  'use strict';
  { const bm = document.querySelector('meta[name=build]'), sub = document.querySelector('.brand-sub');
    if (bm) { window.__build = bm.content; if (sub) sub.insertAdjacentHTML('beforeend', ` · <span class="build-tag">${bm.content}</span>`); } }
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const R = window.Replay, { clock, met, esc, lastBefore, clamp } = R;

  // ---------- test accounts: this browser only ----------
  const KEY = 'lelp-portal-v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const DB = Object.assign({ accounts: {}, session: null, requests: [], paid: {}, bookings: {} }, load());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { /* private window: this session only */ } };
  const hex = (n) => { const a = new Uint8Array(n); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; });
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); };

  // ---------- data: the mission twin and the lab catalog ----------
  let M = null, LAB = null, loadErr = '';
  const [mr, lr] = await Promise.allSettled([R.load('sentinel'), fetch('lab/data.json').then((r) => (r.ok ? r.json() : null))]);
  if (mr.status === 'fulfilled') M = mr.value; else loadErr = mr.reason ? mr.reason.message : 'unknown error';
  if (lr.status === 'fulfilled') LAB = lr.value;
  const CAT = LAB ? Object.fromEntries(LAB.experiments.map((e) => [e.id, e])) : {};
  const X = M ? M.x : null, EXPS = X ? X.exps : {}, F = M ? M.frames : [];
  if (LAB) $('pt-exp-pick').insertAdjacentHTML('beforeend', LAB.experiments.map((e) => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join(''));

  const DEMO = Object.values(EXPS).map((E) => ({ id: 'demo-' + E.meta.id, org: E.meta.customer, demo: true, exps: [E.meta.id],
    type: E.meta.customer === 'RadSenRegen' ? 'Demo customer' : 'Fictional demo company', note: `module ${E.meta.module} · ${E.meta.title}` }));
  DEMO.sort((a, b) => (b.exps[0] === X.featured) - (a.exps[0] === X.featured));
  DEMO.push({ id: 'demo-university', org: 'Demo University Lab', demo: true, exps: [], type: 'Fictional demo university', note: 'onboarding: safety review in progress', stage: 1 });
  const account = (id) => DB.accounts[id] || DEMO.find((d) => d.id === id) || null;
  const keyOf = (a) => a.key || (a.key = (DB.keys = DB.keys || {})[a.id] || (DB.keys[a.id] = hex(16)));

  // contacts (any station or relay in view) and the mission clock range
  const CT = F.filter((f) => f.comms && f.comms.visible && f.comms.visible.length).map((f) => ({ t: f.t, via: f.comms.visible }));
  const contactAt = (t) => { const i = lastBefore(CT, t); return i >= 0 ? CT[i] : null; };
  const nextContact = (t) => CT.find((c) => c.t > t) || null;
  const frameAt = (t) => { const i = lastBefore(F, t); return i >= 0 ? F[i] : null; };
  const tOf = (pred) => { const e = M ? M.events.find(pred) : null; return e ? e.t : Infinity; };

  // ---------- booking from the configurator: portal.html#book=<configurator hash> ----------
  let pendingBook = null;
  function readBooking() {
    const b = new URLSearchParams(location.hash.slice(1)).get('book');
    if (!b) return false;
    const q = new URLSearchParams(b), e = CAT[q.get('e')];
    if (e) pendingBook = { hash: b, exp: e.id, title: e.title, mode: q.get('m') === 'own' ? 'own' : 'bay', days: +q.get('d') || e.protocol.duration_days,
                           launch: /^\d{4}-\d{2}-\d{2}$/.test(q.get('l') || '') ? q.get('l') : '2026-12-01' };
    history.replaceState(null, '', location.pathname + location.search);
    return !!e;
  }
  readBooking();
  window.addEventListener('hashchange', () => { if (readBooking()) show(); });
  function attachBooking(a) {
    if (!pendingBook) return;
    const list = DB.bookings[a.id] = DB.bookings[a.id] || [];
    if (!list.some((b) => b.hash === pendingBook.hash)) list.push(Object.assign({ id: 'B' + hex(3), at: new Date().toISOString() }, pendingBook));
    pendingBook = null; save();
  }

  // ---------- views ----------
  const S = { acct: null, exp: null, t: 0, playing: false, speed: 60, chan: 'bf', well: null, last: performance.now(), tMin: 0, tMax: 1, dirty: true };
  function show() {
    const a = DB.session ? account(DB.session) : null;
    S.acct = a;
    $('pt-auth').hidden = !!a; $('pt-app').hidden = !a; $('pt-who').hidden = !a; $('pt-signout').hidden = !a;
    if (!a) { renderAuth(); return; }
    attachBooking(a);
    $('pt-org').textContent = a.org; $('pt-orgtype').textContent = a.type + (a.country ? ' · ' + a.country : '');
    document.title = a.org + ' · LELP-1 customer portal';
    renderChecklist(a); renderExps(a); renderBilling(a); renderRequests(a);
    const first = a.exps.find((id) => EXPS[id]);
    selectExp(S.exp && a.exps.includes(S.exp) ? S.exp : first || null);
  }
  function renderAuth() {
    $('pt-demo-list').innerHTML = DEMO.map((d) => `<div class="pt-demo"><b>${esc(d.org)}</b><span>${esc(d.type)} · ${esc(d.note)}</span>
      <button type="button" class="btn" data-acct="${esc(d.id)}">SIGN IN</button></div>`).join('')
      + Object.values(DB.accounts).map((d) => `<div class="pt-demo"><b>${esc(d.org)}</b><span>${esc(d.type)} · your test account</span>
      <button type="button" class="btn" data-acct="${esc(d.id)}">SIGN IN</button></div>`).join('');
    const n = $('pt-booking-note');
    n.hidden = !pendingBook;
    if (pendingBook) n.textContent = `Your booked mission (${pendingBook.title}, ${pendingBook.days} days, launch ${pendingBook.launch}) will be attached to the account you sign in to or create.`;
  }
  $('pt-demo-list').addEventListener('click', (e) => { const b = e.target.closest('[data-acct]'); if (!b) return; DB.session = b.dataset.acct; save(); show(); });
  $$('.pt-tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.pt-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('pt-tab-demo').hidden = b.dataset.tab !== 'demo'; $('pt-tab-new').hidden = b.dataset.tab !== 'new'; }));
  $('pt-tab-new').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target), org = String(f.get('org') || '').trim();
    if (!org) return;
    const id = 'acct-' + hex(4);
    DB.accounts[id] = { id, org, type: String(f.get('type')), country: String(f.get('country') || '').trim(), contact: String(f.get('contact') || '').trim(),
                        email: String(f.get('email') || '').trim(), interest: String(f.get('exp') || ''), exps: [], created: new Date().toISOString(), stage: 1 };
    DB.session = id; save(); e.target.reset(); show();
  });
  $('pt-signout').addEventListener('click', () => { DB.session = null; S.playing = false; save(); show(); });

  function renderChecklist(a) {
    const flying = a.exps.some((id) => EXPS[id]), booked = flying || (DB.bookings[a.id] || []).length > 0, reviewed = flying || (a.stage || 0) >= 2;
    const interest = a.interest && CAT[a.interest] ? CAT[a.interest].title : null;
    const steps = [
      [true, 'Account created', a.demo ? 'demo account of the mission twin' : `test account · ${new Date(a.created).toLocaleDateString()}`],
      [reviewed, 'Agreement and payload safety review', reviewed ? 'cleared' : 'Space Philic reviews your biosafety level and containment'],
      [reviewed, 'Export-control and data-handling check', reviewed ? 'cleared' : 'needed before your sample ships'],
      [booked, 'Mission booked', booked ? 'see your experiments' : interest ? `next: <a href="lab/configure.html">configure ${esc(interest)}</a>` : 'next: <a href="lab/configure.html">configure a mission</a>'],
      [flying, 'Sample handed over (late load)', flying ? 'loaded into its module before launch' : 'about 24 h before launch, at the launch site'],
      [true, 'Signing key issued', `test fingerprint ${keyOf(a).slice(0, 16)}… (in flight: an ML-DSA-87 key)`]];
    const now = steps.findIndex((s) => !s[0]);
    $('pt-checklist').innerHTML = steps.map(([ok, h, sub], i) => `<li class="${ok ? 'done' : i === now ? 'now' : ''}"><i></i><span>${esc(h)}<small>${sub}</small></span></li>`).join('');
    $('pt-key').textContent = flying ? 'active customer' : 'onboarding';
    save();
  }

  function expStatus(id, t) {
    const E = EXPS[id], m = E.meta, s = R.expAt(M, t, id), tHand = tOf((e) => e.code === 'SAMPLE_HANDOVER' && e.data && e.data.module === m.module);
    if (t >= tHand) return ['HANDED OVER', 'good'];
    if (t >= X.tSplash) return ['ON THE RECOVERY SHIP', 'info'];
    if (t >= X.tReturn) return ['RETURNING', 'info'];
    if (!s) return [t < 0 ? 'ON THE PAD' : 'IN ORBIT', 'info'];
    return { cryo: [m.launch_storage && m.launch_storage.kind === 'cryo' ? 'FROZEN' : 'STOWED', 'info'], thawing: ['THAWING', 'warn'], recovery: ['RECOVERY', 'warn'],
             culture: [`CULTURE · DAY ${Math.floor(s.day) + 1}`, 'good'], preserved: ['PRESERVED 4 °C', 'info'] }[s.phase] || ['IN ORBIT', 'info'];
  }
  function renderExps(a) {
    const fly = a.exps.filter((id) => EXPS[id]).map((id) => {
      const m = EXPS[id].meta, [st, c] = expStatus(id, S.t || m.t_start), span = Math.max(1, (m.t_preserved || m.t_end) - m.t_start);
      const pct = clamp(((S.t || m.t_start) - m.t_start) / span, 0, 1) * 100;
      return `<button type="button" class="pt-exp${S.exp === id ? ' sel' : ''}" data-exp="${esc(id)}"><b>${esc(m.title)}</b><span class="chip ${c}" data-st="${esc(id)}">${esc(st)}</span>
        <span class="pt-sub">LELP-1 module ${m.module} · ${esc(m.summary)}</span>
        <span class="pt-links"><a href="customer.html?c=${encodeURIComponent(id)}">Full console</a></span>
        <span class="pt-bar"><i style="width:${pct.toFixed(1)}%" data-bar="${esc(id)}"></i></span></button>`; });
    const books = (DB.bookings[a.id] || []).map((b) => `<div class="pt-exp"><b>${esc(b.title)}</b><span class="chip warn">BOOKED</span>
        <span class="pt-sub">${b.mode === 'own' ? 'own satellite' : 'bay on LELP-1'} · ${b.days} days · launch ${esc(b.launch)} · awaiting launch</span>
        <span class="pt-links"><a href="lab/simulate.html#${esc(b.hash)}">Simulate</a><a href="lab/configure.html#${esc(b.hash)}">Configuration</a></span></div>`);
    $('pt-exp-list').innerHTML = fly.concat(books).length ? `<div class="pt-explist">${fly.concat(books).join('')}</div>`
      : `<p class="pt-empty">No experiment yet. <a href="lab/configure.html">Configure a mission</a> and press "Book this mission"; it appears here.</p>`;
  }
  $('pt-exp-list').addEventListener('click', (e) => { if (e.target.closest('a')) return; const b = e.target.closest('[data-exp]'); if (b) selectExp(b.dataset.exp); });

  // ---------- the live view of one experiment ----------
  function selectExp(id) {
    S.exp = id && EXPS[id] ? id : null;
    $('pt-live').hidden = !S.exp;
    $$('.pt-exp[data-exp]').forEach((b) => b.classList.toggle('sel', b.dataset.exp === S.exp));
    renderData(); renderBilling(S.acct);
    if (!S.exp) return;
    const m = EXPS[S.exp].meta;
    S.tMin = Math.max(0, m.t_start - 6 * 3600); S.tMax = X.tEnd;
    if (!S.t || S.t < S.tMin || S.t > S.tMax) S.t = m.t_start + 0.42 * ((m.t_preserved || m.t_end) - m.t_start);
    S.well = m.groups[0].id;
    $('pt-live-h').textContent = `LIVE · MODULE ${m.module} · ${m.customer.toUpperCase()}`;
    $('pt-wells').innerHTML = m.groups.map((g) => `<button type="button" data-well="${esc(g.id)}"${g.id === S.well ? ' class="on"' : ''}>${esc(g.label || g.id)}</button>`).join('');
    const im = m.imaging || {};
    $('pt-cam-note').textContent = `Drawn from the twin's culture model for the last imaging round received (cell cover, shape, viability, ROS). The flight camera (${im.instrument || 'imager'}: ${(im.channels || []).join(', ')}) sends about ${im.down_mb || '?'} MB of thumbnails and metrics per round, every ${im.every_h || '?'} h; the full ${im.frames_per_round || ''} frames per round come back with the samples.`;
    S.dirty = true;
  }
  $('pt-wells').addEventListener('click', (e) => { const b = e.target.closest('[data-well]'); if (!b) return; S.well = b.dataset.well; $$('#pt-wells button').forEach((x) => x.classList.toggle('on', x === b)); S.dirty = true; });
  $('pt-chan').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; S.chan = b.dataset.v; $$('#pt-chan button').forEach((x) => x.classList.toggle('on', x === b)); S.dirty = true; });
  $('pt-speed').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; S.speed = +b.dataset.v; $$('#pt-speed button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('pt-play').addEventListener('click', () => { S.playing = !S.playing; S.last = performance.now(); $('pt-play').textContent = S.playing ? '❚❚ PAUSE' : '▶ PLAY'; });
  $('pt-scrub').addEventListener('input', (e) => { S.t = S.tMin + (S.tMax - S.tMin) * (+e.target.value / 1000); S.dirty = true; });

  const fmt = { pct: (v) => (v * 100).toFixed(1), x2: (v) => v.toFixed(2), x1: (v) => v.toFixed(1) };
  function renderLive() {
    const E = EXPS[S.exp], m = E.meta, t = S.t, c = contactAt(t), tc = c ? Math.min(c.t, t) : t, s = R.expAt(M, tc, S.exp), fr = frameAt(t);
    $('pt-met').textContent = met(t);
    $('pt-scrub').value = String(Math.round(1000 * (t - S.tMin) / Math.max(1, S.tMax - S.tMin)));
    const [st, cl] = expStatus(S.exp, t);
    const ph = $('pt-phase'); ph.textContent = st; ph.className = 'chip ' + cl;
    const delay = t - tc, mode = fr && fr.platform ? fr.platform.mode : '';
    $('pt-delay').textContent = t >= X.tReturn ? 'return under way: the lab is off the air until the recovery beacon'
      : c ? `data as of ${met(tc)} · ${delay < 90 ? 'in contact now' : Math.round(delay / 60) + ' min ago'} via ${c.via.join(', ')}${mode ? ' · lab mode ' + mode.replace(/_/g, ' ') : ''}` : 'no contact yet';
    // readouts per group, flight against the 1 g ground controls
    const mt = m.family.metrics;
    if (s && s.g) {
      $('pt-read').innerHTML = `<tr><th>Group</th>${mt.map((q) => `<th title="${esc(q.name)}">${esc(q.label)} flight</th>`).join('')}<th>${esc(mt[0].label)} ground</th></tr>`
        + m.groups.map((g) => { const f = s.g[g.id].flight, gr = s.g[g.id].ground || {};
          return `<tr><td>${esc(g.label || g.id)}</td>${mt.map((q) => `<td>${fmt[q.fmt] ? fmt[q.fmt](f[q.key]) : f[q.key]}</td>`).join('')}<td>${gr[mt[0].key] != null ? fmt[mt[0].fmt](gr[mt[0].key]) : '–'}</td></tr>`; }).join('');
    } else $('pt-read').innerHTML = '<tr><td>No readouts yet: the protocol starts after orbit insertion and the thaw.</td></tr>';
    $('pt-tm').innerHTML = s ? [['Block', s.block_c.toFixed(1) + ' °C'], ['Dose', s.dose.toFixed(2) + ' mGy'], ['Imaging rounds', String(s.rounds)], ['Data received', s.down_mb.toFixed(1) + ' MB']]
      .map(([a, b]) => `<div><span>${a}</span><b class="mono">${b}</b></div>`).join('') : '';
    // protocol steps
    const steps = [[m.t_start, 'Start signed by you; automated thaw']].concat((m.t_steps || []).map((q) => [q.t, (q.do || []).map((x) => x.replace(/_/g, ' ')).join(', ')]))
      .concat(m.t_preserved != null && !(m.t_steps || []).some((q) => (q.do || []).includes('preserve')) ? [[m.t_preserved, 'preserve']] : []);
    $('pt-proto').innerHTML = steps.map(([ts, txt]) => `<li class="${ts <= tc ? 'done' : ''}"><span class="mono">${ts <= tc ? '✓ ' : ''}${met(ts)}</span><b>${esc(txt === 'preserve' ? 'preserve, then hold at 4 °C until the return' : txt)}</b></li>`).join('');
    // the module's log: protocol events and every Sentinel decision on this module, as received
    const mod = 'module-' + m.module, log = M.events.filter((e) => e.t <= tc && e.data && (e.data.module === m.module || e.data.target === mod || (e.data.final && String(e.text).includes(mod + ' '))));
    $('pt-log').innerHTML = log.slice(-30).reverse().map((e) => `<li><span class="mono">${met(e.t)}</span><span>${e.data.final ? `<span class="chip ${esc(e.data.final)}">${esc(e.data.final)}</span>` : ''}${esc(e.text)}</span></li>`).join('')
      || '<li><span></span><span>Nothing yet.</span></li>';
    drawCam(E, s, tc);
    // the experiment cards' status and progress follow the clock
    $$('[data-st]').forEach((el) => { const [a, b] = expStatus(el.dataset.st, t); el.textContent = a; el.className = 'chip ' + b; });
    $$('[data-bar]').forEach((el) => { const q = EXPS[el.dataset.bar].meta, span = Math.max(1, (q.t_preserved || q.t_end) - q.t_start);
      el.style.width = (clamp((t - q.t_start) / span, 0, 1) * 100).toFixed(1) + '%'; });
  }

  // ---------- camera: a frame drawn from the twin's numbers for the last round received ----------
  const cv = $('pt-camc'), cx = cv.getContext('2d');
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  const hashStr = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  function drawCam(E, s, tc) {
    const m = E.meta, W = cv.width, H = cv.height, ri = lastBefore(E.rounds, tc);
    cx.globalCompositeOperation = 'source-over';
    const msg = (a, b) => { cx.fillStyle = '#050607'; cx.fillRect(0, 0, W, H); cx.fillStyle = '#bcc0c6'; cx.font = '600 16px Inter, sans-serif'; cx.textAlign = 'center';
      cx.fillText(a, W / 2, H / 2 - 6); cx.fillStyle = '#8b9098'; cx.font = '13px Inter, sans-serif'; cx.fillText(b, W / 2, H / 2 + 18); cx.textAlign = 'left'; };
    $('pt-cam-title').textContent = `Module ${m.module} camera · ${(m.groups.find((g) => g.id === S.well) || {}).label || S.well}`;
    if (!s || s.phase === 'cryo' || ri < 0) { msg(s && s.phase === 'cryo' ? 'Cells frozen in the cryo cassette' : 'No imaging round received yet', 'imaging starts after the automated thaw'); return; }
    const g = s.g[S.well] && s.g[S.well].flight; if (!g) { msg('No data for this well', ''); return; }
    const round = ri + 1, r = rng(hashStr(m.id + S.well) + round * 7919), base = rng(hashStr(m.id + S.well));
    const bf = S.chan === 'bf';
    if (bf) { const gr = cx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.62); gr.addColorStop(0, '#a7aaa6'); gr.addColorStop(1, '#5d605d');
      cx.fillStyle = gr; } else cx.fillStyle = '#020303';
    cx.fillRect(0, 0, W, H);
    const n = Math.round(20 + g.conf * 260), shape = Math.max(1, g.shape), dead = clamp(1 - g.v, 0, 1), ros = clamp((g.ros - 1) / 1.2, 0, 1);
    const field = base() * Math.PI, aligned = clamp((shape - 2) / 5, 0, 0.85);
    cx.globalCompositeOperation = bf ? 'source-over' : 'lighter';
    for (let i = 0; i < n; i++) {
      const x = base() * W, y = base() * H, jitter = (r() - 0.5) * 6, isDead = r() < dead;
      const ang = aligned * field + (1 - aligned) * base() * Math.PI, rad = 8 + base() * 5;
      const a = rad * Math.sqrt(shape), b = rad / Math.sqrt(Math.min(shape, 3));
      cx.save(); cx.translate(x + jitter, y + jitter); cx.rotate(ang);
      if (isDead) {
        if (bf) { cx.fillStyle = 'rgba(240,240,232,.85)'; cx.beginPath(); cx.arc(0, 0, 3.2, 0, 7); cx.fill(); cx.strokeStyle = 'rgba(30,30,30,.6)'; cx.stroke(); }
        else if (S.chan === 'dead') { const gl = cx.createRadialGradient(0, 0, 0, 0, 0, 7); gl.addColorStop(0, 'rgba(255,70,60,.95)'); gl.addColorStop(1, 'rgba(255,40,30,0)'); cx.fillStyle = gl; cx.beginPath(); cx.arc(0, 0, 7, 0, 7); cx.fill(); }
      } else if (bf) {
        cx.fillStyle = 'rgba(205,208,200,.55)'; cx.strokeStyle = 'rgba(40,42,40,.55)'; cx.lineWidth = 1.2;
        cx.beginPath(); cx.ellipse(0, 0, a, b, 0, 0, 7); cx.fill(); cx.stroke();
        cx.fillStyle = 'rgba(70,72,70,.55)'; cx.beginPath(); cx.ellipse(0, 0, Math.min(4, b * 0.6), Math.min(3.2, b * 0.5), 0, 0, 7); cx.fill();
      } else if (S.chan === 'ros') {
        const k = clamp(ros * (0.55 + r() * 0.9), 0, 1), gl = cx.createRadialGradient(0, 0, 0, 0, 0, a);
        gl.addColorStop(0, `rgba(90,255,120,${(0.12 + 0.75 * k).toFixed(2)})`); gl.addColorStop(1, 'rgba(40,200,80,0)');
        cx.fillStyle = gl; cx.beginPath(); cx.ellipse(0, 0, a, b * 1.2, 0, 0, 7); cx.fill();
      }
      cx.restore();
    }
    cx.globalCompositeOperation = 'source-over';
    cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillRect(0, 0, W, 24); cx.fillRect(0, H - 24, W, 24);
    cx.fillStyle = '#e8eaec'; cx.font = '500 12px "IBM Plex Mono", monospace';
    const chName = { bf: 'BRIGHTFIELD', ros: 'ROS PROBE', dead: 'DEAD-CELL DYE' }[S.chan];
    cx.fillText(`M${m.module} · ${(m.groups.find((q) => q.id === S.well) || {}).label || S.well} · ROUND ${round} · ${chName}`, 10, 16);
    cx.fillText(`round taken ${met(E.rounds[ri].t)} · simulated from the twin`, 10, H - 8);
  }

  // ---------- data downloads, built from the twin up to the last contact ----------
  function save$(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function datasets() {
    if (!S.exp) return [];
    const E = EXPS[S.exp], m = E.meta, c = contactAt(S.t), tc = c ? Math.min(c.t, S.t) : S.t, upto = met(tc).replace(/[^0-9a-zA-Z+]/g, '');
    const rows = E.rows.filter((r) => r.t <= tc), mod = m.module, tf = [];
    let lastT = -Infinity; for (const f of F) { if (f.t > tc) break; if (f.t - lastT >= 60) { tf.push(f); lastT = f.t; } }
    const evs = M.events.filter((e) => e.t <= tc && e.data && (e.data.module === mod || e.data.target === 'module-' + mod));
    return [
      ['Readouts', `per well and group, ${rows.length} rows (hourly), CSV`, `${m.id}_readouts_${upto}.csv`, 'text/csv',
       () => [E.cols.join(',')].concat(rows.map((r) => r.slice(0, E.cols.length).join(','))).join('\n')],
      ['Module telemetry', `temperature, setpoint, heater, health, ${tf.length} samples, CSV`, `${m.id}_module${mod}_telemetry_${upto}.csv`, 'text/csv',
       () => ['t_s,met,temp_c,setpoint_c,heater_w,health,state,lab_mode'].concat(tf.map((f) => { const q = f.modules[mod - 1];
         return [f.t, met(f.t), q.t, q.protocol.setpoint, q.heater_w, q.health, q.state, f.platform.mode].join(','); })).join('\n')],
      ['Event and Sentinel log', `${evs.length} entries with verdicts, JSON`, `${m.id}_log_${upto}.json`, 'application/json', () => JSON.stringify(evs, null, 1)],
      ['Experiment spec', 'protocol, groups, imaging, endpoints, JSON', `${m.id}_spec.json`, 'application/json', () => JSON.stringify(m, null, 1)],
      ['Current camera frame', 'the frame on screen (simulated), PNG', `${m.id}_frame.png`, 'image/png', null]];
  }
  function renderData() {
    const ds = datasets();
    $('pt-data').innerHTML = ds.length ? `<div class="pt-dl">${ds.map((d, i) => `<button type="button" data-ds="${i}"><b>${esc(d[0])}</b><span>${esc(d[1])}</span><i>DOWNLOAD</i></button>`).join('')}</div>
      <p class="h-sub">Raw images (all frames, full resolution) come back with your samples after splashdown.</p>`
      : `<p class="pt-empty">Your data appears here once an experiment of yours is in orbit.</p>`;
  }
  $('pt-data').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ds]'); if (!b) return;
    const d = datasets()[+b.dataset.ds]; if (!d) return;
    if (!d[4]) { cv.toBlob((bl) => { const a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = d[2]; a.click(); }); return; }
    save$(d[2], d[4](), d[3]);
  });

  // ---------- billing, test mode ----------
  function renderBilling(a) {
    if (!a) return;
    const inv = [];
    for (const id of a.exps.filter((q) => EXPS[q])) { const m = EXPS[id].meta, last = EXPS[id].rows[EXPS[id].rows.length - 1], ix = EXPS[id].ix;
      inv.push({ id: `INV-M${m.module}-01`, items: [`Bay booking: module ${m.module} (${m.size === 'L' ? 'large' : 'medium'}), ${Math.round(m.end_h / 24)}-day protocol`,
        `Imaging and downlink: ${last[ix.rounds]} rounds, ${last[ix.down_mb]} MB`, 'Sample return, custody ledger and courier hand-over'] }); }
    for (const b of DB.bookings[a.id] || []) inv.push({ id: 'QUO-' + b.id, items: [`${b.mode === 'own' ? 'Own satellite' : 'Bay on LELP-1'}: ${b.title}, ${b.days} days`, `Launch ${b.launch}`], quote: true });
    const extra = DB.requests.filter((q) => q.acct === a.id && q.billable).length;
    $('pt-bill').innerHTML = inv.length ? inv.map((v) => { const paid = DB.paid[a.id + v.id];
      return `<div class="pt-billrow"><b class="mono">${esc(v.id)}</b><span class="chip ${paid ? 'good' : v.quote ? 'info' : 'warn'}">${paid ? 'PAID (TEST)' : v.quote ? 'QUOTE REQUESTED' : 'DUE'}</span>
        ${v.quote ? '' : `<button type="button" class="btn" data-pay="${esc(v.id)}"${paid ? ' disabled' : ''}>${paid ? 'PAID' : 'PAY (TEST)'}</button>`}</div>
        <table class="pt-inv">${v.items.map((x) => `<tr><td>${esc(x)}</td><td>per quote</td></tr>`).join('')}${extra && !v.quote ? `<tr><td>Extra requests: ${extra}</td><td>per quote</td></tr>` : ''}</table>`; }).join('')
      + '<p class="h-sub">Test mode: prices come from your quote, no card details are asked for and nothing is charged. The payment gateway comes with the production portal.</p>'
      : '<p class="pt-empty">No invoices yet. Booking a mission sends you a quote.</p>';
  }
  $('pt-bill').addEventListener('click', (e) => { const b = e.target.closest('[data-pay]'); if (!b || !S.acct) return; DB.paid[S.acct.id + b.dataset.pay] = new Date().toISOString(); save(); renderBilling(S.acct); });

  // ---------- requests: signed, and checked the way the constitution would check them ----------
  const REQ = {
    imaging: ['Extra imaging round', 'EXECUTE', 'customer role may task imaging of its own module; queued for the next round', true],
    camera: ['Live camera session', 'EXECUTE', 'allowed for your own module; scheduled at the next contact', false],
    raw: ['Raw image archive after recovery', 'EXECUTE', 'data request; delivered with your samples after splashdown', true],
    extend: ['Extend my protocol', 'ESCALATED', 'changes the return date for every module on board: mission control has to sign', true],
    setpoint: ['Change my culture temperature', 'ESCALATED', 'a setpoint change on a live culture needs a protocol reference and an operator review (4–45 °C, at most 8 °C a step)', false],
    slot: ['Another experiment slot', 'info', 'not a spacecraft command: sales sends you a quote', true]};
  $('pt-req').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!S.acct) return;
    const f = new FormData(e.target), kind = String(f.get('kind')), d = REQ[kind], m = S.exp ? EXPS[S.exp].meta : null;
    let why = d[2];
    if (kind === 'camera' && M) { const n = nextContact(S.t); if (n) why += ` (${met(n.t)} via ${n.via.join(', ')})`; }
    if (!m && kind !== 'slot') why = 'no experiment of yours is in orbit yet: kept for when one is';
    DB.requests.push({ id: 'R' + hex(3), acct: S.acct.id, kind, title: d[0], note: String(f.get('note') || '').trim(), module: m ? m.module : null,
                       verdict: m || kind === 'slot' ? d[1] : 'info', why, billable: d[3], at: new Date().toISOString(), met: M && m ? met(S.t) : null, sig: keyOf(S.acct).slice(0, 12) });
    save(); e.target.reset(); renderRequests(S.acct); renderBilling(S.acct);
  });
  function renderRequests(a) {
    const mine = DB.requests.filter((q) => q.acct === a.id).slice().reverse();
    $('pt-reqs').innerHTML = mine.map((q) => `<li><span class="pt-reqh"><span class="chip ${esc(q.verdict)}">${esc(q.verdict === 'info' ? 'NOTED' : q.verdict)}</span><b>${esc(q.title)}</b>${q.module ? `<small>module ${q.module}</small>` : ''}</span>
      ${q.note ? `<span>${esc(q.note)}</span>` : ''}<small>${esc(q.why)}</small><small>signed ${esc(q.sig)}… · ${q.met ? 'at ' + esc(q.met) + ' · ' : ''}${new Date(q.at).toLocaleString()}</small></li>`).join('')
      || '<li><small>No requests yet.</small></li>';
  }

  // ---------- loop ----------
  function tick(now) {
    const dt = Math.min(0.25, (now - S.last) / 1000); S.last = now;
    if (S.exp && S.playing) { S.t = Math.min(S.tMax, S.t + dt * S.speed); S.dirty = true; if (S.t >= S.tMax) { S.playing = false; $('pt-play').textContent = '▶ PLAY'; } }
    if (S.exp && S.dirty && !$('pt-app').hidden) { renderLive(); S.dirty = false; if (S.playing && Math.floor(now / 1000) !== S.lastData) { S.lastData = Math.floor(now / 1000); renderData(); } }
    requestAnimationFrame(tick);
  }
  if (!M) $('pt-booking-note').insertAdjacentHTML('afterend', `<p class="pt-note">The mission twin did not load (${esc(loadErr)}); live views are unavailable, onboarding still works.</p>`);
  show();
  requestAnimationFrame(tick);
  // test hook: render at a mission time without animation frames (hidden tabs)
  window.__portal = { S, DB, render: (t) => { if (t != null) S.t = t; if (S.exp) renderLive(); renderData(); return S; }, datasets };
})();
