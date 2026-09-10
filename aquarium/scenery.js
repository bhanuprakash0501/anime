// Reef scenery for the Sketch Aquarium: boulders, cave formations (hideouts), sea grass,
// kelp, corals and anemones. Everything is procedural; no asset files.
//
//   const scenery = SketchScenery.build(scene, FLOOR_Y);
//   scenery.update(t, dt);          // sway grass / kelp / anemones
//   scenery.hideouts                // [{mouth: Vector3, inside: Vector3, floorY}] for creatures to hide in
window.SketchScenery = (() => {
  const T = THREE;
  const PI = Math.PI;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // small deterministic 3D noise (sum of sines) for rock displacement
  function noise3(x, y, z) {
    return (Math.sin(x * 1.7 + y * 0.9) + Math.sin(y * 2.3 + z * 1.1) + Math.sin(z * 1.9 + x * 1.3)
      + 0.5 * Math.sin(x * 4.1 + z * 3.7) + 0.5 * Math.sin(y * 5.3 - x * 2.9)) / 3.5;
  }

  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat, repeat); }
    return t;
  }

  // ------------------------------------------------------------------ rocks
  let rockMap, rockBump;
  function rockTextures() {
    if (rockMap) return;
    rockMap = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#6d6a63'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 14000; i++) {
        const v = rand(70, 150) | 0, warm = rand(-10, 18) | 0;
        g.fillStyle = `rgba(${v + warm},${v},${v - warm / 2},0.55)`;
        g.fillRect(Math.random() * w, Math.random() * h, rand(1, 4), rand(1, 4));
      }
      for (let i = 0; i < 40; i++) {                         // lichen / algae patches
        const x = Math.random() * w, y = Math.random() * h, r = rand(8, 40);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(${rand(60, 110) | 0},${rand(110, 150) | 0},${rand(50, 90) | 0},0.45)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(30,28,25,0.35)'; g.lineWidth = 2;        // cracks
      for (let i = 0; i < 25; i++) {
        g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += rand(-30, 30); y += rand(-30, 30); g.lineTo(x, y); }
        g.stroke();
      }
    }, 2);
    rockBump = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 6000; i++) { const v = rand(80, 176) | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, rand(1, 5), rand(1, 5)); }
    }, 3);
  }

  function rock(radius, seed, squash = 0.65) {
    rockTextures();
    const geo = new T.IcosahedronGeometry(radius, 3);
    const pos = geo.attributes.position;
    const v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = noise3(v.x * 0.5 / radius * 3 + seed, v.y * 0.5 / radius * 3 + seed * 2, v.z * 0.5 / radius * 3 + seed * 3);
      v.multiplyScalar(1 + n * 0.28);
      pos.setXYZ(i, v.x, v.y * squash, v.z);
    }
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ map: rockMap, bumpMap: rockBump, bumpScale: 0.35, roughness: 0.95, metalness: 0 }));
    m.rotation.set(rand(0, PI), rand(0, PI), rand(0, PI));
    return m;
  }

  // ---------------------------------------------------------------- grass
  let bladeTex, kelpTex;
  function grassTextures() {
    if (bladeTex) return;
    bladeTex = canvasTex(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, h, 0, 0);
      gr.addColorStop(0, '#1e5a22'); gr.addColorStop(0.5, '#3f9a3a'); gr.addColorStop(1, '#a6e07a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(20,60,20,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
    });
    kelpTex = canvasTex(128, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, h, 0, 0);
      gr.addColorStop(0, '#4a5a12'); gr.addColorStop(0.6, '#7e9a1e'); gr.addColorStop(1, '#c3d95a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(40,50,10,0.35)'; g.lineWidth = 3;
      for (let x = 20; x < w; x += 22) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + rand(-10, 10), 0); g.stroke(); }
    });
  }

  // a single blade: tapered, curved plane that keeps its base vertices so update() can sway it
  function blade(width, height, bend, tex, opacity) {
    const geo = new T.PlaneGeometry(width, height, 1, 10);
    geo.translate(0, height / 2, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), k = Math.max(0, y / height);     // clamp: a hair below 0 would make pow() NaN
      pos.setX(i, pos.getX(i) * (1 - Math.pow(k, 1.6)) + bend * k * k);     // taper + lean
    }
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ map: tex, side: T.DoubleSide, transparent: true, opacity, roughness: 0.8 }));
    m.userData = { base: pos.array.slice(), h: height, phase: rand(0, 6.28), amp: rand(0.6, 1.4) };
    return m;
  }

  function grassTuft(x, z, floorY, count) {
    grassTextures();
    const g = new T.Group();
    const blades = [];
    for (let i = 0; i < count; i++) {
      const b = blade(rand(0.25, 0.5), rand(2.5, 7), rand(-1.2, 1.2), bladeTex, rand(0.8, 0.95));
      b.position.set(rand(-0.8, 0.8), 0, rand(-0.8, 0.8));
      b.rotation.y = rand(0, PI);
      g.add(b); blades.push(b);
    }
    g.position.set(x, floorY, z);
    return { group: g, blades };
  }

  function kelp(x, z, floorY) {
    grassTextures();
    const g = new T.Group();
    const blades = [];
    const n = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const b = blade(rand(1.0, 1.6), rand(9, 16), rand(-2, 2), kelpTex, 0.9);
      b.position.set(rand(-1, 1), 0, rand(-1, 1)); b.rotation.y = rand(0, PI);
      b.userData.amp = rand(1.5, 2.6); b.userData.kelp = true;
      g.add(b); blades.push(b);
    }
    g.position.set(x, floorY, z);
    return { group: g, blades };
  }

  // ---------------------------------------------------------------- corals
  const CORAL_COLORS = [0xff7a59, 0xf4a261, 0xe76f8f, 0xc77dff, 0xffd166, 0xff5d8f, 0x9b5de5];

  function branchingCoral(color) {
    const mat = new T.MeshStandardMaterial({ color, roughness: 0.85 });
    const g = new T.Group();
    function branch(parent, len, r, depth) {
      const geo = new T.CylinderGeometry(r * 0.6, r, len, 7);
      geo.translate(0, len / 2, 0);
      const m = new T.Mesh(geo, mat); parent.add(m);
      const tip = new T.Mesh(new T.SphereGeometry(r * 0.7, 7, 6), mat); tip.position.y = len; m.add(tip);
      if (depth <= 0) return;
      const kids = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < kids; i++) {
        const child = new T.Group();
        child.position.y = len * rand(0.55, 1.0);
        child.rotation.set(rand(-0.9, 0.9), rand(0, PI * 2), rand(-0.9, 0.9));
        m.add(child);
        branch(child, len * rand(0.55, 0.8), r * 0.7, depth - 1);
      }
    }
    branch(g, rand(1.6, 2.6), rand(0.22, 0.34), 3);
    return g;
  }

  let brainBump;
  function brainCoral(color) {
    if (!brainBump) brainBump = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#303030'; g.lineWidth = 7; g.lineCap = 'round';
      for (let y = 8; y < h; y += 18) {
        g.beginPath();
        for (let x = 0; x <= w; x += 6) g.lineTo(x, y + Math.sin(x * 0.12 + y) * 6 + Math.sin(x * 0.03) * 4);
        g.stroke();
      }
    }, 2);
    const r = rand(1.4, 2.8);
    const geo = new T.SphereGeometry(r, 28, 20);
    const pos = geo.attributes.position, v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      v.multiplyScalar(1 + noise3(v.x * 1.5, v.y * 1.5, v.z * 1.5) * 0.12);
      pos.setXYZ(i, v.x, Math.max(v.y * 0.8, -r * 0.2), v.z);
    }
    geo.computeVertexNormals();
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color, bumpMap: brainBump, bumpScale: 0.25, roughness: 0.9 }));
    m.position.y = r * 0.2;
    return m;
  }

  let fanTexCache = {};
  function seaFan(color) {
    const key = color.toString(16);
    if (!fanTexCache[key]) fanTexCache[key] = canvasTex(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#' + key.padStart(6, '0'); g.lineWidth = 3; g.lineCap = 'round';
      function twig(x, y, a, len, d) {
        const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
        g.lineWidth = 1 + d * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        if (d <= 0) return;
        twig(nx, ny, a - rand(0.25, 0.7), len * 0.72, d - 1);
        twig(nx, ny, a + rand(0.25, 0.7), len * 0.72, d - 1);
        if (Math.random() < 0.5) twig(nx, ny, a + rand(-0.2, 0.2), len * 0.7, d - 1);
      }
      twig(w / 2, h, -PI / 2, 60, 6);
    });
    const size = rand(3, 5.5);
    const m = new T.Mesh(new T.PlaneGeometry(size, size), new T.MeshStandardMaterial({ map: fanTexCache[key], transparent: true, alphaTest: 0.3, side: T.DoubleSide, roughness: 0.8 }));
    m.position.y = size / 2; m.rotation.y = rand(0, PI);
    m.userData = { fan: true, phase: rand(0, 6.28) };
    return m;
  }

  function tubeSponge(color) {
    const g = new T.Group();
    const mat = new T.MeshStandardMaterial({ color, roughness: 0.9 });
    const inner = new T.MeshStandardMaterial({ color: 0x1a1020, roughness: 1 });
    const n = 3 + (Math.random() * 4 | 0);
    for (let i = 0; i < n; i++) {
      const h = rand(1.5, 4), r = rand(0.25, 0.5);
      const tube = new T.Mesh(new T.CylinderGeometry(r * 1.15, r * 0.8, h, 12, 1, true), mat);
      tube.material = mat.clone(); tube.material.side = T.DoubleSide;
      tube.position.set(rand(-0.8, 0.8), h / 2, rand(-0.8, 0.8)); tube.rotation.z = rand(-0.25, 0.25);
      const hole = new T.Mesh(new T.CircleGeometry(r * 1.0, 12), inner);
      hole.rotation.x = -PI / 2; hole.position.y = h / 2 - 0.1; tube.add(hole);
      g.add(tube);
    }
    return g;
  }

  function anemone(color) {
    const g = new T.Group();
    const base = new T.Mesh(new T.SphereGeometry(0.7, 12, 8), new T.MeshStandardMaterial({ color: 0x8a4b3c, roughness: 0.9 }));
    base.scale.y = 0.6; g.add(base);
    const mat = new T.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity: 0.9 });
    const tents = [];
    for (let i = 0; i < 26; i++) {
      const len = rand(1.2, 2.2);
      const geo = new T.CylinderGeometry(0.05, 0.09, len, 6); geo.translate(0, len / 2, 0);
      const tt = new T.Mesh(geo, mat);
      const a = rand(0, PI * 2), rr = rand(0, 0.55);
      tt.position.set(Math.cos(a) * rr, 0.3, Math.sin(a) * rr);
      tt.rotation.set(Math.sin(a) * rr * 0.9, 0, -Math.cos(a) * rr * 0.9);
      tt.userData = { phase: rand(0, 6.28), baseX: tt.rotation.x, baseZ: tt.rotation.z };
      g.add(tt); tents.push(tt);
    }
    g.userData.tents = tents;
    return g;
  }

  // ------------------------------------------------------------------ build
  function build(scene, FLOOR_Y) {
    const swaying = [], anemones = [], fans = [];
    const hideouts = [];

    // cave formations: a front boulder with a dark mouth, flanking boulders, and a hide point
    // behind the front boulder (out of the camera's sight). Creatures enter via the mouth.
    const caveSpots = [[-21, -16], [2, -22], [19, -14]];
    for (let i = 0; i < caveSpots.length; i++) {
      const [cx, cz] = caveSpots[i];
      const g = new T.Group();
      const front = rock(7.5, i * 3 + 1, 0.8); front.position.set(0, 3.2, 0); g.add(front);
      const left = rock(5, i * 3 + 2, 0.7); left.position.set(-7, 2.2, -4); g.add(left);
      const right = rock(5.5, i * 3 + 3, 0.7); right.position.set(7.5, 2.4, -3); g.add(right);
      const top = rock(4.5, i * 3 + 4, 0.55); top.position.set(1, 7.5, -3); g.add(top);
      // dark cave mouth on the front face
      const mouth = new T.Mesh(new T.CircleGeometry(2.6, 24), new T.MeshBasicMaterial({ color: 0x06111a }));
      mouth.position.set(0.5, 3.4, 7.4); mouth.scale.set(1.25, 0.85, 1); g.add(mouth);
      // a little rubble and growth around the entrance
      for (let k = 0; k < 4; k++) { const r = rock(rand(0.8, 1.6), i * 7 + k, 0.6); r.position.set(rand(-7, 7), 0.3, rand(4, 8)); g.add(r); }
      g.position.set(cx, FLOOR_Y, cz);
      scene.add(g);
      hideouts.push({
        mouth: new T.Vector3(cx + 0.5, FLOOR_Y + 3.6, cz + 9),
        inside: new T.Vector3(cx + 0.5, FLOOR_Y + 3.2, cz - 8),
        floorMouth: new T.Vector3(cx + 0.5, FLOOR_Y, cz + 9),
        floorInside: new T.Vector3(cx + 0.5, FLOOR_Y, cz - 8),
      });
    }

    // scattered boulders, partially buried
    for (let i = 0; i < 16; i++) {
      const r = rand(1.2, 3.6);
      const m = rock(r, 20 + i, rand(0.5, 0.8));
      m.position.set(rand(-44, 44), FLOOR_Y + r * 0.25, rand(-40, 9));
      scene.add(m);
    }

    // sea grass tufts and kelp
    for (let i = 0; i < 34; i++) {
      const t = grassTuft(rand(-44, 44), rand(-40, 9), FLOOR_Y, 6 + (Math.random() * 8 | 0));
      scene.add(t.group); swaying.push(...t.blades);
    }
    for (let i = 0; i < 6; i++) {
      const k = kelp(rand(-42, 42), rand(-40, -10), FLOOR_Y);
      scene.add(k.group); swaying.push(...k.blades);
    }

    // corals in loose clusters
    for (let i = 0; i < 12; i++) {
      const cx = rand(-42, 42), cz = rand(-38, 8);
      const n = 2 + (Math.random() * 4 | 0);
      for (let k = 0; k < n; k++) {
        const color = pick(CORAL_COLORS);
        const kind = Math.random();
        let m;
        if (kind < 0.3) m = branchingCoral(color);
        else if (kind < 0.55) m = brainCoral(color);
        else if (kind < 0.75) { m = seaFan(color); fans.push(m); }
        else if (kind < 0.9) m = tubeSponge(color);
        else { m = anemone(color); anemones.push(m); }
        m.position.set(cx + rand(-3, 3), FLOOR_Y, cz + rand(-3, 3));
        scene.add(m);
      }
    }

    function update(t, dt) {
      for (const b of swaying) {
        const pos = b.geometry.attributes.position, a = pos.array, base = b.userData.base;
        const ph = b.userData.phase, amp = b.userData.amp, h = b.userData.h;
        for (let i = 0; i < a.length; i += 3) {
          const k = base[i + 1] / h;
          a[i] = base[i] + Math.sin(t * 1.1 + ph + k * 2.2) * amp * k * k;
          a[i + 2] = base[i + 2] + Math.cos(t * 0.7 + ph * 1.3 + k * 1.5) * amp * 0.5 * k * k;
        }
        pos.needsUpdate = true;
      }
      for (const f of fans) f.rotation.z = Math.sin(t * 0.9 + f.userData.phase) * 0.06;
      for (const an of anemones) for (const tt of an.userData.tents) {
        tt.rotation.x = tt.userData.baseX + Math.sin(t * 2.2 + tt.userData.phase) * 0.25;
        tt.rotation.z = tt.userData.baseZ + Math.cos(t * 1.7 + tt.userData.phase) * 0.25;
      }
    }

    return { update, hideouts };
  }

  return { build };
})();
