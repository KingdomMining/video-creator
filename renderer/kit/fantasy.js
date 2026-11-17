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
    wood: '#7d5636', woodDk: '#503823', woodLt: '#a98052', plaster: '#e6d8b9', thatch: '#c8a85e', tile: '#ab4a30',
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
        const rows = 3, rh = h / rows;
        for (let j = 0; j < rows; j++) {
          const g = c.createLinearGradient(0, j * rh, 0, (j + 1) * rh); g.addColorStop(0, shade(col, 0.62)); g.addColorStop(0.25, shade(col, 0.9)); g.addColorStop(1, shade(col, 1.08)); c.fillStyle = g; c.fillRect(0, j * rh, w, rh);
          for (let i = 0; i < 90; i++) { const x = r() * w, y = j * rh + r() * rh * 0.9; c.fillStyle = r() < 0.5 ? 'rgba(60,40,10,.22)' : 'rgba(255,240,190,.2)'; c.fillRect(x, y, 2, 8 + r() * rh * 0.4); }
          for (let x = 0; x < w; x += 6) { c.fillStyle = shade(col, 0.55); c.fillRect(x, (j + 1) * rh - 2 - r() * 5, 4, 7); }
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
  /** A cluster of flame tongues `size` metres tall (1 = a campfire). userData.update(t) makes it lick and flicker. */
  function flame(size = 1, color = C.fire, seed = 1) {
    const g = grp(), hot = mix(color, '#ffe58a', 0.6), core = mix(color, '#fff7d6', 0.85), red = mix(color, '#e8361a', 0.45);
    [[0, 0, 0.17, 0.72, color, 1.5], [0.09, 0.03, 0.12, 0.5, hot, 1.6], [-0.08, 0.06, 0.11, 0.44, red, 1.4], [-0.02, -0.1, 0.11, 0.48, hot, 1.6], [0.01, 0.05, 0.1, 0.3, core, 1.8]]
      .forEach(([x, z, r, h, c, k], i) => { const m = drop(r * size, h * size, 5, glo(c, k)).at(x * size, 0, z * size); m.rotation.y = i * 1.3; g.add(m); });
    g.userData.update = t => g.children.forEach((m, i) => { const a = noise1(t * 6 + i * 3.1, seed + i), b = noise1(t * 8.5 + i * 1.7, seed + i + 9); m.scale.set(1 + a * 0.14, 1 + b * 0.26, 1 + a * 0.14); m.rotation.z = 0.16 * noise1(t * 4.3 + i, seed + 20 + i); m.rotation.x = 0.16 * noise1(t * 3.7 + i, seed + 40 + i); });
    return g;
  }
  /** Put fire on group g at one or several local points. Fills userData.flame, .flames, .flares, .lightPos, .setLit, and chains update(t). */
  function addFire(g, pts, size, o = {}) {
    if (typeof pts[0] === 'number') pts = [pts];
    const color = o.color || C.fire, seed = o.seed || 1, fs = [], hs = [], c = [0, 0, 0];
    pts.forEach((p, i) => {
      const f = (size < 0.12 ? grp(drop(size * 0.22, size, 5, glo(mix(color, '#fff2b8', 0.6), 1.7))) : flame(size, color, seed + i * 7)).at(p[0], p[1], p[2]); g.add(f); fs.push(f);
      const h = flare(color, o.halo ?? Math.max(0.5, size * 2.6), o.haloOpacity ?? 0.42).at(p[0], p[1] + size * 0.35, p[2]); g.add(h); hs.push(h); c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length;
    });
    const U = g.userData, op = o.haloOpacity ?? 0.42; U.flame = fs[0]; U.flames = fs; U.flares = hs; U.lightPos = [c[0], c[1] + size * 0.4, c[2]]; U.lightColor = color; U.lit = true;
    U.setLit = on => { U.lit = !!on; fs.forEach(f => { f.visible = !!on; }); hs.forEach(h => { h.visible = !!on; }); if (U.embers) U.embers.visible = !!on; };
    chain(g, t => { fs.forEach((f, i) => { if (f.userData.update) f.userData.update(t + i * 1.7); else f.scale.y = 1 + 0.18 * noise1(t * 9 + i * 2.3, seed + i); }); hs.forEach((h, i) => { h.material.opacity = op * S3.flicker(t + i, 0.3, 9, seed + i); }); });
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
  const stoneSet = (color, seed) => ({ sm: stoneMat(color, { seed }), lt: stoneMat(shade(color, 1.1), { seed: seed + 3 }), dk: stoneMat(shade(color, 0.82), { seed: seed + 5 }) });
  /** Arrow slit, back on z = 0, bottom at y = 0. */
  const slit = (h = 1.0) => grp(box(0.1, h, 0.03, C.dark).at(0, h / 2, 0.016), box(0.34, 0.09, 0.07, C.stoneLt).at(0, -0.045, 0.02), box(0.3, 0.08, 0.06, C.stoneLt).at(0, h + 0.04, 0.02));
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
    const s = length / Math.max(1, Math.round(length / 3)), { sm, lt } = stoneSet(color, seed), n = Math.max(1, Math.round(length / 1.6));
    tbox(length, height, thick, sm, s).to(st); tbox(length, 0.75, thick + 0.36, sm, s).to(st); tbox(length, 0.16, thick + 0.2, lt, s, 0, 0.75, 0).to(st);
    tbox(length, 0.24, thick + 0.34, lt, s, 0, height - 0.24, 0).to(st);
    if (parapet !== 'none') for (const sd of parapet === 'both' ? [1, -1] : [1]) { const pz = sd * (thick / 2 - 0.08); tbox(length, 0.95, 0.45, sm, s, 0, height, pz).to(st); merlons(st, length, n, height + 0.95, pz, sm, { s, cap: C.stoneLt, slits: slits && sd > 0 ? 1 : 0 }); }
    if (parapet === 'outer') tbox(length, 0.22, 0.3, lt, s, 0, height, -thick / 2 + 0.15).to(st);
    g.add(bake(st)); g.userData = { length, height, thick, walkY: height }; return g;
  }
  /** Small flag on a pole (standing at the origin). userData.update(t) makes it flutter. */
  function pennant(h = 2.4, color = C.red, len = 1.3) {
    const g = grp(cylB(0.03, 0.04, h, 5, C.woodDk), ball(0.06, C.gold, 0, GOLD).at(0, h + 0.03, 0)), fl = grp().at(0, h - 0.34, 0), w = len / 3, parts = [];
    for (let i = 0; i < 3; i++) { const hh0 = 0.56 * (1 - i / 3), hh1 = 0.56 * (1 - (i + 1) / 3), p = grp().at(i ? w : 0.02, 0, 0); const q = mesh(new T.BufferGeometry().setFromPoints([V([0, -hh0 / 2, 0]), V([w, -hh1 / 2, 0]), V([w, hh1 / 2, 0]), V([0, -hh0 / 2, 0]), V([w, hh1 / 2, 0]), V([0, hh0 / 2, 0])]), i === 1 ? shade(color, 0.85) : color, { side: 'double' }); q.geometry.computeVertexNormals(); p.add(q); (i ? parts[i - 1] : fl).add(p); parts.push(p); }
    g.add(fl); g.userData.flag = fl; g.userData.update = t => parts.forEach((p, i) => { p.rotation.y = (i ? 0.5 : 0.25) * Math.sin(t * 3.2 - i * 1.1) + 0.12 * noise1(t * 1.3 + i, 3); }); g.userData.update(0); return g;
  }
  // @@NEXT@@

  // ---------- stage helpers ----------
  /** Register every userData.update(t) found under the given objects with the stage. o: {global: true} uses film time instead of shot time. */
  function animate(s, ...roots) {
    const o = roots.length && roots[roots.length - 1] && !roots[roots.length - 1].isObject3D ? roots.pop() : {}, fns = [];
    roots.flat().forEach(r => r && r.traverse(x => { if (x.userData && typeof x.userData.update === 'function') fns.push(x.userData.update); }));
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
    flame, wallTorch, brazier, wall, towerRound,
  };
})();
