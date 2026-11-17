// interior.js - KitInterior: rooms, doors, windows, stairs and furniture for interior sets. Reference: docs/kit/interior.md
// Every builder is name(o = {}) and returns a THREE.Group at real scale (metres), standing on y = 0, centred on its
// footprint, front toward +Z. Wall-mounted pieces (pictures, clocks, panels, pipes, lift doors) have their BACK on z = 0.
// Deterministic: variation comes from o.seed only. The static geometry of each builder is fused into a few vertex-coloured
// meshes (cheap to draw); moving parts stay separate and are exposed on group.userData:
//   userData.open(k)      doors, lids, safes: k = 0 closed .. 1 open            userData.update(t)  anything that animates (pure function of t)
//   userData.lightPos     [x, y, z] in the builder's own space (+ lightColor, lit) for lamps, screens, fires
//   userData.anchors      {name: {pos: [x, y, z], rot: heading, kind: 'sit' | 'stand' | 'lie'}} in the builder's own space
const KitInterior = (() => {
  const T = S3.T, { box, boxB, cyl, cylB, cone, coneB, ball, blob, plane, quad, torus, extrude, lathe, tube, grp, mat, glow, mesh, canvasTex, flare } = S3;
  const PI = Math.PI, HP = PI / 2, TAU = PI * 2;

  // =====================================================================================================
  // colour
  // =====================================================================================================
  const rgb = c => { const n = /^#[0-9a-f]{6}$/i.test(c) ? parseInt(c.slice(1), 16) : new T.Color(c).getHex(); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  /** shade(col, 0.8) = darker, shade(col, 1.2) = lighter (towards white). */
  const shade = (c, k) => hex(rgb(c).map(v => k <= 1 ? v * k : v + (255 - v) * (k - 1)));
  const mix = (a, b, k) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * k)); };
  const rgba = (c, a) => { const v = rgb(c); return `rgba(${v[0]},${v[1]},${v[2]},${a})`; };
  const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
  const C = { wood: '#96673c', woodDark: '#5c3b23', woodLight: '#c79f68', white: '#ece7dc', cream: '#e2d8c4', steel: '#a9b1ba', chrome: '#d3d9e0', iron: '#3c4047', brass: '#c49a3e',
    black: '#1d1e22', plastic: '#e8e7e2', rubber: '#27282c', glass: '#bfe1ec', ceramic: '#f1efe8', wall: '#d6ccb8', fabric: '#56737a', warm: '#ffd9a0', cold: '#cfe4ff' };
  const MET = { rough: 0.42, metal: 0.3 }, CHR = { rough: 0.22, metal: 0.35 }, IRON = { rough: 0.6, metal: 0.25 }, GLOSS = { rough: 0.3 }, SATIN = { rough: 0.55 }, SOFT = { rough: 1 };
  const glassMat = (col = C.glass, a = 0.26) => mat(col, { opacity: a, rough: 0.08 });

  // =====================================================================================================
  // geometry helpers
  // =====================================================================================================
  /** Mark an object as a moving / addressable part: fuse() leaves it as its own node. */
  const keep = o => { o.userData.live = true; return o; };
  const chain = (g, fn) => { const prev = g.userData.update; g.userData.update = prev ? t => { prev(t); fn(t); } : fn; return g; };
  const _fm = new Map(), _tc = new T.Color();
  /**
   * Merge every static mesh under `root` into one mesh per material class (colours are baked into vertex colours, with a
   * little per-face brightness variation so large flat surfaces are never dead flat). Nodes marked keep() are left alone
   * (their own contents are fused relative to themselves), so moving parts keep working. o: {v: variation 0.035, seed}.
   */
  function fuse(root, o = {}) {
    const vAmt = o.v ?? 0.035, rnd = rng((((o.seed || 1) * 7919) + 31) >>> 0);
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert(), rel = new T.Matrix4(), bk = new Map(), dead = [], lives = [];
    const visit = n => { for (const c of n.children) {
      if (c.userData.live) { lives.push(c); continue; }
      if (c.isMesh && c.visible && !Array.isArray(c.material) && !c.isInstancedMesh && c.geometry.attributes.position) {
        const m = c.material; let mk;
        if (m.isMeshStandardMaterial && !m.map && !m.emissiveMap) mk = ['s', m.roughness, m.metalness, m.flatShading, m.side, m.transparent, m.opacity, m.depthWrite, m.emissive.getHex(), m.emissiveIntensity].join('|');
        else if (m.isMeshBasicMaterial && !m.map) mk = ['b', m.side, m.transparent, m.opacity, m.blending, m.toneMapped, m.fog, m.depthWrite].join('|');
        else mk = 'u' + m.uuid;
        const key = mk + '|' + c.castShadow + '|' + c.receiveShadow + '|' + c.renderOrder;
        let b = bk.get(key); if (!b) bk.set(key, b = { m, mk, cast: c.castShadow, recv: c.receiveShadow, ro: c.renderOrder, parts: [], n: 0 });
        const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        rel.multiplyMatrices(inv, c.matrixWorld); g.applyMatrix4(rel);
        b.parts.push({ g, flip: rel.determinant() < 0, col: m.color, tint: c.userData.tint, vc: m.vertexColors ? g.attributes.color : null, v: c.userData.fused ? 0 : (c.userData.v ?? vAmt) });
        b.n += g.attributes.position.count; dead.push(c);
      }
      visit(c);
    } };
    visit(root);
    for (const b of bk.values()) {
      const baked = b.mk[0] !== 'u', pos = new Float32Array(b.n * 3), nor = new Float32Array(b.n * 3), uv = baked ? null : new Float32Array(b.n * 2), col = baked ? new Float32Array(b.n * 3) : null; let k = 0;
      for (const p of b.parts) {
        const P = p.g.attributes.position, N = p.g.attributes.normal, U = p.g.attributes.uv, n = P.count; let cr = p.col.r, cg = p.col.g, cb = p.col.b, tone = 1;
        if (p.tint) { _tc.set(p.tint); cr *= _tc.r; cg *= _tc.g; cb *= _tc.b; }
        for (let i = 0; i < n; i++, k++) {
          const j = p.flip ? i - i % 3 + [0, 2, 1][i % 3] : i;
          pos[k * 3] = P.getX(j); pos[k * 3 + 1] = P.getY(j); pos[k * 3 + 2] = P.getZ(j);
          if (N) { nor[k * 3] = N.getX(j); nor[k * 3 + 1] = N.getY(j); nor[k * 3 + 2] = N.getZ(j); }
          if (uv && U) { uv[k * 2] = U.getX(j); uv[k * 2 + 1] = U.getY(j); }
          if (col) { if (i % 6 === 0 && p.v) tone = 1 + (rnd() - 0.5) * 2 * p.v; const q = p.vc; col[k * 3] = cr * tone * (q ? q.getX(j) : 1); col[k * 3 + 1] = cg * tone * (q ? q.getY(j) : 1); col[k * 3 + 2] = cb * tone * (q ? q.getZ(j) : 1); }
        }
      }
      let M = b.m;
      if (baked) { M = _fm.get(b.mk); if (!M) { const m = b.m;
        M = m.isMeshBasicMaterial ? new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: m.side, transparent: m.transparent, opacity: m.opacity, blending: m.blending, toneMapped: m.toneMapped, fog: m.fog, depthWrite: m.depthWrite })
          : new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: m.flatShading, roughness: m.roughness, metalness: m.metalness, emissive: m.emissive.getHex(), emissiveIntensity: m.emissiveIntensity, side: m.side, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
        _fm.set(b.mk, M); } }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      if (uv) geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); if (col) geo.setAttribute('color', new T.BufferAttribute(col, 3));
      const out = new T.Mesh(geo, M); out.castShadow = b.cast; out.receiveShadow = b.recv; out.renderOrder = b.ro; out.userData.fused = true; root.add(out);
    }
    dead.forEach(c => c.parent && c.parent.remove(c));
    const prune = n => { for (const c of [...n.children]) { if (c.userData.live || c.isMesh || c.isLight || c.isSprite || c.isPoints || c.isLine) continue; prune(c); if (!c.children.length && !Object.keys(c.userData).length) n.remove(c); } };
    prune(root);
    lives.forEach(l => { if (!l.isMesh && !l.isSprite && !l.isLight && l.children.length) fuse(l, { v: vAmt, seed: (o.seed || 1) + 3 }); });
    return root;
  }
  /** Finish a builder: fuse, name, remember its size [w, h, d]. */
  const done = (g, name, size, o = {}) => { fuse(g, { seed: o.seed || 1, v: o.v }); g.name = name; if (size) g.userData.size = size; return g; };

  /** Box with a chamfered top edge, standing on its origin (cushions, mattresses, lids). b = bevel size. */
  function cbox(w, h, d, b, col, o) {
    const g = new T.BoxGeometry(w, h, d, 1, 2, 1).translate(0, h / 2, 0), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (Math.abs(y - h / 2) < 1e-5) p.setY(i, h - b); else if (y > h / 2) { p.setX(i, p.getX(i) * (1 - 2 * b / w)); p.setZ(i, p.getZ(i) * (1 - 2 * b / d)); } }
    g.computeVertexNormals(); return mesh(g, col, o);
  }
  /** Pillow: box chamfered top and bottom, standing on its origin. */
  function pbox(w, h, d, b, col, o) {
    const g = new T.BoxGeometry(w, h, d, 1, 3, 1).translate(0, h / 2, 0), p = g.attributes.position, k = (1 - 2 * b / w), kz = (1 - 2 * b / d);
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > h * 0.9 || y < h * 0.1) { p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * kz); } else p.setY(i, y > h / 2 ? h - b : b); }
    g.computeVertexNormals(); return mesh(g, col, o);
  }
  /** Tapered box standing on its origin: base w x d, top wt x dt. */
  function tbox(w, h, d, wt, dt, col, o) {
    const g = new T.BoxGeometry(w, h, d).translate(0, h / 2, 0), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > h / 2) { p.setX(i, p.getX(i) * wt / w); p.setZ(i, p.getZ(i) * dt / d); }
    g.computeVertexNormals(); return mesh(g, col, o);
  }
  /** Open-ended prism (round bars, rails, pipes): cheap, no caps. Along Y, centred. */
  const rod = (r, len, col, o, seg = 5) => mesh(new T.CylinderGeometry(r, r, len, seg, 1, true), col, o);
  /** Rod between two points. */
  function rodAB(a, b, r, col, o, seg = 5) { const A = S3.V(a), B = S3.V(b), m = rod(r, A.distanceTo(B), col, o, seg); m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), B.clone().sub(A).normalize()); return m; }
  /** Flat disc facing +Z (dials, plates, portholes). */
  const disc = (r, col, o, seg = 10) => mesh(new T.CircleGeometry(r, seg), col, o);
  /** Planar UVs from vertex positions: a, b = 'getX' | 'getY' | 'getZ', su / sv = metres per texture repeat. */
  const uvPlanar = (g, a, b, su, sv, ou = 0, ov = 0) => { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p[a](i) / su + ou, p[b](i) / sv + ov); return g; };
  /** Quad from four corner points (counter-clockwise seen from the front), UVs 0..1. */
  function quad4(a, b, c, d, material) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array([...a, ...b, ...c, ...a, ...c, ...d]), 3)); g.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), 2)); g.computeVertexNormals(); return mesh(g, material); }
  /** Pleated cloth hanging from y = h down to y = 0, from x = 0 to x = 1 (scale.x sets the width). folds = number of pleats. */
  function drape(h, folds, depth, col, o = {}) {
    const n = folds * 2, pos = [], r = rng((o.seed || 1) * 613 + 5), top = [], bot = [];
    for (let i = 0; i <= n; i++) { const x = i / n, z = (i % 2 ? 1 : -1) * depth * (0.7 + r() * 0.5); top.push([x, h, z * 0.7]); bot.push([x + (r() - 0.5) * 0.02, (i % 2 ? 0.012 : 0) + (o.hem || 0) * r(), z]); }
    for (let i = 0; i < n; i++) pos.push(...bot[i], ...bot[i + 1], ...top[i + 1], ...bot[i], ...top[i + 1], ...top[i]);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3)); g.computeVertexNormals();
    return mesh(g, col, { side: 'double', rough: 1, ...o });
  }

  // =====================================================================================================
  // textures (cached: shots are rebuilt often, identical textures must be shared)
  // =====================================================================================================
  const _tex = new Map(), _tm = new Map();
  const ctex = (key, w, h, draw, o) => { let t = _tex.get(key); if (!t) _tex.set(key, t = canvasTex(w, h, draw, o)); return t; };
  /** Cached material from a cached canvas texture. o: {rough, metal, basic (unlit), repeat:[1,1], alpha (cut-out), side:'double', emissive} */
  function tmat(key, w, h, draw, o = {}) {
    let m = _tm.get(key); if (m) return m; const map = ctex(key, w, h, draw, o);
    m = o.basic ? new T.MeshBasicMaterial({ map, toneMapped: false }) : new T.MeshStandardMaterial({ map, roughness: o.rough ?? 0.9, metalness: o.metal ?? 0, flatShading: true });
    if (o.emissive && !o.basic) { m.emissiveMap = map; m.emissive = new T.Color('#ffffff'); m.emissiveIntensity = o.ei ?? 1; }
    if (o.alpha) { m.alphaTest = 0.5; m.transparent = false; } if (o.side === 'double') m.side = T.DoubleSide;
    if (o.add) { m.blending = T.AdditiveBlending; m.transparent = true; m.depthWrite = false; m.opacity = o.opacity ?? 1; }
    _tm.set(key, m); return m;
  }
  /** A glowing picture on a quad, redrawn on demand. paint(ctx, t, W, H). Returns {mesh, draw(t)}. */
  function screenQuad(w, h, pw, ph, paint) {
    const tex = canvasTex(pw, ph, c => paint(c, 0, pw, ph)), m = keep(mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false })));
    m.castShadow = false; m.receiveShadow = false;
    return { mesh: m, tex, draw: t => { const c = tex.image.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; paint(c, t, pw, ph); tex.needsUpdate = true; } };
  }
  const blotch = (c, r, W, Hh, n, a, rad = 110) => { for (let i = 0; i < n; i++) { const x = r() * W, y = r() * Hh, R = rad * (0.5 + r()), k = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; for (const dx of [-W, 0, W]) for (const dy of [-Hh, 0, Hh]) { const gr = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, R); gr.addColorStop(0, k); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(x + dx - R, y + dy - R, R * 2, R * 2); } } };
  const crack = (c, r, x, y, len, a = 0.35) => { c.strokeStyle = `rgba(0,0,0,${a})`; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y); let ang = r() * 6.28; for (let i = 0; i < len; i++) { ang += (r() - 0.5) * 1.3; x += Math.cos(ang) * 14; y += Math.sin(ang) * 14; c.lineTo(x, y); } c.stroke(); };

  const TW = 2.56;   // metres of wall or floor covered by one repeat of a surface texture
  /**
   * Wall surface. spec = colour string or {color, style, dado, dadoH, accent, mortar, grime, seed}.
   * style: 'paint' | 'stripe' | 'damask' | 'panel' (wainscot) | 'twotone' | 'tile' | 'brick' | 'concrete' | 'block' | 'planks' | 'steel'
   */
  function wallMat(spec, h) {
    const sp = Object.assign({ color: C.wall, style: 'paint', seed: 1, grime: 0 }, typeof spec === 'string' ? { color: spec } : spec), st = sp.style, col = sp.color;
    const key = ['wall', st, col, sp.dado, sp.dadoH, sp.accent, sp.mortar, sp.grime, sp.seed, h].join('|');
    return tmat(key, 512, 512, (c, W, Hh) => {
      const r = rng(sp.seed * 977 + 3), Y = m => Hh - m * Hh / h, dc = sp.dado || C.white, dH = sp.dadoH ?? 0.95;
      c.fillStyle = col; c.fillRect(0, 0, W, Hh);
      if (st === 'stripe') { const n = 16, sw = W / n; for (let i = 0; i < n; i++) { if (i % 2) { c.fillStyle = shade(col, 0.9); c.fillRect(i * sw, 0, sw, Hh); } c.fillStyle = shade(col, 1.14); c.fillRect(i * sw + sw * 0.46, 0, sw * 0.08, Hh); } }
      else if (st === 'damask') { c.fillStyle = shade(col, 1.13); const nx = 8, ny = Math.round(h / 0.36), s = 12; for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) for (const dx of [0, W]) { const x = (i + (j % 2) * 0.5) * W / nx + dx - (j % 2 ? 0 : 0), y = j * Hh / ny; c.beginPath(); c.moveTo(x, y - s * 1.6); c.lineTo(x + s, y); c.lineTo(x, y + s * 1.6); c.lineTo(x - s, y); c.closePath(); c.fill(); c.beginPath(); c.arc(x, y - s * 2.5, 3.2, 0, 7); c.fill(); c.beginPath(); c.arc(x, y + s * 2.5, 3.2, 0, 7); c.fill(); } }
      else if (st === 'panel' || st === 'twotone') { const y0 = Y(dH); c.fillStyle = dc; c.fillRect(0, y0, W, Hh - y0);
        if (st === 'panel') { const n = 4, pw = W / n; for (let i = 0; i < n; i++) { const x = i * pw + 20, yy = y0 + 26, ww = pw - 40, hh = Hh - y0 - 26 - 40; c.lineWidth = 4; c.strokeStyle = shade(dc, 0.8); c.strokeRect(x, yy, ww, hh); c.strokeStyle = shade(dc, 1.5); c.lineWidth = 2; c.strokeRect(x + 5, yy + 5, ww - 10, hh - 10); c.fillStyle = shade(dc, 0.96); c.fillRect(x + 7, yy + 7, ww - 14, hh - 14); }
          c.fillStyle = shade(dc, 1.25); c.fillRect(0, y0 - 7, W, 11); c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(0, y0 + 4, W, 3); }
        else { c.fillStyle = sp.accent || shade(dc, 0.72); c.fillRect(0, y0 - 6, W, 13); } }
      else if (st === 'tile') { const top = sp.dadoH ? Y(sp.dadoH) : 0, nx = 16, tw = W / nx, th = 0.16 * Hh / h, tc = sp.dado || col; if (sp.dadoH) { c.fillStyle = col; c.fillRect(0, 0, W, top); }
        c.fillStyle = shade(tc, 0.68); c.fillRect(0, top, W, Hh - top); let row = 0;
        for (let y = Hh; y > top + 2; y -= th, row++) for (let i = 0; i < nx; i++) { const acc = sp.accent && row === 7; c.fillStyle = shade(acc ? sp.accent : tc, 0.93 + r() * 0.12); const hh = Math.min(th, y - top); c.fillRect(i * tw + 1.2, y - hh + 1.2, tw - 2.4, hh - 2.4); } }
      else if (st === 'brick') { const bh = 0.075 * Hh / h, nx = 11, bw = W / nx; c.fillStyle = sp.mortar || '#b6ab9a'; c.fillRect(0, 0, W, Hh); let row = 0;
        for (let y = Hh; y > -bh; y -= bh, row++) for (let i = 0; i <= nx; i++) { const x = (i - (row % 2) * 0.5) * bw; c.fillStyle = shade(col, r() < 0.12 ? 0.62 + r() * 0.15 : 0.84 + r() * 0.3); c.fillRect(x + 1.5, y - bh + 1.5, bw - 3, bh - 3); } }
      else if (st === 'block') { const bh = 0.2 * Hh / h, nx = 6, bw = W / nx; let row = 0; for (let y = Hh; y > -bh; y -= bh, row++) for (let i = 0; i <= nx; i++) { const x = (i - (row % 2) * 0.5) * bw; c.fillStyle = shade(col, 0.93 + r() * 0.12); c.fillRect(x, y - bh, bw, bh); c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 2.5; c.strokeRect(x, y - bh, bw, bh); c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1; c.strokeRect(x + 2.5, y - bh + 2.5, bw - 5, bh - 5); } }
      else if (st === 'planks') { const n = 16, pw = W / n; for (let i = 0; i < n; i++) { c.fillStyle = shade(col, 0.84 + r() * 0.3); c.fillRect(i * pw, 0, pw, Hh); c.fillStyle = 'rgba(0,0,0,0.32)'; c.fillRect(i * pw, 0, 2, Hh); c.fillStyle = 'rgba(0,0,0,0.07)'; for (let k = 0; k < 2; k++) c.fillRect(i * pw + 6 + r() * (pw - 12), 0, 1.5, Hh); if (r() < 0.35) { c.fillStyle = 'rgba(40,20,5,0.4)'; c.beginPath(); c.ellipse(i * pw + pw / 2, r() * Hh, 5, 8, 0, 0, 7); c.fill(); } } }
      else if (st === 'steel') { const nx = 2, ny = 3, pw = W / nx, ph = Hh / ny; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { c.fillStyle = shade(col, 0.92 + r() * 0.14); c.fillRect(i * pw, j * ph, pw, ph); c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 3; c.strokeRect(i * pw, j * ph, pw, ph); c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1.5; c.strokeRect(i * pw + 3, j * ph + 3, pw - 6, ph - 6); c.fillStyle = 'rgba(0,0,0,0.35)'; for (let k = 0; k < 8; k++) { c.beginPath(); c.arc(i * pw + 16 + k * (pw - 32) / 7, j * ph + 14, 3, 0, 7); c.fill(); c.beginPath(); c.arc(i * pw + 16 + k * (pw - 32) / 7, j * ph + ph - 14, 3, 0, 7); c.fill(); } } }
      if (st === 'concrete') { blotch(c, r, W, Hh, 30, 0.07, 90); c.strokeStyle = 'rgba(0,0,0,0.13)'; c.lineWidth = 2; for (let m = 0.62; m < h; m += 0.62) { c.beginPath(); c.moveTo(0, Y(m)); c.lineTo(W, Y(m)); c.stroke(); } c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, Hh); c.moveTo(1, 0); c.lineTo(1, Hh); c.stroke();
        c.fillStyle = 'rgba(0,0,0,0.3)'; for (let m = 0.31; m < h; m += 0.62) for (const x of [W * 0.25, W * 0.75]) { c.beginPath(); c.arc(x, Y(m), 4, 0, 7); c.fill(); }
        for (let i = 0; i < 6; i++) { const x = r() * W, wd = 10 + r() * 26, len = Hh * (0.25 + r() * 0.5), gr = c.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, 'rgba(45,35,25,0.2)'); gr.addColorStop(1, 'rgba(45,35,25,0)'); c.fillStyle = gr; c.fillRect(x, 0, wd, len); }
        crack(c, r, r() * W, Hh * 0.3, 9); crack(c, r, r() * W, Hh * 0.7, 7); }
      else blotch(c, r, W, Hh, 12, 0.03);
      if (sp.grime) { for (let i = 0; i < 12 * sp.grime; i++) { const x = r() * W, wd = 14 + r() * 40, len = Hh * (0.2 + r() * 0.6), gr = c.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, `rgba(35,28,18,${0.22 * sp.grime})`); gr.addColorStop(1, 'rgba(35,28,18,0)'); c.fillStyle = gr; c.fillRect(x, 0, wd, len); } const gb = c.createLinearGradient(0, Hh * 0.6, 0, Hh); gb.addColorStop(0, 'rgba(20,24,18,0)'); gb.addColorStop(1, `rgba(20,24,18,${0.45 * sp.grime})`); c.fillStyle = gb; c.fillRect(0, Hh * 0.6, W, Hh * 0.4); }
      const ao = c.createLinearGradient(0, 0, 0, Hh); ao.addColorStop(0, 'rgba(0,0,0,0.2)'); ao.addColorStop(0.1, 'rgba(0,0,0,0.03)'); ao.addColorStop(0.5, 'rgba(0,0,0,0)'); ao.addColorStop(0.86, 'rgba(0,0,0,0.04)'); ao.addColorStop(1, 'rgba(0,0,0,0.22)'); c.fillStyle = ao; c.fillRect(0, 0, W, Hh);
    }, { repeat: [1, 1], rough: st === 'tile' ? 0.35 : st === 'steel' ? 0.45 : 0.95, metal: st === 'steel' ? 0.3 : 0 });
  }
  /**
   * Floor surface. spec = colour string or {color, style, color2, seed}.
   * style: 'wood' | 'tile' | 'checker' | 'carpet' | 'concrete' | 'lino' | 'stone'
   */
  function floorMat(spec) {
    const sp = Object.assign({ color: '#8c6240', style: 'wood', seed: 1 }, typeof spec === 'string' ? (/^#|^rgb/.test(spec) ? { color: spec } : { style: spec, color: FLOORCOL[spec] || '#8c6240' }) : spec), st = sp.style, col = sp.color || FLOORCOL[st] || '#8c6240';
    const key = ['floor', st, col, sp.color2, sp.seed].join('|');
    return tmat(key, 512, 512, (c, W) => {
      const r = rng(sp.seed * 911 + 17); c.fillStyle = col; c.fillRect(0, 0, W, W);
      if (st === 'wood') { const n = 20, bw = W / n; c.fillStyle = shade(col, 0.45); c.fillRect(0, 0, W, W);
        for (let i = 0; i < n; i++) { const js = []; let x = r() * 200; while (x < W) { js.push(x); x += 150 + r() * 240; } js.forEach((a, k) => { const b = k + 1 < js.length ? js[k + 1] : js[0] + W, tone = shade(col, 0.82 + r() * 0.32); for (const dx of [0, -W]) { c.fillStyle = tone; c.fillRect(a + dx + 1, i * bw + 1, b - a - 2, bw - 2); c.fillStyle = 'rgba(0,0,0,0.06)'; c.fillRect(a + dx + 1, i * bw + bw * (0.3 + 0.4 * r()), b - a - 2, 1.5); } }); } }
      else if (st === 'tile' || st === 'checker') { const n = sp.n || 8, tw = W / n; c.fillStyle = shade(col, st === 'checker' ? 0.5 : 0.66); c.fillRect(0, 0, W, W); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { c.fillStyle = shade(st === 'checker' && (i + j) % 2 ? (sp.color2 || '#2a2c30') : col, 0.93 + r() * 0.12); c.fillRect(i * tw + 1.5, j * tw + 1.5, tw - 3, tw - 3); } }
      else if (st === 'carpet') { for (let i = 0; i < 3200; i++) { c.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'; c.fillRect(r() * W, r() * W, 2 + r() * 4, 2 + r() * 4); } blotch(c, r, W, W, 8, 0.03); }
      else if (st === 'concrete') { blotch(c, r, W, W, 34, 0.07, 80); for (let i = 0; i < 5; i++) { c.fillStyle = `rgba(20,18,15,${0.1 + r() * 0.12})`; c.beginPath(); c.ellipse(r() * W, r() * W, 14 + r() * 40, 10 + r() * 26, r() * 3, 0, 7); c.fill(); } crack(c, r, r() * W, r() * W, 12); crack(c, r, r() * W, r() * W, 8); c.strokeStyle = 'rgba(0,0,0,0.16)'; c.lineWidth = 2; c.strokeRect(0, 0, W, W); }
      else if (st === 'lino') { for (let i = 0; i < 900; i++) { c.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)'; c.fillRect(r() * W, r() * W, 2.5, 2.5); } c.strokeStyle = 'rgba(0,0,0,0.1)'; c.lineWidth = 2; c.strokeRect(0, 0, W / 2, W / 2); c.strokeRect(W / 2, W / 2, W / 2, W / 2); c.strokeRect(0, W / 2, W / 2, W / 2); c.strokeRect(W / 2, 0, W / 2, W / 2); blotch(c, r, W, W, 8, 0.03); }
      else if (st === 'stone') { const n = 8, rh = W / n; c.fillStyle = shade(col, 0.5); c.fillRect(0, 0, W, W); for (let j = 0; j < n; j++) { const js = []; let x = r() * 80; while (x < W) { js.push(x); x += 70 + r() * 110; } js.forEach((a, k) => { const b = k + 1 < js.length ? js[k + 1] : js[0] + W, tone = shade(col, 0.82 + r() * 0.3); for (const dx of [0, -W]) { c.fillStyle = tone; c.fillRect(a + dx + 2, j * rh + 2, b - a - 4, rh - 4); } }); } }
    }, { repeat: [1, 1], rough: st === 'tile' || st === 'checker' ? 0.32 : st === 'lino' ? 0.4 : st === 'wood' ? 0.6 : 0.97 });
  }
  const FLOORCOL = { wood: '#8c6240', tile: '#cfd3d1', checker: '#e6e3da', carpet: '#7c6f66', concrete: '#7b7b78', lino: '#c9cdc6', stone: '#7d7a74' };
  /** Suspended ceiling tiles (0.64 m). */
  const gridCeilMat = col => tmat('ceilgrid|' + col, 256, 256, (c, W) => { const r = rng(77); c.fillStyle = col; c.fillRect(0, 0, W, W); for (let i = 0; i < 500; i++) { c.fillStyle = 'rgba(0,0,0,0.1)'; c.fillRect(r() * W, r() * W, 2, 2); } c.strokeStyle = shade(col, 0.72); c.lineWidth = 5; for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo(i * W / 2, 0); c.lineTo(i * W / 2, W); c.moveTo(0, i * W / 2); c.lineTo(W, i * W / 2); c.stroke(); } }, { repeat: [1, 1], rough: 1 });

  // =====================================================================================================
  // hardware and small shared parts (all face +Z, origin on the surface they are fixed to)
  // =====================================================================================================
  const knob = (col = C.brass, r = 0.018) => grp(cyl(r * 0.5, r * 0.55, 0.022, 6, col, MET).rot(HP, 0, 0).at(0, 0, 0.011), cyl(r, r * 0.75, 0.014, 6, col, MET).rot(HP, 0, 0).at(0, 0, 0.028));
  const pull = (len = 0.14, col = C.steel, vert = false) => { const g = grp(box(len, 0.012, 0.012, col, MET).at(0, 0, 0.03), box(0.012, 0.012, 0.03, col, MET).at(-len * 0.38, 0, 0.015), box(0.012, 0.012, 0.03, col, MET).at(len * 0.38, 0, 0.015)); if (vert) g.rotation.z = HP; return g; };
  /** Door lever on a round rose; dir = -1 points the lever toward -X. */
  const lever = (col = C.brass, dir = -1) => grp(cyl(0.027, 0.027, 0.008, 8, col, MET).rot(HP, 0, 0).at(0, 0, 0.004), box(0.016, 0.016, 0.045, col, MET).at(0, 0, 0.026), box(0.115, 0.017, 0.015, col, MET).at(dir * 0.05, 0, 0.05));
  /** Framed panel leaf (doors, cupboard fronts): stiles and rails at full thickness around thinner recessed panels. Origin = bottom centre. o: {stile, cols, rows:[fractions], panel, glass:[row indices], bottom} */
  function leafPanel(w, h, th, col, o = {}) {
    const st = o.stile ?? 0.1, cols = o.cols ?? 2, rows = o.rows || [0.4, 0.6], g = grp(), pc = o.panel || shade(col, 0.94), bot = o.bottom ?? st * 1.7, mw = st * 0.7, iw = w - st * 2;
    g.add(boxB(st, h, th, col).at(-w / 2 + st / 2, 0, 0), boxB(st, h, th, col).at(w / 2 - st / 2, 0, 0), boxB(iw, bot, th, col).at(0, 0, 0));
    const avail = h - bot - st * rows.length, pw = (iw - mw * (cols - 1)) / cols; let y = bot;
    rows.forEach((f, ri) => { const ph = avail * f, gl = (o.glass || []).includes(ri);
      for (let c = 0; c < cols; c++) { const x = -iw / 2 + pw / 2 + c * (pw + mw); g.add(gl ? box(pw, ph, 0.008, glassMat(o.glassCol, o.glassA)).at(x, y + ph / 2, 0) : boxB(pw, ph, th * 0.42, pc).at(x, y, 0)); if (c < cols - 1) g.add(boxB(mw, ph, th, col).at(x + pw / 2 + mw / 2, y, 0)); }
      y += ph; g.add(boxB(iw, st, th, col).at(0, y, 0)); y += st; });
    return g;
  }
  /** Door lining and architraves for an opening w x h in a wall wt thick. Centred on the wall's mid-plane. */
  function doorFrame(w, h, wt, col, o = {}) {
    const fw = o.fw ?? 0.035, aw = o.aw ?? 0.07, at = o.at ?? 0.018, dz = wt + 0.02, g = grp();
    g.add(boxB(fw, h, dz, col).at(-w / 2 + fw / 2, 0, 0), boxB(fw, h, dz, col).at(w / 2 - fw / 2, 0, 0), boxB(w - fw * 2, fw, dz, col).at(0, h - fw, 0));
    for (const s of o.sides || [1, -1]) { const z = s * (wt / 2 + at / 2); g.add(boxB(aw, h - 0.012, at, col).at(-w / 2 - aw / 2 + 0.012, 0, z), boxB(aw, h - 0.012, at, col).at(w / 2 + aw / 2 - 0.012, 0, z), boxB(w + aw * 2 - 0.024 + (o.ears || 0), aw + (o.headH || 0), at + 0.004, col).at(0, h - 0.012, z)); }
    return g;
  }
  const standAnchors = (g, zin = 0.7, zout = -0.7) => { g.userData.anchors = { in: { pos: [0, 0, zin], rot: 0, kind: 'stand' }, out: { pos: [0, 0, zout], rot: 0, kind: 'stand' } }; return g; };

  // =====================================================================================================
  // doors (all: origin on the floor, centred in the opening, wall mid-plane on z = 0, room side toward +Z)
  // =====================================================================================================
  /** Interior door in its frame. o: {w 0.9, h 2.1, wallT 0.12, color, frame, metal, style:'panel'|'flush'|'glazed', hinge:'left'|'right', swing:'in'|'out', maxAngle 100, open 0} */
  function door(o = {}) {
    const w = o.w ?? 0.9, h = o.h ?? 2.1, wt = o.wallT ?? 0.12, col = o.color || C.white, fc = o.frame || C.white, hw = o.metal || C.brass, th = 0.04, fw = 0.035, style = o.style || 'panel';
    const sx = (o.hinge || 'left') === 'left' ? 1 : -1, dir = (o.swing || 'in') === 'in' ? 1 : -1, g = grp(doorFrame(w, h, wt, fc)), lw = w - fw * 2 - 0.006, lh = h - fw - 0.012, leaf = keep(grp());
    const body = style === 'flush' ? grp(boxB(lw, lh, th, col), boxB(lw - 0.03, 0.2, th + 0.006, C.steel, MET).at(0, 0.03, 0))
      : style === 'glazed' ? leafPanel(lw, lh, th, col, { rows: [0.3, 0.7], glass: [1], glassCol: '#dfeaec', glassA: 0.4 }) : leafPanel(lw, lh, th, col, { rows: [0.38, 0.62] });
    body.position.set(sx * lw / 2, 0.006, -dir * th / 2); leaf.add(body);
    leaf.add(lever(hw, -sx).at(sx * (lw - 0.065), 1.0, -dir * th / 2 + th / 2), lever(hw, sx).at(sx * (lw - 0.065), 1.0, -dir * th / 2 - th / 2).rot(0, PI, 0));
    for (const y of [0.22, 1.05, 1.86]) leaf.add(cyl(0.009, 0.009, 0.1, 5, hw, MET).at(0, y, dir * 0.004));
    leaf.position.set(-sx * (w / 2 - fw - 0.003), 0, dir * (wt / 2 - 0.002)); g.add(leaf);
    const max = (o.maxAngle ?? 100) * PI / 180, U = g.userData; U.leaf = leaf; U.open = k => { leaf.rotation.y = -sx * dir * k * max; return g; }; U.open(o.open || 0);
    return done(standAnchors(g), 'door', [w + 0.12, h + 0.06, wt + 0.06], o);
  }

  /** Front (street) door: +Z is the room side, the street side with knocker, letterbox and number faces -Z. o: {w 0.95, h 2.1, wallT, color, frame, metal, glass true, number '13', hinge, open} */
  function frontDoor(o = {}) {
    const w = o.w ?? 0.95, h = o.h ?? 2.1, wt = o.wallT ?? 0.12, col = o.color || '#7b2b28', fc = o.frame || C.white, hw = o.metal || C.brass, th = 0.05, fw = 0.045;
    const sx = (o.hinge || 'left') === 'left' ? 1 : -1, g = grp(doorFrame(w, h, wt, fc, { fw, aw: 0.09, at: 0.022, ears: 0.04, headH: 0.03 })), lw = w - fw * 2 - 0.006, lh = h - fw - 0.03, leaf = keep(grp());
    g.add(boxB(w - fw * 2, 0.022, wt + 0.07, '#8b8478').at(0, 0, 0));
    const body = leafPanel(lw, lh, th, col, { rows: [0.33, 0.45, 0.22], glass: o.glass === false ? [] : [2], glassCol: '#e6eef0', glassA: 0.55, stile: 0.11 });
    body.position.set(sx * lw / 2, 0.024, -th / 2); leaf.add(body);
    const hx = sx * (lw - 0.07), zi = 0, zo = -th;
    leaf.add(knob(hw, 0.03).at(hx, 1.0, zi), box(0.03, 0.05, 0.02, hw, MET).at(hx, 1.2, zi + 0.01), box(0.2, 0.06, 0.008, hw, MET).at(sx * lw / 2, 0.98, zi + 0.004), cyl(0.012, 0.012, 0.006, 6, C.black).rot(HP, 0, 0).at(sx * lw / 2, 1.5, zi + 0.003));   // room side: knob, thumb-turn, letter flap, peephole
    leaf.add(box(0.07, 0.012, 0.012, hw, MET).at(hx - sx * 0.02, 1.36, zi + 0.012), box(0.03, 0.04, 0.016, hw, MET).at(hx + sx * 0.035, 1.36, zi + 0.008));   // slide bolt
    const out = grp(knob(hw, 0.032).at(-hx, 1.0, 0), cyl(0.014, 0.014, 0.01, 6, hw, MET).rot(HP, 0, 0).at(-hx, 1.2, 0.005), box(0.26, 0.075, 0.01, hw, MET).at(-sx * lw / 2, 0.98, 0.005), box(0.2, 0.022, 0.012, C.black).at(-sx * lw / 2, 0.98, 0.006),
      box(0.05, 0.07, 0.014, hw, MET).at(-sx * lw / 2, 1.5, 0.007), torus(0.042, 0.009, hw, { ...MET, rs: 4, ts: 8 }).at(-sx * lw / 2, 1.43, 0.02));   // street side: knob, lock, letterbox, knocker
    if (o.number) { const n = S3.label(String(o.number), 0.11, { color: hw, font: '800 96px Inter' }); n.position.set(-sx * lw / 2, 1.68, 0.004); n.material.side = T.FrontSide; out.add(n); }
    out.rotation.y = PI; out.position.z = zo; leaf.add(out);
    for (const y of [0.25, 1.05, 1.85]) leaf.add(cyl(0.011, 0.011, 0.11, 5, hw, MET).at(0, y, 0.004));
    leaf.position.set(-sx * (w / 2 - fw - 0.003), 0, wt / 2 - 0.002); g.add(leaf);
    const max = (o.maxAngle ?? 95) * PI / 180, U = g.userData; U.leaf = leaf; U.open = k => { leaf.rotation.y = -sx * k * max; return g; }; U.open(o.open || 0);
    return done(standAnchors(g, 0.8, -0.8), 'frontDoor', [w + 0.2, h + 0.12, wt + 0.08], o);
  }

  /** Double doors. style 'swing' (hospital / kitchen doors with vision panels, swing both ways) or 'panel' (panelled pair with handles). open(k, k2): k in -1..1, negative swings away from the room. o: {w 1.6, h 2.1, wallT, color, frame, style, open} */
  function doubleDoors(o = {}) {
    const w = o.w ?? 1.6, h = o.h ?? 2.1, wt = o.wallT ?? 0.12, style = o.style || 'swing', col = o.color || (style === 'swing' ? '#8fa6a6' : C.white), fc = o.frame || (style === 'swing' ? '#d9dcd6' : C.white), hw = o.metal || (style === 'swing' ? C.steel : C.brass), th = 0.045, fw = 0.04;
    const g = grp(doorFrame(w, h, wt, fc, { fw, aw: 0.08 })), lw = (w - fw * 2 - 0.012) / 2, lh = h - fw - 0.014, leaves = [];
    for (const sx of [1, -1]) { const leaf = keep(grp()), b = grp();
      if (style === 'swing') { const vw = 0.17, vy = 1.12, vh = 0.62, vx = lw * 0.22;   // slab built around a real see-through vision panel
        b.add(boxB(lw, vy, th, col), boxB(lw, lh - vy - vh, th, col).at(0, vy + vh, 0), boxB(lw / 2 + vx - vw / 2, vh, th, col).at(-lw / 2 + (lw / 2 + vx - vw / 2) / 2, vy, 0), boxB(lw / 2 - vx - vw / 2, vh, th, col).at(lw / 2 - (lw / 2 - vx - vw / 2) / 2, vy, 0));
        b.add(box(vw, vh, 0.008, glassMat('#cfe6ee', 0.3)).at(vx, vy + vh / 2, 0));
        for (const s of [1, -1]) { const z = s * (th / 2 + 0.003); b.add(box(lw - 0.012, 0.26, 0.006, C.steel, MET).at(0, 0.145, z), box(0.1, 0.32, 0.006, C.steel, MET).at(lw / 2 - 0.1, 1.15, z));
          b.add(box(vw + 0.05, 0.025, 0.008, C.steel, MET).at(vx, vy - 0.0125, z), box(vw + 0.05, 0.025, 0.008, C.steel, MET).at(vx, vy + vh + 0.0125, z), box(0.025, vh, 0.008, C.steel, MET).at(vx - vw / 2 - 0.0125, vy + vh / 2, z), box(0.025, vh, 0.008, C.steel, MET).at(vx + vw / 2 + 0.0125, vy + vh / 2, z)); }
        b.add(boxB(0.012, lh, th + 0.004, C.rubber).at(lw / 2 - 0.004, 0, 0));
      } else { b.add(leafPanel(lw, lh, th, col, { rows: [0.36, 0.64], cols: 1, stile: 0.11 })); b.add(lever(hw, -1).at(lw / 2 - 0.06, 1.0, th / 2), lever(hw, 1).at(lw / 2 - 0.06, 1.0, -th / 2).rot(0, PI, 0)); }
      b.position.set(sx * lw / 2, 0.007, 0); if (sx < 0) b.scale.x = -1; leaf.add(b);
      leaf.position.set(-sx * (w / 2 - fw - 0.003), 0, 0); g.add(leaf); leaves.push(leaf); }
    const max = (o.maxAngle ?? 95) * PI / 180, U = g.userData; U.leaves = leaves; U.leaf = leaves[0];
    U.open = (k, k2 = k) => { leaves[0].rotation.y = -k * max; leaves[1].rotation.y = k2 * max; return g; }; U.open(o.open || 0);
    return done(standAnchors(g, 0.9, -0.9), 'doubleDoors', [w + 0.14, h + 0.07, wt + 0.06], o);
  }

  /** Sliding door. style 'glass' (patio door, one sash slides over the other) or 'barn' (plank door on a rail across a plain opening). o: {w, h 2.1, wallT, color, frame, style, open} */
  function slidingDoor(o = {}) {
    const style = o.style || 'glass', h = o.h ?? 2.1, wt = o.wallT ?? 0.12, g = grp(), U = g.userData; let w, slide, travel;
    if (style === 'barn') { w = o.w ?? 1.0; const col = o.color || C.wood, fc = o.frame || C.woodDark, dw = w + 0.12, dh = h + 0.06, z = wt / 2 + 0.045, r = rng((o.seed || 1) * 31 + 2);
      g.add(doorFrame(w, h, wt, fc, { aw: 0.08 })); slide = keep(grp());
      for (let i = 0; i < 6; i++) slide.add(boxB(dw / 6 - 0.004, dh, 0.035, shade(col, 0.88 + r() * 0.22)).at(-dw / 2 + dw / 12 + i * dw / 6, 0.02, 0));
      slide.add(box(dw, 0.1, 0.018, shade(col, 0.8)).at(0, 0.18, 0.026), box(dw, 0.1, 0.018, shade(col, 0.8)).at(0, dh - 0.12, 0.026), box(Math.hypot(dw, dh - 0.4) - 0.1, 0.1, 0.016, shade(col, 0.8)).rot(0, 0, Math.atan2(dh - 0.4, dw)).at(0, dh / 2 + 0.02, 0.025));
      for (const x of [-dw / 2 + 0.14, dw / 2 - 0.14]) slide.add(box(0.04, 0.3, 0.012, C.iron, IRON).at(x, dh + 0.01, 0.024), cyl(0.045, 0.045, 0.02, 8, C.iron, IRON).rot(HP, 0, 0).at(x, dh + 0.14, 0.0));
      slide.add(pull(0.22, C.iron, true).at(-dw / 2 + 0.09, 1.05, 0.018)); slide.position.set(0, 0, z); g.add(slide);
      g.add(box(w * 2.3, 0.03, 0.012, C.iron, IRON).at(w * 0.6, h + 0.2, z + 0.0), box(0.03, 0.03, 0.05, C.iron, IRON).at(-w * 0.5, h + 0.2, z - 0.025), box(0.03, 0.03, 0.05, C.iron, IRON).at(w * 1.7, h + 0.2, z - 0.025), box(0.03, 0.03, 0.05, C.iron, IRON).at(w * 0.6, h + 0.2, z - 0.025));
      travel = w + 0.08;
    } else { w = o.w ?? 1.8; const fc = o.frame || o.color || '#e8e6e0', ft = 0.05, sw = w / 2 + 0.01, sh = h - ft - 0.03, st = 0.05;
      g.add(boxB(ft, h, wt + 0.02, fc).at(-w / 2 + ft / 2, 0, 0), boxB(ft, h, wt + 0.02, fc).at(w / 2 - ft / 2, 0, 0), boxB(w - ft * 2, ft, wt + 0.02, fc).at(0, h - ft, 0), boxB(w - ft * 2, 0.03, wt + 0.02, C.steel, MET).at(0, 0, 0));
      const sash = () => grp(boxB(st, sh, 0.03, fc).at(-sw / 2 + st / 2 + ft / 2, 0, 0), boxB(st, sh, 0.03, fc).at(sw / 2 - st / 2 - ft / 2, 0, 0), boxB(sw - ft - st * 2, st, 0.03, fc).at(0, 0, 0), boxB(sw - ft - st * 2, st, 0.03, fc).at(0, sh - st, 0), box(sw - ft - st * 2, sh - st * 2, 0.008, glassMat(o.glass || C.glass, 0.22)).at(0, sh / 2, 0));
      g.add(sash().at(-w / 4 + ft / 4, 0.03, -0.02)); slide = keep(sash()); slide.add(pull(0.2, C.steel, true).at(-sw / 2 + st / 2 + ft / 2, 1.05, 0.015), pull(0.2, C.steel, true).at(-sw / 2 + st / 2 + ft / 2, 1.05, -0.015).rot(0, PI, HP));
      slide.position.set(w / 4 - ft / 4, 0.03, 0.02); g.add(slide); travel = -(w / 2 - ft - 0.06);
    }
    const x0 = slide.position.x; U.leaf = slide; U.open = k => { slide.position.x = x0 + k * travel; return g; }; U.open(o.open || 0);
    return done(standAnchors(g, 0.8, -0.8), 'slidingDoor', [style === 'barn' ? w * 2.3 : w, h + 0.1, wt + 0.1], o);
  }

  /**
   * Lift (elevator) doors with a car behind them. Centre-opening panels, floor indicator, call button.
   * o: {w 1.0, h 2.1, wallT 0.12, color, frame, car true, surround true (own piece of wall; room() turns it off), wallColor, floor '3', open}
   * userData: open(k), panels, indicator (mesh), setFloor(text, dir), button (mesh), lightPos (inside the car)
   */
  function liftDoors(o = {}) {
    const w = o.w ?? 1.0, h = o.h ?? 2.1, wt = o.wallT ?? 0.12, col = o.color || '#b3bbc3', fc = o.frame || '#8a929b', g = grp(), U = g.userData, zf = wt / 2, zp = -wt / 2 - 0.035, fw = 0.1;
    if (o.surround !== false) { const W2 = w + 1.5, Hh = h + 0.6, wc = o.wallColor || C.wall; g.add(boxB((W2 - w) / 2, Hh, wt, wc).at(-(W2 + w) / 4, 0, 0), boxB((W2 - w) / 2, Hh, wt, wc).at((W2 + w) / 4, 0, 0), boxB(w, Hh - h, wt, wc).at(0, h, 0)); }
    g.add(boxB(fw, h + fw, 0.03, fc, MET).at(-w / 2 - fw / 2 + 0.01, 0, zf + 0.015), boxB(fw, h + fw, 0.03, fc, MET).at(w / 2 + fw / 2 - 0.01, 0, zf + 0.015), boxB(w - 0.02, fw, 0.03, fc, MET).at(0, h - 0.01, zf + 0.012));   // portal fascia
    g.add(boxB(0.03, h, wt + 0.03, fc, MET).at(-w / 2 + 0.015, 0, -0.015), boxB(0.03, h, wt + 0.03, fc, MET).at(w / 2 - 0.015, 0, -0.015), boxB(w - 0.06, 0.03, wt + 0.03, fc, MET).at(0, h - 0.03, -0.015), boxB(w - 0.06, 0.012, wt + 0.08, C.steel, MET).at(0, 0, -0.04));   // reveal + sill
    const panels = [-1, 1].map(s => { const p = keep(grp(boxB(w / 2 + 0.02, h, 0.03, col, MET), box(0.012, h - 0.1, 0.004, shade(col, 0.8), MET).at(s * -(w / 4 - 0.03), h / 2, 0.016), box(w / 2 - 0.08, 0.012, 0.004, shade(col, 0.82), MET).at(0, 0.5, 0.016), box(w / 2 - 0.08, 0.012, 0.004, shade(col, 0.82), MET).at(0, h - 0.5, 0.016))); p.position.set(s * (w / 4 + 0.01), 0, zp); g.add(p); return p; });
    const ind = screenQuad(0.26, 0.09, 104, 36, (c, t, W, Hh) => { c.fillStyle = '#120806'; c.fillRect(0, 0, W, Hh); c.fillStyle = '#ff8a2a'; c.font = 'bold 30px "DejaVu Sans Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(U.floorText, W / 2 + (U.floorDir ? 12 : 0), Hh / 2 + 2); if (U.floorDir) { const up = U.floorDir > 0; c.beginPath(); c.moveTo(18, up ? 8 : 28); c.lineTo(28, up ? 26 : 10); c.lineTo(8, up ? 26 : 10); c.closePath(); c.fill(); } });
    U.floorText = String(o.floor ?? '1'); U.floorDir = 0; U.setFloor = (txt, dir = 0) => { U.floorText = String(txt); U.floorDir = dir; ind.draw(0); return g; }; ind.draw(0);
    g.add(box(0.32, 0.14, 0.03, C.black).at(0, h + fw + 0.14, zf + 0.015), ind.mesh.at(0, h + fw + 0.14, zf + 0.031)); U.indicator = ind.mesh;
    const btn = keep(mesh(new T.CircleGeometry(0.016, 10), glow(o.buttonColor || '#ffb347', 1.4))); btn.position.set(w / 2 + fw + 0.16, 1.14, zf + 0.012); U.button = btn;
    g.add(box(0.09, 0.2, 0.012, C.steel, MET).at(w / 2 + fw + 0.16, 1.1, zf + 0.006), btn, disc(0.016, shade(C.steel, 0.6), MET).at(w / 2 + fw + 0.16, 1.06, zf + 0.0125));
    if (o.car !== false) { const cw = Math.max(1.5, w + 0.5), cd = 1.35, ch = h + 0.2, z0 = zp - 0.04, wc = o.carColor || '#a79a86', car = grp();
      car.add(boxB(cw, 0.04, cd, '#3a3d42').at(0, -0.04 + 0.006, -cd / 2), boxB(cw, 0.05, cd, '#d8d6cf').at(0, ch, -cd / 2), boxB(cw, ch, 0.04, wc).at(0, 0, -cd - 0.02), boxB(0.04, ch, cd, wc).at(-cw / 2 - 0.02, 0, -cd / 2), boxB(0.04, ch, cd, wc).at(cw / 2 + 0.02, 0, -cd / 2));
      car.add(boxB((cw - w) / 2, ch, 0.03, wc).at(-(cw + w) / 4, 0, -0.015), boxB((cw - w) / 2, ch, 0.03, wc).at((cw + w) / 4, 0, -0.015), boxB(w, ch - h, 0.03, wc).at(0, h, -0.015));
      car.add(boxB(cw - 0.1, ch * 0.42, 0.012, '#c9d3da', CHR).at(0, 1.02, -cd + 0.006), boxB(cw, 0.95, 0.012, shade(wc, 0.8)).at(0, 0, -cd + 0.006), rodAB([-cw / 2 + 0.1, 0.95, -cd + 0.07], [cw / 2 - 0.1, 0.95, -cd + 0.07], 0.018, C.chrome, CHR), box(0.5, 0.012, 0.5, glow('#fff3d8', 1.3)).at(0, ch - 0.008, -cd / 2),
        box(0.1, 0.34, 0.012, C.steel, MET).at(cw / 2 - 0.005, 1.15, -0.3).rot(0, -HP, 0));
      car.position.z = z0; g.add(car); U.lightPos = [0, ch - 0.25, z0 - cd / 2]; U.lightColor = '#fff0d2'; U.lit = true; U.lightPower = 0.7; }
    U.panels = panels; U.open = k => { panels[0].position.x = -(w / 4 + 0.01) - k * (w / 2 - 0.02); panels[1].position.x = (w / 4 + 0.01) + k * (w / 2 - 0.02); return g; }; U.open(o.open || 0);
    g.userData.anchors = { in: { pos: [0, 0, 0.9], rot: PI, kind: 'stand' }, out: { pos: [0, 0, zp - 0.7], rot: 0, kind: 'stand' }, call: { pos: [w / 2 + 0.25, 0, 0.55], rot: PI, kind: 'stand' } };
    return done(g, 'liftDoors', [w + 1.5, h + 0.6, 1.6], o);
  }

  /**
   * Heavy cellar / dungeon door. style 'wood' (iron-bound planks) or 'steel' (riveted plate). o: {w 1.0, h 2.0, wallT, color, frame, style, hatch (barred peep window), hinge, open}
   */
  function cellarDoor(o = {}) {
    const w = o.w ?? 1.0, h = o.h ?? 2.0, wt = o.wallT ?? 0.12, style = o.style || 'wood', steel = style === 'steel', col = o.color || (steel ? '#5d6a70' : '#6d4a2c'), fc = o.frame || (steel ? '#444b50' : '#4a3221'), ir = steel ? shade(col, 0.72) : C.iron;
    const sx = (o.hinge || 'left') === 'left' ? 1 : -1, g = grp(), fw = 0.07, th = 0.065, lw = w - fw * 2 - 0.008, lh = h - fw - 0.012, leaf = keep(grp()), b = grp(), r = rng((o.seed || 1) * 53 + 9), dz = wt + 0.06, hatch = !!o.hatch;
    g.add(boxB(fw, h, dz, fc).at(-w / 2 + fw / 2, 0, 0), boxB(fw, h, dz, fc).at(w / 2 - fw / 2, 0, 0), boxB(w + 0.1, fw + 0.04, dz + 0.02, fc).at(0, h - fw, 0), boxB(w - fw * 2, 0.03, dz, shade(fc, 0.8)).at(0, 0, 0));
    const hy = lh - 0.5, hh = 0.22, hw2 = 0.3, top = hatch ? hy : lh;   // planks stop under the hatch row
    if (steel) { b.add(boxB(lw, top, th, col, IRON)); if (hatch) b.add(boxB(lw, lh - hy - hh, th, col, IRON).at(0, hy + hh, 0), boxB((lw - hw2) / 2, hh, th, col, IRON).at(-(lw + hw2) / 4, hy, 0), boxB((lw - hw2) / 2, hh, th, col, IRON).at((lw + hw2) / 4, hy, 0));
      for (const s of [1, -1]) { const z = s * (th / 2 + 0.005); b.add(box(lw, 0.07, 0.01, ir, IRON).at(0, 0.035, z), box(lw, 0.07, 0.01, ir, IRON).at(0, lh - 0.035, z), box(0.07, lh - 0.14, 0.01, ir, IRON).at(-lw / 2 + 0.035, lh / 2, z), box(0.07, lh - 0.14, 0.01, ir, IRON).at(lw / 2 - 0.035, lh / 2, z), box(lw - 0.14, 0.06, 0.01, ir, IRON).at(0, lh * 0.42, z));
        for (let i = 0; i < 7; i++) for (const x of [-lw / 2 + 0.035, lw / 2 - 0.035]) b.add(box(0.022, 0.022, 0.012, shade(ir, 1.25), IRON).at(x, 0.12 + i * (lh - 0.24) / 6, z + s * 0.008)); }
    } else { const n = 6, pw = lw / n; for (let i = 0; i < n; i++) { const pc = shade(col, 0.85 + r() * 0.28), x = -lw / 2 + pw / 2 + i * pw, inH = hatch && Math.abs(x) < hw2 / 2; b.add(boxB(pw - 0.004, inH ? hy : lh, th, pc).at(x, 0, 0)); if (inH) b.add(boxB(pw - 0.004, lh - hy - hh, th, pc).at(x, hy + hh, 0)); }
      for (const s of [1, -1]) { const z = s * (th / 2 + 0.006); for (const y of [0.28, lh * 0.5, lh - 0.22]) { if (hatch && Math.abs(y - hy - hh / 2) < 0.2) continue; b.add(box(lw - 0.02, 0.075, 0.012, ir, IRON).at(0, y, z)); for (let i = 0; i < 6; i++) b.add(box(0.024, 0.024, 0.014, shade(ir, 1.3), IRON).at(-lw / 2 + lw / 12 + i * lw / 6, y, z + s * 0.009)); } } }
    if (hatch) { for (let i = 0; i < 3; i++) b.add(rod(0.011, hh, C.iron, IRON).at(-hw2 / 2 + hw2 / 6 + i * hw2 / 3, hy + hh / 2, 0)); for (const s of [1, -1]) b.add(box(hw2 + 0.08, 0.035, 0.012, ir, IRON).at(0, hy - 0.0175, s * (th / 2 + 0.006)), box(hw2 + 0.08, 0.035, 0.012, ir, IRON).at(0, hy + hh + 0.0175, s * (th / 2 + 0.006))); }
    b.position.set(sx * lw / 2, 0.008, -th / 2); leaf.add(b);
    const hx = sx * (lw - 0.1), ring = torus(0.06, 0.011, C.iron, { ...IRON, rs: 4, ts: 8 }); ring.position.set(hx, 0.98, 0.022); leaf.add(ring, box(0.05, 0.05, 0.02, C.iron, IRON).at(hx, 1.045, 0.01), box(0.06, 0.1, 0.012, C.iron, IRON).at(hx, 0.8, 0.006), box(0.012, 0.03, 0.014, C.black).at(hx, 0.79, 0.008));
    leaf.add(box(0.26, 0.03, 0.03, shade(C.iron, 1.2), IRON).at(hx - sx * 0.04, 1.3, 0.03), box(0.05, 0.07, 0.04, C.iron, IRON).at(hx - sx * 0.12, 1.3, 0.02), box(0.05, 0.07, 0.04, C.iron, IRON).at(hx + sx * 0.02, 1.3, 0.02), box(0.02, 0.06, 0.02, shade(C.iron, 1.2), IRON).at(hx - sx * 0.06, 1.33, 0.05));   // slide bolt
    const ring2 = torus(0.06, 0.011, C.iron, { ...IRON, rs: 4, ts: 8 }); ring2.position.set(hx, 0.98, -th - 0.022); leaf.add(ring2);
    for (const y of [0.28, lh * 0.5, lh - 0.22]) leaf.add(cyl(0.02, 0.02, 0.13, 6, C.iron, IRON).at(0, y, 0.006));
    leaf.position.set(-sx * (w / 2 - fw - 0.004), 0, wt / 2 + 0.01); g.add(leaf);
    const max = (o.maxAngle ?? 95) * PI / 180, U = g.userData; U.leaf = leaf; U.open = k => { leaf.rotation.y = -sx * k * max; return g; }; U.open(o.open || 0);
    return done(standAnchors(g, 0.8, -0.8), 'cellarDoor', [w + 0.1, h + 0.05, wt + 0.14], { ...o, v: 0.05 });
  }

  /**
   * Round bank-vault door in a steel surround. open(k): the wheel spins and the bolts draw back (k 0..0.4), then the door swings out toward +Z (0.4..1).
   * o: {w 2.6, h 2.6 (surround size), r 0.95 (clear opening radius), wallT, color, accent (wheel and trim), dark, open}
   * userData: open(k), leaf (hinged group), wheel, bolts
   */
  function vaultDoor(o = {}) {
    const W = o.w ?? 2.6, Hh = o.h ?? 2.6, R = o.r ?? Math.min(0.95, Math.min(W, Hh) / 2 - 0.3), wt = o.wallT ?? 0.12, col = o.color || '#9aa5af', acc = o.accent || '#c9a24a', dk = o.dark || '#59626c', g = grp(), U = g.userData;
    const cy = Math.max(R + 0.22, Math.min(Hh / 2, R + 0.35)), D = 0.42, zf = wt / 2 + 0.06, circ = (rad, n) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * TAU) * rad, cy + Math.sin(i / n * TAU) * rad]);
    const sur = extrude([[-W / 2, 0], [W / 2, 0], [W / 2, Hh], [-W / 2, Hh]], D, dk, { ...MET, holes: [circ(R, 20).reverse()] }); sur.position.z = zf - D; g.add(sur);
    g.add(torus(R + 0.07, 0.07, col, { ...MET, rs: 4, ts: 20 }).at(0, cy, zf), boxB(W, 0.05, 0.02, shade(dk, 1.25), MET).at(0, 0, zf + 0.01), boxB(W, 0.05, 0.02, shade(dk, 1.25), MET).at(0, Hh - 0.05, zf + 0.01), boxB(0.05, Hh - 0.1, 0.02, shade(dk, 1.25), MET).at(-W / 2 + 0.025, 0.05, zf + 0.01), boxB(0.05, Hh - 0.1, 0.02, shade(dk, 1.25), MET).at(W / 2 - 0.025, 0.05, zf + 0.01));
    for (const [x, y] of [[-W / 2 + 0.12, 0.12], [W / 2 - 0.12, 0.12], [-W / 2 + 0.12, Hh - 0.12], [W / 2 - 0.12, Hh - 0.12]]) g.add(cyl(0.035, 0.035, 0.03, 6, shade(dk, 1.3), MET).rot(HP, 0, 0).at(x, y, zf + 0.015));
    const hxp = -(R + 0.2), leaf = keep(grp()), dsc = grp();   // door disc, built around its own centre, then hung from the hinge
    const zc = (rr, len, z, c, seg = 20) => cyl(rr, rr, len, seg, c, MET).rot(HP, 0, 0).at(0, 0, z);
    dsc.add(zc(R - 0.015, 0.3, -0.13, shade(col, 0.82)), zc(R + 0.14, 0.09, 0.065, col), zc(R - 0.12, 0.05, 0.13, shade(col, 1.12)), zc(0.3, 0.05, 0.175, dk, 12), zc(0.07, 0.16, 0.2, acc, 8));
    for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; dsc.add(cyl(0.036, 0.036, 0.03, 6, shade(col, 1.3), MET).rot(HP, 0, 0).at(Math.cos(a) * (R + 0.02), Math.sin(a) * (R + 0.02), 0.122)); }
    const wheel = keep(grp(torus(0.3, 0.024, acc, { ...MET, rs: 5, ts: 14 }))); for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; wheel.add(rodAB([0, 0, 0], [Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0], 0.016, acc, MET), ball(0.032, acc, 0, MET).at(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0)); }
    wheel.position.set(0, 0, 0.27); dsc.add(wheel);
    dsc.add(zc(0.085, 0.04, 0.17, shade(dk, 0.7), 10).at(-R * 0.55, R * 0.42, 0.17), zc(0.05, 0.03, 0.2, acc, 10).at(-R * 0.55, R * 0.42, 0.2), box(0.2, 0.09, 0.012, acc, MET).at(R * 0.5, R * 0.45, 0.16), box(0.05, 0.34, 0.05, dk, MET).at(R * 0.56, -R * 0.2, 0.18), box(0.05, 0.05, 0.1, dk, MET).at(R * 0.56, -R * 0.05, 0.2), box(0.05, 0.05, 0.1, dk, MET).at(R * 0.56, -R * 0.35, 0.2));
    const bolts = keep(grp()); for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU, b = cyl(0.04, 0.04, 0.2, 6, shade(col, 1.25), CHR); b.rotation.z = a - HP; b.userData.live = true; b.userData.a = a; bolts.add(b); } bolts.position.z = -0.16; dsc.add(bolts);
    dsc.position.set(-hxp, 0, 0); leaf.add(dsc);
    leaf.add(box(0.34, 0.16, 0.12, dk, MET).at(0.13, R * 0.5, 0.09), box(0.34, 0.16, 0.12, dk, MET).at(0.13, -R * 0.5, 0.09), cyl(0.07, 0.07, 0.3, 8, shade(col, 0.7), MET).at(0, R * 0.5, 0.09), cyl(0.07, 0.07, 0.3, 8, shade(col, 0.7), MET).at(0, -R * 0.5, 0.09));
    leaf.position.set(hxp, cy, zf); g.add(leaf);
    g.add(box(0.2, 0.42, 0.1, dk, MET).at(hxp - 0.06, cy + R * 0.5, zf + 0.05), box(0.2, 0.42, 0.1, dk, MET).at(hxp - 0.06, cy - R * 0.5, zf + 0.05));
    const max = (o.maxAngle ?? 105) * PI / 180; U.leaf = leaf; U.wheel = wheel; U.bolts = bolts;
    U.open = k => { wheel.rotation.z = -S3.ramp(k, 0, 0.36) * TAU * 1.5; const u = S3.ramp(k, 0.18, 0.4), rr = R - 0.07 - u * 0.14; bolts.children.forEach(b => b.position.set(Math.cos(b.userData.a) * rr, Math.sin(b.userData.a) * rr, 0)); leaf.rotation.y = -S3.ramp(k, 0.4, 1) * max; return g; }; U.open(o.open || 0);
    return done(standAnchors(g, 1.6, -1.2), 'vaultDoor', [W, Hh, D + 0.4], o);
  }

  /** Prison bars with a sliding gate. o: {w 3, h 2.6, door true, doorW 0.85, doorAt 0 (x of the gate centre), color, gap 0.105, open}. userData: open(k), gate */
  function bars(o = {}) {
    const w = o.w ?? 3, h = o.h ?? 2.6, col = o.color || '#4a4f57', dW = o.doorW ?? 0.85, dx = o.doorAt ?? 0, hasDoor = o.door !== false, gap = o.gap ?? 0.105, g = grp(), U = g.userData, br = 0.0115;
    const flat = (len, y, x = 0, z = 0, t = g) => t.add(box(len, 0.05, 0.022, col, IRON).at(x, y, z));
    flat(w, 0.025); flat(w, h - 0.025); flat(w, h * 0.36); flat(w, h * 0.7);
    g.add(boxB(0.06, h, 0.06, shade(col, 0.85), IRON).at(-w / 2 + 0.03, 0, 0), boxB(0.06, h, 0.06, shade(col, 0.85), IRON).at(w / 2 - 0.03, 0, 0));
    const n = Math.floor((w - 0.12) / gap), x0 = -(n - 1) * gap / 2;
    for (let i = 0; i < n; i++) { const x = x0 + i * gap; if (hasDoor && Math.abs(x - dx) < dW / 2 + 0.01) { g.add(rod(br, h * 0.3 - 0.05 - 0.02, col, IRON).at(x, h - (h * 0.3) / 2 - 0.01, 0)); continue; } g.add(rod(br, h - 0.05, col, IRON).at(x, h / 2, 0)); }
    if (hasDoor) { const gh = h * 0.7 - 0.03, gate = keep(grp()), zo = 0.05; g.add(boxB(0.05, gh, 0.05, shade(col, 0.85), IRON).at(dx - dW / 2 - 0.035, 0, 0), boxB(0.05, gh, 0.05, shade(col, 0.85), IRON).at(dx + dW / 2 + 0.035, 0, 0), box(w, 0.03, 0.03, shade(col, 1.2), IRON).at(0, gh + 0.045, zo));
      for (const y of [0.03, gh - 0.03, gh * 0.5]) gate.add(box(dW, 0.05, 0.022, col, IRON).at(0, y, 0)); gate.add(boxB(0.045, gh, 0.03, col, IRON).at(-dW / 2 + 0.0225, 0, 0), boxB(0.045, gh, 0.03, col, IRON).at(dW / 2 - 0.0225, 0, 0));
      const m = Math.floor((dW - 0.1) / gap); for (let i = 0; i < m; i++) gate.add(rod(br, gh - 0.06, col, IRON).at(-(m - 1) * gap / 2 + i * gap, gh / 2, 0));
      gate.add(box(0.13, 0.2, 0.06, shade(col, 0.7), IRON).at(-dW / 2 + 0.065, gh * 0.5, 0), box(0.012, 0.035, 0.07, C.black).at(-dW / 2 + 0.065, gh * 0.5 - 0.02, 0), cyl(0.03, 0.03, 0.02, 8, shade(col, 1.25), IRON).rot(HP, 0, 0).at(-dW / 2 + 0.12, gh + 0.045, 0), cyl(0.03, 0.03, 0.02, 8, shade(col, 1.25), IRON).rot(HP, 0, 0).at(dW / 2 - 0.12, gh + 0.045, 0));
      gate.position.set(dx, 0.01, zo); g.add(gate); U.gate = gate; U.leaf = gate; U.open = k => { gate.position.x = dx + k * (dW + 0.02); return g; }; U.open(o.open || 0);
      U.anchors = { in: { pos: [dx, 0, 0.7], rot: PI, kind: 'stand' }, out: { pos: [dx, 0, -0.8], rot: 0, kind: 'stand' } };
    } else U.open = () => g;
    return done(g, 'bars', [w, h, 0.12], { ...o, v: 0.05 });
  }

  // =====================================================================================================
  // windows
  // =====================================================================================================
  const viewMat = (kind, seed = 1) => tmat('view|' + kind + '|' + seed, 128, 128, (c, W) => { const r = rng(seed * 71 + 5), G = (a, b, m) => { const g = c.createLinearGradient(0, 0, 0, W); g.addColorStop(0, a); if (m) g.addColorStop(0.6, m); g.addColorStop(1, b); c.fillStyle = g; c.fillRect(0, 0, W, W); };
    if (kind === 'night' || kind === 'city') { G('#060b1c', '#1b2748'); c.fillStyle = '#fff'; for (let i = 0; i < 26; i++) c.fillRect(r() * W, r() * W * 0.6, 1.4, 1.4); c.fillStyle = '#e8eeff'; c.beginPath(); c.arc(W * 0.72, W * 0.24, 9, 0, 7); c.fill();
      c.fillStyle = '#080c16'; let x = 0; while (x < W) { const bw = 10 + r() * 16, bh = (kind === 'city' ? 30 : 12) + r() * (kind === 'city' ? 50 : 14); c.fillRect(x, W - bh, bw, bh); if (kind === 'city') { c.fillStyle = '#ffd98a'; for (let k = 0; k < 6; k++) if (r() < 0.5) c.fillRect(x + 2 + (k % 2) * 5, W - bh + 4 + Math.floor(k / 2) * 9, 2.5, 3.5); c.fillStyle = '#080c16'; } x += bw + 1; } }
    else if (kind === 'sunset') { G('#3a2c5e', '#ffb45a', '#e8675a'); c.fillStyle = '#fff1c0'; c.beginPath(); c.arc(W * 0.4, W * 0.78, 12, 0, 7); c.fill(); c.fillStyle = '#2a1c2e'; c.beginPath(); c.moveTo(0, W); for (let x = 0; x <= W; x += 8) c.lineTo(x, W - 12 - r() * 14); c.lineTo(W, W); c.fill(); }
    else if (kind === 'storm') { G('#2b3038', '#59606a'); c.fillStyle = 'rgba(20,22,28,0.5)'; for (let i = 0; i < 7; i++) { c.beginPath(); c.ellipse(r() * W, r() * W * 0.6, 30 + r() * 30, 10 + r() * 10, 0, 0, 7); c.fill(); } c.fillStyle = '#1c2024'; c.beginPath(); c.moveTo(0, W); for (let x = 0; x <= W; x += 8) c.lineTo(x, W - 14 - r() * 16); c.lineTo(W, W); c.fill(); }
    else { G('#6fb0e8', '#d5ecf8'); c.fillStyle = 'rgba(255,255,255,0.9)'; for (let i = 0; i < 3; i++) { const x = r() * W, y = 14 + r() * 40; c.beginPath(); c.ellipse(x, y, 20, 7, 0, 0, 7); c.ellipse(x + 12, y - 5, 12, 7, 0, 0, 7); c.fill(); } c.fillStyle = '#5d8a5a'; c.beginPath(); c.moveTo(0, W); for (let x = 0; x <= W; x += 8) c.lineTo(x, W - 14 - r() * 14); c.lineTo(W, W); c.fill(); }
  }, { basic: true });
  const spillTex = (nc, nr) => ctex('spill|' + nc + '|' + nr, 128, 128, (c, W) => { c.fillStyle = '#000'; c.fillRect(0, 0, W, W); c.filter = 'blur(5px)'; const m = 14, pw = (W - m * 2) / nc, ph = (W - m * 2) / nr; for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) { const g = c.createLinearGradient(0, 0, 0, W); g.addColorStop(0, '#9a9a9a'); g.addColorStop(1, '#ffffff'); c.fillStyle = g; c.fillRect(m + i * pw + 4, m + j * ph + 4, pw - 8, ph - 8); } c.filter = 'none'; });
  const shaftTex = () => ctex('shaft', 64, 64, (c, W) => { const g = c.createLinearGradient(0, 0, 0, W); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); c.fillStyle = g; c.fillRect(0, 0, W, W); });
  /**
   * Window in its frame. Origin on the floor under the middle of the window; the window itself starts at `sill`.
   * o: {w 1.2, h 1.3, sill 0.9, wallT 0.12, frame, panes [2,2], glass (colour), glow (colour: an unlit bright pane), view 'day'|'sunset'|'night'|'city'|'storm' (a painted backdrop behind the glass),
   *     curtains: true | colour, curtainOpen 0.25 (0 drawn back .. 1 closed), curtainTo 'floor'|'sill', blinds: 0..1 lowered, blindColor, bars (iron bars outside),
   *     spill: true | colour (fake light patch on the floor), spillAngle 40 (sun elevation, degrees), spillYaw 0.3, spillK 0.55, shaft true (hazy beam)}
   * userData: glass, curtain(k), blinds (group), spill (group), setSpill(k), spot {pos, target} for a real S3 spot light through the window
   */
  function windowB(o = {}) {
    const w = o.w ?? 1.2, h = o.h ?? 1.3, sill = o.sill ?? 0.9, wt = o.wallT ?? 0.12, fc = o.frame || C.white, nc = (o.panes || [2, 2])[0], nr = (o.panes || [2, 2])[1], g = grp(), U = g.userData, ft = 0.045, y0 = sill, dz = wt + 0.012, zi = wt / 2;
    g.add(boxB(ft, h, dz, fc).at(-w / 2 + ft / 2, y0, 0), boxB(ft, h, dz, fc).at(w / 2 - ft / 2, y0, 0), boxB(w - ft * 2, ft, dz, fc).at(0, y0, 0), boxB(w - ft * 2, ft, dz, fc).at(0, y0 + h - ft, 0));
    const iw = w - ft * 2, ih = h - ft * 2;
    for (let i = 1; i < nc; i++) g.add(boxB(0.028, ih, 0.035, fc).at(-iw / 2 + i * iw / nc, y0 + ft, 0)); for (let j = 1; j < nr; j++) g.add(box(iw, 0.028, 0.035, fc).at(0, y0 + ft + j * ih / nr, 0));
    const glassM = o.glow ? glow(o.glow, o.glowK ?? 1) : mat(o.glass || C.glass, { opacity: o.glassA ?? 0.24, rough: 0.08, own: true }), gl = keep(mesh(new T.PlaneGeometry(iw, ih), glassM)); gl.material.side = T.DoubleSide; gl.castShadow = false; gl.position.set(0, y0 + h / 2, 0); g.add(gl); U.glass = gl;
    if (o.view) { const v = mesh(new T.PlaneGeometry(iw, ih), viewMat(o.view, o.seed || 1)); v.position.set(0, y0 + h / 2, -zi + 0.012); g.add(v); }
    g.add(box(w + 0.16, 0.03, 0.11, fc).at(0, y0 - 0.015, zi + 0.045), box(w + 0.06, 0.07, 0.016, fc).at(0, y0 - 0.065, zi + 0.008), box(w + 0.1, 0.035, 0.09, shade(fc, 0.9)).at(0, y0 - 0.0175, -zi - 0.035));   // sill board, apron, outer sill
    g.add(boxB(0.06, h + 0.05, 0.016, fc).at(-w / 2 - 0.018, y0, zi + 0.008), boxB(0.06, h + 0.05, 0.016, fc).at(w / 2 + 0.018, y0, zi + 0.008), box(w + 0.16, 0.07, 0.02, fc).at(0, y0 + h + 0.035, zi + 0.01));   // casing
    if (o.bars) for (let i = 0, n = Math.max(2, Math.round(iw / 0.14)); i < n; i++) g.add(rod(0.011, ih + 0.06, C.iron, IRON).at(-iw / 2 + (i + 0.5) * iw / n, y0 + h / 2, -zi + 0.004));
    if (o.blinds) { const k = o.blinds === true ? 1 : o.blinds, bc = o.blindColor || '#e6e2d6', bl = keep(grp()), n = Math.max(1, Math.round(k * ih / 0.055)); bl.add(box(iw - 0.01, 0.04, 0.05, shade(bc, 0.9)).at(0, y0 + h - ft - 0.02, 0));
      for (let i = 0; i < n; i++) bl.add(box(iw - 0.02, 0.004, 0.042, bc).rot(o.blindTilt ?? 0.55, 0, 0).at(0, y0 + h - ft - 0.06 - i * 0.055, 0)); bl.add(box(iw - 0.02, 0.02, 0.03, shade(bc, 0.9)).at(0, y0 + h - ft - 0.06 - n * 0.055, 0), rod(0.003, n * 0.055 + 0.3, shade(bc, 0.8)).at(iw / 2 - 0.05, y0 + h - ft - 0.06 - (n * 0.055 + 0.3) / 2 + 0.03, 0.03));
      bl.position.z = zi - 0.035; g.add(bl); U.blinds = bl; }
    if (o.curtains) { const cc = o.curtains === true ? '#a0483f' : o.curtains, ry = y0 + h + 0.13, rz = zi + 0.09, half = w / 2 + 0.22, yb = o.curtainTo === 'sill' ? y0 - 0.25 : 0.03, ch = ry - yb - 0.012, dr = [];
      g.add(rodAB([-half - 0.08, ry, rz], [half + 0.08, ry, rz], 0.013, o.rodColor || C.woodDark, null, 6), ball(0.028, o.rodColor || C.woodDark, 0).at(-half - 0.09, ry, rz), ball(0.028, o.rodColor || C.woodDark, 0).at(half + 0.09, ry, rz), box(0.02, 0.02, rz - zi, C.woodDark).at(-half + 0.05, ry, (rz + zi) / 2), box(0.02, 0.02, rz - zi, C.woodDark).at(half - 0.05, ry, (rz + zi) / 2));
      for (const s of [-1, 1]) { const d = keep(drape(ch, 7, 0.028, cc, { seed: (o.seed || 1) + (s > 0 ? 7 : 0), own: true })); d.position.set(s * half, yb, rz + (s > 0 ? 0.004 : 0)); d.userData.s = s; g.add(d); dr.push(d); }
      U.drapes = dr; U.curtain = k => { const cw = lerp(0.2, half + 0.012, clamp(k)); dr.forEach(d => d.scale.x = -d.userData.s * cw); return g; }; U.curtain(o.curtainOpen ?? 0.25); }
    const el = (o.spillAngle ?? 40) * PI / 180, az = o.spillYaw ?? 0.3, P = (x, y, lift = 0.02) => { const tt = y / Math.tan(el); return [x + tt * Math.sin(az), lift, zi + tt * Math.cos(az)]; };
    if (o.spill) { const sc = o.spill === true ? '#ffe2b0' : o.spill, k = o.spillK ?? 0.55, sp = keep(grp()), a = [-iw / 2, y0 + ft], b = [iw / 2, y0 + h - ft];
      const pm = new T.MeshBasicMaterial({ map: spillTex(nc, nr), color: sc, blending: T.AdditiveBlending, transparent: true, opacity: k, depthWrite: false, toneMapped: false, side: T.DoubleSide });
      const patch = quad4(P(a[0], a[1]), P(b[0], a[1]), P(b[0], b[1]), P(a[0], b[1]), pm); patch.castShadow = patch.receiveShadow = false; patch.renderOrder = 2; sp.add(patch);
      if (o.shaft !== false) { const sm = new T.MeshBasicMaterial({ map: shaftTex(), color: sc, blending: T.AdditiveBlending, transparent: true, opacity: k * 0.16, depthWrite: false, toneMapped: false, side: T.DoubleSide, fog: false });
        for (const f of [0.02, 0.5, 0.98]) { const x = lerp(a[0], b[0], f), q = quad4(P(x, a[1]), P(x, b[1]), [x, b[1], zi], [x, a[1], zi], sm); q.castShadow = q.receiveShadow = false; q.renderOrder = 3; sp.add(q); }
        for (const y of [a[1], b[1]]) { const q = quad4(P(a[0], y), P(b[0], y), [b[0], y, zi], [a[0], y, zi], sm); q.castShadow = q.receiveShadow = false; q.renderOrder = 3; sp.add(q); } U.shaftMat = sm; }
      sp.children.forEach(keep); g.add(sp); U.spill = sp; U.spillMat = pm; U.setSpill = v => { pm.opacity = k * v; if (U.shaftMat) U.shaftMat.opacity = k * 0.16 * v; return g; }; }
    const c0 = P(0, y0 + h / 2, 0); U.spot = { pos: [-Math.sin(az) * 2.2 * Math.cos(el), y0 + h / 2 + 2.2 * Math.sin(el), -zi - 2.2 * Math.cos(az) * Math.cos(el)], target: [c0[0], 0, c0[2]] };
    U.anchors = { in: { pos: [0, 0, 0.55], rot: PI, kind: 'stand' }, out: { pos: [0, 0, -0.6], rot: 0, kind: 'stand' } };
    return done(g, 'window', [w + 0.16, sill + h + 0.1, wt + 0.2], o);
  }

  // =====================================================================================================
  // stairs and ladder
  // =====================================================================================================
  /**
   * Straight flight of stairs, climbing from the front (+Z) to the back (-Z). style 'closed' (house stairs: risers, closed sides, turned banister) or 'open' (plank steps on two stringers with a plain rail).
   * o: {h 2.8 (total rise), w 1.0, steps, going 0.26, style, wood, color (risers, strings, balusters), rail:'both'|'left'|'right'|'none', runner (carpet colour), seed}
   * userData: at(k) -> [x, y, z] on the stair line for k 0..1, steps, rise, run, anchors bottom / top
   */
  function stairs(o = {}) {
    const rise = o.h ?? 2.8, w = o.w ?? 1.0, n = o.steps ?? Math.max(2, Math.round(rise / 0.18)), going = o.going ?? 0.26, r = rise / n, run = n * going, open = (o.style || 'closed') === 'open';
    const wood = o.wood || (open ? '#8a6843' : C.wood), pale = o.color || (open ? wood : C.white), g = grp(), z0 = run / 2, rr = rng((o.seed || 1) * 97 + 1), rail = o.rail || 'both', U = g.userData, ang = Math.atan2(rise - r, run - going);
    for (let i = 0; i < n; i++) { const zf = z0 - i * going, yt = (i + 1) * r, tc = shade(wood, 0.9 + rr() * 0.2);
      g.add(box(w, 0.036, going + 0.03, tc).at(0, yt - 0.018, zf - going / 2 + 0.015));
      if (!open) g.add(box(w - 0.02, r - 0.036, 0.02, pale).at(0, yt - 0.036 - (r - 0.036) / 2, zf - 0.014));
      if (o.runner) { g.add(box(w * 0.6, 0.008, going + 0.034, o.runner, SOFT).at(0, yt + 0.004, zf - going / 2 + 0.017)); if (!open) g.add(box(w * 0.6, r - 0.03, 0.008, shade(o.runner, 0.9), SOFT).at(0, yt - 0.03 - (r - 0.03) / 2, zf + 0.0005)); } }
    const side = s => { const x = s * (w / 2), t = open ? 0.045 : 0.03;
      const pts = open ? [[z0 + 0.05, 0], [z0 + 0.05, r * 0.4], [-z0 + going, rise + 0.02], [-z0, rise + 0.02], [-z0, rise - 0.3], [z0 - 0.28, 0]] : [[z0 + 0.02, 0], [z0 + 0.02, r + 0.07], [-z0 + going, rise + 0.07], [-z0, rise + 0.07], [-z0, 0]];
      const m = extrude(pts, t, open ? shade(wood, 0.85) : pale); m.rotation.y = -HP; m.position.x = s > 0 ? x + t : x; g.add(m); };
    side(1); side(-1);
    if (open) g.add(boxB(0.08, rise - 0.3, 0.08, shade(wood, 0.8)).at(-w / 2 + 0.02, 0, -z0 + 0.06), boxB(0.08, rise - 0.3, 0.08, shade(wood, 0.8)).at(w / 2 - 0.02, 0, -z0 + 0.06));
    for (const s of [-1, 1]) { if (rail === 'none' || (rail === 'left' && s > 0) || (rail === 'right' && s < 0)) continue; const x = s * (w / 2 + (open ? 0.045 : 0.015)), L = Math.hypot(run - going, rise - r), yb = r + 0.9, mz = (z0 + (-z0 + going)) / 2, my = (yb + rise + 0.9) / 2;
      if (open) { g.add(boxB(0.07, r + 0.98, 0.07, wood).at(x, 0, z0 - 0.02), boxB(0.07, 1.0, 0.07, wood).at(x, rise - 0.04, -z0 + going), box(0.045, 0.09, L + 0.2, shade(wood, 1.08)).rot(ang, 0, 0).at(x, my + 0.02, mz), box(0.03, 0.07, L, shade(wood, 0.92)).rot(ang, 0, 0).at(x, my - 0.42, mz)); }
      else { const nw = (y, z, hh) => { g.add(boxB(0.09, hh, 0.09, pale).at(x, y, z), tbox(0.11, 0.05, 0.11, 0.05, 0.05, pale).at(x, y + hh, z)); }; nw(0, z0 + 0.03, r + 1.02); nw(rise, -z0 + going - 0.02, 1.02);
        g.add(box(0.06, 0.05, L, wood).rot(ang, 0, 0).at(x, my, mz));
        for (let i = 1; i < n; i++) { const z = z0 - i * going + going * 0.5, yb2 = (i + 0.5) * r + 0.07, yt2 = (i + 0.5) * r + 0.9 - 0.02 + r * 0; g.add(boxB(0.028, yt2 - yb2, 0.028, pale).at(x, yb2, z)); } } }
    U.steps = n; U.rise = rise; U.run = run; U.at = k => [0, clamp(k) * rise, z0 - clamp(k) * run];
    U.anchors = { bottom: { pos: [0, 0, z0 + 0.5], rot: PI, kind: 'stand' }, top: { pos: [0, rise, -z0 - 0.45], rot: PI, kind: 'stand' } };
    return done(g, 'stairs', [w + 0.2, rise + 1, run], { ...o, v: open ? 0.06 : 0.035 });
  }
  /** Ladder leaning toward -Z. o: {h 3 (height reached), w 0.42, lean 0.22 (radians), color, style:'wood'|'metal'}. userData: at(k), anchors bottom / top */
  function ladder(o = {}) {
    const h = o.h ?? 3, w = o.w ?? 0.42, lean = o.lean ?? 0.22, metal = o.style === 'metal', col = o.color || (metal ? '#b9c0c6' : C.woodLight), m = metal ? MET : null, len = h / Math.cos(lean), dz = h * Math.tan(lean), g = grp(), inner = grp();
    inner.add(boxB(0.028, len, 0.06, col, m).at(-w / 2, 0, 0), boxB(0.028, len, 0.06, col, m).at(w / 2, 0, 0));
    for (let y = 0.28; y < len - 0.12; y += 0.28) inner.add(metal ? box(w, 0.025, 0.035, shade(col, 0.9), m).at(0, y, 0) : rod(0.017, w, shade(col, 0.88), null, 6).rot(0, 0, HP).at(0, y, 0));
    if (metal) inner.add(box(0.05, 0.03, 0.08, C.rubber).at(-w / 2, 0.015, 0), box(0.05, 0.03, 0.08, C.rubber).at(w / 2, 0.015, 0));
    inner.rotation.x = -lean; inner.position.z = dz / 2; g.add(inner);
    g.userData.at = k => [0, clamp(k) * h, dz / 2 - clamp(k) * dz]; g.userData.anchors = { bottom: { pos: [0, 0, dz / 2 + 0.4], rot: PI, kind: 'stand' }, top: { pos: [0, h, -dz / 2], rot: PI, kind: 'stand' } };
    return done(g, 'ladder', [w + 0.03, h, dz + 0.06], o);
  }

  // =====================================================================================================
  // room shell
  // =====================================================================================================
  const OPEN_DEF = { door: [0.9, 2.1, 0], front: [0.95, 2.1, 0], double: [1.6, 2.1, 0], sliding: [1.8, 2.1, 0], lift: [1.0, 2.1, 0], cellar: [1.0, 2.0, 0], vault: [2.6, 2.6, 0], window: [1.2, 1.3, 0.9], arch: [1.3, 2.3, 0], opening: [1.2, 2.1, 0] };
  /**
   * Room shell: floor, separate wall groups, optional ceiling, skirting, and openings cut into named walls (filled with the matching door / window builder).
   * The interior is w (X) x d (Z) x h, centred on the origin; walls stand outside it. Walls: 'back' (z = -d/2), 'left' (x = -w/2), 'right', 'front' (z = +d/2).
   * o: {w 5, d 4, h 2.6, t 0.12 (wall thickness),
   *     wall: colour | {color, style, dado, dadoH, accent, grime} (see wallMat), walls: {back: ..., left: ...} per-wall overrides,
   *     floor: style name | colour | {style, color, color2, dir:'z'} | false, ceiling: true | false | colour | 'grid' | 'beams' | 'joists' | {style, color, beam}, ceilingShadow false,
   *     trim: colour | false (skirting, cornice), cornice: bool, cutaway: 'front' (default) | [names] | false (walls left out on the camera side),
   *     openings: [{wall 'back', type 'door'|'front'|'double'|'sliding'|'lift'|'cellar'|'vault'|'window'|'arch'|'opening', x 0 (along the wall, + = to the right seen from inside), w, h, sill, fill: false (leave the hole empty), ...builder options}],
   *     seed}
   * userData: walls {name: group}, floor, ceiling, doors [], windows [], fills [] (by opening index), size [w, h, d], anchors (door, doorOut, door2 .., window ..),
   *           put(obj, wall, x, off, y, turn) -> places obj against a wall and adds it to the room, wallPoint(wall, x, y, z) -> [x, y, z] in room space, update(t)
   */
  function room(o = {}) {
    const w = o.w ?? 5, d = o.d ?? 4, h = o.h ?? 2.6, t = o.t ?? 0.12, g = grp(), U = g.userData, seed = o.seed || 1;
    const cut = o.cutaway === undefined ? ['front'] : [].concat(o.cutaway || []), has = n => !cut.includes(n), trim = o.trim === undefined ? C.white : o.trim, skH = o.skirting ?? 0.1;
    const F = { back: { p: [0, -d / 2], r: 0, len: w, ext: t }, front: { p: [0, d / 2], r: PI, len: w, ext: t }, left: { p: [-w / 2, 0], r: HP, len: d, ext: 0 }, right: { p: [w / 2, 0], r: -HP, len: d, ext: 0 } };
    const toRoom = (n, x, y, z) => { const f = F[n], c = Math.cos(f.r), s = Math.sin(f.r); return [f.p[0] + x * c + z * s, y, f.p[1] - x * s + z * c]; };
    const FILL = { door, front: frontDoor, double: doubleDoors, sliding: slidingDoor, lift: liftDoors, cellar: cellarDoor, vault: vaultDoor, window: windowB };
    const ceil = o.ceiling === undefined ? true : o.ceiling, cnt = { door: 0, window: 0 };
    U.walls = {}; U.doors = []; U.windows = []; U.fills = []; U.anchors = {}; U.size = [w, h, d];
    for (const n of ['back', 'left', 'right', 'front']) {
      if (!has(n)) continue;
      const f = F[n], L = f.len, wg = keep(grp()), ov = o.walls && o.walls[n], ws = Object.assign({ seed }, typeof o.wall === 'string' ? { color: o.wall } : o.wall, typeof ov === 'string' ? { color: ov } : ov), wm = wallMat(ws, h);
      wg.position.set(f.p[0], 0, f.p[1]); wg.rotation.y = f.r;
      const ops = (o.openings || []).map((q, i) => ({ ...q, i })).filter(q => (q.wall || 'back') === n).map(q => { const df = OPEN_DEF[q.type || 'door'] || OPEN_DEF.door, sill = q.sill ?? df[2]; return { ...q, type: q.type || 'door', x: q.x || 0, w: q.w ?? df[0], h: Math.min(q.h ?? df[1], h - sill), sill }; }).sort((a, b) => a.x - b.x);
      const segs = []; let x = -L / 2 - f.ext;
      for (const q of ops) { const x0 = q.x - q.w / 2, x1 = q.x + q.w / 2; if (x0 > x + 1e-4) segs.push([x, x0, 0, h]); if (q.sill > 1e-4) segs.push([x0, x1, 0, q.sill]); if (q.sill + q.h < h - 1e-4) segs.push([x0, x1, q.sill + q.h, h]); x = x1; }
      if (x < L / 2 + f.ext - 1e-4) segs.push([x, L / 2 + f.ext, 0, h]);
      for (const [a, b, y0, y1] of segs) wg.add(mesh(uvPlanar(new T.BoxGeometry(b - a, y1 - y0, t).translate((a + b) / 2, (y0 + y1) / 2, -t / 2), 'getX', 'getY', TW, h), wm));
      for (const q of ops) { const { wall, type, x: qx, w: qw, h: qh, sill, i, fill, ...rest } = q; let fg = null;
        if (type === 'arch') { const R = qw / 2, top = sill + qh, yc = top - R - 0.04, pts = [[-R, yc], [-R, top], [R, top], [R, yc]]; for (let k = 1; k < 10; k++) pts.push([Math.cos(k / 10 * PI) * R, yc + Math.sin(k / 10 * PI) * R]);
          const m = extrude(pts, t, wm); uvPlanar(m.geometry, 'getX', 'getY', TW, h, qx / TW, 0); m.position.set(qx, 0, -t); wg.add(m);
          if (trim) { const ap = []; for (let k = 0; k <= 10; k++) ap.push([qx + Math.cos(k / 10 * PI) * (R + 0.035), yc + Math.sin(k / 10 * PI) * (R + 0.035), 0.008]); wg.add(tube(ap, 0.035, trim, { seg: 20, rs: 4 }), boxB(0.07, yc - sill, 0.02, trim).at(qx - R - 0.035, sill, 0.01), boxB(0.07, yc - sill, 0.02, trim).at(qx + R + 0.035, sill, 0.01)); } }
        else if (fill !== false && FILL[type]) { fg = keep(FILL[type]({ wallT: t, w: qw, h: qh, ...(type === 'window' ? { sill } : null), ...(type === 'lift' ? { surround: false } : null), seed: seed + i * 7 + 1, ...rest })); fg.position.set(qx, type === 'window' ? 0 : sill, -t / 2); wg.add(fg);
          const kind = type === 'window' ? 'window' : 'door', nm = kind + (cnt[kind]++ ? cnt[kind] : ''), fa = fg.userData.anchors || {}; (kind === 'window' ? U.windows : U.doors).push(fg);
          for (const k of ['in', 'out']) if (fa[k]) { const a = fa[k]; U.anchors[nm + (k === 'out' ? 'Out' : '')] = { pos: toRoom(n, qx + a.pos[0], a.pos[1], -t / 2 + a.pos[2]), rot: a.rot + f.r, kind: 'stand' }; } }
        else if (type === 'opening' && trim) wg.add(doorFrame(qw, qh, t, trim).at(qx, sill, -t / 2));
        U.fills[i] = fg; }
      if (trim) { const inset = f.ext ? 0 : 0.016, end = L / 2 - inset; let a = -L / 2 + inset;
        if (skH > 0) { for (const q of ops) { if (q.sill > skH) continue; const c0 = q.x - q.w / 2 - 0.062, c1 = q.x + q.w / 2 + 0.062; if (c0 > a + 0.02) wg.add(boxB(c0 - a, skH, 0.015, trim).at((a + c0) / 2, 0, 0.0075)); a = Math.max(a, c1); } if (end > a + 0.02) wg.add(boxB(end - a, skH, 0.015, trim).at((a + end) / 2, 0, 0.0075)); }
        if (o.cornice ?? !!ceil) { const ci = f.ext ? 0 : 0.05; wg.add(box(L - ci * 2, 0.05, 0.05, trim).at(0, h - 0.025, 0.025)); } }
      g.add(wg); U.walls[n] = wg;
    }
    const ex = n => has(n) ? t : 0, fx0 = -w / 2 - ex('left'), fx1 = w / 2 + ex('right'), fz0 = -d / 2 - ex('back'), fz1 = d / 2 + ex('front');
    if (o.floor !== false) { const fs = typeof o.floor === 'object' ? { seed, ...o.floor } : (o.floor || 'wood'), fgeo = new T.BoxGeometry(fx1 - fx0, 0.1, fz1 - fz0).translate((fx0 + fx1) / 2, -0.046, (fz0 + fz1) / 2);
      if (fs.dir === 'z') uvPlanar(fgeo, 'getZ', 'getX', TW, TW); else uvPlanar(fgeo, 'getX', 'getZ', TW, TW);
      const fl = keep(mesh(fgeo, floorMat(fs))); fl.castShadow = false; g.add(fl); U.floor = fl; }
    if (ceil) { const isCol = typeof ceil === 'string' && /^#/.test(ceil), cs = typeof ceil === 'object' ? ceil : { style: typeof ceil === 'string' && !isCol ? ceil : 'plain', color: isCol ? ceil : undefined }, cc = cs.color || '#e7e2d6', cg = keep(grp());
      const cgeo = new T.BoxGeometry(fx1 - fx0, 0.1, fz1 - fz0).translate((fx0 + fx1) / 2, h + 0.05, (fz0 + fz1) / 2); uvPlanar(cgeo, 'getX', 'getZ', 1.28, 1.28);
      const cm = mesh(cgeo, cs.style === 'grid' ? gridCeilMat(cc) : mat(cc, { rough: 1 })); cm.userData.v = 0; cg.add(cm);
      if (cs.style === 'beams' || cs.style === 'joists') { const big = cs.style === 'beams', sp = big ? 1.15 : 0.45, bw = big ? 0.16 : 0.05, bh = big ? 0.2 : 0.17, bc = cs.beam || C.woodDark, r = rng(seed * 19 + 4), n = Math.max(1, Math.round(d / sp)); for (let i = 0; i < n; i++) cg.add(box(w, bh, bw, shade(bc, 0.9 + r() * 0.2)).at(0, h - bh / 2, -d / 2 + (i + 0.5) * d / n)); }
      cg.traverse(m => { if (m.isMesh) m.castShadow = !!o.ceilingShadow; }); g.add(cg); U.ceiling = cg; }
    const bb = new T.Box3();
    U.wallPoint = toRoom;
    U.put = (obj, wall, x = 0, off = 0, y = 0, turn = 0) => { obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0); obj.updateMatrixWorld(true); bb.setFromObject(obj); const p = toRoom(wall, x, y, off - bb.min.z); obj.position.set(p[0], p[1], p[2]); obj.rotation.y = F[wall].r + turn; g.add(obj); return obj; };
    U.update = t => g.traverse(c => { if (c !== g && c.userData.update) c.userData.update(t); });
    g.name = 'room'; fuse(g, { seed }); return g;
  }

  // =====================================================================================================
  // helpers for films
  // =====================================================================================================
  /** World-space position (THREE.Vector3) of a point given in a builder's own space: world(lamp, lamp.userData.lightPos). */
  const world = (obj, p) => { obj.updateWorldMatrix(true, false); return new T.Vector3(p[0], p[1], p[2]).applyMatrix4(obj.matrixWorld); };
  /** World-space anchor {pos: Vector3, rot: heading, kind, ...} of a named anchor on a builder's group (after it has been placed). */
  const anchor = (obj, name) => { const a = obj.userData.anchors && obj.userData.anchors[name]; if (!a) return null; obj.updateWorldMatrix(true, false); const e = obj.matrixWorld.elements; return { ...a, pos: world(obj, a.pos), rot: a.rot + Math.atan2(e[8], e[10]) }; };
  /** Copy a child's anchors into its parent's anchor table (in the parent's space). map = {childAnchor: 'nameInParent'} */
  function adopt(parent, child, map) {
    const A = parent.userData.anchors || (parent.userData.anchors = {}), ca = child.userData.anchors || {}, m = new T.Matrix4(); let n = child; const ch = [];
    while (n && n !== parent) { n.updateMatrix(); ch.push(n); n = n.parent; } ch.reverse().forEach(c => m.multiply(c.matrix)); const ry = Math.atan2(m.elements[8], m.elements[10]);
    for (const k in map) if (ca[k]) { const a = ca[k], v = new T.Vector3(...a.pos).applyMatrix4(m), q = { ...a, pos: [v.x, v.y, v.z], rot: a.rot + ry }; if (a.head) { const hv = new T.Vector3(...a.head).applyMatrix4(m); q.head = [hv.x, hv.y, hv.z]; } A[map[k]] = q; }
    return parent;
  }
  /**
   * Add a point light for every lit lamp, screen or fire under `root` (anything with userData.lightPos and lit !== false), strongest first.
   * Call after the set has been placed with s.add. o: {max 4, k 1 (intensity scale), range 1 (range scale)}. Each light has userData.src (the lamp) and userData.base.
   */
  function lights(s, root, o = {}) {
    root.updateMatrixWorld(true); const found = [];
    root.traverse(x => { const U = x.userData; if (U && U.lightPos && U.lit !== false) found.push({ x, p: new T.Vector3(U.lightPos[0], U.lightPos[1], U.lightPos[2]).applyMatrix4(x.matrixWorld), c: U.lightColor || C.warm, k: U.lightPower ?? 0.6, r: U.lightRange ?? 6 }); });
    found.sort((a, b) => b.k - a.k);
    return found.slice(0, o.max ?? 4).map(f => { const l = s.point(f.p, f.c, f.k * (o.k ?? 1), f.r * (o.range ?? 1)); l.userData.src = f.x; return l; });
  }
  /** A real spot light shining in through a window made by window() (after the window or its room has been placed). o: {color, intensity 1.2, range 12, angle 50, shadow true} */
  function windowLight(s, win, o = {}) { const sp = win.userData.spot; if (!sp) return null; return s.spot(world(win, sp.pos), world(win, sp.target), o.color || '#ffe6bd', o.intensity ?? 1.2, o.range ?? 12, o.angle ?? 50, { shadow: o.shadow !== false, penumbra: 0.35 }); }

  return { room, door, frontDoor, doubleDoors, slidingDoor, liftDoors, cellarDoor, vaultDoor, bars, window: windowB, stairs, ladder,
    world, anchor, adopt, lights, windowLight, fuse, keep, shade, mix, wallMat, floorMat };
})();
