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

  const glowM = (c, k = 1) => { const m = glow(c, k); m.userData.merge = true; return m; };   // animatable lamp material whose meshes still merge
  const setGlow = (m, c, k = 1) => { m.color.set(c).multiplyScalar(k); return m; };

  // =====================================================================================================
  // INTERIORS: corridor, junction, doors
  // =====================================================================================================
  /** Corridor cross-section (counter-clockwise from the floor's left edge): floor, kick, wall, light chamfer, ceiling. */
  const prof = (w = 2.6, h = 2.7) => { const hw = w / 2, fw = hw - 0.2, cw = hw - 0.52; return [[-fw, 0], [fw, 0], [hw, 0.3], [hw, h - 0.72], [cw, h], [-cw, h], [-hw, h - 0.72], [-hw, 0.3]]; };
  /** Group whose local XY plane is the face A->B of a profile extruded along Z: +Z = inward normal, +Y = up the face, X = along the corridor. */
  function frame(A, B) {
    const d = V3(B[0] - A[0], B[1] - A[1], 0), len = d.length(); d.normalize(); const dn = d.y < -1e-6, n = V3(-d.y, d.x, 0), up = dn ? d.clone().negate() : d, x = up.clone().cross(n), g = grp(), O = dn ? B : A;
    g.matrix.makeBasis(x, up, n).setPosition(O[0], O[1], 0); g.matrix.decompose(g.position, g.quaternion, g.scale); g.userData.len = len; return g;
  }
  const grateMat = () => tileMat('grate', 128, 128, (c, w, h) => { c.fillStyle = '#0a0c0f'; c.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) { c.fillStyle = '#4a5460'; c.fillRect(i * 32, 0, 8, h); c.fillStyle = '#6f7b8a'; c.fillRect(i * 32, 0, 2, h); } for (let i = 0; i < 8; i++) { c.fillStyle = '#414a55'; c.fillRect(0, i * 16, w, 5); c.fillStyle = '#626e7c'; c.fillRect(0, i * 16, w, 1.5); } }, { rough: 0.6, metal: 0.3 });
  /** Fill the rectangle (x, y, w, h) of a wall (local XY plane, +Z out of the wall) with raised panels split at random. o: {rnd, colors, levels, depth, gap, detail:false} */
  function panels(g, x, y, w, h, o, lvl = 0) {
    const r = o.rnd;
    if (lvl < (o.levels ?? 2) && max(w, h) > (o.min ?? 0.45) * 2 && r() < (lvl ? 0.6 : 1)) {
      const vert = w > h * 1.15 ? true : h > w * 1.15 ? false : r() < 0.5, k = 0.34 + r() * 0.32;
      if (vert) { panels(g, x, y, w * k, h, o, lvl + 1); panels(g, x + w * k, y, w * (1 - k), h, o, lvl + 1); } else { panels(g, x, y, w, h * k, o, lvl + 1); panels(g, x, y + h * k, w, h * (1 - k), o, lvl + 1); }
      return;
    }
    const gap = o.gap ?? 0.028, d = (o.depth ?? 0.022) * (0.7 + r() * 0.7), col = o.colors[floor(r() * o.colors.length)], q = r();
    box(w - gap, h - gap, d, col, o.mo || PA).at(x + w / 2, y + h / 2, d / 2).to(g);
    if (o.detail === false || min(w, h) < 0.3) return;
    if (q < 0.14) decal('vent', min(w, h) * 0.55).at(x + w / 2, y + h / 2, d + 0.002).to(g);
    else if (q < 0.26) decal('placard', min(0.3, w * 0.5)).at(x + w * 0.32, y + h * 0.68, d + 0.002).to(g);
    else if (q < 0.34) box(w * 0.5, 0.03, 0.035, PAL.dark, ME).at(x + w / 2, y + h * 0.5, d + 0.03).to(g);
    else if (q < 0.4) box(0.05, 0.05, 0.012, glowS(o.led || PAL.ok, 1.2)).at(x + w - 0.1, y + h - 0.1, d + 0.006).to(g);
  }

  /**
   * Modular corridor segment. Tiles end to end along Z (place the next one at z + length).
   * o: {length: 3, width: 2.6, height: 2.7, light: '#8fe9ff' (strip colour), guide (floor guide lights), wall, dark, trim, rib,
   *     left/right/ceiling/floor: false to leave a side out (cutaway shots), pipes: true, ribs: true, seed}
   * userData: lightMat, guideMat, setLight(color, k), setGuide(color, k), length, width, height
   */
  function corridor(o = {}) {
    const L = o.length ?? 3, W = o.width ?? 2.6, H = o.height ?? 2.7, lightC = o.light || PAL.light, wallC = o.wall || PAL.hull, dark = o.dark || PAL.dark, trim = o.trim || PAL.trim, seed = o.seed || 1, r = rng(seed * 101 + 3);
    const g = grp(), P = prof(W, H), nb = max(1, round(L / 1.5)), bay = L / nb, lm = glowM(lightC, 1.5), gm = glowM(o.guide || lightC, 0.7);
    const on = [o.floor !== false, o.right !== false, o.right !== false, o.right !== false, o.ceiling !== false, o.left !== false, o.left !== false, o.left !== false];
    const face = (i, col, fn) => { if (!on[i]) return; const f = frame(P[i], P[(i + 1) % 8]).to(g), h = f.userData.len; quad(L, h, col, PA).at(0, h / 2, 0).shadows(false, true).to(f); fn && fn(f, h, i); };
    const bays = fn => { for (let b = 0; b < nb; b++) fn(-L / 2 + (b + 0.5) * bay, b); };
    face(0, shade(dark, 0.7), (f, h) => {
      const gw = min(1.2, h * 0.55); uvMul(quad(L, gw, grateMat()), L / 0.5, gw / 0.5).at(0, h / 2, 0.004).shadows(false, true).to(f);
      bays(x => [-1, 1].forEach(sd => box(bay - 0.03, (h - gw) / 2 - 0.03, 0.014, PAL.floor, ME).at(x, h / 2 + sd * (gw / 2 + (h - gw) / 4), 0.007).shadows(false, true).to(f)));
    });
    const kick = (f, h) => bays(x => { box(0.6, 0.09, 0.02, shade(wallC, 0.45), PA).at(x, h * 0.55, 0.01).to(f); box(0.52, 0.04, 0.012, gm).at(x, h * 0.55, 0.024).to(f); });
    const wallF = (f, h, i) => {
      const cols = [wallC, shade(wallC, 1.12), shade(wallC, 0.86)], lo = [shade(wallC, 0.4), shade(wallC, 0.5)];
      bays(x => { const x0 = x - bay / 2 + 0.085, w = bay - 0.17; panels(f, x0, 0.02, w, 0.5, { rnd: r, colors: lo, levels: 1, depth: 0.03 }); panels(f, x0, 0.54, w, 0.62, { rnd: r, colors: cols, levels: 2 }); panels(f, x0, 1.27, w, h - 1.29, { rnd: r, colors: cols, levels: 1 }); });
      box(L, 0.075, 0.03, trim, PA).at(0, 1.215, 0.015).to(f);
      if (o.pipes !== false && i === 2) { [0.1, 0.22].forEach((dy, k) => rod([-L / 2, h - dy, 0.12], [L / 2, h - dy, 0.12], k ? 0.03 : 0.045, k ? '#b7773c' : shade(wallC, 0.75), { ...ME, sides: 6 }).to(f)); bays(x => box(0.07, 0.3, 0.17, PAL.dark, ME).at(x + bay * 0.25, h - 0.16, 0.085).to(f)); }
      if (o.pipes !== false && i === 6) { box(L, 0.1, 0.06, shade(wallC, 0.5), ME).at(0, h - 0.12, 0.03).to(f); bays(x => { box(0.3, 0.2, 0.09, PAL.dark, PA).at(x - bay * 0.2, h - 0.12, 0.045).to(f); box(0.04, 0.04, 0.01, glowS(r() < 0.5 ? PAL.ok : PAL.amber, 1.3)).at(x - bay * 0.2 + 0.08, h - 0.1, 0.095).to(f); }); }
    };
    const lightF = (f, h) => bays(x => { box(bay - 0.24, h * 0.5, 0.04, shade(wallC, 0.5), PA).at(x, h * 0.5, 0.02).to(f); box(bay - 0.42, h * 0.2, 0.02, lm).at(x, h * 0.5, 0.05).to(f); });
    face(1, dark, kick); face(7, dark, kick); face(2, shade(wallC, 0.2), wallF); face(6, shade(wallC, 0.2), wallF); face(3, shade(dark, 0.9), lightF); face(5, shade(dark, 0.9), lightF);
    face(4, shade(dark, 0.8), (f, h) => { box(L, h * 0.34, 0.08, shade(wallC, 0.4), PA).at(0, h / 2, 0.04).to(f); bays(x => { box(0.12, h * 0.94, 0.05, shade(wallC, 0.5), PA).at(x, h / 2, 0.025).to(f); decal('vent', 0.3).at(x + bay * 0.27, h / 2, 0.083).to(f); }); });
    if (o.ribs !== false) {
      const outer = inset(P, -0.05), inner = inset(P, 0.085), sl = 0.2 / 0.3, dy = inner[1][1] + 0.012; inner[1] = [inner[1][0] - dy * sl, -0.012]; inner[0] = [inner[0][0] + dy * sl, -0.012];
      for (let b = 0; b <= nb; b++) { const end = b === 0 || b === nb, th = end ? 0.07 : 0.14; extrude(outer, th, o.rib || shade(wallC, 0.6), { holes: [inner], ...PA }).at(0, 0, -L / 2 + b * bay - (b === 0 ? 0 : end ? th : th / 2)).to(g); }
    }
    Object.assign(g.userData, { length: L, width: W, height: H, lightMat: lm, guideMat: gm, setLight: (c, k = 1.5) => (setGlow(lm, c, k), g), setGuide: (c, k = 0.7) => (setGlow(gm, c, k), g) });
    return fin(g, 'corridor', seed);
  }

  /**
   * Bulkhead with a two-leaf sliding door. Fits the corridor cross-section (frame: 'corridor') or a plain wall (frame: 'wall').
   * o: {width: 2.6, height: 2.7, doorWidth: 1.2, doorHeight: 2.1, frame: 'corridor', color, panel, trim, lamp: '#ff4a3a', number: '03', sign: 'airlock' ...}
   * userData: open(k), panels [left, right], lampMat, barMat, setLamp(color, k), doorWidth, doorHeight
   */
  function door(o = {}) {
    const W = o.width ?? 2.6, H = o.height ?? 2.7, dw = o.doorWidth ?? 1.2, dh = o.doorHeight ?? 2.1, th = 0.22, col = o.color || PAL.hullDk, pc = o.panel || PAL.hullLt, trim = o.trim || PAL.trim, c = 0.16, hd = dw / 2, g = grp();
    const arch = k => [[-hd - k, 0], [-hd - k, dh - c + k * 0.414], [-hd + c - k * 0.414, dh + k], [hd - c + k * 0.414, dh + k], [hd + k, dh - c + k * 0.414], [hd + k, 0]];
    const Po = o.frame === 'wall' ? [[-W / 2, 0], [W / 2, 0], [W / 2, H], [-W / 2, H]] : inset(prof(W, H), -0.06), a0 = arch(0); a0[0][1] = a0[5][1] = Po[0][1];
    extrude([Po[0], ...a0, ...Po.slice(1)], th, col, PA).at(0, 0, -th / 2).to(g);
    extrude([...arch(0.09), ...arch(0).reverse()], th + 0.07, shade(col, 0.55), ME).at(0, 0, -th / 2 - 0.035).to(g);
    const lamp = glowM(o.lamp || PAL.warn, 1.6), bar = glowM(o.lamp || PAL.warn, 1.3), ya = 0.82, yb = 1.32, t = 0.07;
    const leaf = sd => {
      const p = grp(), out = sd < 0 ? [[-hd, 0], [0, 0], [0, ya], [t, ya + t], [t, yb - t], [0, yb], [0, dh], [-hd + c, dh], [-hd, dh - c]] : [[0, 0], [hd, 0], [hd, dh - c], [hd - c, dh], [0, dh], [0, yb], [t, yb - t], [t, ya + t], [0, ya]], cx = sd * hd * 0.54;
      extrude(out, 0.08, pc, PA).at(0, 0, -0.04).to(p);
      box(hd * 0.66, 0.46, 0.1, shade(pc, 0.78), PA).at(cx, 0.44, 0).to(p); box(hd * 0.66, 0.06, 0.1, trim, PA).at(cx, 0.76, 0).to(p);
      box(0.13, 0.46, 0.1, '#0c1820', { rough: 0.2, emissive: '#2a6a8c', ei: 0.55 }).at(sd * 0.19, 1.62, 0).to(p);
      box(hd * 0.3, 0.3, 0.1, shade(pc, 0.9), PA).at(sd * hd * 0.72, 1.72, 0).to(p);
      [1, -1].forEach(f => { band(hd * 0.84, 0.09).at(sd * hd * 0.5, 0.11, f * 0.042).rot(0, f > 0 ? 0 : PI, 0).to(p); if (sd * f > 0 && o.number !== false) decal('n_' + (o.number || '03'), 0.24).at(sd * hd * 0.56, 1.12, f * 0.052).rot(0, f > 0 ? 0 : PI, 0).to(p); });
      if (sd < 0) box(0.05, 0.14, 0.1, lamp).at(0.032, (ya + yb) / 2, 0).to(p);
      return live(p);
    };
    const L = leaf(-1).to(g), R = leaf(1).to(g);
    box(dw + 0.34, 0.17, th + 0.1, shade(col, 0.62), PA).at(0, dh + 0.21, 0).to(g); box(0.7, 0.05, th + 0.13, bar).at(0, dh + 0.21, 0).to(g);
    [1, -1].forEach(f => { const s = grp().rot(0, f > 0 ? 0 : PI, 0).to(g), z = th / 2;
      [-1, 1].forEach(sd => box(0.3, 1.5, 0.05, shade(col, 1.18), PA).at(sd * (hd + 0.33), 1.05, z + 0.02).to(s));
      decal('keypad', 0.13, null, { glow: true }).at(hd + 0.33, 1.3, z + 0.047).to(s); decal('vent', 0.2).at(-hd - 0.33, 0.6, z + 0.047).to(s);
      if (o.sign) decal('t_' + o.sign, 0.62).at(0, dh + 0.43, z + 0.003).to(s);
      band(dw, 0.1).rot(-PI / 2, 0, 0).at(0, 0.012, z + 0.14).to(s); });
    box(dw, 0.02, th + 0.2, PAL.dark, ME).at(0, 0, 0).to(g);
    Object.assign(g.userData, { panels: [L, R], lampMat: lamp, barMat: bar, doorWidth: dw, doorHeight: dh, k: 0,
      open: k => { k = clamp(k); g.userData.k = k; L.position.x = -k * (hd - 0.03); R.position.x = k * (hd - 0.03); return g; },
      setLamp: (cc, k = 1.6) => (setGlow(lamp, cc, k), setGlow(bar, cc, k * 0.8), g) });
    return fin(g, 'door', 1);
  }

  /** Extrude a side profile [[z, y], ...] along X, centred on x (consoles, seats, wedges). Returns a group. */
  const extrudeX = (pts, w, col, o) => { const m = extrude(pts, w, col, o); m.rotation.y = -PI / 2; m.position.x = w / 2; return grp(m); };
  /** Flat single-sided polygon in the XZ plane, facing up (shape y -> world -z) or down (shape y -> world +z). Returns a group. */
  const polyFlat = (pts, col, o, down) => { const m = mesh(new T.ShapeGeometry(new T.Shape(pts.map(p => new T.Vector2(p[0], p[1])))), col, o); m.rotation.x = down ? PI / 2 : -PI / 2; return grp(m); };
  const circ = (r, n = 20, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + cos(i / n * TAU) * r, cy + sin(i / n * TAU) * r]);

  /**
   * Hub where up to four corridors meet: an octagonal room with a ring light. Corridors attach at z = +-size/2 and x = +-size/2.
   * o: {size: 4.4, width: 2.6, height: 2.7 (of the corridors), arms: [front +Z, right +X, back -Z, left -X] (false = closed wall), light, wall, dark, trim, seed}
   * userData: lightMat, setLight(color, k), size
   */
  function junction(o = {}) {
    const W = o.width ?? 2.6, H = o.height ?? 2.7, S = o.size ?? 4.4, Hc = H + 0.35, R = S / 2, a = W / 2 + 0.24, lightC = o.light || PAL.light, wallC = o.wall || PAL.hull, dark = o.dark || PAL.dark, trim = o.trim || PAL.trim;
    const arms = o.arms || [1, 1, 1, 1], seed = o.seed || 1, r = rng(seed * 71 + 5), g = grp(), lm = glowM(lightC, 1.5), P = prof(W, H), plan = [[a, R], [R, a], [R, -a], [a, -R], [-a, -R], [-R, -a], [-R, a], [-a, R]];
    polyFlat(plan, shade(dark, 0.7), PA).shadows(false, true).to(g); polyFlat(plan, shade(dark, 0.8), PA, true).at(0, Hc, 0).shadows(false, true).to(g);
    cylB(1.05, 1.05, 0.014, 20, PAL.floor, ME).shadows(false, true).to(g); annulus(1.05, 1.15, 20, trim, PA).at(0, 0.016, 0).shadows(false, true).to(g);
    cyl(0.95, 0.95, 0.07, 16, shade(wallC, 0.45), PA).at(0, Hc - 0.035, 0).to(g); torus(0.72, 0.05, lm, { rs: 5, ts: 20 }).rot(PI / 2, 0, 0).at(0, Hc - 0.09, 0).to(g); cyl(0.3, 0.3, 0.03, 12, lm).at(0, Hc - 0.085, 0).to(g);
    const cols = [wallC, shade(wallC, 1.12), shade(wallC, 0.86)], dw = (R - a) * Math.SQRT2;
    for (let i = 0; i < 4; i++) {
      const sg = grp().rot(0, i * PI / 2, 0).to(g);
      if (arms[i]) {
        extrude([[-a, 0], P[0], P[7], P[6], P[5], P[4], P[3], P[2], P[1], [a, 0], [a, Hc], [-a, Hc]], 0.1, shade(wallC, 0.7), PA).at(0, 0, R - 0.1).shadows(false, true).to(sg);
        uvMul(plane(1.2, R - 1.15, grateMat()), 1.2 / 0.5, (R - 1.15) / 0.5).at(0, 0.004, (R + 1.15) / 2).shadows(false, true).to(sg);
        band(1.2, 0.1).rot(-PI / 2, 0, 0).at(0, 0.006, R - 0.2).to(sg);
      } else {
        const f = grp().rot(0, PI, 0).at(0, 0, R - 0.1).to(sg); quad(a * 2, Hc, shade(wallC, 0.2), PA).at(0, Hc / 2, 0).shadows(false, true).to(f);
        panels(f, -a + 0.03, 0.03, a * 2 - 0.06, 0.55, { rnd: r, colors: [shade(wallC, 0.4), shade(wallC, 0.5)], levels: 1, depth: 0.03 }); panels(f, -a + 0.03, 0.62, a * 2 - 0.06, 1.3, { rnd: r, colors: cols, levels: 3 }); panels(f, -a + 0.03, 2.02, a * 2 - 0.06, Hc - 2.05, { rnd: r, colors: cols, levels: 1 });
        box(a * 2, 0.075, 0.03, trim, PA).at(0, 1.96, 0.015).to(f);
      }
      const d = grp().at((a + R) / 2, 0, (a + R) / 2).rot(0, PI * 1.25, 0).to(sg); quad(dw, Hc, shade(dark, 0.9), PA).at(0, Hc / 2, 0).shadows(false, true).to(d);
      box(dw * 0.62, 1.9, 0.05, shade(wallC, 0.5), PA).at(0, 1.45, 0.025).to(d); box(dw * 0.3, 1.6, 0.02, lm).at(0, 1.45, 0.06).to(d);
      box(dw - 0.05, 0.42, 0.04, shade(wallC, 0.42), PA).at(0, 0.23, 0.02).to(d); box(dw - 0.05, 0.4, 0.04, shade(wallC, 0.7), PA).at(0, Hc - 0.24, 0.02).to(d);
    }
    Object.assign(g.userData, { size: S, lightMat: lm, setLight: (c, k = 1.5) => (setGlow(lm, c, k), g) });
    return fin(g, 'junction', seed);
  }

  /**
   * Round airlock hatch with a real (see-through) window and a locking wheel, set in a bulkhead.
   * o: {width: 2.6, height: 2.7, radius: 0.78, center: 1.18, frame: 'corridor' | 'wall' | 'ring' (collar only), color, hatch, trim, lamp, sign: 'airlock'}
   * userData: open(k) (wheel spins, then the hatch swings toward +Z), hatch, wheel, glass, lampMat, setLamp(color, k), center [x, y, z] of the window
   */
  function airlock(o = {}) {
    const W = o.width ?? 2.6, H = o.height ?? 2.7, R = o.radius ?? 0.78, cy = o.center ?? 1.18, th = 0.24, col = o.color || PAL.hullDk, hc = o.hatch || PAL.hullLt, trim = o.trim || PAL.trim, g = grp(), rw = R * 0.27;
    const Po = o.frame === 'wall' ? [[-W / 2, 0], [W / 2, 0], [W / 2, H], [-W / 2, H]] : inset(prof(W, H), -0.06);
    if (o.frame !== 'ring') extrude(Po, th, col, { holes: [circ(R, 20, 0, cy)], ...PA }).at(0, 0, -th / 2).to(g);
    extrude(circ(R + 0.15, 20, 0, cy), th + 0.1, shade(col, 0.55), { holes: [circ(R, 20, 0, cy)], ...ME }).at(0, 0, -th / 2 - 0.05).to(g);
    ring(10, a => box(0.07, 0.07, th + 0.14, shade(col, 0.9), ME).at(cos(a) * (R + 0.075), cy + sin(a) * (R + 0.075), 0).rot(0, 0, a).to(g), 0.31);
    const lamp = glowM(o.lamp || PAL.warn, 1.6), zf = th / 2 + 0.05, hinge = grp().at(-(R + 0.2), cy, zf + 0.05).to(g), hatch = grp().at(R + 0.2, 0, 0).to(hinge), wheel = grp().at(0, 0, 0.12).to(hatch);
    extrude(circ(R + 0.06, 20), 0.12, hc, { holes: [circ(rw, 14)], ...PA }).at(0, 0, -0.07).to(hatch);
    extrude(circ(R - 0.1, 20), 0.03, shade(hc, 0.82), { holes: [circ(rw + 0.1, 14)], ...PA }).at(0, 0, 0.05).to(hatch);
    [-1, 1].forEach(f => extrude(circ(rw + 0.055, 14), 0.03, shade(col, 0.5), { holes: [circ(rw - 0.01, 14)], ...ME }).at(0, 0, f > 0 ? 0.05 : -0.1).to(hatch));
    const glass = cyl(rw, rw, 0.02, 14, o.glass || PAL.glass, GL(o.glass || PAL.glass, 0.22, 0.2)).rot(PI / 2, 0, 0).at(0, 0, -0.01); glass.userData.keep = true; hatch.add(glass);
    ring(6, a => box(0.2, 0.07, 0.04, shade(col, 0.6), ME).at(cos(a) * (R - 0.08), sin(a) * (R - 0.08), 0.07).rot(0, 0, a).to(hatch), 0.52);
    [-0.34, 0.34].forEach(y => { box(R * 0.75, 0.08, 0.05, shade(col, 0.55), ME).at(-(R + 0.2) / 2 - R * 0.1, y, 0.02).to(hatch); cyl(0.045, 0.045, 0.16, 6, shade(col, 0.45), ME).at(0, y, 0).to(hinge); box(0.12, 0.12, 0.06, shade(col, 0.55), ME).at(0.0, y, -0.04).to(hinge); });
    torus(R * 0.55, 0.028, shade(col, 0.4), { rs: 5, ts: 16, ...ME }).to(wheel); ring(4, a => rod([cos(a) * (rw + 0.06), sin(a) * (rw + 0.06), 0], [cos(a) * R * 0.55, sin(a) * R * 0.55, 0], 0.02, shade(col, 0.4), ME).to(wheel), 0.78);
    ring(4, a => rod([cos(a) * (rw + 0.07), sin(a) * (rw + 0.07), -0.07], [cos(a) * (rw + 0.07), sin(a) * (rw + 0.07), 0], 0.018, shade(col, 0.4), ME).to(wheel), 0.78);
    live(wheel); live(hatch); hinge.userData.live = true;
    if (o.frame !== 'ring') {
      box(0.5, 0.12, 0.06, shade(col, 0.6), PA).at(0, cy + R + 0.38, th / 2 + 0.03).to(g); box(0.36, 0.045, 0.02, lamp).at(0, cy + R + 0.38, th / 2 + 0.065).to(g);
      if (o.sign !== false) decal('t_' + (o.sign || 'airlock'), 0.6).at(0, cy + R + 0.58, th / 2 + 0.003).to(g);
      decal('keypad', 0.13, null, { glow: true }).at(R + 0.33, 1.3, th / 2 + 0.003).to(g); band(R * 1.6, 0.1).at(0, 0.12, th / 2 + 0.003).to(g);
    }
    Object.assign(g.userData, { hatch: hinge, wheel, glass, lampMat: lamp, center: [0, cy, 0], k: 0, setLamp: (c, k = 1.6) => (setGlow(lamp, c, k), g),
      open: k => { k = clamp(k); g.userData.k = k; wheel.rotation.z = -S3.ramp(k, 0, 0.4) * TAU * 1.25; hinge.rotation.y = -S3.ramp(k, 0.3, 1) * 1.95; return g; } });
    return fin(g, 'airlock', 1);
  }

  // =====================================================================================================
  // PROPS: crates, canisters, pipes, vents, cables
  // =====================================================================================================
  /**
   * Sci-fi cargo crate with an edge frame, latches and a status light.
   * o: {w: 1, h: 0.8, d: 0.8, color, trim (frame), accent (latches, stripe), light (status LED, false = none), symbol: 'rad'|'bio'|'volt'|'warn'|'cold'|'med', seed}
   */
  function crate(o = {}) {
    const w = o.w ?? 1, h = o.h ?? 0.8, d = o.d ?? 0.8, col = o.color || '#6c7b8d', trim = o.trim || shade(col, 0.38), acc = o.accent || PAL.trim, seed = o.seed || 1, r = rng(seed * 53 + 11), g = grp(), e = clamp(min(w, h, d) * 0.1, 0.035, 0.09);
    boxB(w - e, h - e, d - e, col, PA).at(0, e / 2, 0).to(g);
    [-1, 1].forEach(sx => [-1, 1].forEach(sz => boxB(e, h, e, trim, PA).at(sx * (w - e) / 2, 0, sz * (d - e) / 2).to(g)));
    [e / 2, h - e / 2].forEach(y => { [-1, 1].forEach(s => { box(w - e, e, e, trim, PA).at(0, y, s * (d - e) / 2).to(g); box(e, e, d - e, trim, PA).at(s * (w - e) / 2, y, 0).to(g); }); });
    box(w - e * 0.6, 0.02, d - e * 0.6, shade(col, 0.5), PA).at(0, h * 0.74, 0).to(g);                               // lid seam
    [-1, 1].forEach(s => { box(w * 0.12, h * 0.16, 0.03, acc, ME).at(s * w * 0.26, h * 0.74, d / 2 - e / 2 + 0.012).to(g); box(0.03, h * 0.07, d * 0.3, shade(col, 0.35), ME).at(s * (w / 2 - e / 2 + 0.03), h * 0.52, 0).to(g); });
    box(w - e * 2.2, h * 0.07, 0.012, acc, PA).at(0, h * 0.2, d / 2 - e / 2 + 0.005).to(g);                           // stripe
    if (min(w, h) > 0.45) { decal('barcode', min(0.26, w * 0.26)).at(-w * 0.2, h * 0.47, d / 2 - e / 2 + 0.003).to(g); if (o.symbol) decal('s_' + o.symbol, min(0.24, h * 0.3)).at(w * 0.22, h * 0.47, d / 2 - e / 2 + 0.003).to(g); }
    if (o.light !== false) box(w * 0.14, 0.03, 0.012, glowS(o.light || [PAL.ok, PAL.light, PAL.amber][floor(r() * 3)], 1.3)).at(0, h * 0.86, d / 2 - e / 2 + 0.006).to(g);
    box(w * 0.5, 0.02, d * 0.5, shade(col, 0.82), PA).at(0, h - e / 2 + 0.008, 0).to(g);
    return fin(g, 'crate', seed, 0.03);
  }
  /**
   * Pressure canister. o: {radius: 0.26, height: 1.05, color, accent (band), glow: colour of the level window (false = none), symbol, seed}
   * userData: levelMat (the glowing level window)
   */
  function canister(o = {}) {
    const R = o.radius ?? 0.26, h = o.height ?? 1.05, col = o.color || '#c9ced4', acc = o.accent || PAL.trim, g = grp(), dk = '#2a3038', bh = h * 0.72, lv = o.glow === false ? null : glowM(o.glow || PAL.bio, 1.3);
    cylB(R * 1.06, R * 1.1, 0.07, 10, dk, ME).to(g); cylB(R, R, bh, 10, col, PA).at(0, 0.07, 0).to(g); cylB(R * 1.035, R * 1.035, h * 0.09, 10, acc, PA).at(0, 0.07 + bh * 0.16, 0).to(g);
    cylB(R * 1.03, R * 1.03, 0.03, 10, dk, ME).at(0, 0.07 + bh * 0.66, 0).to(g); cylB(R * 0.5, R, h * 0.1, 10, shade(col, 0.9), PA).at(0, 0.07 + bh, 0).to(g);
    cylB(R * 0.28, R * 0.32, h * 0.07, 8, dk, ME).at(0, 0.07 + bh + h * 0.1, 0).to(g);
    const top = 0.07 + bh + h * 0.17; torus(R * 0.72, 0.02, dk, { rs: 4, ts: 10, ...ME }).rot(PI / 2, 0, 0).at(0, top - 0.02, 0).to(g); ring(3, a => rod([cos(a) * R * 0.72, 0.07 + bh + h * 0.03, sin(a) * R * 0.72], [cos(a) * R * 0.72, top - 0.02, sin(a) * R * 0.72], 0.016, dk, ME).to(g), 0.5);
    if (lv) { box(R * 0.42, bh * 0.36, 0.03, dk, ME).at(0, 0.07 + bh * 0.44, R - 0.012).to(g); box(R * 0.2, bh * 0.3, 0.03, lv).at(0, 0.07 + bh * 0.44, R - 0.004).to(g); }
    if (o.symbol !== false) decal('s_' + (o.symbol || 'warn'), R * 0.62).at(0, 0.07 + bh * 0.82, R + 0.004).rot(0, 0, 0).to(g).position.applyAxisAngle(_up, 0.9);
    g.children[g.children.length - 1].rotation.y = o.symbol !== false ? 0.9 : 0;
    g.userData.levelMat = lv; return fin(g, 'canister', o.seed || 1, 0.02);
  }
  /** A dressed pile of crates and canisters. o: {count: 6, spread: 2.2, colors: [...], seed}. Footprint about spread x spread. */
  function crateStack(o = {}) {
    const n = o.count ?? 6, sp = o.spread ?? 2.2, seed = o.seed || 1, r = rng(seed * 29 + 3), g = grp(), cols = o.colors || ['#6c7b8d', '#8c6a3a', '#4d6a5c', '#7a8794', '#a2443a'], spots = [];
    for (let i = 0; i < n; i++) {
      const big = r() < 0.45, w = big ? 1.1 + r() * 0.3 : 0.6 + r() * 0.25, h = big ? 0.7 + r() * 0.25 : 0.45 + r() * 0.2, d = big ? 0.8 + r() * 0.2 : 0.55 + r() * 0.2; let x, z, y = 0, tries = 0;
      const under = spots.find(s => !s.used && s.w > w + 0.05 && s.d > d + 0.05 && r() < 0.6);
      if (under) { x = under.x + (r() - 0.5) * 0.1; z = under.z + (r() - 0.5) * 0.1; y = under.h; under.used = true; }
      else do { x = (r() - 0.5) * (sp - w); z = (r() - 0.5) * (sp - d); tries++; } while (tries < 30 && spots.some(s => s.y === 0 && abs(s.x - x) < (s.w + w) / 2 + 0.06 && abs(s.z - z) < (s.d + d) / 2 + 0.06));
      if (tries >= 30) continue;
      if (!under) spots.push({ x, z, w, d, h, y: 0 });
      crate({ w, h, d, color: cols[floor(r() * cols.length)], seed: seed * 10 + i, symbol: r() < 0.3 ? ['rad', 'bio', 'volt', 'warn'][floor(r() * 4)] : null }).at(x, y, z).rot(0, (r() - 0.5) * (under ? 0.5 : 0.24), 0).to(g);
    }
    for (let i = 0; i < 2; i++) { let x, z, tries = 0; do { x = (r() - 0.5) * (sp - 0.5); z = (r() - 0.5) * (sp - 0.5); tries++; } while (tries < 40 && spots.some(s => abs(s.x - x) < s.w / 2 + 0.34 && abs(s.z - z) < s.d / 2 + 0.34)); if (tries < 40) { canister({ color: i ? '#c9ced4' : '#d8b13a', glow: i ? PAL.bio : PAL.light, seed: i + 1 }).at(x, 0, z).rot(0, r() * 6, 0).to(g); spots.push({ x, z, w: 0.6, d: 0.6, h: 1, y: 0, used: true }); } }
    return fin(g, 'crateStack', seed, 0);
  }

  /** Valve hand-wheel facing +Z (a live group: spin rotation.z). */
  const valveWheel = (r = 0.11, col = '#c8322a') => { const w = grp(torus(r, r * 0.15, col, { rs: 5, ts: 10, ...PA })); ring(3, a => rod([0, 0, 0], [cos(a) * r, sin(a) * r, 0], r * 0.1, col, PA).to(w)); cyl(r * 0.24, r * 0.24, r * 0.3, 6, '#2a3038', ME).rot(PI / 2, 0, 0).to(w); return live(w); };
  /**
   * Run of wall pipes with clamps, flanges and a drop to the floor with a valve wheel and gauge. Back on z = 0.
   * o: {length: 3, count: 3, y: 1.9 (height of the lowest pipe), colors: [...], drop: true, seed}
   * userData: wheels [valve wheel groups: spin rotation.z]
   */
  function pipes(o = {}) {
    const L = o.length ?? 3, n = o.count ?? 3, y0 = o.y ?? 1.9, seed = o.seed || 1, r = rng(seed * 61 + 7), g = grp(), cols = o.colors || [shade(PAL.hull, 0.8), '#b7773c', '#c9ced4', PAL.yellow], dk = '#2a3038', wheels = [];
    const rr = i => [0.065, 0.04, 0.05, 0.035][i % 4], yy = i => y0 + i * 0.17, zz = i => rr(i) + 0.07;
    for (let i = 0; i < n; i++) { rod([-L / 2, yy(i), zz(i)], [L / 2, yy(i), zz(i)], rr(i), cols[i % cols.length], { ...ME, sides: 7 }).to(g);
      for (let x = -L / 2 + 0.5 + r() * 0.5; x < L / 2 - 0.2; x += 1.0 + r() * 0.6) cyl(rr(i) * 1.45, rr(i) * 1.45, 0.05, 7, shade(cols[i % cols.length], 0.75), ME).rot(0, 0, PI / 2).at(x, yy(i), zz(i)).to(g); }
    for (let x = -L / 2 + 0.3; x <= L / 2 - 0.29; x += max(1.2, (L - 0.6) / max(1, round((L - 0.6) / 1.4)))) box(0.07, n * 0.17 + 0.06, 0.2, dk, ME).at(x, y0 + (n - 1) * 0.085, 0.1).to(g);
    if (o.drop !== false) { const xd = (r() - 0.5) * L * 0.4, z = zz(0); rod([xd, y0, z], [xd, 0.04, z], rr(0), cols[0], { ...ME, sides: 7 }).to(g); cyl(rr(0) * 1.5, rr(0) * 1.5, 0.12, 7, shade(cols[0], 0.75), ME).rot(0, 0, PI / 2).at(xd, y0, z).to(g); cylB(rr(0) * 1.7, rr(0) * 1.7, 0.04, 7, dk, ME).at(xd, 0, z).to(g);
      cyl(rr(0) * 1.4, rr(0) * 1.4, 0.16, 7, dk, ME).at(xd, 1.1, z).to(g); rod([xd, 1.1, z], [xd, 1.1, z + 0.16], 0.02, dk, ME).to(g); const w = valveWheel().at(xd, 1.1, z + 0.17).to(g); wheels.push(w);
      rod([xd, 1.5, z], [xd + 0.14, 1.5, z], 0.015, dk, ME).to(g); cyl(0.075, 0.075, 0.04, 10, PAL.brass, ME).rot(PI / 2, 0, 0).at(xd + 0.2, 1.5, z).to(g); decal('gauge1', 0.14).at(xd + 0.2, 1.5, z + 0.022).to(g); }
    g.userData.wheels = wheels; return fin(g, 'pipes', seed, 0.03);
  }
  /**
   * Wall vent: a louvred grille, or (fan: true) a round extractor fan lit from behind. Back on z = 0.
   * o: {w: 0.9, h: 0.6, y: 0.3 (height of the bottom edge), fan: false, glow (backlight colour behind the fan, false = none), color, speed: 2 (turns per second)}
   * userData: blades (fan group), update(t)
   */
  function vent(o = {}) {
    const fan = !!o.fan, w = o.w ?? (fan ? 1.1 : 0.9), h = fan ? w : (o.h ?? 0.6), y = o.y ?? 0.3, col = o.color || PAL.hullDk, g = grp(), cy = y + h / 2;
    if (!fan) { extrude([[-w / 2, y], [w / 2, y], [w / 2, y + h], [-w / 2, y + h]], 0.09, col, { holes: [[[-w / 2 + 0.06, y + 0.06], [w / 2 - 0.06, y + 0.06], [w / 2 - 0.06, y + h - 0.06], [-w / 2 + 0.06, y + h - 0.06]]], ...PA }).to(g);
      box(w - 0.1, h - 0.1, 0.02, '#07090b', RU).at(0, cy, 0.01).to(g); const n = max(2, floor((h - 0.12) / 0.075)); for (let i = 0; i < n; i++) box(w - 0.12, 0.012, 0.075, shade(col, 1.25), ME).rot(0.7, 0, 0).at(0, y + 0.06 + (i + 0.5) * (h - 0.12) / n, 0.055).to(g);
      [-1, 1].forEach(sx => [-1, 1].forEach(sy => cyl(0.014, 0.014, 0.02, 6, shade(col, 0.5), ME).rot(PI / 2, 0, 0).at(sx * (w / 2 - 0.03), cy + sy * (h / 2 - 0.03), 0.095).to(g)));
      return fin(g, 'vent', 1, 0.02); }
    const R = w / 2, blades = grp().at(0, cy, 0.08).to(g), bl = o.glow === false ? null : glowM(o.glow || '#ffd9a0', 0.9);
    extrude([[-R, y], [R, y], [R, y + h], [-R, y + h]], 0.2, col, { holes: [circ(R - 0.08, 16, 0, cy)], ...PA }).to(g); box(w - 0.02, h - 0.02, 0.02, '#07090b', RU).at(0, cy, 0.01).to(g);
    if (bl) cyl(R - 0.12, R - 0.12, 0.01, 16, bl).rot(PI / 2, 0, 0).at(0, cy, 0.025).to(g);
    ring(5, a => box(R * 0.82, R * 0.3, 0.012, '#15191e', ME).at(cos(a) * R * 0.44, sin(a) * R * 0.44, 0).rot(0.5, 0, a).to(blades)); cyl(R * 0.16, R * 0.16, 0.08, 8, '#2a3038', ME).rot(PI / 2, 0, 0).to(blades); live(blades);
    [0.5, 0.86].forEach(k => torus((R - 0.08) * k, 0.008, shade(col, 0.5), { rs: 4, ts: 16, ...ME }).at(0, cy, 0.19).to(g)); ring(4, a => rod([0, cy, 0.19], [cos(a) * (R - 0.08), cy + sin(a) * (R - 0.08), 0.19], 0.008, shade(col, 0.5), ME).to(g), 0.4);
    anim(g, t => { blades.rotation.z = -t * TAU * (o.speed ?? 2); }); Object.assign(g.userData, { blades, glowMat: bl }); g.userData.update(0);
    return fin(g, 'vent', 1, 0.02);
  }
  /**
   * Cables draped along a wall between brackets. Back on z = 0. o: {length: 3, count: 4, y: 2.3, sag: 0.22, colors, loose: false (one cable hangs free and sparks), seed}
   * userData: sparkMat, sparkPos [x, y, z], update(t) (spark flicker, only with loose)
   */
  function cables(o = {}) {
    const L = o.length ?? 3, n = o.count ?? 4, y = o.y ?? 2.3, sag = o.sag ?? 0.22, seed = o.seed || 1, r = rng(seed * 43 + 9), g = grp(), cols = o.colors || ['#15181c', '#2b323b', PAL.trim, '#15181c', '#7a1f1a', '#1d4a66'];
    const nb = max(2, round(L / 1.5) + 1), xs = Array.from({ length: nb }, (_, i) => -L / 2 + 0.12 + i * (L - 0.24) / (nb - 1));
    xs.forEach(x => { box(0.05, 0.14, 0.05 + n * 0.035, '#2a3038', ME).at(x, y, 0.025 + n * 0.0175).to(g); box(0.07, 0.03, 0.08 + n * 0.035, '#2a3038', ME).at(x, y - 0.07, 0.04 + n * 0.0175).to(g); });
    let spark = null, sp = null;
    for (let i = 0; i < n; i++) { const z = 0.045 + i * 0.035, rad = 0.012 + r() * 0.01, c = cols[i % cols.length];
      for (let k = 0; k < nb - 1; k++) { const a = xs[k], b = xs[k + 1], s = sag * (0.45 + r() * 0.9);
        if (o.loose && i === n - 1 && k === floor((nb - 1) / 2)) { sp = [a + (b - a) * 0.4, y - 0.95, z + 0.12]; vine([[a, y - 0.04, z], [a + (b - a) * 0.2, y - 0.25, z + 0.04], [a + (b - a) * 0.36, y - 0.7, z + 0.1], sp], rad, rad, c, { rs: 4, seg: 10, ...RU }).to(g); spark = glow('#bfe9ff', 2); ball(0.03, spark, 0).at(sp).to(g); const f = flare('#9fdcff', 0.5, 0.9).at(sp); g.add(f); g.userData.flare = f; }
        else vine([[a, y - 0.04, z], [(a + b) / 2, y - 0.04 - s, z + (r() - 0.5) * 0.03], [b, y - 0.04, z]], rad, rad, c, { rs: 4, seg: 8, ...RU }).to(g); } }
    if (spark) { anim(g, t => { const k = n1(t * 13, seed) > 0.25 ? 1 : n1(t * 31, seed + 4) > 0.5 ? 0.6 : 0.05; spark.color.set('#bfe9ff').multiplyScalar(2 * k); g.userData.flare.material.opacity = 0.9 * k; g.userData.level = k; }); g.userData.update(0); }
    Object.assign(g.userData, { sparkMat: spark, sparkPos: sp }); return fin(g, 'cables', seed, 0.02);
  }

  // ==== builders ====

  // ==== exports ====
  /** Register update() of every animated builder found under the given roots with the stage (uses shot-local time). */
  function animate(s, ...roots) {
    const list = []; roots.flat().forEach(root => root && root.traverse(o => { if (o.userData.update && !o.userData.driven) list.push(o); }));
    if (list.length) s.tick(lt => { for (const o of list) o.userData.update(lt); }); return roots[0];
  }
  return { PAL, animate, display, decal, bake, shade, mix,
    corridor, door };
})();
