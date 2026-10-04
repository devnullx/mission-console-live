/* LELP-1 lab site: 3-D CAD viewer for the dedicated satellites (GLB files from cad/build_cad.py, CadQuery/OpenCascade).
   Markup: <div class="cad-view" data-name="SP-XTL" data-entry="1"></div>; optional <select class="cad-pick"> to switch designs.
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
  const grid = new THREE.GridHelper(6, 12, 0xb8c2cc, 0xd6dde4); scene.add(grid);           // 0.5 m squares
  const loader = new THREE.GLTFLoader();
  let model = null, name = el.dataset.name, entry = false, dirty = true, marked = [], framedAt = 0;
  const markMat = new THREE.MeshStandardMaterial({ color: 0x1f6fd1, emissive: 0x0b3a7a, roughness: 0.5, metalness: 0.2 });
  function mark() {                     // LELP-1: colour the booked bays (glTF nodes named bay_L_19..., bay_M_05...)
    if (!model) return;
    model.traverse((o) => {
      const m = /^bay_[LM]_(\d+)/.exec(o.name || '');
      if (!m) return;
      const on = marked.includes(+m[1]);
      o.traverse((c) => { if (c.isMesh) { if (!c.userData.mat0) c.userData.mat0 = c.material; c.material = on ? markMat : c.userData.mat0; } });
    });
    dirty = true;
  }

  function frame(obj) {
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    obj.position.sub(c); obj.position.y += size.y / 2;                                      // stand it on the grid
    grid.position.y = 0;
    const r = Math.max(size.x, size.y, size.z), rs = size.length() / 2;                    // fit the bounding sphere
    const asp = cam.aspect > 0.2 ? cam.aspect : 1.6;                                      // hidden canvas: assume a wide view
    const dist = rs / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * (asp < 1 ? 1.25 / asp : 1.0);
    framedAt = canvasBox.clientWidth;
    const dir = new THREE.Vector3(0.62, 0.32, 0.72).normalize();
    cam.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, size.y / 2, 0)); controls.target.set(0, size.y / 2, 0);
    cam.near = r / 100; cam.far = r * 50; cam.updateProjectionMatrix();
    controls.update(); dirty = true;
  }
  function load() {
    const url = `cad/${name}${entry ? '-entry' : ''}.glb`;
    bar.querySelector('.cad-status').textContent = 'loading…';
    loader.load(url, (g) => {
      if (model) scene.remove(model);
      model = g.scene; scene.add(model); frame(model); mark();
      bar.querySelector('.cad-status').textContent = `${name}${entry ? ' · entry configuration, heat shield inflated' : ' · in orbit, heat shield packed'} · drag to rotate, scroll to zoom`;
      links();
    }, undefined, () => { bar.querySelector('.cad-status').textContent = 'model not found'; });
  }
  function links() {
    bar.querySelector('.cad-dl').innerHTML = `<a href="cad/${name}-step.zip" download>STEP (zip)</a><a href="cad/${name}${entry ? '-entry' : ''}.glb" download>GLB</a><a href="cad/${name}.json">parts and mass properties</a>`;
  }
  bar.innerHTML = `<div class="seg"><button type="button" data-v="orbit" class="on">In orbit</button>${el.dataset.entry === '0' ? '' : '<button type="button" data-v="entry">Entry</button>'}<button type="button" data-v="reset">Reset view</button></div>
    <span class="cad-status small"></span><span class="cad-dl"></span>`;
  bar.querySelectorAll('button').forEach((b) => b.onclick = () => {
    if (b.dataset.v === 'reset') { if (model) frame(model); return; }
    entry = b.dataset.v === 'entry'; bar.querySelectorAll('button[data-v="orbit"],button[data-v="entry"]').forEach((x) => x.classList.toggle('on', x === b)); load();
  });
  const pick = document.querySelector('.cad-pick');
  if (pick) pick.onchange = () => { name = pick.value; entry = false; bar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'orbit'));
    const hasEntry = pick.selectedOptions[0].dataset.entry !== '0'; const eb = bar.querySelector('button[data-v="entry"]'); if (eb) eb.hidden = !hasEntry; load(); };
  window.LelpCad = { show(n, hasEntry = true) { name = n; entry = false; const eb = bar.querySelector('button[data-v="entry"]'); if (eb) eb.hidden = !hasEntry;
    bar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === 'orbit')); load(); },
    mark(bays) { marked = bays || []; mark(); }, get name() { return name; },
    debug() { return { cam: cam.position.toArray().map((v) => +v.toFixed(2)), target: controls.target.toArray(), model: !!model, aspect: +cam.aspect.toFixed(2), framedAt,
      pos: model ? model.position.toArray().map((v) => +v.toFixed(2)) : null }; } };
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
  if (name) load();
})();
