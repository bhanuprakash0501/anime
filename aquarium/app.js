// Sketch Aquarium 3D renderer (three.js).
// Every scanned drawing becomes the skin of a rigged 3D creature (see models.js) that
// swims through a 3D tank. Creatures cross the screen, sometimes leave the frame and come back, and
// retire two minutes after they arrived. New arrivals enter through a submarine pipe.
(() => {
  const hint = document.getElementById('hint');
  const SHOWCASE = /[?&]showcase=1/.test(location.search);   // ?showcase=1 parks creatures up close for review
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------- tank bounds
  const TANK = { x: 26, yMin: 2.5, yMax: 20, zMin: -28, zMax: 10 };
  const OFFSCREEN_X = TANK.x + 26;                // beyond the frame at any depth
  const FLOOR_Y = 0;
  const PIPE = { x: 27, y: 13, z: -4 };          // pipe mouth, opens toward -x

  // ----------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const WATER = new THREE.Color(0x1490c8);
  scene.background = WATER;
  scene.fog = new THREE.Fog(WATER, 30, 95);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, 11, 46);
  camera.lookAt(0, 10, -6);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
    }
  });

  // ------------------------------------------------------------------- lights
  scene.add(new THREE.HemisphereLight(0xcdf0ff, 0x1f4d66, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-12, 40, 25);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fd8ff, 0.35);
  fill.position.set(20, 5, -20);
  scene.add(fill);

  // ------------------------------------------------------------------ helpers
  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // --------------------------------------------------------------- backdrop
  {
    const t = canvasTexture(64, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#5fe3f7'); gr.addColorStop(0.35, '#22b3de'); gr.addColorStop(1, '#0b5f92');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(400, 160), new THREE.MeshBasicMaterial({ map: t, fog: false }));
    back.position.set(0, 40, -110);
    scene.add(back);
  }

  // ------------------------------------------------------------------ floor
  {
    const t = canvasTexture(512, 512, (g, w, h) => {
      g.fillStyle = '#cdbf8e'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `rgba(${rand(150, 230) | 0},${rand(140, 200) | 0},${rand(90, 150) | 0},0.5)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 3;
      for (let y = 10; y < h; y += 26) {
        g.beginPath();
        for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 5);
        g.stroke();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 160), new THREE.MeshLambertMaterial({ map: t }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, FLOOR_Y, -30);
    scene.add(floor);
  }

  // ------------------------------------------------------- rocks, coral, weed
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x5b6b78 });
  for (let i = 0; i < 12; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(1.5, 4), 1), rockMat);
    r.position.set(rand(-40, 40), FLOOR_Y + 0.3, rand(-40, 8));
    r.scale.y = rand(0.4, 0.8); r.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    scene.add(r);
  }
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const col = new THREE.Color().setHSL(rand(0.78, 0.95), 0.7, 0.55);
    const m = new THREE.MeshLambertMaterial({ color: col });
    const n = 4 + (Math.random() * 4 | 0);
    for (let k = 0; k < n; k++) {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(rand(0.25, 0.5), rand(1.5, 4), 4, 8), m);
      const a = rand(-0.6, 0.6);
      b.position.set(Math.sin(a) * 1.2, 1.2, rand(-0.6, 0.6));
      b.rotation.z = a;
      g.add(b);
    }
    g.position.set(rand(-38, 38), FLOOR_Y, rand(-38, 8));
    scene.add(g);
  }
  const weeds = [];
  {
    const wm = new THREE.MeshLambertMaterial({ color: 0x3fb54a, side: THREE.DoubleSide });
    for (let i = 0; i < 40; i++) {
      const h = rand(4, 11);
      const geo = new THREE.PlaneGeometry(rand(0.5, 0.9), h, 1, 10);
      geo.translate(0, h / 2, 0);
      const w = new THREE.Mesh(geo, wm);
      w.position.set(rand(-40, 40), FLOOR_Y, rand(-40, 8));
      w.rotation.y = rand(0, Math.PI);
      w.userData = { h, p: rand(0, 6.28), base: geo.attributes.position.array.slice() };
      scene.add(w); weeds.push(w);
    }
  }

  // ------------------------------------------------------------- light rays
  const rays = [];
  {
    const t = canvasTexture(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 9; i++) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(rand(3, 7), 60), m);
      r.position.set(rand(-45, 45), 28, rand(-45, -10));
      r.rotation.z = rand(-0.25, 0.25);
      r.userData = { p: rand(0, 6.28), s: rand(0.1, 0.3) };
      scene.add(r); rays.push(r);
    }
  }

  // ---------------------------------------------------------------- bubbles
  const bubbles = [];
  const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  const bubbleGeo = new THREE.SphereGeometry(1, 8, 6);
  function spawnBubble(x, y, z, r, vy) {
    const b = new THREE.Mesh(bubbleGeo, bubbleMat);
    b.position.set(x, y, z); b.scale.setScalar(r);
    b.userData = { vy, w: rand(0, 6.28) };
    scene.add(b); bubbles.push(b);
  }
  for (let i = 0; i < 40; i++) spawnBubble(rand(-40, 40), rand(0, 25), rand(-40, 8), rand(0.08, 0.25), rand(1, 2.5));

  // -------------------------------------------------------- submarine pipe
  {
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a949c, metalness: 0.75, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3138, metalness: 0.4, roughness: 0.7 });
    const R = 2.6;
    const g = new THREE.Group();
    const vert = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 30, 24), metal);
    vert.position.set(R, 15 + R, 0);
    g.add(vert);
    const elbow = new THREE.Mesh(new THREE.TorusGeometry(R, R, 16, 24, Math.PI / 2), metal);
    elbow.rotation.z = Math.PI; elbow.position.set(0, R, 0);
    g.add(elbow);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 4, 24), metal);
    spout.rotation.z = Math.PI / 2; spout.position.set(-2, 0, 0);
    g.add(spout);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.45, 12, 28), metal);
    rim.rotation.y = Math.PI / 2; rim.position.set(-4, 0, 0);
    g.add(rim);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(R - 0.1, 24), dark);
    hole.rotation.y = -Math.PI / 2; hole.position.set(-3.95, 0, 0);
    g.add(hole);
    for (const y of [6, 14, 22]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(R + 0.1, 0.3, 10, 28), dark);
      band.rotation.x = Math.PI / 2; band.position.set(R, R + y, 0);
      g.add(band);
    }
    g.position.set(PIPE.x + 4, PIPE.y, PIPE.z);
    scene.add(g);
  }

  // -------------------------------------------------------------- creatures
  const creatures = [];
  const seen = new Set();
  const MAX_CREATURES = 30;
  const texLoader = new THREE.TextureLoader();
  const loadTex = src => new Promise(res => texLoader.load(src, t => { t.encoding = THREE.sRGBEncoding; res(t); }, undefined, () => res(null)));

  // size = body length in tank units, thick = half-thickness as a fraction of that length
  const SPEC = {
    swim:      { speed: 7,   size: 9 },
    swim_slow: { speed: 3.5, size: 11 },
    glide:     { speed: 4.5, size: 15 },
    upright:   { speed: 1.5, size: 9 },
    pulse:     { speed: 1.2, size: 10 },
    crawl:     { speed: 2.5, size: 8 },
  };
  const SWIMMERS = new Set(['swim', 'swim_slow', 'glide']);

  function pickTarget(c, opts = {}) {
    const m = c.motion, p = c.mesh.position;
    let x, y = rand(TANK.yMin, TANK.yMax), z = rand(TANK.zMin, TANK.zMax);
    const outChance = SWIMMERS.has(m) ? 0.22 : (m === 'crawl' ? 0.15 : 0.06);
    if (opts.leave || (!opts.stayIn && c.state === 'in' && Math.random() < outChance)) {
      // head out of the frame on the nearest side (or a random side when leaving for good)
      const side = opts.leave ? (p.x >= 0 ? 1 : -1) : (Math.random() < 0.7 ? Math.sign(p.x || 1) : -Math.sign(p.x || 1));
      x = side * OFFSCREEN_X;
      y = clamp(p.y + rand(-3, 3), TANK.yMin, TANK.yMax);
      z = clamp(p.z + rand(-6, 6), TANK.zMin, TANK.zMax);
      c.excursion = !opts.leave;
    } else {
      // cross the screen: prefer the far half of the tank
      x = Math.random() < 0.7 ? (p.x > 0 ? rand(-TANK.x, -4) : rand(4, TANK.x)) : rand(-TANK.x, TANK.x);
      c.excursion = false;
    }
    if (m === 'crawl') { y = FLOOR_Y + c.h / 2; z = rand(-10, 8); }
    if (m === 'upright') y = rand(TANK.yMin + 2, TANK.yMax - 2);
    if (SWIMMERS.has(m)) {
      // never head straight at the camera
      const dx = x - p.x, dz = z - p.z;
      if (Math.abs(dz) > 0.6 * Math.abs(dx)) z = p.z + Math.sign(dz) * 0.6 * Math.abs(dx);
      z = clamp(z, TANK.zMin, TANK.zMax);
    }
    c.target.set(x, y, z);
    c.nextTarget = performance.now() / 1000 + rand(5, 11);
  }

  async function addCreature(entry, fromPipe) {
    seen.add(entry.id);
    const tex = await loadTex(entry.sprite);
    if (!tex) return;
    const nameTex = entry.name ? await loadTex(entry.name) : null;
    const spec = SPEC[entry.motion] || SPEC.swim;
    const model = SketchModels.build(entry.species, tex);
    const mesh = model.group;                      // the whole rig moves as one object
    const size = spec.size;
    mesh.scale.setScalar(size);
    const w = model.width * size, h = model.height * size;
    const now = performance.now() / 1000;
    const c = {
      entry, mesh, model, size, tex, motion: entry.motion, spec, w, h,
      vel: new THREE.Vector3(), target: new THREE.Vector3(), nextTarget: 0,
      phase: rand(0, 6.28), born: now,
      expires: now + (entry.expires_in != null ? entry.expires_in : 120),
      spawn: fromPipe ? 0 : 1,               // 0..1 progress of the pipe exit
      state: 'in',                           // in | out (hidden off-screen) | leaving | gone
      excursion: false, hiddenUntil: 0,
    };
    if (fromPipe) {
      mesh.position.set(PIPE.x + 2, PIPE.y, PIPE.z);
      mesh.scale.setScalar(size * 0.25);
      c.vel.set(-spec.speed * 1.4, 0, 0);
      c.target.set(rand(-10, 8), rand(8, 16), rand(-14, 2));
      c.nextTarget = now + 5;
      pipeBurst(28);
    } else {
      mesh.position.set(rand(-TANK.x, TANK.x), rand(TANK.yMin, TANK.yMax), rand(TANK.zMin, TANK.zMax));
      pickTarget(c, { stayIn: true });
    }
    if (c.motion === 'crawl') mesh.position.y = FLOOR_Y + 0.02 * size;
    scene.add(mesh);

    if (nameTex) {
      const sm = new THREE.SpriteMaterial({ map: nameTex, transparent: true, depthWrite: false });
      const s = new THREE.Sprite(sm);
      const nw = Math.min(w * 1.1, 8), nh = nw * nameTex.image.height / nameTex.image.width;
      s.scale.set(nw, nh, 1);
      c.nameSprite = s; c.nameH = nh;
      scene.add(s);
    }
    creatures.push(c);
    if (creatures.length > MAX_CREATURES) removeCreature(creatures.shift());
    hint.classList.add('hidden');
  }

  function removeCreature(c) {
    c.state = 'gone';
    scene.remove(c.mesh); if (c.nameSprite) scene.remove(c.nameSprite);
    c.mesh.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map === c.tex) o.material.dispose(); } });
    if (c.tex) c.tex.dispose();
  }

  function pipeBurst(n) {
    for (let i = 0; i < n; i++) spawnBubble(PIPE.x + rand(-1, 1), PIPE.y + rand(-1.5, 1.5), PIPE.z + rand(-1.5, 1.5), rand(0.1, 0.4), rand(2, 5));
  }

  const _qY = new THREE.Quaternion(), _qZ = new THREE.Quaternion(), _qT = new THREE.Quaternion();
  const Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);

  function stepCreature(c, dt, t) {
    const m = c.motion, p = c.mesh.position, v = c.vel;

    // ---- lifetime: after the timeout, swim out of frame and retire
    if (c.state !== 'leaving' && c.state !== 'gone' && t > c.expires) {
      if (c.state === 'out') return removeCreature(c);        // already hidden: just go
      c.state = 'leaving';
      pickTarget(c, { leave: true });
    }
    if (c.state === 'leaving' && (Math.abs(p.x) >= OFFSCREEN_X - 1 || t > c.expires + 25)) return removeCreature(c);

    // ---- hidden off-screen: wait, then come back in from a side
    if (c.state === 'out') {
      if (t < c.hiddenUntil) return;
      const side = Math.random() < 0.5 ? Math.sign(p.x || 1) : -Math.sign(p.x || 1);
      p.x = side * OFFSCREEN_X;
      p.y = m === 'crawl' ? FLOOR_Y + 0.02 * c.size : rand(TANK.yMin, TANK.yMax);
      p.z = m === 'crawl' ? rand(-10, 8) : rand(TANK.zMin, TANK.zMax);
      c.mesh.visible = true; if (c.nameSprite) c.nameSprite.visible = true;
      c.state = 'in';
      pickTarget(c, { stayIn: true });
      // face the way we are about to go so re-entry looks natural
      v.set(-side * c.spec.speed, 0, 0);
    }

    if (c.spawn < 1) {
      c.spawn = Math.min(1, c.spawn + dt / 2.2);
      c.mesh.scale.setScalar(c.size * (0.25 + 0.75 * c.spawn));
      if (Math.random() < 0.3) spawnBubble(p.x, p.y + rand(-1, 1), p.z, rand(0.08, 0.2), rand(2, 4));
    }

    const reached = p.distanceTo(c.target) < 2.5;
    if (reached && c.excursion && c.state === 'in') {
      // slipped out of the frame: hide for a while
      c.state = 'out'; c.excursion = false;
      c.hiddenUntil = t + rand(3, 9);
      c.mesh.visible = false; if (c.nameSprite) c.nameSprite.visible = false;
      return;
    }
    if (c.state === 'in' && (t > c.nextTarget || reached)) pickTarget(c);

    // ---- steer toward the target
    const desired = c.target.clone().sub(p).normalize().multiplyScalar(c.spec.speed * (c.state === 'leaving' ? 1.3 : 1));
    v.lerp(desired, clamp(dt * (m === 'swim' ? 1.4 : 0.8), 0, 1));
    let dy = 0;
    if (m === 'pulse') dy = Math.sin(t * 1.6 + c.phase) * 1.2;
    if (m === 'upright') dy = Math.sin(t * 1.3 + c.phase) * 0.6;
    p.addScaledVector(v, dt); p.y += dy * dt;
    p.x = clamp(p.x, -OFFSCREEN_X - 2, Math.max(OFFSCREEN_X + 2, PIPE.x + 3));
    p.z = clamp(p.z, TANK.zMin - 4, TANK.zMax + 2);
    if (m === 'crawl') p.y = FLOOR_Y + 0.02 * c.size;
    else p.y = clamp(p.y, TANK.yMin - 1, TANK.yMax + 2);

    // ---- orientation
    if (SWIMMERS.has(m)) {
      const speed = v.length();
      if (speed > 0.05) {
        const yaw = Math.atan2(-v.z, v.x);
        const pitch = clamp(Math.asin(v.y / speed), -0.5, 0.5) * (m === 'glide' ? 0.6 : 1);
        _qY.setFromAxisAngle(Y_AXIS, yaw); _qZ.setFromAxisAngle(Z_AXIS, pitch);
        _qT.copy(_qY).multiply(_qZ);
        c.mesh.quaternion.slerp(_qT, clamp(dt * 2.2, 0, 1));
      }
    } else if (m === 'upright') {
      // seahorse: turn to face the way it drifts (snout is +x), with a gentle lean
      const yaw = c.model.faces === 'x' ? (v.x < -0.05 ? Math.PI : v.x > 0.05 ? 0 : (c.lastYaw || 0)) : clamp(-v.x * 0.15, -0.6, 0.6);
      c.lastYaw = yaw;
      _qY.setFromAxisAngle(Y_AXIS, yaw + Math.sin(t * 0.7 + c.phase) * 0.25);
      _qZ.setFromAxisAngle(Z_AXIS, Math.sin(t * 1.3 + c.phase) * 0.08);
      c.mesh.quaternion.slerp(_qT.copy(_qY).multiply(_qZ), clamp(dt * 1.5, 0, 1));
    } else if (m === 'pulse') {
      _qY.setFromAxisAngle(Y_AXIS, Math.sin(t * 0.4 + c.phase) * 0.5);
      _qZ.setFromAxisAngle(Z_AXIS, Math.sin(t * 0.9 + c.phase) * 0.12);
      c.mesh.quaternion.slerp(_qT.copy(_qY).multiply(_qZ), clamp(dt * 2, 0, 1));
    } else { // crawl
      _qY.setFromAxisAngle(Y_AXIS, Math.sin(t * 8) * 0.04);
      c.mesh.quaternion.copy(_qY);
    }

    c.model.anim(t, { speedFactor: 0.6 + Math.min(1.5, v.length() / c.spec.speed), phase: c.phase });

    if (c.nameSprite) {
      const top = (c.motion === 'crawl' ? c.h : c.h / 2) * (c.mesh.scale.y / c.size);
      c.nameSprite.position.set(p.x, p.y + top + c.nameH / 2 + 0.4 + Math.sin(t * 1.5 + c.phase) * 0.2, p.z);
      c.nameSprite.material.opacity = c.spawn;
    }
  }

  // ------------------------------------------------------------------ polling
  // ?pipe=1 makes even the creatures present at page load enter through the pipe (handy for testing)
  let firstPoll = !/[?&]pipe=1/.test(location.search);
  async function poll() {
    try {
      const r = await fetch('/api/sprites', { cache: 'no-store' });
      const list = await r.json();
      const ids = new Set(list.map(e => e.id));
      for (let i = creatures.length - 1; i >= 0; i--) {
        const c = creatures[i];
        if (c.state === 'gone' || (!ids.has(c.entry.id) && c.state !== 'leaving')) { removeCreature(c); creatures.splice(i, 1); }
      }
      for (const id of [...seen]) if (!ids.has(id) && !creatures.some(c => c.entry.id === id)) seen.delete(id);
      const only = (new URLSearchParams(location.search).get('only') || '').split(',').filter(Boolean);
      // keep each creature's clock in sync with the server (the admin page can extend it)
      for (const e of list) { const c = creatures.find(x => x.entry.id === e.id); if (c && c.state !== 'leaving' && e.expires_in != null) c.expires = performance.now() / 1000 + e.expires_in; }
      for (const e of list) if (!seen.has(e.id) && (!only.length || only.includes(e.species))) await addCreature(e, !firstPoll);
      if (creatures.length === 0 && list.length === 0) hint.classList.remove('hidden');
      firstPoll = false;
    } catch (e) { /* server not up yet */ }
    setTimeout(poll, 1500);
  }
  poll();

  // --------------------------------------------------------------------- loop
  let last = performance.now(), pipeIdle = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    if (SHOWCASE) {
      // review mode: creatures parked in a row, slowly turning, close to the camera
      creatures.forEach((c, i) => {
        const n = creatures.length, x = (i - (n - 1) / 2) * (n > 3 ? 9 : 14);
        c.mesh.position.set(x, c.motion === 'crawl' ? FLOOR_Y + 0.02 * c.size : 7 + (i % 2) * 4, n > 3 ? 4 : 14);
        c.mesh.rotation.set(0, Math.sin(t * 0.4 + i) * 0.7, 0);
        c.model.anim(t, { speedFactor: 1, phase: c.phase });
        if (c.nameSprite) c.nameSprite.position.set(x, c.mesh.position.y + c.h / 2 + c.nameH / 2 + 0.4, 4);
      });
    } else
    for (const c of creatures) if (c.state !== 'gone') stepCreature(c, dt, t);
    for (let i = creatures.length - 1; i >= 0; i--) if (creatures[i].state === 'gone') creatures.splice(i, 1);
    if (creatures.length === 0) hint.classList.remove('hidden');

    for (const w of weeds) {
      const pos = w.geometry.attributes.position, a = pos.array, b = w.userData.base;
      for (let i = 0; i < a.length; i += 3) {
        const k = b[i + 1] / w.userData.h;
        a[i] = b[i] + Math.sin(t * 1.3 + w.userData.p + k * 2.5) * 1.2 * k * k;
      }
      pos.needsUpdate = true;
    }
    for (const r of rays) r.rotation.z = Math.sin(t * r.userData.s + r.userData.p) * 0.12;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.position.y += b.userData.vy * dt;
      b.position.x += Math.sin(t * 2 + b.userData.w) * 0.3 * dt;
      if (b.position.y > 30) {
        if (bubbles.length > 40) { scene.remove(b); bubbles.splice(i, 1); }
        else { b.position.y = 0; b.position.x = rand(-40, 40); b.position.z = rand(-40, 8); }
      }
    }
    pipeIdle -= dt;
    if (pipeIdle < 0) { spawnBubble(PIPE.x, PIPE.y + rand(-1, 1), PIPE.z + rand(-1, 1), rand(0.1, 0.3), rand(2, 4)); pipeIdle = rand(0.4, 2.5); }

    if (SHOWCASE) { camera.position.set(0, 9, 34); camera.lookAt(0, 7, 0); }
    else { camera.position.x = Math.sin(t * 0.08) * 3; camera.lookAt(0, 10, -6); }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
