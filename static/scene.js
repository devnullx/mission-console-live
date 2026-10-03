/* 3-D scene for the mission console (three.js r128, no post-processing).
   Two sub-scenes: LAUNCH (pad -> ascent -> separation -> booster barge landing) and OPS (LELP over a
   textured Earth: modules, arm reaching the module in transfer, solar wings, relays, return capsule).
   API used by app.js: new Scene3D(canvas); setPhase('launch'|'ops'); updateLaunch(latest, hasSep);
   updateOps(frame, states, isolatedNodes, dt, ctx); setSolar(bool).
   Swap meshes for CAD glTF later; keep the node names (rocket.*, lelp.modules[i], lelp.arm, capsule). */
(function () {
  const TEX = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/';   // GitHub mirror, CORS ok
  const C = { gold: 0xb08a3e, goldActive: 0x3f9a5a, warn: 0xd09a2a, crit: 0xb03030, move: 0x2d7fe0,
              body: 0x23262b, trim: 0x474c55, cell: 0x14213d, flame: 0xffb060, flameCore: 0xfff3d0 };
  const lerp = (a, b, k) => a + (b - a) * k;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  function solarTexture() {   // procedural solar-cell grid
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#0f1a33'; g.fillRect(0, 0, 256, 64); g.strokeStyle = '#3b4f7a'; g.lineWidth = 2;
    for (let x = 0; x <= 256; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 64); g.stroke(); }
    for (let y = 0; y <= 64; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1); return t;
  }
  function mliTexture() {     // crinkled gold MLI
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#b08a3e'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) { g.strokeStyle = `rgba(${200 + Math.random() * 55},${160 + Math.random() * 60},${60 + Math.random() * 60},${0.25 + Math.random() * 0.4})`;
      g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const x = Math.random() * 256, y = Math.random() * 256; g.moveTo(x, y); g.lineTo(x + (Math.random() - .5) * 40, y + (Math.random() - .5) * 40); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function stars(n, r) {
    const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u); p.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3); }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: .85 }));
  }
  function flame(r, len, color) {
    const grp = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.ConeGeometry(r, len, 20, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    const core = new THREE.Mesh(new THREE.ConeGeometry(r * .5, len * .7, 16, 1, true), new THREE.MeshBasicMaterial({ color: C.flameCore, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
    [outer, core].forEach(m => { m.rotation.x = Math.PI; m.position.y = -len / 2 * (m === core ? .7 : 1); grp.add(m); });
    grp.userData = { outer, core, len };
    return grp;
  }
  function exhaust(count) {   // particle puff cloud (sprites)
    const g = new THREE.BufferGeometry(), p = new Float32Array(count * 3); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc896, size: 3.5, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.userData = { life: new Float32Array(count), vel: new Float32Array(count * 3), i: 0 }; pts.frustumCulled = false; return pts;
  }

  class Scene3D {
    constructor(canvas) {
      this.canvas = canvas;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.outputEncoding = THREE.sRGBEncoding; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
      this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x05070c);
      this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 2.0e6);
      this.camPos = V(0, 30, 120); this.camTarget = V(0, 20, 0);
      this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4); this.sun.position.set(30000, 22000, 18000); this.scene.add(this.sun);
      this.scene.add(new THREE.HemisphereLight(0x9fb9ff, 0x1a1410, 0.7));
      this.scene.add(stars(2600, 6.0e5));
      this.loader = new THREE.TextureLoader(); this.loader.setCrossOrigin('anonymous');
      this.t = 0; this.phase = null;
      this._buildLaunch(); this._buildOps();
      this.setPhase('launch');
      this._resize(); addEventListener('resize', () => this._resize());
    }
    _resize() { const w = this.canvas.clientWidth, h = this.canvas.clientHeight; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    _std(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .55, metalness: .35 }, o)); }
    _tex(name, onload) { this.loader.load(TEX + name, t => { t.encoding = THREE.sRGBEncoding; onload(t); }, undefined, () => {}); }

    // ================= LAUNCH: true scale, 1 unit = 1 km =================
    // Earth is a 6 371 km sphere at the origin (y = north pole). The pad is at APJ Abdul Kalam Island
    // (20.758 N, 87.085 E); the twin's downrange distance is laid along the easterly great circle, altitude
    // along the local vertical. Vehicles, pad and barge are drawn 40x larger than life so a 20 m rocket is
    // visible in a chase shot; at 1 000 km altitude a 0.6 km tower is sub-pixel, as it should be.
    _geo() {
      const R = 6371.0, lat = THREE.MathUtils.degToRad(20.758), lon = THREE.MathUtils.degToRad(87.085);
      const up = V(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));     // matches SphereGeometry uv mapping
      const east = V(-Math.sin(lon), 0, -Math.cos(lon));
      const north = new THREE.Vector3().crossVectors(up, east).negate();
      // launch azimuth 192 deg (RUPAK: dawn-dusk SSO, south-south-west over the Bay of Bengal)
      const az = THREE.MathUtils.degToRad(192), dir = north.clone().multiplyScalar(Math.cos(az)).add(east.clone().multiplyScalar(Math.sin(az))).normalize();
      return { R, up, east: dir, north };
    }
    _place(downrangeKm, altKm) {
      const { R, up, east } = this._geo(), ang = downrangeKm / R;
      const u = up.clone().multiplyScalar(Math.cos(ang)).add(east.clone().multiplyScalar(Math.sin(ang)));   // local up
      const f = up.clone().multiplyScalar(-Math.sin(ang)).add(east.clone().multiplyScalar(Math.cos(ang)));  // local forward (downrange)
      return { pos: u.clone().multiplyScalar(R + altKm), up: u, fwd: f, side: new THREE.Vector3().crossVectors(u, f).normalize() };
    }
    _orient(obj, up, fwd, tiltRad) {
      const b = up.clone().multiplyScalar(Math.cos(tiltRad)).add(fwd.clone().multiplyScalar(Math.sin(tiltRad))).normalize();
      obj.quaternion.setFromUnitVectors(V(0, 1, 0), b);
    }
    _buildLaunch() {
      const g = this.launch = new THREE.Group(); this.scene.add(g);
      const R = this.earthR = 6371.0;
      const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 192, 128), this._std(0x1c3f66, { roughness: .95, metalness: 0 }));
      g.add(earth); this.lEarth = earth;
      this._tex('earth_atmos_2048.jpg', t => { earth.material.map = t; earth.material.color.set(0xffffff); earth.material.needsUpdate = true; });
      const atmo = new THREE.Mesh(new THREE.SphereGeometry(R + 90, 128, 96), new THREE.MeshBasicMaterial({ color: 0x5aa0ff, transparent: true, opacity: .20, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      g.add(atmo);
      const VS = 0.04;   // scene km per real metre with the 40x exaggeration
      // pad + tower (40x): tower 15 m -> 0.6 km
      this.pad = new THREE.Group(); g.add(this.pad);
      const padMesh = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, .8, 32), this._std(0x3a3d42, { roughness: .9 })); padMesh.position.y = .4; this.pad.add(padMesh);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 46, 2.4), this._std(0x8a8f98, { roughness: .7 })); tower.position.set(-7, 23, 0); this.pad.add(tower);
      for (let i = 1; i < 6; i++) { const arm = new THREE.Mesh(new THREE.BoxGeometry(5, .5, .8), this._std(0x8a8f98)); arm.position.set(-4.5, i * 7.5, 0); this.pad.add(arm); }
      this.pad.scale.setScalar(VS / 3.0);
      // barge (40x)
      this.barge = new THREE.Group(); g.add(this.barge);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(26, 1.2, 14), this._std(0x2c3340, { roughness: .8 })); deck.position.y = .6; this.barge.add(deck);
      const mark = new THREE.Mesh(new THREE.RingGeometry(3.5, 4.2, 48), new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide })); mark.rotation.x = -Math.PI / 2; mark.position.y = 1.25; this.barge.add(mark);
      this.barge.scale.setScalar(VS / 3.0);
      // vehicle (procedural fallback, replaced by the CAD); built at 3 units per metre, scaled to VS
      const skin = this._std(0xe6e6e0, { roughness: .45, metalness: .25 });
      this.booster = new THREE.Group(); g.add(this.booster);
      const bBody = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 42, 32), skin); bBody.position.y = 21; this.booster.add(bBody);
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 3, 32), this._std(0x2a2a2a)); skirt.position.y = 1.5; this.booster.add(skirt);
      this.engines = new THREE.Group(); this.booster.add(this.engines);
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, r = i ? 1.4 : 0; const e = new THREE.Mesh(new THREE.ConeGeometry(.5, 1.6, 16, 1, true), this._std(0x555a63, { side: THREE.DoubleSide, metalness: .8 })); e.position.set(Math.cos(a) * r, -.6, Math.sin(a) * r); e.rotation.x = Math.PI; this.engines.add(e); }
      this.bFlame = flame(2.0, 26, C.flame); this.bFlame.position.y = -1; this.booster.add(this.bFlame);
      this.legs = []; this.fins = [];
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4;
        const pivot = new THREE.Group(); pivot.position.set(Math.cos(a) * 2.2, 4, Math.sin(a) * 2.2); pivot.rotation.y = -a; this.booster.add(pivot);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(.5, 12, 1.1), this._std(0x1f2226)); leg.position.set(0, -6, 0); pivot.add(leg); this.legs.push(pivot);
        const fp = new THREE.Group(); fp.position.set(Math.cos(a) * 2.2, 40, Math.sin(a) * 2.2); fp.rotation.y = -a; this.booster.add(fp);
        const fin = new THREE.Mesh(new THREE.BoxGeometry(2.6, .25, 2.0), this._std(0x3a3a3a, { metalness: .6 })); fin.position.x = 1.3; fp.add(fin); fp.rotation.z = Math.PI / 2; this.fins.push(fp);
      }
      this.upper = new THREE.Group(); g.add(this.upper);
      const uBody = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 12, 32), skin); uBody.position.y = 6; this.upper.add(uBody);
      const fairing = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 32), skin); fairing.position.y = 16.5; this.upper.add(fairing);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), skin); nose.position.y = 21; this.upper.add(nose);
      const vacEngine = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.2, 24, 1, true), this._std(0x555a63, { side: THREE.DoubleSide, metalness: .8 })); vacEngine.position.y = -2.4; vacEngine.rotation.x = Math.PI; this.upper.add(vacEngine);
      this.uFlame = flame(1.3, 16, 0xa0c8ff); this.uFlame.position.y = -3; this.upper.add(this.uFlame);
      this.vehScale = VS / 3.0; this.booster.scale.setScalar(this.vehScale); this.upper.scale.setScalar(this.vehScale);
      this.stackH = 42 * this.vehScale;    // booster height in km (procedural); CAD overrides
      this.plume = exhaust(300); g.add(this.plume);
      this.plume.material.size = 0.05; this.plume.material.sizeAttenuation = true; this.plume.material.opacity = .45;
      this.sepT = null;
      // local terrain around the pad (the 2 048 px Earth texture is ~20 km/pixel): a 60 km disc, land west, sea east (downrange is now SSW over water)
      const site = this._place(0, 0); this.pad.position.copy(site.pos); this._orient(this.pad, site.up, site.fwd, 0);
      const ground = new THREE.Group(); g.add(ground); ground.position.copy(site.pos); this._orient(ground, site.up, site.fwd, 0);
      const sea = new THREE.Mesh(new THREE.CircleGeometry(60, 64), this._std(0x173a55, { roughness: .4, metalness: .1 })); sea.rotation.x = -Math.PI / 2; sea.position.y = -0.02; ground.add(sea);
      const landShape = new THREE.Shape(); landShape.moveTo(-60, -60); landShape.lineTo(-60, 60); landShape.lineTo(2, 60); landShape.bezierCurveTo(8, 20, -6, -20, 1, -60); landShape.lineTo(-60, -60);
      const land = new THREE.Mesh(new THREE.ShapeGeometry(landShape), this._std(0x2d3b26, { roughness: 1 })); land.rotation.x = -Math.PI / 2; land.position.y = -0.01; ground.add(land);
      // island strip under the pad (APJ Abdul Kalam Island is a 3 km barrier island)
      const island = new THREE.Mesh(new THREE.BoxGeometry(1.2, .02, 4.0), this._std(0x3a4a2e, { roughness: 1 })); island.position.y = 0; ground.add(island);
      this._loadCad();
    }
    _loadCad() {
      /* Team CAD (scripts/cad_to_glb.py): booster.glb / upper.glb in metres, Y up, base at the origin.
         Inside the vehicle groups 1 unit = 1/3 m (procedural build scale), so the CAD gets scale 3. */
      if (!THREE.GLTFLoader) return;
      const loader = new THREE.GLTFLoader(), S = 3.0;
      const skin = new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: .42, metalness: .3 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: .6, metalness: .6 });
      const attach = (grp, gltf, hideProcedural) => {
        const root = gltf.scene; root.scale.setScalar(S);
        root.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); const bb = new THREE.Box3().setFromObject(o); o.material = (bb.max.y - bb.min.y) < 2.5 ? dark : skin; o.material.side = THREE.DoubleSide; } });
        hideProcedural.forEach(o => o.visible = false);
        grp.add(root); grp.userData.cad = root;
        const bb = new THREE.Box3(); root.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox); } });
        grp.userData.cadHeight = (bb.max.y - bb.min.y) * S;   // metres x S = group units (independent of the group's own scale)
      };
      // booster: CAD body + 4 legs + 4 fins as separate nodes so they can deploy (scripts/cad_parts.py)
      loader.load('static/models/booster_body.glb?v=1', g => {
        attach(this.booster, g, this.booster.children.filter(c => c !== this.bFlame));
        this.legs.forEach(l => l.visible = false); this.fins.forEach(f => f.visible = false); this.engines.visible = false;
        this.bFlame.position.y = -0.5;
        this.cadBoosterH = this.booster.userData.cadHeight; this.stackH = this.cadBoosterH * this.vehScale;
      }, undefined, () => {});
      fetch('static/models/parts.json').then(r => r.json()).then(meta => {
        this.cadLegs = []; this.cadFins = [];
        const mount = (file, list, key, rotSign) => loader.load(file, g => {
          g.scene.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); o.material = dark; o.material.side = THREE.DoubleSide; } });
          meta[key].forEach(info => {
            const node = g.scene.getObjectByName(info.name); if (!node) return;
            const pivot = new THREE.Group(); const h = info.hinge; pivot.position.set(h[0] * S, h[1] * S, h[2] * S);
            node.position.set(0, 0, 0); node.scale.setScalar(S); pivot.add(node); this.booster.add(pivot);
            const ang = THREE.MathUtils.degToRad(info.angle_deg);
            list.push({ pivot, axis: V(-Math.sin(ang), 0, Math.cos(ang)).normalize(), sign: rotSign });
          });
        }, undefined, () => {});
        mount('static/models/legs.glb?v=1', this.cadLegs, 'legs', -1);   // legs: hinge at the base, swing the foot out and down
        mount('static/models/fins.glb?v=1', this.cadFins, 'fins', +1);   // fins: hinge at the top, blade swings outward
      }).catch(() => {});
      this.legDeploy = 0; this.finDeploy = 0;
      loader.load('static/models/upper.glb?v=3', g => { attach(this.upper, g, this.upper.children.filter(c => c !== this.uFlame)); }, undefined, () => {});
    }
    _emit(pos, dir, n, spread, speed) {
      const u = this.plume.userData, p = this.plume.geometry.attributes.position.array;
      for (let k = 0; k < n; k++) { const i = u.i = (u.i + 1) % u.life.length; p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
        u.vel[i * 3] = dir.x * speed + (Math.random() - .5) * spread; u.vel[i * 3 + 1] = dir.y * speed + (Math.random() - .5) * spread; u.vel[i * 3 + 2] = dir.z * speed + (Math.random() - .5) * spread; u.life[i] = 1; }
    }
    _stepPlume(dt) {
      const u = this.plume.userData, p = this.plume.geometry.attributes.position.array;
      for (let i = 0; i < u.life.length; i++) { if (u.life[i] <= 0) continue; u.life[i] -= dt * 1.6; p[i * 3] += u.vel[i * 3] * dt; p[i * 3 + 1] += u.vel[i * 3 + 1] * dt; p[i * 3 + 2] += u.vel[i * 3 + 2] * dt; if (u.life[i] <= 0) p[i * 3 + 1] = -1e7; }
      this.plume.geometry.attributes.position.needsUpdate = true;
    }
    _flameOn(f, on, throttle, flicker) {
      f.visible = on; if (!on) return;
      const s = (0.75 + 0.35 * throttle) * (1 + Math.sin(flicker * 37) * .06); f.scale.set(1, s, 1);
    }
    updateLaunch(s, hasSep) {
      const dt = 1 / 60; this.t += dt;
      const hero = s.upper || s.stack, alt = hero ? hero.alt_km : 0;
      const k = Math.min(alt / 90, 1); this.scene.background.setRGB(lerp(.36, .01, k), lerp(.56, .02, k), lerp(.85, .05, k));
      const placeVeh = (obj, smp, tilt) => { const g = this._place(smp.downrange_km, Math.max(smp.alt_km, 0)); obj.position.copy(g.pos); this._orient(obj, g.up, g.fwd, tilt); return g; };
      let camFrom = null, camAt = null;
      if (!hasSep) {
        const body = s.stack || { downrange_km: 0, alt_km: 0, throttle: 0 };
        const tilt = Math.atan2(body.downrange_km, body.alt_km + 6) * .95;
        const g = placeVeh(this.booster, body, tilt);
        // the upper stage rides on top of the booster
        const topDir = g.up.clone().multiplyScalar(Math.cos(tilt)).add(g.fwd.clone().multiplyScalar(Math.sin(tilt)));
        this.upper.position.copy(g.pos).add(topDir.multiplyScalar(this.stackH)); this.upper.quaternion.copy(this.booster.quaternion);
        const on = body.throttle > 0; this._flameOn(this.bFlame, on, body.throttle, this.t); this.uFlame.visible = false;
        if (on) this._emit(g.pos.clone().sub(g.up.clone().multiplyScalar(.04)), g.up.clone().negate(), alt < 3 ? 10 : 3, alt < 3 ? .03 : .01, alt < 3 ? .06 : .03);
        const d = Math.max(1.6, alt * .09);                         // chase distance grows with altitude so the curvature shows
        camFrom = g.pos.clone().add(g.side.clone().multiplyScalar(d * .8)).add(g.fwd.clone().multiplyScalar(-d * .45)).add(g.up.clone().multiplyScalar(d * .3));
        camAt = g.pos.clone().add(g.up.clone().multiplyScalar(this.stackH * .6));
        this.sepT = null;
      } else {
        if (this.sepT === null) this.sepT = this.t;
        const sepAge = this.t - this.sepT;
        let gb = null, gu = null;
        if (s.upper) { gu = placeVeh(this.upper, s.upper, lerp(0.4, 1.45, Math.min(sepAge / 6, 1))); this._flameOn(this.uFlame, s.upper.throttle > 0, s.upper.throttle, this.t); }
        if (s.booster) {
          const b = s.booster; const retro = ['boostback', 'entry_coast', 'entry_burn', 'descent', 'landing_burn'].includes(b.phase);
          gb = placeVeh(this.booster, b, b.phase === 'coast' ? .5 : (b.phase === 'boostback' ? Math.PI * .85 : 0.0));
          this._flameOn(this.bFlame, b.throttle > 0, b.throttle, this.t);
          if (b.throttle > 0) this._emit(gb.pos.clone(), gb.up.clone().negate(), 2, .01, .03);
          const finsOut = ['entry_coast', 'entry_burn', 'descent', 'landing_burn'].includes(b.phase);
          const legsOut = (b.phase === 'landing_burn' && b.alt_km < 1.2) || b.landed;
          this.finDeploy = lerp(this.finDeploy, (b.fins != null ? b.fins : (finsOut ? 1 : 0)), .08);
          this.legDeploy = lerp(this.legDeploy, legsOut ? 1 : 0, .06);
          if (this.cadLegs) {
            const LEG_DEPLOY = THREE.MathUtils.degToRad(115), FIN_DEPLOY = THREE.MathUtils.degToRad(70);
            this.cadLegs.forEach(l => l.pivot.quaternion.setFromAxisAngle(l.axis, l.sign * LEG_DEPLOY * this.legDeploy));
            this.cadFins.forEach(f => f.pivot.quaternion.setFromAxisAngle(f.axis, f.sign * FIN_DEPLOY * this.finDeploy));
            // with the legs down the nozzles sit 1.28 m above the deck (docs/REENTRY.md): lift the body accordingly
            if (b.alt_km < 0.05) { this.booster.position.add(gb.up.clone().multiplyScalar(0.0512 * this.legDeploy)); }
          } else if (!this.cadBoosterH) { this.fins.forEach(f => f.rotation.z = lerp(f.rotation.z, finsOut ? 0 : Math.PI / 2, .06)); this.legs.forEach(l => l.rotation.z = lerp(l.rotation.z, legsOut ? -0.55 : 0, .08)); }
          if (b.landed) this.bFlame.visible = false;
        }
        const lz = this._place(this.landingZoneKm || 0, 0); this.barge.position.copy(lz.pos); this._orient(this.barge, lz.up, lz.fwd, 0);
        const g = gb || gu, smp = s.booster || s.upper;
        if (gb && s.booster.alt_km < 4 && ['landing_burn', 'descent'].includes(s.booster.phase)) {
          camFrom = lz.pos.clone().add(lz.side.clone().multiplyScalar(1.4)).add(lz.fwd.clone().multiplyScalar(.9)).add(lz.up.clone().multiplyScalar(.35));
          camAt = gb.pos.clone().add(gb.up.clone().multiplyScalar(.25));
        } else {
          const d = Math.max(2.0, smp.alt_km * .12);
          camFrom = g.pos.clone().add(g.side.clone().multiplyScalar(d * .8)).add(g.fwd.clone().multiplyScalar(-d * .5)).add(g.up.clone().multiplyScalar(d * .3));
          camAt = g.pos.clone();
        }
      }
      if (camFrom) { this.camPos.copy(camFrom); this.camTarget.copy(camAt); }   // rigid chase: replay runs 20-300x real time
      this._stepPlume(dt);
      this.camera.position.copy(this.camPos); this.camera.up.copy(this.camPos.clone().normalize()); this.camera.lookAt(this.camTarget);
      this.renderer.render(this.scene, this.camera);
    }

    // ================= OPS: LELP in orbit =================
    _buildOps() {
      const g = this.ops = new THREE.Group(); this.scene.add(g);
      const R = 420;
      const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), this._std(0x1c3f66, { roughness: .9, metalness: 0 }));
      earth.position.set(40, -R - 30, -140); g.add(earth); this.earth = earth;
      this._tex('earth_atmos_2048.jpg', t => { earth.material.map = t; earth.material.color.set(0xffffff); earth.material.needsUpdate = true; });
      this._tex('earth_specular_2048.jpg', t => { earth.material.roughnessMap = t; earth.material.roughness = .8; earth.material.needsUpdate = true; });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 96, 64), new THREE.MeshBasicMaterial({ color: 0x5aa0ff, transparent: true, opacity: .22, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.copy(earth.position); g.add(glow);
      const lelp = this.lelp = new THREE.Group(); g.add(lelp);
      const mli = mliTexture();
      this.modules = [];
      const Rm = 5.2;
      const layers = [{ y: 0, h: 2.5 }, { y: 2.6, h: 2.5 }, { y: 5.2, h: 4.5 }, { y: 9.8, h: 4.5 }];
      layers.forEach(L => {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const m = new THREE.Mesh(new THREE.BoxGeometry(3.6, L.h - .3, 2.2), this._std(0xffffff, { map: mli, roughness: .4, metalness: .75 }));
          m.position.set(Math.cos(a) * Rm, L.y + L.h / 2, Math.sin(a) * Rm); m.rotation.y = -a + Math.PI / 2;
          const led = new THREE.Mesh(new THREE.SphereGeometry(.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0x222222 })); led.position.set(1.4, -(L.h - .3) / 2 + .35, 1.15); m.add(led); m.userData.led = led;
          lelp.add(m); this.modules.push(m);
        }
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(Rm + 1.3, Rm + 1.3, .25, 8), this._std(0xd8d8d2, { metalness: .6, roughness: .3 })); ring.position.y = L.y; lelp.add(ring);
      });
      const core = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 15, 8), this._std(C.body)); core.position.y = 7.3; lelp.add(core);
      const lab = new THREE.Mesh(new THREE.CylinderGeometry(Rm + 1.3, Rm + 1.3, 5, 8), new THREE.MeshPhysicalMaterial({ color: 0xbfe0ff, transparent: true, opacity: .22, roughness: .05, metalness: 0, transmission: 0, side: THREE.DoubleSide })); lab.position.y = 17; lelp.add(lab);
      const rig = new THREE.Mesh(new THREE.BoxGeometry(5, .3, 5), this._std(0x9aa0aa, { metalness: .7 })); rig.position.y = 14.8; lelp.add(rig); this.rig = rig;
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(Rm + 1.4, Rm + 1.4, .3, 8), this._std(0xd8d8d2, { metalness: .6 })); lid.position.y = 19.6; lelp.add(lid);
      // Dexter-L: 7 joints driven by the twin's joint angles (sentinel/lelp/arm.py); 9.5 scene units per metre.
      // Links use the team's arm CAD (assets/cad/arm.stl -> models/arm_*.glb) scaled 2.15x like the twin's L1/L2.
      const U = 9.5, L1m = 0.52, L2m = 0.98, K = 2.15;
      const link = (len, r, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * .85, len, 14), mat); m.rotation.z = -Math.PI / 2; m.position.x = len / 2; return m; };
      const jm = this._std(0x3a3f47, { metalness: .8, roughness: .35 }), lm = this._std(0xe8e8e2, { metalness: .4, roughness: .45 });
      this.arm = new THREE.Group(); this.arm.position.set(0.62 * U, 1.45 * U, 0); lelp.add(this.arm);          // J1 yaw
      this.armBaseProc = new THREE.Mesh(new THREE.CylinderGeometry(.55, .65, 1.2, 16), jm); this.arm.add(this.armBaseProc);
      this.j2 = new THREE.Group(); this.j2.position.y = .6; this.arm.add(this.j2);                               // J2 shoulder pitch (about z)
      this.j2.add(new THREE.Mesh(new THREE.SphereGeometry(.55, 16, 16), jm));
      this.j3 = new THREE.Group(); this.j2.add(this.j3);                                                          // J3 roll (about x)
      this.armUpperProc = link(L1m * U, .3, lm); this.j3.add(this.armUpperProc);
      this.j4 = new THREE.Group(); this.j4.position.x = L1m * U; this.j3.add(this.j4);                            // J4 elbow (about z)
      this.j4.add(new THREE.Mesh(new THREE.SphereGeometry(.42, 16, 16), jm)); this.armForeProc = link(L2m * U, .24, lm); this.j4.add(this.armForeProc);
      this.j5 = new THREE.Group(); this.j5.position.x = L2m * U; this.j4.add(this.j5);                            // J5 wrist pitch
      this.j5.add(new THREE.Mesh(new THREE.SphereGeometry(.3, 12, 12), jm));
      this.j6 = new THREE.Group(); this.j5.add(this.j6);                                                          // J6 roll
      this.j7 = new THREE.Group(); this.j6.add(this.j7);                                                          // J7 yaw
      const cam = new THREE.Mesh(new THREE.BoxGeometry(.5, .35, .35), jm); cam.position.set(.6, .45, 0); this.j7.add(cam);
      this.gripper = new THREE.Mesh(new THREE.BoxGeometry(0.15 * U, .9, 1.4), jm); this.gripper.position.x = 0.075 * U; this.j7.add(this.gripper);
      this.carried = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 2.0), this._std(0xffffff, { map: mli, metalness: .7, roughness: .4 })); this.carried.position.x = 0.15 * U + 1.2; this.carried.visible = false; this.j7.add(this.carried);
      if (THREE.GLTFLoader) {
        const ld = new THREE.GLTFLoader(), armMat = this._std(0xd9dadc, { metalness: .6, roughness: .4 });
        const put = (url, parent, proc, rotY) => ld.load(url, g => { const r = g.scene; r.scale.setScalar(K * U); if (rotY) r.rotation.y = rotY;
          r.traverse(o => { if (o.isMesh) { if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); o.material = armMat; o.material.side = THREE.DoubleSide; } });
          parent.add(r); if (proc) proc.visible = false; }, undefined, () => {});
        put('static/models/arm_upper.glb?v=1', this.j3, this.armUpperProc, 0);
        put('static/models/arm_fore.glb?v=1', this.j4, this.armForeProc, 0);
        put('static/models/arm_base.glb?v=1', this.arm, this.armBaseProc, -Math.PI / 2);   // base bracket stands on the ring
      }
      this.L1 = L1m * U; this.L2 = L2m * U;
      this.armUpper = this.j2; this.armElbow = this.j4;   // compatibility
      this.L1 = 0.75 * U; this.L2 = 0.75 * U;
      // solar wings with cell texture
      const cells = solarTexture();
      this.solar = new THREE.Group(); this.solar.position.y = -7; lelp.add(this.solar);
      [-1, 1].forEach(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(16, .12, 3.4), this._std(0xffffff, { map: cells, metalness: .5, roughness: .35 })); p.position.x = s * 12; this.solar.add(p);
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 4.5, 8), this._std(0x9aa0aa)); boom.rotation.z = Math.PI / 2; boom.position.x = s * 2.2; this.solar.add(boom); });
      this.solar.scale.set(.05, 1, 1);
      // upper stage below (integrated bus)
      const adapter = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.8, 2.4, 8, 1, true), this._std(0xd8d8d2, { side: THREE.DoubleSide, wireframe: true })); adapter.position.y = -1.6; lelp.add(adapter);
      const stage = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 22, 32), this._std(0xe6e6e0, { roughness: .45, metalness: .25 })); stage.position.y = -14; lelp.add(stage);
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4, 24, 1, true), this._std(0x555a63, { side: THREE.DoubleSide, metalness: .8 })); nozzle.position.y = -27; nozzle.rotation.x = Math.PI; lelp.add(nozzle);
      // return capsule (docked on top until CAPSULE_SEP)
      this.capsule = new THREE.Group(); g.add(this.capsule);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3.2, 32), this._std(0xd0d4da, { metalness: .5, roughness: .4 })); cap.position.y = 1.6; this.capsule.add(cap);
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.8, .6, 32), this._std(0x4a2a1a, { roughness: .9 })); this.capsule.add(shield);
      this.plasma = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 24), new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); this.capsule.add(this.plasma);
      this.chute = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this._std(0xff7f2a, { side: THREE.DoubleSide, roughness: .9 })); this.chute.position.y = 11; this.chute.visible = false; this.capsule.add(this.chute);
      this.capsule.position.set(0, 21.5, 0); this.capsuleState = 'docked'; this.capsuleT = 0;
      // relays + ground stations as points on the Earth limb
      this.relays = []; this.links = new THREE.Group(); g.add(this.links);
      [[-70, 28, -60], [78, 36, -50]].forEach(p => { const r = new THREE.Group(); r.position.set(...p);
        const bus = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), this._std(0xffffff, { map: mli, metalness: .7 })); r.add(bus);
        [-1, 1].forEach(s => { const w = new THREE.Mesh(new THREE.BoxGeometry(4, .08, 1.4), this._std(0xffffff, { map: cells, metalness: .5 })); w.position.x = s * 3; r.add(w); });
        g.add(r); this.relays.push(r); });
      this.linkMat = { on: new THREE.LineBasicMaterial({ color: 0x5fd39a, transparent: true, opacity: .8 }), off: new THREE.LineBasicMaterial({ color: 0x9a3030, transparent: true, opacity: .8 }) };
    }
    updateOps(frame, states, isolatedNodes, dt, ctx = {}) {
      this.t += dt;
      this.scene.background.setRGB(.02, .03, .06);
      this.lelp.rotation.y += dt * .03; this.earth.rotation.y += dt * .004;
      const p = frame.platform;
      // modules: colour + status LED
      states.forEach((s, i) => { const m = this.modules[i]; if (!m) return;
        const col = { idle: 0xffffff, good: 0xd8ffd8, warn: 0xffe0a0, crit: 0xffb0b0, move: 0xc0d8ff }[s] || 0xffffff;
        m.material.color.setHex(col); m.material.emissive.setHex(s === 'move' ? 0x0d2a5a : s === 'crit' ? 0x3a0a0a : 0x000000);
        m.userData.led.material.color.setHex({ idle: 0x222222, good: 0x1fe06a, warn: 0xffb020, crit: 0xff3030, move: 0x40a0ff }[s]);
        m.visible = !(ctx.capsuleState && ctx.capsuleState !== 'docked' && i === 16 && ctx.capsuleState !== 'landed'); });
      // Dexter-L: apply the twin's joint angles (deg). J1 yaw about y, J2/J4/J5 pitch about z, J3/J6 roll about x, J7 yaw about y
      const a = p.arm, R = THREE.MathUtils.degToRad;
      if (a.joints) {
        const j = a.joints, k = .15;
        this.arm.rotation.y = lerp(this.arm.rotation.y, R(-j[0]), k); this.j2.rotation.z = lerp(this.j2.rotation.z, R(j[1]), k); this.j3.rotation.x = lerp(this.j3.rotation.x, R(j[2]), k);
        this.j4.rotation.z = lerp(this.j4.rotation.z, R(j[3]), k); this.j5.rotation.z = lerp(this.j5.rotation.z, R(j[4]), k); this.j6.rotation.x = lerp(this.j6.rotation.x, R(j[5]), k); this.j7.rotation.y = lerp(this.j7.rotation.y, R(j[6]), k);
        this.carried.visible = !!a.grip; if (a.module) this.modules[a.module - 1].visible = !a.grip;
      }
      // solar wings with cell texture
      const cells = solarTexture();
      this.solar = new THREE.Group(); this.solar.position.y = -7; lelp.add(this.solar);
      [-1, 1].forEach(s => { const p = new THREE.Mesh(new THREE.BoxGeometry(16, .12, 3.4), this._std(0xffffff, { map: cells, metalness: .5, roughness: .35 })); p.position.x = s * 12; this.solar.add(p);
        const boom = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 4.5, 8), this._std(0x9aa0aa)); boom.rotation.z = Math.PI / 2; boom.position.x = s * 2.2; this.solar.add(boom); });
      this.solar.scale.set(.05, 1, 1);
      // upper stage below (integrated bus)
      const adapter = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.8, 2.4, 8, 1, true), this._std(0xd8d8d2, { side: THREE.DoubleSide, wireframe: true })); adapter.position.y = -1.6; lelp.add(adapter);
      const stage = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 22, 32), this._std(0xe6e6e0, { roughness: .45, metalness: .25 })); stage.position.y = -14; lelp.add(stage);
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4, 24, 1, true), this._std(0x555a63, { side: THREE.DoubleSide, metalness: .8 })); nozzle.position.y = -27; nozzle.rotation.x = Math.PI; lelp.add(nozzle);
      // return capsule (docked on top until CAPSULE_SEP)
      this.capsule = new THREE.Group(); g.add(this.capsule);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3.2, 32), this._std(0xd0d4da, { metalness: .5, roughness: .4 })); cap.position.y = 1.6; this.capsule.add(cap);
      const shield = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.8, .6, 32), this._std(0x4a2a1a, { roughness: .9 })); this.capsule.add(shield);
      this.plasma = new THREE.Mesh(new THREE.SphereGeometry(3.4, 24, 24), new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); this.capsule.add(this.plasma);
      this.chute = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this._std(0xff7f2a, { side: THREE.DoubleSide, roughness: .9 })); this.chute.position.y = 11; this.chute.visible = false; this.capsule.add(this.chute);
      this.capsule.position.set(0, 21.5, 0); this.capsuleState = 'docked'; this.capsuleT = 0;
      // relays + ground stations as points on the Earth limb
      this.relays = []; this.links = new THREE.Group(); g.add(this.links);
      [[-70, 28, -60], [78, 36, -50]].forEach(p => { const r = new THREE.Group(); r.position.set(...p);
        const bus = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), this._std(0xffffff, { map: mli, metalness: .7 })); r.add(bus);
        [-1, 1].forEach(s => { const w = new THREE.Mesh(new THREE.BoxGeometry(4, .08, 1.4), this._std(0xffffff, { map: cells, metalness: .5 })); w.position.x = s * 3; r.add(w); });
        g.add(r); this.relays.push(r); });
      this.linkMat = { on: new THREE.LineBasicMaterial({ color: 0x5fd39a, transparent: true, opacity: .8 }), off: new THREE.LineBasicMaterial({ color: 0x9a3030, transparent: true, opacity: .8 }) };
    }
    _armIK(targetLocal) {
      // 2-link planar IK in the arm's vertical plane after yawing toward the target
      const tx = targetLocal.x, ty = targetLocal.y, tz = targetLocal.z;
      const yaw = Math.atan2(-tz, tx); this.arm.rotation.y = lerp(this.arm.rotation.y, yaw, .06);
      const horiz = Math.hypot(tx, tz), d = Math.min(Math.hypot(horiz, ty), this.L1 + this.L2 - .05);
      const a1 = Math.acos((this.L1 * this.L1 + d * d - this.L2 * this.L2) / (2 * this.L1 * d));
      const a2 = Math.acos((this.L1 * this.L1 + this.L2 * this.L2 - d * d) / (2 * this.L1 * this.L2));
      const base = Math.atan2(ty, horiz);
      // upper link hangs down (-y) by default; rotate it in the x-y plane
      const upperAng = -(Math.PI / 2) + base + a1;      // angle of upper link from +x
      this.armUpper.rotation.z = lerp(this.armUpper.rotation.z, upperAng + Math.PI / 2, .06);
      this.armElbow.rotation.z = lerp(this.armElbow.rotation.z, -(Math.PI - a2) + Math.PI / 2, .06);
    }
    updateOps(frame, states, isolatedNodes, dt, ctx = {}) {
      this.t += dt;
      this.scene.background.setRGB(.02, .03, .06);
      this.lelp.rotation.y += dt * .03; this.earth.rotation.y += dt * .004;
      const p = frame.platform;
      // modules: colour + status LED
      states.forEach((s, i) => { const m = this.modules[i]; if (!m) return;
        const col = { idle: 0xffffff, good: 0xd8ffd8, warn: 0xffe0a0, crit: 0xffb0b0, move: 0xc0d8ff }[s] || 0xffffff;
        m.material.color.setHex(col); m.material.emissive.setHex(s === 'move' ? 0x0d2a5a : s === 'crit' ? 0x3a0a0a : 0x000000);
        m.userData.led.material.color.setHex({ idle: 0x222222, good: 0x1fe06a, warn: 0xffb020, crit: 0xff3030, move: 0x40a0ff }[s]);
        m.visible = !(ctx.capsuleState && ctx.capsuleState !== 'docked' && i === 16 && ctx.capsuleState !== 'landed'); });
      // arm: reach the module in transfer, carry it to the rig, return
      const a = p.arm; const stepIdx = ['identify', 'unlock', 'capture', 'transfer', 'dock', 'position', 'analyse', 'return', 'record'].indexOf(a.step);
      if (a.busy && a.module) {
        const mod = this.modules[a.module - 1]; const target = new THREE.Vector3();
        if (stepIdx <= 2 || stepIdx >= 7) { mod.getWorldPosition(target); } else { this.rig.getWorldPosition(target); target.y += 1.5; }
        this.arm.worldToLocal(target); this._armIK(target);
        const carrying = stepIdx >= 2 && stepIdx <= 7; this.carried.visible = carrying; mod.visible = !carrying;
      } else { this.carried.visible = false; this.arm.rotation.y = lerp(this.arm.rotation.y, 0, .03); this.armUpper.rotation.z = lerp(this.armUpper.rotation.z, 0, .03); this.armElbow.rotation.z = lerp(this.armElbow.rotation.z, 0, .03); }
      // solar wings
      const solarTarget = this._solarDeployed ? 1 : .05; this.solar.scale.x = lerp(this.solar.scale.x, solarTarget, .04);
      // relays + links
      this.links.children.forEach(c => c.geometry.dispose()); this.links.clear();
      const lelpPos = V(0, 8, 0);
      this.relays.forEach((r, i) => { const name = 'RELAY-' + (i + 1); const iso = isolatedNodes.includes(name); r.rotation.y += dt * .3;
        r.children[0].material.emissive.setHex(iso ? 0x5a1010 : 0x000000);
        if ((frame.comms.visible || []).includes(name) || iso) { const geo = new THREE.BufferGeometry().setFromPoints([lelpPos, r.position]); this.links.add(new THREE.Line(geo, iso ? this.linkMat.off : this.linkMat.on)); } });
      // return capsule
      this._stepCapsule(ctx.capsuleState || 'docked', dt);
      // camera: slow orbit around LELP, pull back during return
      const ang = this.t * .05; const ret = ctx.capsuleState && !['docked', 'landed'].includes(ctx.capsuleState);
      const d = ret ? 95 : 62; this.camPos.lerp(V(Math.cos(ang) * d, 14 + Math.sin(this.t * .11) * 4, Math.sin(ang) * d), .02);
      const tgt = ret ? this.capsule.position.clone().lerp(V(0, 4, 0), .5) : V(0, 2, 0); this.camTarget.lerp(tgt, .04);
      this.camera.position.copy(this.camPos); this.camera.lookAt(this.camTarget);
      this.renderer.render(this.scene, this.camera);
    }
    _stepCapsule(state, dt) {
      if (state !== this.capsuleState) { this.capsuleState = state; this.capsuleT = 0; }
      this.capsuleT += dt; const c = this.capsule, T = this.capsuleT;
      const earthTop = this.earth.position.y + 420;
      if (state === 'docked') { c.position.set(0, 21.5, 0); c.rotation.set(0, this.lelp.rotation.y, 0); this.plasma.material.opacity = 0; this.chute.visible = false; c.visible = true; return; }
      c.visible = true;
      if (state === 'sep') { c.position.lerp(V(-8, 26, 6), .02); c.rotation.z = lerp(c.rotation.z, .3, .02); }
      else if (state === 'deorbit') { c.position.lerp(V(-30, 12, 20), .01); c.rotation.z = lerp(c.rotation.z, 2.6, .02); }
      else if (state === 'entry') { c.position.lerp(V(-70, earthTop + 70, 40), .006); c.rotation.z = lerp(c.rotation.z, 2.9, .02); this.plasma.material.opacity = lerp(this.plasma.material.opacity, .75 + Math.sin(T * 25) * .15, .1); this.plasma.scale.setScalar(1 + Math.sin(T * 13) * .12); }
      else if (state === 'chute') { this.plasma.material.opacity = lerp(this.plasma.material.opacity, 0, .05); this.chute.visible = true; c.rotation.z = lerp(c.rotation.z, 3.14, .03); c.position.lerp(V(-90, earthTop + 30, 50), .004); }
      else if (state === 'landed') { this.chute.visible = false; this.plasma.material.opacity = 0; c.visible = false; }
    }
    setPhase(p) { if (p === this.phase) return; this.phase = p; this.launch.visible = p === 'launch'; this.ops.visible = p === 'ops';
      if (p === 'ops') { this.camera.up.set(0, 1, 0); this.camPos.set(60, 20, 60); } else { const g = this._place(0, 0); this.camPos.copy(g.pos.clone().add(g.side.clone().multiplyScalar(1.4)).add(g.up.clone().multiplyScalar(.5))); this.camTarget.copy(g.pos); } }
    setSolar(d) { this._solarDeployed = d; }
    setLandingZone(km) { this.landingZoneKm = km; }
  }
  window.Scene3D = Scene3D;
})();
