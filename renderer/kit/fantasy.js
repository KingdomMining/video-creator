// fantasy.js - KitFantasy: castles, villages, medieval interiors, treasure and artefacts, ruins and temples,
// ships and expedition gear, snow and mountain props for the low-poly 3D stage.
// Reference with pictures: docs/kit/fantasy.md. Contract: docs/STAGE3D.md section 8.
//
// Every builder is name(o = {}) and returns a THREE.Group at real scale (metres), standing on y = 0, centred on its
// footprint, front toward +Z. Conventions used throughout this kit:
//   - Wall-mounted pieces (wallTorch, banner {mount:'wall'}, shield, wallRing, stainedGlass) have their back on z = 0
//     and hang at o.y above the floor, so `pos: [x, 0, wallZ]` just works.
//   - Boats float: y = 0 is the waterline.
//   - Moving parts are on userData with a helper where natural: userData.open(k) for k 0..1 (doors, lids, gates).
//   - Anything that animates has userData.update(t): a pure function of time. KitFantasy.animate(s, root) registers
//     every update() found under root with the stage in one call.
//   - Fire and lamps expose userData.flame (the flame group), userData.lightPos ([x, y, z] in the builder's own space)
//     and userData.setLit(on). KitFantasy.lightFlames(s, root) puts flickering point lights on them.
const KitFantasy = (() => {
  const T = THREE, PI = Math.PI, TAU = PI * 2;
  const { box, boxB, cyl, cylB, cone, coneB, ball, blob, plane, quad, torus, extrude, lathe, tube, grp, mesh, mat, flare, noise1 } = S3;
  const V = S3.V;

  // ---------- palette (defaults; every builder takes colour options) ----------
  const C = {
    stone: '#918d85', stoneDk: '#6a6761', stoneLt: '#b0aba0', slate: '#4f5b6b', moss: '#5f7748',
    wood: '#7d5636', woodDk: '#503823', woodLt: '#a98052', plaster: '#e6d8b9', thatch: '#b79c5f', tile: '#a5503a',
    iron: '#3a3d45', steel: '#aab2bc', gold: '#f2bf47', brass: '#c9993c', rope: '#b99c6b', cloth: '#ddd1b8', parch: '#e8d9ae',
    red: '#a62c2c', blue: '#2c5196', green: '#2f6b45', purple: '#5e3c93', white: '#ece8de', black: '#1b1c20',
    fire: '#ff8f2e', magic: '#6fe6ff', arcane: '#b98aff', poison: '#86ff7a', dark: '#14161a',
  };
  const GOLD = { metal: 0.35, rough: 0.32, emissive: '#6a4208', ei: 0.55 }, IRON = { metal: 0.45, rough: 0.5 }, STEEL = { metal: 0.5, rough: 0.28 };

  // ---------- colour + random helpers ----------
  const _col = new T.Color();
  const hex = c => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ? c : '#' + _col.set(c).getHexString();
  const rgb = c => { const n = parseInt(hex(c).slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  /** Darker (k < 1) or lighter (k > 1) version of a colour. */
  const shade = (c, k) => { const [r, g, b] = rgb(c); return k <= 1 ? toHex(r * k, g * k, b * k) : toHex(r + (255 - r) * (k - 1), g + (255 - g) * (k - 1), b + (255 - b) * (k - 1)); };
  const mix = (a, b, k) => { const A = rgb(a), B = rgb(b); return toHex(lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k)); };
  const rgba = (c, a) => { const [r, g, b] = rgb(c); return `rgba(${r},${g},${b},${a})`; };
  const R = (seed, salt = 0) => rng((((seed || 1) * 7919) + salt * 104729) >>> 0);
  const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

  // ---------- bake: merge the static meshes of a builder into one mesh per material class ----------
  // Plain flat colours are folded into vertex colours, so a prop made of 60 boxes in 9 colours renders as 1-3 meshes.
  const _paint = new Map();
  const foldable = m => !m.map && !m.transparent && !m.userData.own && ((m.isMeshStandardMaterial && m.emissive.getHex() === 0 && !m.emissiveMap) || (m.isMeshBasicMaterial && m.blending === T.NormalBlending));
  function paintMat(m) {
    const key = m.isMeshBasicMaterial ? ['b', m.side, m.fog].join('|') : ['s', m.roughness, m.metalness, m.flatShading, m.side].join('|');
    let p = _paint.get(key);
    if (!p) {
      p = m.isMeshBasicMaterial ? new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false, fog: m.fog, side: m.side })
        : new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: m.flatShading, roughness: m.roughness, metalness: m.metalness, side: m.side });
      _paint.set(key, p);
    }
    return p;
  }
  function bake(src) {
    src.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(src.matrixWorld).invert(), M = new T.Matrix4(), N = new T.Matrix3(), v = new T.Vector3(), buckets = new Map(), loose = [], lives = [];
    // subtrees marked userData.live keep moving: lift them out (inside a holder that carries their parent's transform)
    src.traverse(o => { if (o === src || !o.userData.live) return; for (let a = o.parent; a && a !== src; a = a.parent) if (a.userData.live) return; lives.push(o); });
    const holders = lives.map(o => { const h = new T.Group(); M.multiplyMatrices(inv, o.parent.matrixWorld); M.decompose(h.position, h.quaternion, h.scale); o.removeFromParent(); h.add(o); return h; });
    src.traverse(o => {
      if (o === src) return;
      if (o.isMesh) {
        const m0 = o.material, fold = foldable(m0), m = fold ? paintMat(m0) : m0, key = m.uuid + (o.castShadow ? 'c' : '-') + (o.receiveShadow ? 'r' : '-');
        let b = buckets.get(key); if (!b) buckets.set(key, b = { m, cast: o.castShadow, recv: o.receiveShadow, pos: [], nor: [], uv: [], col: [], vc: fold || m0.vertexColors });
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv, Cc = g.attributes.color;
        M.multiplyMatrices(inv, o.matrixWorld); N.getNormalMatrix(M); const flip = M.determinant() < 0;
        const cr = fold ? m0.color.r : 1, cg = fold ? m0.color.g : 1, cb = fold ? m0.color.b : 1;
        for (let t = 0; t + 2 < P.count; t += 3) for (let j = 0; j < 3; j++) {
          const i = t + (flip ? 2 - j : j);
          v.fromBufferAttribute(P, i).applyMatrix4(M); b.pos.push(v.x, v.y, v.z);
          if (Nn) { v.fromBufferAttribute(Nn, i).applyMatrix3(N).normalize(); b.nor.push(v.x, v.y, v.z); } else b.nor.push(0, 1, 0);
          if (U) b.uv.push(U.getX(i), U.getY(i)); else b.uv.push(0, 0);
          if (b.vc) { if (Cc) b.col.push(Cc.getX(i) * cr, Cc.getY(i) * cg, Cc.getZ(i) * cb); else b.col.push(cr, cg, cb); }
        }
      } else if (o.isSprite || o.isLight || o.isPoints) loose.push(o);
    });
    const out = new T.Group();
    for (const b of buckets.values()) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(b.nor, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
      if (b.vc) g.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
      const me = new T.Mesh(g, b.m); me.castShadow = b.cast; me.receiveShadow = b.recv; out.add(me);
    }
    for (const o of loose) { M.multiplyMatrices(inv, o.matrixWorld); o.removeFromParent(); M.decompose(o.position, o.quaternion, o.scale); out.add(o); }
    holders.forEach(h => out.add(h));
    out.position.copy(src.position); out.quaternion.copy(src.quaternion); out.scale.copy(src.scale);
    return out;
  }
  /** Give a composite builder one update(t) that drives every animated part inside it (animate() will not visit them twice). */
  function compose(g) {
    const fns = [], walk = o => { for (const k of o.children) { if (typeof k.userData.update === 'function') { fns.push(k.userData.update); if (k.userData.composite) continue; } walk(k); } }; walk(g);
    const own = g.userData.update; if (fns.length) { g.userData.update = t => { if (own) own(t); for (const f of fns) f(t); }; g.userData.composite = true; } return g;
  }
  /** Add an update(t) to a group, keeping any it already has. */
  const chain = (g, fn) => { const prev = g.userData.update; g.userData.update = prev ? t => { prev(t); fn(t); } : fn; return g; };

  // ---------- geometry helpers ----------
  /** Textured box standing at (x, y, z). UVs are in builder space: the texture repeats every `s` metres and runs on across neighbouring boxes. */
  function tbox(w, h, d, m, s = 1, x = 0, y = 0, z = 0) {
    const g = new T.BoxGeometry(w, h, d).translate(0, h / 2, 0), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const f = i >> 2, X = p.getX(i) + x, Y = p.getY(i) + y, Z = p.getZ(i) + z; if (f < 2) uv.setXY(i, Z / s, Y / s); else if (f < 4) uv.setXY(i, X / s, Z / s); else uv.setXY(i, X / s, Y / s); }
    const me = mesh(g, m); me.position.set(x, y, z); return me;
  }
  /** Textured cylinder / frustum standing at (x, y, z), a flat face toward +Z. */
  function tcyl(rt, rb, h, seg, m, s = 1, x = 0, y = 0, z = 0) {
    const g = new T.CylinderGeometry(rt, rb, h, seg, 1).translate(0, h / 2, 0), uv = g.attributes.uv, p = g.attributes.position, nS = (seg + 1) * 2, reps = Math.max(1, Math.round(TAU * (rt + rb) / 2 / s));
    for (let i = 0; i < uv.count; i++) { if (i < nS) uv.setXY(i, uv.getX(i) * reps, (p.getY(i) + y) / s); else uv.setXY(i, p.getX(i) / s, p.getZ(i) / s); }
    g.rotateY(PI / seg); const me = mesh(g, m); me.position.set(x, y, z); return me;
  }
  /** Textured extrusion of a 2D outline (XY) centred on z = 0; texture repeats every `s` metres. o: {holes} */
  function textr(pts, depth, m, s = 1, o = {}) { const me = extrude(pts, depth, m, o), uv = me.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / s, uv.getY(i) / s); me.geometry.translate(0, 0, -depth / 2); return me; }
  /** Flat face (XY plane, facing +Z) from an outline, UVs stretched over its bounding box: signs, shields, panes. */
  function face(pts, m, o) {
    const g = new T.ShapeGeometry(new T.Shape(pts.map(p => new T.Vector2(p[0], p[1])))), uv = g.attributes.uv; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - x0) / (x1 - x0), (uv.getY(i) - y0) / (y1 - y0));
    return mesh(g, m, o);
  }
  /** Outline of an opening w wide and h tall, bottom centre at (0, 0). kind: 'round' | 'point' | 'flat'. */
  function archPts(w, h, kind = 'round', n = 6) {
    const a = w / 2; if (kind === 'flat') return [[-a, 0], [a, 0], [a, h], [-a, h]];
    const pts = [[-a, 0], [a, 0]];
    if (kind === 'round') { const sy = h - a; for (let i = 0; i <= n; i++) { const t = i / n * PI; pts.push([a * Math.cos(t), sy + a * Math.sin(t)]); } }
    else { const sy = h - 0.866 * w, m = Math.max(2, n >> 1); for (let i = 0; i <= m; i++) { const t = i / m * PI / 3; pts.push([-a + w * Math.cos(t), sy + w * Math.sin(t)]); } for (let i = m - 1; i >= 0; i--) { const t = i / m * PI / 3; pts.push([a - w * Math.cos(t), sy + w * Math.sin(t)]); } }
    return pts;
  }
  const _up = new T.Vector3(0, 1, 0);
  /** Round bar from point a to point b. o: {r2 (radius at b), sides} plus material options. */
  function rod(a, b, r, col, o = {}) { const A = V(a), d = V(b).sub(A), len = d.length() || 1e-4, m = cyl(o.r2 ?? r, r, len, o.sides || 5, col, o); m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(_up, d.normalize()); return m; }
  /** Square beam (w wide, h deep) from a to b. */
  function beam(a, b, w, h, col, o) { const A = V(a), B = V(b), m = box(w, h, A.distanceTo(B), col, o); m.position.copy(A).lerp(B, 0.5); m.lookAt(B); return m; }
  /** Re-aim a unit-height cylinder so it spans a..b (for chains and ropes that follow a moving part). */
  function stretch(m, a, b) { const A = V(a), d = V(b).sub(A), len = d.length() || 1e-4; m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(_up, d.normalize()); m.scale.set(1, len, 1); return m; }
  /** Hollow ring (well head, bowl rim): outer radius ro, inner ri, height h. */
  const ring = (ro, ri, h, seg, col, o) => lathe([[ro, 0], [ro, h], [ri, h], [ri, 0], [ro, 0]], seg, col, o);
  /** Teardrop (flame tongue, gem-like drop). */
  const drop = (r, h, seg, col, o) => lathe([[0.0001, 0], [r, h * 0.3], [r * 0.55, h * 0.62], [0.0001, h]], seg, col, o);
  /** Textured surface of revolution (texture repeats every s metres), a flat face toward +Z. */
  function tlathe(profile, seg, m, s = 1) {
    const me = lathe(profile, seg, m), uv = me.geometry.attributes.uv, n = profile.length, cum = [0]; let rmax = 0;
    for (let j = 1; j < n; j++) cum.push(cum[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
    profile.forEach(q => { rmax = Math.max(rmax, q[0]); }); const reps = Math.max(1, Math.round(TAU * rmax / s));
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * reps, cum[i % n] / s);
    me.geometry.rotateY(PI / seg); return me;
  }
  /** Arch-shaped frame open at the bottom (door case, gate surround): outer opening wo x ho around inner wi x hi. */
  function archFrame(wo, ho, wi, hi, kind = 'round', n = 6) { const O = archPts(wo, ho, kind, n), I = archPts(wi, hi, kind, n); return [O[1], ...O.slice(2), O[0], I[0], ...I.slice(2).reverse(), I[1]]; }
  /** Flight of n steps, w wide, rising h in total, back on z = 0 and descending toward +Z. */
  function stairs(w, h, n, tread, m, s = 1.5) { const g = grp(), rise = h / n; for (let i = 0; i < n; i++) tbox(w, rise * (i + 1), tread, m, s, 0, 0, (n - 1 - i + 0.5) * tread).to(g); return g; }
  /** Roof slab hinged on its ridge edge (the X axis): `len` along the ridge, `run` down the slope (+Z before pitching). Texture rows run parallel to the ridge. */
  function roofSlab(len, run, thick, m, s = 2) {
    const g = new T.BoxGeometry(len, thick, run).translate(0, thick / 2, run / 2), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const f = i >> 2; if (f === 2 || f === 3) uv.setXY(i, p.getX(i) / s, -p.getZ(i) / s); else uv.setXY(i, (f < 2 ? p.getZ(i) : p.getX(i)) / s, 0.03); }
    return mesh(g, m);
  }
  /** Gable roof, ridge along X. len = ridge length, span = width across (Z), rise = ridge height above the eave line. Origin at eave level, centre. o: {over: 0.4 (eave overhang), thick: 0.12, s: 2, cap: colour | false} */
  function gableRoof(len, span, rise, m, o = {}) {
    const over = o.over ?? 0.4, thick = o.thick ?? 0.12, g = grp(), pitch = Math.atan2(rise, span / 2), run = Math.hypot(rise, span / 2) + over;
    for (const sz of [1, -1]) { const sl = roofSlab(len, run, thick, m, o.s ?? 2); sl.position.set(0, rise, 0); sl.rotation.set(sz > 0 ? pitch : -pitch, sz > 0 ? 0 : PI, 0); g.add(sl); }
    if (o.cap !== false) { const c = cyl(thick * 1.25, thick * 1.25, len + 0.04, 5, o.cap || C.woodDk); c.rotation.z = PI / 2; c.position.y = rise + thick * 0.75; g.add(c); }
    g.userData = { pitch, run }; return g;
  }
  /** Pointed roof (cone or pyramid) with a roofing texture, base on y = 0, a flat face toward +Z. */
  function roofCone(r, h, sides, m) {
    const g = new T.ConeGeometry(r, h, sides, 1).translate(0, h / 2, 0), uv = g.attributes.uv, reps = Math.max(2, Math.round(TAU * r / 2)), sl = Math.hypot(r, h) / 2;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * reps, uv.getY(i) * sl);
    g.rotateY(PI / sides); return mesh(g, m);
  }

  // ---------- textures (all cached) ----------
  const _tex = new Map(), _tm = new Map(), _gl = new Map();
  const ctex = (key, w, h, draw) => { let t = _tex.get(key); if (!t) { t = S3.canvasTex(w, h, draw, { repeat: [1, 1] }); _tex.set(key, t); } return t; };
  const tmat = (key, mk, o) => { let m = _tm.get(key); if (!m) { m = S3.texMat(mk(), o); _tm.set(key, m); } return m; };
  /** Cached unlit glow material (do not animate it: ask for own = true to get a private one). */
  const glo = (color, k = 1, o = {}) => { if (o.own) return S3.glow(color, k, o); const key = [color, k, o.opacity, o.blend, o.side].join('|'); let m = _gl.get(key); if (!m) { m = S3.glow(color, k, o); _gl.set(key, m); } return m; };

  /** Coursed stone blocks. One repeat = 6 courses (use s = 3 for castle walls: 0.5 m courses; s = 1.5 for small work). o: {seed, rows, rubble} */
  function stoneMat(color = C.stone, o = {}) {
    const col = hex(color), rows = o.rows || 6, seed = o.seed || 1, key = ['stone', col, rows, seed, o.dark ? 1 : 0].join('|');
    return tmat(key, () => ctex(key, 512, 512, (c, w, h) => {
      const r = R(seed, rows), rh = h / rows; c.fillStyle = shade(col, 0.56); c.fillRect(0, 0, w, h);
      for (let j = 0; j < rows; j++) {
        const x0 = r() * 100; let x = x0;
        while (x < x0 + w - 1) {
          let bw = (0.75 + r() * 0.9) * rh * 1.25; if (x + bw > x0 + w - rh * 0.6) bw = x0 + w - x;
          const k = 0.86 + r() * 0.26, t = r(), base = t < 0.1 ? mix(shade(col, k), '#6d7a58', 0.22) : t > 0.9 ? mix(shade(col, k), '#a48b68', 0.2) : shade(col, k);
          for (const dx of [0, -w]) { const X = x + dx + 3, Y = j * rh + 3, BW = bw - 6, BH = rh - 6; c.fillStyle = base; c.fillRect(X, Y, BW, BH); c.fillStyle = 'rgba(255,255,255,.11)'; c.fillRect(X, Y, BW, 5); c.fillStyle = 'rgba(0,0,0,.15)'; c.fillRect(X, Y + BH - 6, BW, 6); c.fillRect(X + BW - 4, Y, 4, BH); }
          x += bw;
        }
      }
      for (let i = 0; i < 70; i++) { c.fillStyle = r() < 0.55 ? 'rgba(0,0,0,.09)' : 'rgba(255,255,255,.07)'; c.fillRect(r() * w, r() * h, 4 + r() * 12, 3 + r() * 5); }
    }), { rough: 0.95 });
  }
  /** Wooden boards. One repeat = `planks` boards. o: {planks, horiz, seed} */
  function woodMat(color = C.wood, o = {}) {
    const col = hex(color), n = o.planks || 4, hz = o.horiz ? 1 : 0, seed = o.seed || 1, key = ['wood', col, n, hz, seed].join('|');
    return tmat(key, () => ctex(key, 256, 256, (c, w, h) => {
      const r = R(seed, n), pw = w / n; if (hz) { c.translate(w, 0); c.rotate(PI / 2); }
      for (let i = 0; i < n; i++) {
        c.fillStyle = shade(col, 0.86 + r() * 0.26); c.fillRect(i * pw, 0, pw + 1, h);
        for (let k = 0; k < 4; k++) { c.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`; c.fillRect(i * pw + 5 + r() * (pw - 10), 0, 2, h); }
        if (r() < 0.45) { c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(i * pw + pw * (0.3 + r() * 0.4), 20 + r() * (h - 40), pw * 0.09, pw * 0.17, 0, 0, TAU); c.fill(); }
        c.fillStyle = shade(col, 0.45); c.fillRect(i * pw, 0, 3, h); c.fillStyle = 'rgba(255,255,255,.09)'; c.fillRect(i * pw + 3, 0, 3, h);
      }
    }), { rough: 0.85 });
  }
  /** Roof coverings: kind 'thatch' | 'tile' | 'slate' | 'shingle'. One repeat = 2 m (v runs up the slope). */
  function roofMat(kind = 'thatch', color) {
    const col = hex(color || { thatch: C.thatch, tile: C.tile, slate: C.slate, shingle: C.woodDk }[kind] || C.thatch), key = ['roof', kind, col].join('|');
    return tmat(key, () => ctex(key, 256, 256, (c, w, h) => {
      const r = R(11, kind.length);
      if (kind === 'thatch') {
        const rows = 4, rh = h / rows;
        for (let j = 0; j < rows; j++) {
          const g = c.createLinearGradient(0, j * rh, 0, (j + 1) * rh); g.addColorStop(0, shade(col, 0.6)); g.addColorStop(0.18, shade(col, 0.86)); g.addColorStop(1, shade(col, 1.1)); c.fillStyle = g; c.fillRect(0, j * rh, w, rh);
          for (let i = 0; i < 70; i++) { const x = r() * w, y = j * rh + r() * rh * 0.85; c.fillStyle = r() < 0.5 ? 'rgba(70,50,15,.2)' : 'rgba(255,244,205,.18)'; c.fillRect(x, y, 2 + r() * 2, 10 + r() * rh * 0.45); }
          for (let x = 0; x < w;) { const bw = 8 + r() * 16, dy = r() * 7; c.fillStyle = shade(col, 0.5); c.fillRect(x, (j + 1) * rh - 3 - dy, bw, 4 + dy); x += bw + r() * 10; }
        }
      } else {
        const rows = kind === 'tile' ? 6 : 5, cols = kind === 'tile' ? 6 : 5, rh = h / rows, tw = w / cols; c.fillStyle = shade(col, 0.5); c.fillRect(0, 0, w, h);
        for (let j = 0; j < rows; j++) for (let i = -1; i <= cols; i++) {
          const x = (i + (j % 2) * 0.5) * tw, y = j * rh; c.fillStyle = shade(col, 0.8 + r() * 0.34);
          if (kind === 'tile') { c.beginPath(); c.moveTo(x + 2, y); c.lineTo(x + tw - 2, y); c.lineTo(x + tw - 2, y + rh * 0.55); c.quadraticCurveTo(x + tw / 2, y + rh * 1.25, x + 2, y + rh * 0.55); c.closePath(); c.fill(); }
          else { c.fillRect(x + 2, y + 2, tw - 4, rh - 3); c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(x + 2, y + 2, tw - 4, 4); }
          c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x + 2, y + rh - 5, tw - 4, 4);
        }
      }
    }), { rough: kind === 'slate' ? 0.6 : 0.95 });
  }
  /** Lime plaster / daub, gently mottled. */
  function plasterMat(color = C.plaster, seed = 1) {
    const col = hex(color), key = ['plaster', col, seed].join('|');
    return tmat(key, () => ctex(key, 256, 256, (c, w, h) => {
      const r = R(seed, 3); c.fillStyle = col; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) { c.fillStyle = r() < 0.5 ? 'rgba(90,70,40,.06)' : 'rgba(255,255,255,.07)'; c.beginPath(); c.ellipse(r() * w, r() * h, 20 + r() * 50, 12 + r() * 30, r() * 3, 0, TAU); c.fill(); }
      c.strokeStyle = 'rgba(70,55,35,.2)'; c.lineWidth = 1.5; for (let i = 0; i < 5; i++) { let x = r() * w, y = r() * h; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 26; y += 8 + r() * 14; c.lineTo(x, y); } c.stroke(); }
    }), { rough: 1 });
  }
  /** Ground paving. kind 'cobble' | 'flag' | 'checker'. One repeat = 2 m. */
  function paveMat(kind = 'cobble', color = C.stone, color2) {
    const col = hex(color), c2 = hex(color2 || shade(col, 0.6)), key = ['pave', kind, col, c2].join('|');
    return tmat(key, () => ctex(key, 512, 512, (c, w, h) => {
      const r = R(5, kind.length);
      if (kind === 'checker') { const n = 4, s = w / n; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { c.fillStyle = shade((i + j) % 2 ? col : c2, 0.94 + r() * 0.12); c.fillRect(i * s, j * s, s, s); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 3; c.strokeRect(i * s, j * s, s, s); c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(i * s + 3, j * s + 3, s - 6, 5); } return; }
      c.fillStyle = shade(col, 0.5); c.fillRect(0, 0, w, h);
      if (kind === 'cobble') { const n = 9, s = w / n; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i + 0.5 + (j % 2) * 0.5) * s + (r() - 0.5) * 8, y = (j + 0.5) * s + (r() - 0.5) * 8; for (const dx of [0, -w]) { c.fillStyle = shade(col, 0.8 + r() * 0.3); c.beginPath(); c.ellipse(x + dx, y, s * (0.4 + r() * 0.07), s * (0.36 + r() * 0.08), r() * 3, 0, TAU); c.fill(); } } }
      else { const rows = 4, rh = h / rows; for (let j = 0; j < rows; j++) { const x0 = r() * 120; let x = x0; while (x < x0 + w - 1) { let bw = 90 + r() * 110; if (x + bw > x0 + w - 60) bw = x0 + w - x; const sh = shade(col, 0.82 + r() * 0.28); for (const dx of [0, -w]) { c.fillStyle = sh; c.fillRect(x + dx + 3, j * rh + 3, bw - 6, rh - 6); c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(x + dx + 3, j * rh + 3, bw - 6, 5); } x += bw; } } }
    }), { rough: 0.95 });
  }
  /** Leaded glass, dark by day or glowing when lit. */
  function glassMat(lit, tint) {
    const key = ['glass', lit ? 1 : 0, tint || ''].join('|');
    return tmat(key, () => ctex(key, 128, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, lit ? 0 : w, h);
      if (lit) { g.addColorStop(0, mix(tint || '#ffd98a', '#ffffff', 0.3)); g.addColorStop(1, tint || '#ffa53d'); } else { g.addColorStop(0, '#465a70'); g.addColorStop(0.5, '#1d2732'); g.addColorStop(1, '#31414f'); }
      c.fillStyle = g; c.fillRect(0, 0, w, h); c.strokeStyle = lit ? 'rgba(70,35,10,.6)' : 'rgba(8,10,14,.75)'; c.lineWidth = 4;
      for (let i = -4; i <= 8; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32 + 128, 128); c.stroke(); c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32 - 128, 128); c.stroke(); }
    }), lit ? { basic: true } : { rough: 0.2 });
  }
  /** A painted board or cloth with text. o: {w, h (pixels), font, color, bg, border, sub} */
  function textTex(text, o = {}) {
    const w = o.w || 512, h = o.h || 256, key = ['text', text, w, h, o.font, o.color, o.bg, o.border, o.sub, o.grain].join('|');
    return ctex(key, w, h, c => {
      c.fillStyle = o.bg || C.woodLt; c.fillRect(0, 0, w, h);
      if (o.grain !== false) { const r = R(text.length + 3, 1); for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.06})`; c.fillRect(0, r() * h, w, 2 + r() * 3); } }
      if (o.border) { c.strokeStyle = o.border; c.lineWidth = h * 0.05; c.strokeRect(h * 0.055, h * 0.055, w - h * 0.11, h - h * 0.11); }
      const lines = String(text).split('\n'); let size = o.size || h * 0.5 / Math.max(1, lines.length * 0.72); c.textAlign = 'center'; c.textBaseline = 'middle';
      const fam = o.font || '800 %px Cinzel, Georgia, serif'; for (; size > 10; size -= 2) { c.font = fam.replace('%', size); if (lines.every(l => c.measureText(l).width < w * 0.84)) break; }
      lines.forEach((l, i) => { const y = h / 2 + (i - (lines.length - 1) / 2) * size * 1.08 + size * 0.04; c.fillStyle = 'rgba(0,0,0,.35)'; c.fillText(l, w / 2 + 2, y + 3); c.fillStyle = o.color || '#2a1a0e'; c.fillText(l, w / 2, y); });
    });
  }

  // ---------- fire ----------
  function _flame(size = 1, color = C.fire, seed = 1) {
    const g = grp(), hot = mix(color, '#ffe58a', 0.6), core = mix(color, '#fff7d6', 0.85), red = mix(color, '#e8361a', 0.45);
    [[0, 0, 0.17, 0.72, color, 1.5], [0.09, 0.03, 0.12, 0.5, hot, 1.6], [-0.08, 0.06, 0.11, 0.44, red, 1.4], [-0.02, -0.1, 0.11, 0.48, hot, 1.6], [0.01, 0.05, 0.1, 0.3, core, 1.8]]
      .forEach(([x, z, r, h, c, k], i) => { const m = drop(r * size, h * size, 5, glo(c, k)).at(x * size, 0, z * size); m.rotation.y = i * 1.3; g.add(m); });
    g.userData.lick = t => g.children.forEach((m, i) => { const a = noise1(t * 6 + i * 3.1, seed + i), b = noise1(t * 8.5 + i * 1.7, seed + i + 9); m.scale.set(1 + a * 0.14, 1 + b * 0.26, 1 + a * 0.14); m.rotation.z = 0.16 * noise1(t * 4.3 + i, seed + 20 + i); m.rotation.x = 0.16 * noise1(t * 3.7 + i, seed + 40 + i); });
    return g;
  }
  /** A cluster of flame tongues about 0.7 x `size` metres tall (1 = a campfire). userData.update(t) makes it lick and flicker. o: {size: 1, color, seed} */
  function flame(o = {}) { const f = _flame(o.size ?? 1, o.color || C.fire, o.seed || 1); f.userData.update = f.userData.lick; return f; }
  /** Put fire on group g at one or several local points. Fills userData.flame, .flames, .flares, .lightPos, .setLit, and chains update(t). */
  function addFire(g, pts, size, o = {}) {
    if (typeof pts[0] === 'number') pts = [pts];
    const color = o.color || C.fire, seed = o.seed || 1, fs = [], hs = [], c = [0, 0, 0];
    pts.forEach((p, i) => {
      const f = (size < 0.12 ? grp(drop(size * 0.22, size, 5, glo(mix(color, '#fff2b8', 0.6), 1.7))) : _flame(size, color, seed + i * 7)).at(p[0], p[1], p[2]); g.add(f); fs.push(f);
      const h = flare(color, o.halo ?? Math.max(0.4, size * 2.4), o.haloOpacity ?? 0.3).at(p[0], p[1] + size * 0.35, p[2]); g.add(h); hs.push(h); c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length;
    });
    const U = g.userData, op = o.haloOpacity ?? 0.3; U.flame = fs[0]; U.flames = fs; U.flares = hs; U.lightPos = [c[0], c[1] + size * 0.4, c[2]]; U.lightColor = color; U.lit = true;
    U.setLit = on => { U.lit = !!on; fs.forEach(f => { f.visible = !!on; }); hs.forEach(h => { h.visible = !!on; }); if (U.embers) U.embers.visible = !!on; };
    chain(g, t => { fs.forEach((f, i) => { if (f.userData.lick) f.userData.lick(t + i * 1.7); else f.scale.y = 1 + 0.18 * noise1(t * 9 + i * 2.3, seed + i); }); hs.forEach((h, i) => { h.material.opacity = op * S3.flicker(t + i, 0.3, 9, seed + i); }); });
    if (o.lit === false) U.setLit(false);
    return g;
  }

  /** Wall torch in an iron bracket. Back on z = 0, hangs at o.y. o: {y: 1.7, lit: true, color (flame), seed} */
  function wallTorch(o = {}) {
    const { y = 1.7, lit = true, color = C.fire, seed = 1 } = o, g = grp(), st = grp();
    box(0.13, 0.36, 0.03, C.iron, IRON).at(0, y, 0.015).to(st); box(0.17, 0.05, 0.035, C.iron, IRON).at(0, y + 0.13, 0.018).to(st); box(0.17, 0.05, 0.035, C.iron, IRON).at(0, y - 0.13, 0.018).to(st);
    rod([0, y - 0.1, 0.03], [0, y + 0.02, 0.24], 0.017, C.iron, IRON).to(st); rod([0, y + 0.12, 0.03], [0, y + 0.06, 0.25], 0.013, C.iron, IRON).to(st);
    const a = V([0, y - 0.3, 0.16]), b = V([0, y + 0.3, 0.34]), d = b.clone().sub(a).normalize();
    rod(a, b, 0.026, C.woodDk, { r2: 0.036, sides: 6 }).to(st);
    torus(0.05, 0.014, C.iron, { ...IRON, rs: 4, ts: 8 }).at(0, y + 0.04, 0.262).rot(PI / 2 - 0.29, 0, 0).to(st);
    const top = b.clone().addScaledVector(d, 0.08); rod(b.clone().addScaledVector(d, -0.03), top, 0.05, '#2b2420', { r2: 0.062, sides: 6 }).to(st);
    g.add(bake(st)); addFire(g, [top.x, top.y - 0.02, top.z], 0.5, { color, seed, lit, halo: 1.5 });
    return g;
  }
  /** Standing fire bowl. o: {height: 1.25, style: 'tripod' | 'pillar', lit: true, color (flame), stone, seed} */
  function brazier(o = {}) {
    const { height = 1.25, style = 'tripod', lit = true, color = C.fire, stone = C.stone, seed = 1 } = o, g = grp(), st = grp(), br = 0.34, by = height - 0.24;
    if (style === 'pillar') {
      tbox(0.72, 0.16, 0.72, stoneMat(stone), 1.5).to(st); tcyl(0.22, 0.28, by - 0.26, 8, stoneMat(stone), 1.5, 0, 0.16, 0).to(st); tbox(0.56, 0.1, 0.56, stoneMat(shade(stone, 1.08)), 1.5, 0, by - 0.1, 0).to(st);
    } else {
      for (let i = 0; i < 3; i++) { const an = i * TAU / 3 + 0.5; rod([Math.sin(an) * 0.36, 0, Math.cos(an) * 0.36], [Math.sin(an) * 0.12, by + 0.02, Math.cos(an) * 0.12], 0.022, C.iron, IRON).to(st); box(0.1, 0.02, 0.1, C.iron, IRON).at(Math.sin(an) * 0.37, 0.01, Math.cos(an) * 0.37).to(st); }
      torus(0.2, 0.014, C.iron, { ...IRON, rs: 4, ts: 9 }).at(0, by * 0.45, 0).rot(PI / 2, 0, 0).to(st);
    }
    lathe([[0.06, by - 0.02], [0.2, by + 0.02], [br, by + 0.17], [br + 0.03, by + 0.24], [br - 0.01, by + 0.24], [br - 0.04, by + 0.18], [0.16, by + 0.07], [0.0001, by + 0.06]], 9, C.iron, IRON).to(st);
    const r = R(seed, 2); for (let i = 0; i < 7; i++) blob(0.07 + r() * 0.04, '#2a211d', seed + i, { detail: 0 }).at((r() - 0.5) * 0.36, by + 0.15 + r() * 0.03, (r() - 0.5) * 0.36).to(st);
    g.add(bake(st));
    const em = grp(); for (let i = 0; i < 5; i++) blob(0.06 + r() * 0.03, glo('#ff5a1a', 1.5), seed + 20 + i, { detail: 0 }).at((r() - 0.5) * 0.3, by + 0.19, (r() - 0.5) * 0.3).to(em); g.add(em); g.userData.embers = em;
    addFire(g, [0, by + 0.17, 0], 0.62, { color, seed, lit, halo: 2 });
    return g;
  }

  // ---------- castle ----------
  const stoneSet = (color, seed) => ({ sm: stoneMat(color, { seed }), lt: stoneMat(shade(color, 1.1), { seed: seed + 3 }), dk: stoneMat(shade(color, 0.82), { seed: seed + 5 }), tc: shade(color, 1.24) });
  /** Arrow slit, back on z = 0, bottom at y = 0. */
  const slit = (h = 1.0, trim = C.stoneLt) => grp(box(0.1, h, 0.03, C.dark).at(0, h / 2, 0.016), box(0.34, 0.09, 0.07, trim).at(0, -0.045, 0.02), box(0.3, 0.08, 0.06, trim).at(0, h + 0.04, 0.02));
  /** Plain extrusion centred on z = 0. */
  const xtr = (pts, depth, col, o) => { const m = extrude(pts, depth, col, o); m.geometry.translate(0, 0, -depth / 2); return m; };
  /** Arched window in a stone surround, back on z = 0, sill at y = 0. o: {lit, arch: 'round' | 'point', border, stone, tint} */
  function archWin(w, h, o = {}) {
    const b = o.border ?? 0.14, kind = o.arch || 'round', dep = 0.14, inner = archPts(w, h, kind), outer = archPts(w + b * 2, h + b * 2, kind).map(p => [p[0], p[1] - b]);
    const g = grp(extrude(outer, dep, o.stone || C.stoneLt, { holes: [inner] }), face(inner, glassMat(o.lit, o.tint)).at(0, 0, dep * 0.4), box(w + b * 2 + 0.1, 0.09, dep + 0.06, o.stone || C.stoneLt).at(0, -b - 0.02, (dep + 0.06) / 2));
    if (w > 0.6) box(0.05, h - w * 0.3, 0.04, C.woodDk).at(0, (h - w * 0.3) / 2, dep * 0.55).to(g);
    g.userData.pane = g.children[1]; return g;
  }
  /**
   * Plank door with iron straps and a ring pull, standing in the XY plane with its back on z = 0, centred on x.
   * Returns a group; userData.leaf is hinged on its left edge and userData.open(k) swings it outward (toward +Z).
   * o: {arch: 'flat' | 'round' | 'point', color, swing: 1.9 (radians at k = 1)}
   */
  function plankDoor(w, h, o = {}) {
    const g = grp(), leaf = grp(), kind = o.arch || 'flat', pts = archPts(w, h, kind), st = grp();
    textr(pts, 0.05, woodMat(o.color || C.wood, { planks: 5 }), 1).at(w / 2, 0, 0.025).to(st);
    const sy = kind === 'flat' ? h : kind === 'round' ? h - w / 2 : h - 0.866 * w;
    for (const yy of [0.32, Math.max(0.9, sy - 0.25)]) { box(w * 0.8, 0.075, 0.016, C.iron, IRON).at(w * 0.42, yy, 0.058).to(st); cone(0.055, 0.11, 4, C.iron, IRON).at(w * 0.87, yy, 0.058).rot(0, 0, -PI / 2).to(st); }
    torus(0.065, 0.014, C.iron, { ...IRON, rs: 4, ts: 8 }).at(w * 0.82, h * 0.45, 0.07).to(st); box(0.07, 0.11, 0.02, C.iron, IRON).at(w * 0.82, h * 0.45 + 0.07, 0.06).to(st);
    leaf.add(bake(st)); leaf.position.set(-w / 2, 0, 0.012); leaf.userData.live = true; g.add(leaf);
    const dk = face(pts, mat('#0b0a0a', { rough: 1 })).at(0, 0, 0.006); dk.castShadow = false; g.add(dk);
    g.userData.leaf = leaf; g.userData.open = k => { leaf.rotation.y = -clamp(k) * (o.swing ?? 1.9); }; return g;
  }
  /** Merlons along X on a parapet: n teeth over `len`, tiling with half gaps at both ends. */
  function merlons(to, len, n, y, z, m, o = {}) {
    const p = len / n, mw = p * (o.fill ?? 0.6), mh = o.h ?? 0.85, th = o.th ?? 0.45, cap = o.cap;
    for (let i = 0; i < n; i++) { const x = -len / 2 + (i + 0.5) * p + (o.x || 0); tbox(mw, mh, th, m, o.s || 3, x, y, z).to(to); if (cap) box(mw + 0.08, 0.09, th + 0.08, cap).at(x, y + mh + 0.045, z).to(to); if (o.slits && i % 2 === (o.slits === 2 ? 1 : 0)) box(0.08, mh * 0.55, 0.03, C.dark).at(x, y + mh * 0.5, z + (o.back ? -1 : 1) * (th / 2 + 0.008)).to(to); }
  }
  /**
   * Curtain wall segment with a crenellated parapet on the outer (+Z) face. Segments of the same length tile along X.
   * o: {length: 8, height: 6, thick: 1.6, color, seed, parapet: 'outer' | 'both' | 'none', slits: true}
   * userData: {length, height, thick, walkY (top of the wall walk)}
   */
  function wall(o = {}) {
    const { length = 8, height = 6, thick = 1.6, color = C.stone, seed = 1, parapet = 'outer', slits = true } = o, g = grp(), st = grp();
    const s = length / Math.max(1, Math.round(length / 3)), { sm, lt, tc } = stoneSet(color, seed), n = Math.max(1, Math.round(length / 1.6));
    tbox(length, height, thick, sm, s).to(st); tbox(length, 0.75, thick + 0.36, sm, s).to(st); tbox(length, 0.16, thick + 0.2, lt, s, 0, 0.75, 0).to(st);
    tbox(length, 0.24, thick + 0.34, lt, s, 0, height - 0.24, 0).to(st);
    if (parapet !== 'none') for (const sd of parapet === 'both' ? [1, -1] : [1]) { const pz = sd * (thick / 2 - 0.08); tbox(length, 0.95, 0.45, sm, s, 0, height, pz).to(st); merlons(st, length, n, height + 0.95, pz, sm, { s, cap: tc, slits: slits && sd > 0 ? 1 : 0 }); }
    if (parapet === 'outer') tbox(length, 0.22, 0.3, lt, s, 0, height, -thick / 2 + 0.15).to(st);
    g.add(bake(st)); g.userData = { length, height, thick, walkY: height }; return g;
  }
  // ---------- heraldry: emblems, banners, shields ----------
  /** Draw a simple device centred at (cx, cy) inside a circle of radius s. kind: sun moon star tower crown cross tree sword skull flame eye chevron none */
  function drawEmblem(c, kind, cx, cy, s, fg, bg = '#000000') {
    c.save(); c.translate(cx, cy); c.fillStyle = fg; c.strokeStyle = fg; c.lineJoin = 'round'; c.lineCap = 'round';
    const P = (pts, col) => { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0] * s, p[1] * s) : c.moveTo(p[0] * s, p[1] * s)); c.closePath(); c.fillStyle = col || fg; c.fill(); };
    const O = (x, y, r, col) => { c.beginPath(); c.arc(x * s, y * s, r * s, 0, TAU); c.fillStyle = col || fg; c.fill(); };
    if (kind === 'sun') { O(0, 0, 0.46); for (let i = 0; i < 12; i++) { const a = i * TAU / 12, r = i % 2 ? 0.82 : 1; P([[Math.cos(a - 0.13) * 0.56, Math.sin(a - 0.13) * 0.56], [Math.cos(a) * r, Math.sin(a) * r], [Math.cos(a + 0.13) * 0.56, Math.sin(a + 0.13) * 0.56]]); } }
    else if (kind === 'moon') { c.beginPath(); c.arc(-0.12 * s, 0, 0.8 * s, 0.9184, TAU - 0.9184); c.arc(0.23 * s, 0, 0.65 * s, TAU - 1.3605, 1.3605, true); c.closePath(); c.fill(); O(0.52, -0.5, 0.09); }
    else if (kind === 'star') { const p = []; for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, r = i % 2 ? 0.42 : 1; p.push([Math.cos(a) * r, Math.sin(a) * r]); } P(p); }
    else if (kind === 'tower') { P([[-0.5, 0.9], [-0.5, -0.3], [-0.7, -0.3], [-0.7, -0.9], [-0.42, -0.9], [-0.42, -0.62], [-0.14, -0.62], [-0.14, -0.9], [0.14, -0.9], [0.14, -0.62], [0.42, -0.62], [0.42, -0.9], [0.7, -0.9], [0.7, -0.3], [0.5, -0.3], [0.5, 0.9]]); P([[-0.16, 0.9], [-0.16, 0.42], [0, 0.26], [0.16, 0.42], [0.16, 0.9]], bg); P([[-0.07, 0.02], [-0.07, -0.2], [0.07, -0.2], [0.07, 0.02]], bg); }
    else if (kind === 'crown') { P([[-0.82, 0.55], [-0.95, -0.45], [-0.45, 0.02], [0, -0.7], [0.45, 0.02], [0.95, -0.45], [0.82, 0.55]]); c.fillStyle = bg; c.fillRect(-0.74 * s, 0.26 * s, 1.48 * s, 0.07 * s); O(0, -0.72, 0.1); O(-0.95, -0.47, 0.09); O(0.95, -0.47, 0.09); O(0, 0.08, 0.1, bg); }
    else if (kind === 'cross') { P([[-0.16, -0.95], [0.16, -0.95], [0.16, -0.42], [0.66, -0.42], [0.66, -0.1], [0.16, -0.1], [0.16, 0.95], [-0.16, 0.95], [-0.16, -0.1], [-0.66, -0.1], [-0.66, -0.42], [-0.16, -0.42]]); }
    else if (kind === 'tree') { P([[-0.1, 0.95], [-0.14, 0.2], [0.14, 0.2], [0.1, 0.95]]); P([[-0.34, 0.95], [0, 0.82], [0.34, 0.95]]); O(0, -0.35, 0.52); O(-0.42, -0.02, 0.36); O(0.42, -0.02, 0.36); O(0, -0.72, 0.3); }
    else if (kind === 'sword') { P([[0, -1], [0.13, -0.78], [0.13, 0.36], [-0.13, 0.36], [-0.13, -0.78]]); P([[-0.5, 0.36], [0.5, 0.36], [0.5, 0.5], [-0.5, 0.5]]); P([[-0.07, 0.5], [0.07, 0.5], [0.07, 0.82], [-0.07, 0.82]]); O(0, 0.9, 0.12); }
    else if (kind === 'skull') {
      c.lineWidth = 0.17 * s; for (const d of [-1, 1]) { c.beginPath(); c.moveTo(-0.78 * s * d, 0.2 * s); c.lineTo(0.78 * s * d, 0.95 * s); c.stroke(); O(-0.82 * d, 0.14, 0.11); O(-0.72 * d, 0.3, 0.11); O(0.84 * d, 0.88, 0.11); O(0.74 * d, 1.02, 0.11); }
      O(0, -0.28, 0.58); P([[-0.34, 0.1], [0.34, 0.1], [0.3, 0.52], [-0.3, 0.52]]); O(-0.24, -0.26, 0.16, bg); O(0.24, -0.26, 0.16, bg); P([[0, -0.06], [0.09, 0.12], [-0.09, 0.12]], bg); for (const x of [-0.15, 0, 0.15]) { c.fillStyle = bg; c.fillRect((x - 0.02) * s, 0.3 * s, 0.04 * s, 0.22 * s); }
    }
    else if (kind === 'flame') { c.beginPath(); c.moveTo(0, -s); c.bezierCurveTo(0.2 * s, -0.5 * s, 0.75 * s, -0.1 * s, 0.6 * s, 0.45 * s); c.bezierCurveTo(0.5 * s, 0.85 * s, 0.15 * s, 0.95 * s, 0, 0.95 * s); c.bezierCurveTo(-0.3 * s, 0.95 * s, -0.7 * s, 0.75 * s, -0.6 * s, 0.25 * s); c.bezierCurveTo(-0.55 * s, 0, -0.3 * s, -0.15 * s, -0.3 * s, -0.4 * s); c.bezierCurveTo(-0.1 * s, -0.3 * s, -0.05 * s, -0.7 * s, 0, -s); c.fill(); c.fillStyle = bg; c.beginPath(); c.ellipse(0.02 * s, 0.5 * s, 0.2 * s, 0.33 * s, 0, 0, TAU); c.fill(); }
    else if (kind === 'eye') { c.beginPath(); c.moveTo(-s, 0); c.quadraticCurveTo(0, -0.95 * s, s, 0); c.quadraticCurveTo(0, 0.95 * s, -s, 0); c.fill(); O(0, 0, 0.36, bg); O(0, 0, 0.17); }
    else if (kind === 'chevron') { P([[-0.9, 0.5], [0, -0.5], [0.9, 0.5], [0.9, 0.9], [0, -0.1], [-0.9, 0.9]]); P([[-0.9, -0.2], [0, -1.2], [0.9, -0.2], [0.9, 0.05], [0, -0.92], [-0.9, 0.05]]); }
    c.restore();
  }
  const clothMat = (o) => {
    const { color = C.red, trim = C.gold, emblem = 'sun', w = 256, h = 512, at = 0.36, size = 0.3, border = true } = o, ec = o.emblemColor || trim, key = ['cloth', color, trim, emblem, ec, w, h, at, size, border, o.stripes || ''].join('|');
    return tmat(key, () => ctex(key, w, h, c => {
      c.fillStyle = hex(color); c.fillRect(0, 0, w, h);
      if (o.stripes) { c.fillStyle = hex(o.stripes); const n = 6; for (let i = 0; i < n; i += 2) c.fillRect(i * w / n, 0, w / n, h); }
      for (let y = 0; y < h; y += 6) { c.fillStyle = 'rgba(0,0,0,.05)'; c.fillRect(0, y, w, 2); }
      if (border) { c.fillStyle = hex(trim); c.fillRect(0, 0, w * 0.055, h); c.fillRect(w * 0.945, 0, w * 0.055, h); c.fillRect(0, 0, w, w * 0.08); c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(w * 0.055, w * 0.08, w * 0.89, 3); }
      if (emblem && emblem !== 'none') drawEmblem(c, emblem, w / 2, h * at, w * size, hex(ec), hex(color));
    }), { side: 'double', rough: 1 });
  };
  /**
   * Cloth banner with a heraldic device.
   * o: {width: 1.1, height: 2.8, color, trim, emblem ('sun' moon star tower crown cross tree sword skull flame eye chevron none), emblemColor,
   *     tail: 'swallow' | 'point' | 'flat', mount: 'wall' (back on z = 0) | 'pole' (free-standing) | 'hang' (rod and cords, hangs free), y (top of the cloth), wave: 0.05, seed}
   * userData: {cloth, update(t) (slow sway)}
   */
  function banner(o = {}) {
    const { width = 1.1, height = 2.8, color = C.red, trim = C.gold, emblem = 'sun', tail = 'swallow', mount = 'wall', wave = 0.05, seed = 1 } = o;
    const y = o.y ?? (mount === 'pole' ? height + 0.85 : 4), g = grp(), st = grp(), geo = new T.PlaneGeometry(width, height, 4, 7), P = geo.attributes.position, base = [], wall = mount === 'wall';
    for (let i = 0; i < P.count; i++) { const u = P.getX(i) / width + 0.5, v = 0.5 - P.getY(i) / height, sh = tail === 'swallow' ? 1 - Math.abs(2 * u - 1) : tail === 'point' ? Math.abs(2 * u - 1) : 0; P.setY(i, -height * (v <= 5 / 7 ? v : 5 / 7 + (v - 5 / 7) * (1 - 0.6 * sh))); base.push(u, v); }
    const cloth = mesh(geo, clothMat({ color, trim, emblem, emblemColor: o.emblemColor })); cloth.position.set(0, y - 0.05, wall ? 0.1 : mount === 'pole' ? 0.07 : 0);
    const shape = t => { for (let i = 0; i < P.count; i++) { const u = base[i * 2], v = base[i * 2 + 1]; P.setZ(i, wave * (0.25 + v) * Math.sin(u * 7.5 + seed * 1.7 + t * 1.5) + (wall ? 0 : wave * 1.8 * v * v * Math.sin(t * 0.9 + seed))); } P.needsUpdate = true; };
    shape(0); g.add(cloth);
    cyl(0.028, 0.028, width + 0.26, 6, C.woodDk).rot(0, 0, PI / 2).at(0, y, cloth.position.z).to(st);
    for (const sx of [-1, 1]) { ball(0.05, C.gold, 0, GOLD).at(sx * (width / 2 + 0.15), y, cloth.position.z).to(st); if (wall) rod([sx * width * 0.36, y, 0], [sx * width * 0.36, y, 0.1], 0.014, C.iron, IRON).to(st); if (mount === 'hang') rod([sx * width * 0.42, y, 0], [0, y + 0.55, 0], 0.01, C.rope).to(st); }
    if (mount === 'pole') { cylB(0.035, 0.045, y + 0.3, 6, C.woodDk).to(st); cone(0.05, 0.16, 5, C.gold, GOLD).at(0, y + 0.38, 0).to(st); cylB(0.2, 0.26, 0.1, 8, C.stoneDk).to(st); cylB(0.1, 0.16, 0.2, 8, C.stoneDk).to(st); }
    g.add(bake(st)); g.userData = { cloth, update: shape }; return g;
  }
  /**
   * Heraldic shield. o: {shape: 'heater' | 'round', size: 0.95 (height), color, color2 (other half of the field), emblem, emblemColor, trim,
   *     mount: 'wall' (back on z = 0, bottom at o.y) | 'lean' (resting on the ground, tilted back), y: 1.6}
   */
  function shield(o = {}) {
    const { shape = 'heater', size = 0.95, color = C.red, color2 = null, emblem = 'tower', trim = C.steel, mount = 'wall' } = o, y = o.y ?? (mount === 'wall' ? 1.6 : 0), g = grp(), st = grp(), w = size * 0.82;
    const ec = o.emblemColor || '#f3e7c6', key = ['shield', shape, color, color2, emblem, ec].join('|');
    const m = tmat(key, () => ctex(key, 256, 256, (c, W, H) => {
      c.fillStyle = hex(color); c.fillRect(0, 0, W, H); if (color2) { c.fillStyle = hex(color2); c.fillRect(W / 2, 0, W / 2, H); }
      if (shape === 'round') { for (let i = 0; i < 8; i++) { c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 3; c.beginPath(); c.moveTo(W / 2, H / 2); c.lineTo(W / 2 + Math.cos(i * PI / 4) * W, H / 2 + Math.sin(i * PI / 4) * W); c.stroke(); } if (color2) { c.fillStyle = hex(color2); for (let i = 0; i < 8; i += 2) { c.beginPath(); c.moveTo(W / 2, H / 2); c.arc(W / 2, H / 2, W, i * PI / 4, (i + 1) * PI / 4); c.fill(); } } }
      else { c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(0, 0, W, 10); }
      if (emblem && emblem !== 'none') drawEmblem(c, emblem, W / 2, H * (shape === 'round' ? 0.5 : 0.4), W * (shape === 'round' ? 0.2 : 0.25), ec, hex(color));
    }), { rough: 0.6 });
    if (shape === 'round') { const r = size / 2, cp = []; for (let i = 0; i < 14; i++) cp.push([Math.cos(i * TAU / 14) * (r - 0.035), Math.sin(i * TAU / 14) * (r - 0.035)]); cyl(r, r, 0.045, 14, trim, STEEL).rot(PI / 2, 0, 0).at(0, r, 0.0225).to(st); face(cp, m).at(0, r, 0.048).to(st); ball(0.1, trim, 1, STEEL).scl(1, 1, 0.55).at(0, r, 0.06).to(st); }
    else { const out = [[-0.5, 1], [0.5, 1], [0.5, 0.5], [0.42, 0.27], [0.24, 0.09], [0, 0], [-0.24, 0.09], [-0.42, 0.27], [-0.5, 0.5]], sc = k => out.map(([x, yy]) => [x * w * k, (yy - 0.5) * size * k + size * 0.5]); extrude(sc(1), 0.045, trim, STEEL).to(st); face(sc(0.91), m).at(0, 0, 0.049).to(st); }
    const b = bake(st); if (mount === 'lean') { b.rotation.x = -0.3; b.position.set(0, 0, 0); } else b.position.y = y; g.add(b); return g;
  }
  /**
   * Double doors in an arched or flat opening, back on z = 0. userData.open(k) swings both leaves (outward toward +Z, or inward with inward: true).
   * o: {arch: 'round' | 'point' | 'flat', color, inward: false, swing: 1.5}
   */
  function doubleDoor(w, h, o = {}) {
    const g = grp(), a = w / 2, kind = o.arch || 'round', pts = [[-a, 0], [0, 0]], leaves = [], wm = woodMat(o.color || C.woodDk, { planks: 5 });   // leaf outline: hinge edge on x = 0, meeting edge on x = -a
    if (kind === 'flat') pts.push([0, h], [-a, h]); else if (kind === 'round') { const sy = h - a; for (let i = 0; i <= 5; i++) { const t = i / 5 * PI / 2; pts.push([-a + a * Math.cos(t), sy + a * Math.sin(t)]); } } else { const sy = h - 0.866 * w; for (let i = 0; i <= 4; i++) { const t = i / 4 * PI / 3; pts.push([-w + w * Math.cos(t), sy + w * Math.sin(t)]); } }
    for (const sx of [1, -1]) {   // sx = 1: hinge on the right edge (x = +a), leaf reaches to the centre
      const st = grp(), leaf = grp(); textr(pts.map(p => [p[0], p[1]]), 0.09, wm, 1).at(0, 0, 0.045).to(st);
      for (const yy of [0.45, h * 0.52]) { box(a * 0.86, 0.1, 0.02, C.iron, IRON).at(-a * 0.45, yy, 0.1).to(st); for (let i = 0; i < 3; i++) cone(0.035, 0.05, 4, C.iron, IRON).at(-a * (0.15 + i * 0.3), yy, 0.115).rot(PI / 2, 0, 0).to(st); }
      torus(0.09, 0.018, C.iron, { ...IRON, rs: 4, ts: 8 }).at(-a + 0.2, h * 0.36, 0.115).to(st);
      const b = bake(st); b.scale.x = sx; leaf.add(b); leaf.position.set(sx * a, 0, 0.01); leaf.userData.live = true; g.add(leaf); leaves.push(leaf);
    }
    const full = archPts(w, h, kind), dk = face(full, mat('#0b0a0a', { rough: 1 })).at(0, 0, 0.004); dk.castShadow = false; g.add(dk);
    g.userData.leaves = leaves; g.userData.open = k => { const an = clamp(k) * (o.swing ?? 1.5) * (o.inward ? -1 : 1); leaves[0].rotation.y = an; leaves[1].rotation.y = -an; }; return g;
  }

  // ---------- castle ----------
  /** Small flag on a pole (standing at the origin). userData.update(t) makes it flutter. */
  function pennant(h = 2.4, color = C.red, len = 1.3) {
    const g = grp(cylB(0.03, 0.04, h, 5, C.woodDk), ball(0.06, C.gold, 0, GOLD).at(0, h + 0.03, 0)), fl = grp().at(0, h - 0.36, 0), w = len / 3, parts = [];
    for (let i = 0; i < 3; i++) {
      const a = 0.6 * (1 - i / 3), b = 0.6 * (1 - (i + 1) / 3), p = grp().at(i ? w : 0.03, 0, 0);
      const geo = new T.BufferGeometry().setFromPoints([V([0, -a / 2, 0]), V([w, -b / 2, 0]), V([w, b / 2, 0]), V([0, -a / 2, 0]), V([w, b / 2, 0]), V([0, a / 2, 0])]); geo.computeVertexNormals();
      p.add(mesh(geo, i === 1 ? shade(color, 0.86) : color, { side: 'double' })); (i ? parts[i - 1] : fl).add(p); parts.push(p);
    }
    g.add(fl); g.userData.flag = fl; g.userData.update = t => parts.forEach((p, i) => { p.rotation.y = (i ? 0.55 : 0.3) * Math.sin(t * 3.4 - i * 1.2) + 0.15 * noise1(t * 1.3 + i, 3); }); g.userData.update(0); return g;
  }
  /**
   * Round tower. o: {radius: 2.6, height: 11, top: 'battlement' | 'roof' | 'both', color, roofColor, windows: true, lit: false (glowing windows),
   *     door: 'front' | 'back' | 'none', flag: colour | null, sides: 12, seed}
   * userData: {radius, height, walkY, top: [0, y, 0], door, open(k), flag, update(t)}
   */
  function towerRound(o = {}) {
    const { radius = 2.6, height = 11, top = 'battlement', color = C.stone, roofColor = C.slate, windows = true, lit = false, door = 'front', flag = C.red, sides = 12, seed = 1 } = o;
    const g = grp(), st = grp(), { sm, lt, tc } = stoneSet(color, seed), ap = Math.cos(PI / sides), rAt = y => lerp(radius * 1.06, radius, y / height), R1 = radius + 0.42;
    tcyl(radius, radius * 1.06, height, sides, sm, 3).to(st); tcyl(radius * 1.1, radius * 1.17, 0.85, sides, sm, 3).to(st); tcyl(radius * 1.08, radius * 1.1, 0.16, sides, lt, 3, 0, 0.85, 0).to(st);
    tcyl(R1, radius, 0.7, sides, lt, 3, 0, height - 0.7, 0).to(st);
    const onFace = (obj, i, y, off = 0.01, r = rAt(y)) => { const a = i * TAU / sides; obj.position.set(Math.sin(a) * (r * ap + off), y, Math.cos(a) * (r * ap + off)); obj.rotation.y = a; st.add(obj); return obj; };
    let topY = height;
    if (top !== 'roof') {
      const pr = tlathe([[R1, 0], [R1, 0.95], [R1 - 0.45, 0.95], [R1 - 0.45, 0]], sides, sm, 3); pr.position.y = height; st.add(pr);
      const cw = 2 * R1 * Math.sin(PI / sides);
      for (let i = 0; i < sides; i += 2) { onFace(tbox(cw * 0.98, 0.85, 0.45, sm, 3), i, height + 0.95, -0.225, R1); onFace(box(cw * 0.98 + 0.07, 0.09, 0.53, tc), i, height + 0.95 + 0.895, -0.225, R1); if (i % 4 === 0) onFace(box(0.08, 0.46, 0.03, C.dark), i, height + 0.95 + 0.42, 0.006, R1); }
      topY = height + 1.8;
    }
    if (top !== 'battlement') {
      const both = top === 'both', rr = both ? R1 - 0.6 : R1 + 0.35, by = both ? height + 0.55 : height, rh = rr * (both ? 2.1 : 1.75);
      if (both) tcyl(rr - 0.12, rr - 0.12, 0.6, sides, sm, 3, 0, height, 0).to(st);
      roofCone(rr, rh, sides, roofMat('slate', roofColor)).at(0, by, 0).to(st); cyl(rr + 0.03, rr + 0.03, 0.1, sides, shade(roofColor, 0.72)).at(0, by + 0.02, 0).rot(0, PI / sides, 0).to(st);
      topY = by + rh;
    }
    const lv = Math.max(1, Math.floor((height - 3.2) / 3.2));
    for (let l = 0; l < lv; l++) { const y = 3.6 + l * 3.2; if (windows) onFace(archWin(0.62, 1.25, { lit, stone: tc }), 0, y, 0); else onFace(slit(0.95, tc), l % 2 ? 1 : sides - 1, y + 0.2); onFace(slit(0.95, tc), l % 2 ? 3 : sides - 3, y + 0.3); onFace(slit(0.95, tc), sides / 2 + (l % 2 ? -2 : 2), y - 0.6); }
    if (door !== 'none') {
      const dy = 1.01, pd = plankDoor(1.05, 2.15, { arch: 'round' });
      const dg = grp(xtr(archFrame(1.8, 2.62, 1.05, 2.15), 0.5, tc), pd.at(0, 0, -0.06), stairs(1.9, dy, 5, 0.28, sm, 1.5).at(0, -dy, 0.25), tbox(1.9, dy, 0.5, sm, 1.5).at(0, -dy, 0));
      onFace(dg, door === 'back' ? sides / 2 : 0, dy, -0.02, radius * 1.1); g.userData.door = pd.userData.leaf; g.userData.open = pd.userData.open;
    }
    g.add(bake(st));
    if (flag) { const bt = top === 'battlement', f = pennant(bt ? 3.4 : 1.9, flag).at(0, bt ? height : topY - 0.3, 0); g.add(f); g.userData.flag = f.userData.flag; topY = (bt ? height + 3.4 : topY + 1.6); }
    Object.assign(g.userData, { radius, height, walkY: height, top: [0, topY, 0] }); return compose(g);
  }
  /**
   * Square tower. o: {width: 5, height: 10, top: 'battlement' | 'roof' | 'both', color, roofColor, windows: true, lit: false, door: 'front' | 'back' | 'none', flag: colour | null, seed}
   * userData: {width, height, walkY, top, door, open(k), flag, update(t)}
   */
  function towerSquare(o = {}) {
    const { width = 5, height = 10, top = 'battlement', color = C.stone, roofColor = C.slate, windows = true, lit = false, door = 'front', flag = C.red, seed = 1 } = o;
    const g = grp(), st = grp(), { sm, lt, tc } = stoneSet(color, seed), h2 = width / 2, W1 = width + 0.7;
    tbox(width, height, width, sm, 3).to(st); tbox(width + 0.5, 0.85, width + 0.5, sm, 3).to(st); tbox(width + 0.3, 0.16, width + 0.3, lt, 3, 0, 0.85, 0).to(st); tbox(W1, 0.32, W1, lt, 3, 0, height - 0.32, 0).to(st);
    const onFace = (obj, sd, x, y, off = 0.01, half = h2) => { const a = sd * PI / 2; obj.position.set(Math.sin(a) * (half + off) + Math.cos(a) * x, y, Math.cos(a) * (half + off) - Math.sin(a) * x); obj.rotation.y = a; st.add(obj); return obj; };
    const nc = Math.max(3, Math.round(width / 0.85)); for (let sd = 0; sd < 4; sd++) for (let i = 0; i < nc; i++) onFace(box(0.3, 0.36, 0.34, tc), sd, -h2 + (i + 0.5) * width / nc, height - 0.5, 0.17);
    let topY = height;
    if (top !== 'roof') {
      const e = W1 / 2 - 0.225, nm = Math.max(1, Math.round((W1 - 1.9) / 1.55)), mw = 0.85, gap = (W1 - 1.9 - nm * mw) / (nm + 1);
      for (let sd = 0; sd < 4; sd++) { onFace(tbox(W1 - (sd % 2 ? 0.9 : 0), 0.95, 0.45, sm, 3), sd, 0, height, -0.225, W1 / 2); for (let i = 0; i < nm; i++) { const u = -(W1 / 2 - 0.95) + gap + mw / 2 + i * (mw + gap); onFace(tbox(mw, 0.85, 0.45, sm, 3), sd, u, height + 0.95, -0.225, W1 / 2); onFace(box(mw + 0.07, 0.09, 0.53, tc), sd, u, height + 0.95 + 0.895, -0.225, W1 / 2); } }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { tbox(0.95, 0.85, 0.95, sm, 3, sx * (e - 0.25), height + 0.95, sz * (e - 0.25)).to(st); box(1.02, 0.09, 1.02, tc).at(sx * (e - 0.25), height + 0.95 + 0.895, sz * (e - 0.25)).to(st); }
      topY = height + 1.8;
    }
    if (top !== 'battlement') {
      const both = top === 'both', half = both ? h2 - 0.25 : W1 / 2 + 0.35, by = both ? height + 0.5 : height, rh = half * (both ? 2.0 : 1.7);
      if (both) tbox(half * 2 - 0.3, 0.55, half * 2 - 0.3, sm, 3, 0, height, 0).to(st);
      roofCone(half * Math.SQRT2, rh, 4, roofMat('slate', roofColor)).at(0, by, 0).to(st); box(half * 2 + 0.06, 0.1, half * 2 + 0.06, shade(roofColor, 0.72)).at(0, by + 0.02, 0).to(st);
      topY = by + rh;
    }
    const lv = Math.max(1, Math.floor((height - 3.2) / 3.2));
    for (let l = 0; l < lv; l++) { const y = 3.6 + l * 3.2; if (windows) onFace(archWin(0.7, 1.35, { lit, stone: tc }), 0, 0, y, 0); else onFace(slit(0.95, tc), 0, l % 2 ? 0.7 : -0.7, y); onFace(slit(0.95, tc), 1, l % 2 ? 0.8 : -0.8, y + 0.2); onFace(slit(0.95, tc), 3, l % 2 ? -0.8 : 0.8, y - 0.3); onFace(slit(0.95, tc), 2, 0, y); }
    if (door !== 'none') {
      const dy = 1.01, pd = plankDoor(1.05, 2.15, { arch: 'round' });
      const dg = grp(xtr(archFrame(1.8, 2.62, 1.05, 2.15), 0.5, tc), pd.at(0, 0, -0.1), stairs(1.9, dy, 5, 0.28, sm, 1.5).at(0, -dy, 0.25), tbox(1.9, dy, 0.5, sm, 1.5).at(0, -dy, 0));
      onFace(dg, door === 'back' ? 2 : 0, 0, dy, 0.2); g.userData.door = pd.userData.leaf; g.userData.open = pd.userData.open;
    }
    g.add(bake(st));
    if (flag) { const bt = top === 'battlement', f = pennant(bt ? 3.4 : 1.9, flag).at(0, bt ? height : topY - 0.3, 0); g.add(f); g.userData.flag = f.userData.flag; topY = (bt ? height + 3.4 : topY + 1.6); }
    Object.assign(g.userData, { width, height, walkY: height, top: [0, topY, 0] }); return compose(g);
  }
  /**
   * Lowering bridge of planks on chains. Hinge end at z = -length / 2, far end toward +Z.
   * o: {width: 3.6, length: 6, color, posts: true (timber frame holding the chains; false when a gatehouse does), anchorY: 4.4, open: 1, seed}
   * userData: {deck, raise(k) (0 = down, 1 = up), open(k) (1 = down and passable, 0 = raised), hinge: [0, 0, z]}
   */
  function drawbridge(o = {}) {
    const { width = 3.6, length = 6, color = C.wood, posts = true, anchorY = 4.4, open = 1, seed = 1 } = o, g = grp(), deck = grp(), ds = grp(), hz = -length / 2, ax = width / 2 - 0.09;
    tbox(width, 0.14, length, woodMat(color, { planks: 6, horiz: true, seed }), 1.5, 0, 0.06, length / 2).to(ds);
    for (const sx of [-1, 1]) { box(0.18, 0.26, length, C.woodDk).at(sx * ax, 0.11, length / 2).to(ds); torus(0.09, 0.022, C.iron, { ...IRON, rs: 4, ts: 8 }).at(sx * ax, 0.33, length - 0.3).rot(0, PI / 2, 0).to(ds); }
    for (let z = 0.5; z < length; z += 1.25) box(width - 0.36, 0.03, 0.1, C.iron, IRON).at(0, 0.215, z).to(ds);
    deck.add(bake(ds)); deck.position.set(0, 0.02, hz); g.add(deck);
    const ct = S3.canvasTex(16, 32, c => { c.fillStyle = '#23262c'; c.fillRect(0, 0, 16, 32); c.fillStyle = '#7b828c'; c.fillRect(5, 1, 6, 14); c.fillStyle = '#565c66'; c.fillRect(1, 17, 14, 13); c.fillStyle = '#23262c'; c.fillRect(5, 20, 6, 7); }, { repeat: [1, 1] });
    const cm = S3.texMat(ct, { rough: 0.5 }), chains = [-1, 1].map(() => { const c = mesh(new T.CylinderGeometry(0.035, 0.035, 1, 4), cm); g.add(c); return c; });
    if (posts) { const ps = grp(), ph = anchorY + 0.45; for (const sx of [-1, 1]) { boxB(0.3, ph, 0.3, C.woodDk).at(sx * (width / 2 + 0.2), 0, hz - 0.2).to(ps); beam([sx * (width / 2 + 0.2), ph - 1.3, hz - 0.2], [sx * (width / 2 - 0.9), ph - 0.15, hz - 0.2], 0.16, 0.16, C.woodDk).to(ps); cyl(0.14, 0.14, 0.12, 8, C.iron, IRON).rot(0, 0, PI / 2).at(sx * ax, anchorY, hz - 0.02).to(ps); boxB(0.42, 0.16, 0.42, C.stoneDk).at(sx * (width / 2 + 0.2), 0, hz - 0.2).to(ps); } box(width + 1.1, 0.3, 0.3, C.woodDk).at(0, ph, hz - 0.2).to(ps); g.add(bake(ps)); }
    const U = g.userData; U.deck = deck; U.hinge = [0, 0, hz];
    U.raise = k => { const a = clamp(k) * 1.42, y = 0.33, z = length - 0.3, s = Math.sin(a), c = Math.cos(a); deck.rotation.x = -a; chains.forEach((ch, i) => { const sx = i ? 1 : -1, p = [sx * ax, 0.02 + y * c + z * s, hz - y * s + z * c], q = [sx * ax, anchorY, hz + 0.02]; stretch(ch, p, q); }); ct.repeat.set(1, Math.max(1, Math.hypot(0.02 + y * c + z * s - anchorY, -y * s + z * c) / 0.22)); };
    U.open = k => U.raise(1 - clamp(k)); U.open(open); return g;
  }
  /**
   * Gatehouse: an arched passage between two round towers, with a portcullis.
   * o: {width: 14, height: 8.5, depth: 5, gateWidth: 3.6, gateHeight: 4.6, color, lit: true (torches burning), banner: colour | null, emblem,
   *     doors: false (wooden gates at the inner end), bridge: false (drawbridge in front), open: 0, seed}
   * userData: {portcullis, open(k), doors, openDoors(k), bridge (its userData.open(k)), front: [x,y,z], inside: [x,y,z], walkY, update(t)}
   */
  function gatehouse(o = {}) {
    const { width = 14, height = 8.5, depth = 5, gateWidth = 3.6, gateHeight = 4.6, color = C.stone, seed = 1, lit = true, banner: bn = C.red, emblem = 'tower', doors = false, bridge = false, open = 0 } = o;
    const g = grp(), st = grp(), { sm, lt, tc } = stoneSet(color, seed), tr = 2.3, tx = width / 2 - tr, cw = tx * 2, hz = depth / 2, I = archPts(gateWidth, gateHeight, 'round', 8), a = gateWidth / 2, sy = gateHeight - a;
    textr([[cw / 2, 0], [cw / 2, height], [-cw / 2, height], [-cw / 2, 0], I[0], ...I.slice(2).reverse(), I[1]], depth, sm, 3).to(st);
    tbox(cw, 0.26, depth + 0.3, lt, 3, 0, height - 0.26, 0).to(st); tbox(gateWidth, 0.05, depth + 1.2, paveMat('flag', shade(color, 0.9)), 2).to(st);
    for (const sd of [1, -1]) { tbox(cw, 0.95, 0.45, sm, 3, 0, height, sd * (hz - 0.1)).to(st); merlons(st, cw, Math.round(cw / 1.6), height + 0.95, sd * (hz - 0.1), sm, { cap: tc }); }
    const nv = 9, vr = a + 0.25; for (let i = 0; i < nv; i++) { const an = (i + 0.5) / nv * PI, key = i === 4, rr = vr + (key ? 0.07 : 0); box(vr * PI / nv * 0.93, key ? 0.64 : 0.5, 0.16, shade(color, key ? 1.3 : i % 2 ? 1.1 : 1.2)).at(Math.cos(an) * rr, sy + Math.sin(an) * rr, hz + 0.05).rot(0, 0, an - PI / 2).to(st); }
    for (let j = 0; j * 0.52 < sy - 0.3; j++) for (const sx of [-1, 1]) box(j % 2 ? 0.56 : 0.4, 0.48, 0.16, shade(color, j % 2 ? 1.1 : 1.2)).at(sx * (a + (j % 2 ? 0.28 : 0.2)), 0.26 + j * 0.52, hz + 0.05).to(st);
    for (const sx of [-1, 1]) slit(1.0, tc).at(sx * 1.25, gateHeight + 1.75, hz + 0.01).to(st);
    if (bn) shield({ color: bn, emblem, size: 1.1, y: gateHeight + 0.75 }).at(0, 0, hz + 0.02).to(st);
    g.add(bake(st));
    const tz = hz - tr + 1.0, tws = [-1, 1].map(sx => { const t = towerRound({ radius: tr, height: height + 2.4, color, seed: seed + (sx > 0 ? 2 : 1), door: 'none', flag: bn, windows: false }); t.position.set(sx * tx, 0, tz); g.add(t); return t; });
    if (bn) for (const sx of [-1, 1]) { const b = banner({ color: bn, emblem, width: 1.0, height: 3.3, y: height - 0.6, seed: seed + sx }); b.position.set(sx * tx, 0, tz + tr * Math.cos(PI / 12) + 0.02); g.add(b); }
    const ts = [-1, 1].map(sx => { const t = wallTorch({ y: 2.7, lit, seed: seed + sx + 3 }); t.position.set(sx * (a + 0.82), 0, hz); g.add(t); return t; });
    // portcullis
    const pc = grp(), ps = grp(), pw = gateWidth + 0.24, ph = gateHeight + 0.1, nb = Math.round(pw / 0.43);
    for (let i = 0; i <= nb; i++) { const x = -pw / 2 + i * pw / nb; box(0.085, ph, 0.085, '#5b4630').at(x, ph / 2 + 0.16, 0).to(ps); cone(0.07, 0.24, 4, C.steel, STEEL).at(x, 0.13, 0).rot(PI, PI / 4, 0).to(ps); }
    for (let j = 0; 0.5 + j * 0.62 < ph; j++) { box(pw, 0.085, 0.11, '#4d3a27').at(0, 0.5 + j * 0.62, 0).to(ps); for (let i = 0; i <= nb; i++) box(0.12, 0.12, 0.13, C.iron, IRON).at(-pw / 2 + i * pw / nb, 0.5 + j * 0.62, 0).to(ps); }
    pc.add(bake(ps)); pc.position.set(0, 0, hz - 0.85); g.add(pc);
    const U = g.userData; U.portcullis = pc; U.open = k => { pc.position.y = clamp(k) * (gateHeight + 0.2); }; U.open(open); U.torches = ts; U.towers = tws;
    if (doors) { const dd = doubleDoor(gateWidth, gateHeight, { arch: 'round', inward: true }); dd.rotation.y = 0; dd.position.set(0, 0, -hz + 0.5); g.add(dd); U.doors = dd; U.openDoors = dd.userData.open; }
    if (bridge) { const br = drawbridge({ width: gateWidth, length: 6.5, posts: false, anchorY: gateHeight + 1.3, color: C.wood }); br.position.set(0, 0, hz + 3.25); g.add(br); U.bridge = br; }
    Object.assign(U, { front: [0, 0, hz + 5], inside: [0, 0, -hz - 3], walkY: height, width, height, depth }); return compose(g);
  }
  /**
   * The keep: the lord's great tower, with corner turrets, a stair to a pointed door, and banners.
   * o: {width: 11, depth: 9, height: 13, color, roofColor, lit: false (glowing windows), banner: colour | null, emblem, flag: colour | null, seed}
   * userData: {door (double door group), open(k), doorPos: [x, y, z] (top of the stair), top: [0, y, 0], flag, update(t)}
   */
  function keep(o = {}) {
    const { width = 11, depth = 9, height = 13, color = C.stone, roofColor = C.slate, lit = false, banner: bn = C.red, emblem = 'crown', flag = C.red, seed = 1 } = o;
    const g = grp(), st = grp(), { sm, lt, tc } = stoneSet(color, seed), hx = width / 2, hz = depth / 2, tw = 3, th = height + 2.6, W = width + 0.5, D = depth + 0.5;
    tbox(width, height, depth, sm, 3).to(st); tbox(W, 0.9, D, sm, 3).to(st); tbox(width + 0.3, 0.16, depth + 0.3, lt, 3, 0, 0.9, 0).to(st);
    for (let y = 5; y < height - 2; y += 4) tbox(width + 0.16, 0.18, depth + 0.16, lt, 3, 0, y, 0).to(st);
    tbox(W, 0.3, D, lt, 3, 0, height - 0.3, 0).to(st);
    for (const sd of [1, -1]) { tbox(W, 0.95, 0.45, sm, 3, 0, height, sd * (D / 2 - 0.225)).to(st); merlons(st, W, Math.round(W / 1.5), height + 0.95, sd * (D / 2 - 0.225), sm, { cap: tc }); }
    for (const sd of [1, -1]) { const side = grp(); tbox(D - 0.9, 0.95, 0.45, sm, 3).to(side); merlons(side, D - 0.9, Math.round((D - 0.9) / 1.5), 0.95, 0, sm, { cap: tc }); side.position.set(sd * (W / 2 - 0.225), height, 0); side.rotation.y = sd * PI / 2; st.add(side); }
    // corner turrets
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (hx - tw / 2 + 0.55), z = sz * (hz - tw / 2 + 0.55), t = grp().at(x, 0, z), e = tw / 2 + 0.3 - 0.2;
      tbox(tw, th, tw, sm, 3).to(t); tbox(tw + 0.4, 0.9, tw + 0.4, sm, 3).to(t); tbox(tw + 0.6, 0.3, tw + 0.6, lt, 3, 0, th - 0.3, 0).to(t);
      for (let sd = 0; sd < 4; sd++) { const an = sd * PI / 2, w1 = tbox(tw + 0.6 - (sd % 2 ? 0.8 : 0), 0.9, 0.4, sm, 3); w1.position.set(Math.sin(an) * e, th, Math.cos(an) * e); w1.rotation.y = an; t.add(w1); const m1 = tbox(0.8, 0.8, 0.4, sm, 3); m1.position.set(Math.sin(an) * e, th + 0.9, Math.cos(an) * e); m1.rotation.y = an; t.add(m1); }
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) tbox(0.75, 0.8, 0.75, sm, 3, cx * (e - 0.175), th + 0.9, cz * (e - 0.175)).to(t);
      const sl = slit(1.0, tc); sl.position.set(sx * 0, th - 3, sz * (tw / 2 + 0.01)); if (sz < 0) sl.rotation.y = PI; t.add(sl);
      const s2 = slit(1.0, tc); s2.position.set(sx * (tw / 2 + 0.01), th - 6.5, 0); s2.rotation.y = sx * PI / 2; t.add(s2);
      st.add(t);
    }
    // central roof behind the parapet
    const rb = Math.min(width, depth) - 1.6, rf = roofCone(rb / 2 * Math.SQRT2, 3.4, 4, roofMat('slate', roofColor)); rf.scale.set((width - 1.4) / rb, 1, (depth - 1.4) / rb); rf.position.y = height + 0.02; st.add(rf);
    // door at the head of a stair, windows, banners
    const dw = 2.1, dh = 3.3, dy = 1.06, dd = doubleDoor(dw, dh, { arch: 'point', color: C.woodDk });
    xtr(archFrame(dw + 0.9, dh + 0.52, dw, dh, 'point'), 0.6, tc).at(0, dy, hz + 0.26).to(st); dd.position.set(0, dy, hz + 0.12); st.add(dd);
    tbox(dw + 1.9, dy, 0.6, sm, 1.5, 0, 0, hz + 0.3).to(st); stairs(dw + 1.9, dy, 5, 0.34, sm, 1.5).at(0, 0, hz + 0.6).to(st);
    for (let y = 5.9; y + 2.4 < height; y += 4) { for (const x of [-hx * 0.55, 0, hx * 0.55]) { archWin(0.85, 1.9, { lit, arch: 'point', stone: tc }).at(x, y, hz + 0.005).to(st); archWin(0.85, 1.9, { lit, arch: 'point', stone: tc }).at(x, y, -hz - 0.005).rot(0, PI, 0).to(st); } for (const z of [-hz * 0.3, hz * 0.3]) for (const sx of [-1, 1]) archWin(0.7, 1.7, { lit, arch: 'point', stone: tc }).at(sx * (hx + 0.005), y, z).rot(0, sx * PI / 2, 0).to(st); }
    g.add(bake(st));
    if (bn) for (const sx of [-1, 1]) { const b = banner({ color: bn, emblem, width: 1.15, height: 3.6, y: 5.2, seed: seed + sx }); b.position.set(sx * (dw / 2 + 1.5), 0, hz + 0.02); g.add(b); }
    const U = g.userData; U.doors = dd.userData.leaves; U.open = dd.userData.open; U.doorPos = [0, dy, hz + 1.2];
    if (flag) { const f = pennant(3.8, flag, 2.0).at(0, height + 3.3, 0); g.add(f); U.flag = f.userData.flag; }
    Object.assign(U, { width, depth, height, top: [0, height + 7.1, 0] }); return compose(g);
  }
  /**
   * Courtyard well with a windlass, a little roof and a bucket.
   * o: {radius: 0.85, color, wood, roof: true, roofColor, water: '#1c3d4a', seed}
   * userData: {bucket, lower(k) (0 = bucket at the rim, 1 = down the shaft), rim: 0.9}
   */
  function well(o = {}) {
    const { radius = 0.85, color = C.stone, wood = C.wood, roof = true, roofColor, water = '#1c3d4a', seed = 1 } = o, g = grp(), st = grp(), sm = stoneMat(color, { seed }), ri = radius - 0.22;
    tcyl(radius + 0.38, radius + 0.44, 0.13, 10, paveMat('flag', shade(color, 0.92)), 2).to(st);
    const rg = tlathe([[radius, 0.13], [radius, 0.9], [ri, 0.9], [ri, 0.2]], 10, sm, 1.5); st.add(rg);
    const cp = tlathe([[radius + 0.05, 0.9], [radius + 0.05, 1.0], [ri - 0.03, 1.0], [ri - 0.03, 0.9]], 10, stoneMat(shade(color, 1.12), { seed: seed + 2 }), 1.5); st.add(cp);
    cyl(ri, ri, 0.02, 10, water, { rough: 0.12, metal: 0.2 }).at(0, 0.5, 0).rot(0, PI / 10, 0).to(st);
    const px = radius + 0.02, ph = 2.25, ay = 1.72;
    for (const sx of [-1, 1]) { boxB(0.14, ph, 0.14, wood).at(sx * px, 0, 0).to(st); if (roof) for (const sz of [-1, 1]) beam([sx * px, ph - 0.55, 0], [sx * px, ph - 0.05, sz * 0.5], 0.08, 0.08, shade(wood, 0.8)).to(st); }
    cyl(0.045, 0.045, px * 2 + 0.3, 6, shade(wood, 0.75)).rot(0, 0, PI / 2).at(0, ay, 0).to(st); cyl(0.1, 0.1, 0.8, 8, shade(wood, 1.1)).rot(0, 0, PI / 2).at(0, ay, 0).to(st); cyl(0.107, 0.107, 0.3, 8, C.rope).rot(0, 0, PI / 2).at(0.05, ay, 0).to(st);
    rod([px + 0.15, ay, 0], [px + 0.15, ay - 0.26, 0], 0.02, C.iron, IRON).to(st); rod([px + 0.13, ay - 0.26, 0], [px + 0.4, ay - 0.26, 0], 0.022, C.woodDk).to(st);
    if (roof) gableRoof(px * 2 + 0.7, 1.24, 0.52, roofMat('shingle', roofColor), { over: 0.14, thick: 0.07, s: 1, cap: shade(wood, 0.7) }).at(0, ph - 0.06, 0).to(st);
    g.add(bake(st));
    const bk = grp(), bs = grp(); lathe([[0.13, 0], [0.17, 0.3], [0.15, 0.3], [0.115, 0.03], [0.0001, 0.03]], 8, wood).to(bs); cyl(0.172, 0.165, 0.035, 8, C.iron, IRON).at(0, 0.2, 0).to(bs); cyl(0.142, 0.135, 0.03, 8, C.iron, IRON).at(0, 0.07, 0).to(bs); torus(0.165, 0.012, C.iron, { ...IRON, rs: 4, ts: 8, arc: PI }).at(0, 0.3, 0).to(bs);
    bk.add(bake(bs)); g.add(bk); const rope = mesh(new T.CylinderGeometry(0.014, 0.014, 1, 4), mat(C.rope)); g.add(rope);
    const U = g.userData; U.bucket = bk; U.rim = 1.0; U.lower = k => { const y = lerp(1.08, -1.2, clamp(k)); bk.position.set(0.05, y, 0); stretch(rope, [0.05, y + 0.46, 0], [0.05, ay - 0.1, 0]); bk.visible = rope.visible = true; }; U.lower(0); return g;
  }

  // ---------- small goods shared by many builders ----------
  /**
   * Barrel. o: {radius: 0.36, height: 0.95, color, hoops (colour), lying: false, open: false (lid off), fill: 'water' | 'apples' | 'gold' | 'fish' | 'ale' (shown when open), tap: false, seed}
   */
  function barrel(o = {}) {
    const { radius: r = 0.36, height: h = 0.95, color = C.wood, hoops = C.iron, lying = false, open = false, fill = 'water', tap = false, seed = 1 } = o, g = grp(), st = grp();
    const prof = [[r * 0.8, 0], [r * 0.94, h * 0.2], [r, h * 0.5], [r * 0.94, h * 0.8], [r * 0.8, h], [r * 0.73, h], [r * 0.73, h - 0.05]], rAt = y => { const k = Math.abs(y / h - 0.5) * 2; return r * (1 - 0.2 * k * k); };
    tlathe(prof, 10, woodMat(color, { planks: 4, seed }), 0.5).to(st);
    for (const k of [0.07, 0.27, 0.73, 0.93]) { const y = h * k; cyl(rAt(y + 0.025) + 0.012, rAt(y - 0.025) + 0.012, 0.05, 10, hoops, IRON).at(0, y, 0).rot(0, PI / 10, 0).to(st); }
    cyl(r * 0.74, r * 0.74, 0.02, 10, shade(color, 0.8)).at(0, 0.02, 0).rot(0, PI / 10, 0).to(st);
    if (!open) cyl(r * 0.74, r * 0.74, 0.02, 10, shade(color, 1.12)).at(0, h - 0.05, 0).rot(0, PI / 10, 0).to(st);
    else {
      const fc = { water: '#24505f', ale: '#b5761f', apples: '#7a3a22', gold: C.gold, fish: '#3b5560' }[fill] || '#24505f', fy = h - 0.14;
      cyl(r * 0.73, r * 0.73, 0.02, 10, fc, fill === 'gold' ? GOLD : { rough: 0.15 }).at(0, fy, 0).rot(0, PI / 10, 0).to(st); const rr = R(seed, 4);
      if (fill === 'apples') for (let i = 0; i < 9; i++) ball(0.055, pick(rr, ['#b8322a', '#c84a2c', '#8fae3a']), 0).at((rr() - 0.5) * r, fy + 0.04 + rr() * 0.04, (rr() - 0.5) * r).to(st);
      if (fill === 'gold') for (let i = 0; i < 12; i++) cyl(0.03, 0.03, 0.008, 6, C.gold, GOLD).at((rr() - 0.5) * r, fy + 0.02 + rr() * 0.03, (rr() - 0.5) * r).rot(rr() - 0.5, rr() * 3, rr() - 0.5).to(st);
      if (fill === 'fish') for (let i = 0; i < 5; i++) ball(0.07, '#9fb2bd', 0, STEEL).scl(0.45, 0.3, 1.5).at((rr() - 0.5) * r * 0.8, fy + 0.04, (rr() - 0.5) * r * 0.5).rot(0, rr() * 3, 0).to(st);
    }
    if (tap) { rod([0, h * 0.5, r], [0, h * 0.5, r + 0.12], 0.02, C.woodDk).to(st); box(0.03, 0.08, 0.03, C.woodDk).at(0, h * 0.5 + 0.03, r + 0.09).to(st); }
    const b = bake(st); if (lying) { b.rotation.x = PI / 2; b.rotation.z = 0; b.position.set(0, r, -h / 2); for (const sx of [-1, 1]) box(0.08, 0.1, h * 0.7, C.woodDk).at(sx * r * 0.6, 0.05, 0).to(g); }
    g.add(b); return g;
  }
  /** Wooden crate. o: {size: 0.6 | [w, h, d], color, open: false, seed} */
  function crate(o = {}) {
    const { size = 0.6, color = C.woodLt, seed = 1 } = o, [w, h, d] = Array.isArray(size) ? size : [size, size, size], g = grp(), st = grp(), key = ['crate', hex(color), seed].join('|');
    const m = tmat(key, () => ctex(key, 128, 128, (c, W, H) => { const r = R(seed, 6); for (let i = 0; i < 4; i++) { c.fillStyle = shade(hex(color), 0.86 + r() * 0.22); c.fillRect(0, i * H / 4, W, H / 4); c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(0, i * H / 4, W, 3); } c.strokeStyle = shade(hex(color), 0.7); c.lineWidth = 14; c.beginPath(); c.moveTo(10, 10); c.lineTo(W - 10, H - 10); c.stroke(); c.lineWidth = 16; c.strokeRect(8, 8, W - 16, H - 16); c.fillStyle = 'rgba(0,0,0,.45)'; for (const [x, y] of [[12, 12], [W - 16, 12], [12, H - 16], [W - 16, H - 16]]) c.fillRect(x, y, 5, 5); }), { rough: 0.9 });
    const b = mesh(new T.BoxGeometry(w, h, d).translate(0, h / 2, 0), m); st.add(b);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) boxB(0.05, h + 0.01, 0.05, shade(color, 0.72)).at(sx * (w / 2 - 0.015), 0, sz * (d / 2 - 0.015)).to(st);
    g.add(bake(st)); return g;
  }
  /** Tied sack of grain. o: {size: 0.45, color, seed} */
  function sack(o = {}) {
    const { size: s = 0.45, color = '#b99b68', seed = 1 } = o, g = grp(), st = grp();
    blob(s * 0.5, color, seed, { squash: [1, 1.15, 0.85], bump: 0.1 }).at(0, s * 0.52, 0).to(st); cone(s * 0.16, s * 0.24, 6, shade(color, 0.9)).at(0, s * 1.14, 0).rot(PI, 0, 0).to(st); cyl(s * 0.07, s * 0.07, 0.03, 6, C.rope).at(0, s * 1.05, 0).to(st);
    g.add(bake(st)); return g;
  }
  /**
   * Lantern: iron frame with glowing panes. Stands on y = 0, or hangs with its base at o.y on a chain of o.chain metres.
   * o: {size: 0.32, lit: true, color (glow), y: 0, chain: 0}   userData: {lightPos, flares, setLit(on), update(t)}
   */
  function lantern(o = {}) {
    const { size: s = 0.32, lit = true, color = '#ffb347', y = 0, chain: ch = 0 } = o, g = grp(), st = grp(), w = s * 0.5;
    box(w * 1.2, s * 0.08, w * 1.2, C.iron, IRON).at(0, y + s * 0.04, 0).to(st); box(w * 1.2, s * 0.06, w * 1.2, C.iron, IRON).at(0, y + s * 0.75, 0).to(st);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(s * 0.05, s * 0.7, s * 0.05, C.iron, IRON).at(sx * w * 0.5, y + s * 0.42, sz * w * 0.5).to(st);
    cone(w * 0.78, s * 0.22, 4, C.iron, IRON).at(0, y + s * 0.89, 0).rot(0, PI / 4, 0).to(st); torus(s * 0.07, s * 0.018, C.iron, { ...IRON, rs: 4, ts: 8 }).at(0, y + s * 1.05, 0).to(st);
    if (ch) rod([0, y + s * 1.1, 0], [0, y + s * 1.1 + ch, 0], 0.012, C.iron, IRON).to(st);
    g.add(bake(st));
    const core = box(w * 0.86, s * 0.66, w * 0.86, lit ? glo(color, 1.5, { own: true }) : mat('#3a3326', { own: true })).at(0, y + s * 0.42, 0); g.add(core);
    const fl = flare(color, s * 5, 0.4).at(0, y + s * 0.42, 0); fl.visible = lit; g.add(fl);
    const U = g.userData; U.lightPos = [0, y + s * 0.42, 0]; U.lightColor = color; U.lightPower = 0.7; U.lit = lit; U.flares = [fl]; U.core = core;
    U.setLit = on => { U.lit = !!on; fl.visible = !!on; core.material = on ? glo(color, 1.5) : mat('#3a3326'); };
    U.update = t => { fl.material.opacity = 0.4 * S3.flicker(t, 0.12, 5, 3); };
    return g;
  }

  // ---------- village ----------
  /** Timber-framed window: back on z = 0, bottom of the pane at y = 0. o: {lit, frame, shutters: colour | null, flowers: bool, seed} */
  function houseWin(w, h, o = {}) {
    const g = grp(), fc = o.frame || C.woodDk, t = 0.07;
    box(w + t * 2, h + t * 2, 0.07, fc).at(0, h / 2, 0.035).to(g); const pane = quad(w, h, glassMat(o.lit)).at(0, h / 2, 0.073); g.add(pane);
    box(0.045, h, 0.025, fc).at(0, h / 2, 0.085).to(g); box(w, 0.045, 0.025, fc).at(0, h * 0.6, 0.085).to(g); box(w + 0.34, 0.07, 0.17, fc).at(0, -t - 0.035, 0.085).to(g);
    if (o.shutters) for (const sx of [-1, 1]) tbox(w / 2, h + 0.08, 0.035, woodMat(o.shutters, { planks: 3 }), 0.5).at(sx * (w * 0.75 + t + 0.01), -0.04, 0.07).to(g);
    if (o.flowers) { const r = R(o.seed, 5); box(w + 0.16, 0.15, 0.2, C.wood).at(0, -t - 0.15, 0.19).to(g); for (let i = 0; i < 6; i++) { const x = (i / 5 - 0.5) * w; blob(0.075, '#4f8a43', i + 1, { detail: 0 }).at(x, -t - 0.04, 0.2).to(g); ball(0.04, pick(r, ['#e0484a', '#f2c14e', '#d86fb0', '#f4f1e8', '#e8743a']), 0).at(x + (r() - 0.5) * 0.06, -t + 0.03 + r() * 0.03, 0.22 + r() * 0.05).to(g); } }
    g.userData.pane = pane; return g;
  }
  /**
   * The timber-framed building behind house() and tavern(). Canonical build has the ridge along X; `front` chooses which wall carries the door.
   * Returns {g, st (static parts, not yet baked), U (userData), dims}.
   */
  function timberBuilding(o) {
    const { length: L = 6, span: S = 5, storeys = 2, roof = 'thatch', front = 'gable', jetty: j = 0.22, color = C.plaster, timber = C.woodDk, stone = C.stone, lit = false, chimney = true, shutters = null, flowers = false, seed = 1, doorBay, doorW = 0.95 } = o;
    const g = grp(), st = grp(), b = grp(), r = R(seed, 1), pm = plasterMat(color, seed), sm = stoneMat(stone, { seed }), bw = 0.16, bt = 0.05, h0 = 0.35, H = [2.45, 2.3, 2.2], U = { windows: [] }; st.add(b);
    tbox(L + 0.14, h0, S + 0.14, sm, 1.5).to(b);
    const pitch = (roof === 'thatch' ? 52 : 47) * PI / 180;
    // one wall face: local x across, y up, z outward
    const faceG = (which, off) => { const f = grp(); if (which === 'front') f.position.set(0, 0, S / 2 + off); else if (which === 'back') { f.position.set(0, 0, -S / 2 - off); f.rotation.y = PI; } else if (which === 'right') { f.position.set(L / 2 + off, 0, 0); f.rotation.y = PI / 2; } else { f.position.set(-L / 2 - off, 0, 0); f.rotation.y = -PI / 2; } b.add(f); return f; };
    const tim = (f, x0, y0, x1, y1, w = bw) => { const len = Math.hypot(x1 - x0, y1 - y0); box(len, w, bt, timber).at((x0 + x1) / 2, (y0 + y1) / 2, bt / 2).rot(0, 0, Math.atan2(y1 - y0, x1 - x0)).to(f); };
    const doorFace = front === 'gable' ? 'right' : 'front';
    let y = h0, eaveY = 0;
    for (let s = 0; s < storeys; s++) {
      const off = s ? j : 0, h = H[Math.min(s, 2)], w = L + off * 2, d = S + off * 2;
      tbox(w, h, d, pm, 2, 0, y, 0).to(b);
      if (s) { tbox(w + 0.04, 0.2, d + 0.04, woodMat(timber, { planks: 2, horiz: true }), 1, 0, y - 0.1, 0).to(b); }
      for (const which of ['front', 'back', 'right', 'left']) {
        const f = faceG(which, off + 0.001), W = which === 'front' || which === 'back' ? w : d, bays = Math.max(2, Math.round(W / 1.75)), bx = i => -W / 2 + (i + 0.5) * W / bays, isDoor = which === doorFace && s === 0, db = doorBay ?? Math.floor((bays - 1) / 2);
        tim(f, -W / 2, y + bw / 2, W / 2, y + bw / 2); tim(f, -W / 2, y + h - bw / 2, W / 2, y + h - bw / 2);
        for (let i = 0; i <= bays; i++) { const x = clamp(-W / 2 + i * W / bays, -W / 2 + bw / 2, W / 2 - bw / 2); tim(f, x, y, x, y + h); }
        if (s && which === doorFace) for (let i = 0; i < Math.round(W / 0.55); i++) box(0.12, 0.14, j + 0.08, timber).at(-W / 2 + 0.2 + i * (W - 0.4) / (Math.round(W / 0.55) - 1), y - 0.17, -j / 2).to(f);
        for (let i = 0; i < bays; i++) {
          const x = bx(i), winBay = Math.min(i, bays - 1 - i) % 2 === 0, x0 = -W / 2 + i * W / bays, x1 = x0 + W / bays, ww = Math.min(0.85, W / bays - 0.6);
          if (isDoor && i === db) {
            const pd = plankDoor(doorW, 2.0, { color: o.doorColor || C.wood }); pd.position.set(x, y, 0.012); f.add(pd); U.door = pd.userData.leaf; U.open = pd.userData.open; U.doorX = x;
            box(doorW + 0.3, 0.14, 0.09, timber).at(x, y + 2.07, 0.045).to(f); for (const sx of [-1, 1]) box(0.13, 2.0, 0.09, timber).at(x + sx * (doorW / 2 + 0.065), y + 1.0, 0.045).to(f);
            tbox(doorW + 0.5, h0, 0.55, sm, 1.5, x, 0, 0.275).to(f); tbox(doorW + 0.9, h0 / 2, 0.35, sm, 1.5, x, 0, 0.72).to(f);
          } else if (winBay || (s === 0 && which === doorFace)) {
            const wn = houseWin(ww, s ? 1.0 : 1.1, { lit, frame: timber, shutters: (which === doorFace || which === 'front') ? shutters : null, flowers: flowers && s > 0 && which === doorFace, seed: seed + i + s * 7 }); wn.position.set(x, y + (s ? 0.82 : 0.95), 0.004); f.add(wn); U.windows.push(wn.userData.pane);
            tim(f, x0, y + (s ? 0.66 : 0.78), x1, y + (s ? 0.66 : 0.78), 0.12);
          } else if (s) { if (bays % 2 && i === (bays - 1) / 2) { tim(f, x0 + 0.1, y + 0.1, x1 - 0.1, y + h - 0.1, 0.12); tim(f, x0 + 0.1, y + h - 0.1, x1 - 0.1, y + 0.1, 0.12); } else if (i < bays / 2) tim(f, x0 + 0.08, y + 0.1, x1 - 0.08, y + h - 0.1, 0.12); else tim(f, x0 + 0.08, y + h - 0.1, x1 - 0.08, y + 0.1, 0.12); }
          else tim(f, x0, y + h * 0.5, x1, y + h * 0.5, 0.12);
        }
      }
      y += h; eaveY = y;
    }
    const off = storeys > 1 ? j : 0, w = L + off * 2, d = S + off * 2, rise = d / 2 * Math.tan(pitch), thick = roof === 'thatch' ? 0.3 : 0.13;
    for (const sx of [-1, 1]) {   // gables
      const gb = textr([[-d / 2, 0], [d / 2, 0], [0, rise]], 0.2, pm, 2); gb.position.set(sx * (w / 2 - 0.1), eaveY, 0); gb.rotation.y = sx * PI / 2; b.add(gb);
      const f = grp(); f.position.set(sx * (w / 2 + 0.001), eaveY, 0); f.rotation.y = sx * PI / 2; b.add(f);
      tim(f, 0, 0, 0, rise - 0.2); tim(f, -d / 2 * 0.52, rise * 0.48, d / 2 * 0.52, rise * 0.48, 0.13); tim(f, -d / 2 * 0.5, 0.05, -0.1, rise * 0.44, 0.11); tim(f, d / 2 * 0.5, 0.05, 0.1, rise * 0.44, 0.11);
      for (const sz of [-1, 1]) { const len = Math.hypot(d / 2 + 0.3, rise + 0.3 * Math.tan(pitch)); box(len, 0.2, 0.07, shade(timber, 0.85)).at(sz * (d / 4 + 0.13), rise / 2 - 0.12 * Math.tan(pitch) + 0.06, 0.32).rot(0, 0, -sz * pitch).to(f); }
      if (rise > 2.4) { const wn = houseWin(0.5, 0.6, { lit, frame: timber }); wn.position.set(0.0, rise * 0.48 + 0.2, 0.004); f.add(wn); U.windows.push(wn.userData.pane); }
    }
    const rf = gableRoof(w + 0.7, d, rise, roofMat(roof, o.roofColor), { over: 0.45, thick, cap: roof === 'thatch' ? false : shade(o.roofColor || C.tile, 0.7) }); rf.position.y = eaveY; b.add(rf);
    if (roof === 'thatch') { const cp = cyl(0.3, 0.3, w + 0.74, 5, shade(o.roofColor || C.thatch, 0.86), { vary: 0.1 }); cp.rotation.z = PI / 2; cp.position.y = eaveY + rise + 0.2; b.add(cp); }
    if (chimney) { const cx = -L * 0.22, cz = -S * 0.18, ch = rise * (1 - Math.abs(cz) / (d / 2)) + 1.1; tbox(0.72, ch + 1.2, 0.72, sm, 1.2, cx, eaveY - 1.2, cz).to(b); box(0.86, 0.12, 0.86, shade(stone, 0.8)).at(cx, eaveY + ch + 0.06, cz).to(b); for (const dx of [-0.16, 0.16]) cylB(0.1, 0.12, 0.26, 6, '#8a4a36').at(cx + dx, eaveY + ch + 0.12, cz).to(b); U._smoke = [cx, eaveY + ch + 0.4, cz]; }
    if (front === 'gable') b.rotation.y = -PI / 2;
    U._b = b; U.eaveY = eaveY; U.ridgeY = eaveY + rise; U.size = front === 'gable' ? [d, eaveY + rise, w] : [w, eaveY + rise, d];
    return { g, st, b, U, dims: { w, d, eaveY, rise, frontZ: (front === 'gable' ? w : d) / 2 } };
  }
  const _toLocal = (b, p) => { b.updateMatrix(); const v = V(p).applyMatrix4(b.matrix); return [v.x, v.y, v.z]; };
  /**
   * Timber-framed house on a stone footing, jettied upper floor, thatched or tiled roof.
   * o: {width: 5 (across the front), depth: 6, storeys: 2, roof: 'thatch' | 'tile' | 'slate' | 'shingle', front: 'gable' | 'eave' (which side faces +Z),
   *     color (plaster), timber, stone, roofColor, lit: false (glowing windows), chimney: true, shutters: colour | null, flowers: true, seed}
   * userData: {door, open(k), windows (panes), smokePos, doorPos, size: [w, h, d]}
   */
  function house(o = {}) {
    const { width = 5, depth = 6, front = 'gable', flowers = true } = o;
    const { g, st, b, U, dims } = timberBuilding({ ...o, flowers, front, length: front === 'gable' ? depth : width, span: front === 'gable' ? width : depth });
    g.add(bake(st)); if (U._smoke) U.smokePos = _toLocal(b, U._smoke); U.doorPos = [U.doorX || 0, 0, dims.frontZ + 1.1]; delete U._b; delete U._smoke; g.userData = U; return g;
  }
  /**
   * Tavern exterior: a broad timber-framed inn with a hanging sign, a lantern by the door, a bench and barrels.
   * o: {width: 9, depth: 6.5, sign: 'THE GOLDEN STAG', signColor, signText (colour), roof: 'tile', lit: true, color, timber, roofColor, seed}
   * userData: {door, open(k), windows, sign (swinging board), smokePos, doorPos, lightPos (lantern), update(t)}
   */
  function tavern(o = {}) {
    const { width = 9, depth = 6.5, sign = 'THE GOLDEN STAG', signColor = '#27402f', signText = C.gold, roof = 'tile', lit = true, seed = 1 } = o;
    const { g, st, b, U, dims } = timberBuilding({ shutters: '#2f5d49', ...o, roof, lit, seed, front: 'eave', length: width, span: depth, doorBay: 1, doorW: 1.15, flowers: true });
    const fz = dims.frontZ, bays = Math.max(2, Math.round(width / 1.75)), dx = -width / 2 + 1.5 * width / bays;
    crate({ size: [0.5, 0.45, 0.5] }).at(width / 2 - 0.5, 0, fz + 0.2).to(st);
    for (const [x, z, l] of [[width / 2 - 1.3, fz + 0.5, 0], [width / 2 - 2.0, fz + 0.42, 0]]) barrel({ seed: seed + x }).at(x, 0, z).to(st);
    const bx = -width / 2 + 1.0; tbox(1.7, 0.07, 0.36, woodMat(C.wood, { planks: 2, horiz: true }), 0.6, bx, 0.42, fz + 0.3).to(st); for (const sx of [-1, 1]) boxB(0.07, 0.42, 0.3, C.woodDk).at(bx + sx * 0.7, 0, fz + 0.3).to(st);
    // gallows bracket and swinging sign over the door
    const sy = 3.42, sw = 1.7, sh = 0.72, sz = fz + 0.85;
    for (const sx of [-1, 1]) { beam([dx + sx * (sw / 2 + 0.1), sy + 0.18, fz + 0.05], [dx + sx * (sw / 2 + 0.1), sy + 0.18, sz + 0.12], 0.1, 0.12, C.woodDk).to(st); beam([dx + sx * (sw / 2 + 0.1), sy - 0.5, fz + 0.05], [dx + sx * (sw / 2 + 0.1), sy + 0.12, sz - 0.1], 0.07, 0.07, C.woodDk).to(st); }
    cyl(0.03, 0.03, sw + 0.3, 6, C.iron, IRON).rot(0, 0, PI / 2).at(dx, sy + 0.18, sz).to(st);
    g.add(bake(st));
    const sg = grp().at(dx, sy + 0.18, sz), ss = grp(), tm = S3.texMat(textTex(sign, { w: 512, h: 216, bg: hex(signColor), color: hex(signText), border: hex(signText) }), { rough: 0.8 });
    const bd = box(sw, sh, 0.06, C.woodDk).at(0, -0.22 - sh / 2, 0); ss.add(bd); for (const s of [1, -1]) { const q = quad(sw - 0.06, sh - 0.06, tm).at(0, -0.22 - sh / 2, s * 0.032); if (s < 0) q.rotation.y = PI; ss.add(q); }
    for (const sx of [-1, 1]) rod([sx * sw * 0.4, 0, 0], [sx * sw * 0.4, -0.22, 0], 0.012, C.iron, IRON).to(ss);
    sg.add(bake(ss)); g.add(sg);
    const ln = lantern({ lit, y: 2.25, chain: 0.11 }); ln.position.set(dx + 1.0, 0, fz + 0.32); g.add(ln); const hk = bake(grp(beam([dx + 1.0, 2.72, fz + 0.03], [dx + 1.0, 2.72, fz + 0.38], 0.04, 0.04, C.iron, IRON))); g.add(hk);
    if (U._smoke) U.smokePos = _toLocal(b, U._smoke); U.doorPos = [dx, 0, fz + 1.0]; U.sign = sg; U.lantern = ln; delete U._b; delete U._smoke;
    U.update = t => { sg.rotation.x = 0.07 * Math.sin(t * 1.4) + 0.03 * noise1(t * 0.7, 4); }; g.userData = U; return compose(g);
  }
  /**
   * Market stall with a striped awning and a counter of goods. Customers stand at +Z.
   * o: {width: 2.6, depth: 1.5, color (awning), stripe, goods: 'fruit' | 'bread' | 'fish' | 'cloth' | 'pots' | 'potions', wood, seed}
   * userData: {vendor: [x,y,z], customer: [x,y,z], counterY}
   */
  function marketStall(o = {}) {
    const { width: w = 2.6, depth: d = 1.5, color = C.red, stripe = C.white, goods = 'fruit', wood = C.wood, seed = 1 } = o, g = grp(), st = grp(), r = R(seed, 8), hf = 2.0, hb = 2.5, cy = 0.9;
    for (const sx of [-1, 1]) { boxB(0.09, hf, 0.09, wood).at(sx * (w / 2 - 0.05), 0, d / 2 - 0.05).to(st); boxB(0.09, hb, 0.09, wood).at(sx * (w / 2 - 0.05), 0, -d / 2 + 0.05).to(st); beam([sx * (w / 2 - 0.05), hb, -d / 2 + 0.05], [sx * (w / 2 - 0.05), hf, d / 2 - 0.05], 0.07, 0.07, shade(wood, 0.8)).to(st); }
    box(w, 0.07, 0.07, shade(wood, 0.8)).at(0, hf, d / 2 - 0.05).to(st); box(w, 0.07, 0.07, shade(wood, 0.8)).at(0, hb, -d / 2 + 0.05).to(st);
    const am = clothMat({ color, stripes: stripe, emblem: 'none', border: false, w: 256, h: 64 }), run = Math.hypot(d + 0.5, hb - hf + 0.18), aw = box(w + 0.3, 0.03, run, am); aw.position.set(0, (hb + hf) / 2 + 0.03, 0.2); aw.rotation.x = Math.atan2(hb - hf + 0.18, d + 0.5); st.add(aw);
    const sc = [], ns = 8, fw = w + 0.3; sc.push([-fw / 2, 0]); for (let i = 0; i < ns; i++) for (let k = 1; k <= 4; k++) { const t = k / 4 * PI; sc.push([-fw / 2 + (i + 0.5 - Math.cos(t) / 2) * fw / ns, -0.16 - 0.1 * Math.sin(t)]); } sc.push([fw / 2, 0]);
    const va = face(sc, am); va.position.set(0, hf - 0.03, d / 2 + 0.43); st.add(va);
    tbox(w - 0.1, 0.06, d * 0.72, woodMat(wood, { planks: 3, horiz: true }), 0.9, 0, cy - 0.06, d * 0.1).to(st); tbox(w - 0.2, 0.5, 0.04, woodMat(shade(wood, 0.85), { planks: 4 }), 0.8, 0, cy - 0.58, d * 0.44).to(st); tbox(w - 0.2, 0.04, d * 0.6, woodMat(wood, { planks: 3, horiz: true }), 0.9, 0, 0.3, 0.05).to(st);
    for (const sx of [-1, 1]) boxB(0.07, cy - 0.06, 0.07, wood).at(sx * (w / 2 - 0.22), 0, -d * 0.2).to(st);
    // goods on the counter: three tilted trays
    for (let i = 0; i < 3; i++) {
      const tr = grp().at((i - 1) * (w - 0.5) / 3, cy, d * 0.12), tw = (w - 0.6) / 3, td = 0.6; tr.rotation.x = 0.22; st.add(tr);
      box(tw, 0.05, td, shade(wood, 1.12)).at(0, 0.07, 0).to(tr); for (const sx of [-1, 1]) box(0.03, 0.14, td, shade(wood, 0.9)).at(sx * tw / 2, 0.11, 0).to(tr); box(tw, 0.14, 0.03, shade(wood, 0.9)).at(0, 0.11, td / 2).to(tr); box(tw, 0.14, 0.03, shade(wood, 0.9)).at(0, 0.11, -td / 2).to(tr);
      const n = goods === 'cloth' ? 4 : goods === 'pots' ? 4 : goods === 'potions' ? 5 : 14;
      for (let k = 0; k < n; k++) {
        const x = (r() - 0.5) * (tw - 0.14), z = (r() - 0.5) * (td - 0.14);
        if (goods === 'fruit') ball(0.055 + r() * 0.015, pick(r, [['#b8322a', '#c8502c'], ['#e08a2a', '#e8a13a'], ['#8fae3a', '#b9c04a']][i]), 0).at(x, 0.14 + r() * 0.05, z).to(tr);
        else if (goods === 'bread') ball(0.08, pick(r, ['#b9803f', '#c9924a', '#a36a30']), 0).scl(1 + r() * 0.5, 0.6, 0.8).at(x, 0.15 + r() * 0.04, z).rot(0, r() * 3, 0).to(tr);
        else if (goods === 'fish') ball(0.09, pick(r, ['#9fb2bd', '#b7c4cb', '#7f95a3']), 0, STEEL).scl(0.42, 0.28, 1.5).at(x * 0.9, 0.14 + r() * 0.03, z * 0.6).rot(0, (r() - 0.5) * 0.8, 0).to(tr);
        else if (goods === 'cloth') cyl(0.07, 0.07, tw - 0.1, 7, pick(r, [C.red, C.blue, C.green, C.purple, '#d9a441', '#d8d2c2']), { vary: 0.06 }).rot(0, 0, PI / 2).at(0, 0.17 + (k % 2) * 0.02, -td / 2 + 0.12 + k * 0.13).to(tr);
        else if (goods === 'pots') lathe([[0.05, 0], [0.09, 0.06], [0.07, 0.16], [0.045, 0.2], [0.06, 0.23], [0.045, 0.23], [0.03, 0.19]], 7, pick(r, ['#b5653c', '#9c5632', '#c98a56', '#6d7f8a'])).at((k % 2 - 0.5) * tw * 0.5, 0.1, (Math.floor(k / 2) - 0.5) * td * 0.5).to(tr);
        else { const pc = pick(r, [C.poison, C.magic, C.arcane, '#ff6a8a', '#ffd24a']); lathe([[0.035, 0], [0.05, 0.03], [0.05, 0.09], [0.018, 0.13], [0.018, 0.17], [0.026, 0.18]], 6, glo(pc, 1.2)).at((k % 3 - 1) * tw * 0.28, 0.1, (Math.floor(k / 3) - 0.5) * td * 0.45).to(tr); }
      }
    }
    sack({ seed }).at(-w / 2 - 0.3, 0, 0.3).to(st); sack({ seed: seed + 2, size: 0.4 }).at(-w / 2 - 0.25, 0, -0.25).to(st); crate({ size: 0.5, seed }).at(w / 2 + 0.33, 0, 0.1).to(st);
    g.add(bake(st)); g.userData = { vendor: [0, 0, -d / 2 - 0.45], customer: [0, 0, d / 2 + 0.9], counterY: cy }; return g;
  }
  /** Anvil on a stump with a hammer. o: {stump: true, color (iron), seed}   userData: {top: y of the face} */
  function anvil(o = {}) {
    const { stump = true, color = '#4a4e57', seed = 1 } = o, g = grp(), st = grp(), y0 = stump ? 0.5 : 0, m = { metal: 0.5, rough: 0.42 };
    if (stump) { cylB(0.25, 0.29, 0.5, 9, '#6b4a2e', { vary: 0.12, seed }).to(st); cyl(0.235, 0.235, 0.012, 9, '#c9a877').at(0, 0.5, 0).to(st); }
    xtr([[-0.2, 0], [0.2, 0], [0.2, 0.06], [0.1, 0.1], [0.09, 0.19], [0.22, 0.23], [0.22, 0.32], [-0.3, 0.32], [-0.3, 0.25], [-0.1, 0.19], [-0.1, 0.1], [-0.2, 0.06]], 0.17, color, m).at(0, y0, 0).to(st);
    cone(0.075, 0.3, 6, color, m).rot(0, 0, -PI / 2).at(0.37, y0 + 0.262, 0).to(st); box(0.5, 0.012, 0.172, shade(color, 1.5), { metal: 0.6, rough: 0.25 }).at(-0.04, y0 + 0.326, 0).to(st);
    box(0.11, 0.055, 0.055, '#5c616b', m).at(-0.1, y0 + 0.36, 0.03).rot(0, 0.5, 0).to(st); rod([-0.1, y0 + 0.36, 0.03], [0.14, y0 + 0.37, -0.12], 0.014, C.woodLt).to(st);
    g.add(bake(st)); g.userData = { top: y0 + 0.33 }; return g;
  }
  /**
   * Blacksmith's forge: an open-fronted smithy with a glowing hearth, bellows, anvil, quench barrel and tools.
   * o: {width: 5, depth: 3.6, lit: true, color (stone), wood, roofColor, seed}
   * userData: {flame, lightPos, setLit(on), smith: [x,y,z], anvilPos, smokePos, update(t)}
   */
  function forge(o = {}) {
    const { width: w = 5, depth: d = 3.6, lit = true, color = C.stone, wood = C.woodDk, roofColor, seed = 1 } = o, g = grp(), st = grp(), sm = stoneMat(color, { seed }), hx = -w / 2 + 1.05, hzz = -d / 2 + 0.85, eave = 2.5, rise = 1.25;
    tbox(w, eave, 0.36, sm, 1.5, 0, 0, -d / 2 + 0.18).to(st); tbox(0.36, eave, d * 0.55, sm, 1.5, -w / 2 + 0.18, 0, -d / 2 + d * 0.275).to(st); tbox(w, 0.06, d, paveMat('flag', shade(color, 0.85)), 2).to(st);
    for (const sx of [-1, 1]) { boxB(0.2, eave, 0.2, wood).at(sx * (w / 2 - 0.1), 0, d / 2 - 0.1).to(st); beam([sx * (w / 2 - 0.1), eave - 0.75, d / 2 - 0.1], [sx * (w / 2 - 0.85), eave - 0.08, d / 2 - 0.1], 0.11, 0.11, wood).to(st); }
    boxB(0.2, eave, 0.2, wood).at(w / 2 - 0.1, 0, -d / 2 + 0.46).to(st); box(w, 0.2, 0.2, wood).at(0, eave + 0.1, d / 2 - 0.1).to(st); box(0.2, 0.2, d, wood).at(w / 2 - 0.1, eave + 0.1, 0).to(st); box(0.2, 0.2, d, wood).at(-w / 2 + 0.1, eave + 0.1, 0).to(st);
    gableRoof(w + 0.7, d + 0.2, rise, roofMat('shingle', roofColor), { over: 0.4, thick: 0.1, cap: shade(wood, 0.8) }).at(0, eave + 0.2, 0).to(st);
    for (const sx of [-1, 1]) xtr([[-d / 2 - 0.1, 0], [d / 2 + 0.1, 0], [0, rise]], 0.08, shade(wood, 1.25)).rot(0, PI / 2, 0).at(sx * (w / 2 - 0.1), eave + 0.2, 0).to(st);
    // hearth with hood and chimney
    tbox(1.5, 0.82, 1.15, sm, 1.2, hx, 0, hzz).to(st); tbox(1.62, 0.1, 1.27, stoneMat(shade(color, 0.8), { seed: seed + 4 }), 1.2, hx, 0.82, hzz).to(st); box(1.1, 0.06, 0.8, '#241f1d').at(hx, 0.925, hzz).to(st);
    const hood = cylB(0.3, 0.86, 1.25, 4, shade(color, 0.72), { vary: 0.06 }); hood.rotation.y = PI / 4; hood.scale.set(1, 1, 0.78); hood.position.set(hx, 1.75, hzz - 0.1); st.add(hood); tbox(0.55, 2.3, 0.5, sm, 1.2, hx, 2.9, hzz - 0.12).to(st); box(0.68, 0.1, 0.62, shade(color, 0.75)).at(hx, 5.25, hzz - 0.12).to(st);
    const r = R(seed, 9); for (let i = 0; i < 9; i++) blob(0.07 + r() * 0.04, '#2a2321', seed + i, { detail: 0 }).at(hx + (r() - 0.5) * 0.9, 0.97, hzz + (r() - 0.5) * 0.6).to(st);
    // bellows
    const bl = grp().at(hx + 1.2, 1.0, hzz), bp = [[0, -0.06], [0.75, -0.3], [0.85, 0], [0.75, 0.3], [0, 0.06]]; xtr(bp, 0.2, '#6b4630').rot(PI / 2, 0, 0).to(bl); for (const sy of [-1, 1]) xtr(bp.map(p => [p[0] * 1.04, p[1] * 1.08]), 0.035, wood).rot(PI / 2, 0, 0).at(0, sy * 0.115, 0).to(bl); rod([-0.44, 0, 0], [0.02, 0, 0], 0.03, C.iron, IRON).to(bl); rod([0.8, 0.13, 0], [1.3, 0.3, 0], 0.025, wood).to(bl); st.add(bl);
    boxB(0.08, 0.87, 0.08, wood).at(hx + 1.6, 0, hzz - 0.2).to(st); boxB(0.08, 0.87, 0.08, wood).at(hx + 1.6, 0, hzz + 0.2).to(st); box(0.08, 0.06, 0.5, wood).at(hx + 1.6, 0.85, hzz).to(st);
    // anvil, quench barrel, bench, tools on the wall
    const av = anvil({ seed }); av.position.set(0.25, 0.06, 0.45); av.rotation.y = -0.5; st.add(av); barrel({ open: true, fill: 'water', seed, height: 0.8 }).at(w / 2 - 0.75, 0.06, 0.85).to(st);
    const tx0 = 0.9; tbox(1.6, 0.07, 0.6, woodMat(C.wood, { planks: 3, horiz: true }), 0.8, tx0, 0.84, -d / 2 + 0.72).to(st); for (const sx of [-1, 1]) for (const sz of [-1, 1]) boxB(0.08, 0.84, 0.08, wood).at(tx0 + sx * 0.7, 0, -d / 2 + 0.72 + sz * 0.22).to(st);
    box(0.78, 0.02, 0.07, glo('#ff7a2a', 1.4)).at(tx0 - 0.1, 0.925, -d / 2 + 0.7).rot(0, 0.25, 0).to(st); box(0.22, 0.03, 0.05, '#3b2a1f').at(tx0 + 0.36, 0.925, -d / 2 + 0.83).rot(0, 0.25, 0).to(st);
    box(1.9, 0.09, 0.05, wood).at(tx0 + 0.1, 1.95, -d / 2 + 0.39).to(st);
    for (let i = 0; i < 5; i++) { const x = tx0 - 0.65 + i * 0.38, yy = 1.9; if (i % 2) { rod([x, yy, -d / 2 + 0.42], [x, yy - 0.5, -d / 2 + 0.42], 0.015, C.woodLt).to(st); box(0.14, 0.07, 0.07, '#565b65', IRON).at(x, yy - 0.5, -d / 2 + 0.42).to(st); } else { rod([x - 0.03, yy, -d / 2 + 0.42], [x + 0.02, yy - 0.55, -d / 2 + 0.42], 0.011, C.iron, IRON).to(st); rod([x + 0.03, yy, -d / 2 + 0.42], [x - 0.02, yy - 0.55, -d / 2 + 0.42], 0.011, C.iron, IRON).to(st); } }
    for (let i = 0; i < 3; i++) torus(0.075, 0.018, '#565b65', { ...IRON, rs: 4, ts: 8, arc: PI * 1.5 }).at(w / 2 - 0.9 + i * 0.25, 1.75, -d / 2 + 0.39).rot(0, 0, -PI * 0.25).to(st);
    g.add(bake(st));
    const em = grp(); for (let i = 0; i < 6; i++) blob(0.06 + r() * 0.03, glo('#ff5a1a', 1.5), seed + 30 + i, { detail: 0 }).at(hx + (r() - 0.5) * 0.7, 0.99, hzz + (r() - 0.5) * 0.45).to(em); g.add(em); g.userData.embers = em;
    addFire(g, [hx, 0.98, hzz], 0.55, { seed, lit, halo: 1.6 });
    Object.assign(g.userData, { smith: [0.2, 0.06, 1.2], anvilPos: [0.25, 0.9, 0.45], smokePos: [hx, 5.4, hzz - 0.12] }); return g;
  }
  /**
   * Tower windmill whose sails turn with time.
   * o: {height: 9.5 (tower), radius: 2.7 (at the base), color (walls), capColor, sailColor, speed: 0.7 (rad/s), lit: false, seed}
   * userData: {sails, hub: [x,y,z], update(t), door, open(k), top}
   */
  function windmill(o = {}) {
    const { height: h = 9.5, radius: rb = 2.7, color = '#ddd3bd', capColor = C.woodDk, sailColor = '#e9e1cc', speed = 0.7, lit = false, seed = 1 } = o, g = grp(), st = grp(), rt = rb * 0.66, sides = 10, ap = Math.cos(PI / sides);
    const pm = plasterMat(color, seed), sm = stoneMat(C.stone, { seed }), rAt = y => lerp(rb, rt, y / h);
    tcyl(rt, rb, h, sides, pm, 2).to(st); tcyl(rAt(1.3) + 0.06, rb + 0.14, 1.3, sides, sm, 1.5).to(st); cyl(rt + 0.2, rt + 0.1, 0.22, sides, capColor).at(0, h + 0.05, 0).rot(0, PI / sides, 0).to(st);
    const cap = lathe([[rt + 0.28, 0], [rt + 0.16, 0.55], [rt * 0.7, 1.45], [rt * 0.3, 1.95], [0.0001, 2.1]], sides, shade(capColor, 1.15), { vary: 0.1 }); cap.rotation.y = PI / sides; cap.position.y = h + 0.16; st.add(cap);
    const onFace = (obj, i, y, off = 0.01, tilt = true) => { const a = i * TAU / sides, rr = rAt(y) * ap + off; obj.position.set(Math.sin(a) * rr, y, Math.cos(a) * rr); obj.rotation.order = 'YXZ'; obj.rotation.y = a; if (tilt) obj.rotation.x = -Math.atan2(rb - rt, h); st.add(obj); return obj; };
    const pd = plankDoor(1.0, 2.05, { arch: 'round' }); onFace(grp(xtr(archFrame(1.5, 2.4, 1.0, 2.05), 0.6, C.stoneLt), pd.at(0, 0, -0.08), tbox(1.5, 0.12, 0.5, sm, 1.5).at(0, 0, 0.45)), 1, 0, 0.32, false); g.userData.door = pd.userData.leaf; g.userData.open = pd.userData.open;
    onFace(archWin(0.55, 1.0, { lit }), 0, 3.3, 0.0); onFace(archWin(0.5, 0.9, { lit }), 9, 5.6, 0.0); onFace(archWin(0.5, 0.9, { lit }), 2, 5.9, 0.0); onFace(archWin(0.45, 0.8, { lit }), 0, 7.6, 0.0);
    const hy = h + 0.95, hz0 = rt * 0.75; rod([0, hy - 0.12, -0.6], [0, hy + 0.1, hz0 + 1.0], 0.13, capColor, { sides: 6 }).to(st);
    g.add(bake(st));
    const sails = grp(), ss = grp(), len = Math.min(6.4, hy - 3.2), blades = 4; sails.position.set(0, hy + 0.1, hz0 + 1.0); sails.rotation.x = -0.12;
    cyl(0.24, 0.24, 0.3, 8, shade(capColor, 0.8)).rot(PI / 2, 0, 0).to(ss); cone(0.2, 0.3, 8, shade(capColor, 0.8)).rot(PI / 2, 0, 0).at(0, 0, 0.3).to(ss);
    const key = ['sail', hex(sailColor)].join('|'), sm2 = tmat(key, () => ctex(key, 64, 256, (c, W, H) => { c.fillStyle = hex(sailColor); c.fillRect(0, 0, W, H); for (let y = 0; y < H; y += 32) { c.fillStyle = 'rgba(90,70,40,.35)'; c.fillRect(0, y, W, 3); } c.fillStyle = 'rgba(90,70,40,.3)'; c.fillRect(30, 0, 3, H); }), { side: 'double', rough: 1 });
    for (let i = 0; i < blades; i++) {
      const a = grp(); a.rotation.z = i * TAU / blades; ss.add(a);
      box(0.13, len, 0.13, capColor).at(0, len / 2, 0.08).to(a); box(0.07, len - 1.2, 0.07, capColor).at(-1.15, 1.2 + (len - 1.2) / 2, 0.12).to(a);
      for (let k = 0; k <= 7; k++) box(1.2, 0.05, 0.05, capColor).at(-0.58, 1.2 + k * (len - 1.25) / 7, 0.12).to(a);
      const cl = quad(1.08, len - 1.3, sm2).at(-0.58, 1.2 + (len - 1.3) / 2 + 0.02, 0.085); cl.rotation.y = 0.09; a.add(cl);
    }
    sails.add(bake(ss)); g.add(sails);
    Object.assign(g.userData, { sails, hub: [0, hy + 0.1, hz0 + 1.0], top: [0, h + 2.3, 0], update: t => { sails.rotation.z = t * speed; } }); return g;
  }
  /**
   * Humpback stone bridge, running along X (seen from +Z you look at the arch). Stands on flat ground: the stream runs under the arch at y = 0.
   * o: {length: 12, width: 3.6, rise: 2.0 (deck height at the crown), span: 6 (arch opening), color, seed}
   * userData: {deckY(x) (height of the roadway at x), top: [0, rise, 0], length, width}
   */
  function stoneBridge(o = {}) {
    const { length: L = 12, width: w = 3.6, rise = 2.0, span = 6, color = C.stone, seed = 1 } = o, g = grp(), st = grp(), { sm, lt, tc } = stoneSet(color, seed), a = span / 2, ah = rise - 0.55, n = 14;
    const deckY = x => rise * 0.5 * (1 + Math.cos(PI * clamp(Math.abs(x) / (L / 2)))), top = []; for (let i = 0; i <= n; i++) { const x = L / 2 - i * L / n; top.push([x, deckY(x)]); }
    const arch = []; for (let i = 0; i <= 10; i++) { const t = PI - i / 10 * PI; arch.push([a * Math.cos(t), ah * Math.sin(t)]); }
    textr([...arch, [L / 2, 0], ...top.slice(1, -1), [-L / 2, 0]], w, sm, 3).to(st);
    for (const sz of [-1, 1]) {
      const z = sz * (w / 2 - 0.14), par = [...top.map(p => [p[0], p[1] - 0.05]), ...top.slice().reverse().map(p => [p[0], p[1] + 0.85])], cop = [...top.map(p => [p[0], p[1] + 0.85]), ...top.slice().reverse().map(p => [p[0], p[1] + 0.97])];
      textr(par, 0.3, sm, 3).at(0, 0, z).to(st); xtr(cop, 0.42, tc).at(0, 0, z).to(st);
      for (const sx of [-1, 1]) { tbox(0.5, 1.25, 0.5, sm, 1.5).at(sx * (L / 2 - 0.2), 0, z).to(st); coneB(0.4, 0.3, 4, tc).rot(0, PI / 4, 0).at(sx * (L / 2 - 0.2), 1.25, z).to(st); }
      for (let i = 0; i < 11; i++) { const t = (i + 0.5) / 11 * PI, key = i === 5, rr = 1 + (key ? 0.06 : 0); box(a * PI / 11 * 0.82, key ? 0.52 : 0.4, 0.1, shade(color, key ? 1.3 : i % 2 ? 1.1 : 1.2)).at(Math.cos(t) * (a + 0.2) * rr, Math.sin(t) * (ah + 0.2) * rr, sz * (w / 2 + 0.03)).rot(0, 0, Math.atan2(Math.cos(t) * ah, -Math.sin(t) * a)).to(st); }
    }
    g.add(bake(st)); g.userData = { deckY, top: [0, rise, 0], length: L, width: w }; return g;
  }
  /** Haystack with a pitchfork. o: {radius: 1.3, height: 2.1, color, fork: true, seed} */
  function haystack(o = {}) {
    const { radius: r = 1.3, height: h = 2.1, color = C.thatch, fork = true, seed = 1 } = o, g = grp(), st = grp(), rr = R(seed, 3);
    lathe([[r * 0.96, 0], [r * 1.06, h * 0.22], [r * 0.95, h * 0.5], [r * 0.6, h * 0.8], [r * 0.2, h * 0.97], [0.0001, h]], 9, color, { vary: 0.14, jitter: r * 0.045, seed }).to(st);
    cylB(0.04, 0.05, h + 0.45, 5, C.woodDk).to(st);
    for (let i = 0; i < 9; i++) { const an = rr() * TAU, d = r * (0.95 + rr() * 0.25); cone(0.1 + rr() * 0.08, 0.3 + rr() * 0.25, 4, shade(color, 0.9 + rr() * 0.2)).at(Math.sin(an) * d, 0.12, Math.cos(an) * d).rot((rr() - 0.5) * 0.9, rr() * 3, (rr() - 0.5) * 0.9).to(st); }
    if (fork) { const f = grp().at(r * 0.8, 0, r * 0.75); rod([0, 0, 0], [0, 1.45, 0], 0.02, C.woodLt).to(f); box(0.22, 0.025, 0.025, C.iron, IRON).at(0, 1.45, 0).to(f); for (const x of [-0.1, 0, 0.1]) rod([x, 1.45, 0], [x, 1.75, 0.03], 0.01, C.iron, IRON).to(f); f.rotation.set(-0.42, 0.6, 0.12); st.add(f); }
    g.add(bake(st)); return g;
  }
  /** Spoked wheel in the YZ plane (axle along X), centred on its axle. Returns a group to spin with rotation.x. */
  function wheel(r = 0.55, color = C.wood, spokes = 8) {
    const st = grp(); torus(r - 0.045, 0.045, color, { rs: 4, ts: 12 }).rot(0, PI / 2, 0).to(st); torus(r - 0.01, 0.02, C.iron, { ...IRON, rs: 4, ts: 12 }).rot(0, PI / 2, 0).to(st);
    for (let i = 0; i < spokes; i++) { const a = i * TAU / spokes; box(0.045, r - 0.1, 0.05, shade(color, 0.85)).at(0, Math.cos(a) * (r - 0.05) / 2, Math.sin(a) * (r - 0.05) / 2).rot(a, 0, 0).to(st); }
    cyl(0.085, 0.085, 0.18, 8, shade(color, 0.7)).rot(0, 0, PI / 2).to(st); cyl(0.04, 0.04, 0.22, 6, C.iron, IRON).rot(0, 0, PI / 2).to(st);
    const w = grp(bake(st)); w.userData.r = r; return w;
  }
  /**
   * Hand cart (two wheels) or wagon (four). Shafts point toward +Z.
   * o: {type: 'cart' | 'wagon', load: 'hay' | 'barrels' | 'sacks' | 'crates' | 'none', color, seed}
   * userData: {wheels, roll(distance) (turns the wheels for that much travel), bedY, seat}
   */
  function cart(o = {}) {
    const { type = 'cart', load = 'hay', color = C.wood, seed = 1 } = o, g = grp(), st = grp(), wag = type === 'wagon', Lb = wag ? 3.0 : 2.0, wb = 1.25, by = wag ? 0.92 : 0.84, r = R(seed, 2), wm = woodMat(color, { planks: 4, horiz: true, seed }), dk = shade(color, 0.72);
    tbox(wb, 0.06, Lb, woodMat(color, { planks: 5, seed }), 1.2, 0, by, 0).to(st);
    for (const sx of [-1, 1]) { tbox(0.045, 0.36, Lb, wm, 0.72, sx * (wb / 2 - 0.02), by + 0.06, 0).to(st); for (let i = 0; i < (wag ? 4 : 3); i++) boxB(0.06, 0.62, 0.06, dk).at(sx * (wb / 2 + 0.03), by - 0.08, -Lb / 2 + 0.15 + i * (Lb - 0.3) / (wag ? 3 : 2)).to(st); box(0.07, 0.07, Lb + 0.5, dk).at(sx * (wb / 2 - 0.12), by - 0.04, 0.15).to(st); }
    tbox(wb, 0.36, 0.045, wm, 0.72, 0, by + 0.06, -Lb / 2 + 0.02).to(st); tbox(wb, 0.24, 0.045, wm, 0.72, 0, by + 0.06, Lb / 2 - 0.02).to(st);
    const wheels = [], addW = (x, z, rad) => { const wl = wheel(rad, color, 8); wl.position.set(x, rad, z); g.add(wl); wheels.push(wl); };
    if (wag) { for (const sx of [-1, 1]) { addW(sx * (wb / 2 + 0.14), -Lb / 2 + 0.6, 0.6); addW(sx * (wb / 2 + 0.14), Lb / 2 - 0.5, 0.48); } cyl(0.045, 0.045, wb + 0.4, 6, dk).rot(0, 0, PI / 2).at(0, 0.6, -Lb / 2 + 0.6).to(st); cyl(0.045, 0.045, wb + 0.4, 6, dk).rot(0, 0, PI / 2).at(0, 0.48, Lb / 2 - 0.5).to(st); box(0.3, by - 0.6, 0.12, dk).at(0, (by + 0.6) / 2, -Lb / 2 + 0.6).to(st); box(0.3, by - 0.48, 0.12, dk).at(0, (by + 0.48) / 2, Lb / 2 - 0.5).to(st);
      beam([0, 0.48, Lb / 2 - 0.4], [0, 0.42, Lb / 2 + 2.3], 0.08, 0.08, dk).to(st); box(1.0, 0.06, 0.06, dk).at(0, 0.43, Lb / 2 + 1.9).to(st); tbox(wb + 0.1, 0.06, 0.38, woodMat(color, { planks: 2, horiz: true }), 0.5, 0, by + 0.5, Lb / 2 - 0.3).to(st); for (const sx of [-1, 1]) boxB(0.06, 0.5, 0.3, dk).at(sx * (wb / 2 - 0.05), by + 0.04, Lb / 2 - 0.3).to(st); }
    else { for (const sx of [-1, 1]) { addW(sx * (wb / 2 + 0.14), -0.1, 0.62); beam([sx * (wb / 2 - 0.12), by - 0.04, Lb / 2], [sx * (wb / 2 - 0.2), by - 0.1, Lb / 2 + 1.5], 0.06, 0.07, dk).to(st); } cyl(0.045, 0.045, wb + 0.4, 6, dk).rot(0, 0, PI / 2).at(0, 0.62, -0.1).to(st); box(0.3, by - 0.62, 0.12, dk).at(0, (by + 0.62) / 2, -0.1).to(st); rod([0, by - 0.04, Lb / 2 - 0.1], [0, 0, Lb / 2 + 0.25], 0.035, dk).to(st); rod([0, by - 0.04, -Lb / 2 + 0.1], [0, 0, -Lb / 2 - 0.2], 0.035, dk).to(st); }
    const ly = by + 0.06;
    if (load === 'hay') { blob(wb * 0.55, C.thatch, seed, { squash: [1, 0.62, Lb / wb * 0.92], bump: 0.16 }).at(0, ly + 0.42, 0).to(st); blob(wb * 0.4, shade(C.thatch, 1.08), seed + 3, { squash: [1, 0.7, 1.2] }).at(0.05, ly + 0.75, -0.1).to(st); }
    else if (load === 'barrels') { barrel({ seed }).at(-0.28, ly, -Lb / 2 + 0.45).to(st); barrel({ seed: seed + 1 }).at(0.3, ly, -Lb / 2 + 0.5).to(st); const lb = barrel({ seed: seed + 2, lying: true }); lb.position.set(0, ly, Lb / 2 - 0.6); st.add(lb); }
    else if (load === 'sacks') { for (let i = 0; i < (wag ? 6 : 4); i++) sack({ seed: seed + i, size: 0.42 + r() * 0.08 }).at((i % 2 - 0.5) * 0.55 + (r() - 0.5) * 0.1, ly, -Lb / 2 + 0.4 + Math.floor(i / 2) * 0.62).rot(0, r() * 3, 0).to(st); }
    else if (load === 'crates') { crate({ size: 0.55, seed }).at(-0.28, ly, -Lb / 2 + 0.4).to(st); crate({ size: 0.5, seed: seed + 1 }).at(0.3, ly, -Lb / 2 + 0.42).to(st); crate({ size: 0.45, seed: seed + 2 }).at(-0.2, ly + 0.55, -Lb / 2 + 0.42).rot(0, 0.3, 0).to(st); crate({ size: [0.7, 0.4, 0.5], seed: seed + 3 }).at(0, ly, Lb / 2 - 0.55).to(st); }
    g.add(bake(st)); g.userData = { wheels, bedY: ly, seat: wag ? [0, by + 0.56, Lb / 2 - 0.3] : null, roll: dist => wheels.forEach(wl => { wl.rotation.x = dist / wl.userData.r; }) }; return g;
  }

  // @@NEXT@@

  // ---------- stage helpers ----------
  /** Register every userData.update(t) found under the given objects with the stage. o: {global: true} uses film time instead of shot time. */
  function animate(s, ...roots) {
    const o = roots.length && roots[roots.length - 1] && !roots[roots.length - 1].isObject3D ? roots.pop() : {}, fns = [];
    const walk = x => { if (!x) return; if (typeof x.userData.update === 'function') { fns.push(x.userData.update); if (x.userData.composite) return; } x.children.forEach(walk); };
    roots.flat().forEach(walk);
    if (fns.length) s.tick((lt, t) => { const tt = o.global ? t : lt; for (const f of fns) f(tt); });
    return fns.length;
  }
  /** World position (array) of a builder-space point, once the builder has been placed. */
  function worldPos(obj, p) { obj.updateWorldMatrix(true, false); const v = V(p).applyMatrix4(obj.matrixWorld); return [v.x, v.y, v.z]; }
  /**
   * Put flickering point lights on the fires under root (anything with userData.lightPos). Call after placing the set.
   * o: {max: 3 (the shot budget is 6 lights in total), intensity: 0.7, range: 9, near: [x, y, z] (prefer fires close to this point)}. Returns the lights.
   */
  function lightFlames(s, root, o = {}) {
    const found = []; root.updateMatrixWorld(true);
    root.traverse(x => { const U = x.userData; if (U && U.lightPos && U.lit !== false) found.push({ x, p: V(U.lightPos).applyMatrix4(x.matrixWorld), c: U.lightColor || C.fire, k: U.lightPower || 1 }); });
    if (o.near) { const n = V(o.near); found.sort((a, b) => a.p.distanceTo(n) - b.p.distanceTo(n)); } else found.sort((a, b) => b.k - a.k);
    const lights = found.slice(0, o.max ?? 3).map((f, i) => { const l = s.point(f.p, f.c, (o.intensity ?? 0.7) * f.k, (o.range ?? 9) * Math.sqrt(f.k)); l.userData.seed = i * 13 + 1; l.userData.src = f.x; return l; });
    if (lights.length) s.tick((lt, t) => { for (const l of lights) l.intensity = (l.userData.src.userData.lit === false ? 0 : l.userData.base) * S3.flicker(o.global ? t : lt, o.flicker ?? 0.22, 8, l.userData.seed); });
    return lights;
  }

  return {
    palette: C, animate, lightFlames, worldPos, bake, shade, mix,
    stoneMat, woodMat, roofMat, plasterMat, paveMat, glassMat,
    flame, wallTorch, brazier,
    wall, towerRound, towerSquare, gatehouse, drawbridge, keep, well, banner, shield, plankDoor, doubleDoor,
    house, tavern, marketStall, forge, anvil, windmill, stoneBridge, haystack, cart, barrel, crate, sack, lantern,
  };
})();
