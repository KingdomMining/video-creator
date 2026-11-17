// actors_c.js - "cinematic and fluid" low-poly character system for the 3D stage (three.js r160, loaded after stage3d.js).
// One global: ActorsC. Full reference: docs/kit/actors_c/README.md
//
//   const A = ActorsC.make({ top: { type: 'hoodie', color: '#7a2f3a' }, hair: { style: 'bob', color: '#2a1a12' } });
//   s.add(A.root);  A.place(0, 0, 0, 0.3);
//   A.anim('walk', lt);  A.lookAt([2, 1.6, 4]);  A.face('happy');  A.blink(lt);
//
// HOW IT WORKS
//   * Rigid segments on a joint hierarchy (no skinning): pelvis > spine > chest > neck > head, clavicle > upper arm >
//     forearm > hand (palm, fingers, index), thigh > shin > foot > toe. Every mesh is a faceted "loft" with vertex colours,
//     so a whole character is one lit material and about 40 meshes.
//   * A POSE is a flat object of numbers in REFERENCE UNITS (a 1.75 m figure; the rig scales it to cfg.height).
//     Legs are driven by foot targets (inverse kinematics) so feet plant, roll heel-to-toe and never slide;
//     arms are forward kinematics with optional hand targets in chest / head / actor / world space.
//   * Clips are pure functions (time, opts) -> pose. Blending is a per-key lerp (ActorsC.lerpPose).
//   * Everything is a pure function of the time arguments: no state is carried between frames.
const ActorsC = (() => {
  const T = THREE, PI = Math.PI, TAU = PI * 2, D2R = PI / 180;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max, sqrt = Math.sqrt, atan2 = Math.atan2;
  const cl = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
  const lp = (a, b, k) => a + (b - a) * k;
  const sm = x => { x = cl(x); return x * x * (3 - 2 * x); };                 // smoothstep 0..1
  const smr = (x, a, b) => sm((x - a) / (b - a));                              // smooth ramp a..b
  const eio = x => { x = cl(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };   // ease in-out cubic
  const eout = x => 1 - Math.pow(1 - cl(x), 3);                                // ease out
  const ein = x => { x = cl(x); return x * x * x; };
  const back = x => { x = cl(x); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };   // overshoot then settle
  const fr = x => x - Math.floor(x);
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const h1 = (n, s = 0) => fr(sin(n * 127.1 + s * 311.7) * 43758.5453);
  /** Smooth value noise in [-1, 1]: slow drifts, weight shifts, tremble. */
  const nz = (x, s = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (h1(i, s) * (1 - u) + h1(i + 1, s) * u) * 2 - 1; };
  /** Hermite between (p0, slope m0) and (p1, slope m1) for k in 0..1. Used for foot paths that meet the ground at ground speed. */
  const herm = (p0, m0, p1, m1, k) => { const k2 = k * k, k3 = k2 * k; return (2 * k3 - 3 * k2 + 1) * p0 + (k3 - 2 * k2 + k) * m0 + (-2 * k3 + 3 * k2) * p1 + (k3 - k2) * m1; };
  /** Skewed periodic wave in [-1, 1] (period 1). skew > 0 leans the peak forward: limbs that whip instead of swinging like a pendulum. */
  const wave = (ph, skew = 0) => { const a = fr(ph) * TAU; return sin(a + skew * sin(a)); };

  // ------------------------------------------------------------------------------------------------------------
  // REFERENCE SKELETON (metres, for a 1.75 m adult). Clips are authored against these numbers.
  // ------------------------------------------------------------------------------------------------------------
  const REF = {
    hipY: 0.935,            // height of the pelvis pivot (midway between the hip joints) when standing
    hipX: 0.088,            // hip joint half-spacing
    thigh: 0.43, shin: 0.43, ankleY: 0.075, heel: 0.058, ball: 0.125, toe: 0.2,     // foot: heel behind / ball and toe tip ahead of the ankle
    spine: [0, 0.13, -0.008], chest: [0, 0.16, 0], neck: [0, 0.245, -0.012], head: [0, 0.062, 0.012],
    shX: 0.185, shY: 0.205, shZ: -0.004, clavX: 0.03,          // shoulder joint relative to the chest joint
    upper: 0.285, fore: 0.255, hand: 0.185,
    eyeY: 0.086,            // eye line above the head joint
  };
  REF.leg = REF.thigh + REF.shin;
  REF.chestY = REF.hipY + REF.spine[1] + REF.chest[1];
  REF.shoulderY = REF.chestY + REF.shY;
  REF.headY = REF.chestY + REF.neck[1] + REF.head[1];

  // ------------------------------------------------------------------------------------------------------------
  // POSE
  // Conventions: pitch + = lean / nod forward.  yaw + = turn toward +X (the character's left).  roll + = tip toward the
  // character's right.  For limbs, x is "own side positive" (the same number means the same thing for left and right),
  // so mirroring a pose is a plain swap of L and R plus a sign flip of the central yaw / roll / x keys.
  // ------------------------------------------------------------------------------------------------------------
  const P0 = {
    // whole-body offset and rotation about the pelvis rest point (float, swim, tumble). Feet move with it.
    rx: 0, ry: 0, rz: 0, rp: 0, rw: 0, rr: 0,
    // pelvis: offset from its rest position (0, REF.hipY, 0) and rotation
    px: 0, py: 0, pz: 0, pp: 0, pw: 0, pr: 0,
    sp: 0, sw: 0, sr: 0,          // lower spine (relative to pelvis)
    cp: 0, cw: 0, cr: 0,          // chest (relative to spine)
    np: 0, nw: 0, nr: 0,          // neck
    hp: 0, hw: 0, hr: 0,          // head. With hstab = 1 these are measured against the ACTOR, not the chest (a stabilised head)
    hstab: 1,
    breath: 0,                    // 0..1 chest expansion
    swx: 0, swz: 0,               // secondary swing for hair, capes, skirts, ties (radians-ish; clips give it a phase lag)
  };
  const SIDE = ['L', 'R'], SLOTS = ['c', 'h', 'a', 'w'];
  for (const S of SIDE) {
    Object.assign(P0, {
      ['a' + S + 'x']: 0.02, ['a' + S + 'z']: 0.075, ['a' + S + 'y']: 0,     // shoulder: flex forward, abduct, external twist
      ['e' + S]: 0.16,                                                        // elbow flex
      ['w' + S + 'x']: 0, ['w' + S + 'y']: 0, ['w' + S + 'z']: 0,              // wrist flex, forearm twist, deviation
      ['g' + S]: 0.32, ['i' + S]: 0,                                           // finger curl 0..1, index finger extended 0..1
      ['sh' + S]: 0, ['sf' + S]: 0,                                            // shoulder shrug up, shoulder forward
      ['eh' + S + 'x']: 0.5, ['eh' + S + 'y']: -0.75, ['eh' + S + 'z']: -0.55, // elbow direction hint for hand targets (chest space)
      ['o' + S]: 0, ['of' + S + 'x']: 0, ['of' + S + 'y']: -1, ['of' + S + 'z']: 0, ['op' + S + 'x']: -1, ['op' + S + 'y']: 0, ['op' + S + 'z']: 0,   // absolute hand orientation (actor space): weight, fingers direction, palm normal
      ['f' + S + 'x']: 0.088, ['f' + S + 'y']: 0, ['f' + S + 'z']: 0,          // foot: sole point under the ankle (actor space)
      ['f' + S + 'p']: 0, ['f' + S + 'w']: 0.1, ['f' + S + 'r']: 0,            // foot pitch (heel up +, toes up -), toe-out, roll
      ['kn' + S]: 0, ['to' + S]: 0,                                            // knee pushed outward, extra toe bend
    });
    for (const sl of SLOTS) Object.assign(P0, { ['k' + S + sl]: 0, ['k' + S + sl + 'x']: 0, ['k' + S + sl + 'y']: 0, ['k' + S + sl + 'z']: 0 });   // hand target: weight + point
  }
  const KEYS = Object.keys(P0);
  // groups whose vectors are blended by their weight (so an unused target never drags a used one)
  const WGROUPS = [];
  for (const S of SIDE) { for (const sl of SLOTS) WGROUPS.push({ w: 'k' + S + sl, v: ['k' + S + sl + 'x', 'k' + S + sl + 'y', 'k' + S + sl + 'z'] }); WGROUPS.push({ w: 'o' + S, v: ['of' + S + 'x', 'of' + S + 'y', 'of' + S + 'z', 'op' + S + 'x', 'op' + S + 'y', 'op' + S + 'z'] }); }
  const WKEY = new Set(); WGROUPS.forEach(g => { WKEY.add(g.w); g.v.forEach(k => WKEY.add(k)); });
  const PLAIN = KEYS.filter(k => !WKEY.has(k));
  const NEG = ['rx', 'rw', 'rr', 'px', 'pw', 'pr', 'sw', 'sr', 'cw', 'cr', 'nw', 'nr', 'hw', 'hr', 'swx'];       // sign flips when mirrored
  const LKEYS = KEYS.filter(k => /L/.test(k) && P0[k.replace('L', 'R')] !== undefined && !/^(k[LR]w)/.test(k));  // left keys with a right twin (world targets are swapped too, see mirrorPose)
  const g0 = (p, k) => { const v = p[k]; return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : P0[k]; };

  /** A full pose: the neutral stand with `over` applied. */
  const P = over => over ? Object.assign({}, P0, over) : Object.assign({}, P0);
  /** Blend two pose objects (missing keys count as the neutral pose). k = 0 gives a, k = 1 gives b. */
  function lerpPose(a, b, k) {
    a = a || P0; b = b || P0; k = num(k, 0); const o = {};
    for (const key of PLAIN) { const x = g0(a, key), y = g0(b, key); o[key] = x + (y - x) * k; }
    for (const g of WGROUPS) {
      const wa = g0(a, g.w), wb = g0(b, g.w), ka = wa * (1 - k), kb = wb * k, s = ka + kb; o[g.w] = wa + (wb - wa) * k;
      if (s > 1e-6) for (const v of g.v) o[v] = (g0(a, v) * ka + g0(b, v) * kb) / s; else for (const v of g.v) o[v] = k < 0.5 ? g0(a, v) : g0(b, v);
    }
    for (const key in a) if (!(key in o)) o[key] = a[key]; for (const key in b) if (!(key in o)) o[key] = b[key];   // keep foreign keys
    return o;
  }
  /** Weighted blend of many poses: [[pose, weight], ...]. */
  function blendPoses(list) {
    let acc = null, tw = 0;
    for (const [p, w] of list) { if (!(w > 0) || !p) continue; tw += w; acc = acc ? lerpPose(acc, p, w / tw) : p; }
    return acc || P();
  }
  /** Swap left and right. */
  function mirrorPose(p) {
    const o = Object.assign({}, P0, p);
    for (const k of LKEYS) { const r = k.replace('L', 'R'), t = g0(p, k); o[k] = g0(p, r); o[r] = t; }
    for (const k of NEG) o[k] = -g0(p, k);
    for (const [l, r] of [['kLw', 'kRw'], ['kLwx', 'kRwx'], ['kLwy', 'kRwy'], ['kLwz', 'kRwz']]) { o[l] = g0(p, r); o[r] = g0(p, l); }
    return o;
  }
  // body regions for layering one clip over another
  const reKey = re => KEYS.filter(k => re.test(k));
  const REGION = {
    armL: reKey(/^(aL|eL|wL|gL|iL|shL|sfL|ehL|oL|ofL|opL|kL)/), armR: reKey(/^(aR|eR|wR|gR|iR|shR|sfR|ehR|oR|ofR|opR|kR)/),
    head: ['np', 'nw', 'nr', 'hp', 'hw', 'hr', 'hstab'], torso: ['sp', 'sw', 'sr', 'cp', 'cw', 'cr', 'breath'],
    legs: reKey(/^(f[LR]|kn[LR]|to[LR])/), pelvis: ['px', 'py', 'pz', 'pp', 'pw', 'pr'], root: ['rx', 'ry', 'rz', 'rp', 'rw', 'rr'],
  };
  REGION.arms = REGION.armL.concat(REGION.armR);
  REGION.upper = REGION.arms.concat(REGION.head, REGION.torso);
  REGION.lower = REGION.legs.concat(REGION.pelvis, REGION.root);
  /** Take `region` ('arms' | 'armL' | 'armR' | 'head' | 'torso' | 'upper' | 'legs' | 'lower') from `over` and the rest from `base`. k fades it in. */
  function layerPose(base, over, region = 'upper', k = 1) {
    const o = Object.assign({}, P0, base), src = k >= 1 ? over : lerpPose(base, over, k);
    for (const key of (REGION[region] || REGION.upper)) o[key] = g0(src, key);
    return o;
  }

  // ------------------------------------------------------------------------------------------------------------
  // COLOUR + GEOMETRY ("soup" of flat-shaded, vertex-coloured triangles)
  // ------------------------------------------------------------------------------------------------------------
  const _cc = new Map();
  /** Colour (cached, linear working space). Accepts '#hex', a number or a THREE.Color. */
  const C = x => { if (x && x.isColor) return x; let c = _cc.get(x); if (!c) { c = new T.Color(x); _cc.set(x, c); } return c; };
  const _hsl = { h: 0, s: 0, l: 0 };
  /** Derive a colour: dl shifts lightness, ds scales saturation, toward/k mixes toward another colour. */
  const tone = (x, dl = 0, ds = 1, toward = null, k = 0) => { const c = C(x).clone(); c.getHSL(_hsl); c.setHSL(_hsl.h, cl(_hsl.s * ds), cl(_hsl.l + dl)); if (toward) c.lerp(C(toward), k); return c; };
  const mixc = (a, b, k) => C(a).clone().lerp(C(b), k);
  const lum = x => { const c = C(x); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };

  const _v = new T.Vector3(), _m4 = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _s3 = new T.Vector3();
  class Soup {
    constructor(seed = 1, vary = 0.035) { this.p = []; this.c = []; this.seed = seed; this.vary = vary; this.M = new T.Matrix4(); this.flip = false; this.f = 0; }
    /** Set the transform applied to everything added next. rot is XYZ euler; scale may be a number or [x,y,z] (negative x mirrors). */
    at(pos, rot, scale) { _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, 'XYZ'); _q.setFromEuler(_e); if (scale == null) _s3.set(1, 1, 1); else if (typeof scale === 'number') _s3.set(scale, scale, scale); else _s3.set(scale[0], scale[1], scale[2]); _v.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0); this.M.compose(_v, _q, _s3); this.flip = this.M.determinant() < 0; return this; }
    id() { this.M.identity(); this.flip = false; return this; }
    tri(a, b, c, col) {
      if (this.flip) { const t = b; b = c; c = t; }
      const k = 1 + (h1(this.f++, this.seed) - 0.5) * 2 * this.vary, cc = C(col);
      for (const q of [a, b, c]) { _v.set(q[0], q[1], q[2]).applyMatrix4(this.M); this.p.push(_v.x, _v.y, _v.z); this.c.push(cc.r * k, cc.g * k, cc.b * k); }
      return this;
    }
    quad(a, b, c, d, col, alt) { if (alt) { this.tri(a, b, c, col); this.tri(a, c, d, col); } else { this.tri(a, b, d, col); this.tri(b, c, d, col); } return this; }
    /**
     * Faceted tube through cross-sections along Y. rings: [{y, rx, rz, x, z, c, sq}] (rx/rz half-width / half-depth, c = colour of
     * the band ABOVE this ring, sq = 0 ellipse .. 1 boxy). o: {n sides, off (0.5 puts a flat face at the front), color, cap:'both'|'start'|'end'|'none',
     * face(i, j, n) -> colour override, skip(i, j, n) -> true to leave a hole}
     */
    loft(rings, o = {}) {
      const n = o.n || 8, off = o.off ?? 0.5, V = [], up = rings[rings.length - 1].y >= rings[0].y;
      for (const r of rings) {
        const row = [], e = 2 + (r.sq || 0) * 5;
        for (let j = 0; j < n; j++) { const th = (j + off) / n * TAU, ux = sin(th), uz = cos(th), s = e === 2 ? 1 : 1 / Math.pow(Math.pow(abs(ux), e) + Math.pow(abs(uz), e), 1 / e), zr = uz >= 0 ? (r.zf ?? r.rz) : (r.zb ?? r.rz); row.push([(r.x || 0) + r.rx * ux * s, r.y, (r.z || 0) + zr * uz * s]); }
        V.push(row);
      }
      let bc = o.color;
      for (let i = 0; i < rings.length - 1; i++) {
        if (rings[i].c !== undefined) bc = rings[i].c;
        for (let j = 0; j < n; j++) {
          if (o.skip && o.skip(i, j, n)) continue;
          const j2 = (j + 1) % n, col = (o.face && o.face(i, j, n)) || bc, A = V[i][j], B = V[i][j2], Cc = V[i + 1][j2], Dd = V[i + 1][j], alt = j >= n / 2;
          if (up) this.quad(A, B, Cc, Dd, col, alt); else this.quad(B, A, Dd, Cc, col, alt);
        }
      }
      const cap = o.cap || 'both', capf = (row, r, col, down) => { const ctr = [r.x || 0, r.y, r.z || 0]; for (let j = 0; j < n; j++) { const j2 = (j + 1) % n; if (down) this.tri(ctr, row[j2], row[j], col); else this.tri(ctr, row[j], row[j2], col); } };
      if (cap === 'both' || cap === 'start') capf(V[0], rings[0], o.cap0 || rings[0].c || o.color, up);
      if (cap === 'both' || cap === 'end') capf(V[V.length - 1], rings[rings.length - 1], o.cap1 || bc, !up);
      return this;
    }
    /** Box centred on the current transform. o: {tx, tz} scale the top face (taper), {bx, bz} the bottom. */
    box(w, h, d, col, o = {}) {
      const tx = o.tx ?? 1, tz = o.tz ?? 1, bx = o.bx ?? 1, bz = o.bz ?? 1, x = w / 2, y = h / 2, z = d / 2;
      const a = [-x * bx, -y, z * bz], b = [x * bx, -y, z * bz], c = [x * bx, -y, -z * bz], dd = [-x * bx, -y, -z * bz], e = [-x * tx, y, z * tz], f = [x * tx, y, z * tz], g = [x * tx, y, -z * tz], hh = [-x * tx, y, -z * tz];
      this.quad(a, b, f, e, o.front || col); this.quad(b, c, g, f, col); this.quad(c, dd, hh, g, o.backc || col); this.quad(dd, a, e, hh, col); this.quad(e, f, g, hh, o.top || col); this.quad(dd, c, b, a, col);
      return this;
    }
    /** Any THREE geometry, in one colour. */
    geo(g, col) { const s = g.index ? g.toNonIndexed() : g, p = s.attributes.position; for (let i = 0; i < p.count; i += 3) this.tri([p.getX(i), p.getY(i), p.getZ(i)], [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)], [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)], col); return this; }
    /** Low-poly ball / ellipsoid. */
    ball(r, col, detail = 0, sc) { const g = new T.IcosahedronGeometry(r, detail); if (sc) g.scale(sc[0], sc[1], sc[2]); return this.geo(g, col); }
    /** Flat disc in the XY plane facing +Z (n sides), radii rx / ry. */
    disc(rx, ry, col, n = 8, z = 0) { for (let j = 0; j < n; j++) { const a = j / n * TAU, b = (j + 1) / n * TAU; this.tri([0, 0, z], [cos(a) * rx, sin(a) * ry, z], [cos(b) * rx, sin(b) * ry, z], col); } return this; }
    get tris() { return this.p.length / 9; }
    build() { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute('color', new T.BufferAttribute(new Float32Array(this.c), 3)); g.computeVertexNormals(); g.computeBoundingSphere(); return g; }
  }
  const R = (y, rx, rz, z = 0, c, sq, x = 0) => ({ y, rx, rz, z, c, sq, x });        // ring shorthand

  // ------------------------------------------------------------------------------------------------------------
  // MATERIALS: one lit, vertex-coloured material per character (+ a glossy one and unlit glow ones), patched so the
  // whole character can be washed with a colour (tint) and faded by height (ghosts have no feet).
  // ------------------------------------------------------------------------------------------------------------
  function litMat(u, o = {}) {
    const m = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: o.rough ?? 0.86, metalness: o.metal ?? 0, side: o.double ? T.DoubleSide : T.FrontSide });
    if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.ei ?? 1; }
    m.onBeforeCompile = sh => {
      sh.uniforms.uTint = u.tint; sh.uniforms.uTintK = u.tintK; sh.uniforms.uFade = u.fade; sh.uniforms.uSelf = u.self;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vAcY;').replace('#include <project_vertex>', '#include <project_vertex>\nvAcY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uTintK; uniform vec4 uFade; uniform float uSelf; varying float vAcY;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTint, uTintK);\nif (uFade.z > 0.5) diffuseColor.a *= mix(uFade.w, 1.0, smoothstep(uFade.x, uFade.y, vAcY));')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uSelf;');
    };
    m.customProgramCacheKey = () => 'actorsC1';
    return m;
  }
  const glowMat = (color, k = 1) => new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(k), toneMapped: false });

  // ------------------------------------------------------------------------------------------------------------
  // LOOK: cfg -> proportions, colours and garment specs
  // ------------------------------------------------------------------------------------------------------------
  const TOPS = {
    none:       { sleeve: 0, fat: 0, hem: null },
    tshirt:     { sleeve: 0.46, fat: 0.007, hem: 0.03, collar: 'crew' },
    tank:       { sleeve: 0, fat: 0.005, hem: 0.03, collar: 'tank' },
    longsleeve: { sleeve: 1, fat: 0.008, hem: 0.03, collar: 'crew', cuff: 'rib' },
    shirt:      { sleeve: 1, fat: 0.008, hem: 'tuck', collar: 'shirt', cuff: 'band', placket: true },
    hoodie:     { sleeve: 1, fat: 0.017, hem: -0.005, collar: 'hood', cuff: 'rib', hemBand: true, pocket: true },
    jacket:     { sleeve: 1, fat: 0.016, hem: 0.0, collar: 'stand', open: true, cuff: 'band', zip: true },
    coat:       { sleeve: 1, fat: 0.018, hem: 0.02, skirt: 0.47, collar: 'lapel', open: true, cuff: 'band', buttons: true },
    suit:       { sleeve: 1, fat: 0.012, hem: -0.035, collar: 'lapel', open: true, cuff: 'shirt', buttons: true },
    dress:      { sleeve: 0, fat: 0.005, hem: 0.02, skirt: 0.5, collar: 'scoop' },
    vest:       { sleeve: 0, under: true, fat: 0.014, hem: 0.03, collar: 'vee' },
    labcoat:    { sleeve: 1, fat: 0.013, hem: 0.02, skirt: 0.44, collar: 'lapel', open: true, pocket2: true },
    uniform:    { sleeve: 1, fat: 0.011, hem: 'tuck', collar: 'shirt', cuff: 'band', pockets: true, epaulettes: true, belt: true },
    armor:      { sleeve: 1, fat: 0.013, hem: 0.03, plate: true, collar: 'gorget', gloves: true },
    robe:       { sleeve: 1, fat: 0.02, hem: 0.02, skirt: 0.83, collar: 'vee', bell: true, sash: true },
    spacesuit:  { sleeve: 1, fat: 0.034, hem: 0.02, legs: true, collar: 'ring', gloves: true, pack: true, chestbox: true, bands: true },
    hazmat:     { sleeve: 1, fat: 0.024, hem: 0.02, legs: true, collar: 'none', gloves: true, hood: true, bands: true },
  };
  const BOTTOMS = { none: { fat: 0 }, pants: { fat: 0.011, len: 1 }, jeans: { fat: 0.007, len: 1, cuff: true }, shorts: { fat: 0.012, len: 0.34 }, skirt: { fat: 0, skirt: 0.4, bare: true }, longskirt: { fat: 0, skirt: 0.82, bare: true } };
  const BUILDS = {      // multipliers: torso width, torso depth, belly, shoulders, limbs, arms extra, neck
    slim: { w: 0.92, d: 0.9, belly: 1, sh: 0.97, limb: 0.87, arm: 1, neck: 0.92 }, average: { w: 1, d: 1, belly: 1, sh: 1, limb: 1, arm: 1, neck: 1 },
    heavy: { w: 1.16, d: 1.2, belly: 1.42, sh: 1.05, limb: 1.2, arm: 1.05, neck: 1.2 }, strong: { w: 1.1, d: 1.1, belly: 1.02, sh: 1.13, limb: 1.14, arm: 1.16, neck: 1.25 },
  };
  function makeLook(cfg) {
    cfg = cfg || {};
    const variant = cfg.variant || 'human', bare = variant === 'alien' || variant === 'robot' || variant === 'skeleton';
    const shape = cfg.shape === 'f' ? 'f' : 'm', B = BUILDS[cfg.build] || BUILDS.average, elder = cfg.age === 'elder', seed = num(cfg.seed, 1);
    const topT = (cfg.top && TOPS[cfg.top.type]) ? cfg.top.type : (cfg.top ? 'tshirt' : (bare ? 'none' : 'tshirt'));
    const top = Object.assign({ type: topT }, TOPS[topT]);
    let botT = (cfg.bottom && BOTTOMS[cfg.bottom.type]) ? cfg.bottom.type : (cfg.bottom ? 'pants' : (bare ? 'none' : 'pants'));
    const bottom = Object.assign({ type: botT }, BOTTOMS[botT]);
    const shoeT = (cfg.shoes && ['shoes', 'boots', 'heels', 'barefoot'].includes(cfg.shoes.type)) ? cfg.shoes.type : (bare ? 'barefoot' : (cfg.shoes ? 'shoes' : (top.legs ? 'boots' : 'shoes')));
    // ---- colours ----
    let skin = cfg.skin || (variant === 'alien' ? '#a3ada6' : '#e0b090');
    let topC = (cfg.top && cfg.top.color) || '#4a6fa5', topC2 = (cfg.top && cfg.top.color2) || null, botC = (cfg.bottom && cfg.bottom.color) || (top.type === 'dress' && botT !== 'pants' ? topC : '#2c3440');
    let shoeC = (cfg.shoes && cfg.shoes.color) || (shoeT === 'boots' ? '#3a2c22' : '#2a2422'), hairC = (cfg.hair && cfg.hair.color) || (elder ? '#c9c6c0' : '#3a2a1a');
    let eyeC = (cfg.eyes && cfg.eyes.color) || '#1a1a1a', eyeGlow = !!(cfg.eyes && cfg.eyes.glow), sclera = '#f4f1ea';
    const defaults2 = { suit: '#f2f0ea', coat: '#d8d2c4', jacket: '#e8e4dc', labcoat: '#7fa6c9', vest: '#e9e6df', uniform: '#3a3f2a', armor: '#5a4a3a', robe: '#c9a24a', spacesuit: '#e0863a', hazmat: '#2a2a2e', hoodie: null };
    if (!topC2) topC2 = defaults2[top.type] || tone(topC, -0.1).getHexString().replace(/^/, '#');
    const F = { skin: c => c, cloth: c => c };       // colour filters per variant
    if (variant === 'zombie') { F.skin = c => tone(mixc(c, '#7f9274', 0.72), -0.02, 0.8); F.cloth = c => tone(mixc(c, '#4b4a3c', 0.38), -0.05, 0.6); eyeC = (cfg.eyes && cfg.eyes.color) || '#e9ecd6'; sclera = '#c9cfae'; hairC = tone(mixc(hairC, '#3a3a30', 0.4), 0, 0.5); }
    if (variant === 'ghost') { F.skin = c => mixc(c, '#dfeeff', 0.78); F.cloth = c => mixc(c, '#cfe2f5', 0.72); hairC = mixc(hairC, '#dfeeff', 0.7); eyeC = (cfg.eyes && cfg.eyes.color) || '#16202e'; sclera = '#16202e'; }
    if (variant === 'robot') { skin = cfg.skin || '#aeb7c0'; eyeC = (cfg.eyes && cfg.eyes.color) || '#5ad7ff'; eyeGlow = true; }
    if (variant === 'skeleton') { skin = cfg.skin || '#e9e2cc'; eyeC = (cfg.eyes && cfg.eyes.color) || '#0c0a08'; sclera = '#0c0a08'; }
    if (variant === 'alien') { eyeC = (cfg.eyes && cfg.eyes.color) || '#07090c'; sclera = '#07090c'; }
    if (variant === 'shadow') { F.skin = F.cloth = () => C('#020203'); hairC = '#020203'; eyeC = (cfg.eyes && cfg.eyes.color) || '#fff2c8'; eyeGlow = true; sclera = '#020203'; }
    const skinC = F.skin(C(skin)), L = {
      cfg, variant, shape, elder, seed, B, top, bottom, shoeT, bare, eyeGlow,
      skin: skinC, skinD: tone(skinC, -0.07, 1.05), skinDD: tone(skinC, -0.16, 1.1), lip: tone(skinC, -0.1, 1.25, '#b04a4a', variant === 'human' ? (shape === 'f' ? 0.38 : 0.2) : 0.05),
      topC: F.cloth(C(topC)), topC2: F.cloth(C(topC2)), botC: F.cloth(C(botC)), shoeC: F.cloth(C(shoeC)), hair: C(hairC), eye: C(eyeC), sclera: C(sclera), F,
      acc: new Set(Array.isArray(cfg.accessories) ? cfg.accessories : []), hairStyle: (cfg.hair && cfg.hair.style) || (bare || variant === 'shadow' && !cfg.hair ? 'bald' : 'short'), facial: cfg.facialHair || 'none',
    };
    L.topD = tone(L.topC, -0.07); L.topL = tone(L.topC, 0.07); L.botD = tone(L.botC, -0.06); L.sole = tone(L.shoeC, lum(L.shoeC) > 0.25 ? -0.25 : 0.16, 0.6);
    L.brow = variant === 'shadow' ? C('#020203') : tone(L.hair, lum(L.hair) > 0.45 ? -0.18 : -0.04, 0.9);
    if (variant === 'zombie') L.lip = tone(L.skin, -0.2, 0.7);
    // ---- proportions (reference units) ----
    const f = shape === 'f', w = B.w, d = B.d, s = {
      shX: (f ? 0.158 : 0.185) * B.sh * (elder ? 0.97 : 1), hipX: f ? 0.091 : 0.088,
      hipW: (f ? 0.162 : 0.152) * w, hipD: (f ? 0.108 : 0.104) * d, waistW: (f ? 0.112 : 0.134) * w * (B.belly > 1 ? lp(1, B.belly, 0.6) : 1), waistD: (f ? 0.086 : 0.096) * d * B.belly,
      chestW: (f ? 0.142 : 0.166) * w * (B.sh > 1 ? lp(1, B.sh, 0.7) : 1), chestD: (f ? 0.098 : 0.106) * d, bust: f ? 0.02 : 0, neckR: (f ? 0.04 : 0.047) * B.neck,
      limb: (f ? 0.9 : 1) * B.limb * (elder ? 0.95 : 1), arm: B.arm, hand: f ? 0.92 : 1, foot: f ? 0.93 : 1, head: 1, armLen: 1, lift: 0, heelPitch: 0, torsoSq: 0.12,
    };
    if (variant === 'alien') Object.assign(s, { limb: 0.6, arm: 0.95, hipW: 0.105, hipD: 0.08, waistW: 0.085, waistD: 0.07, chestW: 0.118, chestD: 0.082, shX: 0.135, neckR: 0.026, head: 1.34, armLen: 1.12, hand: 1.15, bust: 0 });
    if (variant === 'skeleton') Object.assign(s, { limb: 0.42, arm: 1, hipW: 0.125, hipD: 0.07, waistW: 0.04, waistD: 0.04, chestW: 0.135, chestD: 0.09, neckR: 0.02, bust: 0, shX: 0.165 });
    if (variant === 'robot') Object.assign(s, { torsoSq: 0.75, neckR: 0.034, bust: 0 });
    if (shoeT === 'heels') { s.heelPitch = 0.4; s.lift = 0.05; }
    L.s = s;
    return L;
  }
  //@@NEXT@@
  return { REF, P0 };
})();
