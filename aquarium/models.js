// Procedural 3D sea creatures for the Sketch Aquarium.
//
// Every species is a small rig: a THREE.Group of parts (body, fins, eyes, mouth, legs...)
// built at unit size (about 1 tank-unit long / tall) and an anim(t, opts) function that
// moves the parts. The child's drawing is projected onto the body parts as a skin
// (side / top / front projection depending on how the species is drawn), and a
// procedural bump map adds scales, scutes or ridges.
//
//   SketchModels.build(species, texture) -> { group, anim, height, width, faces }
window.SketchModels = (() => {
  const T = THREE;
  const PI = Math.PI;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------ materials
  const eyeWhite = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const pupil = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.15, metalness: 0.1 });
  const darkMat = new T.MeshStandardMaterial({ color: 0x2a1e24, roughness: 0.8 });
  const toothMat = new T.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.4 });
  const suckerMat = new T.MeshStandardMaterial({ color: 0xf6d8e0, roughness: 0.7 });

  // ------------------------------------------------------- bump patterns
  const bumpCache = {};
  function bumpTexture(kind) {
    if (bumpCache[kind]) return bumpCache[kind];
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    if (kind === 'scales') {
      // overlapping arcs = fish scales
      for (let row = 0; row < 12; row++) for (let col = -1; col < 13; col++) {
        const x = col * 22 + (row % 2) * 11, y = row * 22;
        const gr = g.createRadialGradient(x, y, 4, x, y, 14);
        gr.addColorStop(0, '#a8a8a8'); gr.addColorStop(0.85, '#7a7a7a'); gr.addColorStop(1, '#3c3c3c');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, 14, 0, PI * 2); g.fill();
      }
    } else if (kind === 'scutes') {
      // hexagon plates = turtle shell
      const r = 34;
      for (let row = -1; row < 6; row++) for (let col = -1; col < 6; col++) {
        const x = col * r * 1.75 + (row % 2) * r * 0.875, y = row * r * 1.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) g.lineTo(x + r * Math.cos(k * PI / 3), y + r * Math.sin(k * PI / 3));
        g.closePath();
        g.fillStyle = '#9a9a9a'; g.fill();
        g.lineWidth = 6; g.strokeStyle = '#404040'; g.stroke();
      }
    } else if (kind === 'ridges') {
      for (let y = 0; y < 256; y += 20) {
        const gr = g.createLinearGradient(0, y, 0, y + 20);
        gr.addColorStop(0, '#a0a0a0'); gr.addColorStop(0.5, '#7c7c7c'); gr.addColorStop(1, '#4a4a4a');
        g.fillStyle = gr; g.fillRect(0, y, 256, 20);
      }
    } else if (kind === 'skin') {
      const d = g.getImageData(0, 0, 256, 256);
      for (let i = 0; i < d.data.length; i += 4) { const v = 118 + Math.random() * 20; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; }
      g.putImageData(d, 0, 0);
    } else if (kind === 'warts') {
      for (let i = 0; i < 140; i++) {
        const x = Math.random() * 256, y = Math.random() * 256, r = 4 + Math.random() * 9;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, '#b0b0b0'); gr.addColorStop(1, '#808080');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.fill();
      }
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    bumpCache[kind] = t;
    return t;
  }

  // ------------------------------------------------------------ helpers
  function skinMaterial(tex, bumpKind, bumpScale, extra = {}) {
    const m = new T.MeshStandardMaterial(Object.assign({ map: tex, roughness: 0.55, metalness: 0.0 }, extra));
    if (bumpKind) { m.bumpMap = bumpTexture(bumpKind); m.bumpScale = bumpScale; m.bumpMap.repeat.set(3, 3); }
    return m;
  }

  // 2D outline (x,y pairs, base near the origin) -> thin extruded slab centred in z
  function fin(pts, depth = 0.012) {
    const s = new T.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    const g = new T.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  // body of revolution around the X axis. profile: [[x, radius], ...] from tail to head
  function latheX(profile, segs = 32) {
    const pts = profile.map(([x, r]) => new T.Vector2(Math.max(r, 0.0005), x));
    const g = new T.LatheGeometry(pts, segs);
    g.rotateZ(-PI / 2);      // lathe axis Y -> X
    return g;
  }

  function mesh(geo, mat, x = 0, y = 0, z = 0) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  }

  function addEye(parent, x, y, z, r, dir) {
    // dir: unit-ish vector the eye looks along (pupil is pushed that way)
    const e = mesh(new T.SphereGeometry(r, 16, 12), eyeWhite, x, y, z);
    const p = mesh(new T.SphereGeometry(r * 0.55, 12, 10), pupil, x + dir[0] * r * 0.6, y + dir[1] * r * 0.6, z + dir[2] * r * 0.6);
    parent.add(e, p);
    return e;
  }

  // give every mesh flagged userData.skin the drawing as a planar projection
  function projectUVs(group, plane) {
    group.updateMatrixWorld(true);
    const box = new T.Box3();
    const v = new T.Vector3();
    group.traverse(o => { if (o.isMesh && o.userData.skin) box.expandByObject(o); });
    const size = new T.Vector3(); box.getSize(size);
    group.traverse(o => {
      if (!(o.isMesh && o.userData.skin)) return;
      const pos = o.geometry.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        let u, w;
        if (plane === 'top') { u = (v.x - box.min.x) / size.x; w = (v.z - box.min.z) / size.z; }
        else { u = (v.x - box.min.x) / size.x; w = (v.y - box.min.y) / size.y; }
        uv[i * 2] = u; uv[i * 2 + 1] = w;
      }
      o.geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    });
  }

  // keep a copy of vertex positions so anim() can bend a body each frame
  function rememberBase(m) { m.userData.base = m.geometry.attributes.position.array.slice(); }

  // sideways S-bend of a body along X: tail (-x) swings most
  function bendBody(m, t, freq, amp, phase, headX = 0.5) {
    const pos = m.geometry.attributes.position, a = pos.array, b = m.userData.base;
    for (let i = 0; i < a.length; i += 3) {
      const k = clamp((headX - b[i]) / (2 * headX), 0, 1);
      a[i + 2] = b[i + 2] + Math.sin(t * freq + phase - k * 4) * amp * k * k;
    }
    pos.needsUpdate = true;
    m.geometry.computeVertexNormals();
  }

  // ================================================================= FISH
  function buildFish(tex, shark) {
    const g = new T.Group();
    const skin = skinMaterial(tex, shark ? 'skin' : 'scales', shark ? 0.004 : 0.012);
    const finMat = skinMaterial(tex, null, 0, { side: T.DoubleSide });

    const profile = shark
      ? [[-0.5, 0.025], [-0.38, 0.06], [-0.22, 0.095], [-0.05, 0.12], [0.15, 0.118], [0.3, 0.1], [0.42, 0.06], [0.5, 0.005]]
      : [[-0.42, 0.03], [-0.34, 0.08], [-0.24, 0.15], [-0.1, 0.22], [0.05, 0.245], [0.2, 0.225], [0.33, 0.17], [0.44, 0.09], [0.5, 0.005]];
    const body = mesh(latheX(profile, 40), skin);
    body.scale.z = shark ? 0.78 : 0.5;
    body.userData.skin = true; rememberBase(body);
    g.add(body);

    // tail fin (pivot at its base)
    const tailPts = shark
      ? [[0, 0.03], [-0.1, 0.2], [-0.17, 0.26], [-0.14, 0.06], [-0.1, 0.0], [-0.13, -0.13], [-0.1, -0.16], [0, -0.03]]
      : [[0, 0.06], [-0.13, 0.2], [-0.2, 0.18], [-0.13, 0.0], [-0.2, -0.18], [-0.13, -0.2], [0, -0.06]];
    const tail = mesh(fin(tailPts), finMat, shark ? -0.48 : -0.4, 0, 0);
    tail.userData.skin = true; g.add(tail);

    // dorsal / anal fins
    const dorsal = mesh(fin(shark ? [[-0.12, 0], [-0.02, 0.2], [0.05, 0.19], [0.1, 0]] : [[-0.22, 0], [-0.12, 0.13], [0.08, 0.15], [0.16, 0]]), finMat, shark ? 0.02 : 0.0, shark ? 0.1 : 0.2, 0);
    dorsal.userData.skin = true; g.add(dorsal);
    const anal = mesh(fin(shark ? [[-0.05, 0], [0, -0.07], [0.05, -0.06], [0.07, 0]] : [[-0.14, 0], [-0.06, -0.12], [0.08, -0.11], [0.14, 0]]), finMat, shark ? -0.2 : 0.02, shark ? -0.095 : -0.2, 0);
    anal.userData.skin = true; g.add(anal);
    if (shark) {
      const d2 = mesh(fin([[-0.04, 0], [0.0, 0.06], [0.04, 0.05], [0.05, 0]]), finMat, -0.25, 0.085, 0);
      d2.userData.skin = true; g.add(d2);
    }

    // pectoral fins (pivot at root, angled out from the body)
    const pecPts = shark ? [[0, 0.02], [-0.16, -0.14], [-0.24, -0.13], [-0.12, -0.02], [0, -0.02]] : [[0, 0.03], [-0.1, 0.09], [-0.17, 0.02], [-0.11, -0.06], [0, -0.03]];
    const pecs = [];
    for (const s of [1, -1]) {
      const p = mesh(fin(pecPts), finMat, shark ? 0.14 : 0.16, shark ? -0.05 : -0.02, s * (shark ? 0.085 : 0.1));
      p.rotation.y = s * (shark ? 0.55 : 0.7); p.rotation.x = s * (shark ? 0.5 : 0.25);
      p.userData.skin = true; g.add(p); pecs.push(p);
    }

    // eyes + mouth
    const ex = shark ? 0.36 : 0.32, ey = shark ? 0.04 : 0.06, ez = shark ? 0.085 : 0.11, er = shark ? 0.022 : 0.045;
    for (const s of [1, -1]) addEye(g, ex, ey, s * ez, er, [0.3, 0, s]);
    if (shark) {
      // crescent mouth under the snout with a row of teeth
      const mouth = mesh(new T.TorusGeometry(0.075, 0.012, 8, 24, PI), darkMat, 0.4, -0.045, 0);
      mouth.rotation.set(PI / 2, 0, PI); g.add(mouth);
      for (let i = 0; i <= 6; i++) {
        const a = PI + (i / 6) * PI;
        const tooth = mesh(new T.ConeGeometry(0.007, 0.022, 6), toothMat, 0.4 + Math.cos(a) * 0.075, -0.05, Math.sin(a) * 0.075);
        tooth.rotation.x = PI; g.add(tooth);
      }
      // gill slits
      for (const s of [1, -1]) for (let i = 0; i < 5; i++) {
        const slit = mesh(new T.BoxGeometry(0.006, 0.07, 0.008), darkMat, 0.2 + i * 0.03, 0.0, s * 0.095);
        slit.rotation.z = -0.15; g.add(slit);
      }
    } else {
      const mouth = mesh(new T.SphereGeometry(0.03, 12, 8), darkMat, 0.49, -0.02, 0);
      mouth.scale.set(0.5, 0.7, 1.3); g.add(mouth);
      const lip = mesh(new T.TorusGeometry(0.035, 0.008, 8, 16), skin, 0.485, -0.02, 0);
      lip.rotation.y = PI / 2; lip.scale.set(0.7, 0.8, 1); lip.userData.skin = true; g.add(lip);
    }

    projectUVs(g, 'side');
    const freq = shark ? 5 : 9, amp = shark ? 0.05 : 0.07;
    return {
      group: g, height: 0.55, width: 1.0, faces: 'x',
      anim(t, o) {
        const sp = o.speedFactor;
        bendBody(body, t, freq * sp, amp, o.phase);
        tail.rotation.y = Math.sin(t * freq * sp + o.phase - 4.2) * 0.55;
        tail.position.z = Math.sin(t * freq * sp + o.phase - 4) * amp * 0.9;
        pecs[0].rotation.z = Math.sin(t * 3 + o.phase) * 0.25;
        pecs[1].rotation.z = -Math.sin(t * 3 + o.phase) * 0.25;
        dorsal.rotation.x = Math.sin(t * 2 + o.phase) * 0.08;
      },
    };
  }

  // ================================================================ TURTLE
  function buildTurtle(tex) {
    const g = new T.Group();
    const skin = skinMaterial(tex, 'scutes', 0.02);
    const flipperMat = skinMaterial(tex, 'skin', 0.003, { side: T.DoubleSide });

    const shell = mesh(new T.SphereGeometry(0.31, 36, 18, 0, PI * 2, 0, PI / 2), skin, 0, 0.0, 0);
    shell.scale.set(1.0, 0.7, 0.85); shell.userData.skin = true; g.add(shell);
    const plastron = mesh(new T.CylinderGeometry(0.30, 0.26, 0.06, 36), skin, 0, -0.03, 0);
    plastron.scale.z = 0.85; plastron.userData.skin = true; g.add(plastron);
    const rim = mesh(new T.TorusGeometry(0.305, 0.02, 8, 36), skin, 0, 0.0, 0);
    rim.rotation.x = PI / 2; rim.scale.set(1, 0.85, 1); rim.userData.skin = true; g.add(rim);

    const neck = mesh(new T.CylinderGeometry(0.05, 0.06, 0.16, 12), flipperMat, 0.34, 0.0, 0);
    neck.rotation.z = -PI / 2; neck.userData.skin = true; g.add(neck);
    const head = mesh(new T.SphereGeometry(0.1, 20, 14), flipperMat, 0.46, 0.02, 0);
    head.scale.set(1.35, 0.85, 0.95); head.userData.skin = true; g.add(head);
    for (const s of [1, -1]) addEye(g, 0.5, 0.045, s * 0.06, 0.022, [0.4, 0.2, s]);
    const mouth = mesh(new T.BoxGeometry(0.06, 0.006, 0.09), darkMat, 0.54, -0.02, 0); g.add(mouth);
    const tail = mesh(new T.ConeGeometry(0.03, 0.14, 8), flipperMat, -0.37, -0.01, 0);
    tail.rotation.z = PI / 2; tail.userData.skin = true; g.add(tail);

    const front = [], rear = [];
    for (const s of [1, -1]) {
      const f = mesh(fin([[0, 0.02], [0.12, 0.14], [0.32, 0.3], [0.4, 0.28], [0.3, 0.12], [0.14, -0.03], [0, -0.03]], 0.035), flipperMat, 0.12, -0.01, s * 0.22);
      f.rotation.x = (s > 0 ? PI / 2 : -PI / 2) - s * 0.2;   // lay flat (+y -> outward z), slight droop
      f.userData.skin = true; f.userData.side = s; g.add(f); front.push(f);
      const r = mesh(fin([[0, 0.02], [-0.06, 0.1], [-0.16, 0.17], [-0.2, 0.14], [-0.12, 0.03], [0, -0.03]], 0.035), flipperMat, -0.18, -0.01, s * 0.2);
      r.rotation.x = (s > 0 ? PI / 2 : -PI / 2) - s * 0.2;
      r.userData.skin = true; g.add(r); rear.push(r);
    }

    projectUVs(g, 'top');
    return {
      group: g, height: 0.35, width: 1.0, faces: 'x',
      anim(t, o) {
        const s = Math.sin(t * 2.2 + o.phase);
        for (const f of front) { f.rotation.z = s * 0.35; f.rotation.y = f.userData.side * s * 0.15; }
        for (const r of rear) r.rotation.z = Math.sin(t * 2.2 + o.phase + 1.5) * 0.15;
        head.position.y = 0.01 + Math.sin(t * 1.1 + o.phase) * 0.015;
      },
    };
  }

  // ============================================================== SEAHORSE
  function buildSeahorse(tex) {
    const g = new T.Group();
    const skin = skinMaterial(tex, 'ridges', 0.01);
    const finMat = skinMaterial(tex, null, 0, { side: T.DoubleSide });

    const spine = new T.CatmullRomCurve3([
      new T.Vector3(0.02, 0.36, 0), new T.Vector3(0.06, 0.24, 0), new T.Vector3(0.12, 0.08, 0), new T.Vector3(0.1, -0.1, 0),
      new T.Vector3(0.02, -0.26, 0), new T.Vector3(-0.08, -0.36, 0), new T.Vector3(-0.13, -0.44, 0), new T.Vector3(-0.06, -0.5, 0),
      new T.Vector3(0.03, -0.46, 0), new T.Vector3(0.0, -0.4, 0),
    ]);
    const tubeSegs = 60, radial = 14;
    const bodyGeo = new T.TubeGeometry(spine, tubeSegs, 0.1, radial, false);
    // taper: fat belly, thin curling tail
    {
      const pos = bodyGeo.attributes.position, pts = spine.getPoints(tubeSegs);
      for (let i = 0; i <= tubeSegs; i++) {
        const u = i / tubeSegs;
        const f = u < 0.35 ? 0.85 + u * 0.9 : u < 0.6 ? 1.17 - (u - 0.35) * 1.8 : 0.72 - (u - 0.6) * 1.6;
        const c = pts[i];
        for (let j = 0; j <= radial; j++) {
          const k = i * (radial + 1) + j;
          const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
          pos.setXYZ(k, c.x + (x - c.x) * f, c.y + (y - c.y) * f, c.z + (z - c.z) * f * 0.8);
        }
      }
      bodyGeo.computeVertexNormals();
    }
    const body = mesh(bodyGeo, skin); body.userData.skin = true; g.add(body);

    const head = mesh(new T.SphereGeometry(0.11, 20, 14), skin, 0.02, 0.4, 0);
    head.scale.set(1.15, 1.0, 0.85); head.userData.skin = true; g.add(head);
    const snout = mesh(new T.CylinderGeometry(0.022, 0.045, 0.2, 12), skin, 0.2, 0.38, 0);
    snout.rotation.z = -PI / 2 + 0.15; snout.userData.skin = true; g.add(snout);
    for (let i = 0; i < 4; i++) {
      const c = mesh(new T.ConeGeometry(0.02, 0.06, 6), skin, -0.03 + i * 0.03, 0.5, 0);
      c.rotation.z = -0.4 + i * 0.25; c.userData.skin = true; g.add(c);
    }
    for (const s of [1, -1]) addEye(g, 0.07, 0.42, s * 0.085, 0.024, [0.4, 0.1, s]);
    const dorsal = mesh(fin([[0, 0.14], [-0.09, 0.1], [-0.11, -0.06], [0, -0.1]]), finMat, -0.02, -0.02, 0);
    dorsal.userData.skin = true; g.add(dorsal);
    const pecs = [];
    for (const s of [1, -1]) {
      const p = mesh(fin([[0, 0.02], [0.06, 0.05], [0.09, -0.01], [0.05, -0.05], [0, -0.03]], 0.008), finMat, 0.05, 0.28, s * 0.07);
      p.rotation.y = s * 0.9; p.userData.skin = true; g.add(p); pecs.push(p);
    }

    projectUVs(g, 'side');
    return {
      group: g, height: 1.05, width: 0.5, faces: 'x',
      anim(t, o) {
        dorsal.rotation.y = Math.sin(t * 14 + o.phase) * 0.35;
        pecs[0].rotation.z = Math.sin(t * 9 + o.phase) * 0.3;
        pecs[1].rotation.z = -Math.sin(t * 9 + o.phase) * 0.3;
        head.rotation.z = Math.sin(t * 1.3 + o.phase) * 0.06;
      },
    };
  }

  // =================================================================== RAY
  function buildRay(tex) {
    const g = new T.Group();
    const skin = skinMaterial(tex, 'skin', 0.002, { side: T.DoubleSide });
    const nx = 44, nz = 28;
    const hw = x => 0.56 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x * 2), 1.6)), 0.65);
    const thick = (x, s) => 0.045 * Math.pow(Math.max(0, 1 - s * s), 1.4) * Math.sqrt(Math.max(0, 1 - Math.pow(x * 2, 2))) + 0.05 * Math.exp(-(s * 2.6) * (s * 2.6)) * Math.max(0, 1 - Math.pow(x * 2, 2)) + 0.003;
    const pos = [], idx = [], uvs = [];
    const V = (nx + 1) * (nz + 1);
    for (let side = 0; side < 2; side++) for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = -0.5 + i / nx, s = -1 + 2 * j / nz;
      const z = s * hw(x), y = (side ? -1 : 1) * thick(x, s);
      pos.push(x, y, z); uvs.push(i / nx, j / nz);
    }
    for (let side = 0; side < 2; side++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const a = side * V + i * (nz + 1) + j, b = a + 1, c = a + nz + 1, d = c + 1;
      if (side) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const body = mesh(geo, skin); body.userData.skin = true; rememberBase(body); g.add(body);

    const tail = mesh(new T.CylinderGeometry(0.004, 0.016, 0.6, 8), skin, -0.78, 0, 0);
    tail.rotation.z = -PI / 2; tail.userData.skin = true; g.add(tail);
    const lobes = [];
    for (const s of [1, -1]) {
      const l = mesh(fin([[0, 0.02], [0.1, 0.03], [0.14, 0.0], [0.1, -0.03], [0, -0.02]], 0.03), skin, 0.46, 0.0, s * 0.1);
      l.rotation.y = -s * 0.5; l.userData.skin = true; g.add(l); lobes.push(l);
    }
    for (const s of [1, -1]) addEye(g, 0.34, 0.06, s * 0.13, 0.026, [0.2, 0.6, s]);
    const mouth = mesh(new T.BoxGeometry(0.03, 0.01, 0.12), darkMat, 0.44, -0.035, 0); g.add(mouth);
    for (const s of [1, -1]) for (let i = 0; i < 5; i++) {
      const slit = mesh(new T.BoxGeometry(0.008, 0.006, 0.05), darkMat, 0.3 - i * 0.045, -0.04, s * 0.12);
      slit.rotation.y = s * 0.25; g.add(slit);
    }

    projectUVs(g, 'top');
    return {
      group: g, height: 0.2, width: 1.1, faces: 'x',
      anim(t, o) {
        const p = body.geometry.attributes.position, a = p.array, b = body.userData.base;
        for (let i = 0; i < a.length; i += 3) {
          const s = clamp(Math.abs(b[i + 2]) / 0.56, 0, 1);
          a[i + 1] = b[i + 1] + Math.sin(t * 3 + o.phase - s * 2.4) * 0.16 * s * s;
        }
        p.needsUpdate = true; body.geometry.computeVertexNormals();
        tail.rotation.y = Math.sin(t * 2 + o.phase) * 0.15;
        lobes[0].rotation.z = Math.sin(t * 2.5 + o.phase) * 0.2; lobes[1].rotation.z = -lobes[0].rotation.z;
      },
    };
  }

  // ============================================================= JELLYFISH
  function buildJellyfish(tex) {
    const g = new T.Group();
    const skin = skinMaterial(tex, null, 0, { transparent: true, opacity: 0.88, side: T.DoubleSide, roughness: 0.25 });
    const prof = [[0, 0.5], [0.14, 0.49], [0.27, 0.45], [0.37, 0.37], [0.43, 0.27], [0.45, 0.17], [0.43, 0.12], [0.36, 0.13], [0.28, 0.16], [0.16, 0.18], [0, 0.19]];
    const bell = mesh(new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), 40), skin);
    bell.userData.skin = true; g.add(bell);
    // scalloped rim: little bumps around the lip
    const rimMat = skinMaterial(tex, null, 0, { transparent: true, opacity: 0.9 });
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * PI * 2;
      const b = mesh(new T.SphereGeometry(0.04, 10, 8), rimMat, Math.cos(a) * 0.43, 0.13, Math.sin(a) * 0.43);
      b.userData.skin = true; g.add(b);
    }
    for (const s of [1, -1]) addEye(g, s * 0.13, 0.33, 0.35, 0.035, [0, 0, 1]);
    const smile = mesh(new T.TorusGeometry(0.06, 0.008, 6, 16, PI), darkMat, 0, 0.27, 0.42);
    smile.rotation.z = PI; g.add(smile);

    // oral arms: ruffled ribbons
    const arms = [];
    const armMat = skinMaterial(tex, null, 0, { transparent: true, opacity: 0.7, side: T.DoubleSide, roughness: 0.7 });
    for (let i = 0; i < 4; i++) {
      const geo = new T.PlaneGeometry(0.12, 0.42, 2, 14); geo.translate(0, -0.21, 0);
      const a = mesh(geo, armMat, Math.cos(i * PI / 2) * 0.08, 0.17, Math.sin(i * PI / 2) * 0.08);
      a.rotation.y = -i * PI / 2; a.userData.skin = true; rememberBase(a); a.userData.i = i; g.add(a); arms.push(a);
    }
    // tentacles: thin strands hanging from the rim, pivot at the top
    const tents = [];
    const tentMat = new T.MeshStandardMaterial({ color: 0xead9f2, transparent: true, opacity: 0.6, roughness: 0.8 });
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * PI * 2, len = 0.4 + (i % 3) * 0.12;
      const geo = new T.CylinderGeometry(0.002, 0.005, len, 6); geo.translate(0, -len / 2, 0);
      const tm = mesh(geo, tentMat, Math.cos(a) * 0.4, 0.14, Math.sin(a) * 0.4);
      tm.userData.i = i; g.add(tm); tents.push(tm);
    }

    projectUVs(g, 'front');
    return {
      group: g, height: 1.0, width: 0.9, faces: 'z',
      anim(t, o) {
        const p = Math.sin(t * 1.6 + o.phase);
        bell.scale.set(1 - p * 0.07, 1 + p * 0.1, 1 - p * 0.07);
        for (const tm of tents) {
          tm.rotation.x = Math.sin(t * 1.1 + tm.userData.i) * 0.18 - p * 0.12;
          tm.rotation.z = Math.cos(t * 0.9 + tm.userData.i * 1.3) * 0.18;
        }
        for (const a of arms) {
          const pos = a.geometry.attributes.position, arr = pos.array, b = a.userData.base;
          for (let i = 0; i < arr.length; i += 3) {
            const k = -b[i + 1] / 0.42;
            arr[i] = b[i] + Math.sin(t * 2 + a.userData.i + k * 5) * 0.03 * k;
            arr[i + 2] = Math.sin(t * 1.5 + a.userData.i * 2 + k * 4) * 0.04 * k;
          }
          pos.needsUpdate = true;
        }
      },
    };
  }

  // =============================================================== OCTOPUS
  function buildOctopus(tex) {
    const g = new T.Group();
    const skin = skinMaterial(tex, 'warts', 0.006);
    const mantle = mesh(new T.SphereGeometry(0.23, 28, 20), skin, 0, 0.3, 0);
    mantle.scale.set(1, 1.25, 1); mantle.userData.skin = true; g.add(mantle);
    const head = mesh(new T.SphereGeometry(0.21, 28, 20), skin, 0, 0.05, 0);
    head.scale.set(1.1, 0.8, 1.0); head.userData.skin = true; g.add(head);
    for (const s of [1, -1]) addEye(g, s * 0.1, 0.12, 0.17, 0.05, [0, 0, 1]);
    const smile = mesh(new T.TorusGeometry(0.05, 0.008, 6, 16, PI), darkMat, 0, 0.0, 0.2);
    smile.rotation.z = PI; g.add(smile);

    // eight arms, each a chain of tapered segments that curl
    const arms = [];
    const N = 7, segLen = 0.11;
    for (let a = 0; a < 8; a++) {
      const ang = a / 8 * PI * 2 + PI / 8;
      const root = new T.Group();
      root.position.set(Math.cos(ang) * 0.16, -0.06, Math.sin(ang) * 0.16);
      root.rotation.y = -ang;                     // local +x points outward
      root.rotation.z = -1.05;                    // tilt down-outward
      g.add(root);
      let parent = root;
      const segs = [];
      for (let i = 0; i < N; i++) {
        const r0 = 0.05 * (1 - i / (N + 1)), r1 = 0.05 * (1 - (i + 1) / (N + 1));
        const geo = new T.CylinderGeometry(r1, r0, segLen, 10); geo.translate(0, -segLen / 2, 0);
        const seg = new T.Group();
        const m = mesh(geo, skin); m.userData.skin = true; seg.add(m);
        // suckers on the underside (the +x side in segment space after the tilt)
        for (let k = 0; k < 2; k++) {
          const s = mesh(new T.SphereGeometry(r0 * 0.4, 8, 6), suckerMat, 0, -segLen * (0.3 + k * 0.4), r0 * 0.85);
          seg.add(s);
        }
        parent.add(seg);
        seg.position.y = i === 0 ? 0 : -segLen;
        segs.push(seg); parent = seg;
      }
      arms.push({ root, segs, a });
    }

    projectUVs(g, 'front');
    return {
      group: g, height: 1.0, width: 1.1, faces: 'z',
      anim(t, o) {
        const p = Math.sin(t * 1.6 + o.phase);
        mantle.scale.set(1 - p * 0.05, 1.25 + p * 0.08, 1 - p * 0.05);
        for (const arm of arms) {
          for (let i = 0; i < arm.segs.length; i++) {
            arm.segs[i].rotation.x = 0.18 + Math.sin(t * 1.4 + o.phase + arm.a * 0.8 + i * 0.7) * 0.22 + i * 0.06;
            arm.segs[i].rotation.z = Math.sin(t * 0.9 + arm.a + i * 0.5) * 0.08;
          }
          arm.root.rotation.z = -1.05 + Math.sin(t * 1.6 + o.phase + arm.a) * 0.15;
        }
      },
    };
  }

  // ================================================================== CRAB
  // cylinder between two points (in the parent's space)
  function limb(parent, a, b, r0, r1, mat) {
    const A = new T.Vector3(...a), B = new T.Vector3(...b);
    const len = A.distanceTo(B);
    const geo = new T.CylinderGeometry(r1, r0, len, 10);
    const m = new T.Mesh(geo, mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    m.userData.skin = true;
    parent.add(m);
    return m;
  }

  function buildCrab(tex) {
    const g = new T.Group();
    const skin = skinMaterial(tex, 'skin', 0.004);
    const shell = mesh(new T.SphereGeometry(0.3, 32, 18), skin, 0, 0.2, 0);
    shell.scale.set(1.15, 0.45, 0.8); shell.userData.skin = true; g.add(shell);
    const belly = mesh(new T.SphereGeometry(0.27, 24, 12), skin, 0, 0.17, 0);
    belly.scale.set(1.1, 0.25, 0.75); belly.userData.skin = true; g.add(belly);
    // eye stalks
    for (const s of [1, -1]) {
      const stalk = mesh(new T.CylinderGeometry(0.014, 0.018, 0.12, 8), skin, s * 0.1, 0.32, 0.17);
      stalk.userData.skin = true; g.add(stalk);
      addEye(g, s * 0.1, 0.39, 0.17, 0.034, [0, 0.2, 1]);
    }
    const mouth = mesh(new T.BoxGeometry(0.08, 0.014, 0.02), darkMat, 0, 0.14, 0.24); g.add(mouth);

    // claws: arm -> hand (palm + fixed lower jaw + moving upper jaw)
    const claws = [];
    for (const s of [1, -1]) {
      const arm = new T.Group();
      arm.position.set(s * 0.3, 0.18, 0.16);
      arm.rotation.y = s > 0 ? -0.9 : PI + 0.9;      // local +x points forward-outward
      g.add(arm);
      limb(arm, [0, 0, 0], [0.17, 0.03, 0], 0.035, 0.03, skin);
      const hand = new T.Group(); hand.position.set(0.17, 0.03, 0); arm.add(hand);
      const palm = mesh(new T.SphereGeometry(0.075, 16, 12), skin, 0.05, 0, 0);
      palm.scale.set(1.3, 0.8, 1.0); palm.userData.skin = true; hand.add(palm);
      limb(hand, [0.09, -0.025, 0], [0.32, -0.03, 0], 0.035, 0.004, skin);
      const upperPivot = new T.Group(); upperPivot.position.set(0.08, 0.025, 0); hand.add(upperPivot);
      limb(upperPivot, [0, 0, 0], [0.23, 0.0, 0], 0.03, 0.004, skin);
      claws.push({ arm, upperPivot, s, baseY: arm.rotation.y });
    }

    // legs: 4 per side, coxa -> femur -> tibia reaching down to the floor (y = 0)
    const legs = [];
    for (const s of [1, -1]) for (let i = 0; i < 4; i++) {
      const hip = new T.Group();
      hip.position.set(s * 0.29, 0.16, 0.1 - i * 0.08);
      const th = 0.45 - i * 0.3;                       // front legs forward, rear legs back
      hip.rotation.y = s > 0 ? -th : PI + th;
      g.add(hip);
      limb(hip, [0, 0, 0], [0.12, 0.06, 0], 0.024, 0.02, skin);
      limb(hip, [0.12, 0.06, 0], [0.25, 0.12, 0], 0.02, 0.016, skin);
      limb(hip, [0.25, 0.12, 0], [0.36, -0.16, 0], 0.016, 0.004, skin);
      const kneeCap = mesh(new T.SphereGeometry(0.022, 8, 6), skin, 0.25, 0.12, 0);
      kneeCap.userData.skin = true; hip.add(kneeCap);
      legs.push({ hip, base: hip.rotation.y, s, i });
    }

    projectUVs(g, 'top');
    return {
      group: g, height: 0.45, width: 1.4, faces: 'z',
      anim(t, o) {
        const w = t * 9 * o.speedFactor;
        for (const l of legs) {
          const ph = (l.i % 2) * PI + (l.s > 0 ? 0 : PI / 2);
          l.hip.rotation.y = l.base + Math.sin(w + ph) * 0.15;
          l.hip.rotation.z = Math.max(0, Math.sin(w + ph + PI / 2)) * 0.22;   // lift the leg on its forward swing
        }
        for (const c of claws) {
          c.upperPivot.rotation.z = 0.1 + Math.max(0, Math.sin(t * 1.3 + c.s)) * 0.45;
          c.arm.rotation.z = Math.sin(t * 1.1 + c.s * 2) * 0.12;
        }
      },
    };
  }

  const BUILDERS = {
    clownfish: t => buildFish(t, false),
    shark: t => buildFish(t, true),
    turtle: buildTurtle,
    seahorse: buildSeahorse,
    ray: buildRay,
    jellyfish: buildJellyfish,
    octopus: buildOctopus,
    crab: buildCrab,
  };

  return {
    build(species, texture) { return (BUILDERS[species] || BUILDERS.clownfish)(texture); },
    has(species) { return !!BUILDERS[species]; },
  };
})();
