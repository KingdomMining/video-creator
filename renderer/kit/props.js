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
    const halo = fx(flare(lc, 0.13, on ? 0.9 : 0)).at(0, 0, L / 2 + 0.004).to(g);
    // optional visible beam: an additive cone that fades with distance
    const bl = o.beamLength || 3.5, bg = new T.CylinderGeometry(rh * 0.8, bl * 0.24, bl, 14, 1, true), bc = new Float32Array(bg.attributes.position.count * 3), cc = new T.Color(lc);
    for (let i = 0; i < bg.attributes.position.count; i++) { const k = bg.attributes.position.getY(i) > 0 ? 1 : 0; bc[i * 3] = cc.r * k; bc[i * 3 + 1] = cc.g * k; bc[i * 3 + 2] = cc.b * k; }
    bg.setAttribute('color', new T.BufferAttribute(bc, 3)); bg.rotateX(-PI / 2); bg.translate(0, 0, bl / 2);
    const beam = fx(new T.Mesh(bg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false, fog: false }))); beam.position.z = L / 2; beam.castShadow = beam.receiveShadow = false; g.add(beam);
    const bo = socket(0, 0, L / 2).to(g), bt = socket(0, 0, L / 2 + 6).to(g);
    Object.assign(ud, { lens, halo, beam, beamOrigin: bo, beamTarget: bt, beamDir: [0, 0, 1], lightColor: lc, lights: [] });
    /** setOn(k): 0 = off, 1 = on. beam: opacity of the visible light cone (0 = none). */
    ud.setOn = (k, beamK = o.beam || 0) => { k = clamp(k); lens.material.color.set(k > 0.02 ? lc : '#1c232b').multiplyScalar(k > 0.02 ? 0.4 + 1.2 * k : 1); halo.material.opacity = 0.9 * k; beam.material.opacity = beamK * k; beam.visible = beamK * k > 0.002; ud.lights.forEach(l => { l.intensity = l.userData.base * k; }); ud.on = k; };
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
    const flame = flameOf(0.055, { haloSize: 5.5, haloOpacity: 0.5, halo: lc }).at(0, 0.094, 0).to(g);
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

  // =====================================================================================================
  // SCREENS: pictures for phones, tablets, laptops and monitors. scr.name(ctx, w, h, o) works at any size.
  // =====================================================================================================
  const scr = {
    off(c, w, h) { c.fillStyle = '#06080b'; c.fillRect(0, 0, w, h); const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0.3, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.08)'); g.addColorStop(0.7, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); },
    wall(c, w, h, o = {}) { const g = c.createLinearGradient(0, 0, w * 0.5, h); g.addColorStop(0, o.bg0 || '#16254a'); g.addColorStop(0.55, o.bg1 || '#54376b'); g.addColorStop(1, o.bg2 || '#e2805a'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(8,10,28,.4)'; c.beginPath(); c.moveTo(0, h * 0.82); c.quadraticCurveTo(w * 0.3, h * 0.66, w * 0.62, h * 0.8); c.quadraticCurveTo(w * 0.85, h * 0.9, w, h * 0.74); c.lineTo(w, h); c.lineTo(0, h); c.fill(); c.fillStyle = 'rgba(255,240,210,.85)'; c.beginPath(); c.arc(w * 0.72, h * 0.6, min(w, h) * 0.07, 0, 7); c.fill(); },
    status(c, w, h, o = {}) { const u = min(w, h) / 100; txt(c, o.time || '23:47', 7 * u, 5.5 * u, `600 ${4.6 * u}px Inter`, '#fff', 'left'); c.fillStyle = '#fff'; for (let i = 0; i < 4; i++) c.fillRect(w - 26 * u + i * 2.4 * u, 7 * u - i * 0.9 * u, 1.6 * u, 1.5 * u + i * 0.9 * u); c.strokeStyle = '#fff'; c.lineWidth = 0.5 * u; c.strokeRect(w - 14 * u, 3.6 * u, 8 * u, 4 * u); c.fillRect(w - 13.3 * u, 4.3 * u, (o.battery ?? 0.3) * 6.6 * u, 2.6 * u); },
    lock(c, w, h, o = {}) { const u = min(w, h) / 100; scr.wall(c, w, h, o); scr.status(c, w, h, o); txt(c, o.time || '23:47', w / 2, h * 0.2, `300 ${27 * u}px Inter`, '#fff'); txt(c, o.date || 'Friday 13 October', w / 2, h * 0.2 + 19 * u, `500 ${5.6 * u}px Inter`, 'rgba(255,255,255,.9)');
      if (o.text) { const bw = w - 12 * u, by = h * 0.46; c.fillStyle = 'rgba(245,247,250,.92)'; R2(c, 6 * u, by, bw, 30 * u, 5 * u); c.fill(); c.fillStyle = '#2f7bff'; R2(c, 10 * u, by + 4 * u, 8 * u, 8 * u, 2 * u); c.fill(); txt(c, o.from || 'Unknown', 21 * u, by + 8 * u, `700 ${5.2 * u}px Inter`, '#10141c', 'left'); c.font = `500 ${5 * u}px Inter`; wrapT(c, o.text, bw - 12 * u).slice(0, 2).forEach((l, i) => txt(c, l, 10 * u, by + 17.5 * u + i * 6.4 * u, `500 ${5 * u}px Inter`, '#1c222c', 'left')); }
      c.fillStyle = 'rgba(255,255,255,.8)'; R2(c, w / 2 - 16 * u, h - 5 * u, 32 * u, 1.4 * u, 0.7 * u); c.fill(); },
    call(c, w, h, o = {}) { const u = min(w, h) / 100, g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1c2433'); g.addColorStop(1, '#07090d'); c.fillStyle = g; c.fillRect(0, 0, w, h); scr.status(c, w, h, o);
      c.fillStyle = '#39445a'; c.beginPath(); c.arc(w / 2, h * 0.3, 17 * u, 0, 7); c.fill(); c.fillStyle = '#8f9bb3'; c.beginPath(); c.arc(w / 2, h * 0.3 - 4 * u, 6.5 * u, 0, 7); c.fill(); c.beginPath(); c.arc(w / 2, h * 0.3 + 14 * u, 11 * u, PI, 0); c.fill();
      c.font = `700 ${10 * u}px Inter`; fitFont(c, o.caller || 'UNKNOWN', w - 14 * u, 10 * u, '700 $px Inter'); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(o.caller || 'UNKNOWN', w / 2, h * 0.3 + 30 * u); txt(c, o.sub || 'incoming call…', w / 2, h * 0.3 + 40 * u, `500 ${5.2 * u}px Inter`, '#9fb0c8');
      [['#e5484d', 0.27, 2.36], ['#3cc96a', 0.73, 0.6]].forEach(([col, x, a]) => { c.fillStyle = col; c.beginPath(); c.arc(w * x, h * 0.83, 11 * u, 0, 7); c.fill(); c.save(); c.translate(w * x, h * 0.83); c.rotate(a); c.fillStyle = '#fff'; R2(c, -6.5 * u, -1.6 * u, 13 * u, 3.2 * u, 1.6 * u); c.fill(); R2(c, -7 * u, -1.6 * u, 4 * u, 5 * u, 1.4 * u); c.fill(); R2(c, 3 * u, -1.6 * u, 4 * u, 5 * u, 1.4 * u); c.fill(); c.restore(); }); },
    chat(c, w, h, o = {}) { const u = min(w, h) / 100; c.fillStyle = o.dark === false ? '#f3f4f6' : '#0d1016'; c.fillRect(0, 0, w, h); c.fillStyle = o.dark === false ? '#ffffff' : '#171b24'; c.fillRect(0, 0, w, 22 * u); scr.status(c, w, h, o); c.fillStyle = '#5b6b8a'; c.beginPath(); c.arc(11 * u, 15 * u, 4.4 * u, 0, 7); c.fill(); txt(c, o.name || 'Unknown number', 18.5 * u, 15.2 * u, `700 ${5.4 * u}px Inter`, o.dark === false ? '#111' : '#fff', 'left');
      const msgs = (o.messages || ['Are you home?', '>Who is this?', 'Look outside.']).map(m => typeof m === 'string' ? (m[0] === '>' ? { t: m.slice(1), me: true } : { t: m }) : m), fs = (o.fontSize || 5.6) * u, lh = fs * 1.22, maxW = w * 0.68; c.font = `500 ${fs}px Inter`;
      const lay = msgs.map(m => { const ls = wrapT(c, m.t, maxW); return { m, ls, bw: max(...ls.map(l => c.measureText(l).width)) + 7 * u, bh: ls.length * lh + 5 * u }; }); let tot = lay.reduce((s, b) => s + b.bh + 3 * u, 0), y = max(26 * u, h - 16 * u - tot); if (tot < h - 44 * u) y = 27 * u;
      lay.forEach(b => { const x = b.m.me ? w - 5 * u - b.bw : 5 * u; c.fillStyle = b.m.me ? '#2f7bff' : (o.dark === false ? '#e3e6ea' : '#262c38'); R2(c, x, y, b.bw, b.bh, 3.6 * u); c.fill(); b.ls.forEach((l, i) => txt(c, l, x + 3.5 * u, y + 2.5 * u + lh * (i + 0.5), `500 ${fs}px Inter`, b.m.me || o.dark !== false ? '#fff' : '#111', 'left')); y += b.bh + 3 * u; });
      c.fillStyle = o.dark === false ? '#ffffff' : '#171b24'; c.fillRect(0, h - 14 * u, w, 14 * u); c.fillStyle = o.dark === false ? '#e9ebee' : '#262c38'; R2(c, 5 * u, h - 11.5 * u, w - 22 * u, 8 * u, 4 * u); c.fill(); c.fillStyle = '#2f7bff'; c.beginPath(); c.arc(w - 9.5 * u, h - 7.5 * u, 4.2 * u, 0, 7); c.fill(); },
    alert(c, w, h, o = {}) { const u = min(w, h) / 100, col = o.color || '#ffcc33'; c.fillStyle = '#0b0c10'; c.fillRect(0, 0, w, h); c.fillStyle = col; c.fillRect(0, 0, w, 3 * u); c.fillRect(0, h - 3 * u, w, 3 * u); const cy = h * 0.27; c.beginPath(); c.moveTo(w / 2, cy - 15 * u); c.lineTo(w / 2 + 17 * u, cy + 13 * u); c.lineTo(w / 2 - 17 * u, cy + 13 * u); c.closePath(); c.fill(); c.fillStyle = '#0b0c10'; c.fillRect(w / 2 - 1.7 * u, cy - 6 * u, 3.4 * u, 11 * u); c.fillRect(w / 2 - 1.7 * u, cy + 7 * u, 3.4 * u, 3.4 * u);
      textBox(c, o.title || 'EMERGENCY ALERT', 6 * u, cy + 18 * u, w - 12 * u, 20 * u, '800 $px Inter', col, 9 * u); textBox(c, o.text || 'Stay indoors. Lock your doors. Do not go outside.', 8 * u, cy + 40 * u, w - 16 * u, h - cy - 56 * u, '500 $px Inter', '#f2f3f5', 6.4 * u, { lh: 1.3 }); },
    home(c, w, h, o = {}) { const u = min(w, h) / 100, r = rng(o.seed || 4), cols = w > h ? 6 : 4, cw = w / cols, pal = ['#2f7bff', '#3cc96a', '#ffb23f', '#e5484d', '#9b6bff', '#18b7c9', '#f2f3f5', '#ff7a45']; scr.wall(c, w, h, o); scr.status(c, w, h, o);
      for (let j = 0; j < (w > h ? 3 : 5); j++) for (let i = 0; i < cols; i++) { if (r() < 0.12) continue; const s = min(cw * 0.56, 15 * u), x = cw * (i + 0.5) - s / 2, y = 14 * u + j * s * 1.62; c.fillStyle = pal[flr(r() * pal.length)]; R2(c, x, y, s, s, s * 0.26); c.fill(); c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath(); c.arc(x + s / 2, y + s / 2, s * 0.2, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.8)'; c.fillRect(x + s * 0.1, y + s * 1.16, s * 0.8, s * 0.1); }
      c.fillStyle = 'rgba(255,255,255,.2)'; R2(c, 5 * u, h - 22 * u, w - 10 * u, 18 * u, 6 * u); c.fill(); },
    map(c, w, h, o = {}) { const u = min(w, h) / 100, r = rng(o.seed || 9), dk = !!o.dark; c.fillStyle = dk ? '#18202b' : '#e8e2d4'; c.fillRect(0, 0, w, h); c.fillStyle = dk ? '#1f3b33' : '#bfdcae'; for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(r() * w, r() * h, (10 + r() * 16) * u, (8 + r() * 12) * u, r() * 3, 0, 7); c.fill(); }
      c.strokeStyle = dk ? '#27506e' : '#9cc7e6'; c.lineWidth = 9 * u; c.beginPath(); c.moveTo(-5 * u, h * 0.2); c.bezierCurveTo(w * 0.4, h * 0.3, w * 0.5, h * 0.6, w + 5 * u, h * 0.72); c.stroke();
      c.strokeStyle = dk ? '#39475c' : '#ffffff'; for (let i = 0; i < 9; i++) { c.lineWidth = (i % 3 ? 1.6 : 3.2) * u; const a = (i % 2 ? 0.12 : -0.08), p = (i + 0.5) / 9; c.beginPath(); c.moveTo(-w * 0.1, h * p - w * a); c.lineTo(w * 1.1, h * p + w * a); c.stroke(); c.beginPath(); c.moveTo(w * p + h * a * 0.5, -5); c.lineTo(w * p - h * a * 0.5, h + 5); c.stroke(); }
      const p0 = [w * 0.24, h * 0.8], p1 = o.pin ? [w * o.pin[0], h * o.pin[1]] : [w * 0.68, h * 0.3]; c.strokeStyle = '#2f7bff'; c.lineWidth = 2.6 * u; c.lineJoin = 'round'; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p0[0], (p0[1] + p1[1]) / 2); c.lineTo(p1[0], (p0[1] + p1[1]) / 2); c.lineTo(p1[0], p1[1]); c.stroke(); c.fillStyle = '#2f7bff'; c.beginPath(); c.arc(p0[0], p0[1], 3.4 * u, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = u; c.stroke();
      c.fillStyle = '#e5484d'; c.beginPath(); c.arc(p1[0], p1[1] - 6 * u, 4.6 * u, 0, 7); c.fill(); c.beginPath(); c.moveTo(p1[0] - 3.6 * u, p1[1] - 3.4 * u); c.lineTo(p1[0] + 3.6 * u, p1[1] - 3.4 * u); c.lineTo(p1[0], p1[1] + 1.5 * u); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(p1[0], p1[1] - 6 * u, 1.7 * u, 0, 7); c.fill();
      if (o.text) { c.fillStyle = dk ? 'rgba(12,16,22,.9)' : 'rgba(255,255,255,.94)'; R2(c, 5 * u, h - 20 * u, w - 10 * u, 15 * u, 4 * u); c.fill(); textBox(c, o.text, 9 * u, h - 20 * u, w - 18 * u, 15 * u, '700 $px Inter', dk ? '#fff' : '#111', 5.6 * u); } },
    desktop(c, w, h, o = {}) { const u = min(w, h) / 100; scr.wall(c, w, h, { bg0: '#14213f', bg1: '#2c4a7c', bg2: '#5aa0c8', ...o }); c.fillStyle = 'rgba(8,10,16,.82)'; c.fillRect(0, h - 7 * u, w, 7 * u); for (let i = 0; i < 6; i++) { c.fillStyle = ['#2f7bff', '#3cc96a', '#ffb23f', '#e5484d', '#9b6bff', '#f2f3f5'][i]; R2(c, 3 * u + i * 6.5 * u, h - 5.8 * u, 4.6 * u, 4.6 * u, u); c.fill(); } txt(c, o.time || '23:47', w - 4 * u, h - 3.4 * u, `600 ${3.4 * u}px Inter`, '#fff', 'right');
      const win = (x, y, ww, hh, bar, body) => { c.fillStyle = 'rgba(0,0,0,.3)'; R2(c, x + u, y + 1.5 * u, ww, hh, 2 * u); c.fill(); c.fillStyle = body; R2(c, x, y, ww, hh, 2 * u); c.fill(); c.fillStyle = bar; R2(c, x, y, ww, 5 * u, 2 * u); c.fill(); c.fillRect(x, y + 3 * u, ww, 2 * u); ['#e5484d', '#ffb23f', '#3cc96a'].forEach((k, i) => { c.fillStyle = k; c.beginPath(); c.arc(x + 3 * u + i * 3 * u, y + 2.5 * u, 0.9 * u, 0, 7); c.fill(); }); };
      win(w * 0.07, h * 0.1, w * 0.52, h * 0.62, '#d9dde3', '#f6f7f9'); greek(c, w * 0.1, h * 0.22, w * 0.46, 9, 4.6 * u, '#9aa3b0', 3); win(w * 0.5, h * 0.3, w * 0.42, h * 0.5, '#20242c', '#11141a'); greek(c, w * 0.53, h * 0.4, w * 0.36, 7, 4.4 * u, '#3cc96a', 5);
      if (o.text) { c.fillStyle = 'rgba(255,255,255,.96)'; R2(c, w * 0.2, h * 0.34, w * 0.6, h * 0.3, 2 * u); c.fill(); textBox(c, o.text, w * 0.23, h * 0.36, w * 0.54, h * 0.26, '700 $px Inter', '#111', 7 * u); } },
    code(c, w, h, o = {}) { const u = min(w, h) / 100, r = rng(o.seed || 7), pal = ['#7fd4ff', '#c3e88d', '#f78c6c', '#c792ea', '#d6deeb', '#ffcb6b']; c.fillStyle = '#0d1117'; c.fillRect(0, 0, w, h); c.fillStyle = '#161b22'; c.fillRect(0, 0, w * 0.17, h); c.fillRect(0, 0, w, 6 * u); greek(c, 2 * u, 10 * u, w * 0.13, 12, 5 * u, '#4b5565', 2, 0.35);
      for (let i = 0; i < flr((h - 12 * u) / (4.6 * u)); i++) { let x = w * 0.2 + flr(r() * 4) * 3 * u; const n = 1 + flr(r() * 5); if (r() < 0.14) continue; for (let k = 0; k < n; k++) { const ww = (3 + r() * 13) * u; c.fillStyle = pal[flr(r() * pal.length)]; c.fillRect(x, 10 * u + i * 4.6 * u, ww, 2 * u); x += ww + 1.6 * u; if (x > w * 0.92) break; } } },
    terminal(c, w, h, o = {}) { const u = min(w, h) / 100, col = o.color || '#49f28a', lines = o.lines || ['> connect 10.4.7.31', 'handshake ok', '> bypass --door 3', 'ACCESS GRANTED', '> _']; c.fillStyle = '#04080a'; c.fillRect(0, 0, w, h); const fs = min(6.2 * u, (h - 10 * u) / (lines.length * 1.35)); lines.forEach((l, i) => { c.font = `700 ${fs}px "Share Tech Mono", monospace`; c.fillStyle = col; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(l, 5 * u, 8 * u + i * fs * 1.35, w - 10 * u); }); },
    cctv(c, w, h, o = {}) { const u = min(w, h) / 100, r = rng(o.seed || 12); c.fillStyle = '#05070a'; c.fillRect(0, 0, w, h); for (let k = 0; k < 4; k++) { const x = (k % 2) * w / 2 + u, y = flr(k / 2) * h / 2 + u, ww = w / 2 - 2 * u, hh = h / 2 - 2 * u, g = c.createLinearGradient(x, y, x, y + hh); g.addColorStop(0, '#27323a'); g.addColorStop(1, '#3d4a50'); c.fillStyle = g; c.fillRect(x, y, ww, hh);
        c.fillStyle = '#566469'; c.beginPath(); c.moveTo(x, y + hh); c.lineTo(x + ww * 0.3, y + hh * 0.45); c.lineTo(x + ww * 0.7, y + hh * 0.45); c.lineTo(x + ww, y + hh); c.fill(); c.fillStyle = '#1b2227'; c.fillRect(x + ww * (0.36 + r() * 0.1), y + hh * 0.2, ww * 0.16, hh * 0.25); if (k === (o.figure ?? 2)) { c.fillStyle = '#0b0e10'; c.fillRect(x + ww * 0.58, y + hh * 0.42, ww * 0.06, hh * 0.3); c.beginPath(); c.arc(x + ww * 0.61, y + hh * 0.38, ww * 0.035, 0, 7); c.fill(); }
        txt(c, 'CAM 0' + (k + 1), x + 2 * u, y + 4 * u, `700 ${3.6 * u}px "Share Tech Mono", monospace`, '#e8f0f2', 'left'); c.fillStyle = '#e5484d'; c.beginPath(); c.arc(x + ww - 3.4 * u, y + 4 * u, 1.3 * u, 0, 7); c.fill(); txt(c, o.time || '03:07:41', x + ww - 2 * u, y + hh - 3.4 * u, `700 ${3.2 * u}px "Share Tech Mono", monospace`, '#e8f0f2', 'right'); }
      c.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1.4); },
    login(c, w, h, o = {}) { const u = min(w, h) / 100; scr.wall(c, w, h, { bg0: '#0c1322', bg1: '#162a48', bg2: '#27506e', ...o }); c.fillStyle = 'rgba(255,255,255,.14)'; c.beginPath(); c.arc(w / 2, h * 0.32, 11 * u, 0, 7); c.fill(); c.fillStyle = '#dfe6ee'; c.beginPath(); c.arc(w / 2, h * 0.32 - 3 * u, 4.2 * u, 0, 7); c.fill(); c.beginPath(); c.arc(w / 2, h * 0.32 + 9 * u, 7 * u, PI, 0); c.fill();
      txt(c, o.title || 'ENTER PASSWORD', w / 2, h * 0.32 + 20 * u, `700 ${5.2 * u}px Inter`, '#fff'); c.fillStyle = 'rgba(255,255,255,.92)'; R2(c, w / 2 - 26 * u, h * 0.32 + 27 * u, 52 * u, 10 * u, 2 * u); c.fill(); c.fillStyle = '#111'; const n = o.dots ?? 5; for (let i = 0; i < n; i++) { c.beginPath(); c.arc(w / 2 - 21 * u + i * 5 * u, h * 0.32 + 32 * u, 1.5 * u, 0, 7); c.fill(); } if (o.text) txt(c, o.text, w / 2, h * 0.32 + 45 * u, `700 ${4.6 * u}px Inter`, o.color || '#ff6b6b'); },
    countdown(c, w, h, o = {}) { const u = min(w, h) / 100, col = o.color || '#ff3b2f'; c.fillStyle = '#060607'; c.fillRect(0, 0, w, h); if (o.title) txt(c, o.title, w / 2, h * 0.24, `700 ${6 * u}px Inter`, rgba(col, 0.85)); const s = fitFont(c, o.text || '00:59', w * 0.84, 40 * u, '700 $px "Share Tech Mono", monospace'); c.shadowColor = col; c.shadowBlur = s * 0.25; txt(c, o.text || '00:59', w / 2, h * 0.52, c.font, col); c.shadowBlur = 0; },
    access(c, w, h, o = {}) { const u = min(w, h) / 100, ok = !!o.granted, col = o.color || (ok ? '#3cf08a' : '#ff3b2f'); c.fillStyle = ok ? '#04140b' : '#170506'; c.fillRect(0, 0, w, h); c.strokeStyle = col; c.lineWidth = 1.6 * u; c.strokeRect(4 * u, 4 * u, w - 8 * u, h - 8 * u); c.shadowColor = col; c.shadowBlur = 5 * u; textBox(c, o.text || (ok ? 'ACCESS GRANTED' : 'ACCESS DENIED'), 8 * u, h * 0.3, w - 16 * u, h * 0.4, '700 $px "Share Tech Mono", monospace', col, 16 * u); c.shadowBlur = 0; },
    static(c, w, h, o = {}) { const r = rng(o.seed || 21), n = 5; for (let y = 0; y < h; y += n) for (let x = 0; x < w; x += n) { const v = flr(30 + r() * 200); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, y, n, n); } c.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < h; y += 6) c.fillRect(0, y, w, 2); },
    photo(c, w, h, o = {}) { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f2a25a'); g.addColorStop(0.6, '#f7d9a0'); g.addColorStop(1, '#4a6a5a'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = '#fff2c8'; c.beginPath(); c.arc(w * 0.68, h * 0.42, min(w, h) * 0.12, 0, 7); c.fill(); c.fillStyle = '#2d4a44'; c.beginPath(); c.moveTo(0, h * 0.75); c.lineTo(w * 0.3, h * 0.5); c.lineTo(w * 0.55, h * 0.72); c.lineTo(w * 0.78, h * 0.56); c.lineTo(w, h * 0.74); c.lineTo(w, h); c.lineTo(0, h); c.fill(); },
  };
  /** Draw a built-in screen picture: drawScreen(ctx, 'chat', w, h, {messages}). kind may also be a function (ctx, w, h, o). */
  const drawScreen = (c, kind, w, h, o = {}) => { c.save(); (typeof kind === 'function' ? kind : (scr[kind] || scr.off))(c, w, h, o); c.restore(); };
  /** Screen quad for a builder: a glowing picture w x h metres (facing +Z, or +Y with up). Returns the mesh; marks it keep. */
  function screenOf(w, h, ppm, kind, o, up) {
    const pw = Math.round(w * ppm), ph = Math.round(h * ppm), off = kind === 'off';
    const key = 'scr|' + (typeof kind === 'function' ? kind.toString().length + kind.name : kind) + '|' + pw + 'x' + ph + '|' + JSON.stringify([o.time, o.date, o.text, o.from, o.caller, o.sub, o.name, o.messages, o.title, o.lines, o.seed, o.dark, o.pin, o.granted, o.color2, o.dots, o.figure, o.bg0, o.bg1, o.bg2]);
    const m = off ? mat('#080a0d', { rough: 0.15, own: true }) : tm(key, pw, ph, (c, cw, ch) => drawScreen(c, kind, cw, ch, o), { basic: true, own: true, decal: false });
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    const q = keep(decal(w, h, m, { up })); q.userData.px = [pw, ph]; return q;
  }
  const screenUD = (ud, q, w, h, ppm, glowK = 1) => { ud.screen = q; ud.screenSize = [w, h]; ud.screenPpm = ppm; ud.lights = ud.lights || []; ud.on = 1; ud.setOn = k => { ud.on = clamp(k); if (q.material.isMeshBasicMaterial) q.material.color.setScalar(ud.on * glowK); ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on; }); }; if (glowK !== 1) ud.setOn(1); };

  // =====================================================================================================
  // TECH
  // =====================================================================================================
  def('smartphone', 'tech', (o, g, ud) => {
    const w = 0.072, h = 0.152, t = 0.0082, col = o.color || C.black, sw = w - 0.006, sh = h - 0.008, ppm = 4400;
    slab(w, h, t, 0.0115, col, { bevel: 0.0016, n: 3, rough: 0.35, metal: 0.25 }).to(g);
    const q = screenOf(sw, sh, ppm, o.screen || 'lock', o, true).at(0, t + 0.0002, 0).to(g);
    box(0.0012, 0.003, 0.016, shade(col, 1.5), METAL).at(w / 2, t / 2, -0.02).to(g); box(0.0012, 0.003, 0.011, shade(col, 1.5), METAL).at(-w / 2, t / 2, -0.035).to(g); box(0.0012, 0.003, 0.011, shade(col, 1.5), METAL).at(-w / 2, t / 2, -0.02).to(g);
    slab(0.032, 0.034, 0.0016, 0.008, shade(col, 1.35), { n: 2, rough: 0.3, metal: 0.3 }).rot(PI, 0, 0).at(-0.014, 0, -h / 2 + 0.024).to(g);                 // camera island on the back
    [[-0.021, -0.008], [-0.021, 0.008], [-0.007, 0]].forEach(([x, z]) => { cyl(0.0052, 0.0052, 0.0012, 8, '#0c0e12', GLOSS).at(x, -0.0021, -h / 2 + 0.024 + z).to(g); cyl(0.0026, 0.0026, 0.0014, 6, '#2a3550', GLOSS).at(x, -0.0022, -h / 2 + 0.024 + z).to(g); });
    cyl(0.002, 0.002, 0.0006, 6, '#f6e7b0').at(-0.007, -0.0018, -h / 2 + 0.036).to(g);
    screenUD(ud, q, sw, sh, ppm, o.glow ?? 1); ud.lightAt = socket(0, 0.06, 0).to(g); ud.lightColor = o.lightColor || '#9fc4ff';
    return { grip: [0, t / 2, 0.03], hold: '-x y', aim: [0, 1, 0], top: [0, 0, -1] };
  });
  alias('phone', 'smartphone');

  def('tablet', 'tech', (o, g, ud) => {
    const land = !!o.landscape, w = land ? 0.248 : 0.178, h = land ? 0.178 : 0.248, t = 0.0072, col = o.color || '#3a3f48', sw = w - 0.016, sh = h - 0.016, ppm = 2600;
    slab(w, h, t, 0.012, col, { bevel: 0.0015, n: 3, rough: 0.35, metal: 0.3 }).to(g); slab(w - 0.004, h - 0.004, 0.0004, 0.011, '#0b0d10', { n: 3, rough: 0.2 }).at(0, t, 0).to(g);
    const q = screenOf(sw, sh, ppm, o.screen || 'home', o, true).at(0, t + 0.0006, 0).to(g);
    cyl(0.0045, 0.0045, 0.001, 8, '#0c0e12', GLOSS).at(w / 2 - 0.014, -0.0005, -h / 2 + 0.014).to(g);
    screenUD(ud, q, sw, sh, ppm, o.glow ?? 1); ud.lightAt = socket(0, 0.1, 0).to(g); ud.lightColor = o.lightColor || '#9fc4ff';
    return { grip: [0, t / 2, h * 0.36], hold: '-x y', aim: [0, 1, 0], top: [0, 0, -1] };
  });

  def('laptop', 'tech', (o, g, ud) => {
    const w = 0.33, d = 0.228, tb = 0.013, tl = 0.0065, col = o.color || '#a9b1ba', sw = w - 0.022, sh = d - 0.03, ppm = 1900;
    slab(w, d, tb, 0.012, col, { bevel: 0.002, n: 2, ...SATIN }).to(g);
    decal(w - 0.03, d * 0.46, tm('laptopKeys|' + (o.backlit ? 1 : 0), 512, 176, (c, cw, ch) => { c.fillStyle = '#15171b'; c.fillRect(0, 0, cw, ch); const rows = 6, kh = ch / rows; for (let j = 0; j < rows; j++) { const n = j === 5 ? 9 : 14, kw = cw / 14; for (let i = 0; i < n; i++) { let x = i * kw, ww = kw; if (j === 5) { x = [0, 1, 2, 3, 4, 9, 10, 11, 12][i] * kw; ww = i === 4 ? kw * 5 : kw; } c.fillStyle = '#2b2f36'; R2(c, x + 2, j * kh + 2, ww - 4, kh - 4, 4); c.fill(); c.fillStyle = o.backlit ? '#eaf4ff' : '#9aa3ae'; c.fillRect(x + ww / 2 - 4, j * kh + kh / 2 - 3, i % 3 ? 8 : 5, 5); } } }, { emissive: !!o.backlit, ei: 0.55, rough: 0.6 }), { up: true }).at(0, tb + 0.0003, -d * 0.16).to(g);
    slab(0.1, 0.062, 0.0004, 0.004, shade(col, 0.9), { n: 1, rough: 0.3 }).at(0, tb, d * 0.3).to(g);                                                     // trackpad
    cyl(0.0055, 0.0055, w * 0.8, 6, shade(col, 0.55), SATIN).rot(0, 0, PI / 2).at(0, tb - 0.001, -d / 2 + 0.006).to(g);                                     // hinge barrel
    const lid = part().at(0, tb + 0.0016, -d / 2 + 0.006).to(g), zc = (d - 0.006) / 2 - 0.003;
    slab(w, d - 0.006, tl, 0.012, col, { bevel: 0.002, n: 2, ...SATIN }).at(0, 0, zc).to(lid);
    slab(w - 0.004, d - 0.01, 0.0005, 0.011, '#0b0d10', { n: 2, rough: 0.25 }).rot(PI, 0, 0).at(0, 0, zc).to(lid);                                          // bezel (inner face)
    plate(0.03, 0.03, 0.0006, 0.007, shade(col, 0.82), { n: 2, ...SATIN }).rot(PI / 2, 0, 0).at(0, tl + 0.0001, zc).to(lid);                                // emblem on the back
    const kind = o.screen || 'desktop', q = screenOf(sw, sh, ppm, kind, o, false); q.geometry.rotateX(PI / 2); q.position.set(0, -0.0009, zc + 0.002); lid.add(q);
    const la = socket(0, -0.12, zc).to(lid);
    screenUD(ud, q, sw, sh, ppm, o.glow ?? 1); ud.lid = lid; ud.lightAt = la; ud.lightColor = o.lightColor || '#9fc4ff';
    /** open(k): 0 = closed, 1 = fully open (135 degrees). */
    ud.open = k => { ud.openK = clamp(k); lid.rotation.x = -ud.openK * PI * 0.75; return ud.openK; };
    ud.open(o.open ?? 0.8);
    return { grip: [0, tb / 2, d / 2], hold: 'z x', anchor: 'keep', aim: [0, 0, 1] };
  });

  def('walkieTalkie', 'tech', (o, g, ud) => {
    const col = o.color || '#2a2d33', acc = o.accent || C.orange, w = 0.06, h = 0.118, d = 0.034;
    plate(w, h, d, 0.009, col, { bevel: 0.003, n: 2, rough: 0.7 }).at(0, h / 2, 0).to(g);
    decal(w - 0.01, h - 0.012, tm('walkie|' + acc, 200, 424, (c, cw, ch) => { c.fillStyle = '#1b1d21'; c.fillRect(0, 0, cw, ch); c.fillStyle = '#0c0d10'; for (let j = 0; j < 9; j++) for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(40 + i * 24, 196 + j * 20, 6, 0, 7); c.fill(); } c.fillStyle = '#07090b'; R2(c, 24, 26, cw - 48, 96, 10); c.fill(); c.fillStyle = '#3a3e45'; for (let i = 0; i < 3; i++) { R2(c, 26 + i * 52, 384, 44, 26, 8); c.fill(); } c.fillStyle = acc; c.fillRect(24, 140, cw - 48, 8); txt(c, 'TX·7', cw / 2, 164, '700 20px Inter', '#aab2bd'); }, { rough: 0.7 })).at(0, h / 2, d / 2 + 0.0002).to(g);
    const disp = keep(decal(0.036, 0.018, tm('walkieLcd|' + (o.display || 'CH 07'), 144, 72, (c, cw, ch) => { c.fillStyle = '#b8f25a'; c.fillRect(0, 0, cw, ch); txt(c, o.display || 'CH 07', cw / 2, ch / 2 + 2, '700 40px "Share Tech Mono", monospace', '#14210a'); }, { basic: true, own: true }))).at(0, h - 0.027, d / 2 + 0.0006).to(g);
    cylB(0.0048, 0.0062, 0.092, 6, '#17191c', { rough: 0.8 }).at(-w / 2 + 0.012, h, 0).to(g); cylB(0.0068, 0.0068, 0.012, 6, '#34383f').at(-w / 2 + 0.012, h - 0.002, 0).to(g);                 // antenna
    cylB(0.0075, 0.0075, 0.011, 8, '#3a3e45', { rough: 0.6 }).at(w / 2 - 0.013, h, 0).to(g); cylB(0.005, 0.005, 0.008, 6, '#3a3e45').at(0.002, h, 0.004).to(g);                                  // knobs
    box(0.004, 0.034, 0.016, acc, { rough: 0.6 }).at(-w / 2 - 0.001, h * 0.62, 0).to(g);                                                                                                     // push-to-talk
    box(0.022, 0.07, 0.006, '#1b1d21').at(0, h * 0.55, -d / 2 - 0.003).to(g);                                                                                                                // belt clip
    const led = keep(ball(0.0032, glo(o.led || '#ff3b2f', 1.6), 0)).at(w / 2 - 0.028, h + 0.001, 0.006).to(g);
    ud.led = led; ud.display = disp; ud.update = t => { led.material.color.set(o.led || '#ff3b2f').multiplyScalar(mod(t, 1.4) < 0.18 ? 2 : 0.35); };
    return { grip: [0, h * 0.42, 0], hold: 'x z' };
  });

  def('radio', 'tech', (o, g, ud) => {
    const w = 0.34, h = 0.2, d = 0.13, col = o.color || C.wood, on = o.on !== false;
    plate(w, h, d, 0.034, col, { n: 3, vary: 0.05, rough: 0.7 }).at(0, h / 2 + 0.008, 0).to(g);
    plate(w - 0.03, h - 0.03, 0.006, 0.024, shade(col, 0.62), { n: 3 }).at(0, h / 2 + 0.008, d / 2).to(g);                                              // recessed front panel
    decal(w * 0.52, h - 0.062, tm('radioGrille|' + (o.grille || '#cdb98a'), 256, 200, (c, cw, ch) => { c.fillStyle = o.grille || '#cdb98a'; c.fillRect(0, 0, cw, ch); c.fillStyle = 'rgba(60,40,20,.28)'; for (let y = 0; y < ch; y += 6) c.fillRect(0, y, cw, 2); for (let x = 0; x < cw; x += 6) c.fillRect(x, 0, 1, ch); c.fillStyle = shade(col, 0.5); for (let i = 1; i < 5; i++) c.fillRect(0, i * ch / 5 - 5, cw, 10); }, { rough: 1 })).at(-w * 0.19, h / 2 + 0.008, d / 2 + 0.0034).to(g);
    const dial = keep(decal(w * 0.3, 0.07, tm('radioDial', 240, 140, (c, cw, ch) => { const gr = c.createLinearGradient(0, 0, 0, ch); gr.addColorStop(0, '#ffe2a0'); gr.addColorStop(1, '#f2a94a'); c.fillStyle = gr; c.fillRect(0, 0, cw, ch); c.fillStyle = '#5a3210'; for (let i = 0; i <= 20; i++) c.fillRect(14 + i * 10.6, i % 5 ? 70 : 58, 2.2, i % 5 ? 14 : 26); ['55', '70', '90', '120', '160'].forEach((s, i) => txt(c, s, 18 + i * 52, 36, '700 22px Inter', '#5a3210')); txt(c, 'AM', 22, 116, '700 20px Inter', '#5a3210'); txt(c, 'kHz', cw - 28, 116, '700 20px Inter', '#5a3210'); }, { basic: true, own: true }))).at(w * 0.27, h / 2 + 0.046, d / 2 + 0.0036).to(g);
    const needle = keep(box(0.0022, 0.062, 0.001, '#c8281e')).at(w * 0.27, h / 2 + 0.046, d / 2 + 0.0044).to(g);
    for (const x of [w * 0.19, w * 0.35]) { cyl(0.019, 0.021, 0.016, 8, shade(col, 0.42), { rough: 0.5 }).rot(PI / 2, 0, 0).at(x, h / 2 - 0.036, d / 2 + 0.011).to(g); cyl(0.011, 0.011, 0.004, 8, C.brass, METAL).rot(PI / 2, 0, 0).at(x, h / 2 - 0.036, d / 2 + 0.021).to(g); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylB(0.012, 0.014, 0.008, 6, '#2a2520').at(sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.03)).to(g);
    const hdl = arcTube(0.09, 0.006, PI, shade(C.leather, 0.9), { rs: 4, ts: 8, rough: 0.9 }).scl(1, 0.42, 1.8).at(0, h + 0.006, 0).to(g);
    for (const sx of [-1, 1]) box(0.014, 0.008, 0.02, C.brass, METAL).at(sx * 0.09, h + 0.01, 0).to(g);
    let ant = null; if (o.antenna !== false) { ant = part(cylB(0.0032, 0.0038, 0.2, 5, C.chrome, METAL), cylB(0.002, 0.0026, 0.2, 5, C.chrome, METAL).at(0, 0.2, 0), ball(0.0045, C.chrome, 0, METAL).at(0, 0.4, 0)).rot(0, 0, -0.42).at(w / 2 - 0.035, h + 0.004, -d / 2 + 0.02).to(g); }
    const la = socket(w * 0.27, h / 2 + 0.046, d / 2 + 0.08).to(g);
    Object.assign(ud, { dial, needle, antenna: ant, handle: hdl, lightAt: la, lightColor: '#ffb45a', lights: [], on: on ? 1 : 0 });
    /** tune(k): move the needle across the dial, 0..1. */
    ud.tune = k => { needle.position.x = w * 0.27 + (clamp(k) - 0.5) * w * 0.26; };
    ud.setOn = k => { ud.on = clamp(k); dial.material.color.setScalar(0.12 + 0.88 * ud.on); ud.lights.forEach(l => { l.intensity = l.userData.base * ud.on; }); };
    ud.tune(o.tune ?? 0.36); ud.setOn(on ? 1 : 0);
    return { grip: [0, h + 0.044, 0], hold: 'z y', anchor: 'keep' };
  });

  def('camera', 'tech', (o, g, ud) => {
    const col = o.color || '#23262b', acc = o.accent || '#c8382e', w = 0.128, h = 0.078, d = 0.05;
    plate(w, h, d, 0.009, col, { bevel: 0.003, n: 2, rough: 0.75, vary: 0.03 }).at(0, h / 2, 0).to(g);
    cylB(0.021, 0.021, h - 0.004, 8, shade(col, 0.82), { rough: 0.95 }).at(-w / 2 + 0.019, 0.002, d / 2 - 0.004).to(g);                                   // hand grip
    ext([[-0.026, 0], [0.026, 0], [0.019, 0.02], [-0.019, 0.02]], 0.046, col, { center: true, rough: 0.75 }).at(0.006, h, 0).to(g);                      // prism hump
    box(0.022, 0.004, 0.02, C.steel, METAL).at(0.006, h + 0.021, -0.004).to(g);                                                                          // hot shoe
    const flash = keep(box(0.026, 0.009, 0.002, glo('#dfe6ee', 0.5))).at(0.006, h + 0.011, 0.0235).to(g);
    cylB(0.008, 0.008, 0.006, 8, C.chrome, METAL).at(-w / 2 + 0.019, h, d / 2 - 0.004).to(g);                                                             // shutter button
    cylB(0.012, 0.012, 0.008, 10, shade(col, 1.3), { rough: 0.6 }).at(w / 2 - 0.022, h, 0).to(g);                                                         // mode dial
    const lz = grp().rot(PI / 2, 0, 0).at(0.006, h / 2 - 0.002, d / 2).to(g);                                                                             // lens, modelled along +Y
    lathe([[0, 0], [0.036, 0], [0.036, 0.008], [0.032, 0.012], [0.032, 0.03], [0.034, 0.032], [0.034, 0.052], [0.031, 0.056], [0.031, 0.066], [0.027, 0.066], [0.025, 0.058], [0, 0.058]], 10, shade(col, 0.9), { rough: 0.6 }).to(lz);
    cyl(0.0345, 0.0345, 0.004, 10, acc, GLOSS).at(0, 0.014, 0).to(lz); cyl(0.0348, 0.0348, 0.012, 10, shade(col, 0.6), { rough: 1 }).at(0, 0.042, 0).to(lz);
    const glass = keep(disc(0.025, 10, mat('#1a1836', { rough: 0.08, metal: 0.5, emissive: '#2a2a6a', ei: 0.5, own: true }))).at(0, 0.0585, 0).to(lz);
    disc(0.007, 6, glo('#cfe0ff', 0.9)).at(-0.008, 0.059, -0.008).to(lz);
    const q = screenOf(0.066, 0.044, 3200, o.screen || 'photo', o, false); q.rotation.y = PI; q.position.set(-0.012, h / 2 - 0.004, -d / 2 - 0.0006); g.add(q);
    box(0.074, 0.052, 0.001, '#0c0d10').at(-0.012, h / 2 - 0.004, -d / 2).to(g); box(0.024, 0.014, 0.008, '#0c0d10').at(0.006, h + 0.006, -d / 2 - 0.002).to(g);   // screen frame, eyepiece
    for (const sx of [-1, 1]) torus(0.006, 0.0014, C.steel, { rs: 4, ts: 6, ...METAL }).at(sx * (w / 2 + 0.002), h - 0.008, 0).to(g);
    if (o.strap) tube([[-w / 2 - 0.004, h - 0.008, 0], [-w / 2 - 0.05, 0.03, -0.06], [-0.05, 0.004, -0.15], [0.06, 0.004, -0.16], [w / 2 + 0.06, 0.03, -0.07], [w / 2 + 0.004, h - 0.008, 0]], 0.0045, o.strapColor || '#1b1d21', { rs: 4, seg: 22 }).scl(1, 1, 1).to(g);
    const fl = fx(flare('#ffffff', 1.4, 0)).at(0.006, h + 0.011, 0.04).to(g), lensAt = socket(0, 0.066, 0).to(lz);
    screenUD(ud, q, 0.066, 0.044, 3200); Object.assign(ud, { lens: glass, lensAt, flashLamp: flash, flashFlare: fl });
    /** flash(k): 0..1 brightness of the built-in flash (drive it with S3.pulse for a pop). */
    ud.flash = k => { k = clamp(k); flash.material.color.set('#dfe6ee').multiplyScalar(0.5 + 3 * k); fl.material.opacity = k; };
    return { grip: [-w / 2 + 0.019, h * 0.45, 0.01], hold: 'x z', grips: { eyes: { at: [0.006, h + 0.004, -d / 2 - 0.02], hold: 'x y' } }, aim: [0, 0, 1], anchor: 'floor' };
  });

  def('headphones', 'tech', (o, g, ud) => {
    const col = o.color || '#2b2e34', acc = o.accent || C.orange, R = 0.085, rc = 0.042;
    // modelled lying flat: ear axis along X, headband towards -Z
    const band = grp().rot(-PI / 2, 0, 0).at(0, rc, 0).to(g);
    arcTube(R, 0.0065, PI, col, { rs: 4, ts: 10, rough: 0.6 }).scl(1, 1, 2.6).to(band);
    arcTube(R - 0.007, 0.006, PI * 0.5, shade(col, 0.6), { rs: 4, ts: 6, rough: 1 }).rot(0, 0, PI * 0.25).scl(1, 1, 2.2).to(band);                        // head cushion
    for (const sx of [-1, 1]) {
      box(0.006, 0.05, 0.012, C.steel, METAL).at(sx * R, -0.02, 0).to(band);                                                                              // slider
      cyl(rc, rc * 0.9, 0.026, 10, col, { rough: 0.55 }).rot(0, 0, PI / 2).at(sx * (R - 0.004), rc, 0.05).to(g);                                          // cup shell
      cyl(rc + 0.003, rc + 0.003, 0.016, 10, shade(col, 0.55), { rough: 1 }).rot(0, 0, PI / 2).at(sx * (R - 0.024), rc, 0.05).to(g);                       // ear cushion
      cyl(rc * 0.55, rc * 0.55, 0.003, 10, acc, GLOSS).rot(0, 0, PI / 2).at(sx * (R + 0.0095), rc, 0.05).to(g);                                            // accent disc
      box(0.008, 0.012, 0.03, col).at(sx * (R - 0.002), rc, 0.012).to(g);                                                                                  // yoke
    }
    return { grip: [0, rc, -R + 0.0], hold: 'x z', grips: { wear: { at: [0, rc, 0.05], hold: 'x z' } }, poses: { worn: { rot: [PI / 2, 0, 0] } } };
  });

  def('gameController', 'tech', (o, g, ud) => {
    const col = o.color || '#2b2e34', lc = o.light || '#3aa0ff', t = 0.03;
    const out = [[-0.05, 0.036], [0.05, 0.036], [0.072, 0.03], [0.081, 0.006], [0.079, -0.034], [0.068, -0.062], [0.05, -0.064], [0.036, -0.026], [-0.036, -0.026], [-0.05, -0.064], [-0.068, -0.062], [-0.079, -0.034], [-0.081, 0.006], [-0.072, 0.03]];
    ext(out, t, col, { up: true, bevel: 0.007, rough: 0.6 }).to(g);
    box(0.03, 0.004, 0.01, shade(col, 0.6)).at(-0.046, t + 0.001, -0.004).to(g); box(0.01, 0.004, 0.03, shade(col, 0.6)).at(-0.046, t + 0.001, -0.004).to(g);            // d-pad
    [['#e5484d', 0.012, 0], ['#3cc96a', 0, 0.012], ['#2f7bff', -0.012, 0], ['#ffcc33', 0, -0.012]].forEach(([c, x, z]) => cylB(0.0052, 0.0052, 0.004, 8, c, GLOSS).at(0.046 + x, t - 0.001, -0.004 + z).to(g));
    for (const sx of [-1, 1]) { cylB(0.011, 0.012, 0.003, 10, shade(col, 0.6)).at(sx * 0.022, t - 0.0005, 0.022).to(g); cylB(0.005, 0.006, 0.008, 6, shade(col, 0.5)).at(sx * 0.022, t, 0.022).to(g); cylB(0.0088, 0.0075, 0.0035, 10, shade(col, 0.75), { rough: 1 }).at(sx * 0.022, t + 0.007, 0.022).to(g);
      box(0.03, 0.012, 0.012, shade(col, 0.72)).at(sx * 0.052, t * 0.62, -0.038).to(g); cylB(0.0026, 0.0026, 0.002, 6, shade(col, 1.6)).at(sx * 0.014, t - 0.0005, -0.012).to(g); }
    slab(0.03, 0.018, 0.002, 0.004, shade(col, 0.7), { n: 1 }).at(0, t - 0.0008, -0.01).to(g);
    const bar = keep(box(0.036, 0.005, 0.002, glo(lc, 1.5))).at(0, t * 0.5, -0.0365).to(g); ud.lightBar = bar;
    return { grip: [0, t / 2, 0], hold: '-x z', aim: [0, 0, -1] };
  });

  def('tvRemote', 'tech', (o, g, ud) => {
    const col = o.color || '#24272c', w = 0.046, L = 0.185, t = 0.017;
    slab(w, L, t, 0.012, col, { bevel: 0.004, n: 2, rough: 0.55 }).to(g);
    decal(w - 0.008, L - 0.014, tm('remote', 128, 560, (c, cw, ch) => { c.fillStyle = '#1c1e22'; c.fillRect(0, 0, cw, ch); c.fillStyle = '#e5484d'; c.beginPath(); c.arc(26, 30, 12, 0, 7); c.fill(); c.fillStyle = '#4b515a'; c.beginPath(); c.arc(cw - 26, 30, 10, 0, 7); c.fill(); c.strokeStyle = '#5a616c'; c.lineWidth = 12; c.beginPath(); c.arc(cw / 2, 124, 36, 0, 7); c.stroke(); c.fillStyle = '#7a8290'; c.beginPath(); c.arc(cw / 2, 124, 15, 0, 7); c.fill();
      c.fillStyle = '#4b515a'; R2(c, 14, 190, 28, 76, 12); c.fill(); R2(c, cw - 42, 190, 28, 76, 12); c.fill(); for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) { R2(c, 14 + i * 36, 296 + j * 40, 28, 26, 8); c.fill(); } ['#e5484d', '#3cc96a', '#ffcc33', '#2f7bff'].forEach((k, i) => { c.fillStyle = k; R2(c, 12 + i * 27, 480, 21, 12, 5); c.fill(); }); txt(c, 'TV', cw / 2, 530, '700 22px Inter', '#6b7380'); }, { rough: 0.6 }), { up: true }).at(0, t + 0.0002, 0).to(g);
    box(w * 0.5, t * 0.5, 0.003, '#3a0c10', GLOSS).at(0, t * 0.55, -L / 2 - 0.0005).to(g);
    return { grip: [0, t / 2, 0.04], hold: '-x z', aim: [0, 0, -1] };
  });

  def('usbStick', 'tech', (o, g, ud) => {
    const col = o.color || C.red, lc = o.led || '#3aa0ff';
    ext(rrPts(0.04, 0.018, 0.004, 2), 0.0085, col, { up: true, bevel: 0.0012, ...GLOSS }).at(-0.008, 0, 0).to(g);
    box(0.013, 0.0046, 0.0122, C.chrome, METAL).at(0.0185, 0.00425, 0).to(g); for (const z of [-0.003, 0.003]) box(0.004, 0.0048, 0.0026, '#2a2d33').at(0.019, 0.00425, z).to(g);
    box(0.014, 0.0005, 0.01, shade(col, 1.5), GLOSS).at(-0.012, 0.0087, 0).to(g);                                                                           // label
    torus(0.004, 0.0011, C.steel, { rs: 4, ts: 6, ...METAL }).rot(PI / 2, 0, 0).at(-0.0305, 0.00425, 0).to(g);
    const led = keep(box(0.003, 0.0006, 0.003, glo(lc, 1.6))).at(0.002, 0.0088, 0).to(g); ud.led = led;
    ud.update = t => { led.material.color.set(lc).multiplyScalar(mod(t, 0.5) < 0.25 ? 2 : 0.3); };
    return { grip: [-0.014, 0.00425, 0], hold: '-y z', aim: [1, 0, 0] };
  });

  def('keyCard', 'tech', (o, g, ud) => {
    const col = o.color || C.blue, w = 0.054, h = 0.0856, t = 0.0012;
    slab(w, h, t, 0.0035, '#f3f4f6', { n: 2, rough: 0.4 }).to(g);
    decal(w - 0.0006, h - 0.0006, tm('keycard|' + [col, o.title, o.name, o.level].join('|'), 216, 342, (c, cw, ch) => { c.fillStyle = '#f3f4f6'; c.fillRect(0, 0, cw, ch); c.fillStyle = col; c.fillRect(0, 0, cw, 92); c.fillStyle = shade(col, 0.7); c.fillRect(0, 84, cw, 8); c.fillStyle = '#f3f4f6'; R2(c, cw / 2 - 26, 12, 52, 10, 5); c.fill();
      textBox(c, o.title || 'ACCESS', 10, 30, cw - 20, 46, '800 $px Inter', '#ffffff', 34); c.fillStyle = '#c9ced6'; R2(c, 22, 110, 76, 96, 8); c.fill(); c.fillStyle = '#7b8594'; c.beginPath(); c.arc(60, 146, 18, 0, 7); c.fill(); c.beginPath(); c.arc(60, 206, 30, PI, 0); c.fill();
      textBox(c, o.level || 'LEVEL 5', 106, 112, 100, 40, '800 $px Inter', col, 26); greek(c, 110, 164, 92, 3, 13, '#8a93a0', 4); textBox(c, o.name || 'STAFF', 14, 220, cw - 28, 34, '700 $px Inter', '#1b2028', 24);
      c.fillStyle = '#111'; const r = rng(8); for (let x = 22; x < cw - 22;) { const bw = 1 + flr(r() * 4); c.fillRect(x, 270, bw, 44); x += bw + 1 + flr(r() * 3); } }, { rough: 0.35 }), { up: true }).at(0, t + 0.0001, 0).to(g);
    const back = decal(w - 0.0006, h - 0.0006, tm('keycardBack', 108, 171, (c, cw, ch) => { c.fillStyle = '#eceef1'; c.fillRect(0, 0, cw, ch); c.fillStyle = '#1b1d21'; c.fillRect(0, 22, cw, 26); greek(c, 12, 70, 84, 6, 11, '#a2a9b4', 6); }, { rough: 0.4 }), { up: true }); back.rotation.z = PI; back.position.y = -0.0001; g.add(back);
    if (o.lanyard) { const lc = o.lanyardColor || col; box(0.012, 0.004, 0.016, C.steel, METAL).at(0, 0.002, -h / 2 - 0.006).to(g); tube([[0.004, 0.002, -h / 2 - 0.012], [0.05, 0.002, -0.2], [0.03, 0.002, -0.4], [-0.03, 0.002, -0.4], [-0.05, 0.002, -0.2], [-0.004, 0.002, -h / 2 - 0.012]], 0.006, lc, { rs: 4, seg: 24, rough: 0.9 }).scl(1, 0.25, 1).to(g); }
    return { grip: [0, t / 2, 0.02], hold: 'x -y', aim: [0, 1, 0], top: [0, 0, -1] };
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
