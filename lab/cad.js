/* LELP-1 lab site: 3-D CAD viewer (GLB files from cad/build_cad.py, build_lelp1.py, build_detail.py and build_modules.py;
   CadQuery/OpenCascade). Markup: <div class="cad-view" data-name="SP-XTL" data-entry="1"></div>, or a list of views:
   <div class="cad-view" data-views='[{"name":"MOD-x","label":"Payload module","kind":"module"},{"name":"SP-X","label":"Own satellite","kind":"sat"}]'>.
   Optional <select class="cad-pick"> to switch designs; any element with data-cad="NAME" selects that view and scrolls to it.
   One WebGL context per page; three.js r128 with GLTFLoader and OrbitControls. */
(function () {
  'use strict';
  const el = document.querySelector('.cad-view');
  if (!el) return;
  const fail = (msg) => { el.classList.add('cad-off'); el.innerHTML = `<p class="small">${msg}</p>`; };
  if (!window.THREE || !THREE.GLTFLoader || !THREE.OrbitControls) return fail('3-D view unavailable in this browser; download the STEP or GLB below.');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch (e) { return fail('3-D view needs WebGL; download the STEP or GLB below.'); }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = THREE.sRGBEncoding;
  const canvasBox = document.createElement('div'); canvasBox.className = 'cad-canvas'; canvasBox.appendChild(renderer.domElement);
  const bar = document.createElement('div'); bar.className = 'cad-bar';
  el.appendChild(canvasBox); el.appendChild(bar);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf3f5f8);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
  const controls = new THREE.OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.12;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(4, 6, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-5, -2, -4); scene.add(fill);
  const front = new THREE.DirectionalLight(0xffffff, 0.45); front.position.set(1, 2, -6); scene.add(front);   // modules face -z
  const grid = new THREE.GridHelper(6, 12, 0xb8c2cc, 0xd6dde4); scene.add(grid);           // 0.5 m squares
  const fine = new THREE.GridHelper(1, 20, 0xc4ccd5, 0xdde3e9); fine.visible = false; scene.add(fine);   // 5 cm squares for modules
  const loader = new THREE.GLTFLoader();
  const satViews = (n, hasEntry) => [{ name: n, label: n.endsWith('-detail') ? 'Cutaway' : 'In orbit', kind: n.endsWith('-detail') ? 'detail' : 'sat' }]
    .concat(hasEntry ? [{ name: `${n}-entry`, base: n, label: 'Entry', kind: 'entry' }] : []);
  function parsed() {
    try { const v = JSON.parse(el.dataset.views || 'null'); if (Array.isArray(v) && v.length) return v; } catch (e) { /* fall through */ }
    return el.dataset.name ? satViews(el.dataset.name, el.dataset.entry !== '0') : [];
  }
  let views = parsed(), cur = 0, model = null, dirty = true, marked = [], hl = '', framedAt = 0;
  const markMat = new THREE.MeshStandardMaterial({ color: 0x1f6fd1, emissive: 0x0b3a7a, roughness: 0.5, metalness: 0.2 });
  const view = () => views[cur] || {};
  function paint() {                    // bays booked on LELP-1 (nodes bay_L_19...), or a role in a payload module (nodes sample__...)
    if (!model) return;
    model.traverse((c) => {
      if (!c.isMesh) return;
      let on = false;
      for (let o = c; o && o !== scene; o = o.parent) {
        const n = o.name || '', m = /^bay_[LM]_(\d+)/.exec(n);
        if (m) { on = marked.includes(+m[1]); break; }
        if (hl && n.startsWith(hl)) { on = true; break; }
      }
      if (on) { if (!c.userData.mat0) c.userData.mat0 = c.material; c.material = markMat; } else if (c.userData.mat0) c.material = c.userData.mat0;
    });
    dirty = true;
  }
  function frame(obj) {
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    obj.position.sub(c); obj.position.y += size.y / 2;                                      // stand it on the grid
    const mod = view().kind === 'module';
    grid.visible = !mod; fine.visible = mod;
    const r = Math.max(size.x, size.y, size.z), rs = size.length() / 2;                    // fit the bounding sphere
    const asp = cam.aspect > 0.2 ? cam.aspect : 1.6;                                      // hidden canvas: assume a wide view
    const dist = rs / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * (asp < 1 ? 1.25 / asp : 1.0) * (mod ? 0.92 : 1.0);
    framedAt = canvasBox.clientWidth;
    const dir = (mod ? new THREE.Vector3(0.52, 0.42, -0.74) : new THREE.Vector3(0.62, 0.32, 0.72)).normalize();   // modules: look in through the open front
    cam.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, size.y / 2, 0)); controls.target.set(0, size.y / 2, 0);
    cam.near = r / 100; cam.far = r * 50; cam.updateProjectionMatrix();
    controls.update(); dirty = true;
  }
  const NOTE = { module: 'payload module, front panel off so the inside shows', sat: 'in orbit, heat shield packed', entry: 'entry configuration, heat shield inflated',
    detail: 'detailed model, one side panel left off so the inside shows' };
  function load() {
    const v = view();
    if (!v.name) return;
    const status = bar.querySelector('.cad-status');
    status.textContent = 'loading…';
    loader.load(`cad/${v.name}.glb`, (g) => {
      if (model) scene.remove(model);
      model = g.scene; scene.add(model); frame(model); paint();
      const what = v.note || NOTE[v.kind] || (v.name === 'LELP-1' ? NOTE.sat : '');
      status.textContent = `${v.base || v.name}${what ? ' · ' + what : ''} · drag to rotate, scroll to zoom`;
      links();
    }, undefined, () => { status.textContent = 'model not found'; });
  }
  function links() {
    const v = view(), base = v.base || v.name;
    bar.querySelector('.cad-dl').innerHTML = `<a href="cad/${base}-step.zip" download>STEP (zip)</a><a href="cad/${v.name}.glb" download>GLB</a><a href="cad/${base}.json">parts and mass properties</a>`;
  }
  function buttons() {
    bar.innerHTML = `<div class="seg">${views.map((v, i) => `<button type="button" data-i="${i}"${i === cur ? ' class="on"' : ''}>${v.label}</button>`).join('')}<button type="button" data-v="reset">Reset view</button></div>
      <span class="cad-status small"></span><span class="cad-dl"></span>`;
    bar.querySelectorAll('button').forEach((b) => b.onclick = () => {
      if (b.dataset.v === 'reset') { if (model) frame(model); return; }
      select(+b.dataset.i);
    });
  }
  function select(i) {
    if (i < 0 || i >= views.length) return;
    cur = i; bar.querySelectorAll('button[data-i]').forEach((x) => x.classList.toggle('on', +x.dataset.i === cur)); load();
  }
  function setViews(list, i = 0) { views = list; cur = Math.max(0, Math.min(i, list.length - 1)); buttons(); load(); }
  buttons();
  const pick = document.querySelector('.cad-pick');
  if (pick) pick.onchange = () => setViews(pick.selectedOptions[0].dataset.views ? JSON.parse(pick.selectedOptions[0].dataset.views)
    : satViews(pick.value, pick.selectedOptions[0].dataset.entry !== '0'));
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest && ev.target.closest('[data-cad]');
    if (!t) return;
    ev.preventDefault();
    const i = views.findIndex((v) => v.name === t.dataset.cad);
    if (i >= 0) select(i);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  window.LelpCad = {
    show(n, hasEntry = true) { setViews(satViews(n, hasEntry)); },
    views(list, i = 0) { setViews(list, i); },
    select(n) { const i = typeof n === 'number' ? n : views.findIndex((v) => v.name === n); select(i); },
    mark(bays) { marked = bays || []; paint(); },
    highlight(prefix) { hl = prefix || ''; paint(); },
    get name() { return view().name; },
    debug() { return { cam: cam.position.toArray().map((v) => +v.toFixed(3)), target: controls.target.toArray(), model: !!model, aspect: +cam.aspect.toFixed(2), framedAt,
      view: view().name, pos: model ? model.position.toArray().map((v) => +v.toFixed(3)) : null,
      lit: (() => { let n = 0; if (model) model.traverse((c) => { if (c.isMesh && c.material === markMat) n += 1; }); return n; })() }; } };
  controls.addEventListener('change', () => { dirty = true; });
  function size() {
    const w = canvasBox.clientWidth, h = canvasBox.clientHeight;
    renderer.setSize(w, h, false); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix(); dirty = true;
    if (model && w > 0 && (!framedAt || framedAt !== w)) { model.position.set(0, 0, 0); frame(model); }   // shown after loading hidden, or resized
  }
  let lastW = -1, lastH = -1;
  (function loop() {                    // poll the size each frame: a viewer that starts hidden gets its real size when shown
    requestAnimationFrame(loop);
    const w = canvasBox.clientWidth, h = canvasBox.clientHeight;
    if (w !== lastW || h !== lastH) { lastW = w; lastH = h; if (w > 0 && h > 0) size(); }
    controls.update(); if (dirty && w > 0 && h > 0) { renderer.render(scene, cam); dirty = false; }
  })();
  if (views.length) load();
})();
