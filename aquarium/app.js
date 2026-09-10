// Sketch Aquarium 3D renderer (three.js).
// Every scanned drawing becomes the skin of a rigged 3D creature (see models.js) that
// swims through a 3D tank. Creatures cross the screen, sometimes leave the frame and come back, and
// retire two minutes after they arrived. New arrivals enter through a submarine pipe.
(() => {
  const hint = document.getElementById('hint');
  const BASE = location.pathname.replace(/\/(index\.html|scan|admin)?$/, '');   // '' at the root, '/aqua' when mounted under a prefix
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

  // ------------------------------------------------- reef scenery + hideouts
  const scenery = SketchScenery.build(scene, FLOOR_Y);
  const HIDEOUTS = scenery.hideouts;

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
  // An old painted-steel pipe drops in from above, elbows toward the tank and ends in a
  // bell-mouth nozzle. pipeFX() makes it shudder, glow and blast rings when a creature arrives.
  const pipe = new THREE.Group();
  const pipeFX = { t0: -99, rings: [], streaks: [] };
  let valveWheel, glowRing, throat, nozzle, gaugeNeedle;
  {
    const R = 2.4;
    // painted steel with brush streaks, rivet shadows and rust bleeding from the seams
    const steelTex = canvasTexture(512, 512, (g, w, h) => {
      g.fillStyle = '#7c8a94'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2500; i++) {              // brushed streaks
        g.fillStyle = `rgba(${rand(90, 170) | 0},${rand(100, 180) | 0},${rand(110, 190) | 0},0.18)`;
        g.fillRect(Math.random() * w, Math.random() * h, 1, rand(6, 40));
      }
      for (let i = 0; i < 70; i++) {                // rust blotches
        const x = Math.random() * w, y = Math.random() * h, r = rand(6, 28);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(150,80,40,0.55)'); gr.addColorStop(1, 'rgba(150,80,40,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
      for (let i = 0; i < 25; i++) {                // rust drips
        const x = Math.random() * w, y = Math.random() * h * 0.7;
        const gr = g.createLinearGradient(0, y, 0, y + 80);
        gr.addColorStop(0, 'rgba(140,70,30,0.5)'); gr.addColorStop(1, 'rgba(140,70,30,0)');
        g.fillStyle = gr; g.fillRect(x, y, rand(2, 5), 80);
      }
    });
    steelTex.wrapS = steelTex.wrapT = THREE.RepeatWrapping; steelTex.repeat.set(2, 2);
    const steel = new THREE.MeshStandardMaterial({ map: steelTex, metalness: 0.55, roughness: 0.5 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a4148, metalness: 0.7, roughness: 0.45 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b1116, roughness: 0.9 });

    // bolted flange ring
    function flange(radius, y, group, rotX = Math.PI / 2, pos = [0, 0, 0]) {
      const f = new THREE.Group();
      f.add(new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.55, radius + 0.55, 0.5, 32), iron));
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.7, 6), iron);
        bolt.position.set(Math.cos(a) * (radius + 0.32), 0, Math.sin(a) * (radius + 0.32));
        f.add(bolt);
      }
      f.position.set(pos[0], y, pos[2]); f.rotation.x = rotX - Math.PI / 2; f.rotation.z = 0;
      group.add(f);
      return f;
    }

    // vertical run: comes down from above the view to the elbow
    const vert = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 34, 32), steel);
    vert.position.set(R, 17 + R, 0); pipe.add(vert);
    flange(R, R + 4, pipe, Math.PI / 2, [R, 0, 0]);
    flange(R, R + 15, pipe, Math.PI / 2, [R, 0, 0]);
    flange(R, R + 26, pipe, Math.PI / 2, [R, 0, 0]);
    // wall bracket / chain hanger near the top
    const strap = new THREE.Mesh(new THREE.TorusGeometry(R + 0.3, 0.25, 8, 32), iron);
    strap.rotation.x = Math.PI / 2; strap.position.set(R, R + 30, 0); pipe.add(strap);

    // elbow: quarter torus, centre at the corner so both ends meet the straight runs exactly
    const elbow = new THREE.Mesh(new THREE.TorusGeometry(R, R, 20, 28, Math.PI / 2), steel);
    elbow.rotation.z = -Math.PI / 2; elbow.position.set(0, R, 0); pipe.add(elbow);   // arc from the vertical run's foot (R,R) to the spout end (0,0)

    // short horizontal spout, flange, then the bell-mouth nozzle opening toward -x
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 3.2, 32), steel);
    spout.rotation.z = Math.PI / 2; spout.position.set(-1.6, 0, 0); pipe.add(spout);
    const sf = flange(R, 0, pipe, 0, [-3.0, 0, 0]); sf.rotation.set(0, 0, Math.PI / 2);
    nozzle = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.55, R, 2.6, 32, 1, true), steel);
    nozzle.material = steel.clone(); nozzle.material.side = THREE.DoubleSide;
    nozzle.rotation.z = Math.PI / 2; nozzle.position.set(-4.6, 0, 0); pipe.add(nozzle);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 1.55, 0.3, 10, 40), iron);
    lip.rotation.y = Math.PI / 2; lip.position.set(-5.9, 0, 0); pipe.add(lip);
    // dark throat and a glow ring that lights up on arrivals
    throat = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 32), dark);
    throat.rotation.y = -Math.PI / 2; throat.position.set(-3.6, 0, 0); pipe.add(throat);
    glowRing = new THREE.Mesh(new THREE.RingGeometry(R * 0.55, R * 1.5, 40),
      new THREE.MeshBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    glowRing.rotation.y = -Math.PI / 2; glowRing.position.set(-5.6, 0, 0); pipe.add(glowRing);

    // valve wheel on the vertical run
    const valve = new THREE.Group();
    valve.position.set(R - R - 0.2, R + 9, 0);            // sticks out toward -x (into the tank)
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.2, 10), iron);
    stem.rotation.z = Math.PI / 2; stem.position.x = -0.9; valve.add(stem);
    valveWheel = new THREE.Group(); valveWheel.position.x = -2.1;
    valveWheel.add(new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.22, 10, 32), brass));
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.0, 6), brass);
      spoke.rotation.z = i * Math.PI / 4; valveWheel.add(spoke);
    }
    valveWheel.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), brass));
    valveWheel.rotation.y = Math.PI / 2;                   // wheel faces -x
    valve.add(valveWheel); pipe.add(valve);

    // pressure gauge
    const gauge = new THREE.Group(); gauge.position.set(-0.1, R + 3.2, 1.6); gauge.rotation.y = -0.6;
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.5, 24), brass);
    dial.rotation.z = Math.PI / 2; gauge.add(dial);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.72, 24), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 }));
    face.rotation.y = -Math.PI / 2; face.position.x = -0.26; gauge.add(face);
    gaugeNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), new THREE.MeshStandardMaterial({ color: 0xc0392b }));
    gaugeNeedle.position.set(-0.3, 0.2, 0); gaugeNeedle.rotation.x = 0.6; gauge.add(gaugeNeedle);
    pipe.add(gauge);

    pipe.position.set(PIPE.x + 4, PIPE.y, PIPE.z);
    pipe.userData.base = pipe.position.clone();
    scene.add(pipe);
  }

  // arrival blast: called when a creature is pushed out of the pipe
  const ringGeo = new THREE.TorusGeometry(1, 0.05, 8, 48);
  function pipeArrival() {
    pipeFX.t0 = performance.now() / 1000;
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xcdf7ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.y = Math.PI / 2; m.position.set(PIPE.x - 1.5, PIPE.y, PIPE.z);
      m.userData = { born: pipeFX.t0 + i * 0.22 };
      scene.add(m); pipeFX.rings.push(m);
    }
    for (let i = 0; i < 26; i++) {
      const st = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
      st.scale.set(rand(3, 7), 1, 1);
      st.position.set(PIPE.x - 1, PIPE.y + rand(-1.6, 1.6), PIPE.z + rand(-1.6, 1.6));
      st.userData = { v: new THREE.Vector3(-rand(18, 34), rand(-4, 4), rand(-4, 4)), born: pipeFX.t0 + rand(0, 0.35) };
      scene.add(st); pipeFX.streaks.push(st);
    }
    pipeBurst(40);
  }

  function updatePipeFX(t, dt) {
    const e = t - pipeFX.t0;
    // shudder: fast decaying shake for ~1.5 s, then settle
    const shake = e < 1.6 ? Math.exp(-e * 2.2) * 0.35 : 0;
    pipe.position.copy(pipe.userData.base).add(new THREE.Vector3(Math.sin(t * 60) * shake, Math.cos(t * 47) * shake * 0.5, Math.sin(t * 53) * shake * 0.5));
    // valve spins hard on arrival, idles slowly otherwise
    valveWheel.rotation.x += (e < 2.2 ? 9 * Math.exp(-e * 1.2) : 0.25) * dt;
    // gauge needle kicks into the red then eases back
    gaugeNeedle.rotation.x = 0.6 + (e < 3 ? 1.6 * Math.exp(-e * 1.5) * (0.6 + 0.4 * Math.sin(t * 30)) : 0);
    // throat glow
    glowRing.material.opacity = e < 2.0 ? Math.max(0, 0.9 * Math.exp(-e * 1.6) * (0.7 + 0.3 * Math.sin(t * 25))) : 0;
    nozzle.scale.setScalar(1 + (e < 1.2 ? 0.08 * Math.sin(e * 14) * Math.exp(-e * 2.5) : 0));
    // expanding rings
    for (let i = pipeFX.rings.length - 1; i >= 0; i--) {
      const m = pipeFX.rings[i], a = t - m.userData.born;
      if (a < 0) continue;
      const s = 1 + a * 9;
      m.scale.set(1, s, s); m.position.x = PIPE.x - 1.5 - a * 10;
      m.material.opacity = Math.max(0, 0.8 * (1 - a / 1.3));
      if (a > 1.3) { scene.remove(m); m.material.dispose(); pipeFX.rings.splice(i, 1); }
    }
    // streaks shoot out and fade
    for (let i = pipeFX.streaks.length - 1; i >= 0; i--) {
      const m = pipeFX.streaks[i], a = t - m.userData.born;
      if (a < 0) continue;
      m.position.addScaledVector(m.userData.v, dt);
      m.userData.v.multiplyScalar(1 - 2.5 * dt);
      m.material.opacity = Math.max(0, 0.9 * (1 - a / 0.9));
      if (a > 0.9) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); pipeFX.streaks.splice(i, 1); }
    }
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
    // now and then, go and hide in one of the rock caves (swimmers and the crab)
    const hideChance = SWIMMERS.has(m) ? 0.14 : (m === 'crawl' ? 0.2 : 0);
    if (!opts.leave && !opts.stayIn && c.state === 'in' && !c.hide && Math.random() < hideChance) {
      const h = HIDEOUTS[Math.floor(Math.random() * HIDEOUTS.length)];
      const floor = m === 'crawl';
      c.hide = { stage: 'mouth', mouth: floor ? h.floorMouth : h.mouth, inside: floor ? h.floorInside : h.inside };
      c.excursion = false;
      c.target.copy(c.hide.mouth);
      c.nextTarget = performance.now() / 1000 + 14;
      return;
    }
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
    const tex = await loadTex(BASE + entry.sprite);
    if (!tex) return;
    const nameTex = entry.name ? await loadTex(BASE + entry.name) : null;
    const spec = SPEC[entry.motion] || SPEC.swim;
    const model = await SketchModels.buildAsync(entry.species, tex, BASE, entry.motion);
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
      pipeArrival();
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
      c.hide = null; if (c.nameSprite) c.nameSprite.visible = true;
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
    if (c.hide && c.state === 'in') {
      if (c.hide.stage === 'mouth' && (reached || t > c.nextTarget)) {
        c.hide.stage = 'inside'; c.target.copy(c.hide.inside); c.nextTarget = t + 8;
      } else if (c.hide.stage === 'inside' && (reached || t > c.nextTarget)) {
        c.hide.stage = 'resting'; c.hide.until = t + rand(4, 10);
        if (c.nameSprite) c.nameSprite.visible = false;
      } else if (c.hide.stage === 'resting') {
        if (t < c.hide.until) { c.vel.multiplyScalar(1 - 3 * dt); c.model.anim(t, { speedFactor: 0.4, phase: c.phase }); return; }
        c.hide.stage = 'leaving'; c.target.copy(c.hide.mouth); c.nextTarget = t + 8;
        if (c.nameSprite) c.nameSprite.visible = true;
      } else if (c.hide.stage === 'leaving' && (reached || t > c.nextTarget)) {
        c.hide = null; pickTarget(c, { stayIn: true });
      }
    }
    if (reached && c.excursion && c.state === 'in') {
      // slipped out of the frame: hide for a while
      c.state = 'out'; c.excursion = false;
      c.hiddenUntil = t + rand(3, 9);
      c.mesh.visible = false; if (c.nameSprite) c.nameSprite.visible = false;
      return;
    }
    if (c.state === 'in' && !c.hide && (t > c.nextTarget || reached)) pickTarget(c);

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

  // optional real 3D models (see models/manifest.json); loaded before the first creature
  const manifestReady = fetch(BASE + '/models/manifest.json', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : {}).catch(() => ({}))
    .then(mf => SketchModels.setManifest(mf));

  // ------------------------------------------------------------------ polling
  // ?pipe=1 makes even the creatures present at page load enter through the pipe (handy for testing)
  let firstPoll = !/[?&]pipe=1/.test(location.search);
  async function poll() {
    await manifestReady;
    try {
      const r = await fetch(BASE + '/api/sprites', { cache: 'no-store' });
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
        c.mesh.position.set(x, c.motion === 'crawl' ? FLOOR_Y + 0.02 * c.size : 7 + (i % 2) * 4, n > 3 ? 4 : 8);
        c.mesh.rotation.set(0, Math.sin(t * 0.4 + i) * 0.7, 0);
        c.model.anim(t, { speedFactor: 1, phase: c.phase });
        if (c.nameSprite) c.nameSprite.position.set(x, c.mesh.position.y + c.h / 2 + c.nameH / 2 + 0.4, 4);
      });
    } else
    for (const c of creatures) if (c.state !== 'gone') stepCreature(c, dt, t);
    for (let i = creatures.length - 1; i >= 0; i--) if (creatures[i].state === 'gone') creatures.splice(i, 1);
    if (creatures.length === 0) hint.classList.remove('hidden');

    scenery.update(t, dt);
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
    updatePipeFX(t, dt);
    pipeIdle -= dt;
    if (pipeIdle < 0) { spawnBubble(PIPE.x, PIPE.y + rand(-1, 1), PIPE.z + rand(-1, 1), rand(0.1, 0.3), rand(2, 4)); pipeIdle = rand(0.4, 2.5); }

    if (SHOWCASE) {
      // &tilt=1 looks down from above (planform view, good for the ray / turtle / crab)
      if (/[?&]tilt=1/.test(location.search)) { camera.position.set(0, 30, 26); camera.lookAt(0, 7, 6); }
      else { camera.position.set(0, 9, 34); camera.lookAt(0, 7, 0); }
    }
    else { camera.position.x = Math.sin(t * 0.08) * 3; camera.lookAt(0, 10, -6); }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
