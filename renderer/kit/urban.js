// urban.js - KitUrban: towns, cities and vehicles for the 3D stage. Reference: docs/kit/urban.md
// Every builder is name(o = {}) and returns a THREE.Group at real scale (metres), standing on y = 0, centred on its
// footprint, front toward +Z. Deterministic: variation comes from o.seed only. Moving parts live on group.userData.
const KitUrban = (() => {
  const T = S3.T, { box, boxB, cyl, cylB, cone, coneB, ball, blob, plane, quad, torus, extrude, lathe, tube, grp, mat, mesh, canvasTex, texMat, flare } = S3;
  const PI = Math.PI, TAU = PI * 2;

  // =====================================================================================================
  // helpers
  // =====================================================================================================
  const _ca = new T.Color(), _cb = new T.Color();
  /** Blend two CSS colours. */
  const mix = (a, b, k) => '#' + _ca.set(a).lerp(_cb.set(b), clamp(k)).getHexString();
  /** Lighten (k > 0) or darken (k < 0) a colour. */
  const shade = (a, k) => mix(a, k < 0 ? '#000000' : '#ffffff', Math.abs(k));
  const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
  const _tex = new Map(), _tmat = new Map();
  /** Cached canvas texture: shots are rebuilt often, so identical textures must be shared, never redrawn. */
  const tex = (key, w, h, draw, o) => { let t = _tex.get(key); if (!t) { t = canvasTex(w, h, draw, o); _tex.set(key, t); } return t; };
  const tmat = (key, make) => { let m = _tmat.get(key); if (!m) { m = make(); _tmat.set(key, m); } return m; };
  /** Standard material with a colour map and a separate emissive map (lit windows glow, the wall does not). */
  function litMat(map, emap, o = {}) {
    const m = new T.MeshStandardMaterial({ map, roughness: o.rough ?? 0.9, metalness: o.metal ?? 0, flatShading: true });
    if (emap) { m.emissiveMap = emap; m.emissive = new T.Color('#ffffff'); m.emissiveIntensity = o.ei ?? 1.25; }
    if (o.transparent) { m.transparent = true; m.depthWrite = false; }
    if (o.side === 'double') m.side = T.DoubleSide;
    return m;
  }
  /** A lens that looks like glass when off and glows when its emissiveIntensity is raised (private material). */
  const lamp = (col, em, ei = 0) => mat(col, { emissive: em, ei, rough: 0.35, own: true });
  /** Shrink a font until `text` fits `maxW` pixels; leaves c.font set. */
  const fit = (c, text, maxW, px, fam, weight = '') => { let s = px; for (; s > 8; s -= 2) { c.font = `${weight} ${s}px "${fam}"`; if (c.measureText(text).width <= maxW) break; } return s; };

  /** Mesh from quads [[a, b, c, d, uvRect?], ...]: corners counter-clockwise seen from outside, points [x, y, z]. */
  function quads(list, col, o) {
    const pos = [], uv = [];
    for (const q of list) {
      const [a, b, c, d] = q, u = q[4] || [0, 0, 1, 1];
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      uv.push(u[0], u[1], u[2], u[1], u[2], u[3], u[0], u[1], u[2], u[3], u[0], u[3]);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    return mesh(g, col, o);
  }
  /** Mesh from triangles [[a, b, c], ...]. */
  function tris(list, col, o) {
    const pos = [], uv = [];
    for (const [a, b, c] of list) { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); uv.push(0, 0, 1, 0, 0.5, 1); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    return mesh(g, col, o);
  }
  const HEXA = { bottom: [0, 1, 2, 3], top: [4, 7, 6, 5], rear: [1, 0, 4, 5], front: [3, 2, 6, 7], left: [0, 3, 7, 4], right: [2, 1, 5, 6] };
  /** Six-sided solid from 8 corners: bottom ring (rear-left, rear-right, front-right, front-left) then the top ring. o.skip: 'top,bottom'. */
  const hexa = (P, col, o = {}) => quads(Object.keys(HEXA).filter(k => !(o.skip || '').includes(k)).map(k => HEXA[k].map(i => P[i])), col, o);
  /** Box whose bottom rectangle (half-width bw, z from bz0 to bz1, at y0) differs from its top rectangle. Symmetric in X. */
  const taper = (y0, bw, bz0, bz1, y1, tw, tz0, tz1, col, o) => hexa([[-bw, y0, bz0], [bw, y0, bz0], [bw, y0, bz1], [-bw, y0, bz1], [-tw, y1, tz0], [tw, y1, tz0], [tw, y1, tz1], [-tw, y1, tz1]], col, o);
  /** Straight bar of cross-section w x d between two points. */
  function beam(a, b, w, d, col, o) {
    const A = new T.Vector3(a[0], a[1], a[2]), B = new T.Vector3(b[0], b[1], b[2]), m = box(w, A.distanceTo(B), d, col, o);
    m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), B.sub(A).normalize()); return m;
  }
  /** Extrude a side view [[z, y], ...] across the width (X), centred: car bodies, gables, ramps. */
  function sideProfile(pts, width, col, o) { const m = extrude(pts, width, col, o); m.geometry.translate(0, 0, -width / 2); m.geometry.rotateY(-PI / 2); return m; }
  /** Extrude a plan view [[x, z], ...] upward by `height`. */
  function planProfile(pts, height, col, o) { const m = extrude(pts.map(p => [p[0], -p[1]]), height, col, o); m.geometry.rotateX(-PI / 2); return m; }

  /**
   * Merge every static mesh under `root` that shares a material into one mesh (far fewer draw calls).
   * Sub-trees flagged userData.dyn (wheels, doors, anything a film will move) are left alone.
   */
  function bake(root) {
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert(), buckets = new Map(), rel = new T.Matrix4(), nm = new T.Matrix3(), v = new T.Vector3();
    const walk = o => {
      if (o !== root && o.userData.dyn) return;
      if (o.isMesh && !o.children.length && !o.userData.keep && !Array.isArray(o.material)) {
        const key = o.material.uuid + (o.castShadow ? 'c' : '-') + (o.receiveShadow ? 'r' : '-') + o.renderOrder;
        let b = buckets.get(key); if (!b) buckets.set(key, b = []); b.push(o);
      }
      for (const k of o.children) walk(k);
    };
    walk(root);
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const ref = list[0], parts = list.map(o => o.geometry.index ? o.geometry.toNonIndexed() : o.geometry); let n = 0; for (const g of parts) n += g.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = ref.material.vertexColors ? new Float32Array(n * 3).fill(1) : null; let off = 0;
      list.forEach((o, i) => {
        const g = parts[i], p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv, cc = g.attributes.color, cnt = p.count;
        rel.multiplyMatrices(inv, o.matrixWorld); nm.getNormalMatrix(rel); const flip = rel.determinant() < 0;
        for (let j = 0; j < cnt; j++) {
          const k3 = j % 3, s = flip ? j - k3 + (k3 === 1 ? 2 : k3 === 2 ? 1 : 0) : j, d = off + j;
          v.fromBufferAttribute(p, s).applyMatrix4(rel); pos[d * 3] = v.x; pos[d * 3 + 1] = v.y; pos[d * 3 + 2] = v.z;
          if (nn) { v.fromBufferAttribute(nn, s).applyMatrix3(nm).normalize(); nor[d * 3] = v.x; nor[d * 3 + 1] = v.y; nor[d * 3 + 2] = v.z; }
          if (u) { uv[d * 2] = u.getX(s); uv[d * 2 + 1] = u.getY(s); }
          if (col && cc) { col[d * 3] = cc.getX(s); col[d * 3 + 1] = cc.getY(s); col[d * 3 + 2] = cc.getZ(s); }
        }
        off += cnt; o.parent.remove(o);
      });
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2)); if (col) g.setAttribute('color', new T.BufferAttribute(col, 3));
      const m = new T.Mesh(g, ref.material); m.castShadow = ref.castShadow; m.receiveShadow = ref.receiveShadow; m.renderOrder = ref.renderOrder; root.add(m);
    }
    return root;
  }
  /** Flag a sub-tree as moving (bake leaves it alone) after merging its own meshes. */
  const dyn = g => { bake(g); g.userData.dyn = true; return g; };
  /** Flat picture on an upright quad, from a cached canvas texture. o: {opaque, basic (unlit), emissive, ei, rough, side}. */
  function decal(w, h, key, pw, ph, draw, o = {}) {
    const m = quad(w, h, tmat('d|' + key + (o.basic ? 'b' : '') + (o.emissive ? 'e' : ''), () => texMat(tex('d|' + key, pw, ph, draw), { transparent: !o.opaque, basic: o.basic, emissive: o.emissive, ei: o.ei, rough: o.rough, side: o.side })));
    m.castShadow = false; return m;
  }

  // @@SECTION vehicles
  // =====================================================================================================
  // vehicles (front toward +Z; the vehicle's left side, where the driver sits by default, is +X)
  // =====================================================================================================
  const CAR_COLS = ['#a8342c', '#2f5d8c', '#e4e1d8', '#8b969c', '#24272c', '#3d6a56', '#d8b03a', '#7a2e3b', '#c2632e', '#4b5661', '#c9c2ae', '#1f4e5a'];
  const plateText = seed => { const r = rng(seed * 7 + 3), L = 'BCDFGHJKLMNPRSTVWXZ', l = () => L[Math.floor(r() * L.length)], d = () => Math.floor(r() * 10); return l() + l() + d() + d() + ' ' + l() + l() + l(); };
  const plateMat = seed => tmat('plate' + seed % 40, () => texMat(tex('plate' + seed % 40, 128, 34, c => {
    c.fillStyle = '#e9e6da'; c.fillRect(0, 0, 128, 34); c.strokeStyle = '#23272c'; c.lineWidth = 2; c.strokeRect(2, 2, 124, 30);
    c.fillStyle = '#1a1d22'; c.font = 'bold 21px "DejaVu Sans Mono"'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(plateText(seed % 40), 64, 18);
  }), { rough: 0.6 }));
  /** Vehicle glass: 4 tiles side by side (clean, cracked, smashed, dusty). A quad picks its tile with a uv rectangle. */
  const vglassTex = () => tex('vglass', 256, 64, c => {
    const r = rng(77);
    for (let i = 0; i < 4; i++) {
      c.save(); c.beginPath(); c.rect(i * 64, 0, 64, 64); c.clip(); c.translate(i * 64, 0);
      const g = c.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#506a7e'); g.addColorStop(0.5, '#27343f'); g.addColorStop(1, '#151c24'); c.fillStyle = g; c.fillRect(0, 0, 64, 64);
      c.globalAlpha = 0.14; c.fillStyle = '#d5ebf8'; c.beginPath(); c.moveTo(8, 64); c.lineTo(34, 0); c.lineTo(47, 0); c.lineTo(21, 64); c.fill(); c.globalAlpha = 1;
      if (i === 3) { c.fillStyle = 'rgba(126,112,92,0.78)'; c.fillRect(0, 0, 64, 64); c.fillStyle = 'rgba(60,52,42,0.5)'; for (let k = 0; k < 9; k++) c.fillRect(r() * 60, r() * 20, 2 + r() * 3, 20 + r() * 40); }
      if (i === 1 || i === 2) {
        const cx = 18 + r() * 28, cy = 18 + r() * 28; c.strokeStyle = 'rgba(225,235,240,0.85)'; c.lineWidth = 1;
        for (let k = 0; k < 11; k++) { const a = k * TAU / 11 + r() * 0.4, len = 22 + r() * 40; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * len * 0.5 + (r() - 0.5) * 6, cy + Math.sin(a) * len * 0.5 + (r() - 0.5) * 6); c.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); c.stroke(); }
        for (let q = 1; q < 3; q++) { c.beginPath(); for (let k = 0; k <= 9; k++) { const a = k * TAU / 9, rr = q * 9 + r() * 4; k ? c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : c.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } c.stroke(); }
        if (i === 2) { c.fillStyle = '#050607'; c.beginPath(); for (let k = 0; k < 9; k++) { const a = k * TAU / 9, rr = 9 + r() * 12; k ? c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : c.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } c.closePath(); c.fill(); c.stroke(); }
      }
      c.restore();
    }
  });
  const vglassMat = () => tmat('vglass', () => texMat(vglassTex(), { rough: 0.16 }));
  const gtile = i => [i / 4 + 0.012, 0.03, (i + 1) / 4 - 0.012, 0.97];
  /** Dirt and rust for abandoned vehicles: v 0 = body side (dust rising from the sills), v 1 = top surfaces. */
  const grimeTex = v => tex('grime' + v, 256, 128, c => {
    const r = rng(900 + v * 31); c.clearRect(0, 0, 256, 128);
    if (v === 0) { const g = c.createLinearGradient(0, 128, 0, 24); g.addColorStop(0, 'rgba(74,62,47,0.9)'); g.addColorStop(0.5, 'rgba(84,72,55,0.35)'); g.addColorStop(1, 'rgba(84,72,55,0)'); c.fillStyle = g; c.fillRect(0, 0, 256, 128); }
    else { c.fillStyle = 'rgba(96,86,68,0.42)'; c.fillRect(0, 0, 256, 128); }
    for (let i = 0; i < (v ? 20 : 12); i++) {
      const x = r() * 256, y = 14 + r() * 110, s = 5 + r() * 15, rust = r() < 0.55;
      c.fillStyle = rust ? `rgba(${98 + r() * 26 | 0},${52 + r() * 14 | 0},${30 + r() * 10 | 0},${0.45 + r() * 0.35})` : `rgba(52,46,38,${0.3 + r() * 0.3})`;
      for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x + (r() - 0.5) * s * 1.6, y + (r() - 0.5) * s, s * (0.35 + r() * 0.5), 0, TAU); c.fill(); }
      if (!v && rust) c.fillRect(x - 1, y, 2 + r() * 2, 10 + r() * 30);
    }
  });
  const grimeMat = v => tmat('grime' + v, () => texMat(grimeTex(v), { transparent: true, rough: 1 }));
  const hubMat = kind => tmat('hub' + kind, () => texMat(tex('hub' + kind, 128, 128, c => {
    c.translate(64, 64); c.fillStyle = '#0b0c0e'; c.fillRect(-64, -64, 128, 128);
    c.fillStyle = kind === 'steel' ? '#878d92' : kind === 'black' ? '#2b2e33' : kind === 'white' ? '#d8d8d2' : '#c3c8cc'; c.beginPath(); c.arc(0, 0, 61, 0, TAU); c.fill();
    c.fillStyle = '#121416';
    if (kind === 'steel' || kind === 'white') { for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.beginPath(); c.arc(Math.cos(a) * 38, Math.sin(a) * 38, 8.5, 0, TAU); c.fill(); } c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 52, 0, TAU); c.stroke(); }
    else for (let i = 0; i < 5; i++) { const a = i * TAU / 5 + 0.63, p = (rr, da) => [Math.cos(a + da) * rr, Math.sin(a + da) * rr]; c.beginPath(); c.moveTo(...p(20, -0.3)); c.lineTo(...p(53, -0.46)); c.arc(0, 0, 53, a - 0.46, a + 0.46); c.lineTo(...p(20, 0.3)); c.closePath(); c.fill(); }
    c.fillStyle = kind === 'black' ? '#55595e' : '#e3e6e8'; c.beginPath(); c.arc(0, 0, 11, 0, TAU); c.fill();
    c.fillStyle = '#4a4e52'; for (let i = 0; i < 5; i++) { const a = i * TAU / 5; c.beginPath(); c.arc(Math.cos(a) * 16, Math.sin(a) * 16, 2.2, 0, TAU); c.fill(); }
  }), { rough: 0.45 }));
  /** Wheel with its axle along X (spin it with rotation.x). kind: 'alloy' | 'steel' | 'black' | 'white'. */
  function wheel(r, w, kind = 'alloy', sides = 14) {
    const g = grp(), ty = cyl(r, r, w, sides, '#17181b', { rough: 0.97 }); ty.geometry.rotateZ(PI / 2); g.add(ty);
    for (const sx of [-1, 1]) { const d = new T.Mesh(new T.CircleGeometry(r * 0.7, sides).rotateY(sx * PI / 2), hubMat(kind)); d.position.x = sx * (w / 2 + 0.004); d.receiveShadow = true; g.add(d); }
    return g;
  }
  /** Closed side outline of a lower body: `top` runs from the rear-bottom corner over the body to the front-bottom corner; wheel arches are cut into the bottom edge. */
  function archProfile(top, sill, axles, ar, cy, n = 7) {
    const pts = top.map(p => p.slice());
    for (const z of axles.slice().sort((a, b) => b - a)) {
      const dz = Math.sqrt(Math.max(1e-4, ar * ar - (sill - cy) * (sill - cy))), a0 = Math.atan2(sill - cy, dz), a1 = PI - a0;
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([z + Math.cos(a) * ar, cy + Math.sin(a) * ar]); }
    }
    return pts;
  }
  /** Side outline of a wheel-arch lip (a ring segment) for sideProfile. */
  function archRing(z, cy, r0, r1, sill, n = 7) {
    const a0 = Math.asin(clamp((sill - cy) / r1, -1, 1)), pts = [], p = (rr, i) => { const a = a0 + (PI - 2 * a0) * i / n; return [z + Math.cos(a) * rr, cy + Math.sin(a) * rr]; };
    for (let i = 0; i <= n; i++) pts.push(p(r1, i)); for (let i = n; i >= 0; i--) pts.push(p(r0, i)); return pts;
  }
  /** Quad on a vehicle side (sx = -1 | 1) at |x|: p = [rear-bottom, front-bottom, front-top, rear-top] as [z, y]. */
  const sideQ = (sx, x, p, uv) => { const q = p.map(a => [sx * x, a[1], a[0]]); return sx < 0 ? [q[0], q[1], q[2], q[3], uv] : [q[1], q[0], q[3], q[2], uv]; };
  /** Shared state for one vehicle: paint, trim, damage level, random stream. */
  function vctx(o, defCol) {
    const seed = o.seed ?? 1, A = o.abandoned === true ? 1 : +o.abandoned || 0, r = rng(seed * 7919 + 13);
    const base = o.color || defCol || CAR_COLS[seed % CAR_COLS.length], col = A ? mix(base, '#7d705d', 0.4 * A) : base;
    return { o, seed, r, A, base, col, po: A ? { rough: 1, vary: 0.1, seed } : { rough: 0.42, metal: 0.1 }, pm: mat(col, A ? { rough: 1 } : { rough: 0.42, metal: 0.1 }),
      dark: mat('#1b1d20', { rough: 0.8 }), chrome: mat(A ? '#7c7a72' : '#c6cbd0', { rough: 0.3, metal: 0.25 }), trim: mat(mix(col, '#000000', 0.6), { rough: 0.7 }),
      lights: A ? 0 : (o.lights === true || o.night === true) ? 1 : +o.lights || 0, gt: () => !A ? 0 : (x => x < 0.3 ? 2 : x < 0.62 ? 1 : 3)(r()) };
  }

  const CARS = {
    saloon: { L: 4.5, W: 1.8, wr: 0.33, tw: 0.21, ax: [1.38, -1.32], sill: 0.2,
      top: [[-2.18, 0.26], [-2.25, 0.36], [-2.25, 0.86], [-2.19, 0.93], [-1.48, 0.975], [0.82, 0.975], [1.9, 0.87], [2.18, 0.78], [2.25, 0.72], [2.25, 0.36], [2.18, 0.25]],
      cab: { yb: 0.975, yt: 1.42, wb: 0.84, wt: 0.66, zb: [-1.48, 0.82], zt: [-0.92, 0.12] }, pil: [[-0.26, -0.3]],
      head: [0.62, 0.64, 0.4, 0.12], grille: [0.64, 0.74, 0.1], tail: [0.63, 0.74, 0.44, 0.13], py: [0.5, 0.59], seams: [0.9, -0.26, -0.9], handles: [-0.08, -0.74], hy: 0.87, mirror: [0.7, 1.03] },
    hatchback: { L: 3.96, W: 1.74, wr: 0.31, tw: 0.2, ax: [1.2, -1.28], sill: 0.2,
      top: [[-1.92, 0.27], [-1.98, 0.37], [-1.98, 0.9], [-1.94, 0.985], [0.7, 0.985], [1.62, 0.9], [1.9, 0.8], [1.98, 0.73], [1.98, 0.37], [1.91, 0.26]],
      cab: { yb: 0.985, yt: 1.46, wb: 0.81, wt: 0.65, zb: [-1.94, 0.7], zt: [-1.6, 0.03] }, pil: [[-0.3, -0.34], [-1.22, -1.24]],
      head: [0.6, 0.66, 0.36, 0.13], grille: [0.66, 0.64, 0.09], tail: [0.69, 0.78, 0.26, 0.2], py: [0.5, 0.58], seams: [0.78, -0.3, -0.88], handles: [-0.14, -0.74], hy: 0.88, mirror: [0.58, 1.04] },
    suv: { L: 4.76, W: 1.92, wr: 0.385, tw: 0.25, ax: [1.47, -1.4], sill: 0.3, ar: 0.46, clad: 0.15,
      top: [[-2.31, 0.38], [-2.38, 0.48], [-2.38, 1.06], [-2.34, 1.16], [0.86, 1.16], [1.98, 1.07], [2.3, 0.98], [2.38, 0.9], [2.38, 0.48], [2.31, 0.36]],
      cab: { yb: 1.16, yt: 1.72, wb: 0.9, wt: 0.75, zb: [-2.34, 0.86], zt: [-2.12, 0.22] }, pil: [[-0.18, -0.2], [-1.2, -1.2]],
      head: [0.68, 0.82, 0.4, 0.13], grille: [0.82, 0.8, 0.15], tail: [0.76, 0.96, 0.24, 0.2], py: [0.64, 0.74], seams: [0.94, -0.18, -0.9], handles: [0, -0.72], hy: 1.04, mirror: [0.74, 1.24] },
    pickup: { L: 5.36, W: 1.96, wr: 0.4, tw: 0.26, ax: [1.74, -1.56], sill: 0.34, ar: 0.48, clad: 0.1,
      top: [[-2.61, 0.42], [-2.68, 0.52], [-2.68, 0.92], [-0.56, 0.92], [-0.56, 1.2], [0.94, 1.2], [2.16, 1.12], [2.58, 1.03], [2.68, 0.95], [2.68, 0.52], [2.6, 0.4]],
      cab: { yb: 1.2, yt: 1.8, wb: 0.92, wt: 0.79, zb: [-0.56, 0.94], zt: [-0.46, 0.38] }, pil: [], rows: [0.0],
      head: [0.72, 0.86, 0.36, 0.16], grille: [0.86, 0.94, 0.18], tail: [0.89, 0.72, 0.12, 0.3], py: [0.6, 0.68], pz: [0.085, 0], seams: [1.0, -0.5], handles: [-0.36], hy: 1.08, mirror: [0.8, 1.3] },
    van: { L: 5.2, W: 2.0, wr: 0.36, tw: 0.24, ax: [1.72, -1.5], sill: 0.3, ar: 0.44, hub: 'steel', belt: 1.26, H: 2.28,
      top: [[-2.54, 0.38], [-2.6, 0.48], [-2.6, 2.16], [-2.5, 2.28], [0.5, 2.28], [0.82, 2.2], [1.7, 1.26], [2.4, 1.1], [2.58, 0.98], [2.6, 0.9], [2.6, 0.48], [2.53, 0.36]],
      ws: [[1.7, 1.26], [0.82, 2.2]], dw: [[0.22, 1.3], [1.56, 1.3], [0.98, 1.98], [0.22, 1.98]],
      head: [0.76, 0.76, 0.28, 0.2], grille: [0.76, 0.94, 0.14], tail: [0.93, 1.0, 0.1, 0.46], py: [0.57, 0.62] },
    ambulance: { L: 5.6, W: 2.06, wr: 0.37, tw: 0.25, ax: [1.9, -1.6], sill: 0.3, ar: 0.45, hub: 'white', belt: 1.28, H: 2.56,
      top: [[-2.74, 0.38], [-2.8, 0.48], [-2.8, 2.44], [-2.7, 2.56], [0.6, 2.56], [0.95, 2.46], [1.88, 1.28], [2.6, 1.12], [2.78, 1.0], [2.8, 0.92], [2.8, 0.48], [2.73, 0.36]],
      ws: [[1.88, 1.28], [0.95, 2.46]], dw: [[0.38, 1.32], [1.74, 1.32], [1.12, 2.1], [0.38, 2.1]],
      head: [0.79, 0.78, 0.28, 0.2], grille: [0.78, 0.98, 0.14], tail: [0.96, 1.05, 0.1, 0.46], py: [0.57, 0.62] },
    bus: { L: 11.6, W: 2.55, wr: 0.48, tw: 0.32, ax: [3.7, -2.9], sill: 0.34, ar: 0.57, hub: 'steel', belt: 1.3, H: 3.09, flare: 1.5, pz: [0.055, 0.055],
      top: [[-5.74, 0.42], [-5.8, 0.52], [-5.8, 2.9], [-5.65, 3.05], [5.4, 3.05], [5.68, 2.96], [5.8, 2.62], [5.8, 0.52], [5.72, 0.4]],
      head: [0.92, 0.8, 0.34, 0.16], tail: [1.08, 1.0, 0.12, 0.4], py: [0.55, 0.62] },
  };

  /** Lower body with wheel arches, dark underbody, sills and wheels. */
  function chassis(S, P) {
    const g = grp(), body = grp().to(g), { W, wr, tw } = S, hw = W / 2, ar = S.ar || wr + 0.065, z0 = S.top[0][0], z1 = S.top[S.top.length - 1][0];
    body.add(sideProfile(archProfile(S.top, S.sill, S.ax, ar, wr), W, P.col, P.po));
    body.add(box(W - 2 * tw - 0.12, wr + ar - S.sill + 0.02, z1 - z0 - 0.16, '#0f1012', { rough: 1 }).at(0, (S.sill - 0.04 + wr + ar - 0.02) / 2, (z0 + z1) / 2));
    const ax = S.ax.slice().sort((a, b) => b - a), ch = S.clad || 0.07;
    for (let i = 0; i + 1 < ax.length; i++) { const a = ax[i + 1] + ar + 0.02, b = ax[i] - ar - 0.02; if (b - a > 0.1) for (const sx of [-1, 1]) body.add(box(0.02, ch, b - a, P.dark).at(sx * (hw + 0.002), S.sill + ch / 2, (a + b) / 2)); }
    const wheels = [], steer = [];
    S.ax.forEach((z, i) => [-1, 1].forEach(sx => { const piv = grp().at(sx * (hw - tw / 2 - 0.015), wr, z), w = wheel(wr, tw, S.hub || 'alloy'); piv.add(w); piv.userData.dyn = true; g.add(piv); wheels.push(w); if (i === 0) steer.push(piv); }));
    return { g, body, P, S, wheels, steer, H: S.H || 0 };
  }
  /** Tapered glass cabin with roof, pillars, mirrors, door seams and handles. */
  function greenhouse(c) {
    const { body, P, S } = c, hw = S.W / 2, dk = P.dark, cb = S.cab, { yb, yt, wb, wt } = cb, [zb0, zb1] = cb.zb, [zt0, zt1] = cb.zt;
    const B = [[-wb, yb, zb0], [wb, yb, zb0], [wb, yb, zb1], [-wb, yb, zb1]], R = [[-wt, yt, zt0], [wt, yt, zt0], [wt, yt, zt1], [-wt, yt, zt1]];
    const clear = !!P.o.interior, gm = clear ? mat('#a9c7d6', { opacity: 0.3, rough: 0.1 }) : vglassMat(), gq = (a, b, c2, d) => [a, b, c2, d, gtile(P.gt())];
    body.add(quads([gq(B[1], B[0], R[0], R[1]), gq(B[3], B[2], R[2], R[3]), gq(B[0], B[3], R[3], R[0]), gq(B[2], B[1], R[1], R[2])], gm));
    body.add(taper(yt - 0.004, wt + 0.014, zt0 - 0.03, zt1 + 0.04, yt + 0.036, wt - 0.03, zt0 + 0.06, zt1 - 0.06, P.col, P.po));
    for (const sx of [-1, 1]) {
      const e = 0.006 * sx;
      body.add(beam([sx * wb + e, yb, zb1], [sx * wt + e, yt, zt1], 0.055, 0.055, P.col, P.po), beam([sx * wb + e, yb, zb0], [sx * wt + e, yt, zt0], 0.06, 0.06, P.col, P.po));
      for (const [pb, pt] of S.pil) body.add(beam([sx * wb + e, yb, pb], [sx * wt + e, yt, pt], 0.03, 0.075, dk));
      body.add(box(0.014, 0.022, zb1 - zb0, P.chrome).at(sx * (wb + 0.004), yb + 0.012, (zb0 + zb1) / 2));
      for (const z of S.seams) body.add(box(0.008, yb - S.sill - 0.08, 0.012, P.trim).at(sx * (hw + 0.001), (yb + S.sill + 0.08) / 2, z));
      for (const z of S.handles) body.add(box(0.016, 0.028, 0.13, P.chrome).at(sx * (hw + 0.005), S.hy, z));
      body.add(box(0.15, 0.095, 0.06, P.col, P.po).at(sx * (wb + 0.12), S.mirror[1], S.mirror[0]), box(0.07, 0.03, 0.04, dk).at(sx * (wb + 0.03), S.mirror[1] - 0.03, S.mirror[0]));
    }
    body.add(box(wb * 2 - 0.04, 0.03, 0.07, dk).at(0, yb + 0.012, zb1 + 0.02));
    // wipers lying on the windscreen
    const wz = f => lerp(zb1, zt1, f) + 0.012, wy = f => lerp(yb, yt, f) + 0.012;
    body.add(beam([-0.05, wy(0.04), wz(0.04)], [-0.5, wy(0.2), wz(0.2)], 0.014, 0.014, dk), beam([0.6, wy(0.04), wz(0.04)], [0.15, wy(0.2), wz(0.2)], 0.014, 0.014, dk));
    if (clear) cabin(c);
    c.H = yt + 0.036;
  }
  /** Seats, dashboard and steering wheel seen through clear glass (o.interior). The driver sits on +X. */
  function cabin(c) {
    const { body, S } = c, cb = S.cab, { yb, wb } = cb, [zb0, zb1] = cb.zb, seat = mat('#3a3d44', { rough: 0.95 }), rows = S.rows || [zb1 - 0.95, zb0 + 0.62];
    body.add(box(wb * 2 - 0.02, 0.01, zb1 - zb0 - 0.02, '#0c0d0f', { rough: 1 }).at(0, yb + 0.004, (zb0 + zb1) / 2));
    rows.forEach((z, i) => { for (const sx of i ? [0] : [-1, 1]) { body.add(box(i ? wb * 1.7 : 0.48, 0.36, 0.1, seat).at(sx * 0.4, yb + 0.14, z - 0.2).rot(-0.14, 0, 0)); for (const hx of i ? [-0.42, 0.42] : [0]) body.add(box(0.24, 0.16, 0.09, seat).at(sx * 0.4 + hx, yb + 0.37, z - 0.24)); } });
    body.add(box(wb * 2 - 0.06, 0.1, 0.24, '#17191c', { rough: 0.9 }).at(0, yb + 0.03, zb1 - 0.14));
    body.add(torus(0.17, 0.018, '#111214', { rs: 4, ts: 10 }).at(0.4, yb + 0.12, zb1 - 0.36).rot(-1.1, 0, 0));
    c.seatPos = [[0.4, yb - 0.5, rows[0] - 0.08], [-0.4, yb - 0.5, rows[0] - 0.08]];
  }
  /** Headlights, tail lights, indicators, grille, intake, plates and exhaust on the front and rear faces. */
  function faces(c) {
    const { body, P, S } = c, hw = S.W / 2, zF = S.L / 2, zR = -zF, dk = P.dark;
    const lm = c.lm = { head: lamp('#e6eaec', '#fff0cc'), tail: lamp('#74120f', '#ff2a16'), indL: lamp('#b9691c', '#ffa416'), indR: lamp('#b9691c', '#ffa416') };
    const [hx, hy, hwd, hh] = S.head, [tx, ty, twd, th] = S.tail;
    for (const sx of [-1, 1]) {
      const ind = sx > 0 ? lm.indL : lm.indR;
      body.add(box(hwd, hh, 0.04, lm.head).at(sx * hx, hy, zF + 0.004), box(0.06, hh, 0.045, ind).at(sx * Math.min(hw - 0.04, hx + hwd / 2 + 0.035), hy, zF + 0.002));
      body.add(box(twd, th, 0.04, lm.tail).at(sx * tx, ty, zR - 0.004));
      body.add(th > twd ? box(twd, th * 0.26, 0.045, ind).at(sx * tx, ty + th * 0.37, zR - 0.004) : box(0.06, th, 0.045, ind).at(sx * (tx - twd / 2 - 0.035), ty, zR - 0.002));
      body.add(box(0.12, 0.05, 0.03, dk).at(sx * (hw - 0.2), S.sill + 0.25, zF + 0.004));
    }
    if (S.grille) { const [gy, gw, gh] = S.grille; body.add(box(gw, gh, 0.03, '#131416', { rough: 0.6 }).at(0, gy, zF + 0.004), box(gw * 0.92, 0.014, 0.036, P.chrome).at(0, gy, zF + 0.004)); }
    body.add(box(S.W * 0.58, 0.075, 0.03, dk).at(0, S.sill + 0.25, zF + 0.004), box(S.W * 0.74, 0.06, 0.03, dk).at(0, S.sill + 0.22, zR - 0.004));
    const pm = plateMat(P.seed);
    const pz = S.pz || [0, 0];
    body.add(quad(0.44, 0.11, pm).at(0, S.py[0], zF + 0.022 + pz[0]), quad(0.44, 0.11, pm).at(0, S.py[1], zR - 0.01 - pz[1]).rot(0, PI, 0));
    const ex = cyl(0.028, 0.028, 0.14, 6, P.chrome); ex.geometry.rotateX(PI / 2); body.add(ex.at(-hw + 0.38, S.sill + 0.05, zR + 0.05));
    c.head = [[hx, hy, zF], [-hx, hy, zF]]; c.tail = [[tx, ty, zR], [-tx, ty, zR]];
  }
  const carBody = (S, o = {}, defCol) => { const c = chassis(S, vctx(o, defCol)); greenhouse(c); faces(c); return c; };
  /** Roof light bar with two lenses that flash alternately: flash(t) (t = seconds; null switches it off). */
  function lightbar(w, colA, colB, P) {
    const g = grp(), mA = lamp(shade(colA, -0.5), colA), mB = lamp(shade(colB, -0.5), colB), fA = flare(colA, 1.7, 0.8), fB = flare(colB, 1.7, 0.8);
    g.add(box(w, 0.035, 0.3, P.dark).at(0, 0.018, 0), box(w * 0.45, 0.1, 0.26, mA).at(w * 0.255, 0.085, 0), box(w * 0.45, 0.1, 0.26, mB).at(-w * 0.255, 0.085, 0), box(0.06, 0.11, 0.28, '#d9dde0').at(0, 0.085, 0));
    fA.position.set(w * 0.25, 0.15, 0); fB.position.set(-w * 0.25, 0.15, 0); fA.visible = fB.visible = false; g.add(fA, fB);
    const flash = t => { const on = t != null && t !== false && !P.A, ph = on ? mod(t * 2.2, 1) : 0, sub = mod(ph * 6, 1) < 0.6, a = on && ph < 0.5 && sub, b = on && ph >= 0.5 && sub;
      mA.emissiveIntensity = a ? 5 : on ? 0.3 : 0; mB.emissiveIntensity = b ? 5 : on ? 0.3 : 0; fA.visible = a; fB.visible = b; };
    return { g, flash };
  }
  /** Complete a vehicle: flares, damage, merge, and the userData controls shared by every vehicle. */
  function finishVehicle(c) {
    const { g, body, P, S, lm } = c, U = g.userData, A = P.A, hw = S.W / 2;
    const fl = { head: c.head.map(p => flare('#fff1cf', S.flare || 1.25, 0.62).at(p[0], p[1], p[2] + 0.05).to(g)), tail: c.tail.map(p => flare('#ff3a22', 0.55, 0.55).at(p[0], p[1], p[2] - 0.05).to(g)) };
    if (A && S.ax) {
      const ar = S.ar || S.wr + 0.065, ax = S.ax.slice().sort((a, b) => b - a), gr = S.grime || [ax[1] + ar + 0.06, ax[0] - ar - 0.06, S.sill, (S.cab ? S.cab.yb : S.belt || 1) - 0.02];
      for (const sx of [-1, 1]) { const q = quad(gr[1] - gr[0], gr[3] - gr[2], grimeMat(0)); q.castShadow = false; body.add(q.at(sx * (hw + 0.012), (gr[2] + gr[3]) / 2, (gr[0] + gr[1]) / 2).rot(0, sx * PI / 2, 0)); }
      const tg = S.topGrime !== undefined ? S.topGrime : S.cab ? [S.cab.zt[0] + 0.05, S.cab.zt[1] - 0.05, S.cab.wt * 2 - 0.1] : [ax[1], ax[0] - 1.3, S.W - 0.3];
      if (tg) { const t = plane(tg[2], tg[1] - tg[0], grimeMat(1)); t.castShadow = false; body.add(t.at(0, (S.H || c.H) + 0.006, (tg[0] + tg[1]) / 2)); }
      const fi = Math.floor(P.r() * c.wheels.length), fw = c.wheels[fi].parent, sx = Math.sign(fw.position.x), sz = Math.sign(fw.position.z) || 1;
      fw.position.y = S.wr * 0.8; fw.scale.set(1, 0.8, 1.06);
      body.rotation.z = sx * -0.034 * A * (1.8 / S.W); body.rotation.x = sz * 0.014 * A * (4.5 / S.L); body.position.y = -0.012;
      c.wheels.forEach((w, i) => { w.rotation.x = P.r() * TAU; if (c.steer.includes(w.parent)) w.parent.rotation.y = (P.r() - 0.5) * 0.5; });
    }
    bake(body); c.wheels.forEach(bake);
    const st = { on: 0, brake: 0 };
    const apply = () => {
      lm.head.emissiveIntensity = 3.2 * st.on; lm.tail.emissiveIntensity = 1.4 * st.on + 3.4 * st.brake;
      fl.head.forEach(f => { f.visible = st.on > 0.02; f.material.opacity = 0.62 * st.on; }); fl.tail.forEach(f => { f.visible = st.on + st.brake > 0.02; f.material.opacity = Math.min(0.85, 0.4 * st.on + 0.5 * st.brake); });
      if (c.onLights) c.onLights(st.on);
    };
    U.kind = 'vehicle'; U.body = body; U.wheels = c.wheels; U.steer = c.steer; U.wheelR = S.wr; U.size = [S.W, c.H, S.L]; U.lamps = lm; U.flares = fl;
    U.headlightPos = c.head; U.taillightPos = c.tail; if (c.seatPos) U.seatPos = c.seatPos;
    U.drive = (dist = 0, steerAngle = 0) => { for (const w of c.wheels) w.rotation.x = dist / (w.userData.r || S.wr); for (const p of c.steer) p.rotation.y = steerAngle; if (c.onDrive) c.onDrive(dist, steerAngle); return g; };
    U.setLights = (k = 1) => { st.on = A ? 0 : +k; apply(); return g; };
    U.brake = (k = 1) => { st.brake = A ? 0 : +k; apply(); return g; };
    U.indicate = (side, on) => { const e = on && !A ? 3.5 : 0; if (side !== 'R') lm.indL.emissiveIntensity = e; if (side !== 'L') lm.indR.emissiveIntensity = e; return g; };
    U.hazard = t => U.indicate('both', t != null && t !== false && mod(t * 1.4, 1) < 0.5);
    apply(); U.setLights(P.lights);
    return g;
  }

  /** Four-door saloon, 4.5 x 1.8 x 1.46 m. */
  const saloon = (o = {}) => finishVehicle(carBody(CARS.saloon, o));
  /** Small five-door hatchback, 3.96 x 1.74 x 1.5 m. */
  const hatchback = (o = {}) => finishVehicle(carBody(CARS.hatchback, o, CAR_COLS[((o.seed ?? 1) + 5) % CAR_COLS.length]));
  /** Tall SUV with roof rails and black cladding, 4.76 x 1.92 x 1.79 m. */
  function suv(o = {}) {
    const S = CARS.suv, c = carBody(S, o, CAR_COLS[((o.seed ?? 1) + 3) % CAR_COLS.length]), { body, P } = c, hw = S.W / 2, cb = S.cab;
    for (const sx of [-1, 1]) {
      body.add(box(0.035, 0.035, 1.9, P.dark).at(sx * (cb.wt - 0.07), cb.yt + 0.085, -0.95));
      for (const z of [-0.1, -1.8]) body.add(box(0.04, 0.05, 0.08, P.dark).at(sx * (cb.wt - 0.07), cb.yt + 0.055, z));
      for (const z of S.ax) body.add(sideProfile(archRing(z, S.wr, S.ar - 0.004, S.ar + 0.06, S.sill), 0.04, P.dark).at(sx * (hw + 0.002), 0, 0));
    }
    body.add(box(S.W * 0.62, 0.07, 0.05, '#8d9498', { rough: 0.5 }).at(0, S.sill + 0.2, S.L / 2 + 0.012), box(S.W * 0.62, 0.07, 0.05, '#8d9498', { rough: 0.5 }).at(0, S.sill + 0.2, -S.L / 2 - 0.012));
    return finishVehicle(c);
  }
  /** Single-cab pickup with an open bed, 5.36 x 1.96 x 1.84 m. userData.tailgate, userData.openTailgate(k), userData.bed {y, z0, z1, w}. */
  function pickup(o = {}) {
    const S = CARS.pickup, c = carBody(S, o, CAR_COLS[((o.seed ?? 1) + 8) % CAR_COLS.length]), { body, P } = c, hw = S.W / 2, zR = -S.L / 2, y0 = 0.92, y1 = 1.4, zc = -0.56, liner = mat('#25272a', { rough: 1 });
    for (const sx of [-1, 1]) {
      body.add(box(0.07, y1 - y0, zc - zR, P.col, P.po).at(sx * (hw - 0.035), (y0 + y1) / 2, (zc + zR) / 2), box(0.1, 0.03, zc - zR, P.dark).at(sx * (hw - 0.035), y1 + 0.014, (zc + zR) / 2));
      body.add(box(0.22, 0.2, 0.96, liner).at(sx * (hw - 0.18), y0 + 0.1, S.ax[1]));
      body.add(sideProfile(archRing(S.ax[0], S.wr, S.ar - 0.004, S.ar + 0.05, S.sill), 0.04, P.dark).at(sx * (hw + 0.002), 0, 0), sideProfile(archRing(S.ax[1], S.wr, S.ar - 0.004, S.ar + 0.05, S.sill), 0.04, P.dark).at(sx * (hw + 0.002), 0, 0));
    }
    body.add(box(S.W - 0.14, y1 - y0, 0.07, P.col, P.po).at(0, (y0 + y1) / 2, zc - 0.035), box(S.W - 0.16, 0.02, zc - zR - 0.1, liner).at(0, y0 + 0.012, (zc + zR) / 2));
    body.add(box(S.W + 0.04, 0.12, 0.16, P.chrome).at(0, 0.56, zR - 0.05), box(S.W + 0.02, 0.14, 0.12, P.chrome).at(0, 0.6, S.L / 2 + 0.04));
    const tg = grp().at(0, y0, zR + 0.035); tg.add(box(S.W - 0.14, y1 - y0, 0.06, P.col, P.po).at(0, (y1 - y0) / 2, 0), box(0.5, 0.05, 0.02, P.dark).at(0, (y1 - y0) * 0.78, -0.036));
    body.add(dyn(tg)); const g = finishVehicle(c);
    g.userData.tailgate = tg; g.userData.openTailgate = (k = 1) => { tg.rotation.x = -clamp(k) * PI / 2; return g; }; g.userData.bed = { y: y0 + 0.022, z0: zR + 0.07, z1: zc - 0.07, w: S.W - 0.14 };
    if (o.tailgate) g.userData.openTailgate(o.tailgate === true ? 1 : o.tailgate);
    return g;
  }
  /** Taxi: yellow saloon with a lit roof sign and a chequered band. o.name = roof-sign text. */
  function taxi(o = {}) {
    const S = CARS.saloon, c = carBody(S, { color: '#e0b02a', ...o }), { body, P } = c, hw = S.W / 2, yt = S.cab.yt + 0.036, name = o.name || 'TAXI';
    const sm = texMat(tex('taxisign|' + name, 160, 56, cx => { cx.fillStyle = '#f7f0d6'; cx.fillRect(0, 0, 160, 56); cx.fillStyle = '#16181b'; fit(cx, name, 140, 42, 'Archivo Black'); cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(name, 80, 30); }), { emissive: true, ei: 0 });
    body.add(box(0.48, 0.15, 0.13, '#efe7cc').at(0, yt + 0.085, -0.38), box(0.52, 0.025, 0.17, P.dark).at(0, yt + 0.012, -0.38), quad(0.46, 0.13, sm).at(0, yt + 0.085, -0.313), quad(0.46, 0.13, sm).at(0, yt + 0.085, -0.447).rot(0, PI, 0));
    for (const sx of [-1, 1]) {
      body.add(decal(1.74, 0.11, 'checker', 256, 16, cx => { for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) { cx.fillStyle = (i + j) % 2 ? '#141518' : '#f2efe4'; cx.fillRect(i * 8, j * 8, 8, 8); } }, { opaque: true }).at(sx * (hw + 0.007), 0.7, 0).rot(0, sx * PI / 2, 0));
      body.add(decal(0.62, 0.17, 'taxidoor|' + name, 200, 56, cx => { cx.fillStyle = '#16181b'; fit(cx, name, 190, 46, 'Archivo Black'); cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(name, 100, 30); }).at(sx * (hw + 0.007), 0.5, 0.32).rot(0, sx * PI / 2, 0));
    }
    c.onLights = k => { sm.emissiveIntensity = 1.5 * k; };
    return finishVehicle(c);
  }
  /** Generic police car. o.style 'bw' (black with white doors) | 'stripe' (white with a blue band); o.text. userData.siren(t). */
  function policeCar(o = {}) {
    const S = CARS.saloon, bw = (o.style || 'bw') === 'bw', text = o.text || 'POLICE', c = carBody(S, { color: bw ? '#1d1f23' : '#e8e7e1', ...o }), { body, P } = c, hw = S.W / 2, cb = S.cab, white = mat(P.A ? '#a39d8f' : '#e8e7e1', { rough: 0.5 });
    if (bw) body.add(box(cb.wt * 2 - 0.1, 0.012, cb.zt[1] - cb.zt[0] - 0.12, white).at(0, cb.yt + 0.04, (cb.zt[0] + cb.zt[1]) / 2));
    for (const sx of [-1, 1]) {
      if (bw) body.add(box(0.01, 0.67, 1.76, white).at(sx * (hw + 0.002), 0.625, 0));
      body.add(decal(1.7, 0.36, 'pol|' + text + bw, 512, 108, cx => {
        if (!bw) { cx.fillStyle = '#1f3f8a'; cx.fillRect(0, 34, 512, 46); cx.fillStyle = '#e9c53a'; cx.fillRect(0, 84, 512, 8); }
        cx.fillStyle = bw ? '#1a2d5c' : '#ffffff'; fit(cx, text, 330, bw ? 78 : 44, 'Archivo Black'); cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(text, 256, bw ? 58 : 59);
      }).at(sx * (hw + 0.012), 0.62, 0).rot(0, sx * PI / 2, 0));
    }
    const lb = lightbar(1.08, '#ff2a20', '#2a5cff', P); body.add(lb.g.at(0, cb.yt + 0.036, -0.32));
    for (const sx of [-1, 1]) body.add(box(0.05, 0.36, 0.05, P.dark).at(sx * 0.3, 0.52, S.L / 2 + 0.08));
    body.add(box(0.74, 0.05, 0.05, P.dark).at(0, 0.42, S.L / 2 + 0.08), box(0.74, 0.05, 0.05, P.dark).at(0, 0.64, S.L / 2 + 0.08), box(0.05, 0.05, 0.1, P.dark).at(0.3, 0.52, S.L / 2 + 0.04), box(0.05, 0.05, 0.1, P.dark).at(-0.3, 0.52, S.L / 2 + 0.04));
    const g = finishVehicle(c); g.userData.siren = t => { lb.flash(t); return g; }; if (o.siren) lb.flash(0.05);
    return g;
  }
  /** Windscreen, door glass, seams and mirrors of a slab-sided van body (the glass is laid over the body). */
  function vanParts(c) {
    const { body, P, S } = c, hw = S.W / 2, dk = P.dark, zR = -S.L / 2, gm = vglassMat(), [b0, b1] = S.ws, dz = b1[0] - b0[0], dy = b1[1] - b0[1], ln = Math.hypot(dz, dy), nz = dy / ln * 0.008, ny = -dz / ln * 0.008;
    const at = f => [lerp(b0[0], b1[0], f) + nz, lerp(b0[1], b1[1], f) + ny], a = at(0.07), b = at(0.93), q = [[[-hw + 0.13, a[1], a[0]], [hw - 0.13, a[1], a[0]], [hw - 0.15, b[1], b[0]], [-hw + 0.15, b[1], b[0]], gtile(P.gt())]];
    for (const sx of [-1, 1]) q.push(sideQ(sx, hw + 0.006, S.dw, gtile(P.gt())));
    if (P.o.rearWindows !== false) for (const sx of [-1, 1]) { const x0 = sx * 0.12, x1 = sx * (hw - 0.22), ya = S.belt + 0.2, yb = S.H - 0.28, z = zR - 0.006; q.push(sx > 0 ? [[x1, ya, z], [x0, ya, z], [x0, yb, z], [x1, yb, z], gtile(P.gt())] : [[x0, ya, z], [x1, ya, z], [x1, yb, z], [x0, yb, z], gtile(P.gt())]); }
    body.add(quads(q, gm));
    const wa = at(0.1), wb = at(0.36); body.add(beam([-0.1, wa[1] + 0.008, wa[0] + 0.008], [-0.62, wb[1] + 0.008, wb[0] + 0.008], 0.016, 0.016, dk), beam([0.66, wa[1] + 0.008, wa[0] + 0.008], [0.14, wb[1] + 0.008, wb[0] + 0.008], 0.016, 0.016, dk));
    const zd0 = S.dw[0][0] - 0.08, zd1 = S.dw[1][0] + 0.06, top = S.dw[2][1] + 0.07, at0 = S.wr + (S.ar || 0.44) + 0.04;
    for (const sx of [-1, 1]) {
      body.add(box(0.008, top - S.sill - 0.08, 0.012, P.trim).at(sx * (hw + 0.001), (top + S.sill + 0.08) / 2, zd0), box(0.008, S.belt - at0, 0.012, P.trim).at(sx * (hw + 0.001), (S.belt + at0) / 2, zd1));
      body.add(box(0.016, 0.03, 0.14, dk).at(sx * (hw + 0.005), S.belt - 0.14, zd0 + 0.14));
      body.add(box(0.1, 0.25, 0.07, dk).at(sx * (hw + 0.14), S.belt + 0.2, zd1 - 0.06), box(0.16, 0.03, 0.03, dk).at(sx * (hw + 0.06), S.belt + 0.14, zd1 - 0.06));
      body.add(box(0.016, 0.06, S.ax[0] - S.ax[1] - 2 * (S.ar || 0.44) - 0.1, dk).at(sx * (hw + 0.004), S.sill + 0.42, (S.ax[0] + S.ax[1]) / 2));
    }
    // sliding door on the kerb side (-X), double doors at the back
    body.add(box(0.008, S.H - S.sill - 0.3, 0.012, P.trim).at(-hw - 0.001, (S.H + S.sill - 0.14) / 2, zd0 - 1.25), box(0.008, 0.02, 1.2, P.trim).at(-hw - 0.001, S.belt + 0.04, zd0 - 1.9), box(0.016, 0.03, 0.14, dk).at(-hw - 0.005, S.belt - 0.14, zd0 - 0.16));
    body.add(box(0.012, S.H - S.sill - 0.42, 0.008, P.trim).at(0, (S.H + S.sill - 0.1) / 2, zR - 0.001), box(0.03, 0.14, 0.016, dk).at(0.06, S.belt - 0.1, zR - 0.005), box(S.W - 0.1, 0.1, 0.14, dk).at(0, S.sill + 0.12, zR - 0.03));
  }
  /** Panel van, 5.2 x 2.0 x 2.28 m. o.text / o.textColor / o.stripe put a livery on the cargo sides; o.rearWindows: false for none. */
  function van(o = {}) {
    const S = CARS.van, c = chassis(S, vctx(o, '#e3e1d9')), { body } = c, hw = S.W / 2; faces(c); vanParts(c);
    if (o.text || o.stripe) for (const sx of [-1, 1]) body.add(decal(2.3, 0.82, 'van|' + o.text + '|' + o.textColor + '|' + o.stripe, 512, 182, cx => {
      if (o.stripe) { cx.fillStyle = o.stripe; cx.fillRect(0, 138, 512, 26); cx.globalAlpha = 0.6; cx.fillRect(0, 170, 512, 8); cx.globalAlpha = 1; }
      if (o.text) { const ln = String(o.text).split('\n'); cx.fillStyle = o.textColor || '#1f3d5c'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; ln.forEach((t, i) => { fit(cx, t, 490, i ? 40 : ln.length > 1 ? 74 : 86, i ? 'Montserrat' : 'Archivo Black', i ? '800' : ''); cx.fillText(t, 256, ln.length > 1 ? 44 + i * 62 : 68); }); }
    }).at(sx * (hw + 0.008), 1.42, -1.25).rot(0, sx * PI / 2, 0));
    return finishVehicle(c);
  }
  /** Ambulance (generic livery), 5.6 x 2.06 x 2.7 m. o.text (default 'AMBULANCE'). userData.siren(t). */
  function ambulance(o = {}) {
    const S = CARS.ambulance, c = chassis(S, vctx(o, '#ecebe6')), { body, P } = c, hw = S.W / 2, text = o.text || 'AMBULANCE', zR = -S.L / 2; faces(c); vanParts(c);
    const pulse = (cx, x, y, s) => { cx.beginPath(); cx.moveTo(x, y); [[14, 0], [20, -8], [27, 16], [36, -30], [45, 22], [52, -6], [58, 0], [76, 0]].forEach(p => cx.lineTo(x + p[0] * s, y + p[1] * s)); cx.stroke(); };
    for (const sx of [-1, 1]) body.add(decal(4.6, 1.05, 'amb|' + text, 1024, 234, cx => {
      cx.fillStyle = '#e4572e'; cx.fillRect(0, 150, 1024, 56); cx.fillStyle = '#17766f'; cx.fillRect(0, 212, 1024, 14); cx.fillRect(0, 134, 1024, 8);
      cx.fillStyle = '#1b3f7a'; fit(cx, text, 520, 96, 'Archivo Black'); cx.textAlign = 'left'; cx.textBaseline = 'middle'; cx.fillText(text, 36, 70);
      cx.strokeStyle = '#ffffff'; cx.lineWidth = 7; cx.lineJoin = 'round'; pulse(cx, 620, 178, 1.3); cx.strokeStyle = '#e4572e'; cx.lineWidth = 9; pulse(cx, 640, 76, 2.4);
    }).at(sx * (hw + 0.008), 1.18, -0.42).rot(0, sx * PI / 2, 0));
    body.add(decal(1.5, 0.3, 'ambrear|' + text, 400, 80, cx => { cx.fillStyle = '#1b3f7a'; fit(cx, text, 380, 64, 'Archivo Black'); cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(text, 200, 44); }).at(0, 1.02, zR - 0.012).rot(0, PI, 0));
    const sm = texMat(tex('ambsign|' + text, 320, 48, cx => { cx.fillStyle = '#f4f1e6'; cx.fillRect(0, 0, 320, 48); cx.fillStyle = '#c4281c'; fit(cx, text, 300, 38, 'Archivo Black'); cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(text, 160, 26); }), { emissive: true, ei: 0 });
    body.add(box(1.5, 0.24, 0.16, '#ecebe6').at(0, S.H + 0.1, 0.72), quad(1.44, 0.2, sm).at(0, S.H + 0.1, 0.802));
    const lb = lightbar(1.5, '#ff2a20', '#f4f6ff', P); body.add(lb.g.at(0, S.H, 0.3));
    const rb = lamp('#7a1512', '#ff2a20'); for (const sx of [-1, 1]) body.add(box(0.2, 0.09, 0.05, rb).at(sx * 0.7, S.H - 0.2, zR - 0.01));
    c.onLights = k => { sm.emissiveIntensity = 1.4 * k; }; c.H = S.H + 0.16;
    const g = finishVehicle(c); g.userData.siren = t => { lb.flash(t); rb.emissiveIntensity = t != null && t !== false && mod(t * 2.2, 1) < 0.5 ? 4 : 0; return g; }; if (o.siren) g.userData.siren(0.05);
    return g;
  }
  /** One side of a bus: frames, panes, seats and passengers, with a matching emissive map when the interior is lit. */
  function busBand(key, w, h, lit, seed, doors) {
    const pw = 1024, ph = Math.round(1024 * h / w), panes = [];
    const map = tex('busband|' + key, pw, ph, c => {
      const r = rng(seed * 5 + 1), n = 9; c.fillStyle = '#14171a'; c.fillRect(0, 0, pw, ph);
      for (let i = 0; i < n; i++) {
        const x = 8 + i * (pw - 16) / n, ww = (pw - 16) / n - 8, isDoor = doors.includes(i), y0 = 8, hh = ph - 16;
        const g = c.createLinearGradient(0, y0, 0, y0 + hh); if (lit) { g.addColorStop(0, '#f6e2ae'); g.addColorStop(1, '#d9b877'); } else { g.addColorStop(0, '#4f697c'); g.addColorStop(0.6, '#26333e'); g.addColorStop(1, '#171e26'); }
        c.fillStyle = g; c.fillRect(x, y0, ww, hh); panes.push([x, y0, ww, hh]);
        if (lit) { c.fillStyle = 'rgba(40,30,22,0.75)'; c.fillRect(x, y0 + 6, ww, 3); }
        if (!isDoor) { c.fillStyle = lit ? '#3a2c26' : '#10151a'; for (let k = 0; k < 2; k++) { const sx = x + 6 + k * ww * 0.5; c.fillRect(sx, y0 + hh * 0.52, ww * 0.34, hh * 0.48); c.beginPath(); c.arc(sx + ww * 0.17, y0 + hh * 0.52, ww * 0.17, PI, 0); c.fill(); if (r() < 0.45) { c.beginPath(); c.arc(sx + ww * 0.17, y0 + hh * 0.3, ww * 0.085, 0, TAU); c.fill(); c.fillRect(sx + ww * 0.05, y0 + hh * 0.38, ww * 0.24, hh * 0.3); } } }
        else { c.fillStyle = '#14171a'; c.fillRect(x + ww / 2 - 2, y0, 4, hh); }
        if (!lit) { c.globalAlpha = 0.12; c.fillStyle = '#d5ebf8'; c.beginPath(); c.moveTo(x + ww * 0.2, y0 + hh); c.lineTo(x + ww * 0.55, y0); c.lineTo(x + ww * 0.75, y0); c.lineTo(x + ww * 0.4, y0 + hh); c.fill(); c.globalAlpha = 1; }
      }
    });
    const emap = lit ? tex('busbandE|' + key, pw / 2, Math.round(ph / 2), c => { c.fillStyle = '#000'; c.fillRect(0, 0, pw, ph); c.drawImage(map.image, 0, 0, pw / 2, Math.round(ph / 2)); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 0, pw, ph); }) : null;
    return tmat('busband|' + key, () => litMat(map, emap, { rough: 0.3, ei: 1.1 }));
  }
  /** City bus, 11.6 x 2.55 x 3.1 m, doors on the kerb side (-X). o.route, o.dest (display text), o.color, o.trim. Interior lit when lights are on. */
  function bus(o = {}) {
    const S = CARS.bus, P = vctx(o, '#b93a2e'), c = chassis(S, P), { body } = c, hw = S.W / 2, zF = S.L / 2, zR = -zF, lit = P.lights > 0, cream = o.trim || (P.A ? '#a59f8f' : '#e9e3d2'), dk = P.dark, route = o.route || '42', dest = o.dest || 'RIVERSIDE';
    faces(c);
    body.add(box(S.W + 0.012, S.H - 1.28 + 0.012, S.L - 0.62, cream, { rough: 0.5 }).at(0, (S.H + 1.28) / 2 + 0.006, -0.06));
    const key = (lit ? 'L' : 'D') + (P.seed % 6);
    body.add(quad(10.5, 1.12, busBand('a' + key, 10.5, 1.12, lit, P.seed, [])).at(hw + 0.014, 1.92, -0.1).rot(0, PI / 2, 0));
    body.add(quad(10.5, 1.12, busBand('b' + key, 10.5, 1.12, lit, P.seed + 1, [4, 8])).at(-hw - 0.014, 1.92, -0.1).rot(0, -PI / 2, 0));
    // doors (kerb side): the lower leaves under panes 0 and 4 of the band
    const dm = lit ? mat('#e9d199', { emissive: '#f0d08a', ei: 0.9, rough: 0.4 }) : mat('#26333e', { rough: 0.2 });
    for (const z of [4.5, -0.14]) { body.add(box(0.012, 0.94, 1.06, dk).at(-hw - 0.008, 0.89, z)); for (const dzz of [-0.26, 0.26]) body.add(box(0.012, 0.8, 0.42, dm).at(-hw - 0.012, 0.9, z + dzz)); }
    // front: windscreen, destination display, mirrors, bumper
    body.add(quads([[[-1.14, 1.2, zF + 0.006], [1.14, 1.2, zF + 0.006], [1.14, 2.34, zF + 0.006], [-1.14, 2.34, zF + 0.006], gtile(P.gt())], [[1.0, 1.5, zR - 0.006], [-1.0, 1.5, zR - 0.006], [-1.0, 2.35, zR - 0.006], [1.0, 2.35, zR - 0.006], gtile(P.gt())]], vglassMat()));
    body.add(box(0.03, 1.14, 0.02, dk).at(0, 1.77, zF + 0.012), beam([-0.2, 1.24, zF + 0.016], [-0.85, 1.75, zF + 0.016], 0.02, 0.02, dk), beam([0.95, 1.24, zF + 0.016], [0.3, 1.75, zF + 0.016], 0.02, 0.02, dk));
    const dsp = tex('busdest|' + route + dest, 384, 56, cx => { cx.fillStyle = '#0a0b0c'; cx.fillRect(0, 0, 384, 56); cx.fillStyle = '#ffb21e'; cx.textBaseline = 'middle'; cx.font = '44px "VT323"'; cx.textAlign = 'left'; cx.fillText(route, 12, 30); cx.textAlign = 'right'; fit(cx, dest, 280, 44, 'VT323'); cx.fillText(dest, 372, 30); });
    const dmat = texMat(dsp, { emissive: true, ei: P.A ? 0 : 0.9 });
    body.add(box(2.0, 0.3, 0.03, dk).at(0, 2.5, zF - 0.012).rot(-0.06, 0, 0), quad(1.9, 0.26, dmat).at(0, 2.5, zF + 0.008).rot(-0.06, 0, 0));
    for (const sx of [-1, 1]) body.add(beam([sx * (hw - 0.05), 2.5, zF - 0.1], [sx * (hw + 0.2), 2.2, zF + 0.16], 0.035, 0.035, dk), box(0.06, 0.34, 0.16, dk).at(sx * (hw + 0.2), 2.02, zF + 0.16));
    body.add(box(S.W + 0.03, 0.26, 0.1, dk).at(0, 0.53, zF + 0.02), box(S.W + 0.03, 0.26, 0.1, dk).at(0, 0.53, zR - 0.02));
    // rear: engine grille and number
    body.add(decal(1.6, 0.6, 'busgrille', 128, 48, cx => { cx.fillStyle = '#1a1c1f'; cx.fillRect(0, 0, 128, 48); cx.fillStyle = '#0a0b0c'; for (let i = 0; i < 8; i++) cx.fillRect(6, 4 + i * 5.4, 116, 3); }, { opaque: true }).at(0, 1.02, zR - 0.008).rot(0, PI, 0));
    c.onLights = k => { dmat.emissiveIntensity = P.A ? 0 : 0.9 + 0.8 * k; };
    const g = finishVehicle(c); g.userData.display = dmat; return g;
  }
  /** Lorry (rigid truck), 8.4 x 2.5 x 3.7 m. o.load 'box' | 'flatbed' | 'tanker'; o.text on the box sides; o.color (cab), o.boxColor. userData.bed for loads. */
  function lorry(o = {}) {
    const P = vctx(o, '#2f5d8c'), load = o.load || 'box', W = 2.5, hw = W / 2, wr = 0.5, tw = 0.3, zF = 4.2, zR = -4.2, zc = 1.95, fy = 1.16, ar = 0.58, dk = P.dark;
    const S = { L: 8.4, W, wr, tw, sill: 0.5, ar, ax: [3.25, -2.3], hub: 'steel', top: [[zc, 0.5], [zc, 2.9], [zc + 0.16, 3.0], [3.9, 3.0], [4.1, 2.86], [zF, 1.6], [zF, 0.62], [4.12, 0.48]],
      head: [0.9, 0.84, 0.3, 0.16], tail: [0.98, 0.98, 0.3, 0.14], py: [0.6, 0.98], pz: [0.075, 0], belt: 1.7, flare: 1.5, grime: [1.98, 4.15, 1.1, 1.72], topGrime: load === 'box' ? [-4, 1.6, 2.2] : null };
    const g = grp(), body = grp().to(g), c = { g, body, P, S, wheels: [], steer: [], H: 3.0 };
    body.add(sideProfile(archProfile(S.top, S.sill, [3.25], ar, wr), W, P.col, P.po), box(W - 2 * tw - 0.12, 0.7, 2.0, '#0f1012', { rough: 1 }).at(0, 0.8, 3.1));
    // frame, tanks, mudguards, under-run bars
    for (const sx of [-1, 1]) body.add(box(0.14, 0.26, zc - zR - 0.1, dk).at(sx * 0.46, 0.92, (zc + zR) / 2), box(0.62, 0.06, 1.5, dk).at(sx * (hw - 0.32), 1.08, -2.3), box(0.04, 0.2, 2.1, '#4a4d52', { rough: 0.6 }).at(sx * (hw - 0.04), 0.62, -0.5), box(0.04, 0.36, 0.06, dk).at(sx * (hw - 0.06), 0.84, -1.3), box(0.04, 0.36, 0.06, dk).at(sx * (hw - 0.06), 0.84, 0.3));
    for (const z of [0.6, -0.5, -3.6]) body.add(box(1.06, 0.1, 0.1, dk).at(0, 0.9, z));
    const tank = cyl(0.3, 0.3, 1.1, 10, '#9aa0a5', { rough: 0.35, metal: 0.3 }); tank.geometry.rotateX(PI / 2); body.add(tank.at(-hw + 0.36, 0.72, 0.95), box(0.5, 0.5, 0.7, '#2a2c30').at(hw - 0.3, 0.74, 1.05));
    [[3.25, 1], [-2.3, 2]].forEach(([z, n], i) => [-1, 1].forEach(sx => { const piv = grp().at(sx * (hw - tw * n / 2 - 0.02), wr, z), w = wheel(wr, tw * n, 'steel'); piv.add(w); piv.userData.dyn = true; g.add(piv); c.wheels.push(w); if (!i) c.steer.push(piv); }));
    body.add(box(W - 0.3, 0.24, 0.1, dk).at(0, 0.66, zR + 0.05), box(W - 0.1, 0.2, 0.08, dk).at(0, 0.98, zR + 0.035));
    faces(c);
    // cab glass and trim
    const q = [[[-1.1, 1.72, 4.198], [1.1, 1.72, 4.198], [1.06, 2.74, 4.118], [-1.06, 2.74, 4.118], gtile(P.gt())]];
    for (const sx of [-1, 1]) q.push(sideQ(sx, hw + 0.006, [[2.35, 1.74], [3.9, 1.74], [3.84, 2.62], [2.35, 2.62]], gtile(P.gt())));
    body.add(quads(q, vglassMat()), box(2.0, 0.52, 0.03, '#131416').at(0, 1.2, zF + 0.004), box(W + 0.04, 0.3, 0.14, dk).at(0, 0.6, zF + 0.02));
    for (let i = 0; i < 4; i++) body.add(box(1.9, 0.02, 0.04, P.chrome).at(0, 1.02 + i * 0.12, zF + 0.006));
    body.add(beam([-0.15, 1.76, 4.21], [-0.8, 2.2, 4.176], 0.02, 0.02, dk), beam([0.85, 1.76, 4.21], [0.2, 2.2, 4.176], 0.02, 0.02, dk));
    for (const sx of [-1, 1]) {
      body.add(box(0.008, 1.9, 0.012, P.trim).at(sx * (hw + 0.001), 1.75, 2.22), box(0.008, 0.5, 0.012, P.trim).at(sx * (hw + 0.001), 1.42, 3.98), box(0.016, 0.03, 0.14, dk).at(sx * (hw + 0.005), 1.56, 2.4));
      body.add(box(0.1, 0.4, 0.07, dk).at(sx * (hw + 0.2), 2.2, 4.0), beam([sx * hw, 2.5, 3.96], [sx * (hw + 0.2), 2.4, 4.0], 0.03, 0.03, dk), beam([sx * hw, 1.9, 3.96], [sx * (hw + 0.2), 2.0, 4.0], 0.03, 0.03, dk));
    }
    if (load === 'box') {
      const bc = o.boxColor || (P.A ? '#a7a294' : '#e6e3da'), y0 = fy, y1 = 3.72, z0 = zR, z1 = zc - 0.14;
      body.add(box(W, y1 - y0, z1 - z0, bc, P.A ? { rough: 1, vary: 0.08, seed: P.seed } : { rough: 0.6 }).at(0, (y0 + y1) / 2, (z0 + z1) / 2));
      for (const y of [y0 + 0.03, y1 - 0.03]) for (const sx of [-1, 1]) body.add(box(0.03, 0.06, z1 - z0 + 0.02, '#8c9196', { rough: 0.4 }).at(sx * (hw + 0.002), y, (z0 + z1) / 2));
      body.add(decal(W - 0.2, y1 - y0 - 0.2, 'shutter', 128, 128, cx => { cx.fillStyle = '#cfccc2'; cx.fillRect(0, 0, 128, 128); for (let i = 0; i < 16; i++) { cx.fillStyle = 'rgba(0,0,0,0.22)'; cx.fillRect(0, i * 8 + 6, 128, 2); cx.fillStyle = 'rgba(255,255,255,0.3)'; cx.fillRect(0, i * 8, 128, 1.5); } cx.fillStyle = '#2a2c2f'; cx.fillRect(54, 112, 20, 6); }, { opaque: true }).at(0, (y0 + y1) / 2, z0 - 0.008).rot(0, PI, 0));
      if (o.text) for (const sx of [-1, 1]) body.add(decal(5.2, 1.5, 'lorry|' + o.text + '|' + o.textColor, 1024, 296, cx => { const ln = String(o.text).split('\n'); cx.fillStyle = o.textColor || '#b3312a'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; ln.forEach((t, i) => { fit(cx, t, 980, i ? 70 : ln.length > 1 ? 150 : 190, i ? 'Montserrat' : 'Anton', i ? '800' : ''); cx.fillText(t, 512, ln.length > 1 ? 100 + i * 130 : 150); }); }).at(sx * (hw + 0.008), 2.45, (z0 + z1) / 2).rot(0, sx * PI / 2, 0));
      body.add(taper(3.0, 1.1, 2.3, 3.8, 3.4, 1.0, 2.3, 3.2, P.col, P.po)); c.H = y1;
    } else if (load === 'tanker') {
      const tk = cyl(1.15, 1.15, 5.7, 12, o.boxColor || (P.A ? '#8f8b80' : '#c9ced2'), { rough: 0.3, metal: 0.25 }); tk.geometry.rotateX(PI / 2); body.add(tk.at(0, fy + 1.2, -1.25));
      for (const z of [-3.6, -1.25, 1.1]) body.add(box(1.5, 0.3, 0.5, dk).at(0, fy + 0.12, z)); for (const z of [-2.4, -0.1]) body.add(cylB(0.3, 0.3, 0.12, 8, dk).at(0, fy + 2.34, z));
      body.add(box(W - 0.3, 0.06, 5.9, dk).at(0, fy, -1.25), box(0.7, 0.04, 5.4, '#6b7075').at(0, fy + 2.36, -1.25)); c.H = fy + 2.5;
    } else {
      body.add(box(W, 0.12, zc - 0.14 - zR, '#5a4630', { vary: 0.08, rough: 1 }).at(0, fy + 0.06, (zR + zc - 0.14) / 2), box(W, 1.3, 0.1, P.col, P.po).at(0, fy + 0.65, zc - 0.2));
      for (const sx of [-1, 1]) body.add(box(0.06, 0.34, zc - 0.3 - zR, P.col, P.po).at(sx * (hw - 0.03), fy + 0.29, (zR + zc - 0.3) / 2));
      body.add(box(W, 0.34, 0.06, P.col, P.po).at(0, fy + 0.29, zR + 0.03));
    }
    const gg = finishVehicle(c); gg.userData.bed = { y: fy + 0.12, z0: zR + 0.06, z1: zc - 0.3, w: W - 0.12 }; return gg;
  }
  /** Motorbike, 2.1 m long. o.color, o.lean (radians onto its side stand; default 0 = upright). userData.wheels, steer, seatPos, drive(dist, steer), setLights(k). */
  function motorbike(o = {}) {
    const P = vctx(o, ['#1d1f23', '#a8342c', '#2f5d8c', '#3d6a56', '#c2632e'][(o.seed ?? 1) % 5]), g = grp(), body = grp().to(g), wr = 0.31, zf = 0.74, zr = -0.7, dk = P.dark, steel = mat('#5d6368', { rough: 0.5, metal: 0.3 }), ch = P.chrome;
    const S = { L: 2.1, W: 0.78, wr, flare: 0.9 }, lm = { head: lamp('#e6eaec', '#fff0cc'), tail: lamp('#74120f', '#ff2a16'), indL: lamp('#b9691c', '#ffa416'), indR: lamp('#b9691c', '#ffa416') };
    const mk = (w) => { const m = wheel(wr, w, 'black', 14); m.userData.r = wr; return m; };
    const fork = grp().at(0, 0, 0.5), fw = mk(0.11), rw = mk(0.15), fp = grp().at(0, wr, zf - 0.5), rp = grp().at(0, wr, zr); fp.add(fw); rp.add(rw); rp.userData.dyn = true; g.add(rp);
    // fork assembly (steers about a vertical axis through the headstock)
    for (const sx of [-1, 1]) fork.add(beam([sx * 0.085, wr, zf - 0.5], [sx * 0.085, 1.0, 0.02], 0.04, 0.045, ch), box(0.03, 0.05, 0.12, lm[sx > 0 ? 'indL' : 'indR']).at(sx * 0.2, 0.9, 0.1), box(0.1, 0.035, 0.035, dk).at(sx * 0.37, 1.08, -0.06));
    fork.add(box(0.24, 0.04, 0.1, dk).at(0, 0.98, 0.02), box(0.24, 0.04, 0.1, dk).at(0, 0.8, 0.09), beam([-0.34, 1.08, -0.06], [0.34, 1.08, -0.06], 0.03, 0.03, ch), box(0.13, 0.03, 0.46, P.col, P.po).at(0, wr + 0.345, zf - 0.5).rot(0.08, 0, 0));
    const hl = cyl(0.095, 0.075, 0.13, 8, ch); hl.geometry.rotateX(PI / 2); fork.add(hl.at(0, 0.9, 0.16), new T.Mesh(new T.CircleGeometry(0.082, 8), lm.head).at(0, 0.9, 0.227), box(0.2, 0.1, 0.04, dk).at(0, 1.02, 0.1));
    for (const sx of [-1, 1]) fork.add(beam([sx * 0.3, 1.08, -0.06], [sx * 0.36, 1.24, -0.02], 0.014, 0.014, dk), box(0.1, 0.06, 0.012, dk).at(sx * 0.38, 1.26, -0.02));
    fp.userData.dyn = true; fork.add(fp); fork.userData.dyn = true; g.add(fork);
    // frame, engine, tank, seat, tail
    body.add(box(0.3, 0.32, 0.44, '#33363a', { rough: 0.6 }).at(0, 0.46, 0.02), box(0.26, 0.24, 0.3, steel).at(0, 0.7, 0.1).rot(0.25, 0, 0), box(0.34, 0.03, 0.34, '#8d9399', { rough: 0.4 }).at(0, 0.62, 0.1).rot(0.25, 0, 0), box(0.34, 0.03, 0.3, '#8d9399', { rough: 0.4 }).at(0, 0.72, 0.13).rot(0.25, 0, 0));
    body.add(taper(0.8, 0.17, -0.12, 0.42, 0.99, 0.12, -0.06, 0.34, P.col, P.po), taper(0.76, 0.16, -0.72, -0.1, 0.88, 0.13, -0.7, -0.14, '#1a1b1e', { rough: 0.95 }), taper(0.7, 0.12, -1.0, -0.6, 0.8, 0.1, -1.02, -0.62, P.col, P.po));
    body.add(beam([0, 0.98, 0.44], [0, 0.34, 0.3], 0.05, 0.05, dk), beam([0, 0.8, 0.4], [0, 0.78, -0.6], 0.06, 0.05, dk), box(0.16, 0.04, 0.34, dk).at(0, 0.665, zr).rot(-0.1, 0, 0));
    for (const sx of [-1, 1]) body.add(beam([sx * 0.1, 0.42, -0.14], [sx * 0.1, wr, zr], 0.04, 0.06, steel), beam([sx * 0.13, wr + 0.04, zr + 0.04], [sx * 0.13, 0.76, -0.46], 0.035, 0.035, ch), box(0.03, 0.05, 0.1, lm[sx > 0 ? 'indL' : 'indR']).at(sx * 0.16, 0.74, -0.96), box(0.1, 0.03, 0.14, dk).at(sx * 0.19, 0.36, -0.12));
    body.add(tube([[-0.17, 0.5, 0.26], [-0.2, 0.34, 0.1], [-0.2, 0.33, -0.3], [-0.22, 0.42, -0.95]], 0.045, ch, { seg: 8, rs: 6 }), box(0.14, 0.06, 0.03, lm.tail).at(0, 0.76, -1.03), quad(0.2, 0.12, plateMat(P.seed)).at(0, 0.62, -1.04).rot(0.2, PI, 0));
    body.add(beam([0.12, 0.34, -0.1], [0.26, 0.06, -0.2], 0.025, 0.025, dk));                    // side stand
    const lean = P.A ? 1.3 : o.lean === true ? 0.2 : +o.lean || 0; if (lean) { g.rotation.z = -lean; fork.rotation.y = 0.45; if (P.A) g.position.y = 0.09; }
    const wrap = grp(g), c = { g: wrap, body, P, S, lm, wheels: [fw, rw], steer: [fork], head: [[0, 0.9, 0.73]], tail: [[0, 0.76, -1.03]], H: 1.3, seatPos: [[0, 0.88, -0.32], [0, 0.9, -0.62]] };
    bake(fork); const out = finishVehicle(c); out.userData.lean = lean; return out;
  }
  /** Bicycle, 1.75 m long. o.color, o.basket, o.lean. userData.wheels, crank, steer, seatPos, drive(dist, steer). */
  function bicycle(o = {}) {
    const col = o.color || ['#c2413a', '#2f6f8f', '#3d6a56', '#d8b03a', '#e4e1d8', '#24272c'][(o.seed ?? 1) % 6], g = grp(), body = grp().to(g), wr = 0.34, zf = 0.53, zr = -0.52, dk = mat('#1b1d20', { rough: 0.8 }), st = mat('#b9bec3', { rough: 0.35, metal: 0.3 }), tb = 0.03, po = { rough: 0.45, metal: 0.1 };
    const spokes = tmat('spokes', () => texMat(tex('spokes', 128, 128, c => { c.clearRect(0, 0, 128, 128); c.translate(64, 64); c.strokeStyle = 'rgba(190,196,200,0.9)'; c.lineWidth = 1.1; for (let i = 0; i < 16; i++) { const a = i * TAU / 16; c.beginPath(); c.moveTo(Math.cos(a + 0.5) * 6, Math.sin(a + 0.5) * 6); c.lineTo(Math.cos(a) * 60, Math.sin(a) * 60); c.stroke(); } c.strokeStyle = '#c9ced2'; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, 59, 0, TAU); c.stroke(); c.fillStyle = '#8d9399'; c.beginPath(); c.arc(0, 0, 7, 0, TAU); c.fill(); }), { transparent: true, side: 'double', rough: 0.5 }));
    const mkWheel = () => { const w = grp(), t = torus(wr - 0.02, 0.02, '#17181b', { rs: 4, ts: 14, rough: 0.95 }); t.geometry.rotateY(PI / 2); const s = quad(wr * 2 - 0.06, wr * 2 - 0.06, spokes); s.geometry.rotateY(PI / 2); s.castShadow = false; w.add(t, s); w.userData.r = wr; return w; };
    const BB = [0, 0.3, -0.03], SC = [0, 0.82, -0.2], HT = [0, 0.88, 0.36], HB = [0, 0.74, 0.4], RA = [0, wr, zr], FA = [0, wr, zf];
    const fw = mkWheel(), rw = mkWheel(), rp = grp().at(0, wr, zr), fork = grp().at(0, 0, 0.38), fp = grp().at(0, wr, zf - 0.38); rp.add(rw); fp.add(fw); rp.userData.dyn = true; g.add(rp);
    const T2 = (a, b, t = tb, cc = col, oo = po) => beam(a, b, t, t, cc, oo);
    body.add(T2(BB, [0, 0.9, -0.225]), T2(SC, HT), T2(BB, HB, 0.036), T2(HB, HT, 0.04));
    for (const sx of [-1, 1]) body.add(T2([sx * 0.02, BB[1], BB[2]], [sx * 0.06, RA[1], RA[2]], 0.02), T2([sx * 0.02, SC[1], SC[2]], [sx * 0.06, RA[1], RA[2]], 0.018));
    body.add(beam([0, 0.9, -0.225], [0, 0.97, -0.25], 0.022, 0.022, st), taper(0.96, 0.07, -0.38, -0.1, 0.99, 0.055, -0.37, -0.12, '#1a1b1e', { rough: 0.9 }), box(0.012, 0.02, 0.5, '#3a3d42').at(-0.05, 0.31, -0.28));
    for (const sx of [-1, 1]) fork.add(T2([sx * 0.02, HB[1], 0.02], [sx * 0.055, FA[1], zf - 0.38], 0.022));
    fork.add(beam([0, HT[1], -0.02], [0, 1.0, -0.04], 0.024, 0.024, st), beam([-0.27, 1.0, -0.04], [0.27, 1.0, -0.04], 0.022, 0.022, st), box(0.1, 0.032, 0.032, dk).at(0.24, 1.0, -0.04), box(0.1, 0.032, 0.032, dk).at(-0.24, 1.0, -0.04));
    if (o.basket) fork.add(box(0.34, 0.2, 0.24, '#a8814f', { vary: 0.12, rough: 1 }).at(0, 0.98, 0.16), box(0.3, 0.02, 0.2, '#6d5230').at(0, 0.875, 0.16));
    fp.userData.dyn = true; fork.add(fp); fork.userData.dyn = true; g.add(fork);
    const crank = grp().at(BB[0], BB[1], BB[2]), ring = cyl(0.09, 0.09, 0.008, 12, st); ring.geometry.rotateZ(PI / 2); crank.add(ring.at(-0.05, 0, 0));
    for (const sx of [-1, 1]) crank.add(box(0.014, 0.17, 0.024, st).at(sx * 0.075, sx * 0.085, 0), box(0.09, 0.02, 0.06, dk).at(sx * 0.125, sx * 0.17, 0));
    body.add(dyn(crank));
    if (o.rack !== false) body.add(box(0.12, 0.012, 0.36, st).at(0, 0.72, -0.56), beam([0.05, 0.72, -0.7], [0.06, wr, zr], 0.012, 0.012, st), beam([-0.05, 0.72, -0.7], [-0.06, wr, zr], 0.012, 0.012, st));
    body.add(beam([-0.04, 0.3, -0.12], [-0.2, 0.02, -0.2], 0.014, 0.014, st));
    const lean = o.lean === true ? 0.16 : +o.lean || 0; if (lean) { g.rotation.z = lean; fork.rotation.y = -0.5; }
    bake(body); bake(fork); body.userData.dyn = true;
    const out = grp(g), U = out.userData; U.kind = 'vehicle'; U.wheels = [fw, rw]; U.steer = [fork]; U.crank = crank; U.wheelR = wr; U.size = [0.56, 1.02, 1.75]; U.seatPos = [[0, 0.99, -0.24]]; U.lean = lean;
    U.drive = (dist = 0, steerAngle = 0) => { fw.rotation.x = rw.rotation.x = dist / wr; crank.rotation.x = dist / wr / 2.6; fork.rotation.y = steerAngle; return out; };
    return out;
  }
  // ==== END BUILDERS ====
  return {
    // utilities
    mix, shade, bake, wheel,
    // vehicles
    saloon, hatchback, suv, pickup, van, bus, lorry, taxi, policeCar, ambulance, motorbike, bicycle,
  };
})();
