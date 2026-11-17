// kit/scifi.js - KitSciFi: science fiction, space, laboratories and the deep sea for the low-poly 3D stage.
// Reference with pictures: docs/kit/scifi.md. Contract: docs/STAGE3D.md section 8.
//
// Every builder is name(o = {}) and returns a THREE.Group at real scale (metres), standing on y = 0, centred on its
// footprint, front toward +Z. Deterministic: all variation comes from o.seed. Conventions used throughout this kit:
//   - Anything that animates has userData.update(t): a pure function of time (seconds). Call it from the shot's
//     update(), or hand the objects (or a whole set group) to KitSciFi.animate(s, ...roots) once in build().
//   - Things that open have userData.open(k), k = 0 (shut) .. 1 (open). It sets the whole pose: call it every frame.
//   - Screens are exposed as userData.screens: quads with userData.paint(fn(ctx, pxW, pxH)), .set(kind, color), .update(t).
//   - Lamps are exposed as materials (userData.lightMat ...) with userData.setLight(color, k) where natural.
//   - Interior shells (corridor, junction, bridge, submarine) are built from inward-facing surfaces that receive but do
//     not cast shadows: a s.sun() works as a studio key light through the roof, and a camera outside looks straight in.
//   - Wall-mounted pieces have their back on z = 0 and hang at o.y above the floor, so pos: [x, 0, wallZ] just works.
//   - Things that fly or float stand with their lowest point on y = 0: lift the group to fly it.
const KitSciFi = (() => {
  const T = S3.T, { box, boxB, cyl, cylB, cone, coneB, ball, blob, plane, quad, torus, extrude, lathe, tube, grp, glow, flare, mat, mesh } = S3;
  const PI = Math.PI, TAU = PI * 2, sin = Math.sin, cos = Math.cos, abs = Math.abs, sqrt = Math.sqrt, min = Math.min, max = Math.max, floor = Math.floor, hypot = Math.hypot, round = Math.round;
  const V3 = (x, y, z) => new T.Vector3(x, y, z), n1 = S3.noise1;

  // =====================================================================================================
  // palette (defaults: every builder takes colour options)
  // =====================================================================================================
  const PAL = {
    hull: '#8a96a6', hullLt: '#b4bfcc', hullDk: '#55606f', dark: '#262d37', floor: '#39424e', trim: '#e8862e', light: '#8fe9ff', warn: '#ff4a3a', amber: '#ffb547',
    ok: '#5dff9a', white: '#dde3e9', glass: '#9fd8ff', black: '#14181d', alien: '#2a2036', bio: '#62ff9a', brass: '#b08a3e', yellow: '#f0bf2a', rust: '#8a4a2c', gold: '#d8a640',
  };
  /** Surface classes: painted panel, bare metal, rubber / matte. Spread into primitive options: box(1, 1, 1, col, ME). */
  const PA = { rough: 0.8, metal: 0.04 }, ME = { rough: 0.48, metal: 0.38 }, RU = { rough: 1, metal: 0 };
  const C = c => new T.Color(c);
  /** Darken (k < 1) or lighten (k > 1) a colour. */
  const shade = (c, k) => '#' + C(c).multiplyScalar(k).getHexString();
  const mix = (a, b, k) => '#' + C(a).lerp(C(b), k).getHexString();
  const css = (c, a = 1) => { const n = C(c).getHex(); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  /** Options for a pane of glass: transparent, faintly self-lit so it still reads in the dark. Never casts shadows. */
  const GL = (c = PAL.glass, op = 0.28, ei = 0.14) => ({ rough: 0.12, metal: 0, opacity: op, side: 'double', emissive: c, ei });
  const _gs = new Map();
  /** Static glow material (shared, merged by bake). Use glow() from the stage for lamps that animate. */
  const glowS = (c, k = 1) => { const key = c + '|' + k; let m = _gs.get(key); if (!m) { m = glow(c, k); m.userData.static = true; _gs.set(key, m); } return m; };
  const GLOWVC = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  /** Additive see-through glow (beams, holograms, light cones). Not cached: animate .opacity / .color freely. */
  const beamMat = (c, op = 0.3, o = {}) => { const m = new T.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false, fog: o.fog !== false }); if (o.map) m.map = o.map; return m; };

  // =====================================================================================================
  // geometry helpers
  // =====================================================================================================
  /** Merge every static mesh under g into a few vertex-coloured meshes (one per surface class). Sub-groups flagged
   *  userData.live (moving parts) and meshes flagged userData.keep are left alone. o: {tone: per-part brightness variation, seed}. */
  function bake(g, o = {}) {
    g.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(g.matrixWorld).invert(), m4 = new T.Matrix4(), B = new Map(), dead = [], r = o.tone ? rng((o.seed || 1) * 7919 + 13) : null;
    const visit = n => {
      if (n !== g && (n.userData.live || n.userData.keep)) return;
      const m = n.isMesh && n.material;
      if (m && !Array.isArray(m) && !m.userData.own && ((m.isMeshStandardMaterial && !m.transparent) || m.userData.static || m.userData.merge)) {
        const st = !!m.userData.static, tex = !st && (!!m.map || !!m.userData.merge);
        const key = st ? 'G' : tex ? 'T' + m.uuid + (n.castShadow ? 1 : 0) : ['S', m.roughness, m.metalness, m.emissive.getHex(), m.emissiveIntensity, m.side, m.flatShading ? 1 : 0, n.castShadow ? 1 : 0, n.receiveShadow ? 1 : 0].join('|');
        let b = B.get(key); if (!b) B.set(key, b = { m, n, tex, st, pos: [], uv: [], col: [] });
        let geo = n.geometry; geo = geo.index ? geo.toNonIndexed() : geo.clone(); m4.multiplyMatrices(inv, n.matrixWorld); geo.applyMatrix4(m4);
        const P = geo.attributes.position.array, U = geo.attributes.uv && geo.attributes.uv.array, K = geo.attributes.color && geo.attributes.color.array;
        const flip = m4.determinant() < 0, tk = r && !st ? 1 + (r() - 0.5) * 2 * o.tone : 1, mc = m.color;
        for (let i = 0; i < P.length / 3; i += 3) for (let q = 0; q < 3; q++) {
          const v = i + (flip && q ? 3 - q : q); b.pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          if (tex) b.uv.push(U ? U[v * 2] : 0, U ? U[v * 2 + 1] : 0);
          else b.col.push((K ? K[v * 3] : 1) * mc.r * tk, (K ? K[v * 3 + 1] : 1) * mc.g * tk, (K ? K[v * 3 + 2] : 1) * mc.b * tk);
        }
        dead.push(n);
      }
      n.children.slice().forEach(visit);
    };
    visit(g);
    dead.forEach(n => n.parent && n.parent.remove(n));
    B.forEach(b => {
      const geo = new T.BufferGeometry(), m = b.m; geo.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
      if (b.tex) geo.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2)); else geo.setAttribute('color', new T.Float32BufferAttribute(b.col, 3));
      geo.computeVertexNormals();
      const mm = new T.Mesh(geo, b.tex ? m : b.st ? GLOWVC : mat('#ffffff', { rough: m.roughness, metal: m.metalness, emissive: m.emissive.getHex() ? '#' + m.emissive.getHexString() : undefined, ei: m.emissiveIntensity, side: m.side === T.DoubleSide ? 'double' : m.side === T.BackSide ? 'back' : undefined, vc: true, flat: m.flatShading }));
      mm.castShadow = !b.st && b.n.castShadow; mm.receiveShadow = !b.st && b.n.receiveShadow; g.add(mm);
    });
    return g;
  }
  /** Bake a moving part on its own and protect it from its parent's bake. */
  const live = (g, o) => { bake(g, o); g.userData.live = true; return g; };
  /** Finish a builder: merge the static geometry and name the group. */
  const fin = (g, name, seed, tone = 0.035) => { bake(g, { tone, seed }); g.name = 'scifi.' + name; g.userData.kit = name; return g; };
  /** Register a time function on a group: g.userData.update(t) runs them all. */
  const anim = (g, fn) => { const u = g.userData; (u._anim || (u._anim = [])).push(fn); if (!u.update) u.update = (t, a, b) => { for (const f of u._anim) f(t, a, b); return g; }; return g; };
  /** Let a parent drive a nested animated builder. */
  const drive = (g, kid) => { if (kid.userData.update) { kid.userData.driven = true; anim(g, (t) => kid.userData.update(t)); } return kid; };

  /** Cylinder between two points (struts, legs, rails, antennas). o: {sides, r2: radius at b} plus material options. */
  const _up = V3(0, 1, 0);
  function rod(a, b, r, col, o = {}) { const A = S3.V(a), d = S3.V(b).sub(A), len = d.length(), m = cyl(o.r2 ?? r, r, len, o.sides || 6, col, o); m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(_up, d.normalize()); return m; }
  /** Straight pipe run through points with ball joints at the bends. */
  function pipeRun(pts, r, col, o = {}) { const g = grp(); for (let i = 0; i < pts.length - 1; i++) { g.add(rod(pts[i], pts[i + 1], r, col, o)); if (i) g.add(ball(r * 1.12, col, 0, o).at(pts[i])); } return g; }
  /** Quad from four corners (counter-clockwise seen from the front) with uv 0..1. */
  function quad4(a, b, c, d, col, o) { const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3)); geo.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2)); geo.computeVertexNormals(); return mesh(geo, col, o); }
  /** Closed faceted skin through rings of points (all rings the same count). Oriented outward automatically. o: {cap:false, inside:true} plus material options. */
  function loft(rings, col, o = {}) {
    const n = rings[0].length, pos = [], tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < n; j++) { const a = rings[i][j], b = rings[i][(j + 1) % n], c = rings[i + 1][(j + 1) % n], d = rings[i + 1][j]; tri(a, b, c); tri(a, c, d); }
    const cap = (ring, fl) => { const m = [0, 0, 0]; ring.forEach(p => { m[0] += p[0] / n; m[1] += p[1] / n; m[2] += p[2] / n; }); for (let j = 0; j < n; j++) { const a = ring[j], b = ring[(j + 1) % n]; fl ? tri(m, b, a) : tri(m, a, b); } };
    if (o.cap !== false) { cap(rings[0], true); cap(rings[rings.length - 1], false); }
    let vol = 0; for (let i = 0; i < pos.length; i += 9) vol += pos[i] * (pos[i + 4] * pos[i + 8] - pos[i + 5] * pos[i + 7]) - pos[i + 1] * (pos[i + 3] * pos[i + 8] - pos[i + 5] * pos[i + 6]) + pos[i + 2] * (pos[i + 3] * pos[i + 7] - pos[i + 4] * pos[i + 6]);
    if ((vol < 0) !== !!o.inside) for (let i = 0; i < pos.length; i += 9) for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const { cap: _c, inside, ...mo } = o; return mesh(geo, col, mo);
  }
  /** Eight-sided cross-section w x h with chamfers (ct top, cb bottom), centred on (x, y). Counter-clockwise seen from +Z. */
  const oct = (w, h, ct = 0.2, cb = ct, y = 0, x = 0) => { const a = w / 2, b = h / 2; ct = min(ct, a * 0.98, b * 0.98); cb = min(cb, a * 0.98, b * 0.98); return [[a - cb, -b], [a, -b + cb], [a, b - ct], [a - ct, b], [-a + ct, b], [-a, b - ct], [-a, -b + cb], [-a + cb, -b]].map(p => [p[0] + x, p[1] + y]); };
  /** Faceted hull along Z from sections {z, w, h, y (centre height), ct, cb, x}. */
  const hullZ = (secs, col, o) => loft(secs.map(s => oct(s.w, s.h, s.ct ?? 0.2, s.cb ?? s.ct ?? 0.2, s.y || 0, s.x || 0).map(p => [p[0], p[1], s.z])), col, o);
  /** Chamfered box standing on its origin: an eight-sided prism along Z (chamfer c on the X/Y corners). */
  const cboxB = (w, h, d, c, col, o) => loft([-d / 2, d / 2].map(z => oct(w, h, c, c, h / 2).map(p => [p[0], p[1], z])), col, o);
  /** Tube with a radius that tapers from r0 to r1 along a smooth path (tendrils, limbs, kelp stalks, horns). */
  function vine(pts, r0, r1, col, o = {}) {
    const curve = new T.CatmullRomCurve3(pts.map(S3.V)), ts = o.seg || pts.length * 4, rs = o.rs || 5, geo = new T.TubeGeometry(curve, ts, 1, rs, false), P = geo.attributes.position, c = V3();
    for (let i = 0; i <= ts; i++) { curve.getPointAt(i / ts, c); const k = lerp(r0, r1, Math.pow(i / ts, o.pow || 1)); for (let j = 0; j <= rs; j++) { const v = i * (rs + 1) + j; P.setXYZ(v, c.x + (P.getX(v) - c.x) * k, c.y + (P.getY(v) - c.y) * k, c.z + (P.getZ(v) - c.z) * k); } }
    geo.computeVertexNormals(); const { seg, rs: _r, pow, ...mo } = o; return mesh(geo, col, mo);
  }
  /** Shrink (d > 0) or grow (d < 0) a convex counter-clockwise polygon by d. */
  function inset(poly, d) {
    const n = poly.length, out = [], un = (a, b) => { const x = b[0] - a[0], y = b[1] - a[1], l = hypot(x, y) || 1; return [-y / l, x / l]; };
    for (let i = 0; i < n; i++) { const p = poly[i], a = un(poly[(i + n - 1) % n], p), b = un(p, poly[(i + 1) % n]), k = d / (1 + a[0] * b[0] + a[1] * b[1]); out.push([p[0] + (a[0] + b[0]) * k, p[1] + (a[1] + b[1]) * k]); }
    return out;
  }
  /** Multiply the texture coordinates of a mesh (repeat a tiling texture). */
  const uvMul = (m, su, sv) => { const u = m.geometry.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * su, u.getY(i) * sv); return m; };
  /** n evenly spaced angles: ring(6, (a, i) => ...). */
  const ring = (n, fn, a0 = 0) => { for (let i = 0; i < n; i++) fn(a0 + i / n * TAU, i); };
  const noShadow = m => { m.castShadow = false; return m; };
  /** Flat ring in the XZ plane (r0..r1) facing up, with radial uv (u around, v from inner to outer). */
  function annulus(r0, r1, seg, col, o) { const geo = new T.RingGeometry(r0, r1, seg, 1).rotateX(-PI / 2), P = geo.attributes.position, U = geo.attributes.uv; for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), r = hypot(x, z); U.setXY(i, (Math.atan2(z, x) / TAU + 1) % 1, (r - r0) / (r1 - r0)); } return mesh(geo, col, o); }

  // =====================================================================================================
  // textures: one decal atlas (lit and unlit materials), a few tiling textures, live screens
  // =====================================================================================================
  const _tex = new Map();
  const texC = (key, w, h, draw) => { let t = _tex.get(key); if (!t) { t = S3.canvasTex(w, h, draw); t.wrapS = t.wrapT = T.RepeatWrapping; _tex.set(key, t); } return t; };
  const _tm = new Map();
  /** Cached material for a tiling texture. o: {rough, metal, glow:true (unlit), emissive:true} */
  const tileMat = (key, w, h, draw, o = {}) => { let m = _tm.get(key); if (!m) { const t = texC(key, w, h, draw); m = o.glow ? new T.MeshBasicMaterial({ map: t, toneMapped: false }) : new T.MeshStandardMaterial({ map: t, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0.1, flatShading: true }); if (o.emissive) { m.emissiveMap = t; m.emissive = C('#ffffff'); m.emissiveIntensity = o.ei ?? 1; } m.userData.merge = true; _tm.set(key, m); } return m; };
  const FONT = (px, f = 'Orbitron') => `800 ${px}px "${f}"`, MONO = px => `${px}px "Share Tech Mono"`;

  const cells = [];
  const cell = (name, w, h, draw) => cells.push({ name, w, h, draw });
  const stripes = (c, w, h, a, b, sw) => { c.fillStyle = a; c.fillRect(0, 0, w, h); c.fillStyle = b; for (let x = -h - sw; x < w + h; x += sw * 2) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + sw, h); c.lineTo(x + sw + h, 0); c.lineTo(x + h, 0); c.fill(); } };
  const plate = (c, w, h, text, bg, fg, o = {}) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.strokeStyle = fg; c.lineWidth = o.lw ?? 4; if (o.frame !== false) c.strokeRect(6, 6, w - 12, h - 12); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; let px = o.px || h * 0.52; c.font = FONT(px, o.font); while (c.measureText(text).width > w - 26 && px > 8) { px -= 2; c.font = FONT(px, o.font); } c.fillText(text, w / 2, h / 2 + px * 0.06); };
  const tinyText = (c, x, y, w, rows, lh, col, r) => { c.fillStyle = col; for (let i = 0; i < rows; i++) { let cx = x; while (cx < x + w - 8) { const l = 6 + r() * 26; if (cx + l > x + w) break; c.fillRect(cx, y + i * lh, l, lh * 0.45); cx += l + 5; } } };
  cell('hazard', 256, 64, (c, w, h) => stripes(c, w, h, '#f0b323', '#17191d', 26));
  cell('hazardR', 256, 64, (c, w, h) => stripes(c, w, h, '#e9ecef', '#c8322a', 26));
  cell('vent', 128, 128, (c, w, h) => { c.fillStyle = '#2a3038'; c.fillRect(0, 0, w, h); c.fillStyle = '#0b0d10'; c.fillRect(10, 10, w - 20, h - 20); for (let y = 16; y < h - 16; y += 14) { c.fillStyle = '#48525e'; c.fillRect(12, y, w - 24, 7); c.fillStyle = '#6a7684'; c.fillRect(12, y, w - 24, 2); } c.strokeStyle = '#5b6673'; c.lineWidth = 4; c.strokeRect(6, 6, w - 12, h - 12); });
  cell('keypad', 96, 160, (c, w, h) => { c.fillStyle = '#12161b'; c.fillRect(0, 0, w, h); c.fillStyle = '#0b3340'; c.fillRect(10, 10, w - 20, 38); c.fillStyle = '#7fe9ff'; c.fillRect(16, 18, 40, 6); c.fillRect(16, 30, 58, 6); for (let i = 0; i < 12; i++) { c.fillStyle = i === 9 ? '#ff5a4a' : i === 11 ? '#5dff9a' : '#93a2b3'; c.fillRect(12 + (i % 3) * 26, 58 + floor(i / 3) * 24, 20, 17); } });
  cell('buttons', 256, 128, (c, w, h) => { const r = rng(41); c.fillStyle = '#12161b'; c.fillRect(0, 0, w, h); const cols = ['#7fe9ff', '#7fe9ff', '#ffb547', '#ff5a4a', '#5dff9a', '#e9eef3', '#2c3742', '#2c3742'];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 9; x++) { if (x > 5 && y < 2) continue; c.fillStyle = cols[floor(r() * cols.length)]; c.fillRect(10 + x * 27, 10 + y * 29, 20, 20); }
    c.fillStyle = '#0b3340'; c.fillRect(172, 10, 74, 49); c.strokeStyle = '#7fe9ff'; c.lineWidth = 2; c.beginPath(); for (let x = 0; x < 70; x += 2) c.lineTo(174 + x, 36 + sin(x * 0.3) * 12 * sin(x * 0.07)); c.stroke(); });
  cell('keys', 256, 96, (c, w, h) => { const r = rng(8); c.fillStyle = '#12161b'; c.fillRect(0, 0, w, h); for (let y = 0; y < 4; y++) for (let x = 0; x < 13; x++) { c.fillStyle = r() < 0.08 ? '#ffb547' : r() < 0.06 ? '#7fe9ff' : '#58636f'; c.fillRect(8 + x * 18.6 + (y % 2) * 5, 8 + y * 21, 14, 15); } });
  cell('switches', 256, 128, (c, w, h) => { const r = rng(77); c.fillStyle = '#20262d'; c.fillRect(0, 0, w, h); for (let x = 0; x < 10; x++) { const on = r() < 0.6; c.fillStyle = '#0c0f12'; c.fillRect(12 + x * 24, 14, 14, 34); c.fillStyle = '#c9d1da'; c.fillRect(13 + x * 24, on ? 15 : 34, 12, 13); c.fillStyle = on ? '#5dff9a' : '#59221d'; c.beginPath(); c.arc(19 + x * 24, 60, 5, 0, 7); c.fill(); }
    for (let x = 0; x < 5; x++) { c.fillStyle = '#0c0f12'; c.beginPath(); c.arc(30 + x * 48, 98, 19, 0, 7); c.fill(); c.fillStyle = '#b9c2cc'; c.beginPath(); c.arc(30 + x * 48, 98, 14, 0, 7); c.fill(); const a = r() * 5; c.strokeStyle = '#d0342c'; c.lineWidth = 4; c.beginPath(); c.moveTo(30 + x * 48, 98); c.lineTo(30 + x * 48 + cos(a) * 13, 98 + sin(a) * 13); c.stroke(); } });
  const gauge = (seed, face) => (c, w, h) => { const r = rng(seed); c.fillStyle = '#1a1e23'; c.fillRect(0, 0, w, h); c.fillStyle = '#b08a3e'; c.beginPath(); c.arc(w / 2, h / 2, w * 0.48, 0, 7); c.fill(); c.fillStyle = face; c.beginPath(); c.arc(w / 2, h / 2, w * 0.4, 0, 7); c.fill();
    c.strokeStyle = '#1a1e23'; c.lineWidth = 3; for (let i = 0; i <= 10; i++) { const a = PI * 0.75 + i / 10 * PI * 1.5; c.beginPath(); c.moveTo(w / 2 + cos(a) * w * 0.3, h / 2 + sin(a) * w * 0.3); c.lineTo(w / 2 + cos(a) * w * 0.38, h / 2 + sin(a) * w * 0.38); c.stroke(); }
    c.strokeStyle = '#c8322a'; c.lineWidth = 8; c.beginPath(); c.arc(w / 2, h / 2, w * 0.34, PI * 1.95, PI * 2.25); c.stroke(); const a = PI * 0.75 + (0.2 + r() * 0.6) * PI * 1.5; c.strokeStyle = '#111'; c.lineWidth = 5; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 + cos(a) * w * 0.33, h / 2 + sin(a) * w * 0.33); c.stroke(); c.fillStyle = '#111'; c.beginPath(); c.arc(w / 2, h / 2, 7, 0, 7); c.fill(); };
  cell('gauge1', 128, 128, gauge(3, '#efe6cf')); cell('gauge2', 128, 128, gauge(9, '#e4ead8')); cell('gauge3', 128, 128, gauge(14, '#efe6cf'));
  cell('solar', 256, 128, (c, w, h) => { c.fillStyle = '#0d1b3d'; c.fillRect(0, 0, w, h); for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) { const g = c.createLinearGradient(x * 32, y * 32, x * 32 + 32, y * 32 + 32); g.addColorStop(0, '#24489a'); g.addColorStop(1, '#122a66'); c.fillStyle = g; c.fillRect(x * 32 + 2, y * 32 + 2, 28, 28); } c.fillStyle = '#b9c6d8'; c.fillRect(0, h / 2 - 1, w, 2); c.fillRect(w / 2 - 1, 0, 2, h); });
  const windows = (seed, dens, cols) => (c, w, h) => { const r = rng(seed); c.fillStyle = '#0d1116'; c.fillRect(0, 0, w, h); const rows = max(1, round(h / 22)), ch = h / rows; for (let y = 0; y < rows; y++) for (let x = 6; x < w - 14; x += 16) if (r() < dens) { c.fillStyle = cols[floor(r() * cols.length)]; c.fillRect(x, y * ch + ch * 0.25, 9 + (r() < 0.3 ? 14 : 0), ch * 0.5); if (r() < 0.3) x += 14; } };
  cell('win', 512, 32, windows(5, 0.55, ['#ffe2a6', '#ffe2a6', '#fff4d6', '#bfeaff']));
  cell('win2', 512, 64, windows(12, 0.45, ['#ffe2a6', '#fff4d6', '#bfeaff', '#ffcf80']));
  cell('winA', 512, 64, windows(21, 0.4, ['#b9ffd9', '#7dffb9', '#eafff4', '#ff7ad9']));
  cell('barcode', 160, 96, (c, w, h) => { const r = rng(31); c.fillStyle = '#e4e8ec'; c.fillRect(0, 0, w, h); c.fillStyle = '#15181c'; for (let x = 12; x < w - 12;) { const bw = 2 + floor(r() * 5); c.fillRect(x, 12, bw, 44); x += bw + 2 + floor(r() * 4); } tinyText(c, 12, 64, w - 24, 2, 12, '#15181c', r); });
  cell('placard', 160, 96, (c, w, h) => { const r = rng(57); c.fillStyle = '#1b2530'; c.fillRect(0, 0, w, h); c.fillStyle = '#7fe9ff'; c.fillRect(10, 10, 46, 8); tinyText(c, 10, 28, w - 20, 5, 12, '#c7d2dd', r); });
  cell('rack', 128, 256, (c, w, h) => { const r = rng(64); c.fillStyle = '#14181d'; c.fillRect(0, 0, w, h); for (let y = 0; y < 10; y++) { c.fillStyle = '#222931'; c.fillRect(8, 8 + y * 24.4, w - 16, 20); for (let x = 0; x < 7; x++) { const q = r(); c.fillStyle = q < 0.45 ? '#5dff9a' : q < 0.6 ? '#ffb547' : q < 0.66 ? '#ff5a4a' : '#0b0d10'; c.fillRect(14 + x * 9, 14 + y * 24.4, 5, 5); } c.fillStyle = '#0b0d10'; for (let x = 0; x < 6; x++) c.fillRect(82 + x * 6, 12 + y * 24.4, 3, 12); } });
  cell('chevron', 128, 64, (c, w, h) => { c.fillStyle = '#20262d'; c.fillRect(0, 0, w, h); c.strokeStyle = '#f0b323'; c.lineWidth = 9; for (let x = 10; x < w; x += 30) { c.beginPath(); c.moveTo(x, 8); c.lineTo(x + 16, h / 2); c.lineTo(x, h - 8); c.stroke(); } });
  const sym = draw => (c, w, h) => { c.fillStyle = '#f0b323'; c.fillRect(0, 0, w, h); c.strokeStyle = '#17191d'; c.lineWidth = 6; c.strokeRect(5, 5, w - 10, h - 10); c.fillStyle = '#17191d'; c.translate(w / 2, h / 2); draw(c, w * 0.34); };
  cell('s_rad', 128, 128, sym((c, r) => { for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, i * TAU / 3 - 0.52 - PI / 2, i * TAU / 3 + 0.52 - PI / 2); c.fill(); } c.fillStyle = '#f0b323'; c.beginPath(); c.arc(0, 0, r * 0.32, 0, 7); c.fill(); c.fillStyle = '#17191d'; c.beginPath(); c.arc(0, 0, r * 0.2, 0, 7); c.fill(); }));
  cell('s_bio', 128, 128, sym((c, r) => { c.lineWidth = r * 0.24; c.strokeStyle = '#17191d'; for (let i = 0; i < 3; i++) { const a = i * TAU / 3 - PI / 2; c.beginPath(); c.arc(cos(a) * r * 0.5, sin(a) * r * 0.5, r * 0.5, a - 2.2, a + 2.2); c.stroke(); } c.beginPath(); c.arc(0, 0, r * 0.3, 0, 7); c.stroke(); }));
  cell('s_volt', 128, 128, sym((c, r) => { c.beginPath(); c.moveTo(r * 0.25, -r); c.lineTo(-r * 0.55, r * 0.15); c.lineTo(-r * 0.05, r * 0.15); c.lineTo(-r * 0.3, r); c.lineTo(r * 0.55, -r * 0.2); c.lineTo(r * 0.05, -r * 0.2); c.closePath(); c.fill(); }));
  cell('s_warn', 128, 128, sym((c, r) => { c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 1.05, r * 0.85); c.lineTo(-r * 1.05, r * 0.85); c.closePath(); c.fill(); c.fillStyle = '#f0b323'; c.fillRect(-r * 0.1, -r * 0.42, r * 0.2, r * 0.7); c.fillRect(-r * 0.1, r * 0.42, r * 0.2, r * 0.2); }));
  cell('s_cold', 128, 128, (c, w, h) => { c.fillStyle = '#17364a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#bfefff'; c.lineWidth = 7; c.lineCap = 'round'; c.translate(w / 2, h / 2); for (let i = 0; i < 6; i++) { c.rotate(TAU / 6); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -44); c.moveTo(0, -28); c.lineTo(-12, -40); c.moveTo(0, -28); c.lineTo(12, -40); c.stroke(); } });
  cell('s_med', 128, 128, (c, w, h) => { c.fillStyle = '#e9eef3'; c.fillRect(0, 0, w, h); c.fillStyle = '#d0342c'; c.fillRect(w / 2 - 14, 22, 28, h - 44); c.fillRect(22, h / 2 - 14, w - 44, 28); });
  cell('s_arrow', 128, 64, (c, w, h) => { c.fillStyle = '#1b2530'; c.fillRect(0, 0, w, h); c.fillStyle = '#e9eef3'; c.beginPath(); c.moveTo(16, h / 2 - 8); c.lineTo(76, h / 2 - 8); c.lineTo(76, 10); c.lineTo(114, h / 2); c.lineTo(76, h - 10); c.lineTo(76, h / 2 + 8); c.lineTo(16, h / 2 + 8); c.fill(); });
  [['AIRLOCK', '#f0b323', '#17191d'], ['CAUTION', '#f0b323', '#17191d'], ['DANGER', '#c8322a', '#f3f5f7'], ['CRYO', '#17364a', '#bfefff'], ['REACTOR', '#c8322a', '#f3f5f7'], ['MED BAY', '#e9eef3', '#d0342c'], ['LAB', '#1b2530', '#e9eef3'], ['CARGO', '#1b2530', '#f0b323'],
    ['BRIDGE', '#1b2530', '#e9eef3'], ['SECURITY', '#1b2530', '#ff8a7a'], ['QUARANTINE', '#f0b323', '#17191d'], ['DECK 01', '#1b2530', '#e9eef3'], ['DECK 02', '#1b2530', '#e9eef3'], ['DECK 03', '#1b2530', '#e9eef3'], ['EXIT', '#1c5a3a', '#e9fff2'], ['KEEP CLEAR', '#f0b323', '#17191d']]
    .forEach(([t, bg, fg]) => cell('t_' + t.toLowerCase().replace(/ /g, ''), 256, 64, (c, w, h) => plate(c, w, h, t, bg, fg)));
  ['01', '02', '03', '04', '05', '07', '09', '12'].forEach(n => cell('n_' + n, 128, 96, (c, w, h) => plate(c, w, h, n, '#1b2530', '#e9eef3', { frame: false, px: 76 })));
  cell('greeble', 256, 256, (c, w, h) => { const r = rng(90); c.fillStyle = '#2b323b'; c.fillRect(0, 0, w, h); for (let i = 0; i < 70; i++) { const x = floor(r() * 16) * 16, y = floor(r() * 16) * 16, bw = (1 + floor(r() * 4)) * 16, bh = (1 + floor(r() * 3)) * 16, k = 0.6 + r() * 0.8; c.fillStyle = css(shade('#39424d', k)); c.fillRect(x + 1, y + 1, bw - 2, bh - 2); if (r() < 0.3) { c.fillStyle = '#12161b'; for (let q = 3; q < bh - 3; q += 5) c.fillRect(x + 3, y + q, bw - 6, 2); } }
    for (let i = 0; i < 26; i++) { c.fillStyle = r() < 0.7 ? '#ffe2a6' : '#bfeaff'; c.fillRect(floor(r() * 62) * 4 + 2, floor(r() * 62) * 4 + 2, 3, 3); } });
  cell('glyphs', 96, 512, (c, w, h) => { const r = rng(17); c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 5; c.lineCap = 'round'; for (let i = 0; i < 9; i++) { const cy = 30 + i * 56, k = floor(r() * 5); c.beginPath();
      if (k === 0) { c.arc(w / 2, cy, 18, 0.4, 5.4); c.moveTo(w / 2, cy - 8); c.lineTo(w / 2, cy + 8); } else if (k === 1) { c.moveTo(24, cy - 16); c.lineTo(72, cy - 16); c.lineTo(48, cy + 18); c.closePath(); c.moveTo(48, cy - 4); c.lineTo(48, cy + 4); }
      else if (k === 2) { c.moveTo(24, cy - 16); c.lineTo(24, cy + 16); c.moveTo(40, cy - 16); c.lineTo(40, cy + 6); c.moveTo(56, cy - 6); c.lineTo(56, cy + 16); c.moveTo(72, cy - 16); c.lineTo(72, cy + 16); }
      else if (k === 3) { c.arc(w / 2, cy, 17, 0, 7); c.moveTo(w / 2 + 7, cy); c.arc(w / 2, cy, 7, 0, 7); } else { c.moveTo(26, cy + 16); c.lineTo(48, cy - 18); c.lineTo(70, cy + 16); c.moveTo(34, cy + 2); c.lineTo(62, cy + 2); }
      c.stroke(); } });
  cell('holo', 256, 256, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.translate(w / 2, h / 2); for (let i = 1; i <= 5; i++) { c.lineWidth = i === 5 ? 5 : 2; c.globalAlpha = i === 5 ? 1 : 0.6; c.beginPath(); c.arc(0, 0, i * 24, 0, 7); c.stroke(); } c.lineWidth = 2; c.globalAlpha = 0.6; for (let i = 0; i < 12; i++) { c.rotate(TAU / 12); c.beginPath(); c.moveTo(0, 24); c.lineTo(0, 120); c.stroke(); } c.globalAlpha = 1; for (let i = 0; i < 36; i++) { c.rotate(TAU / 36); c.fillStyle = '#fff'; c.fillRect(-1.5, 112, 3, i % 3 ? 6 : 12); } });
  cell('grid', 256, 256, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 3; for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32, h); c.moveTo(0, i * 32); c.lineTo(w, i * 32); c.stroke(); } });

  let _atlas = null;
  function atlas() {
    if (_atlas) return _atlas;
    const SZ = 2048, PAD = 6, map = {}; let x = PAD, y = PAD, rowH = 0;
    const tex = S3.canvasTex(SZ, SZ, c => {
      c.fillStyle = '#1b2026'; c.fillRect(0, 0, SZ, SZ);
      for (const k of cells.slice().sort((a, b) => b.h - a.h)) {
        if (x + k.w + PAD > SZ) { x = PAD; y += rowH + PAD * 2; rowH = 0; }
        c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, k.w, k.h); c.clip(); k.draw(c, k.w, k.h); c.restore();
        map[k.name] = [(x + 0.5) / SZ, 1 - (y + k.h - 0.5) / SZ, (x + k.w - 0.5) / SZ, 1 - (y + 0.5) / SZ]; x += k.w + PAD * 2; rowH = max(rowH, k.h);
      }
    });
    const po = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    const lit = new T.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.05, flatShading: true, ...po }), glo = new T.MeshBasicMaterial({ map: tex, toneMapped: false, ...po });
    lit.userData.merge = glo.userData.merge = true;
    return _atlas = { tex, map, lit, glo };
  }
  /** Flat decal w x h (facing +Z) showing one atlas cell. h omitted = keep the cell's aspect. o: {glow:true (unlit), add: additive material colour, mat} */
  function decal(name, w, h, o = {}) {
    const A = atlas(), c = A.map[name]; if (!c) throw new Error('KitSciFi: unknown decal "' + name + '"');
    if (h == null) { const k = cells.find(q => q.name === name); h = w * k.h / k.w; }
    const geo = new T.PlaneGeometry(w, h), uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(c[0], c[2], uv.getX(i)), lerp(c[1], c[3], uv.getY(i)));
    const m = new T.Mesh(geo, o.mat || (o.add ? beamMat(o.add, o.opacity ?? 0.9, { map: A.tex }) : o.glow ? A.glo : A.lit)); m.castShadow = false; m.receiveShadow = !o.glow && !o.add && !o.mat; return m;
  }
  /** Hazard band of any length built from tiled decals. */
  const band = (len, h, name = 'hazard') => { const g = grp(), n = max(1, round(len / (h * 4))); for (let i = 0; i < n; i++) g.add(decal(name, len / n, h).at((i - (n - 1) / 2) * len / n, 0, 0)); return g; };

  // ---------- live screens ----------
  /** Draw one frame of a built-in screen. kinds: data, bars, wave, radar, vitals, map, warn, code, static, cam, orbit, power, target, off. */
  function drawUI(c, w, h, kind, col, seed, t) {
    const r = rng(seed * 131 + 7), u = h / 100, dim = css(col, 0.35), tick = floor(t * 2), nz = (x, s = 0) => n1(x, seed + s) * 0.5 + 0.5;
    c.globalAlpha = 1; c.fillStyle = '#03070b'; c.fillRect(0, 0, w, h); c.fillStyle = css(col, 0.08); c.fillRect(0, 0, w, h);
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = max(1.5, u * 1.6); c.lineJoin = 'round'; c.lineCap = 'butt'; c.font = MONO(round(u * 10)); c.textBaseline = 'top'; c.textAlign = 'left';
    const head = txt => { c.fillStyle = col; c.fillRect(u * 4, u * 5, w - u * 8, u * 11); c.fillStyle = '#03070b'; c.fillText(txt, u * 7, u * 6); c.fillStyle = col; };
    if (kind === 'off') { c.fillStyle = '#05080b'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,.04)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.5, 0); c.lineTo(w * 0.2, h); c.lineTo(0, h); c.fill(); return; }
    if (kind === 'static') { const q = rng(floor(t * 15) + seed * 7); for (let i = 0; i < 260; i++) { const k = q(); c.fillStyle = `rgba(${200 * k | 0},${220 * k | 0},${230 * k | 0},1)`; c.fillRect(q() * w, q() * h, 4 + q() * 30, 2 + q() * 3); } c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(0, ((t * 0.6) % 1) * h, w, u * 6); return; }
    if (kind === 'data' || kind === 'code') {
      if (kind === 'data') head('SYS ' + (100 + floor(r() * 800)) + ' // ' + ['NOMINAL', 'STANDBY', 'ACTIVE', 'SYNC'][floor(r() * 4)]);
      const rows = kind === 'data' ? 6 : 9, y0 = kind === 'data' ? u * 22 : u * 5, lh = (h - y0 - u * 5) / rows, sc = kind === 'code' ? floor(t * 3) : 0;
      for (let i = 0; i < rows; i++) { const q = rng(seed * 17 + i + sc), ind = floor(q() * 3) * u * 6; let x = u * 6 + (kind === 'code' ? ind : 0); const n = 1 + floor(q() * 4);
        for (let k = 0; k < n; k++) { const l = (0.08 + q() * 0.22) * w; if (x + l > w - u * 6) break; c.fillStyle = q() < 0.2 ? '#ffffff' : q() < 0.5 ? col : dim; c.fillRect(x, y0 + i * lh, l, lh * 0.5); x += l + u * 3; }
        if (kind === 'data' && i > 2) { const v = nz(t * 0.4 + i, i); c.fillStyle = dim; c.fillRect(w * 0.55, y0 + i * lh, w * 0.4, lh * 0.5); c.fillStyle = col; c.fillRect(w * 0.55, y0 + i * lh, w * 0.4 * v, lh * 0.5); } }
      if (tick % 2) { c.fillStyle = '#fff'; c.fillRect(u * 6, h - u * 12, u * 6, u * 7); } return;
    }
    if (kind === 'bars') { head('LOAD'); const n = 9, bw = (w - u * 12) / n; for (let i = 0; i < n; i++) { const v = 0.15 + 0.8 * nz(t * 0.9 + i * 3.1, i); c.fillStyle = v > 0.8 ? '#ff5a4a' : col; for (let k = 0; k < v * 10; k++) c.fillRect(u * 6 + i * bw, h - u * 8 - k * u * 6.6, bw * 0.7, u * 4.6); } return; }
    if (kind === 'wave' || kind === 'vitals') {
      c.strokeStyle = dim; c.lineWidth = 1; for (let x = 0; x < w; x += w / 8) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } for (let y = 0; y < h; y += h / 5) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
      c.strokeStyle = col; c.lineWidth = max(2, u * 2.4); c.beginPath();
      for (let x = 0; x <= w; x += 3) { const p = x / w * 4 - t * (kind === 'vitals' ? 1.1 : 2); let y; if (kind === 'vitals') { const f = mod(p, 1); y = f < 0.08 ? -f * 4 : f < 0.14 ? -0.32 + (f - 0.08) * 22 : f < 0.2 ? 1 - (f - 0.14) * 26 : f < 0.26 ? -0.56 + (f - 0.2) * 9.4 : f > 0.5 && f < 0.64 ? sin((f - 0.5) / 0.14 * PI) * 0.18 : 0; y = -y; } else y = sin(p * 5 + seed) * 0.5 * sin(p * 1.3) + n1(p * 9, seed) * 0.2; c.lineTo(x, h * (kind === 'vitals' ? 0.62 : 0.5) + y * h * 0.32); }
      c.stroke(); if (kind === 'vitals') { c.fillStyle = col; c.font = MONO(round(u * 24)); c.fillText(String(62 + floor(nz(t * 0.3) * 9)), u * 6, u * 5); c.font = MONO(round(u * 10)); c.fillText('BPM', u * 40, u * 17); if (mod(t * 1.1, 1) < 0.25) { c.beginPath(); c.arc(w - u * 12, u * 14, u * 5, 0, 7); c.fill(); } } return;
    }
    if (kind === 'radar' || kind === 'target' || kind === 'orbit' || kind === 'power') {
      const cx = w * (kind === 'power' ? 0.5 : 0.36), cy = h * 0.52, R = min(w * 0.3, h * 0.42);
      if (kind === 'power') { const v = 0.55 + 0.4 * nz(t * 0.25); c.lineWidth = u * 9; c.strokeStyle = dim; c.beginPath(); c.arc(cx, cy, R, PI * 0.75, PI * 2.25); c.stroke(); c.strokeStyle = v > 0.88 ? '#ff5a4a' : col; c.beginPath(); c.arc(cx, cy, R, PI * 0.75, PI * (0.75 + 1.5 * v)); c.stroke(); c.fillStyle = col; c.textAlign = 'center'; c.font = MONO(round(u * 26)); c.fillText(floor(v * 100) + '%', cx, cy - u * 13); c.font = MONO(round(u * 9)); c.fillText('CORE OUTPUT', cx, cy + u * 16); return; }
      c.lineWidth = max(1.5, u * 1.3); c.strokeStyle = dim; for (let i = 1; i <= 3; i++) { c.beginPath(); c.arc(cx, cy, R * i / 3, 0, 7); c.stroke(); } c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
      if (kind === 'radar') { const a = t * 1.6; c.fillStyle = css(col, 0.22); c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, a - 0.7, a); c.fill(); c.strokeStyle = col; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + cos(a) * R, cy + sin(a) * R); c.stroke(); for (let i = 0; i < 4; i++) { const ba = r() * TAU, bd = (0.25 + r() * 0.7) * R, age = mod(a - ba, TAU) / TAU; c.fillStyle = css(i ? col : '#ff5a4a', 1 - age); c.beginPath(); c.arc(cx + cos(ba) * bd, cy + sin(ba) * bd, u * 2.6, 0, 7); c.fill(); } }
      if (kind === 'target') { const x = cx + n1(t * 0.5, seed) * R * 0.5, y = cy + n1(t * 0.5, seed + 3) * R * 0.5, s = u * 9; c.strokeStyle = '#ff5a4a'; c.lineWidth = u * 2; c.strokeRect(x - s, y - s, s * 2, s * 2); c.beginPath(); c.moveTo(x - s * 1.6, y); c.lineTo(x + s * 1.6, y); c.moveTo(x, y - s * 1.6); c.lineTo(x, y + s * 1.6); c.stroke(); }
      if (kind === 'orbit') { c.fillStyle = col; c.beginPath(); c.arc(cx, cy, R * 0.3, 0, 7); c.fill(); c.strokeStyle = col; c.beginPath(); c.ellipse(cx, cy, R, R * 0.45, -0.3, 0, 7); c.stroke(); const a = t * 0.8; c.fillStyle = '#fff'; c.beginPath(); c.arc(cx + cos(a) * R * cos(-0.3) - sin(a) * R * 0.45 * sin(-0.3), cy + cos(a) * R * sin(-0.3) + sin(a) * R * 0.45 * cos(-0.3), u * 3, 0, 7); c.fill(); }
      c.fillStyle = col; for (let i = 0; i < 5; i++) { const q = rng(seed * 3 + i + floor(t * 1.5 + i * 0.37)); c.fillRect(w * 0.72, u * (12 + i * 16), w * (0.08 + q() * 0.16), u * 5); } return;
    }
    if (kind === 'map') { const pts = []; for (let i = 0; i < 16; i++) pts.push([u * 8 + r() * (w - u * 16), u * 8 + r() * (h - u * 16)]); c.strokeStyle = dim; c.lineWidth = 1.5; c.beginPath(); for (let i = 0; i < 15; i += 2) { c.moveTo(pts[i][0], pts[i][1]); c.lineTo(pts[i + 1][0], pts[i + 1][1]); } c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = u * 1.6; c.setLineDash([u * 4, u * 3]); c.lineDashOffset = -t * u * 10; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); c.lineTo(pts[5][0], pts[5][1]); c.lineTo(pts[9][0], pts[9][1]); c.stroke(); c.setLineDash([]);
      pts.forEach((p, i) => { c.fillStyle = i === 9 ? '#ff5a4a' : col; c.beginPath(); c.arc(p[0], p[1], u * (i % 4 ? 1.8 : 3), 0, 7); c.fill(); }); const k = mod(t, 1.5) / 1.5; c.strokeStyle = css('#ff5a4a', 1 - k); c.lineWidth = u * 1.5; c.beginPath(); c.arc(pts[9][0], pts[9][1], u * (3 + k * 12), 0, 7); c.stroke(); return; }
    if (kind === 'warn') { const on = tick % 2 === 0, cx = w / 2, s = h * 0.3; c.fillStyle = on ? css(col, 0.3) : css(col, 0.08); c.fillRect(0, 0, w, h); c.fillStyle = col; c.beginPath(); c.moveTo(cx, h * 0.1); c.lineTo(cx + s, h * 0.1 + s * 1.7); c.lineTo(cx - s, h * 0.1 + s * 1.7); c.closePath(); c.fill(); c.fillStyle = '#03070b'; c.fillRect(cx - u * 2.5, h * 0.27, u * 5, h * 0.2); c.fillRect(cx - u * 2.5, h * 0.51, u * 5, u * 5); c.fillStyle = on ? '#fff' : col; c.textAlign = 'center'; c.font = MONO(round(u * 17)); c.fillText('WARNING', cx, h * 0.72); return; }
    if (kind === 'cam') { for (let y = 0; y < h; y += 4) { c.fillStyle = css(col, 0.05 + 0.05 * nz(y * 0.2 + t * 3)); c.fillRect(0, y, w, 2); } c.fillStyle = css(col, 0.25); c.fillRect(0, h * 0.7, w, h * 0.3); c.fillRect(w * 0.1, h * 0.25, w * 0.22, h * 0.45); c.fillRect(w * 0.6, h * 0.35, w * 0.3, h * 0.35); if (tick % 2) { c.fillStyle = '#ff5a4a'; c.beginPath(); c.arc(u * 9, u * 10, u * 3.5, 0, 7); c.fill(); } c.fillStyle = '#fff'; c.fillText('REC  CAM ' + (1 + seed % 9), u * 16, u * 5); return; }
  }
  /** A screen: a quad w x h metres (facing +Z) with its own small canvas. o: {kind, color, seed, px, round:true (disc)}.
   *  userData: paint(fn(ctx, pxW, pxH)) custom picture, set(kind, color), update(t) redraw the built-in picture at time t. */
  function display(w, h, o = {}) {
    const pw = o.px || 256, ph = max(16, round(pw * h / w)), cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    const c = cv.getContext('2d'), tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    const m = new T.Mesh(o.round ? new T.CircleGeometry(w / 2, 24) : new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false })), u = m.userData;
    Object.assign(u, { screen: true, w, h, px: [pw, ph], kind: o.kind || 'data', color: o.color || PAL.light, seed: o.seed || 1, ctx: c, tex, custom: null });
    u.paint = fn => { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; fn(c, pw, ph); tex.needsUpdate = true; return m; };
    u.update = t => u.paint((c2, W2, H2) => u.custom ? u.custom(c2, W2, H2, t) : drawUI(c2, W2, H2, u.kind, u.color, u.seed, t));
    u.set = (kind, color) => { if (kind) u.kind = kind; if (color) u.color = color; u.update(0); return m; };
    u.update(u.seed * 1.7); return m;
  }
  const KINDS = ['data', 'bars', 'wave', 'radar', 'map', 'code', 'orbit', 'data', 'power', 'target'];

  // ==== builders ====

  // ==== exports ====
  /** Register update() of every animated builder found under the given roots with the stage (uses shot-local time). */
  function animate(s, ...roots) {
    const list = []; roots.flat().forEach(root => root && root.traverse(o => { if (o.userData.update && !o.userData.driven) list.push(o); }));
    if (list.length) s.tick(lt => { for (const o of list) o.userData.update(lt); }); return roots[0];
  }
  return { PAL, animate, display, decal, bake, shade, mix };
})();
