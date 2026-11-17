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
  //@@NEXT@@
  return { REF, P0 };
})();
