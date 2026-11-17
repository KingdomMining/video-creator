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

  // =====================================================================================================
  // vehicles
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
    else { c.fillStyle = 'rgba(96,86,68,0.4)'; c.fillRect(0, 0, 256, 128); }
    for (let i = 0; i < (v ? 22 : 12); i++) {
      const x = r() * 256, y = 14 + r() * 110, s = 5 + r() * 16, rust = r() < 0.6;
      c.fillStyle = rust ? `rgba(${118 + r() * 40 | 0},${56 + r() * 22 | 0},${24 + r() * 12 | 0},${0.5 + r() * 0.4})` : `rgba(52,46,38,${0.3 + r() * 0.3})`;
      for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x + (r() - 0.5) * s * 1.6, y + (r() - 0.5) * s, s * (0.35 + r() * 0.5), 0, TAU); c.fill(); }
      if (!v && rust) { c.fillRect(x - 1, y, 2 + r() * 2, 10 + r() * 30); }
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
      head: [0.62, 0.64, 0.4, 0.12], grille: [0.64, 0.74, 0.1], tail: [0.63, 0.74, 0.44, 0.13], seams: [0.9, -0.26, -0.9], handles: [-0.08, -0.74], hy: 0.87, mirror: [0.7, 1.03] },
    hatchback: { L: 3.96, W: 1.74, wr: 0.31, tw: 0.2, ax: [1.2, -1.28], sill: 0.2,
      top: [[-1.92, 0.27], [-1.98, 0.37], [-1.98, 0.9], [-1.94, 0.985], [0.7, 0.985], [1.62, 0.9], [1.9, 0.8], [1.98, 0.73], [1.98, 0.37], [1.91, 0.26]],
      cab: { yb: 0.985, yt: 1.46, wb: 0.81, wt: 0.65, zb: [-1.94, 0.7], zt: [-1.6, 0.03] }, pil: [[-0.3, -0.34], [-1.22, -1.24]],
      head: [0.6, 0.66, 0.36, 0.13], grille: [0.66, 0.64, 0.09], tail: [0.69, 0.78, 0.26, 0.2], seams: [0.78, -0.3, -0.88], handles: [-0.14, -0.74], hy: 0.88, mirror: [0.58, 1.04] },
    suv: { L: 4.76, W: 1.92, wr: 0.385, tw: 0.25, ax: [1.47, -1.4], sill: 0.3, ar: 0.46,
      top: [[-2.31, 0.38], [-2.38, 0.48], [-2.38, 1.06], [-2.34, 1.16], [0.86, 1.16], [1.98, 1.07], [2.3, 0.98], [2.38, 0.9], [2.38, 0.48], [2.31, 0.36]],
      cab: { yb: 1.16, yt: 1.72, wb: 0.9, wt: 0.75, zb: [-2.34, 0.86], zt: [-2.12, 0.22] }, pil: [[-0.18, -0.2], [-1.2, -1.2]],
      head: [0.68, 0.84, 0.4, 0.13], grille: [0.84, 0.8, 0.16], tail: [0.76, 0.96, 0.24, 0.2], seams: [0.94, -0.18, -0.9], handles: [0, -0.72], hy: 1.04, mirror: [0.74, 1.24] },
    pickup: { L: 5.36, W: 1.96, wr: 0.4, tw: 0.26, ax: [1.74, -1.56], sill: 0.34, ar: 0.48,
      top: [[-2.61, 0.42], [-2.68, 0.52], [-2.68, 0.92], [-0.56, 0.92], [-0.56, 1.2], [0.94, 1.2], [2.16, 1.12], [2.58, 1.03], [2.68, 0.95], [2.68, 0.52], [2.6, 0.4]],
      cab: { yb: 1.2, yt: 1.8, wb: 0.92, wt: 0.79, zb: [-0.56, 0.94], zt: [-0.46, 0.38] }, pil: [],
      head: [0.72, 0.88, 0.36, 0.16], grille: [0.88, 0.94, 0.2], tail: [0.89, 0.72, 0.12, 0.3], seams: [1.0, -0.5], handles: [-0.36], hy: 1.08, mirror: [0.8, 1.3] },
  };

  /** Lower body, greenhouse, wheels, lights and trim of a passenger car from a spec. Returns the parts; finishVehicle() completes it. */
  function carBody(S, o = {}, defCol) {
    const P = vctx(o, defCol), g = grp(), body = grp().to(g), { L, W, wr, tw } = S, hw = W / 2, zF = L / 2, zR = -L / 2, ar = S.ar || wr + 0.065, dk = P.dark;
    body.add(sideProfile(archProfile(S.top, S.sill, S.ax, ar, wr), W, P.col, P.po));
    body.add(box(W - 2 * tw - 0.12, wr + ar - S.sill + 0.02, L - 0.3, '#0f1012', { rough: 1 }).at(0, (S.sill - 0.04 + wr + ar - 0.02) / 2, 0));
    const zs0 = S.ax[S.ax.length - 1] + ar + 0.02, zs1 = S.ax[0] - ar - 0.02;
    for (const sx of [-1, 1]) body.add(box(0.02, S.clad || 0.07, zs1 - zs0, dk).at(sx * (hw + 0.002), S.sill + (S.clad || 0.07) / 2, (zs0 + zs1) / 2));
    // wheels
    const wheels = [], steer = [];
    S.ax.forEach((z, i) => [-1, 1].forEach(sx => { const piv = grp().at(sx * (hw - tw / 2 - 0.015), wr, z), w = wheel(wr, tw, S.hub || 'alloy'); piv.add(w); piv.userData.dyn = true; g.add(piv); wheels.push(w); if (i === 0) steer.push(piv); }));
    // greenhouse: glass block, roof, pillars
    const c = S.cab, { yb, yt, wb, wt } = c, [zb0, zb1] = c.zb, [zt0, zt1] = c.zt;
    const B = [[-wb, yb, zb0], [wb, yb, zb0], [wb, yb, zb1], [-wb, yb, zb1]], R = [[-wt, yt, zt0], [wt, yt, zt0], [wt, yt, zt1], [-wt, yt, zt1]];
    const clear = !!o.interior, gm = clear ? mat('#a9c7d6', { opacity: 0.3, rough: 0.1 }) : vglassMat(), gq = (a, b, c2, d) => [a, b, c2, d, gtile(P.gt())];
    body.add(quads([gq(B[1], B[0], R[0], R[1]), gq(B[3], B[2], R[2], R[3]), gq(B[0], B[3], R[3], R[0]), gq(B[2], B[1], R[1], R[2])], gm));
    body.add(taper(yt - 0.004, wt + 0.014, zt0 - 0.03, zt1 + 0.04, yt + 0.036, wt - 0.03, zt0 + 0.06, zt1 - 0.06, P.col, P.po));
    for (const sx of [-1, 1]) {
      const e = 0.006 * sx;
      body.add(beam([sx * wb + e, yb, zb1], [sx * wt + e, yt, zt1], 0.055, 0.055, P.col, P.po), beam([sx * wb + e, yb, zb0], [sx * wt + e, yt, zt0], 0.06, 0.06, P.col, P.po));
      for (const [pb, pt] of S.pil) body.add(beam([sx * wb + e, yb, pb], [sx * wt + e, yt, pt], 0.03, 0.075, dk));
      body.add(box(0.014, 0.022, zb1 - zb0, P.chrome).at(sx * (wb + 0.004), yb + 0.012, (zb0 + zb1) / 2));
      // side trim: door seams, handles, mirror
      for (const z of S.seams) body.add(box(0.008, yb - S.sill - 0.08, 0.012, P.trim).at(sx * (hw + 0.001), (yb + S.sill + 0.08) / 2, z));
      for (const z of S.handles) body.add(box(0.016, 0.028, 0.13, P.chrome).at(sx * (hw + 0.005), S.hy, z));
      body.add(box(0.15, 0.095, 0.06, P.col, P.po).at(sx * (wb + 0.12), S.mirror[1], S.mirror[0]), box(0.07, 0.03, 0.04, dk).at(sx * (wb + 0.03), S.mirror[1] - 0.03, S.mirror[0]));
    }
    body.add(box(wb * 2 - 0.04, 0.03, 0.07, dk).at(0, yb + 0.012, zb1 + 0.02));
    if (clear) cabin(body, S, P);
    // lights, grille, plates
    const lm = { head: lamp('#e6eaec', '#fff0cc'), tail: lamp('#74120f', '#ff2a16'), indL: lamp('#b9691c', '#ffa416'), indR: lamp('#b9691c', '#ffa416') };
    const [hx, hy, hwd, hh] = S.head, [tx, ty, twd, th] = S.tail, [gy, gw, gh] = S.grille;
    for (const sx of [-1, 1]) {
      const ind = sx > 0 ? lm.indL : lm.indR;
      body.add(box(hwd, hh, 0.04, lm.head).at(sx * hx, hy, zF + 0.004), box(0.06, hh, 0.045, ind).at(sx * (hx + hwd / 2 + 0.035), hy, zF + 0.002));
      body.add(box(twd, th, 0.04, lm.tail).at(sx * tx, ty, zR - 0.004), box(0.06, th, 0.045, ind).at(sx * (tx - twd / 2 - 0.035), ty, zR - 0.002));
      body.add(box(0.12, 0.05, 0.03, dk).at(sx * (hw - 0.2), S.sill + 0.21, zF + 0.004));
    }
    body.add(box(gw, gh, 0.03, '#131416', { rough: 0.6 }).at(0, gy, zF + 0.004), box(gw * 0.92, 0.014, 0.036, P.chrome).at(0, gy, zF + 0.004));
    body.add(box(W * 0.58, 0.075, 0.03, dk).at(0, S.sill + 0.21, zF + 0.004), box(W * 0.74, 0.06, 0.03, dk).at(0, S.sill + 0.2, zR - 0.004));
    const pm = plateMat(P.seed), py = Math.min(hy - hh / 2 - 0.085, S.sill + 0.34);
    body.add(quad(0.44, 0.11, pm).at(0, py, zF + 0.022), quad(0.44, 0.11, pm).at(0, ty - th / 2 - 0.1, zR - 0.01).rot(0, PI, 0));
    const ex = cyl(0.028, 0.028, 0.14, 6, P.chrome); ex.geometry.rotateX(PI / 2); body.add(ex.at(-hw + 0.38, S.sill + 0.05, zR + 0.05));
    return { g, body, P, S, lm, wheels, steer, head: [[hx, hy, zF], [-hx, hy, zF]], tail: [[tx, ty, zR], [-tx, ty, zR]], H: yt + 0.036 };
  }
  /** Seats, dashboard and steering wheel seen through clear glass (o.interior). The driver sits on +X. */
  function cabin(body, S, P) {
    const c = S.cab, { yb, yt, wb } = c, [zb0, zb1] = c.zb, seat = mat('#2a2d33', { rough: 0.95 }), rows = S.rows || [zb1 - 0.95, zb0 + 0.62];
    body.add(box(wb * 2 - 0.02, 0.01, zb1 - zb0 - 0.02, '#0c0d0f', { rough: 1 }).at(0, yb + 0.004, (zb0 + zb1) / 2));
    rows.forEach((z, i) => { for (const sx of i ? [0] : [-1, 1]) { const w = i ? wb * 1.7 : 0.48; body.add(box(w, 0.36, 0.1, seat).at(sx * 0.4, yb + 0.14, z - 0.2).rot(-0.14, 0, 0)); for (const hx of i ? [-0.42, 0.42] : [0]) body.add(box(0.24, 0.16, 0.09, seat).at(sx * 0.4 + hx, yb + 0.37, z - 0.24)); } });
    body.add(box(wb * 2 - 0.06, 0.1, 0.24, '#17191c', { rough: 0.9 }).at(0, yb + 0.03, zb1 - 0.14));
    const sw = torus(0.17, 0.018, '#111214', { rs: 4, ts: 10 }); body.add(sw.at(0.4, yb + 0.12, zb1 - 0.36).rot(-1.1, 0, 0));
    body.userData.seatPos = [[0.4, yb - 0.5, rows[0] - 0.08], [-0.4, yb - 0.5, rows[0] - 0.08]];
  }
  /** Complete a vehicle: damage, merge, and the userData controls shared by every vehicle. */
  function finishVehicle(c) {
    const { g, body, P, S, lm } = c, U = g.userData, A = P.A, hw = S.W / 2;
    const fl = { head: c.head.map(p => flare('#fff1cf', S.flare || 1.25, 0.62).at(p[0], p[1], p[2] + 0.05).to(g)), tail: c.tail.map(p => flare('#ff3a22', 0.55, 0.55).at(p[0], p[1], p[2] - 0.05).to(g)) };
    if (A) {
      const zs0 = S.ax[S.ax.length - 1] + (S.ar || S.wr + 0.065) + 0.06, zs1 = S.ax[0] - (S.ar || S.wr + 0.065) - 0.06, yb = S.cab ? S.cab.yb : S.belt || 1;
      for (const sx of [-1, 1]) { const q = quad(zs1 - zs0, yb - S.sill - 0.02, grimeMat(0)); q.castShadow = false; body.add(q.at(sx * (hw + 0.01), (yb + S.sill) / 2, (zs0 + zs1) / 2).rot(0, sx * PI / 2, 0)); }
      if (S.cab) { const t = plane(S.cab.wt * 2 - 0.1, S.cab.zt[1] - S.cab.zt[0] - 0.1, grimeMat(1)); t.castShadow = false; body.add(t.at(0, c.H + 0.004, (S.cab.zt[0] + S.cab.zt[1]) / 2)); }
      const fi = Math.floor(P.r() * c.wheels.length), fw = c.wheels[fi].parent, sx = Math.sign(fw.position.x), sz = Math.sign(fw.position.z) || 1;
      fw.position.y = S.wr * 0.8; fw.scale.set(1, 0.8, 1.06); fw.rotation.x = 0.4;
      body.rotation.z = sx * -0.034 * A; body.rotation.x = sz * 0.014 * A; body.position.y = -0.012;
      c.wheels.forEach((w, i) => { w.rotation.x = P.r() * TAU; if (i !== fi && P.r() < 0.5) c.wheels[i].parent.rotation.y = (P.r() - 0.5) * 0.5 * (i < 2 ? 1 : 0); });
    }
    bake(body); c.wheels.forEach(bake);
    const st = { on: 0, brake: 0 };
    const apply = () => { lm.head.emissiveIntensity = 3.2 * st.on; lm.tail.emissiveIntensity = 1.4 * st.on + 3.4 * st.brake; fl.head.forEach(f => { f.visible = st.on > 0.02; f.material.opacity = 0.62 * st.on; }); fl.tail.forEach(f => { f.visible = st.on + st.brake > 0.02; f.material.opacity = Math.min(0.85, 0.4 * st.on + 0.5 * st.brake); }); };
    U.kind = 'vehicle'; U.body = body; U.wheels = c.wheels; U.steer = c.steer; U.wheelR = S.wr; U.size = [S.W, c.H, S.L]; U.lamps = lm; U.flares = fl;
    U.headlightPos = c.head; U.taillightPos = c.tail; if (body.userData.seatPos) U.seatPos = body.userData.seatPos;
    /** Roll the wheels for a travelled distance (metres) and turn the front wheels (radians). */
    U.drive = (dist = 0, steerAngle = 0) => { for (const w of c.wheels) w.rotation.x = dist / S.wr; for (const p of c.steer) p.rotation.y = steerAngle; return g; };
    /** Headlights and tail lights, 0..1. */
    U.setLights = (k = 1) => { st.on = A ? 0 : +k; apply(); return g; };
    /** Brake lights, 0..1. */
    U.brake = (k = 1) => { st.brake = A ? 0 : +k; apply(); return g; };
    /** Indicators: side 'L' | 'R' | 'both', on = true/false (blink it yourself from time, or use hazard(t)). */
    U.indicate = (side, on) => { const e = on && !A ? 3.5 : 0; if (side !== 'R') lm.indL.emissiveIntensity = e; if (side !== 'L') lm.indR.emissiveIntensity = e; return g; };
    U.hazard = t => U.indicate('both', t != null && mod(t * 1.4, 1) < 0.5);
    apply(); U.setLights(P.lights);
    return g;
  }
  const saloon = (o = {}) => finishVehicle(carBody(CARS.saloon, o));
  const hatchback = (o = {}) => finishVehicle(carBody(CARS.hatchback, o, CAR_COLS[((o.seed ?? 1) + 5) % CAR_COLS.length]));

  // ==== END BUILDERS ====
  return { mix, shade, bake, wheel, saloon, hatchback };
})();
