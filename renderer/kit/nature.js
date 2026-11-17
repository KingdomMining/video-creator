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
      const cap = (ring, c, rev) => { const k = colAt(rev ? 0 : N - 1, 0); for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; rev ? this.tri(c, ring[j2], ring[j], k) : this.tri(c, ring[j], ring[j2], k); if (this.uv) this.uv.push(0.5, 0, 0.5, 0, 0.5, 0); } };
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
    const nS = o.stubs ?? 2; for (let j = 0; j < nS; j++) { const u = 0.25 + r() * 0.5, p = vlerp(pts[0], pts[6], u), a = (r() - 0.5) * 1.6, len = 0.25 + r() * 0.35; S.sweep([p, [p[0] + (r() - 0.5) * 0.2, p[1] + cos(a) * (R + len), p[2] + sin(a) * (R + len)]], [R * 0.3, R * 0.2], 5, bark, { vary: 0.12 }); }
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

  return {
    pine, snowyPine, broadleaf, birch, deadTree, palm, bush, stump, log, logSeat, grassTuft, grass, flowerPatch, reeds,
    rock, boulder, rockPile,
    _: { Soup, C, spots },
  };
})();
