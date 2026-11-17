// kit/nature.js - outdoor natural environments for the low-poly 3D stage. Exports one global: KitNature.
// Every builder is name(o = {}) and returns a THREE.Group at real scale (metres), standing on y = 0, centred on
// its footprint, front toward +Z. Deterministic: all variation comes from o.seed (no Math.random, no Date).
// Anything that moves is a pure function of time through a helper on group.userData (sway, animate, open ...).
// Reference with every option: docs/kit/nature.md
const KitNature = (() => {
  const T = THREE, PI = Math.PI, TAU = Math.PI * 2;
  const sin = Math.sin, cos = Math.cos, hyp = Math.hypot, flr = Math.floor;
  const sm = S3.smooth, n1 = S3.noise1, n2 = S3.noise2;

  // ---------- colours ----------
  const _cc = new Map();
  /** Cached THREE.Color from a hex string (never mutate the result: clone it). */
  const C = h => { if (h && h.isColor) return h; let c = _cc.get(h); if (!c) { c = new T.Color(h); _cc.set(h, c); } return c; };
  const mixC = (a, b, k) => C(a).clone().lerp(C(b), k);
  const pick = (list, r) => { const a = [].concat(list); return a[flr(r() * a.length) % a.length]; };
  const _hsl = { h: 0, s: 0, l: 0 };
  /** A new colour: `base` with random brightness (vary) and hue (hue) offsets, times `unit`. */
  const tone = (base, vary, hue, r, unit = 1) => {
    const c = C(base).clone();
    if (hue) { c.getHSL(_hsl); c.setHSL(_hsl.h + (r() - 0.5) * 2 * hue, _hsl.s, _hsl.l); }
    return c.multiplyScalar((vary ? 1 + (r() - 0.5) * 2 * vary : 1) * unit);
  };

  // ---------- vectors as [x, y, z] ----------
  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vnorm = a => { const l = hyp(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vlerp = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const fnorm = (a, b, c) => vnorm(vcross(vsub(b, a), vsub(c, a)));
  const polar = (a, d, y = 0) => [sin(a) * d, y, cos(a) * d];          // angle 0 = +Z, grows toward +X

  const _e = new T.Euler(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _v1 = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3(), _m4 = new T.Matrix4();
  /** Matrix from {at:[x,y,z], rot:[x,y,z], scl: k | [x,y,z]} or null when there is nothing to do. */
  function xform(o) {
    if (!o || (!o.at && !o.rot && o.scl == null)) return null;
    const s = o.scl == null ? [1, 1, 1] : Array.isArray(o.scl) ? o.scl : [o.scl, o.scl, o.scl], a = o.at || [0, 0, 0], e = o.rot || [0, 0, 0];
    _e.set(e[0], e[1], e[2], o.order || 'XYZ'); _q.setFromEuler(_e);
    return new T.Matrix4().compose(_v1.set(a[0], a[1], a[2]), _q, _v2.set(s[0], s[1], s[2]));
  }
  const xpt = (M, p) => { const e = M.elements, x = p[0], y = p[1], z = p[2]; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; };

  // ---------- materials (shared, never mutated) ----------
  const MAT = () => S3.mat('#ffffff', { vc: true });                       // matte, vertex-coloured
  const MAT2 = () => S3.mat('#ffffff', { vc: true, side: 'double' });      // leaves, cloth, blades
  let _far = null, _decal = null;
  /** Lit, vertex-coloured, NOT fogged: backdrops that must stay visible beyond the fog (mountains, clouds). */
  const MATFAR = () => _far || (_far = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, fog: false }));
  /** Ground overlays (paths, shores): pulled toward the camera in depth so they never z-fight the ground. */
  const MATDECAL = () => _decal || (_decal = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));

  // ---------- triangle soup: everything is merged into few vertex-coloured meshes ----------
  class Soup {
    constructor(seed = 1) { this.p = []; this.c = []; this.uv = null; this.r = rng(seed * 7919 + 17); }
    get tris() { return this.p.length / 9; }
    tri(a, b, c, k) { this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); this.c.push(k.r, k.g, k.b, k.r, k.g, k.b, k.r, k.g, k.b); return this; }
    quad(a, b, c, d, k) { return this.tri(a, b, c, k).tri(a, c, d, k); }
    /** A colour for one face: base with this soup's random variation. */
    sh(base, vary = 0, hue = 0, unit = 1) { return tone(base, vary, hue, this.r, unit); }
    /** Ingest a THREE geometry. o: {at, rot, scl, vary (per flat face), hue, shift (whole piece)}. Coplanar neighbours share a shade. */
    geo(g, color, o = {}) {
      const src = g.index ? g.toNonIndexed() : g, A = src.attributes.position.array, M = xform(o), r = this.r;
      const unit = o.shift ? 1 + (r() - 0.5) * 2 * o.shift : 1, flip = M ? M.determinant() < 0 : false;
      let pn = null, k = null;
      for (let i = 0; i < A.length; i += 9) {
        let a = [A[i], A[i + 1], A[i + 2]], b = [A[i + 3], A[i + 4], A[i + 5]], c = [A[i + 6], A[i + 7], A[i + 8]];
        if (M) { a = xpt(M, a); b = xpt(M, b); c = xpt(M, c); }
        if (flip) { const t = b; b = c; c = t; }
        const n = fnorm(a, b, c);
        if (!pn || vdot(n, pn) < 0.9995) k = tone(color, o.vary ?? 0, o.hue || 0, r, unit);
        pn = n; this.tri(a, b, c, k);
      }
      if (src !== g) src.dispose(); g.dispose(); return this;
    }
    box(w, h, d, color, o) { return this.geo(new T.BoxGeometry(w, h, d), color, o); }
    boxB(w, h, d, color, o) { return this.geo(new T.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, o); }
    cyl(rt, rb, h, n, color, o) { return this.geo(new T.CylinderGeometry(rt, rb, h, n || 6), color, o); }
    cylB(rt, rb, h, n, color, o) { return this.geo(new T.CylinderGeometry(rt, rb, h, n || 6).translate(0, h / 2, 0), color, o); }
    coneB(r, h, n, color, o) { return this.geo(new T.ConeGeometry(r, h, n || 6).translate(0, h / 2, 0), color, o); }
    ico(r, color, detail = 0, o) { return this.geo(new T.IcosahedronGeometry(r, detail), color, o); }
    /** Lumpy ball. o: {at, squash:[x,y,z], bump, detail, vary, hue}. */
    blob(r, color, seed, o = {}) {
      const g = o.octa ? new T.OctahedronGeometry(r, 1) : new T.IcosahedronGeometry(r, o.detail ?? 1); S3.jitter(g, r * (o.bump ?? 0.18), seed);
      if (o.squash) g.scale(o.squash[0], o.squash[1], o.squash[2]);
      return this.geo(g, color, { vary: 0.1, ...o });
    }
    /** Tube with a varying radius along a polyline. rad: number | array | fn(u, i). o: {vary, hue, jit, capA, capB, flat, uv (metres per texture repeat)}. color may be fn(i, k). */
    sweep(pts, rad, n, color, o = {}) {
      const N = pts.length, rings = [], vv = [0]; let pn = null, rEnd = 0, r0 = 0;
      for (let i = 0; i < N; i++) {
        const p = pts[i], t = vnorm(vsub(pts[Math.min(N - 1, i + 1)], pts[Math.max(0, i - 1)]));
        let nx = pn ? vnorm(vsub(pn, vmul(t, vdot(pn, t)))) : vnorm(vcross(Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], t));
        const bx = vcross(t, nx); pn = nx;
        const rr = typeof rad === 'function' ? rad(N > 1 ? i / (N - 1) : 0, i) : Array.isArray(rad) ? rad[i] : rad, ring = [];
        for (let k = 0; k < n; k++) {
          const a = k / n * TAU + (o.twist || 0) * i, q = rr * (o.jit ? 1 + (this.r() - 0.5) * 2 * o.jit : 1), cx = cos(a) * q, sx = sin(a) * q * (o.flat || 1);
          ring.push([p[0] + nx[0] * cx + bx[0] * sx, p[1] + nx[1] * cx + bx[1] * sx, p[2] + nx[2] * cx + bx[2] * sx]);
        }
        rings.push(ring); if (i === 0) r0 = rr; rEnd = rr;
        if (i > 0) vv.push(vv[i - 1] + hyp(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]));
      }
      const colAt = (i, k) => typeof color === 'function' ? color(i, k) : this.sh(color, o.vary ?? 0, o.hue || 0);
      for (let i = 0; i < N - 1; i++) for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n; this.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k], colAt(i, k));
        if (this.uv) { const u0 = k / n, u1 = (k + 1) / n, v0 = vv[i] / o.uv, v1 = vv[i + 1] / o.uv; this.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1); }
      }
      const cap = (ring, c, rev) => { const k = o.capColor ? this.sh(o.capColor, 0.06) : colAt(rev ? 0 : N - 1, 0); for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; rev ? this.tri(c, ring[j2], ring[j], k) : this.tri(c, ring[j], ring[j2], k); if (this.uv) this.uv.push(0.5, 0, 0.5, 0, 0.5, 0); } };
      if (o.capA && r0 > 0.002) cap(rings[0], pts[0], true);
      if (o.capB !== false && rEnd > 0.002) cap(rings[N - 1], pts[N - 1], false);
      this.rings = rings; return this;
    }
    /** Surface from a grid: f(u, v, i, j) -> [x, y, z]. Faces look toward u x v. o: {vary, hue, col(u, v, i, j), flip, quads}. */
    surf(nu, nv, f, color, o = {}) {
      const P = []; for (let i = 0; i <= nu; i++) { P.push([]); for (let j = 0; j <= nv; j++) P[i].push(f(i / nu, j / nv, i, j)); }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const base = o.col ? o.col((i + 0.5) / nu, (j + 0.5) / nv, i, j) : color, a = P[i][j], b = P[i + 1][j], c = P[i + 1][j + 1], d = P[i][j + 1];
        const k1 = this.sh(base, o.vary ?? 0, o.hue || 0), k2 = o.quads ? k1 : this.sh(base, o.vary ?? 0, o.hue || 0), alt = (i + j) % 2 && !o.quads;
        if (o.flip) { if (alt) this.tri(a, d, b, k1).tri(b, d, c, k2); else this.tri(a, c, b, k1).tri(a, d, c, k2); }
        else if (alt) this.tri(a, b, d, k1).tri(b, c, d, k2); else this.tri(a, b, c, k1).tri(a, c, d, k2);
      }
      this.grid = P; return this;
    }
    /** Merge another soup. o: {at, rot, scl, mul (brightness)}. */
    add(s2, o) {
      const M = xform(o), A = s2.p, mul = (o && o.mul) || 1;
      for (let i = 0; i < A.length; i += 3) { if (M) { const q = xpt(M, [A[i], A[i + 1], A[i + 2]]); this.p.push(q[0], q[1], q[2]); } else this.p.push(A[i], A[i + 1], A[i + 2]); this.c.push(s2.c[i] * mul, s2.c[i + 1] * mul, s2.c[i + 2] * mul); }
      return this;
    }
    /** Run fn(centroid, normal, i) over every face; return a THREE.Color to replace the face colour, a number to multiply it, or nothing. */
    paint(fn) {
      const p = this.p, c = this.c;
      for (let i = 0; i < p.length; i += 9) {
        const a = [p[i], p[i + 1], p[i + 2]], b = [p[i + 3], p[i + 4], p[i + 5]], d = [p[i + 6], p[i + 7], p[i + 8]];
        const k = fn([(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3], fnorm(a, b, d), i, c);
        if (k == null) continue;
        for (let j = 0; j < 9; j += 3) { if (k.isColor) { c[i + j] = k.r; c[i + j + 1] = k.g; c[i + j + 2] = k.b; } else { c[i + j] *= k; c[i + j + 1] *= k; c[i + j + 2] *= k; } }
      }
      return this;
    }
    /** Blend upward-facing faces toward a colour (snow, moss, grass). amt 0..1, from = normal.y where it starts, above = only faces higher than this. */
    top(color, amt = 1, from = 0.45, o = {}) {
      const k = C(color), r = this.r, pf = o.patch || 0, ps = o.seed || 1, above = o.above ?? -1e9;
      return this.paint((ce, n, i, c) => {
        if (n[1] <= from || ce[1] < above) return; let f = amt * sm((n[1] - from) / 0.3) * (0.85 + r() * 0.3);
        if (pf) f *= sm((n2(ce[0] * pf + 7.3, ce[2] * pf + 3.1, ps) - 0.28) / 0.3);
        return new T.Color(c[i], c[i + 1], c[i + 2]).lerp(k, clamp(f));
      });
    }
    /** Fake sky light: brightness lo..hi between heights y0..y1, faces looking up gain `up`, plus an optional warm tint at the top. */
    lit(y0, y1, lo = 0.7, hi = 1.1, up = 0.14, tint = null, tintAmt = 0.3) {
      const tc = tint && C(tint);
      return this.paint((ce, n, i, c) => { const h = sm((ce[1] - y0) / (y1 - y0 || 1)), k = lerp(lo, hi, h) * (1 + up * n[1]); const col = new T.Color(c[i], c[i + 1], c[i + 2]); if (tc) col.lerp(tc, tintAmt * h * clamp(0.35 + n[1])); return col.multiplyScalar(k); });
    }
    /** Clamp every vertex to y >= y0 (flat undersides). */
    floor(y0 = 0) { const p = this.p; for (let i = 1; i < p.length; i += 3) if (p[i] < y0) p[i] = y0; return this; }
    geometry(pivot) {
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      if (this.uv) g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2));
      if (pivot) g.translate(-pivot[0], -pivot[1], -pivot[2]);
      g.computeVertexNormals(); return g;
    }
    /** One shadow-casting mesh from the whole soup. `pivot` moves the mesh origin there (for parts that rotate). */
    mesh(mat, pivot) { const m = new T.Mesh(this.geometry(pivot), mat || MAT()); if (pivot) m.position.set(pivot[0], pivot[1], pivot[2]); m.castShadow = m.receiveShadow = true; return m; }
  }
  const group = (type, ...kids) => { const g = new T.Group(); kids.flat().forEach(k => k && g.add(k)); g.userData.kit = 'nature'; g.userData.type = type; return g; };

  // ---------- small textures ----------
  let _birch = null, _end = null;
  const birchMat = () => _birch || (_birch = S3.texMat(S3.canvasTex(128, 256, (c, w, h) => {
    const r = rng(77); c.fillStyle = '#ece9df'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) { c.fillStyle = `rgba(110,108,100,${0.05 + r() * 0.12})`; c.fillRect(r() * w, r() * h, 8 + r() * 40, 1 + r() * 3); }
    const mark = (x, y, ww, hh) => { for (const dx of [-w, 0, w]) { c.beginPath(); c.ellipse(x + dx, y, ww / 2, hh / 2, 0, 0, TAU); c.fill(); } };
    c.fillStyle = '#2a2623'; for (let i = 0; i < 30; i++) mark(r() * w, r() * h, 8 + r() * 30, 2 + r() * 4);
    for (let i = 0; i < 5; i++) { const x = r() * w, y = r() * h, s = 9 + r() * 8; for (const dx of [-w, 0, w]) { c.beginPath(); c.moveTo(x + dx - s, y); c.quadraticCurveTo(x + dx, y - s * 1.1, x + dx + s, y); c.quadraticCurveTo(x + dx, y + s * 0.5, x + dx - s, y); c.fill(); } }
  }, { repeat: [1, 1] })));
  /** Cut wood with growth rings, for stump tops and log ends (maps onto a THREE.CircleGeometry). */
  const endMat = () => _end || (_end = S3.texMat(S3.canvasTex(128, 128, (c) => {
    const r = rng(41); c.fillStyle = '#5a4635'; c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#c9a56e'; c.beginPath(); c.arc(64, 64, 57, 0, TAU); c.fill();
    c.fillStyle = '#b98f58'; c.beginPath(); c.arc(62, 66, 30, 0, TAU); c.fill();
    for (let i = 1; i < 9; i++) { c.strokeStyle = `rgba(112,76,40,${0.3 + r() * 0.35})`; c.lineWidth = 1 + r() * 2; c.beginPath(); c.ellipse(63 + r() * 2, 65 + r() * 2, i * 6.4, i * 6.4 * (0.94 + r() * 0.08), r(), 0, TAU); c.stroke(); }
    c.strokeStyle = 'rgba(64,40,22,.8)'; c.lineWidth = 2; for (let i = 0; i < 4; i++) { const a = r() * TAU, l = 20 + r() * 34; c.beginPath(); c.moveTo(63, 65); c.lineTo(63 + cos(a) * l, 65 + sin(a) * l); c.stroke(); }
    c.fillStyle = '#6e4a2a'; c.beginPath(); c.arc(63, 65, 3, 0, TAU); c.fill();
  })));
  /** Textured end-grain disc facing along `dir` at `p`. */
  const endDisc = (p, dir, R, n = 8) => { const m = new T.Mesh(new T.CircleGeometry(R, n), endMat()); m.position.set(p[0], p[1], p[2]); m.quaternion.setFromUnitVectors(_v1.set(0, 0, 1), _v2.set(dir[0], dir[1], dir[2]).normalize()); m.receiveShadow = true; return m; };

  // ---------- plants: a description (trunk soup + swaying parts) becomes a group ----------
  function plant(type, d, o = {}) {
    const rig = new T.Group(), g = group(type, rig), seed = o.seed ?? 1;
    if (d.trunk && d.trunk.tris) rig.add(d.trunk.mesh(d.trunkMat));
    (d.extra || []).forEach(m => rig.add(m));
    const parts = d.parts.filter(pt => pt.soup.tris).map((pt, i) => { const m = pt.soup.mesh(pt.mat, pt.pivot || [0, 0, 0]); m.userData.w = pt.w ?? 1; m.userData.ph = seed * 0.73 + i * 2.1; rig.add(m); return m; });
    const A = d.flex || [0.01, 0.03, 1];
    Object.assign(g.userData, { parts, rig, height: d.height, radius: d.radius, top: d.top });
    /** Wind. lt = seconds, amount 1 = breeze, 3 = storm. Sets the whole pose from lt (pure function of time). */
    g.userData.sway = (lt, amount = 1) => {
      const ph = seed * 1.37 + g.position.x * 0.21 + g.position.z * 0.13, sp = A[2] || 1, gust = 0.6 + 0.4 * n1(lt * 0.21 + ph * 0.1, 3);
      rig.rotation.z = -amount * A[0] * gust * (0.5 + n1(lt * 0.55 * sp + ph, 1));
      rig.rotation.x = amount * A[0] * gust * 0.6 * n1(lt * 0.47 * sp + ph, 2);
      for (const m of parts) { const w = m.userData.w * amount * A[1] * gust, q = ph + m.userData.ph; m.rotation.z = -w * (0.3 + n1(lt * 0.9 * sp + q, 4) + 0.35 * n1(lt * 2.3 * sp + q, 5)); m.rotation.x = w * 0.8 * (n1(lt * 0.8 * sp + q, 6) + 0.35 * n1(lt * 2.6 * sp + q, 8)); }
      return g;
    };
    g.userData.animate = lt => g.userData.sway(lt, o.wind ?? 1);
    return g;
  }

  // one conifer tier: a drooping skirt of boughs with a dark underside, optional snow load
  function tier(S, c, y0, th, tr, n, col, r, snow, fine) {
    const apex = [c[0], y0 + th, c[2]], a0 = r() * TAU, mid = [], out = [], under = [c[0], y0 + th * 0.22, c[2]];
    for (let k = 0; k < n; k++) {
      const a = a0 + (k + (r() - 0.5) * 0.4) / n * TAU, long = (fine ? (k % 2 ? 0.74 : 0.98) : 0.84) + r() * 0.16;      // long and short boughs
      mid.push([c[0] + sin(a) * tr * 0.5, y0 + th * 0.42, c[2] + cos(a) * tr * 0.5]);
      out.push([c[0] + sin(a) * tr * long, y0 - tr * 0.36 * (long - 0.8), c[2] + cos(a) * tr * long]);
    }
    const dark = col.clone().multiplyScalar(0.5), light = col.clone().multiplyScalar(1.12);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      if (fine) { S.tri(apex, mid[k], mid[k2], S.sh(light, 0.1, 0.012)); S.quad(mid[k], out[k], out[k2], mid[k2], S.sh(col, 0.13, 0.015)); }
      else S.tri(apex, out[k], out[k2], S.sh(col, 0.14, 0.015));
      S.tri(under, out[k2], out[k], S.sh(dark, 0.1));
    }
    if (snow > 0) {
      const white = '#f1f5fb', ap = [apex[0], apex[1] + 0.05, apex[2]], top = fine ? mid : out.map(p => vlerp(apex, p, 0.45));
      const m2 = top.map(p => [c[0] + (p[0] - c[0]) * 1.07, p[1] + 0.07, c[2] + (p[2] - c[2]) * 1.07]);
      const e2 = out.map((p, k) => { const q = vlerp(top[k], p, clamp(snow * (0.3 + r() * 0.6))); return [c[0] + (q[0] - c[0]) * 1.04, q[1] + 0.08, c[2] + (q[2] - c[2]) * 1.04]; });
      for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; S.tri(ap, m2[k], m2[k2], S.sh(white, 0.03)); S.quad(m2[k], e2[k], e2[k2], m2[k2], S.sh('#e3eaf5', 0.04)); }
    }
  }
  function dPine(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 131 + 7), h = o.height ?? 7, R = o.radius ?? (h * 0.17 + 0.45), snow = o.snow ?? 0, det = o.detail ?? 1, n = det ? 8 : 6;
    const leaf = C(o.leaf || '#2a5a3e'), leaf2 = C(o.leaf2 || '#4c8752'), bare = h * (o.bare ?? 0.17), nT = o.tiers ?? clamp(Math.round(h / 1.3), 3, 7), R0 = 0.05 + h * 0.022;
    const lx = (r() - 0.5) * h * 0.04, lz = (r() - 0.5) * h * 0.04, axis = y => [lx * (y / h) ** 2, y, lz * (y / h) ** 2];
    const trunk = new Soup(seed);
    if (det) trunk.sweep([axis(0), axis(0.25), axis(bare + (h - bare) * 0.45), axis(h * 0.9)], [R0 * 1.6, R0, R0 * 0.6, R0 * 0.15], 6, o.trunk || '#5b4230', { vary: 0.1 });
    else trunk.sweep([axis(0), axis(bare * 1.3), axis(h * 0.8)], [R0 * 1.3, R0 * 0.9, R0 * 0.2], 5, o.trunk || '#5b4230', { vary: 0.1 });
    const nP = Math.min(3, nT), span = (h - bare) / nT, parts = [];
    for (let p = 0; p < nP; p++) parts.push({ soup: new Soup(seed + p * 17 + 3), pivot: null, w: 0.5 + p * 0.5 });
    for (let i = 0; i < nT; i++) {
      const u = nT > 1 ? i / (nT - 1) : 1, y0 = bare + span * i * 0.94, th = i === nT - 1 ? h - y0 : span * 1.7, tr = R * (1 - u * 0.72) * (0.9 + r() * 0.2);
      const P = parts[Math.min(nP - 1, flr(i * nP / nT))]; if (!P.pivot) P.pivot = axis(y0 + th * 0.2);
      tier(P.soup, axis(y0), y0, th, tr, n, leaf.clone().lerp(leaf2, u * 0.6), r, snow, det);
    }
    return { trunk, parts, flex: [0.012, 0.035, 1], height: h, radius: R };
  }
  function dBroadleaf(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 173 + 11), h = o.height ?? 7.5, W = o.spread ?? h * 0.72, k = h / 7.5, det = o.detail ?? 1;
    const leaves = o.leaf || ['#3b7338', '#46803c', '#34693a'], hi = o.leaf2 || '#8cb549', bark = o.trunk || '#5e4a38';
    const trunk = new Soup(seed), fy = h * (0.36 + r() * 0.05), bx = (r() - 0.5) * 0.6 * k, bz = (r() - 0.5) * 0.6 * k, fork = [bx, fy, bz];
    trunk.sweep([[0, 0, 0], [bx * 0.1, 0.32 * k, bz * 0.1], [bx * 0.7, fy * 0.55, bz * 0.7], fork], [0.47 * k, 0.27 * k, 0.23 * k, 0.19 * k], 7, bark, { vary: 0.1, jit: 0.05 });
    const blobs = [], a0 = r() * TAU, nL = 3;
    for (let j = 0; j < nL; j++) {
      const a = a0 + j * TAU / nL + (r() - 0.5) * 0.7, len = W * (0.25 + r() * 0.07), el = 0.6 + r() * 0.35;
      const e = [fork[0] + sin(a) * cos(el) * len, fy + sin(el) * len, fork[2] + cos(a) * cos(el) * len], m = vlerp(fork, e, 0.5); m[1] += len * 0.1;
      trunk.sweep([fork, m, e], [0.15 * k, 0.1 * k, 0.05 * k], 5, bark, { vary: 0.1 });
      blobs.push({ c: [e[0], e[1] + W * 0.06, e[2]], r: W * (0.26 + r() * 0.05), p: j, octa: !det });
      if (det) blobs.push({ c: [fork[0] + sin(a + 1.05) * W * 0.36, fy + W * (0.16 + r() * 0.12), fork[2] + cos(a + 1.05) * W * 0.36], r: W * (0.17 + r() * 0.05), p: j, octa: true });
      if (det) blobs.push({ c: [fork[0] + sin(a + 0.5) * W * 0.22, h - W * (0.2 + r() * 0.08), fork[2] + cos(a + 0.5) * W * 0.22], r: W * (0.17 + r() * 0.04), p: j, octa: true });
    }
    blobs.push({ c: [fork[0] + (r() - 0.5) * 0.5 * k, h - W * 0.3, fork[2] + (r() - 0.5) * 0.5 * k], r: W * 0.33, p: 0 });
    const parts = [0, 1, 2].map(i => ({ soup: new Soup(seed + i * 29 + 5), pivot: fork, w: 0.8 + i * 0.25 }));
    blobs.forEach((b, i) => parts[b.p].soup.blob(b.r, pick(leaves, r), seed * 13 + i, { at: b.c, squash: [1, 0.8, 1], octa: b.octa, bump: b.octa ? 0.2 : 0.17, vary: 0.11, hue: 0.012 }));
    parts.forEach(p => p.soup.lit(fy + W * 0.05, h, 0.66, 1.1, 0.16, hi, 0.32));
    return { trunk, parts, flex: [0.006, 0.022, 0.85], height: h, radius: W / 2 };
  }
  function dBirch(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 191 + 3), h = o.height ?? 8, k = h / 8;
    const leaves = o.leaf || ['#7dab47', '#8cb84f', '#6e9d43'], hi = o.leaf2 || '#c3d667', twig = '#3d3530';
    const trunk = new Soup(seed); trunk.uv = [];
    const lx = (r() - 0.5) * 1.0 * k, lz = (r() - 0.5) * 1.0 * k, wob = r() * TAU;
    const ax = y => { const u = y / h; return [lx * u * u + sin(u * 5 + wob) * 0.08 * k * u, y, lz * u * u + cos(u * 4 + wob) * 0.08 * k * u]; };
    const N = (o.detail ?? 1) ? 7 : 5, pts = [], rad = []; for (let i = 0; i <= N; i++) { const u = i / N; pts.push(ax(h * 0.95 * u)); rad.push((0.15 - 0.125 * u ** 0.8) * k + (i === 0 ? 0.05 * k : 0)); }
    trunk.sweep(pts, rad, 6, '#ffffff', { uv: 2.2 * k });
    const det = o.detail ?? 1, parts = [0, 1, 2].map(i => ({ soup: new Soup(seed + i * 31 + 2), pivot: ax(h * (0.5 + i * 0.15)), w: 0.8 + i * 0.3 })), nB = det ? 8 : 5;
    const clump = (S, c, rr, i, sq, cheap) => S.blob(rr, pick(leaves, r), seed * 7 + i, { at: c, squash: sq, octa: !cheap, detail: 0, bump: 0.22, vary: 0.12, hue: 0.015 });
    for (let j = 0; j < nB; j++) {
      const u = 0.38 + 0.52 * j / (nB - 1), y = h * u, p0 = ax(y), a = seed + j * 2.4 + r() * 0.8, len = (1.45 - u * 0.85) * k * (0.8 + r() * 0.4), el = 0.5 + r() * 0.4, S = parts[j % 3].soup;
      const e = [p0[0] + sin(a) * cos(el) * len, y + sin(el) * len, p0[2] + cos(a) * cos(el) * len], br = (0.74 - u * 0.26) * k * (0.85 + r() * 0.3);
      S.sweep([p0, vlerp(p0, e, 0.55), e], [0.035 * k, 0.022 * k, 0.01 * k], 4, twig, { vary: 0.1 });
      clump(S, [e[0], e[1] + br * 0.1, e[2]], br, j, [1.12, 0.72, 1.12]);
      if (det) { const m = vlerp(p0, e, 0.42); clump(S, [m[0], m[1] + br * 0.42, m[2]], br * 0.7, j + 30, [1.1, 0.75, 1.1]); }
      clump(S, [e[0] + sin(a) * br * 0.55, e[1] - br * 0.55, e[2] + cos(a) * br * 0.55], br * 0.55, j + 60, [0.9, 1.25, 0.9], true);
    }
    const tp = ax(h * 0.95); clump(parts[2].soup, [tp[0], h - 0.5 * k, tp[2]], 0.62 * k, 99, [1, 0.85, 1]); if (det) clump(parts[1].soup, [tp[0] + 0.3 * k, h - 1.05 * k, tp[2] - 0.2 * k], 0.6 * k, 98, [1.1, 0.8, 1.1]);
    parts.forEach(p => p.soup.lit(h * 0.42, h, 0.72, 1.1, 0.14, hi, 0.35));
    return { trunk, trunkMat: birchMat(), parts, flex: [0.016, 0.04, 1.2], height: h, radius: 1.9 * k };
  }
  function twigs(S, p0, a, el, L, r0, depth, r, col, tipC) {
    const n = depth > 0 ? 3 : 2, pts = [p0], rad = [r0]; let p = p0, aa = a, ee = el;
    for (let i = 1; i <= n; i++) {
      aa += (r() - 0.5) * 0.9; ee = Math.min(1.35, ee + 0.12 + (r() - 0.3) * 0.5); const seg = L / n;
      p = [p[0] + sin(aa) * cos(ee) * seg, p[1] + sin(ee) * seg, p[2] + cos(aa) * cos(ee) * seg]; pts.push(p); rad.push(Math.max(0.012, r0 * (1 - i / n * 0.86)));
      if (depth > 0 && i < n) twigs(S, p, aa + (i % 2 ? 1 : -1) * (0.7 + r() * 0.6), ee + (r() - 0.4) * 0.5, L * (0.42 + r() * 0.2), rad[i] * 0.72, depth - 1, r, col, tipC);
    }
    S.sweep(pts, rad, depth > 0 ? 5 : 4, depth > 0 ? col : mixC(col, tipC, 0.5), { vary: 0.12 });   // depth 0 = a twig
  }
  function dDead(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 211 + 5), h = o.height ?? 6.5, k = h / 6.5, col = C(o.color || '#574b41'), tipC = C(o.color2 || '#84786c');
    const trunk = new Soup(seed), N = 5, pts = [], th = h * 0.74, rAt = u => k * (0.3 - 0.2 * u), det = (o.detail ?? 1) ? 1 : 0; let x = 0, z = 0;
    for (let i = 0; i <= N; i++) { if (i > 0) { x += (r() - 0.5) * 0.55 * k; z += (r() - 0.5) * 0.55 * k; } pts.push([x, th * i / N, z]); }
    trunk.sweep(pts, i => i === 0 ? 0.5 * k : rAt(i), 6, col, { vary: 0.12, jit: 0.1 });
    const at = u => { const f = u * N, i = Math.min(N - 1, flr(f)); return vlerp(pts[i], pts[i + 1], f - i); }, parts = [], nB = o.branches ?? 5;
    for (let j = 0; j < nB; j++) {
      const u = 0.4 + 0.52 * (j / Math.max(1, nB - 1)), p0 = at(u), a = seed * 1.3 + j * 2.4 + (r() - 0.5) * 0.8, L = k * (2.9 - u * 1.3) * (0.8 + r() * 0.4), S = new Soup(seed + j * 7 + 1);
      twigs(S, p0, a, 0.2 + r() * 0.45, L, rAt(u) * 0.6, det, r, col, tipC); parts.push({ soup: S, pivot: p0, w: 0.7 + u });
    }
    const S = new Soup(seed + 91); twigs(S, pts[N], r() * TAU, 1.1, h - th + 0.5 * k, rAt(1) * 0.95, det, r, col, tipC); parts.push({ soup: S, pivot: pts[N], w: 1.6 });
    [trunk, ...parts.map(p => p.soup)].forEach(s => s.lit(0, h, 0.78, 1.12, 0.1));
    return { trunk, parts, flex: [0.004, 0.018, 0.8], height: h, radius: 2.6 * k };
  }
  function frond(S, p0, a, L, phi0, droop, leaf, rib, r, fine) {
    const n = 6, seg = L / n, ox = sin(a), oz = cos(a), sx = cos(a), sz = -sin(a), sp = [p0.slice()]; let x = 0, y = 0;
    for (let j = 1; j <= n; j++) { const phi = phi0 - (j - 0.5) / n * (phi0 + droop); x += cos(phi) * seg; y += sin(phi) * seg; sp.push([p0[0] + ox * x, p0[1] + y, p0[2] + oz * x]); }
    if (fine) S.sweep([sp[0], sp[2], sp[4], sp[6]], [0.04, 0.03, 0.02, 0.008], 3, rib, { vary: 0.08 });
    const m = fine ? 2 : 1, cnt = n * m;
    for (let q = 1; q <= cnt; q++) {
      const f = q / m, i = Math.min(n - 1, flr(f - 1e-6)), c = vlerp(sp[i], sp[i + 1], f - i), u = q / cnt, w = L * 0.3 * Math.pow(sin(Math.min(1, u * 0.85 + 0.12) * PI), 0.6);
      const half = vmul(vsub(sp[i + 1], sp[i]), 0.62 / m), a1 = vsub(c, half), b1 = vadd(c, half), col = S.sh(leaf, 0.14, 0.02);
      for (const side of [-1, 1]) S.tri(a1, b1, [c[0] + sx * side * w + ox * w * 0.2, c[1] - w * 0.5, c[2] + sz * side * w + oz * w * 0.2], side < 0 ? col : col.clone().multiplyScalar(0.9));
    }
  }
  function dPalm(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 239 + 9), h = o.height ?? 7, k = h / 7, lean = o.lean ?? h * 0.17, la = o.leanDir ?? PI / 2, det = o.detail ?? 1;
    const bark = C(o.trunk || '#8d7a5e'), leaf = C(o.leaf || '#3f8a45'), old = C(o.leaf2 || '#8fa843');
    const ax = u => [sin(la) * lean * u * u, h * u, cos(la) * lean * u * u], N = 9, pts = [], trunk = new Soup(seed);
    for (let i = 0; i <= N; i++) pts.push(ax(i / N));
    const dark = bark.clone().multiplyScalar(0.8);
    trunk.sweep(pts, (u, i) => k * (i === 0 ? 0.38 : (0.25 - 0.1 * u) * (i % 2 ? 1.07 : 0.96)), 7, i => trunk.sh(i % 2 ? bark : dark, 0.08), {});
    const tp = ax(1), parts = [], nF = o.fronds ?? (det ? 11 : 8);
    trunk.blob(0.27 * k, '#6f5f41', seed + 4, { at: [tp[0], tp[1] - 0.05, tp[2]], squash: [1, 1.2, 1], detail: 0, vary: 0.1 });
    if (o.coconuts !== false) for (let j = 0; j < 3; j++) { const a = j * 2.1 + r(); trunk.ico(0.13 * k, '#4b3a29', 0, { at: [tp[0] + sin(a) * 0.24 * k, tp[1] - 0.32 * k, tp[2] + cos(a) * 0.24 * k], vary: 0.12 }); }
    for (let f = 0; f < nF; f++) {
      const S = new Soup(seed + f * 13 + 2), lvl = f % 3, a = f / nF * TAU + (r() - 0.5) * 0.5, L = k * (3.0 + r() * 0.8) * (lvl === 2 ? 0.82 : 1);
      frond(S, tp, a, L, [-0.12, 0.38, 0.95][lvl] + (r() - 0.5) * 0.25, [1.25, 1.0, 0.65][lvl], leaf.clone().lerp(old, [0.55, 0.2, 0][lvl]), '#a9b060', r, det);
      parts.push({ soup: S, pivot: tp, w: 0.7 + r() * 0.6, mat: MAT2() });
    }
    return { trunk, parts, flex: [0.02, 0.09, 1.1], height: h + 1.3 * k, radius: 3.4 * k, top: tp };
  }
  function dBush(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 251 + 3), W = o.size ?? 1.4, h = o.height ?? W * 0.72;
    const leaves = o.leaf || ['#3d7036', '#487d3e', '#356734'], hi = o.leaf2 || '#8ab34c';
    const parts = [0, 1].map(i => ({ soup: new Soup(seed + i * 11 + 1), pivot: [0, 0, 0], w: 0.8 + i * 0.4 })), n = 4 + flr(r() * 2), a0 = r() * TAU, rc = W * 0.33;
    parts[1].soup.blob(rc, pick(leaves, r), seed, { at: [(r() - 0.5) * 0.1 * W, h - rc * 0.82, (r() - 0.5) * 0.1 * W], squash: [1.05, 0.88, 1.05], bump: 0.2, vary: 0.11, hue: 0.012 });
    const spots = [];
    for (let j = 0; j < n; j++) {
      const a = a0 + j * TAU / n + (r() - 0.5) * 0.5, br = W * (0.21 + r() * 0.07), d = W * 0.5 - br * 0.9, c = [sin(a) * d, br * (0.62 + r() * 0.25), cos(a) * d];
      parts[j % 2].soup.blob(br, pick(leaves, r), seed + j * 3 + 1, { at: c, squash: [1, 0.9, 1], detail: j % 2 ? 0 : 1, bump: 0.2, vary: 0.11, hue: 0.012 }); spots.push([c, br]);
    }
    parts.forEach(p => p.soup.floor(0).lit(0, h, 0.6, 1.12, 0.16, hi, 0.4));
    if (o.berries) { const bc = o.berries === true ? '#c62b3b' : o.berries; for (let j = 0; j < 14; j++) { const [c, br] = spots[j % spots.length], a = r() * TAU, e = 0.1 + r() * 1.1; parts[j % 2].soup.geo(new T.OctahedronGeometry(0.035 + r() * 0.012), bc, { at: [c[0] + sin(a) * cos(e) * br * 0.97, c[1] + sin(e) * br * 0.88, c[2] + cos(a) * cos(e) * br * 0.97], vary: 0.1 }); } }
    return { trunk: null, parts, flex: [0.008, 0.035, 1.3], height: h, radius: W / 2 };
  }
  const pine = (o = {}) => plant('pine', dPine(o), o);
  const snowyPine = (o = {}) => plant('snowyPine', dPine({ snow: 0.85, leaf: '#28533f', leaf2: '#3f7650', ...o }), o);
  const broadleaf = (o = {}) => plant('broadleaf', dBroadleaf(o), o);
  const birch = (o = {}) => plant('birch', dBirch(o), o);
  const deadTree = (o = {}) => plant('deadTree', dDead(o), o);
  const palm = (o = {}) => plant('palm', dPalm(o), o);
  const bush = (o = {}) => plant('bush', dBush(o), o);
  const DESC = { pine: dPine, snowyPine: o => dPine({ snow: 0.85, leaf: '#28533f', leaf2: '#3f7650', ...o }), broadleaf: dBroadleaf, birch: dBirch, deadTree: dDead, palm: dPalm, bush: dBush };

  // ---------- rocks ----------
  /** Chiselled rock geometry: jittered icosphere with random flat cuts, squashed and sunk a little into the ground. */
  function rockGeo(size, seed, o = {}) {
    const r = rng(seed * 977 + 13), R = size / 2, g = new T.IcosahedronGeometry(R, o.detail ?? 1); S3.jitter(g, R * (o.bump ?? 0.14), seed);
    const P = g.attributes.position;
    for (let k = 0, n = o.cuts ?? 6; k < n; k++) {
      const a = r() * TAU, e = (r() - 0.3) * 1.7, nx = cos(a) * cos(e), ny = sin(e), nz = sin(a) * cos(e), d = R * (0.5 + r() * 0.32);
      for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), s = x * nx + y * ny + z * nz - d; if (s > 0) P.setXYZ(i, x - nx * s, y - ny * s, z - nz * s); }
    }
    const sq = o.squash || [1, 0.7, 0.82], hy = R * sq[1], sink = o.sink ?? 0.22; g.scale(sq[0], sq[1], sq[2]); g.rotateY(r() * TAU); g.translate(0, hy * (1 - sink * 2), 0);
    for (let i = 0; i < P.count; i++) if (P.getY(i) < -0.02) P.setY(i, -0.02);
    return g;
  }
  const rockInto = (S, size, seed, o = {}) => S.geo(rockGeo(size, seed, o), o.color || '#85878a', { vary: 0.12, hue: 0.01, at: o.at, rot: o.rot });
  const weather = (S, o, h) => { S.lit(0, h, 0.72, 1.08, 0.12); if (o.moss) S.top(o.mossColor || '#5d7a3a', o.moss, 0.5, { patch: 2.2 / Math.max(0.5, h), seed: o.seed ?? 1 }); if (o.snow) S.top('#f1f5fb', o.snow, 0.3); return S; };
  function rock(o = {}) { const seed = o.seed ?? 1, size = o.size ?? 0.6, S = new Soup(seed); rockInto(S, size, seed, { detail: size < 0.45 ? 0 : 1, ...o }); weather(S, o, size * 0.5); const g = group('rock', S.mesh()); g.userData.size = size; return g; }
  function boulder(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 53 + 1), size = o.size ?? 2.4, S = new Soup(seed);
    rockInto(S, size, seed, { squash: [1, 0.78, 0.86], cuts: 7, bump: 0.12, ...o });
    const a = r() * TAU; rockInto(S, size * 0.42, seed + 7, { ...o, at: [sin(a) * size * 0.5, 0, cos(a) * size * 0.42] }); rockInto(S, size * 0.24, seed + 9, { ...o, detail: 0, at: [sin(a + 2.2) * size * 0.52, 0, cos(a + 2.2) * size * 0.44] });
    weather(S, { moss: 0.35, ...o }, size * 0.6); const g = group('boulder', S.mesh()); g.userData.size = size; return g;
  }
  function rockPile(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 59 + 3), W = o.size ?? 2.2, n = o.count ?? 7, S = new Soup(seed);
    for (let i = 0; i < n; i++) { const a = r() * TAU, d = Math.sqrt(r()) * W * 0.36 * (i ? 1 : 0), s = W * (i ? 0.2 + r() * 0.25 : 0.5); rockInto(S, s, seed * 3 + i, { ...o, detail: s < 0.5 ? 0 : 1, at: [sin(a) * d, i > n * 0.7 ? W * 0.12 : 0, cos(a) * d] }); }
    weather(S, o, W * 0.35); const g = group('rockPile', S.mesh()); g.userData.size = W; return g;
  }

  // ---------- stumps, logs ----------
  function stump(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 223 + 1), R = o.radius ?? 0.34, h = o.height ?? 0.5, bark = o.color || '#5c4837', S = new Soup(seed), n = 8;
    S.sweep([[0, -0.02, 0], [0, h * 0.28, 0], [0, h, 0]], [R * 1.4, R * 1.06, R], n, bark, { vary: 0.13, jit: 0.07 });
    for (let j = 0; j < 4; j++) { const a = j * TAU / 4 + r() * 1.0, L = R * (0.55 + r() * 0.6); S.sweep([polar(a, R * 0.55, h * 0.42), polar(a, R + L * 0.45, h * 0.16), polar(a, R + L, -0.05)], [R * 0.36, R * 0.3, R * 0.12], 4, bark, { vary: 0.13 }); }
    S.lit(0, h, 0.72, 1.05, 0.1); if (o.moss ?? 0.5) S.top('#5d7a3a', o.moss ?? 0.5, 0.4, { patch: 4, seed }); if (o.snow) S.top('#f1f5fb', o.snow, 0.2);
    const g = group('stump', S.mesh()); if (!o.snow) g.add(endDisc([0, h + 0.004, 0], [0, 1, 0], R * 0.88, n));
    else { const W = new Soup(seed + 1); W.blob(R * 1.02, '#f1f5fb', seed, { at: [0, h + 0.02, 0], squash: [1, 0.3, 1], detail: 1, bump: 0.08, vary: 0.03 }); g.add(W.mesh()); }
    g.userData.seatY = h; return g;
  }
  function logBody(S, L, R, r, bark, o = {}) {
    const bend = (r() - 0.5) * L * 0.05, pts = [], N = 6, y = R * (o.sunk ?? 0.9);
    for (let i = 0; i <= N; i++) { const u = i / N; pts.push([(u - 0.5) * L, y, sin(u * PI) * bend]); }
    S.sweep(pts, u => R * (1 - 0.16 * u), 7, bark, { vary: 0.13, jit: 0.05, capA: true });
    return pts;
  }
  function log(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 227 + 3), L = o.length ?? 3.2, R = o.radius ?? 0.24, bark = o.color || '#5e4a3a', S = new Soup(seed), pts = logBody(S, L, R, r, bark);
    const nS = o.stubs ?? 2; for (let j = 0; j < nS; j++) { const u = 0.25 + r() * 0.5, p = vlerp(pts[0], pts[6], u), a = (r() - 0.5) * 1.6, len = 0.12 + r() * 0.2; S.sweep([p, [p[0] + (r() - 0.5) * 0.15, p[1] + cos(a) * (R + len), p[2] + sin(a) * (R + len)]], [R * 0.36, R * 0.27], 6, bark, { vary: 0.12 }); }
    S.lit(0, R * 2, 0.7, 1.06, 0.12); if (o.moss ?? 0.7) S.top(o.mossColor || '#5d7a3a', o.moss ?? 0.7, 0.35, { patch: 1.6, seed }); if (o.snow) S.top('#f1f5fb', o.snow, 0.2);
    const g = group('log', S.mesh()); g.add(endDisc([pts[0][0] - 0.004, pts[0][1], pts[0][2]], [-1, 0, 0], R * 0.9, 7), endDisc([pts[6][0] + 0.004, pts[6][1], pts[6][2]], [1, 0, 0], R * 0.84 * 0.9, 7));
    g.userData.seatY = R * 1.9; g.userData.length = L; return g;
  }
  /** A log to sit on. upright: a cut round standing on end; otherwise lying with a flattened top. */
  function logSeat(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 229 + 7), bark = o.color || '#5e4a3a', S = new Soup(seed);
    if (o.upright) {
      const R = o.radius ?? 0.21, h = o.height ?? 0.44; S.sweep([[0, -0.02, 0], [0, h * 0.5, 0], [0, h, 0]], [R * 1.05, R, R * 0.97], 8, bark, { vary: 0.13, jit: 0.04 }); S.lit(0, h, 0.74, 1.05, 0.1);
      const g = group('logSeat', S.mesh(), endDisc([0, h + 0.004, 0], [0, 1, 0], R * 0.9, 8)); g.userData.seatY = h; return g;
    }
    const L = o.length ?? 1.5, R = o.radius ?? 0.23, top = R * 1.62, pts = logBody(S, L, R, r, bark, { sunk: 0.93 });
    for (let i = 1; i < S.p.length; i += 3) if (S.p[i] > top) S.p[i] = top;
    S.lit(0, R * 2, 0.7, 1.06, 0.1); const wood = C('#b8935f'); S.paint((ce, n) => (n[1] > 0.97 && ce[1] > top - 0.01) ? tone(wood, 0.06, 0, S.r) : null);
    const g = group('logSeat', S.mesh(), endDisc([pts[0][0] - 0.004, pts[0][1], pts[0][2]], [-1, 0, 0], R * 0.9, 7), endDisc([pts[6][0] + 0.004, pts[6][1], pts[6][2]], [1, 0, 0], R * 0.84 * 0.9, 7));
    g.userData.seatY = top; return g;
  }

  // ---------- ground cover ----------
  function tuftSoup(seed, hgt, col, col2, blades, spread = 0.05) {
    const S = new Soup(seed), r = S.r, base = C(col), tip = C(col2);
    for (let i = 0; i < blades; i++) {
      const a = r() * TAU, lean = 0.12 + r() * 0.5, h = hgt * (0.45 + r() * 0.7), w = (0.013 + r() * 0.013) * (hgt / 0.32) ** 0.5, d0 = r() * spread, dx = sin(a), dz = cos(a), px = cos(a), pz = -sin(a);
      const b0 = [dx * d0, 0, dz * d0], m = [dx * (d0 + lean * h * 0.3), h * 0.58, dz * (d0 + lean * h * 0.3)], t = [dx * (d0 + lean * h), h, dz * (d0 + lean * h)], L = (q, s) => [q[0] + px * w * s, q[1], q[2] + pz * w * s];
      S.quad(L(b0, -1), L(b0, 1), L(m, 0.75), L(m, -0.75), base.clone().multiplyScalar(0.8 + r() * 0.3)); S.tri(L(m, -0.75), L(m, 0.75), t, tip.clone().multiplyScalar(0.85 + r() * 0.3));
    }
    return S;
  }
  /** One tuft of grass (a single mesh). */
  function grassTuft(o = {}) {
    const seed = o.seed ?? 1, S = tuftSoup(seed, o.height ?? 0.34, o.color || '#4d7b39', o.color2 || '#93b556', o.blades ?? 12, 0.08), m = S.mesh(MAT2()); m.castShadow = false;
    const g = group('grassTuft', m); g.userData.sway = (lt, amount = 1) => { const ph = seed + g.position.x * 0.9 + g.position.z * 0.7; m.rotation.z = -amount * 0.1 * (0.4 + n1(lt * 1.3 + ph, 1)); m.rotation.x = amount * 0.07 * n1(lt * 1.1 + ph, 2); return g; };
    g.userData.animate = lt => g.userData.sway(lt, o.wind ?? 1); return g;
  }
  /** Deterministic scatter positions [[x, z], ...]. area: radius | [w, d]; clear: radius kept empty around `hole` ([x, z], default centre). */
  function spots(count, area, clear, r, minDist = 0, hole = null) {
    const out = [], rect = Array.isArray(area), hx = hole ? hole[0] : 0, hz = hole ? hole[1] : 0; let tries = 0;
    while (out.length < count && tries++ < count * 40) {
      let x, z; if (rect) { x = (r() - 0.5) * area[0]; z = (r() - 0.5) * area[1]; } else { const a = r() * TAU, d = Math.sqrt(r()) * area; x = sin(a) * d; z = cos(a) * d; }
      if (clear && hyp(x - hx, z - hz) < clear) continue;
      if (minDist && out.some(q => hyp(q[0] - x, q[1] - z) < minDist)) continue;
      out.push([x, z]);
    }
    return out;
  }
  // instanced clumps that lean in the wind: shared by grass() and flowerPatch()
  function instField(type, geos, mats, o, tintFn) {
    const seed = o.seed ?? 1, r = rng(seed * 31 + 5), pts = o.points || spots(o.count, o.area, o.clear ?? 0, r, o.minDist || 0, o.hole), n = pts.length, hAt = o.heightAt;
    const ims = geos.map((ge, i) => { const im = new T.InstancedMesh(ge, mats[i], n); im.castShadow = !!o.shadow; im.receiveShadow = true; im.frustumCulled = false; return im; });
    const inst = pts.map(p => ({ x: p[0], z: p[1], y: hAt ? hAt(p[0], p[1]) : 0, rot: r() * TAU, s: lerp(o.scale ? o.scale[0] : 0.7, o.scale ? o.scale[1] : 1.3, r()), ph: r() * 20 }));
    const g = group(type, ims), col = new T.Color();
    const pose = (lt, amount) => {
      inst.forEach((q, i) => {
        const lz = amount ? -amount * 0.16 * (0.35 + n1(lt * 1.25 + q.ph + q.x * 0.35, 1)) : 0, lx = amount ? amount * 0.1 * n1(lt * 1.05 + q.ph + q.z * 0.35, 2) : 0;
        _q.setFromEuler(_e.set(lx, 0, lz, 'XYZ')); _q2.setFromAxisAngle(_v3.set(0, 1, 0), q.rot); _q.multiply(_q2);
        _m4.compose(_v1.set(q.x, q.y, q.z), _q, _v2.set(q.s, q.s, q.s)); ims.forEach(im => im.setMatrixAt(i, _m4));
      });
      ims.forEach(im => { im.instanceMatrix.needsUpdate = true; });
    };
    inst.forEach((q, i) => ims.forEach((im, j) => { const c = tintFn(j, r, col); if (c) im.setColorAt(i, c); }));
    ims.forEach(im => { if (im.instanceColor) im.instanceColor.needsUpdate = true; });
    pose(0, 0); g.userData.count = n; g.userData.points = pts;
    g.userData.sway = (lt, amount = 1) => { pose(lt, amount); return g; }; g.userData.animate = lt => g.userData.sway(lt, o.wind ?? 1);
    return g;
  }
  /** A field of grass tufts as ONE instanced mesh. o: {count, area: radius | [w, d], clear, seed, height, color, color2, blades, scale:[min,max], heightAt}. */
  function grass(o = {}) {
    const S = tuftSoup(o.seed ?? 1, o.height ?? 0.32, o.color || '#4d7b39', o.color2 || '#93b556', o.blades ?? 8, 0.09);
    return instField('grass', [S.geometry()], [MAT2()], { count: 260, area: 9, ...o }, (j, r, c) => c.setScalar(0.78 + r() * 0.4));
  }
  /** Wild flowers as two instanced meshes (stems, heads). o: {count, area, clear, seed, height, colors:[...], leaf, scale, heightAt}. */
  function flowerPatch(o = {}) {
    const seed = o.seed ?? 1, h = o.height ?? 0.3, St = new Soup(seed), Hd = new Soup(seed + 1), leaf = o.leaf || '#4f8a3c', cols = o.colors || ['#f4d23e', '#f2efe6', '#e2577d', '#8d6fd8', '#ef8a3c'];
    St.quad([-0.012, 0, 0], [0.012, 0, 0], [0.008, h, 0.02], [-0.008, h, 0.02], C(leaf)); St.quad([0, 0, -0.012], [0, 0, 0.012], [0, h, 0.028], [0, h, 0.012], C(leaf).clone().multiplyScalar(0.85));
    St.tri([0, h * 0.1, 0], [0.15, h * 0.5, 0.04], [0.03, h * 0.34, 0], C(leaf).clone().multiplyScalar(1.15)); St.tri([0, h * 0.18, 0], [-0.14, h * 0.6, -0.03], [-0.025, h * 0.44, 0], C(leaf)); St.tri([0, h * 0.05, 0], [0.02, h * 0.42, 0.13], [0, h * 0.3, 0.02], C(leaf).clone().multiplyScalar(0.9));
    const n = 5, pr = 0.09, c0 = [0, h + 0.012, 0.02];
    for (let k = 0; k < n; k++) { const a = k / n * TAU, a2 = (k + 1) / n * TAU, am = (a + a2) / 2; Hd.tri(c0, [sin(a) * pr * 0.45, h + 0.022, 0.02 + cos(a) * pr * 0.45], [sin(am) * pr, h + 0.035, 0.02 + cos(am) * pr], C('#ffffff')); Hd.tri(c0, [sin(am) * pr, h + 0.035, 0.02 + cos(am) * pr], [sin(a2) * pr * 0.45, h + 0.022, 0.02 + cos(a2) * pr * 0.45], C('#e9e9e9')); }
    Hd.geo(new T.OctahedronGeometry(0.03), '#4a3414', { at: [0, h + 0.035, 0.02] });
    return instField('flowerPatch', [St.geometry(), Hd.geometry()], [MAT2(), MAT2()], { count: 40, area: 1.6, scale: [0.7, 1.25], ...o }, (j, r, c) => j === 0 ? c.setScalar(0.85 + r() * 0.3) : c.set(pick(cols, r)).multiplyScalar(0.9 + r() * 0.2));
  }
  /** Reeds / cattails for pond and river edges. o: {count, size (clump radius), height, color, seed}. */
  function reeds(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 263 + 5), n = o.count ?? 12, W = o.size ?? 0.5, h = o.height ?? 1.5, S = new Soup(seed), leaf = C(o.color || '#6b8f45');
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * W, x = sin(a) * d, z = cos(a) * d, hh = h * (0.6 + r() * 0.5), la = r() * TAU, lean = 0.05 + r() * 0.16, w = 0.022, px = cos(la), pz = -sin(la);
      const p0 = [x, 0, z], p1 = [x + sin(la) * lean * hh * 0.4, hh * 0.55, z + cos(la) * lean * hh * 0.4], p2 = [x + sin(la) * lean * hh, hh, z + cos(la) * lean * hh], L = (q, s) => [q[0] + px * w * s, q[1], q[2] + pz * w * s], c = tone(leaf, 0.16, 0.02, r);
      S.quad(L(p0, -1), L(p0, 1), L(p1, 0.8), L(p1, -0.8), c.clone().multiplyScalar(0.8)); S.tri(L(p1, -0.8), L(p1, 0.8), p2, c);
      if (i % 3 === 0) { S.sweep([[x, 0, z], [x, hh * 0.92, z]], 0.012, 3, '#7a8a4a', {}); S.sweep([[x, hh * 0.92, z], [x, hh * 0.92 + 0.2, z]], 0.035, 5, '#5a3c26', { vary: 0.1, capA: true }); S.sweep([[x, hh * 0.92 + 0.2, z], [x, hh * 0.92 + 0.3, z]], 0.006, 3, '#7a8a4a', {}); }
    }
    return plant('reeds', { trunk: null, parts: [{ soup: S, pivot: [0, 0, 0], w: 1, mat: MAT2() }], flex: [0.03, 0.05, 1.4], height: h, radius: W }, o);
  }

  // ---------- cliffs, arch, cave ----------
  const strata = (S, cols, band, seed, amt = 1) => { const list = [].concat(cols).map(C); return S.paint((ce, n, i, c) => { const b = flr(ce[1] / band + n2(ce[0] * 0.15, ce[2] * 0.15, seed) * 1.6 + 50); return new T.Color(c[i], c[i + 1], c[i + 2]).lerp(tone(list[b % list.length], 0.07, 0.006, S.r), amt); }); };
  /** A rock face. o: {width, height, depth, color (one or a list of strata colours), grass (top colour or false), ends: 'taper' | 'cut', rubble, seed}. */
  function cliff(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 269 + 7), W = o.width ?? 16, H = o.height ?? 10, D = o.depth ?? 6, cols = o.cols ?? Math.max(4, Math.round(W / 1.4)), rows = o.rows ?? Math.max(4, Math.round(H / 1.1));
    const rockC = o.color || ['#8f867a', '#756e65', '#a0968a', '#6b655d', '#877e72'], S = new Soup(seed), taper = (o.ends || 'taper') === 'taper';
    const setb = [0]; for (let j = 1; j <= rows; j++) setb.push(setb[j - 1] + (r() < 0.22 ? 0.5 + r() * 0.6 : (r() - 0.55) * 0.3));       // mostly sheer, a few ledges, slight overhangs
    const lo = Math.min(...setb), sc = Math.min(1, D * 0.45 / Math.max(0.01, Math.max(...setb) - lo)), G = [];
    for (let i = 0; i <= cols; i++) {
      G.push([]); const u = i / cols, e = Math.min(u, 1 - u), top = H * (taper ? 0.7 + 0.3 * sm(e / 0.25) : 1) * (0.9 + 0.2 * n2(u * 3.1, 0.5, seed)), bulge = (n2(u * cols * 0.5, 2.5, seed) - 0.5) * 2.6, x0 = (u - 0.5) * W;
      for (let j = 0; j <= rows; j++) { const v = j / rows, jx = (i > 0 && i < cols) ? (r() - 0.5) * W / cols * 0.45 : 0, jy = (j > 0 && j < rows) ? (r() - 0.5) * top / rows * 0.22 : 0; G[i].push([x0 + jx, v * top + jy, D / 2 - (setb[j] - lo) * sc - 0.3 + bulge * (0.55 + 0.45 * (1 - v)) + (r() - 0.5) * 0.3 - (taper ? (1 - sm(e / 0.12)) * D * 0.2 : 0)]); }
    }
    S.surf(cols, rows, (u, v, i, j) => G[i][j], rockC[0], { vary: 0.1 });
    const zb = -D / 2, B = G.map(c => [c[rows][0], c[rows][1] + (r() - 0.5) * 0.4, zb]), M = G.map((c, i) => [c[rows][0], (c[rows][1] + B[i][1]) / 2 + (r() - 0.3) * 0.5, (c[rows][2] + zb) / 2]);
    S.surf(cols, 2, (u, v, i, j) => j === 0 ? G[i][rows] : j === 1 ? M[i] : B[i], rockC[0], { vary: 0.1 });
    S.surf(1, rows, (u, v, i, j) => i === 0 ? [G[0][j][0], G[0][j][1], zb] : G[0][j], rockC[0], { vary: 0.1 });
    S.surf(1, rows, (u, v, i, j) => i === 0 ? G[cols][j] : [G[cols][j][0], G[cols][j][1], zb], rockC[0], { vary: 0.1 });
    S.surf(cols, 1, (u, v, i, j) => j === 0 ? [G[cols - i][0][0], 0, zb] : B[cols - i], rockC[0], {});
    strata(S, rockC, H / 8, seed); S.lit(0, H, 0.78, 1.06, 0.2);
    if (o.grass !== false) S.top(o.grass || '#5f8540', 1, 0.62);
    if (o.snow) S.top('#f1f5fb', o.snow, 0.4);
    if (o.rubble !== false) { const n = Math.round(W / 2.6); for (let i = 0; i < n; i++) { const u = (i + r()) / n, c = G[Math.round(u * cols)][0], sz = 0.6 + r() * 1.3; const R2 = new Soup(seed + i + 3); rockInto(R2, sz, seed * 5 + i, { color: pick(rockC, r), detail: sz < 0.9 ? 0 : 1 }); R2.lit(0, sz * 0.5, 0.75, 1.05, 0.12); S.add(R2, { at: [c[0], 0, c[2] + sz * (0.2 + r() * 0.5)] }); } }
    const g = group('cliff', S.mesh()); Object.assign(g.userData, { width: W, height: H, depth: D }); return g;
  }
  /** Free-standing natural rock arch you can walk through. o: {span (opening width), height (top of the arch), thick, color (list = strata), grass, seed}. */
  function rockArch(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 271 + 3), span = o.span ?? 4.5, H = o.height ?? 6, Tk = o.thick ?? 1.7, rockC = o.color || ['#9a8f80', '#877d70', '#a39887', '#7d7468'], S = new Soup(seed);
    const N = 13, a = span / 2 + Tk * 0.55, b = H - Tk * 0.4, pts = [], rad = [], lop = (r() - 0.5) * 0.5;
    for (let i = 0; i <= N; i++) { const th = i / N * PI, sx = -cos(th), sy = Math.pow(sin(th), 0.62); pts.push([sx * a * (1 + lop * sx * 0.25) + (r() - 0.5) * 0.25, i === 0 || i === N ? -0.5 : sy * b * (1 + lop * sx * 0.12), (r() - 0.5) * 0.5]); rad.push(Tk * (0.72 - 0.26 * sy + (sx < 0 ? 0.14 : 0) * (1 - sy)) * (0.88 + r() * 0.24)); }
    S.sweep(pts, rad, 7, rockC[0], { vary: 0.1, jit: 0.13, flat: 1.25 });
    const lump = (x, y, z, sz, i) => { const R2 = new Soup(seed + i); rockInto(R2, sz, seed * 7 + i, { color: rockC[0], squash: [1, 0.75, 0.9], sink: 0.3 }); S.add(R2, { at: [x, y, z] }); };
    lump(pts[4][0] - 0.3, pts[4][1] + rad[4] * 0.3, 0.2, Tk * 1.3, 1); lump(-a - Tk * 0.5, 0, 0.5, Tk * 1.25, 2); lump(a + Tk * 0.35, 0, -0.4, Tk * 0.9, 3); lump(a - Tk * 0.2, 0, 0.9, Tk * 0.5, 4); lump(-a + Tk * 0.4, 0, -0.9, Tk * 0.55, 5);
    strata(S, rockC, 0.8, seed); S.lit(0, H, 0.8, 1.06, 0.16); if (o.grass !== false) S.top(o.grass || '#66873f', 0.85, 0.72, { above: H * 0.55 }); if (o.snow) S.top('#f1f5fb', o.snow, 0.4);
    const g = group('rockArch', S.mesh()); Object.assign(g.userData, { span, height: H, clear: b - Tk * 0.45 }); return g;
  }
  /** A cave entrance in a rock mound; the inside fades to black. o: {width, height, depth, openW, openH, color, grass, dark, fangs, seed}. userData.mouth = centre of the opening. */
  function caveMouth(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 277 + 9), W = o.width ?? 11, H = o.height ?? 6.5, D = o.depth ?? 8, ow = o.openW ?? 3.4, oh = o.openH ?? 3.5, rockC = o.color || ['#7f7a72', '#6e6a64', '#8b857b', '#77716a'];
    const S = new Soup(seed), n = 14, R = 4, zf = D / 2, open = [], rim = [], ring = [];
    for (let i = 0; i <= n; i++) {
      const th = i / n * PI, cx = -cos(th), sy = sin(th), e = i === 0 || i === n;
      open.push([cx * ow / 2 * (1 + (e ? 0 : (r() - 0.5) * 0.16)) * (1 - 0.12 * sy * sy), Math.pow(sy, 0.6) * oh * (1 + (r() - 0.5) * 0.1), zf - 0.5 + (r() - 0.5) * 0.3]);
      rim.push([cx * W / 2 * (0.92 + r() * 0.16), Math.pow(sy, 0.75) * H * (0.86 + r() * 0.22), zf - D * 0.36 + (r() - 0.5) * 0.6]);
    }
    for (let k = 0; k <= R; k++) { const v = k / R; ring.push(open.map((p, i) => { if (k === 0) return p; if (k === R) return rim[i]; const q = vlerp(p, rim[i], Math.pow(v, 0.85)), e = i === 0 || i === n; return [q[0] + (e ? 0 : (r() - 0.5) * 0.5), q[1] + (e ? 0 : (r() - 0.5) * 0.4), zf - 0.5 + sin(v * PI) * 0.7 - v * v * (zf - 0.5 - rim[i][2]) + (r() - 0.5) * 0.35]; })); }
    S.surf(n, R, (u, v, i, j) => ring[j][i], rockC[0], { vary: 0.1 });
    const back = [0.82, 0.5].map((sc2, k) => rim.map((p, i) => [p[0] * sc2 * (0.95 + r() * 0.1), p[1] * (k ? 0.5 : 0.86) * (0.95 + r() * 0.1), k ? -D / 2 + 0.3 : -D * 0.12]));
    S.surf(n, 2, (u, v, i, j) => j === 0 ? rim[i] : back[j - 1][i], rockC[0], { vary: 0.1 });
    const bc = [0, 0, -D / 2]; for (let i = 0; i < n; i++) S.tri(bc, back[1][i + 1], back[1][i], S.sh(rockC[0], 0.1));
    strata(S, rockC, 1.0, seed); S.lit(0, H, 0.78, 1.06, 0.16); if (o.grass !== false) S.top(o.grass || '#5f8540', 0.95, 0.66, { above: oh * 0.8 }); if (o.snow) S.top('#f1f5fb', o.snow, 0.4);
    // the throat: walls and floor that fade to black
    const dark = C(o.dark || '#020203'), zs = [0, -1.2, -3, -5.5], sh = [1, 0.9, 0.74, 0.5], fade = [0.5, 0.82, 0.96, 1], wall = C(rockC[1]);
    S.surf(n, 3, (u, v, i, j) => [open[i][0] * sh[j], open[i][1] * sh[j], open[i][2] + zs[j]], null, { flip: true, col: (u, v, i, j) => wall.clone().lerp(dark, (fade[j] + fade[j + 1]) / 2), vary: 0.08 });
    for (let i = 0; i < n; i++) S.tri([0, oh * 0.25, open[0][2] + zs[3]], [open[i + 1][0] * sh[3], open[i + 1][1] * sh[3], open[i + 1][2] + zs[3]], [open[i][0] * sh[3], open[i][1] * sh[3], open[i][2] + zs[3]], dark);
    for (let j = 0; j < 3; j++) S.quad([open[0][0] * sh[j], 0.03, open[0][2] + zs[j]], [open[n][0] * sh[j], 0.03, open[n][2] + zs[j]], [open[n][0] * sh[j + 1], 0.03, open[n][2] + zs[j + 1]], [open[0][0] * sh[j + 1], 0.03, open[0][2] + zs[j + 1]], C(o.floor || '#4a443c').clone().lerp(dark, (fade[j] + fade[j + 1]) / 2));
    for (let i = 0, nf = o.fangs || 0; i < nf; i++) { const p = open[3 + flr((i + 0.5) / nf * (n - 6))], L = 0.35 + r() * 0.5; S.sweep([[p[0], p[1] + 0.2, p[2] - 0.25], [p[0] + (r() - 0.5) * 0.1, p[1] - L, p[2] - 0.2]], [0.13, 0.015], 5, rockC[2], { vary: 0.1, capB: false }); }
    const side = (x, z, sz, i) => { const R2 = new Soup(seed + i); rockInto(R2, sz, seed * 11 + i, { color: pick(rockC, r) }); R2.lit(0, sz * 0.5, 0.75, 1.05, 0.12); S.add(R2, { at: [x, 0, z] }); };
    side(-ow * 0.5 - 1.0, zf + 0.3, 1.5, 1); side(ow * 0.5 + 1.3, zf + 0.1, 1.1, 2); side(ow * 0.5 + 2.3, zf + 0.8, 0.6, 3); side(-ow * 0.5 - 2.4, zf + 0.7, 0.7, 4);
    const g = group('caveMouth', S.mesh()); Object.assign(g.userData, { mouth: [0, oh * 0.45, zf - 0.5], openW: ow, openH: oh }); return g;
  }

  // ---------- distant backdrops ----------
  const tri01 = x => 1 - Math.abs(2 * (x - flr(x)) - 1);
  function ridgeRing(type, o, d) {
    const seed = o.seed ?? 1, R = o.radius ?? d.radius, H = o.height ?? d.height, N = o.segments ?? d.segments, layers = o.layers ?? d.layers, arc = o.arc || [0, TAU], full = Math.abs(arc[1] - arc[0] - TAU) < 1e-3;
    const rockC = C(o.color || d.color), baseC = C(o.base || d.base), snowC = C(o.snow || '#f3f6fb'), hazeC = C(o.haze || '#c9dbea'), hz = o.hazeAmount ?? d.haze, snowLine = o.snowLine ?? d.snowLine, sharp = o.sharp ?? d.sharp;
    const g = group(type);
    for (let L = 0; L < layers; L++) {
      const r = rng(seed * 283 + L * 17 + 1), S = new Soup(seed + L * 5), RL = R * (1 + L * 0.42), HL = H * (1 + L * 0.55), p1 = r() * 9, p2 = r() * 9, p3 = r() * 9, f1 = d.peaks + flr(r() * 3), f2 = d.peaks * 2 + 3 + flr(r() * 4), hzL = clamp(hz + L * 0.22);
      const hAt = t => { const pk = sharp * (0.62 * Math.pow(tri01(t * f1 + p1), 1.3) + 0.38 * tri01(t * f2 + p2)) + (1 - sharp) * (0.5 + 0.3 * sin(t * TAU * f1 + p1) + 0.2 * sin(t * TAU * f2 + p2)); return HL * (0.22 + 0.78 * pk) * (0.62 + 0.76 * tri01(t * 2 + p3)); };
      const rows = 3, ring = [];
      for (let i = 0; i <= N; i++) {
        const t = (full && i === N) ? 0 : i / N, a = arc[0] + (i / N) * (arc[1] - arc[0]), h = hAt(t) * (0.92 + r() * 0.16), wIn = h * 1.15 + R * 0.08, col = [];
        for (let j = 0; j <= rows; j++) { const v = j / rows, jz = (j > 0 && j < rows) ? (i % 2 ? 1 : -1) * 0.35 / N * TAU * (0.5 + r()) : 0, dd = RL - wIn * (1 - v) + (j === rows ? (r() - 0.5) * R * 0.05 : (r() - 0.5) * wIn * 0.12); col.push([sin(a + jz) * dd, j === 0 ? -4 : h * Math.pow(v, 1.25) * (j < rows ? 0.85 + r() * 0.3 : 1), cos(a + jz) * dd]); }
        ring.push(col);
      }
      if (full) ring[N] = ring[0];
      S.surf(N, rows, (u, v, i, j) => ring[i][j], rockC, { flip: true, vary: 0.07 });
      S.paint((ce, n) => { const hh = ce[1] / HL, k = sm((hh - 0.08) / 0.3), c = baseC.clone().lerp(rockC, k).multiplyScalar(0.9 + S.r() * 0.2); if (hh > snowLine + (S.r() - 0.5) * 0.12) c.lerp(snowC, 0.92); return c.lerp(hazeC, clamp(hzL * (1.15 - 0.4 * hh))); });
      if (d.trees && o.trees !== false && L === 0) {          // patches of forest on the slopes
        const tc = C(o.treeColor || '#2f5238').clone().lerp(hazeC, hzL * 0.55), nc = o.treeCount ?? 260; let ci = 0, v0 = 0.5;
        for (let i = 0; i < nc; i++) { if (i % 14 === 0) { ci = flr(r() * N); v0 = 0.3 + r() * 0.5; } const cc = (ci + flr(r() * 3)) % N, v = clamp(v0 + (r() - 0.5) * 0.3, 0.1, 0.95), c0 = ring[cc], c1 = ring[cc + 1], fj = v * rows, j = Math.min(rows - 1, flr(fj)), pa = vlerp(vlerp(c0[j], c0[j + 1], fj - j), vlerp(c1[j], c1[j + 1], fj - j), r()), th = 5 + r() * 4.5; S.geo(new T.ConeGeometry(th * 0.3, th, 4).translate(0, th * 0.45, 0), tc, { at: pa, rot: [0, r() * 3, 0], vary: 0.14 }); }
      }
      const m = S.mesh(MATFAR()); m.castShadow = m.receiveShadow = false; m.frustumCulled = false; g.add(m);
    }
    Object.assign(g.userData, { radius: R, height: H }); return g;
  }
  /** Ring of distant peaks around the set (not fogged; hazed by its own colours). o: {radius, height, segments, layers, color, base, snow, snowLine (0..1 of height, >1 = none), haze, hazeAmount, arc:[from, to], seed}. */
  const mountains = (o = {}) => ridgeRing('mountains', o, { radius: 330, height: 100, segments: 132, layers: 2, color: '#56616f', base: '#465a52', snowLine: 0.66, haze: 0.3, sharp: 1, peaks: 7 });
  /** Ring of rounded wooded hills. Same options as mountains() plus trees:false, treeCount, treeColor. */
  const hills = (o = {}) => ridgeRing('hills', o, { radius: 170, height: 26, segments: 60, layers: 1, color: '#5d8348', base: '#4d7340', snowLine: 9, haze: 0.22, sharp: 0, trees: true, peaks: 3 });

  function cloudSoup(seed, W, o = {}) {
    const S = new Soup(seed), r = S.r, n = 5 + flr(r() * 3), white = C(o.color || '#ffffff'), shade = C(o.shade || '#a9b9cf'); let top = 0;
    for (let i = 0; i < n; i++) { const u = n > 1 ? i / (n - 1) : 0.5, rr = W * (0.12 + 0.13 * sin(u * PI) + r() * 0.05), y = rr * (0.5 + r() * 0.25); S.blob(rr, white, seed * 3 + i, { at: [(u - 0.5) * W * 0.78 + (r() - 0.5) * W * 0.08, y, (r() - 0.5) * W * 0.28], squash: [1.2, 0.82, 1], octa: i % 2 === 1, detail: 1, bump: 0.15, vary: 0.025 }); top = Math.max(top, y + rr * 0.82); }
    S.floor(0).paint((ce, n) => white.clone().lerp(shade, clamp(1 - sm(ce[1] / (top * 0.6)) + Math.max(0, -n[1]) * 0.5) * 0.85).multiplyScalar(0.97 + r() * 0.06));
    return S;
  }
  /** One cumulus cloud, flat-bottomed. o: {size (width m), color, shade, seed}. */
  function cloud(o = {}) { const m = cloudSoup(o.seed ?? 1, o.size ?? 30, o).mesh(MATFAR()); m.castShadow = m.receiveShadow = false; return group('cloud', m); }
  /** A sky full of drifting clouds. o: {count, area (half-extent m), height:[lo, hi], size:[min, max], speed (m/s), dir (radians, 0 = toward +Z), color, shade, seed}. userData.drift(lt). */
  function clouds(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 293 + 1), n = o.count ?? 12, A = o.area ?? 420, hh = o.height || [85, 140], ss = o.size || [45, 95], spd = o.speed ?? 2.5, dir = o.dir ?? PI / 2, g = group('clouds');
    const geos = [0, 1, 2, 3].map(i => cloudSoup(seed * 5 + i, 1, o).geometry()), items = [];
    for (let i = 0; i < n; i++) { const m = new T.Mesh(geos[i % 4], MATFAR()), sc = lerp(ss[0], ss[1], r()); m.scale.set(sc, sc * (0.8 + r() * 0.4), sc); m.rotation.y = (r() < 0.5 ? PI : 0) + (r() - 0.5) * 0.5; m.frustumCulled = false; g.add(m); items.push({ m, x: (r() - 0.5) * 2 * A, z: (r() - 0.5) * 2 * A, y: lerp(hh[0], hh[1], r()), v: 0.7 + r() * 0.6 }); }
    g.userData.items = items;
    g.userData.drift = (lt, speed = spd) => { for (const q of items) { const d = lt * speed * q.v; q.m.position.set(mod(q.x + sin(dir) * d + A, 2 * A) - A, q.y, mod(q.z + cos(dir) * d + A, 2 * A) - A); } return g; };
    g.userData.animate = lt => g.userData.drift(lt); g.userData.drift(0); return g;
  }

  // ---------- water ----------
  function waveSet(o, seed) {
    const r = rng(seed * 71 + 3), amp = o.amp ?? 0.03, len = o.len ?? 3, dir = o.dir ?? 0.6, spd = o.speed ?? 1, W = [];
    for (const [l, a, da] of [[1, 0.5, 0], [0.62, 0.3, 0.7], [0.37, 0.2, -0.9], [1.7, 0.35, 0.3]]) { const k = TAU / (len * l), d = dir + da * (o.spread ?? 1) + (r() - 0.5) * 0.3; W.push({ dx: sin(d), dz: cos(d), k, w: spd * 0.55 * Math.sqrt(9.8 * k), a: amp * a, p: r() * TAU }); }
    return W;
  }
  const waveH = (W, x, z, t) => { let y = 0; for (const w of W) y += w.a * sin((x * w.dx + z * w.dz) * w.k - t * w.w + w.p); return y; };
  const _sky = new Map();
  /** Tiny sky gradient the water reflects (equirectangular). */
  function skyEnv(hor, top, under) {
    const key = hor + top + under; let t = _sky.get(key); if (t) return t;
    t = S3.canvasTex(8, 64, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h), H = C(hor), Tp = C(top), st = (y, k) => g.addColorStop(y, '#' + H.clone().lerp(Tp, k).getHexString()); st(0, 1); st(0.25, 0.83); st(0.39, 0.55); st(0.455, 0.34); st(0.5, 0); g.addColorStop(0.505, under); g.addColorStop(1, under); c.fillStyle = g; c.fillRect(0, 0, w, h); });
    t.mapping = T.EquirectangularReflectionMapping; _sky.set(key, t); return t;
  }
  /** Animated faceted water from vertices [x, z, amp 0..1, shade 0 deep..1 shallow..2 foam, far 0..1] and index triples. Normals are exaggerated (choppy) so small waves still glitter. */
  function waterMesh(verts, tris, o, seed) {
    for (const t of tris) { const a = verts[t[0]], b = verts[t[1]], c = verts[t[2]]; if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) { const q = t[1]; t[1] = t[2]; t[2] = q; } }
    const nT = tris.length, pos = new Float32Array(nT * 9), nor = new Float32Array(nT * 9), col = new Float32Array(nT * 9), hg = new Float32Array(verts.length), r = rng(seed * 89 + 1);
    const deep = C(o.color || '#2c6a8a'), shal = C(o.shallow || '#5fb3ad'), foam = C(o.foam || '#eef7f6'), farC = C(o.horizon || '#8fb6cc'), tmp = new T.Color(), crest = o.crest ?? 0, crestC = C(o.crestColor || o.shallow || '#5fb3ad');
    for (let i = 0; i < nT; i++) { const f = 1 + (r() - 0.5) * 2 * (o.vary ?? 0.05); for (let j = 0; j < 3; j++) { const v = verts[tris[i][j]], q = i * 9 + j * 3, sh = v[3] || 0; pos[q] = v[0]; pos[q + 2] = v[1]; tmp.copy(deep).lerp(shal, clamp(sh)); if (sh > 1) tmp.lerp(foam, clamp(sh - 1)); if (v[4]) tmp.lerp(farC, v[4]); col[q] = tmp.r * f; col[q + 1] = tmp.g * f; col[q + 2] = tmp.b * f; nor[q + 1] = 1; } }
    const col0 = crest ? col.slice() : null;
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeBoundingSphere();
    const sky = o.sky || ['#bcd9ec', '#3f78b8'], refl = o.reflect ?? 1;
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: o.rough ?? 0.16, metalness: o.metal ?? 0.3, transparent: true, opacity: o.opacity ?? 0.86, depthWrite: false });
    if (refl > 0) { mat.envMap = skyEnv(sky[0], sky[1], '#' + deep.getHexString()); mat.envMapIntensity = refl; }
    const m = new T.Mesh(g, mat); m.receiveShadow = true; m.renderOrder = 2;
    const W = waveSet(o, seed), chop = o.choppy ?? 4, top = W.reduce((a, w) => a + w.a, 0) * 0.8 || 1, cen = tris.map(t => { const a = verts[t[0]], b = verts[t[1]], c = verts[t[2]]; return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]; });
    const animate = lt => {
      for (let i = 0; i < verts.length; i++) hg[i] = verts[i][2] * waveH(W, verts[i][0], verts[i][1], lt);
      for (let i = 0; i < nT; i++) {
        const t = tris[i], c = cen[i], q = i * 9; pos[q + 1] = hg[t[0]]; pos[q + 4] = hg[t[1]]; pos[q + 7] = hg[t[2]];
        let gx = 0, gz = 0; for (const w of W) { const cc = w.a * w.k * cos((c[0] * w.dx + c[1] * w.dz) * w.k - lt * w.w + w.p); gx += cc * w.dx; gz += cc * w.dz; }
        gx *= c[2] * chop; gz *= c[2] * chop; const l = 1 / Math.sqrt(gx * gx + gz * gz + 1);
        for (let j = 0; j < 9; j += 3) { nor[q + j] = -gx * l; nor[q + j + 1] = l; nor[q + j + 2] = -gz * l; }
        if (crest) { const k = crest * sm(((pos[q + 1] + pos[q + 4] + pos[q + 7]) / 3 / top - 0.42) / 0.4); for (let j = 0; j < 9; j += 3) { col[q + j] = col0[q + j] + (crestC.r - col0[q + j]) * k; col[q + j + 1] = col0[q + j + 1] + (crestC.g - col0[q + j + 1]) * k; col[q + j + 2] = col0[q + j + 2] + (crestC.b - col0[q + j + 2]) * k; } }
      }
      g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; if (crest) g.attributes.color.needsUpdate = true;
    };
    animate(0); m.userData.animate = animate; m.userData.heightAt = (x, z, lt) => waveH(W, x, z, lt);
    return m;
  }
  /** Jittered grid over [x0,x1] x [z0,z1] with alternating diagonals. keep(x, z) -> false drops a vertex; snap(x, z) may move it. */
  function gridTris(x0, x1, z0, z1, nx, nz, r, mapV, jit = 0.3) {
    const verts = [], id = [], tris = [], dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;
    for (let i = 0; i <= nx; i++) { id.push([]); for (let j = 0; j <= nz; j++) { const e = i === 0 || i === nx || j === 0 || j === nz, v = mapV(x0 + i * dx + (e ? 0 : (r() - 0.5) * 2 * jit * dx), z0 + j * dz + (e ? 0 : (r() - 0.5) * 2 * jit * dz), i, j); id[i].push(v ? verts.push(v) - 1 : -1); } }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const a = id[i][j], b = id[i + 1][j], c = id[i + 1][j + 1], d = id[i][j + 1], add = (p, q, s) => { if (p >= 0 && q >= 0 && s >= 0) tris.push([p, q, s]); }; if ((i + j) % 2) { add(a, b, d); add(b, c, d); } else { add(a, b, c); add(a, c, d); } }
    return { verts, tris };
  }
  const outline = (R, seed, wob = 1) => { const r = rng(seed * 97 + 5), p = [r() * TAU, r() * TAU, r() * TAU]; return a => R * (1 + wob * (0.14 * sin(2 * a + p[0]) + 0.08 * sin(3 * a + p[1]) + 0.045 * sin(5 * a + p[2]))); };
  /** Still water with a shore: the base of pond() and lake(). */
  function basin(type, o, d) {
    const seed = o.seed ?? 1, r = rng(seed * 307 + 3), R = o.radius ?? d.radius, Rf = outline(R, seed, o.wobble ?? 1), wl = o.level ?? d.level, crest = wl + (o.bank ?? d.bank), cell = o.cell ?? d.cell, n = Math.max(6, Math.round(R * 2.4 / cell));
    const ang = (x, z) => Math.atan2(x, z);
    const gr = gridTris(-R * 1.2, R * 1.2, -R * 1.2, R * 1.2, n, n, r, (x, z) => { const dd = hyp(x, z), lim = Rf(ang(x, z)) * 1.04; if (dd > lim + cell * 1.5) return null; const k = dd > lim ? lim / dd : 1, u = Math.min(1, dd / lim); return [x * k, z * k, 1 - 0.75 * sm((u - 0.6) / 0.4), sm((u - 0.5) / 0.45) * 1.0]; });
    const water = waterMesh(gr.verts, gr.tris, { amp: d.amp, len: d.len, choppy: d.choppy, ...o }, seed); water.position.y = wl;
    const S = new Soup(seed), ns = Math.max(14, Math.round(R * 1.6)), rm = [0, 0.5, 0.8, 0.93, 1.0, 1.05, 1.13 + 0.5 / R], ys = [0.012, 0.012, 0.012, wl - 0.015, crest, crest * 0.8, -0.03];
    const bed = C(o.bed || d.bed), wet = C(o.wet || d.wet), dry = C(o.shore || d.shore), bandC = [bed, bed.clone().lerp(wet, 0.6), wet, wet.clone().lerp(dry, 0.5), dry, dry.clone().multiplyScalar(0.92)];
    S.surf(ns, 6, (u, v, i, j) => { const a = (i % ns) / ns * TAU, e = j >= 4 ? 1 + ((i * 7 + j * 3) % 5 - 2) * 0.02 : 1, dd = Rf(a) * rm[j] * e; return [sin(a) * dd, ys[j] * (j === 4 ? 0.8 + ((i * 13) % 7) / 14 : 1), cos(a) * dd]; }, null, { flip: true, col: (u, v, i, j) => bandC[j], vary: 0.07 });
    const shore = S.mesh(MATDECAL()); shore.castShadow = false;
    const g = group(type, shore, water), G2 = new Soup(seed + 3), nt = o.tufts ?? Math.round(8 + R * 2.2);
    for (let i = 0; i < nt; i++) { const a = r() * TAU, dd = Rf(a) * (1.04 + r() * (0.1 + 0.5 / R)), th = (d.tuft || 0.3) * (0.7 + r() * 0.7); G2.add(tuftSoup(seed * 17 + i, th, o.grass || '#4d7b39', o.grass2 || '#93b556', 7, 0.1), { at: [sin(a) * dd, 0.02, cos(a) * dd], rot: [0, r() * TAU, 0] }); }
    if (G2.tris) { const gm = G2.mesh(MAT2()); gm.castShadow = false; g.add(gm); }
    Object.assign(g.userData, { water, radius: R, level: wl, outline: Rf, animate: lt => water.userData.animate(lt), heightAt: (x, z, lt) => wl + water.userData.heightAt(x, z, lt), edge: a => { const dd = Rf(a); return [sin(a) * dd, 0, cos(a) * dd]; } });
    return g;
  }
  /** Small pond with a muddy bank, reeds, stones and lily pads. o: {radius, color, shallow, shore, wet, bed, reeds, lilies, stones, amp, len, speed, seed}. userData.animate(lt). */
  function pond(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 311 + 7), g = basin('pond', o, { radius: 3.6, level: 0.07, bank: 0.09, cell: 0.75, amp: 0.012, len: 1.5, choppy: 9, bed: '#1f3b3d', wet: '#4b4334', shore: '#6d6748', tuft: 0.34 }), U = g.userData, R = U.radius;
    const sw = [];
    for (let i = 0, n = o.reeds ?? 4; i < n; i++) { const a = seed + i * 1.9 + r() * 0.8, p = U.edge(a), k = 0.9 + r() * 0.08, rd = reeds({ seed: seed * 3 + i, count: 9 + flr(r() * 6), size: 0.4 + r() * 0.25, height: 1.2 + r() * 0.5 }); rd.position.set(p[0] * k, 0.04, p[2] * k); g.add(rd); sw.push(rd); }
    const S = new Soup(seed + 1);
    for (let i = 0, n = o.stones ?? 5; i < n; i++) { const a = seed * 2 + i * 1.3 + r(), p = U.edge(a), k = 1.0 + r() * 0.1, R2 = new Soup(seed + i); rockInto(R2, 0.3 + r() * 0.4, seed * 9 + i, { detail: 0 }); R2.lit(0, 0.3, 0.75, 1.05, 0.12); S.add(R2, { at: [p[0] * k, 0.05, p[2] * k] }); }
    if (S.tris) g.add(S.mesh());
    const L = new Soup(seed + 2);
    for (let i = 0, n = o.lilies ?? 6; i < n; i++) { const a = r() * TAU, dd = U.outline(a) * (0.25 + r() * 0.5), x = sin(a) * dd, z = cos(a) * dd, pr = 0.16 + r() * 0.1, a0 = r() * TAU, c = tone('#4f8f45', 0.12, 0.02, r); for (let k = 0; k < 6; k++) { const a1 = a0 + k / 7 * TAU, a2 = a0 + (k + 1) / 7 * TAU; L.tri([x, 0, z], [x + sin(a1) * pr, 0, z + cos(a1) * pr], [x + sin(a2) * pr, 0, z + cos(a2) * pr], c); } if (i % 3 === 0) L.geo(new T.OctahedronGeometry(0.06), i % 2 ? '#f4e9f0' : '#f1b8cf', { at: [x, 0.04, z], scl: [1, 0.7, 1] }); }
    if (L.tris) { const lm = L.mesh(MAT2()); lm.position.y = U.level + 0.03; lm.castShadow = false; lm.renderOrder = 3; g.add(lm); }
    const base = U.animate; U.reeds = sw; U.animate = lt => { base(lt); sw.forEach(q => q.userData.sway(lt, o.wind ?? 1)); };
    return g;
  }
  /** A lake with a pebbly shore. o: {radius, color, shallow, shore, wet, bed, amp, len, speed, wobble, seed}. userData.animate(lt), heightAt(x, z, lt), edge(angle). */
  const lake = (o = {}) => basin('lake', o, { radius: 30, level: 0.12, bank: 0.16, cell: 2.2, amp: 0.035, len: 5, choppy: 3.5, bed: '#17323c', wet: '#6d6756', shore: '#a39a80' });
  /** A river running along X (flowing toward +X), with banks. o: {length, width, meander, color, shallow, shore, wet, bed, amp, len, speed, seed}. userData.animate(lt), centre(x) -> z. */
  function river(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 313 + 9), L = o.length ?? 60, Wd = o.width ?? 7, me = o.meander ?? 2.2, wl = o.level ?? 0.1, crest = wl + (o.bank ?? 0.16), ph = r() * TAU, per = o.period ?? 38;
    const mz = x => me * sin(x * TAU / per + ph) + me * 0.35 * sin(x * TAU / (per * 0.43) + ph * 2), nx = Math.round(L / 1.5), nz = Math.max(4, Math.round(Wd / 1.4));
    const gr = gridTris(-L / 2, L / 2, -0.52, 0.52, nx, nz, r, (x, t) => { const e = Math.abs(t) * 2; return [x, mz(x) + t * Wd, 1 - 0.7 * sm((e - 0.6) / 0.4), sm((e - 0.45) / 0.5)]; }, 0.28);
    const water = waterMesh(gr.verts, gr.tris, { amp: 0.022, len: 2.4, choppy: 8, dir: PI / 2, spread: 0.45, speed: 1.3, ...o }, seed); water.position.y = wl;
    const S = new Soup(seed), bed = C(o.bed || '#1c3a40'), wet = C(o.wet || '#5a5343'), dry = C(o.shore || '#8f8468'), ts = [-0.72, -0.56, -0.5, -0.44, -0.3, 0, 0.3, 0.44, 0.5, 0.56, 0.72], ys = [-0.03, crest * 0.8, crest, wl - 0.015, 0.012, 0.012, 0.012, wl - 0.015, crest, crest * 0.8, -0.03];
    const bc = [dry.clone().multiplyScalar(0.92), dry, wet.clone().lerp(dry, 0.5), wet, bed, bed, wet, wet.clone().lerp(dry, 0.5), dry, dry.clone().multiplyScalar(0.92)], ns = Math.round(L / 2);
    S.surf(ns, 10, (u, v, i, j) => { const x = (u - 0.5) * L, wob = (j <= 2 || j >= 8) ? ((i * 7 + j) % 5 - 2) * 0.05 : 0; return [x, ys[j] * (j === 2 || j === 8 ? 0.8 + ((i * 13) % 7) / 14 : 1), mz(x) + (ts[j] + wob * Math.sign(ts[j])) * Wd - Math.sign(ts[j]) * (Math.abs(ts[j]) > 0.6 ? 0.7 : 0)]; }, null, { flip: true, col: (u, v, i, j) => bc[j], vary: 0.07 });
    const shore = S.mesh(MATDECAL()); shore.castShadow = false;
    const g = group('river', shore, water);
    Object.assign(g.userData, { water, length: L, width: Wd, level: wl, centre: mz, animate: lt => water.userData.animate(lt), heightAt: (x, z, lt) => wl + water.userData.heightAt(x, z, lt) });
    return g;
  }
  /** Open sea out to the horizon, with real swell near the origin. Do not add s.ground() above it. o: {size, level, color, shallow, amp, len, speed, dir, detail (m of fine waves), seed}. userData.animate(lt), heightAt(x, z, lt). */
  function sea(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 317 + 1), size = o.size ?? 1400, n = o.seg ?? 48, half = size / 2, cell = o.cell ?? 2, lvl = o.level ?? 0, fade = o.fade ?? 70;
    let B = 3; for (let i = 0; i < 30; i++) B = Math.asinh(half * B / (cell * n / 2));           // x = A sinh(B m): `cell` metres at the centre, `half` at the rim
    const A = cell * n / 2 / B;
    const gr = gridTris(-1, 1, -1, 1, n, n, r, (u, v) => { const m = Math.max(Math.abs(u), Math.abs(v)) || 1e-6, k = A * Math.sinh(B * m) / m, x = u * k, z = v * k, d = hyp(x, z); return [x, z, 1 / (1 + Math.pow(d / fade, 2)), 0, sm((d - 60) / 420)]; }, 0.24);
    const water = waterMesh(gr.verts, gr.tris, { amp: 0.22, len: 9, choppy: 1.5, dir: 0.5, opacity: 0.94, color: '#1f6688', shallow: '#4fa3b4', vary: 0.05, crest: 0.45, ...o }, seed); water.position.y = lvl;
    const bed = S3.plane(size, size, o.bed || '#12374a', { rough: 1 }); bed.position.y = lvl - (o.depth ?? 2.5); bed.castShadow = false;
    const g = group('sea', bed, water);
    Object.assign(g.userData, { water, level: lvl, animate: lt => water.userData.animate(lt), heightAt: (x, z, lt) => lvl + water.userData.heightAt(x, z, lt) });
    return g;
  }
  /** A sandy shore: you stand on dry sand at the origin (y = 0) and the sea lies toward -Z. Brings its own ground and sea: do not add s.ground(). o: {length, sand, wet, inland, color (sea), shallow, amp, len, speed, seaLevel, seed}. userData.animate(lt), waterline (z). */
  function beach(o = {}) {
    const seed = o.seed ?? 1, r = rng(seed * 331 + 3), L = o.length ?? 260, lvl = o.seaLevel ?? -0.45, slopeW = o.slope ?? 7, z0 = -1.2;      // sand starts to fall at z0
    const sandC = C(o.sand || '#dcc594'), wetC = C(o.wet || '#a8926a'), inC = C(o.inland || '#8f9a5c');
    const hS = z => z >= z0 ? 0.06 * (1 - Math.exp(-(z - z0) * 0.25)) - 0.06 * 0 : -Math.pow((z0 - z) / slopeW, 1.15) * 0.62;      // sand height profile
    const zs = [140, 60, 30, 16, 9, 4, 0, z0, z0 - 1.5, z0 - 3, z0 - 4.5, z0 - 6, z0 - 8, z0 - 11, z0 - 16, z0 - 30], nx = Math.round(L / 6), S = new Soup(seed);
    const wlz = z0 - slopeW * Math.pow(-lvl / 0.62, 1 / 1.15);     // where the sand meets the mean sea level
    S.surf(nx, zs.length - 1, (u, v, i, j) => { const x = (u - 0.5) * L + ((i > 0 && i < nx) ? (r() - 0.5) * 2.5 : 0), z = zs[zs.length - 1 - j] + ((j > 0 && j < zs.length - 1) ? (r() - 0.5) * 0.5 : 0); return [x, hS(z) + (z > 6 ? (n2(x * 0.05, z * 0.05, seed) - 0.5) * Math.min(1.6, (z - 6) * 0.06) : 0) + (z > z0 + 1 ? (r() - 0.5) * 0.07 : 0), z]; }, null,
      { flip: true, vary: 0.06, col: (u, v, i, j) => { const z = (zs[zs.length - 1 - j] + zs[zs.length - 2 - j]) / 2; return z > 22 ? sandC.clone().lerp(inC, sm((z - 22) / 30)) : z < wlz + 2.6 ? sandC.clone().lerp(wetC, sm((wlz + 2.6 - z) / 1.6)) : sandC; } });
    const sand = S.mesh(); sand.castShadow = false;
    const sw = sea({ level: lvl, amp: 0.1, len: 7, dir: 0.15, color: '#2a86a0', shallow: '#6cc7c2', depth: 4, crest: 0.35, opacity: 0.8, ...o, seed }); sw.position.z = -30;
    // foam: two ragged white bands that ride the swash up and down the sand
    const nf = 60, fpos = new Float32Array(nf * 2 * 18), fg = new T.BufferGeometry(); fg.setAttribute('position', new T.BufferAttribute(fpos, 3));
    const foam = new T.Mesh(fg, new T.MeshBasicMaterial({ color: o.foam || '#f6fcfb', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: T.DoubleSide })); foam.renderOrder = 4; foam.frustumCulled = false;
    const fx = i => (i / nf - 0.5) * Math.min(L, 130), slope = 0.62 * 1.15 / slopeW * Math.pow(-lvl / 0.62, 0.15 / 1.15), wave = sw.userData.water.userData.heightAt;
    const g = group('beach', sand, sw, foam);
    const animate = lt => {
      sw.userData.animate(lt);
      for (let b = 0; b < 2; b++) {
        const zl = i => { const x = fx(i); return wlz - b * (1.5 + 0.5 * n1(x * 0.11, 9)) + clamp(wave(x, wlz + 30, lt - b * 0.9) / slope, -2.2, 2.2) + 0.3 * n1(x * 0.3 + lt * 0.2, seed + b); }, wd = x => (b ? 0.28 : 0.5) * (1 + 0.6 * n1(x * 0.45 + b * 7, 3));
        let prev = zl(0);
        for (let i = 0; i < nf; i++) {
          const nxt = zl(i + 1), q = (b * nf + i) * 18, x0 = fx(i), x1 = fx(i + 1), w0 = wd(x0), w1 = wd(x1), up = b ? 0.14 : 0.03;
          fpos.set([x0, hS(prev - w0) + up, prev - w0, x1, hS(nxt - w1) + up, nxt - w1, x1, hS(nxt) + up, nxt, x0, hS(prev - w0) + up, prev - w0, x1, hS(nxt) + up, nxt, x0, hS(prev) + up, prev], q); prev = nxt;
        }
      }
      fg.attributes.position.needsUpdate = true;
    };
    animate(0); Object.assign(g.userData, { sea: sw, foam, waterline: wlz, seaLevel: lvl, animate, heightAt: (x, z) => hS(z) });
    return g;
  }

  // ---------- snow ----------
  /** Snow-covered ground with wind-shaped drifts, flat near the origin (use instead of s.ground()). o: {size, seg, flat, height, color, shade, seed}. userData.heightAt(x, z). */
  function snowGround(o = {}) {
    const seed = o.seed ?? 1, size = o.size ?? 320, seg = o.seg ?? 44, flat = o.flat ?? 9, hgt = o.height ?? 1.1, white = C(o.color || '#eef3f9'), blue = C(o.shade || '#c3d3ea'), S = new Soup(seed);
    const hAt = (x, z) => { const d = hyp(x, z), k = sm((d - flat) / (flat + 8)); return k * hgt * (0.75 * n2(x * 0.035 + 11, z * 0.09 + 5, seed) + 0.25 * n2(x * 0.12, z * 0.25, seed + 1)) * (1 + Math.min(3, d / 70)); };
    const half = size / 2, warp = t => Math.sign(t) * Math.pow(Math.abs(t), 1.7) * half, r = S.r;
    S.surf(seg, seg, (u, v, i, j) => { const e = i === 0 || j === 0 || i === seg || j === seg, x = warp(u * 2 - 1 + (e ? 0 : (r() - 0.5) * 0.5 / seg)), z = warp(1 - v * 2 + (e ? 0 : (r() - 0.5) * 0.5 / seg)); return [x, hAt(x, z), z]; }, white, { vary: 0.012 });
    S.paint((ce, n, i, c) => { const sl = 1 - n[1], f = clamp(sl * 5 + (n[0] * 0.5 - n[2] * 0.3) * 2.2); return new T.Color(c[i], c[i + 1], c[i + 2]).lerp(blue, f * 0.85).multiplyScalar(S.r() < 0.03 ? 1.05 : 1); });
    const m = S.mesh(); m.castShadow = false; const g = group('snowGround', m); g.userData.heightAt = hAt; return g;
  }
  /** A snow drift to pile against walls, fences and trees. o: {length, width, height, color, shade, seed}. */
  function snowDrift(o = {}) {
    const seed = o.seed ?? 1, L = o.length ?? 3.4, Wd = o.width ?? 1.7, H = o.height ?? 0.5, S = new Soup(seed), white = C(o.color || '#f1f5fb'), blue = C(o.shade || '#c6d5ea');
    const g0 = new T.IcosahedronGeometry(1, 2); S3.jitter(g0, 0.06, seed); const P = g0.attributes.position;
    for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), lee = z > 0 ? 0.72 : 1.15; P.setXYZ(i, x * L / 2 * (1 - 0.25 * z * z), Math.max(-0.03, (y + 0.25) / 1.25 * H * (1 - 0.3 * x * x)), z * Wd / 2 * lee + 0.12 * Wd * (1 - x * x) * Math.max(0, y)); }
    S.geo(g0, white, { vary: 0.015 }); S.paint((ce, n, i, c) => new T.Color(c[i], c[i + 1], c[i + 2]).lerp(blue, clamp((1 - n[1]) * 0.9 + n[2] * 0.25)));
    return group('snowDrift', S.mesh());
  }

  return {
    pine, snowyPine, broadleaf, birch, deadTree, palm, bush, stump, log, logSeat, grassTuft, grass, flowerPatch, reeds,
    rock, boulder, rockPile, cliff, rockArch, caveMouth,
    mountains, hills, cloud, clouds,
    pond, lake, river, sea, beach, snowGround, snowDrift,
    _: { Soup, C, spots },
  };
})();
