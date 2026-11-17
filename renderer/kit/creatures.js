// renderer/kit/creatures.js - animated non-human creatures for the low-poly 3D stage (S3). One global: KitCreatures.
// Every creature is posed as a PURE FUNCTION OF TIME: c.anim(clip, time, opts) sets the whole pose, nothing accumulates.
//   const wolf = KitCreatures.make('wolf'); s.add(wolf.root); wolf.place(2, 0, -1, 0.5);
//   update: wolf.anim('walk', lt);  or  KitCreatures.travel(wolf, path, lt, { clip: 'trot' });
// Full reference with pictures: docs/kit/creatures.md
const KitCreatures = (() => {
  const T = THREE, PI = Math.PI, TAU = PI * 2, { sin, cos, abs, sqrt, atan2, min, max, floor, sign, pow, hypot, acos, asin } = Math;
  const { grp, noise1, hash1, smooth, ramp, flare } = S3;
  const V3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
  const _q = new T.Quaternion(), _qh = new T.Quaternion(), _q2 = new T.Quaternion(), _e = new T.Euler(), _v = V3(), _v2 = V3(), _m = new T.Matrix4();
  const AX = V3(1, 0, 0), AY = V3(0, 1, 0), AZ = V3(0, 0, 1);
  const quat = (x, y, z) => new T.Quaternion().setFromEuler(new T.Euler(x || 0, y || 0, z || 0, 'YXZ'));
  const QD = { z: quat(), up: quat(-PI / 2), down: quat(PI / 2), back: quat(0, PI) };
  const frac = x => x - floor(x), wave = x => sin(x * TAU), mix = lerp;
  const API = {}, TYPES = {};

  // ------------------------------------------------------------------------------------------------------------
  // Tube: a skinned low-poly tube. Rings sit on a spine; every frame the rings are re-posed (chain FK or points)
  // and the flat-shaded skin follows. Bodies, necks, tails, legs, snakes, tentacles and ghosts are all tubes.
  //   rings: [{d: distance to the next ring, w: half width, t: extent above the spine, b: extent below, c: colour,
  //            e: egg factor (+ = wider on top), q: corner power (<1 boxier), oy: lift}]
  //   o: {color, belly (colour of the underside), bellyAt (-0.45), paint(i, up, j, n) -> colour or null, vary, seed,
  //       flat (flat top/bottom instead of a ridge), capA, capB, rough, metal, opacity, emissive, ei, mat, shadow}
  // ------------------------------------------------------------------------------------------------------------
  const rg = (d, w, t, b, c, x) => Object.assign({ d, w, t: t ?? w, b: b ?? t ?? w, c }, x);
  function Tube(rings, S, o = {}) {
    const n = rings.length, capA = o.capA !== false, capB = o.capB !== false, nv = (n - 1) * S * 6 + (capA ? S * 3 : 0) + (capB ? S * 3 : 0);
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), vr = new Uint16Array(nv), vx = new Float32Array(nv), vy = new Float32Array(nv);
    const a0 = PI / 2 + (o.flat ? PI / S : 0), rr = rng((o.seed || 1) * 7919 + 13), va = o.vary ?? 0.07, lx = [], ly = [], cy = [];
    for (let i = 0; i < n; i++) {
      const r = rings[i], q = r.q ?? o.q ?? 1, e = r.e ?? o.e ?? 0, t = r.t ?? r.w, b = r.b ?? r.w; lx.push([]); ly.push([]); cy.push((t - b) / 2 + (r.oy || 0));
      for (let j = 0; j < S; j++) { const a = a0 + TAU * j / S, ca = cos(a), sa = sin(a), px = sign(ca) * pow(abs(ca), q), py = sign(sa) * pow(abs(sa), q); lx[i].push(r.w * px * (1 + e * py)); ly[i].push((py >= 0 ? t : b) * py + (r.oy || 0)); }
    }
    let k = 0; const c1 = new T.Color();
    const put = (i, j) => { vr[k] = i; if (j < 0) { vx[k] = 0; vy[k] = cy[i]; } else { vx[k] = lx[i][j % S]; vy[k] = ly[i][j % S]; } col[k * 3] = c1.r; col[k * 3 + 1] = c1.g; col[k * 3 + 2] = c1.b; k++; };
    const tint = (i, up, j) => { let c = o.paint ? o.paint(i, up, j, n) : null; if (c == null) c = (o.belly && up < (o.bellyAt ?? -0.45)) ? o.belly : (rings[i].c || o.color || '#888888'); c1.set(c).multiplyScalar(1 + (rr() - 0.5) * 2 * va); };
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < S; j++) {
      const up = sin(a0 + TAU * (j + 0.5) / S); tint(i, up, j);
      if ((i + j) % 2) { put(i, j); put(i, j + 1); put(i + 1, j + 1); tint(i, up, j); put(i, j); put(i + 1, j + 1); put(i + 1, j); }
      else { put(i, j); put(i, j + 1); put(i + 1, j); tint(i, up, j); put(i, j + 1); put(i + 1, j + 1); put(i + 1, j); }
    }
    if (capA) for (let j = 0; j < S; j++) { tint(0, sin(a0 + TAU * (j + 0.5) / S), j); put(0, -1); put(0, j + 1); put(0, j); }
    if (capB) for (let j = 0; j < S; j++) { tint(n - 1, sin(a0 + TAU * (j + 0.5) / S), j); put(n - 1, -1); put(n - 1, j); put(n - 1, j + 1); }
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const m = new T.Mesh(geo, o.mat || S3.mat('#ffffff', { vc: true, rough: o.rough ?? 0.88, metal: o.metal, emissive: o.emissive, ei: o.ei, opacity: o.opacity, side: o.side, own: o.own }));
    m.frustumCulled = false; m.castShadow = !(o.opacity < 1) && o.shadow !== false && !m.material.isMeshBasicMaterial; m.receiveShadow = o.shadow !== false;
    const P = [], R = [], U = [], F = [], Q = [], sx = new Float32Array(n).fill(1), sy = new Float32Array(n).fill(1), d = rings.map(r => r.d || 0);
    for (let i = 0; i < n; i++) { P.push(V3()); R.push(V3(1, 0, 0)); U.push(V3(0, 1, 0)); F.push(V3(0, 0, 1)); Q.push(new T.Quaternion()); }
    const tube = { mesh: m, n, P, R, U, F, Q, sx, sy, d, rings,
      /** Write the skin from the ring frames. Call once after posing. */
      update() {
        for (let v = 0, w = 0; v < nv; v++, w += 3) { const i = vr[v], p = P[i], r = R[i], u = U[i], a = vx[v] * sx[i], b = vy[v] * sy[i]; pos[w] = p.x + r.x * a + u.x * b; pos[w + 1] = p.y + r.y * a + u.y * b; pos[w + 2] = p.z + r.z * a + u.z * b; }
        for (let w = 0; w < nv * 3; w += 9) {
          const ax = pos[w + 3] - pos[w], ay = pos[w + 4] - pos[w + 1], az = pos[w + 5] - pos[w + 2], bx = pos[w + 6] - pos[w], by = pos[w + 7] - pos[w + 1], bz = pos[w + 8] - pos[w + 2];
          let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = 1 / (sqrt(nx * nx + ny * ny + nz * nz) || 1); nx *= l; ny *= l; nz *= l;
          for (let q = 0; q < 9; q += 3) { nor[w + q] = nx; nor[w + q + 1] = ny; nor[w + q + 2] = nz; }
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; return tube;
      },
      /** Forward kinematics: start at p0 with orientation q0, bend by pitch[i] (+ = up), yaw[i] (+ = toward +X), roll[i] at each ring. */
      chain(p0, q0, pitch, yaw, roll) {
        _q.copy(q0); let px = p0.x, py = p0.y, pz = p0.z;
        for (let i = 0; i < n; i++) {
          const hp = pitch ? (pitch[i] || 0) / 2 : 0, hw = yaw ? (yaw[i] || 0) / 2 : 0, hr = roll ? (roll[i] || 0) / 2 : 0, bent = hp || hw || hr;
          if (bent) { _e.set(-hp, hw, hr, 'YXZ'); _qh.setFromEuler(_e); _q.multiply(_qh); }
          P[i].set(px, py, pz); R[i].set(1, 0, 0).applyQuaternion(_q); U[i].set(0, 1, 0).applyQuaternion(_q); F[i].set(0, 0, 1).applyQuaternion(_q); Q[i].copy(_q);
          if (bent) _q.multiply(_qh);
          _v.set(0, 0, 1).applyQuaternion(_q); px += _v.x * d[i]; py += _v.y * d[i]; pz += _v.z * d[i];
        }
        return tube;
      },
      /** Ring frames from the ring positions P (already set). hint = the side vector (isUp false) or the up vector (isUp true). mitre widens rings at sharp bends. */
      frames(hint, isUp, mitre) {
        for (let i = 0; i < n; i++) {
          const a = P[max(0, i - 1)], b = P[min(n - 1, i + 1)]; F[i].subVectors(b, a); if (F[i].lengthSq() < 1e-10) F[i].set(0, 0, 1); F[i].normalize();
          if (isUp) { R[i].crossVectors(hint, F[i]); if (R[i].lengthSq() < 1e-8) R[i].set(1, 0, 0); R[i].normalize(); U[i].crossVectors(F[i], R[i]); }
          else { U[i].crossVectors(F[i], hint); if (U[i].lengthSq() < 1e-8) U[i].set(0, 1, 0); U[i].normalize(); R[i].crossVectors(U[i], F[i]); }
          if (mitre) { sy[i] = 1; if (i > 0 && i < n - 1) { _v.subVectors(P[i], a).normalize(); _v2.subVectors(b, P[i]).normalize(); sy[i] = min(1.7, 1 / sqrt(max(0.2, (1 + _v.dot(_v2)) / 2))); } }
        }
        return tube;
      },
      /** Put an Object3D on ring i (offset lx side, ly up, lz forward) with the ring's orientation. */
      frameTo(i, obj, ox = 0, oy = 0, oz = 0) { obj.position.copy(P[i]).addScaledVector(R[i], ox).addScaledVector(U[i], oy).addScaledVector(F[i], oz); _m.makeBasis(R[i], U[i], F[i]); obj.quaternion.setFromRotationMatrix(_m); return obj; },
      /** Point on ring i in the tube's space. */
      pt(i, ox = 0, oy = 0, oz = 0, out = V3()) { return out.copy(P[i]).addScaledVector(R[i], ox).addScaledVector(U[i], oy).addScaledVector(F[i], oz); },
    };
    return tube;
  }
  /** Rigid loft: a Tube posed once. o.dir: 'z' (default, toward +Z), 'up', 'down', 'back'; o.at: start point; o.pitch / o.yaw: per-ring bends. */
  const loft = (rings, S, o = {}) => Tube(rings, S, o).chain(o.at || V3(), o.quat || QD[o.dir || 'z'], o.pitch, o.yaw).update().mesh;

  // ---------- shared creature plumbing ----------
  /** Eyes: unlit beads that can glow (they bloom) with a soft halo. Returns {set(color, glow), meshes, flares}. */
  function mkEyes(parent, pts, r, color = '#0c0c0e', halo = 9) {
    const m = new T.MeshBasicMaterial({ color, toneMapped: false }), meshes = [], flares = [];
    pts.forEach(p => { const e = new T.Mesh(new T.IcosahedronGeometry(r, 1), m); e.position.set(p[0], p[1], p[2]); parent.add(e); meshes.push(e); const f = flare(color, r * halo, 0.5); f.position.copy(e.position); f.visible = false; parent.add(f); flares.push(f); });
    const ey = { mat: m, meshes, flares, r, set(c, g = 1) { m.color.set(c).multiplyScalar(g > 0 ? g : 1); flares.forEach(f => { f.visible = g > 0; f.material.color.set(c); f.material.opacity = min(1, 0.25 + 0.2 * g); f.scale.setScalar(r * (halo * 0.6 + halo * 0.4 * g)); }); return ey; } };
    return ey;
  }
  /** Base object every creature shares. */
  function creature(type, root, ext) {
    const c = { type, root, clips: [], travelYaw: 0, air: false,
      /** Put the creature somewhere: place(x, y, z, heading) or place([x, y, z], heading). heading in radians, + turns toward +X. */
      place(x, y, z, h) { if (x && (x.isVector3 || Array.isArray(x))) { h = y; const a = x.isVector3 ? [x.x, x.y, x.z] : x; x = a[0]; y = a[1]; z = a[2]; } root.position.set(x, y, z); if (h != null) root.rotation.y = h; return c; },
      anim() { return c; }, lookAt() { return c; }, jaw() { return c; }, eyes() { return c; }, speedOf() { return 1; },
    };
    root.userData.creature = c; root.name = type; return Object.assign(c, ext);
  }
  /** World point -> the creature's local space. */
  const toLocal = (root, p, out = V3()) => { root.updateWorldMatrix(true, false); if (p.isVector3) out.copy(p); else out.set(p[0], p[1], p[2]); return root.worldToLocal(out); };
  /** Two-bone IK in a plane. h = hip (z, y), a = ankle target (z, y); bend +1 puts the knee forward (+z), -1 backward. Returns [kneeZ, kneeY, ankleZ, ankleY]. */
  function ik2(hz, hy, az, ay, L1, L2, bend) {
    let dz = az - hz, dy = ay - hy, d = hypot(dz, dy); const mx = (L1 + L2) * 0.998, mn = abs(L1 - L2) + 1e-4;
    if (d > mx) { dz *= mx / d; dy *= mx / d; d = mx; } else if (d < mn) { const s = mn / (d || 1e-6); dz = (dz || 1e-6) * s; dy *= s; d = mn; }
    const al = atan2(dz, -dy), be = acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)), f1 = al + bend * be;
    return [hz + L1 * sin(f1), hy - L1 * cos(f1), hz + dz, hy + dy];
  }

  // @@MORE@@

  /** Make a creature: KitCreatures.make('wolf', {size: 1.1, color: '#333'}). See KitCreatures.types for every type name. */
  API.make = (type, o = {}) => { const f = TYPES[type]; if (!f) throw new Error('KitCreatures.make: unknown type "' + type + '". Types: ' + Object.keys(TYPES).join(', ')); return f(o, type); };
  Object.defineProperty(API, 'types', { get: () => Object.keys(TYPES) });
  API.Tube = Tube; API.loft = loft; API.ring = rg;
  return API;
})();
