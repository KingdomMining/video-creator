// kit/props.js - KitProps: small and hand-held objects for the low-poly 3D stage. Exports one global: KitProps.
// Reference with every option, size and grip: docs/kit/props.md (catalogue images docs/kit/props_*.jpg).
//
// Every builder is KitProps.name(o = {}) and returns a THREE.Group at real scale (metres):
//   - REST pose (default): resting on y = 0, centred on its footprint, front toward +Z, like every other kit.
//     Wall-mounted props (keypad, CCTV camera, exit sign, taped note ...) have their back on z = 0 instead.
//   - HELD pose: pass {held: true} (or call prop.userData.held()) and the natural grip point moves to the origin,
//     turned the way a hand carries it, so Actors.hold / hand.add(prop) puts it straight into a fist.
//     prop.userData.grip = {pos, rot} is that grip in rest coordinates; prop.userData.size = [w, h, d] in metres.
// Moving parts are on prop.userData (open(k), lid, flame, screen ...). Anything that animates by itself has
// prop.userData.update(t), a pure function of time: KitProps.animate(s, propA, propB) calls it every frame.
// Deterministic: all variation comes from o.seed. No Math.random, no Date.
const KitProps = (() => {
  const T = THREE, PI = Math.PI, TAU = Math.PI * 2;
  const { box, boxB, cyl, cylB, cone, coneB, ball, blob, quad, torus, lathe, tube, mat, mesh, canvasTex, texMat, flare, noise1 } = S3;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max, flr = Math.floor, hyp = Math.hypot;
  const V3 = (x, y, z) => new T.Vector3(x, y, z);

  // ---------- colour ----------
  const rgb = c => { const n = new T.Color(c).getHex(); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const hexOf = (r, g, b) => '#' + [r, g, b].map(v => max(0, min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  /** Darker (k < 1) or lighter (k > 1; 2 = white) version of a colour. */
  const shade = (c, k) => { const [r, g, b] = rgb(c); return k <= 1 ? hexOf(r * k, g * k, b * k) : hexOf(r + (255 - r) * (k - 1), g + (255 - g) * (k - 1), b + (255 - b) * (k - 1)); };
  const mixc = (a, b, k) => { const A = rgb(a), B = rgb(b); return hexOf(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k); };
  const rgba = (c, a) => { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; };
  // shared palette: muted, warm against cool
  const C = {
    steel: '#98a2ad', steelD: '#646d78', iron: '#3b4048', black: '#202329', rubber: '#26292e', chrome: '#cdd5dd',
    brass: '#c9a24a', gold: '#e8b93a', copper: '#b8703e', wood: '#9a6a3c', woodD: '#6b4526', woodL: '#c79c63',
    paper: '#efe8d6', white: '#eef0f2', cream: '#f2e6cf', card: '#b88a55', kraft: '#c49a66',
    red: '#c8382e', orange: '#e2742c', yellow: '#f0c330', green: '#3f8f5a', teal: '#2f8088', blue: '#2f6fb5',
    navy: '#27344d', purple: '#6b4a9a', pink: '#e06a8c', grey: '#8a8f98', dark: '#2b2e34', leather: '#7a4a2a', olive: '#66704a',
  };
  const METAL = { rough: 0.42, metal: 0.45 }, SATIN = { rough: 0.5, metal: 0.2 }, GLOSS = { rough: 0.3 }, MATTE = { rough: 0.95 };
  /** Unlit glowing material. side: 'back' draws only the far side (used for layered flames). */
  const glo = (color, k = 1, o = {}) => { const m = new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(k), toneMapped: false }); if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; } if (o.add) { m.blending = T.AdditiveBlending; m.transparent = true; m.depthWrite = false; } if (o.side === 'back') m.side = T.BackSide; else if (o.side === 'double') m.side = T.DoubleSide; return m; };

  // ---------- geometry helpers ----------
  /** Rounded rectangle outline centred on the origin, n segments per corner. */
  const rrPts = (w, h, r, n = 2) => { const p = [], hw = w / 2, hh = h / 2; r = min(r, hw, hh); [[hw - r, hh - r], [-hw + r, hh - r], [-hw + r, -hh + r], [hw - r, -hh + r]].forEach(([cx, cy], q) => { for (let i = 0; i <= n; i++) { const a = (q + i / n) * PI / 2; p.push([cx + cos(a) * r, cy + sin(a) * r]); } }); return p; };
  /** Regular polygon outline. */
  const ngon = (r, n, a0 = 0) => Array.from({ length: n }, (_, i) => [cos(a0 + i / n * TAU) * r, sin(a0 + i / n * TAU) * r]);
  /** Extrude a 2D outline along +Z. o: {bevel (chamfer size), holes, center (centre in z), up (outline in plan, thickness up from y = 0), cs} + material options. */
  function ext(pts, depth, col, o = {}) {
    const sh = new T.Shape(pts.map(p => new T.Vector2(p[0], p[1]))); (o.holes || []).forEach(h => sh.holes.push(new T.Path(h.map(p => new T.Vector2(p[0], p[1])))));
    const b = min(o.bevel || 0, depth * 0.49), g = new T.ExtrudeGeometry(sh, { depth: depth - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: o.cs || 5 });
    g.translate(0, 0, b - (o.center ? depth / 2 : 0)); if (o.up) g.rotateX(-PI / 2);
    return mesh(g, col, o);
  }
  /** Slab with rounded corners in plan: w (x) by d (z), h thick, standing on y = 0. */
  const slab = (w, d, h, r, col, o = {}) => ext(rrPts(w, d, r, o.n), h, col, { ...o, up: true });
  /** Plate with rounded corners in elevation: w (x) by h (y), d thick, centred. */
  const plate = (w, h, d, r, col, o = {}) => ext(rrPts(w, h, r, o.n), d, col, { ...o, center: true });
  /** Open-ended tube wall (no caps): inside faces visible. */
  const pipe = (rTop, rBot, h, seg, col, o = {}) => mesh(new T.CylinderGeometry(rTop, rBot, h, seg, 1, true), col, { side: 'double', ...o });
  /** Flat disc facing +Y (plan) or +Z (o.up === false). */
  const disc = (r, seg, col, o = {}) => { const g = new T.CircleGeometry(r, seg); if (o.up !== false) g.rotateX(-PI / 2); return mesh(g, col, o); };
  /** Flat ring facing +Y. */
  const ring = (r0, r1, seg, col, o = {}) => { const g = new T.RingGeometry(r0, r1, seg, 1); if (o.up !== false) g.rotateX(-PI / 2); return mesh(g, col, o); };
  /** Part of a torus: an arc of `arc` radians in the XY plane starting at angle 0 (+X), anticlockwise. */
  const arcTube = (r, t, arc, col, o = {}) => mesh(new T.TorusGeometry(r, t, o.rs || 5, o.ts || 8, arc), col, o);
  /** Mesh from raw triangles: verts [[x,y,z]...], faces [[a,b,c]...] (anticlockwise seen from outside). */
  function poly(verts, faces, col, o = {}) { const p = []; faces.forEach(f => { for (let i = 1; i < f.length - 1; i++) [f[0], f[i], f[i + 1]].forEach(k => p.push(verts[k][0], verts[k][1], verts[k][2])); }); const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return mesh(g, col, o); }
  const grp = (...kids) => { const g = new T.Group(); kids.flat().forEach(k => k && g.add(k)); return g; };
  /** Mark an object as an effect (halo, beam): ignored when the prop is measured. */
  const fx = o => { o.userData.fx = true; return o; };
  /** Mark a mesh that must stay separate (animated, or its material is changed later). */
  const keep = o => { o.userData.keep = true; return o; };
  /** Mark a group as a moving part: its meshes are merged inside it, never into the body. */
  const part = (...kids) => { const g = grp(...kids); g.userData.part = true; return g; };
  const socket = (x, y, z) => { const s = new T.Object3D(); s.position.set(x, y, z); return s; };

  // ---------- merge static meshes (one draw call per material) ----------
  const relMat = (o, root) => { const ch = []; for (let p = o; p && p !== root; p = p.parent) { p.updateMatrix(); ch.push(p.matrix); } const m = new T.Matrix4(); for (let i = ch.length - 1; i >= 0; i--) m.multiply(ch[i]); return m; };
  function bake(root) {
    const buckets = new Map(), parts = [];
    const walk = o => { for (const k of o.children) { if (k.userData.part) { parts.push(k); continue; } if (k.isMesh && !k.userData.keep && !k.userData.fx) { const key = k.material.uuid + (k.castShadow ? 'c' : '') + (k.receiveShadow ? 'r' : '') + k.renderOrder; (buckets.get(key) || buckets.set(key, []).get(key)).push(k); } walk(k); } };
    walk(root);
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const m0 = list[0], vc = !!m0.material.vertexColors, uv = !!m0.material.map, pos = [], nor = [], uvs = [], col = [];
      for (const m of list) {
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); const M = relMat(m, root); g.applyMatrix4(M);
        const p = g.attributes.position.array, n = g.attributes.normal ? g.attributes.normal.array : null, u = g.attributes.uv ? g.attributes.uv.array : null, c = g.attributes.color ? g.attributes.color.array : null, cnt = p.length / 3, flip = M.determinant() < 0;
        for (let i = 0; i < cnt; i += 3) for (const j of (flip ? [0, 2, 1] : [0, 1, 2])) { const k = i + j; pos.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]); if (n) nor.push(n[k * 3], n[k * 3 + 1], n[k * 3 + 2]); else nor.push(0, 1, 0); if (uv) { if (u) uvs.push(u[k * 2], u[k * 2 + 1]); else uvs.push(0, 0); } if (vc) { if (c) col.push(c[k * 3], c[k * 3 + 1], c[k * 3 + 2]); else col.push(1, 1, 1); } }
        m.removeFromParent(); g.dispose();
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); if (uv) g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); if (vc) g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      const mm = new T.Mesh(g, m0.material); mm.castShadow = m0.castShadow; mm.receiveShadow = m0.receiveShadow; mm.renderOrder = m0.renderOrder; root.add(mm);
    }
    parts.forEach(bake);
  }
  /** Bounding box of the solid meshes under `root`, in the space of `frame` (an ancestor). */
  function measure(root, frame) {
    const bb = new T.Box3(), v = new T.Vector3();
    const walk = o => { if (o.userData.fx) return; if (o.isMesh) { const M = relMat(o, frame), p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) bb.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(M)); } o.children.forEach(walk); };
    walk(root); if (bb.isEmpty()) bb.set(V3(0, 0, 0), V3(0, 0, 0)); return bb;
  }
  const tris = root => { let n = 0; root.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(n); };

  // ---------- canvas textures (cached by key: the same options share one texture and one material) ----------
  const _tex = new Map(), _tm = new Map();
  const tex = (key, w, h, draw) => { let t = _tex.get(key); if (!t) { t = canvasTex(w, h, draw); _tex.set(key, t); } return t; };
  /** Material from a cached canvas texture. o: {basic (unlit, glows), emissive + ei (lit and glowing), side, transparent, rough, metal, decal:false (no polygon offset), own (private copy you may animate)} */
  function tm(key, w, h, draw, o = {}) {
    const k2 = [key, o.basic, o.emissive, o.ei, o.side, o.transparent, o.rough, o.metal, o.decal].join('|'); if (!o.own && _tm.has(k2)) return _tm.get(k2);
    const m = texMat(tex(key, w, h, draw), o); if (o.metal != null && !o.basic) m.metalness = o.metal;
    if (o.decal !== false) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    if (!o.own) _tm.set(k2, m); return m;
  }
  /** A flat printed face: quad w x h facing +Z (or +Y with up: true) showing a cached canvas. Does not cast shadows. */
  function decal(w, h, material, o = {}) { const g = new T.PlaneGeometry(w, h); if (o.up) g.rotateX(-PI / 2); const m = new T.Mesh(g, material); m.castShadow = false; m.receiveShadow = !material.isMeshBasicMaterial; return m; }
  // 2D drawing helpers
  const R2 = (c, x, y, w, h, r) => { r = min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const fitFont = (c, s, maxW, size, face, lo = 8) => { for (; size > lo; size -= 1) { c.font = face.replace('$', size); if (c.measureText(s).width <= maxW) break; } c.font = face.replace('$', size); return size; };
  const txt = (c, s, x, y, font, col, align = 'center') => { c.font = font; c.fillStyle = col; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, x, y); };
  const wrapT = (c, s, maxW) => { const out = []; for (const para of String(s).split('\n')) { let line = ''; for (const w of para.split(' ')) { const tr = line ? line + ' ' + w : w; if (c.measureText(tr).width > maxW && line) { out.push(line); line = w; } else line = tr; } out.push(line); } return out; };
  /** Draw wrapped text centred in a box, shrinking the font until it fits. face uses $ for the size: '700 $px Inter'. */
  function textBox(c, s, x, y, w, h, face, col, size, o = {}) {
    let ls; for (; size > 8; size -= 2) { c.font = face.replace('$', size); ls = wrapT(c, s, w); if (ls.length * size * (o.lh || 1.15) <= h && ls.every(l => c.measureText(l).width <= w)) break; }
    c.fillStyle = col; c.textAlign = o.align || 'center'; c.textBaseline = 'middle'; const lh = size * (o.lh || 1.15), y0 = y + h / 2 - (ls.length - 1) * lh / 2, tx = o.align === 'left' ? x : x + w / 2;
    ls.forEach((l, i) => c.fillText(l, tx, y0 + i * lh)); return size;
  }
  /** Speckle / fibre noise over a rectangle (paper, cardboard, rust). */
  const speck = (c, w, h, seed, n, col, a = 0.12, s = 2) => { const r = rng(seed); for (let i = 0; i < n; i++) { c.fillStyle = rgba(col, r() * a); c.fillRect(r() * w, r() * h, 1 + r() * s, 1 + r() * s); } };
  /** Grey "text" bars: lines of unreadable print. */
  const greek = (c, x, y, w, rows, lh, col, seed = 1, th = 0.45) => { const r = rng(seed); c.fillStyle = col; for (let i = 0; i < rows; i++) { let px = x; const end = x + w * (i === rows - 1 ? 0.35 + r() * 0.4 : 0.9 + r() * 0.1); while (px < end - 4) { const ww = min(end - px, (0.04 + r() * 0.12) * w); c.fillRect(px, y + i * lh, ww - lh * 0.22, lh * th); px += ww; } } };

  // ---------- fire ----------
  /** A layered low-poly flame `h` metres tall, standing on its origin. userData.flick(t, seed) animates it (pure function of time), userData.set(k) fades it (0 = out). */
  function flameOf(h = 0.03, o = {}) {
    const g = new T.Group(), r = h * (o.fat || 0.3), k = o.k || 1.4;
    const prof = s => [[0, 0], [r * 0.72 * s, h * 0.1 * s], [r * s, h * 0.3 * s], [r * 0.6 * s, h * 0.62 * s], [0, h * s]];
    const sh = grp(); g.add(sh);
    lathe(prof(1), 6, glo(o.color || '#ff8a22', k, { side: 'back' })).to(sh);
    lathe(prof(0.74), 6, glo(o.mid || '#ffc04a', k * 1.25, { side: 'back' })).at(0, h * 0.02, 0).rot(0, 0.5, 0).to(sh);
    lathe(prof(0.46), 5, glo(o.core || '#fff3cf', k * 1.6)).at(0, h * 0.05, 0).to(sh);
    const halo = flare(o.halo || '#ff9436', h * (o.haloSize || 9), o.haloOpacity ?? 0.4); halo.position.y = h * 0.45; g.add(halo);
    fx(g); const u = g.userData; u.shape = sh; u.halo = halo; u.h = h; u.on = 1; u.seed = o.seed || 1;
    u.flick = (t, amt = 1) => { const s = u.seed, a = noise1(t * 9, s), b = noise1(t * 5.3, s + 3), c = noise1(t * 6.1, s + 7), f = u.on; sh.scale.set((1 - 0.07 * a * amt) * f, (1 + 0.16 * a * amt) * f, (1 - 0.07 * a * amt) * f); sh.rotation.z = 0.11 * b * amt; sh.rotation.x = 0.11 * c * amt; halo.material.opacity = (o.haloOpacity ?? 0.4) * f * (0.88 + 0.12 * a); return 1 + 0.14 * a * amt + 0.06 * b * amt; };
    u.set = f => { u.on = clamp(f); sh.visible = halo.visible = u.on > 0.01; sh.scale.setScalar(u.on); halo.material.opacity = (o.haloOpacity ?? 0.4) * u.on; };
    return g;
  }

  // ---------- registration: rest pose, grip, held pose ----------
  const B = {}, META = {};
  const AX = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1] };
  // 'z y' = in the hand the prop's own +X runs along the hand's +Z and its +Y along the hand's +Y.
  // Hand frame = the actor's own axes with the arm hanging: +Y up the arm, +Z forward, +X to the actor's left.
  const holdQ = spec => { const [a, b] = (spec || 'x y').split(' '), x = V3(...AX[a]), y = V3(...AX[b]); return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x, y, V3().crossVectors(x, y))); };
  let HAND = new T.Quaternion();
  const _e = new T.Euler(), _q1 = new T.Quaternion(), _q2 = new T.Quaternion(), _q3 = new T.Quaternion(), _v1 = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3(), _m = new T.Matrix4(), UP = V3(0, 1, 0);

  /**
   * Register a builder. fn(o, g, ud) adds its parts to g (any convenient modelling frame) and returns
   *   {grip:[x,y,z], hold:'z y', grips:{name:{at, hold}}, poses:{name:{rot, sink}}, anchor:'auto'|'wall'|'floor'|'keep', aim:[x,y,z], top:[x,y,z]}.
   * The wrapper merges static meshes, puts the prop on y = 0 centred on its footprint, records size and grips.
   */
  function def(name, group, fn) {
    META[name] = { group };
    B[name] = (o = {}) => {
      const root = new T.Group(), body = new T.Group(), core = new T.Group(); root.add(body); body.add(core); root.name = name;
      const ud = root.userData; ud.kind = name; ud.kit = 'props';
      const r = fn(o, core, ud) || {};
      bake(core);
      const pose = (o.pose && r.poses && r.poses[o.pose]) || null;
      if (pose && pose.rot) core.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2]);
      core.updateMatrix(); const bb = measure(core, body), an = r.anchor || 'auto';
      if (an === 'auto') core.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y - ((pose && pose.sink) || 0), -(bb.min.z + bb.max.z) / 2);
      else if (an === 'wall') core.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -bb.min.z);
      else if (an === 'floor') core.position.y = -bb.min.y;
      core.updateMatrix();
      ud.size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].map(v => +v.toFixed(3)); ud.pose = pose ? o.pose : 'rest';
      const grips = {}, mk = (at, hold) => { const p = V3(...(at || [0, 0, 0])).applyMatrix4(core.matrix), qb = holdQ(hold).multiply(core.quaternion.clone().invert()), rr = _e.setFromQuaternion(qb.clone().invert()); return { p, qb, pos: p.toArray().map(v => +v.toFixed(3)), rot: [rr.x, rr.y, rr.z].map(v => +v.toFixed(3)) }; };
      grips.main = mk(r.grip, r.hold); for (const k in (r.grips || {})) grips[k] = mk(r.grips[k].at, r.grips[k].hold);
      ud.grips = grips; ud.grip = { pos: grips.main.pos, rot: grips.main.rot };
      ud.aim = V3(...(r.aim || [0, 0, 1])).applyQuaternion(core.quaternion); ud.top = V3(...(r.top || [0, 1, 0])).applyQuaternion(core.quaternion);
      /** held() / held('name'): grip at the origin, turned for a hand. held(false): back to the rest pose. Returns the prop. */
      ud.held = (which = true) => { if (!which) { body.position.set(0, 0, 0); body.quaternion.identity(); ud.mode = 'rest'; return root; } const gdef = grips[which === true ? 'main' : which] || grips.main; body.quaternion.copy(HAND).multiply(gdef.qb); body.position.copy(gdef.p).applyQuaternion(body.quaternion).negate(); ud.mode = 'held'; return root; };
      ud.mode = 'rest'; if (o.held) ud.held(o.held);
      return root;
    };
  }
  const alias = (name, of) => { B[name] = B[of]; META[name] = { group: META[of].group, alias: of }; };

  // =====================================================================================================
  // LIGHT SOURCES
  // =====================================================================================================
  def('flashlight', 'light', (o, g, ud) => {
    const L = o.length || 0.24, col = o.color || C.dark, acc = o.accent || C.orange, on = o.on !== false, lc = o.lightColor || '#fff1cf', rb = 0.017, rh = 0.03;
    const ax = grp().rot(PI / 2, 0, 0).to(g);                       // model along +Y, then lay it down: +Y -> +Z
    lathe([[0, 0], [rb * 0.82, 0], [rb * 0.97, 0.007], [rb * 0.97, 0.024], [rb, 0.028], [rb, L * 0.6], [rb * 1.15, L * 0.64], [rh * 0.9, L * 0.8], [rh, L * 0.84], [rh, L * 0.975], [rh * 0.86, L], [rh * 0.8, L]], 8, col, SATIN).to(ax);
    for (let i = 0; i < 4; i++) cyl(rb + 0.0016, rb + 0.0016, 0.011, 8, shade(col, 0.72), MATTE).at(0, L * (0.16 + i * 0.1), 0).to(ax);   // knurled grip bands
    cyl(rb + 0.0022, rb + 0.0022, 0.006, 8, acc, SATIN).at(0, L * 0.615, 0).to(ax);                                                   // accent ring
    cyl(rh + 0.0015, rh + 0.0015, 0.012, 8, shade(col, 1.25), METAL).at(0, L * 0.965, 0).to(ax);                                        // bezel
    slab(0.012, 0.02, 0.005, 0.004, acc, GLOSS).at(0, rb - 0.001, L * 0.5 - L / 2 + 0.01).to(g);                                        // switch (on top)
    torus(0.008, 0.0016, C.steel, { rs: 4, ts: 8, ...METAL }).rot(0, PI / 2, 0).at(0, 0, -L / 2 - 0.005).to(g);                         // lanyard ring
    const lens = keep(disc(rh * 0.8, 8, glo(on ? lc : '#1c232b', on ? 1.6 : 1), { up: false })).at(0, 0, L / 2 - 0.004).to(g);
    disc(rh * 0.8, 8, '#aeb7c0', { up: false, ...METAL }).at(0, 0, L / 2 - 0.0045).to(g);
    const halo = fx(flare(lc, 0.26, on ? 0.75 : 0)).at(0, 0, L / 2 + 0.005).to(g);
    // optional visible beam: an additive cone that fades with distance
    const bl = o.beamLength || 3.5, bg = new T.CylinderGeometry(rh * 0.8, bl * 0.24, bl, 14, 1, true), bc = new Float32Array(bg.attributes.position.count * 3), cc = new T.Color(lc);
    for (let i = 0; i < bg.attributes.position.count; i++) { const k = bg.attributes.position.getY(i) > 0 ? 1 : 0; bc[i * 3] = cc.r * k; bc[i * 3 + 1] = cc.g * k; bc[i * 3 + 2] = cc.b * k; }
    bg.setAttribute('color', new T.BufferAttribute(bc, 3)); bg.rotateX(-PI / 2); bg.translate(0, 0, bl / 2);
    const beam = fx(new T.Mesh(bg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false, fog: false }))); beam.position.z = L / 2; beam.castShadow = beam.receiveShadow = false; g.add(beam);
    const bo = socket(0, 0, L / 2).to(g), bt = socket(0, 0, L / 2 + 6).to(g);
    Object.assign(ud, { lens, halo, beam, beamOrigin: bo, beamTarget: bt, beamDir: [0, 0, 1], lightColor: lc, lights: [] });
    /** setOn(k): 0 = off, 1 = on. beam: opacity of the visible light cone (0 = none). */
    ud.setOn = (k, beamK = o.beam || 0) => { k = clamp(k); lens.material.color.set(k > 0.02 ? lc : '#1c232b').multiplyScalar(k > 0.02 ? 0.4 + 1.2 * k : 1); halo.material.opacity = 0.75 * k; beam.material.opacity = beamK * k; beam.visible = beamK * k > 0.002; ud.lights.forEach(l => { l.intensity = l.userData.base * k; }); ud.on = k; };
    ud.setOn(on ? 1 : 0);
    return { grip: [0, 0, -L * 0.14], hold: 'x z', aim: [0, 0, 1] };
  });
  alias('torch', 'flashlight');

  def('lantern', 'light', (o, g, ud) => {
    const col = o.color || '#3a4046', trim = o.trim || C.brass, on = o.on !== false, lc = o.lightColor || '#ffb24a';
    lathe([[0, 0], [0.06, 0], [0.068, 0.008], [0.068, 0.03], [0.054, 0.052], [0.032, 0.06], [0.032, 0.066]], 8, col, SATIN).to(g);                    // fuel tank
    cylB(0.034, 0.038, 0.02, 8, trim, METAL).at(0, 0.064, 0).to(g);                                                                                    // burner collar
    box(0.012, 0.008, 0.02, trim, METAL).at(0.045, 0.072, 0).to(g); cyl(0.006, 0.006, 0.004, 6, shade(trim, 0.8), METAL).rot(0, 0, PI / 2).at(0.058, 0.072, 0).to(g);   // wick knob
    lathe([[0.034, 0.214], [0.045, 0.222], [0.045, 0.232], [0.03, 0.248], [0.03, 0.258], [0.04, 0.264], [0.024, 0.28], [0, 0.284]], 8, col, SATIN).to(g);   // cap and chimney
    for (const sx of [-1, 1]) { tube([[sx * 0.058, 0.05, 0], [sx * 0.074, 0.11, 0], [sx * 0.074, 0.2, 0], [sx * 0.05, 0.245, 0]], 0.0035, shade(col, 1.15), { rs: 4, seg: 8, ...METAL }).to(g); }   // frame
    for (const y of [0.115, 0.185]) torus(0.06 - (y > 0.15 ? 0.004 : 0), 0.0022, shade(col, 1.2), { rs: 4, ts: 8, ...METAL }).rot(PI / 2, 0, 0).at(0, y, 0).to(g);                              // guard wires
    const glass = lathe([[0.034, 0.086], [0.05, 0.115], [0.055, 0.15], [0.048, 0.19], [0.034, 0.214]], 8, '#d9eef2', { opacity: 0.25, rough: 0.08, side: 'double' }).to(g); glass.renderOrder = 2;
    cylB(0.005, 0.007, 0.012, 5, '#2a2622').at(0, 0.084, 0).to(g);                                                                                     // wick
    const flame = flameOf(0.055, { haloSize: 9, haloOpacity: 0.55, halo: lc }).at(0, 0.094, 0).to(g);
    const core = keep(ball(0.03, glo(lc, 1.1, { opacity: 0.35, add: true }), 1)).at(0, 0.14, 0).to(g); fx(core);
    const handle = part(arcTube(0.076, 0.003, PI, shade(col, 1.2), { rs: 4, ts: 10, ...METAL }), cyl(0.008, 0.008, 0.05, 6, C.woodD).rot(0, 0, PI / 2).at(0, 0.076, 0)).at(0, 0.238, 0).to(g);
    if (o.handle === 'down') handle.rotation.x = 1.25;
    const la = socket(0, 0.13, 0).to(g);
    Object.assign(ud, { flame, glass, handle, lightAt: la, lightColor: lc, lights: [], on: on ? 1 : 0 });
    ud.setOn = k => { ud.on = clamp(k); flame.userData.set(ud.on); core.material.opacity = 0.35 * ud.on; core.visible = ud.on > 0.01; ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on; }); };
    ud.update = t => { if (ud.on <= 0.01) return; const f = flame.userData.flick(t, 0.6); core.material.opacity = 0.35 * ud.on * (0.9 + 0.1 * f); ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on * (0.86 + 0.14 * f); }); };
    ud.setOn(on ? 1 : 0);
    return { grip: [0, 0.314, 0], hold: 'x y', anchor: 'floor' };
  });

  def('candle', 'light', (o, g, ud) => {
    const style = o.style || 'taper', wax = o.color || '#efe6cf', lit = o.lit !== false, lc = o.lightColor || '#ffb24a', r = rng(o.seed || 3);
    const rad = style === 'pillar' ? 0.033 : style === 'tea' ? 0.019 : 0.0115, h = o.height || (style === 'pillar' ? 0.11 : style === 'tea' ? 0.012 : 0.16);
    let y0 = 0;
    if (style === 'taper' && o.holder !== false) {
      const hc = o.holderColor || C.brass;
      lathe([[0, 0], [0.04, 0], [0.056, 0.007], [0.06, 0.016], [0.055, 0.016], [0.05, 0.01], [0.02, 0.006], [0.02, 0.011], [0.017, 0.03], [0.012, 0.03], [0.012, 0.012], [0, 0.012]], 10, hc, METAL).to(g);
      torus(0.013, 0.0032, hc, { rs: 4, ts: 8, ...METAL }).rot(0, PI / 2, 0).at(0, 0.02, -0.068).to(g);     // finger ring at the back
      y0 = 0.012;
    } else if (style === 'pillar' && o.holder !== false) { lathe([[0, 0], [0.05, 0], [0.055, 0.004], [0.055, 0.008], [0, 0.008]], 10, o.holderColor || '#4a4d55', SATIN).to(g); y0 = 0.008; }
    else if (style === 'tea') { lathe([[0, 0], [0.019, 0], [0.0205, 0.016], [0.0195, 0.016], [0.0195, 0.002]], 8, '#c9ced6', METAL).to(g); y0 = 0.002; }
    lathe([[0, 0], [rad * 1.05, 0], [rad, h * 0.5], [rad * 0.94, h], [rad * 0.5, h - rad * 0.25], [0, h - rad * 0.3]], style === 'taper' ? 7 : 10, wax, { rough: 0.6, vary: 0.04 }).at(0, y0, 0).to(g);
    if (style !== 'tea') for (let i = 0; i < 3; i++) { const a = r() * TAU, len = h * (0.12 + r() * 0.25), rr = rad * (0.24 + r() * 0.14); cylB(rr * 0.7, rr, len, 4, wax, { rough: 0.6 }).at(cos(a) * rad * 0.97, y0 + h - len - rad * 0.2, sin(a) * rad * 0.97).to(g); ball(rr * 1.15, wax, 0, { rough: 0.6 }).at(cos(a) * rad * 0.99, y0 + h - len - rad * 0.2, sin(a) * rad * 0.99).to(g); }
    const wy = y0 + h - rad * 0.3; cylB(0.0012, 0.0012, 0.008, 4, '#2a2622').at(0, wy, 0).to(g);
    const fh = style === 'tea' ? 0.022 : style === 'pillar' ? 0.036 : 0.032, flame = flameOf(fh, { seed: o.seed || 1, haloSize: 8 }).at(0, wy + 0.004, 0).to(g);
    const la = socket(0, wy + fh * 0.6, 0).to(g);
    Object.assign(ud, { flame, lightAt: la, lightColor: lc, lights: [], on: lit ? 1 : 0 });
    ud.setLit = k => { ud.on = clamp(k); flame.userData.set(ud.on); ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on; }); };
    ud.update = t => { if (ud.on <= 0.01) return; const f = flame.userData.flick(t); ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on * (0.82 + 0.18 * f); }); };
    ud.setLit(lit ? 1 : 0);
    return { grip: style === 'taper' && o.holder !== false ? [0, 0.02, -0.068] : [0, y0 + h * 0.3, 0], hold: 'x z', anchor: 'floor' };
  });

  def('glowStick', 'light', (o, g, ud) => {
    const col = o.color || '#8dff4a', on = o.on !== false, L = o.length || 0.15;
    const ax = grp().rot(0, 0, -PI / 2).to(g);                         // model along +Y, lay along +X
    const stick = keep(cyl(0.0075, 0.0075, L, 6, glo(col, on ? 1.5 : 0.35))).at(0, L / 2, 0).to(ax);
    cyl(0.0088, 0.0088, 0.014, 6, shade(col, 0.45), GLOSS).at(0, 0.007, 0).to(ax); cyl(0.006, 0.0075, 0.006, 6, shade(col, 0.6), GLOSS).at(0, L + 0.003, 0).to(ax);
    torus(0.006, 0.0014, shade(col, 0.4), { rs: 4, ts: 6 }).at(0, -0.005, 0).to(ax);
    const h1 = fx(flare(col, 0.2, on ? 0.5 : 0)).at(0, L * 0.3, 0).to(ax), h2 = fx(flare(col, 0.2, on ? 0.5 : 0)).at(0, L * 0.75, 0).to(ax);
    const la = socket(0, L / 2, 0).to(ax);
    Object.assign(ud, { stick, lightAt: la, lightColor: col, lights: [], on: on ? 1 : 0 });
    ud.setOn = k => { ud.on = clamp(k); stick.material.color.set(col).multiplyScalar(0.35 + 1.15 * ud.on); h1.material.opacity = h2.material.opacity = 0.5 * ud.on; ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on; }); };
    return { grip: [L * 0.35, 0, 0], hold: 'z y' };
  });

  def('match', 'light', (o, g, ud) => {
    const L = o.length || 0.065, lit = o.lit !== false, burnt = o.burnt ?? 0.18;
    box(L * (1 - burnt), 0.003, 0.003, '#d9c08f', { vary: 0.05 }).at(-L * burnt / 2, 0, 0).to(g); box(L * burnt, 0.0028, 0.0028, '#2b2420').at(L * (1 - burnt) / 2, 0, 0).to(g);
    blob(0.0042, lit ? '#3a2a24' : '#a8322a', 2, { squash: [1.25, 1, 1], detail: 0 }).at(L / 2, 0, 0).to(g);
    const flame = flameOf(0.026, { seed: o.seed || 2, haloSize: 7 }).at(L / 2 - 0.003, 0.002, 0).to(g), la = socket(L / 2, 0.02, 0).to(g);
    Object.assign(ud, { flame, lightAt: la, lightColor: '#ffb24a', lights: [], on: lit ? 1 : 0 });
    ud.setLit = k => { ud.on = clamp(k); flame.userData.set(ud.on); ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on; }); };
    ud.update = t => { if (ud.on <= 0.01) return; const f = flame.userData.flick(t, 1.2); ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on * (0.8 + 0.2 * f); }); };
    ud.setLit(lit ? 1 : 0);
    return { grip: [-L * 0.36, 0, 0], hold: 'z y' };
  });

  def('fireTorch', 'light', (o, g, ud) => {
    const L = o.length || 0.6, lit = o.lit !== false, lc = o.lightColor || '#ff9a3a', r = rng(o.seed || 5);
    cylB(0.02, 0.015, L * 0.78, 6, o.color || C.woodD, { vary: 0.08, jitter: 0.0015 }).to(g);
    lathe([[0, 0], [0.026, 0.004], [0.036, 0.03], [0.038, 0.07], [0.03, 0.1], [0.012, 0.118], [0, 0.12]], 7, '#2b2622', { vary: 0.14, rough: 1 }).at(0, L * 0.74, 0).to(g);   // tarred wrap
    for (const y of [0.012, 0.085]) cyl(0.034 - (y > 0.05 ? 0.002 : 0.006), 0.036 - (y > 0.05 ? 0.004 : 0.008), 0.012, 7, '#8a7650', { vary: 0.1 }).at(0, L * 0.74 + y, 0).to(g);
    for (const y of [0.1, 0.18]) cyl(0.0185, 0.019, 0.016, 6, '#57422e').at(0, L * y, 0).to(g);                                                                               // leather grip bands
    const fl = part().at(0, L * 0.8, 0).to(g), fs = [];
    [[0, 0, 0.2, 1], [0.02, 0.012, 0.14, 2], [-0.018, -0.014, 0.15, 3], [-0.012, 0.02, 0.11, 4]].forEach(([x, z, h, s], i) => { const f = flameOf(h, { seed: (o.seed || 5) + s, fat: 0.26, haloSize: i ? 0 : 6, haloOpacity: i ? 0 : 0.5, halo: lc }).at(x, 0.02 + (i ? 0.01 : 0), z); if (i) f.userData.halo.visible = false; fl.add(f); fs.push(f); });
    const la = socket(0, L * 0.8 + 0.12, 0).to(g);
    Object.assign(ud, { flame: fl, flames: fs, lightAt: la, lightColor: lc, lights: [], on: lit ? 1 : 0 });
    ud.setLit = k => { ud.on = clamp(k); fs.forEach(f => f.userData.set(ud.on)); if (ud.on > 0.01) fs.forEach((f, i) => { if (i) f.userData.halo.visible = false; }); ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on; }); };
    ud.update = t => { if (ud.on <= 0.01) return; let f = 1; fs.forEach((q, i) => { const v = q.userData.flick(t * (1 + i * 0.13), 1.5); if (!i) f = v; }); ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on * (0.78 + 0.22 * f); }); };
    ud.setLit(lit ? 1 : 0);
    return { grip: [0, L * 0.16, 0], hold: 'x z', anchor: 'floor', poses: { lying: { rot: [0, 0, -PI / 2] } } };
  });

  // ==== MORE BUILDERS ====

  // ---------- helpers for film teams ----------
  /** Grip at the origin, turned for a hand (same as prop.userData.held(which)). */
  const held = (prop, which = true) => prop.userData.held(which);
  /** Back to the rest pose (standing on y = 0). */
  const rest = prop => prop.userData.held(false);
  /** Tell the kit how the rig's hand joint is turned relative to "arm hanging, +Y up the arm, +Z forward": Euler [x, y, z]. Applies to props held afterwards. */
  const setHandFrame = (rx = 0, ry = 0, rz = 0) => { HAND = new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)); };
  /** Keep a carried prop upright in the world whatever the arm does (lantern, bag, drink, balloon). Call every frame after posing. yaw = heading of its front. */
  function level(prop, yaw = 0) {
    const body = prop.children[0], par = prop.parent; _q1.identity(); if (par) par.getWorldQuaternion(_q1);
    _q2.setFromAxisAngle(UP, yaw).multiply(_q3.copy(body.quaternion).invert()); prop.quaternion.copy(_q1.invert().multiply(_q2)); return prop;
  }
  /** Turn a prop (held or not) so its front (flashlight beam, camera lens, phone screen ...) faces a world point. Call every frame after posing. */
  function point(prop, target, roll = 0) {
    const body = prop.children[0], ud = prop.userData, par = prop.parent; _q1.identity(); if (par) par.getWorldQuaternion(_q1); prop.updateWorldMatrix(true, false);
    const f = _v1.copy(S3.V(target)).sub(_v2.setFromMatrixPosition(prop.matrixWorld)).normalize(), up = abs(f.y) > 0.98 ? _v2.set(0, 0, f.y > 0 ? -1 : 1) : _v2.copy(UP), rw = _v3.crossVectors(up, f).normalize(), uw = up.crossVectors(f, rw);
    const Mw = new T.Matrix4().makeBasis(rw.clone(), uw.clone(), f.clone());
    const a = ud.aim.clone().normalize(), rb = V3().crossVectors(ud.top, a).normalize(), tb = V3().crossVectors(a, rb), Mb = new T.Matrix4().makeBasis(rb, tb, a);
    _q2.setFromRotationMatrix(Mw.multiply(Mb.transpose())); if (roll) _q2.multiply(_q3.setFromAxisAngle(a, roll));
    prop.quaternion.copy(_q1.invert().multiply(_q2).multiply(_q3.copy(body.quaternion).invert())); return prop;
  }
  /** Create the light a prop gives off and attach it: a spot for a flashlight (follows the beam), a point light for flames and lamps. o: {color, intensity, range, angle, shadow}. The prop's setOn / setLit / update then drive its intensity. */
  function light(s, prop, o = {}) {
    const ud = prop.userData; let l = null;
    if (ud.beamOrigin) { l = s.spot([0, 0, 0], [0, 0, 1], o.color || ud.lightColor, o.intensity ?? 1.2, o.range ?? 14, o.angle ?? 36, { shadow: !!o.shadow, penumbra: o.penumbra ?? 0.6 }); ud.beamOrigin.add(l); l.position.set(0, 0, 0); ud.beamTarget.add(l.target); l.target.position.set(0, 0, 0); }
    else if (ud.lightAt) { l = s.point([0, 0, 0], o.color || ud.lightColor || '#ffb24a', o.intensity ?? 0.6, o.range ?? 6); ud.lightAt.add(l); l.position.set(0, 0, 0); }
    if (l) { (ud.lights || (ud.lights = [])).push(l); l.intensity = l.userData.base * (ud.on ?? 1); }
    return l;
  }
  /** Run every prop's own animation (flames, blinking LEDs, clock hands, swaying balloons) each frame: KitProps.animate(s, candle, lantern). */
  const animate = (s, ...props) => { const list = props.flat().filter(p => p && p.userData.update); s.tick(lt => { for (const p of list) p.userData.update(lt); }); return list; };
  /** Replace a prop's built-in screen picture with one redrawn every frame: draw(ctx, lt, t, pxW, pxH). Returns the screen mesh. */
  function liveScreen(s, prop, draw, o = {}) { const ud = prop.userData, sc = ud.screen; if (!sc) return null; const [w, h] = ud.screenSize, ppm = o.ppm || ud.screenPpm || 2400, q = s.screen(w, h, Math.round(w * ppm), Math.round(h * ppm), draw); sc.material = q.material; return sc; }

  return { ...B, held, rest, level, point, light, animate, liveScreen, setHandFrame, list: () => Object.keys(B), meta: META, tris, palette: C, flame: flameOf };
})();
