// actors_a.js - "stylised realism" low-poly characters for the 3D stage (three.js r160, global THREE).
// One global: ActorsA. Reference: docs/kit/actors_a/README.md
//
//   const A = ActorsA.make({ build: 'slim', hair: { style: 'bob', color: '#201810' }, top: { type: 'hoodie', color: '#7a2f2f' } });
//   s.add(A.root); A.place(0, 0, 0, 0.3);
//   A.anim('walk', lt); A.lookAt([2, 1.6, 4]); A.face('scared'); A.talk(lt, 0.6);
//
// Design: every character is one skinned low-poly mesh (vertex colours, flat shading) on a 33-bone rig, plus a tiny
// dynamic "face" mesh (eyes, lids, brows, mouth). A pose is a plain object of joint angles; clips are pure functions
// (time, opts) -> pose. Feet are planted by solving two-bone IK inside the clips, so a pose is always plain FK.
const ActorsA = (() => {
  'use strict';
  const T = THREE, PI = Math.PI, TAU = PI * 2, HPI = PI / 2;

  // =====================================================================================================
  // 1. small maths
  // =====================================================================================================
  const cl = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lp = (a, b, k) => a + (b - a) * k;
  const sm = x => { x = cl(x); return x * x * (3 - 2 * x); };
  const smr = (x, a, b) => sm((x - a) / (b - a));
  const fr = x => x - Math.floor(x);
  const hash = (n, s = 0) => fr(Math.sin(n * 127.1 + s * 311.7) * 43758.5453);
  const noise = (x, s = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash(i, s) * (1 - u) + hash(i + 1, s) * u) * 2 - 1; };
  const N = (v, d = 0) => (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity ? v : d);
  const sin = Math.sin, cos = Math.cos;
  const SIDES = ['L', 'R'];

  const _cc = new Map();
  /** colour -> [r, g, b] in linear working space */
  function C(c) { if (Array.isArray(c)) return c; let v = _cc.get(c); if (!v) { const k = new T.Color(c || '#888888'); v = [k.r, k.g, k.b]; _cc.set(c, v); } return v; }
  const mixC = (a, b, k) => { a = C(a); b = C(b); return [lp(a[0], b[0], k), lp(a[1], b[1], k), lp(a[2], b[2], k)]; };
  const mulC = (a, k) => { a = C(a); return [a[0] * k, a[1] * k, a[2] * k]; };
  const lum = c => { c = C(c); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

  // =====================================================================================================
  // 2. skeleton (rest pose of a 1.75 m body, metres; the rig group is scaled by height / 1.75)
  // =====================================================================================================
  const REST = {}, BONES = [], ANC = {};
  const defBone = (name, parent, x, y, z) => {
    const p = parent ? REST[parent] : null;
    REST[name] = { name, parent, x, y, z, ax: (p ? p.ax : 0) + x, ay: (p ? p.ay : 0) + y, az: (p ? p.az : 0) + z };
    BONES.push(name); ANC[name] = (parent ? ANC[parent] : []).concat(name);
  };
  const SHX = 0.185, HIPX = 0.09, L1 = 0.43, L2 = 0.42, A1 = 0.285, A2 = 0.255, ANK = 0.08;
  defBone('hips', null, 0, 0.955, 0);
  defBone('spine', 'hips', 0, 0.105, -0.005);
  defBone('chest', 'spine', 0, 0.155, -0.005);
  defBone('neck', 'chest', 0, 0.245, -0.012);
  defBone('head', 'neck', 0, 0.085, 0.012);
  defBone('jaw', 'head', 0, 0.02, -0.02);
  for (const s of SIDES) {
    const m = s === 'L' ? 1 : -1;
    defBone('clav' + s, 'chest', 0.035 * m, 0.205, -0.01);
    defBone('arm' + s, 'clav' + s, (SHX - 0.035) * m, 0, 0);
    defBone('fore' + s, 'arm' + s, 0, -A1, 0);
    defBone('hand' + s, 'fore' + s, 0, -A2, 0);
    defBone('mitt1' + s, 'hand' + s, 0, -0.1, -0.0165);
    defBone('mitt2' + s, 'mitt1' + s, 0, -0.052, 0);
    defBone('idx1' + s, 'hand' + s, 0, -0.1, 0.0305);
    defBone('idx2' + s, 'idx1' + s, 0, -0.05, 0);
    defBone('thumb' + s, 'hand' + s, -0.004 * m, -0.034, 0.042);
    defBone('leg' + s, 'hips', HIPX * m, -0.025, 0);
    defBone('shin' + s, 'leg' + s, 0, -L1, 0);
    defBone('foot' + s, 'shin' + s, 0, -L2, 0);
    defBone('toe' + s, 'foot' + s, 0, -0.06, 0.125);
  }
  // optional helper bones (hair tail, cape chain); they exist on every rig so that poses are portable
  defBone('hair1', 'head', 0, 0.13, -0.1);
  defBone('hair2', 'hair1', 0, -0.12, -0.02);
  defBone('cape1', 'chest', 0, 0.215, -0.115);
  defBone('cape2', 'cape1', 0, -0.4, -0.02);
  defBone('cape3', 'cape2', 0, -0.36, -0.02);
  const BIDX = {}; BONES.forEach((b, i) => { BIDX[b] = i; });

  // ---- pose -> joint rotations --------------------------------------------------------------------
  const _e = new T.Euler(), _qt = new T.Quaternion();
  const qEuler = (q, x, y, z, order) => q.setFromEuler(_e.set(x, y, z, order));
  const qX = (q, a) => q.set(sin(a / 2), 0, 0, cos(a / 2));
  /** swing by the rotation vector (-sx, 0, sz) (sx = forward, sz = outward, radians) then twist about the bone (raw Y) */
  function qSwingTwist(q, sx, sz, tw) {
    const ax = -sx, az = sz, ang = Math.hypot(ax, az);
    if (ang < 1e-7) q.set(0, 0, 0, 1); else { const k = sin(ang / 2) / ang; q.set(ax * k, 0, az * k, cos(ang / 2)); }
    if (tw) q.multiply(_qt.set(0, sin(tw / 2), 0, cos(tw / 2)));
    return q;
  }
  const mirrorQ = q => { q.y = -q.y; q.z = -q.z; return q; };
  /** Local rotation of bone `n` for pose `p` (missing keys are 0). */
  function jointQ(n, p, q) {
    const s = n.charAt(n.length - 1), side = s === 'L' || s === 'R', b = side ? n.slice(0, -1) : n, g = k => N(p[k]);
    switch (b) {
      case 'hips': return qEuler(q, g('hipsX'), g('hipsY'), g('hipsZ'), 'YXZ');
      case 'spine': return qEuler(q, g('spineX'), g('spineY'), g('spineZ'), 'YXZ');
      case 'chest': return qEuler(q, g('chestX'), g('chestY'), g('chestZ'), 'YXZ');
      case 'neck': return qEuler(q, g('neckX'), g('neckY'), g('neckZ'), 'YXZ');
      case 'head': return qEuler(q, g('headX'), g('headY'), g('headZ'), 'YXZ');
      case 'jaw': return qX(q, g('jaw'));
      case 'hair1': return qEuler(q, g('hairX') * 0.6, 0, g('hairZ') * 0.6, 'YXZ');
      case 'hair2': return qEuler(q, g('hairX') * 0.5, 0, g('hairZ') * 0.5, 'YXZ');
      case 'cape1': return qEuler(q, -g('capeX') * 0.5 - g('cape1X'), 0, g('capeZ') * 0.4, 'YXZ');
      case 'cape2': return qEuler(q, -g('capeX') * 0.35 - g('cape2X'), 0, g('capeZ') * 0.35, 'YXZ');
      case 'cape3': return qEuler(q, -g('capeX') * 0.3, 0, g('capeZ') * 0.3, 'YXZ');
    }
    if (!side) return q.set(0, 0, 0, 1);
    switch (b) {
      case 'clav': qEuler(q, 0, -g('shFwd' + s), g('shrug' + s), 'YZX'); break;
      case 'arm': qSwingTwist(q, g('arm' + s + 'x'), g('arm' + s + 'z'), -g('arm' + s + 'y')); break;
      case 'fore': return qX(q, -cl(g('elbow' + s), 0, 2.7));
      case 'hand': qEuler(q, g('hand' + s + 'x'), -g('hand' + s + 'y'), -g('hand' + s + 'z'), 'YZX'); break;
      case 'mitt1': qEuler(q, 0, 0, -cl(g('grip' + s), -0.2, 1.1) * 1.4, 'XYZ'); break;
      case 'mitt2': qEuler(q, 0, 0, -cl(g('grip' + s), -0.1, 1.1) * 1.6, 'XYZ'); break;
      case 'idx1': qEuler(q, 0, 0, -cl(g('grip' + s) * (1 - cl(g('point' + s))), -0.2, 1.1) * 1.4, 'XYZ'); break;
      case 'idx2': qEuler(q, 0, 0, -cl(g('grip' + s) * (1 - cl(g('point' + s))), -0.1, 1.1) * 1.6, 'XYZ'); break;
      case 'thumb': { const k = cl(g('grip' + s), 0, 1.1); qEuler(q, k * 0.25, -k * 0.75 + g('thumb' + s) * 0.9, -k * 0.5, 'YZX'); break; }
      case 'leg': qSwingTwist(q, g('leg' + s + 'x'), g('leg' + s + 'z'), g('leg' + s + 'y')); break;
      case 'shin': return qX(q, cl(g('knee' + s), 0, 2.8));
      case 'foot': qEuler(q, g('foot' + s + 'x'), g('foot' + s + 'y'), g('foot' + s + 'z'), 'YXZ'); break;
      case 'toe': return qX(q, -g('toe' + s));
      default: return q.set(0, 0, 0, 1);
    }
    return s === 'R' ? mirrorQ(q) : q;
  }

  // ---- forward kinematics on the standard skeleton (used by the IK helpers inside clips) -------------
  const _fq = new T.Quaternion(), _fv = new T.Vector3();
  /** World (rig-space) rotation outQ and origin outV of bone `name` for pose p. shx: shoulder half-width override. */
  function frame(name, p, outQ, outV, shx) {
    const path = ANC[name]; outQ.set(0, 0, 0, 1); outV.set(0, 0, 0);
    for (let i = 0; i < path.length; i++) {
      const b = path[i], r = REST[b];
      _fv.set(r.x, r.y, r.z);
      if (i === 0) _fv.set(r.x + N(p.dx), r.y + N(p.dy), r.z + N(p.dz));
      else if (shx && b.charCodeAt(0) === 97 && b.charCodeAt(1) === 114 && b.length === 4) _fv.x = (shx - 0.035) * (r.x < 0 ? -1 : 1);   // 'armL' / 'armR'
      outV.add(_fv.applyQuaternion(outQ)); outQ.multiply(jointQ(b, p, _fq));
    }
    return outQ;
  }

  // ---- two-bone IK: legs -------------------------------------------------------------------------------
  const _hq = new T.Quaternion(), _hv = new T.Vector3(), _j = new T.Vector3(), _v = new T.Vector3(), _vh = new T.Vector3(), _k = new T.Vector3(), _t = new T.Vector3(),
    _kc = new T.Vector3(), _qi = new T.Quaternion(), _qs = new T.Quaternion(), _q1 = new T.Quaternion(), _q2 = new T.Quaternion(), _qf = new T.Quaternion(), _pole = new T.Vector3(), _e2 = new T.Euler();
  /** Extract (swing-forward, swing-out, ratio) for a unit direction d given in the parent's frame, left-form. */
  function swingOf(d) { const cy = cl(-d.y, -1, 1), ang = Math.acos(cy), sn = Math.sqrt(Math.max(1e-12, 1 - cy * cy)), r = ang < 1e-5 ? 1 : ang / sn; return [d.z * r, d.x * r]; }
  /**
   * Solve one leg so that its ankle sits at (ax, ay, az) in rig space with the foot pitched/yawed/rolled as given
   * (rig space: pitch + = toes down, yaw + = toward +X). Writes leg*, knee*, foot* keys of p. poleYaw: knee direction.
   */
  function legIK(p, s, ax, ay, az, pitch, yaw, roll, poleYaw) {
    const m = s === 'L' ? 1 : -1, r = REST['leg' + s];
    frame('hips', p, _hq, _hv);
    _j.set(r.x, r.y, r.z).applyQuaternion(_hq).add(_hv);
    _v.set(ax, ay, az).sub(_j); let d = _v.length(); const dmax = (L1 + L2) * 0.9995, dmin = 0.14;
    if (d < 1e-6) { _v.set(0, -1, 0); d = 1; }
    _vh.copy(_v).multiplyScalar(1 / d); d = cl(d, dmin, dmax);
    const knee = PI - Math.acos(cl((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const a = Math.acos(cl((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const py = poleYaw === undefined ? yaw : poleYaw; _pole.set(sin(py), 0.25, cos(py));
    _k.copy(_pole).addScaledVector(_vh, -_pole.dot(_vh)); if (_k.lengthSq() < 1e-8) _k.set(0, 0, 1).applyQuaternion(_hq); _k.normalize();
    _t.copy(_vh).multiplyScalar(cos(a)).addScaledVector(_k, sin(a));          // thigh direction
    _kc.copy(_k).multiplyScalar(cos(a)).addScaledVector(_vh, -sin(a));        // kneecap direction
    _qi.copy(_hq).invert(); _t.applyQuaternion(_qi); _kc.applyQuaternion(_qi); if (m < 0) { _t.x = -_t.x; _kc.x = -_kc.x; }
    const sw = swingOf(_t); qSwingTwist(_qs, sw[0], sw[1], 0).invert(); _kc.applyQuaternion(_qs);
    p['leg' + s + 'x'] = sw[0]; p['leg' + s + 'z'] = sw[1]; p['leg' + s + 'y'] = Math.atan2(_kc.x, _kc.z); p['knee' + s] = knee;
    jointQ('leg' + s, p, _q1); _q2.copy(_hq).multiply(_q1).multiply(qX(_q1, knee));     // shin, rig space
    qEuler(_qf, pitch, yaw, roll, 'YXZ'); _q2.invert().multiply(_qf); if (m < 0) mirrorQ(_q2);
    _e2.setFromQuaternion(_q2, 'YXZ'); p['foot' + s + 'x'] = _e2.x; p['foot' + s + 'y'] = _e2.y; p['foot' + s + 'z'] = _e2.z;
    return p;
  }
  const LEGKEYS = { L: ['legLx', 'legLy', 'legLz', 'kneeL', 'footLx', 'footLy', 'footLz'], R: ['legRx', 'legRy', 'legRz', 'kneeR', 'footRx', 'footRy', 'footRz'] };
  /**
   * Resolve the foot directives of a pose into leg angles. Directives (rig space, metres on the 1.75 m body):
   *   ikL / ikR      weight 0..1 (0 = leave the FK leg alone)
   *   fLx fLy fLz    ankle position        fLp pitch (+ toes down)   fLh heading (yaw)   fLr roll   fLk knee direction offset
   */
  function solveLegs(p) {
    for (const s of SIDES) {
      const w = N(p['ik' + s]); if (w <= 0.001) continue;
      const f = 'f' + s, h = N(p[f + 'h']);
      if (w >= 0.999) legIK(p, s, N(p[f + 'x'], s === 'L' ? HIPX : -HIPX), N(p[f + 'y'], ANK), N(p[f + 'z']), N(p[f + 'p']), h, N(p[f + 'r']), h + N(p[f + 'k']));
      else { const q = Object.assign({}, p); legIK(q, s, N(p[f + 'x'], s === 'L' ? HIPX : -HIPX), N(p[f + 'y'], ANK), N(p[f + 'z']), N(p[f + 'p']), h, N(p[f + 'r']), h + N(p[f + 'k'])); for (const k of LEGKEYS[s]) p[k] = lp(N(p[k]), q[k], w); }
    }
    return p;
  }
  /** Lower the hips just enough for both planted feet to be reachable (never raises them). */
  function reachFix(p, slack = 0.004) {
    let drop = 0; frame('hips', p, _hq, _hv);
    for (const s of SIDES) {
      if (N(p['ik' + s]) < 0.999) continue; const r = REST['leg' + s], f = 'f' + s;
      _j.set(r.x, r.y, r.z).applyQuaternion(_hq).add(_hv);
      const hx = N(p[f + 'x']) - _j.x, hz = N(p[f + 'z']) - _j.z, h2 = hx * hx + hz * hz, mx = L1 + L2 - slack;
      const vy = h2 < mx * mx ? Math.sqrt(mx * mx - h2) : 0.05, need = (_j.y - N(p[f + 'y'], ANK)) - vy;
      if (need > drop) drop = need;
    }
    if (drop > 0) p.dy = N(p.dy) - drop;
    return p;
  }

  // ---- two-bone IK: arms -------------------------------------------------------------------------------
  const _cq = new T.Quaternion(), _cv = new T.Vector3(), _bq = new T.Quaternion(), _bv = new T.Vector3(), _ed = new T.Vector3(), _m4 = new T.Matrix4(), _vx = new T.Vector3(), _vy = new T.Vector3(), _vz = new T.Vector3();
  /**
   * Put the wrist of arm s at (tx, ty, tz) in RIG space. o.pole = [x, y, z]: where the elbow points, in chest space with
   * x > 0 meaning "outward" for either arm (default down-back-out). o.shx: shoulder half-width. Writes arm*, elbow*.
   */
  function armIK(p, s, tx, ty, tz, o) {
    const m = s === 'L' ? 1 : -1, shx = o && o.shx, pole = (o && o.pole) || POLE0;
    frame('clav' + s, p, _cq, _cv, shx);
    const r = REST['arm' + s]; _j.set(shx ? (shx - 0.035) * m : r.x, r.y, r.z).applyQuaternion(_cq).add(_cv);
    frame('chest', p, _bq, _bv);
    _v.set(tx, ty, tz).sub(_j); let d = _v.length(); if (d < 1e-6) { _v.set(0, -1, 0); d = 1; }
    _vh.copy(_v).multiplyScalar(1 / d); d = cl(d, 0.07, (A1 + A2) * 0.999);
    const el = PI - Math.acos(cl((A1 * A1 + A2 * A2 - d * d) / (2 * A1 * A2), -1, 1));
    const a = Math.acos(cl((A1 * A1 + d * d - A2 * A2) / (2 * A1 * d), -1, 1));
    _pole.set(pole[0] * m, pole[1], pole[2]).applyQuaternion(_bq);
    _k.copy(_pole).addScaledVector(_vh, -_pole.dot(_vh)); if (_k.lengthSq() < 1e-8) _k.set(0, 0, -1).applyQuaternion(_bq); _k.normalize();
    _t.copy(_vh).multiplyScalar(cos(a)).addScaledVector(_k, sin(a));         // upper arm direction
    _ed.copy(_k).multiplyScalar(cos(a)).addScaledVector(_vh, -sin(a));       // elbow direction
    _qi.copy(_cq).invert(); _t.applyQuaternion(_qi); _ed.applyQuaternion(_qi); if (m < 0) { _t.x = -_t.x; _ed.x = -_ed.x; }
    const sw = swingOf(_t); qSwingTwist(_qs, sw[0], sw[1], 0).invert(); _ed.applyQuaternion(_qs);
    p['arm' + s + 'x'] = sw[0]; p['arm' + s + 'z'] = sw[1]; p['arm' + s + 'y'] = Math.atan2(_ed.x, -_ed.z); p['elbow' + s] = el;
    return p;
  }
  const POLE0 = [0.55, -0.6, -0.65];
  /** Chest-attached target: (x, y, z) are body coordinates of the bind pose (y = height on the body, x > 0 = this arm's own side). */
  function armTo(p, s, x, y, z, o) {
    const m = s === 'L' ? 1 : -1, rc = REST.chest;
    frame('chest', p, _bq, _bv); _vx.set(x * m - rc.ax, y - rc.ay, z - rc.az).applyQuaternion(_bq).add(_bv);
    return armIK(p, s, _vx.x, _vx.y, _vx.z, o);
  }
  /**
   * Orient the hand: fingers along f, palm facing n (both chest space, x > 0 = outward for either hand; or rig space
   * when rig = true). Writes hand*x/y/z.
   */
  function aimHand(p, s, f, n, rig, shx) {
    const m = s === 'L' ? 1 : -1;
    frame('fore' + s, p, _cq, _cv, shx);                         // forearm, rig space
    _vy.set(f[0], f[1], f[2]); _vx.set(n[0], n[1], n[2]);
    if (rig) { _vy.x *= 1; } else { _vy.x *= m; _vx.x *= m; frame('chest', p, _bq, _bv); _vy.applyQuaternion(_bq); _vx.applyQuaternion(_bq); }
    _vy.normalize().negate();                                    // hand Y = -fingers
    _vx.addScaledVector(_vy, -_vx.dot(_vy)); if (_vx.lengthSq() < 1e-8) _vx.set(1, 0, 0); _vx.normalize();
    // left hand: X = -palm normal; right hand: X = +palm normal (mirror image)
    _vx.multiplyScalar(-m); _vz.crossVectors(_vx, _vy);
    _q1.setFromRotationMatrix(_m4.makeBasis(_vx, _vy, _vz));
    _q2.copy(_cq).invert().multiply(_q1); if (m < 0) mirrorQ(_q2);
    _e2.setFromQuaternion(_q2, 'YZX'); p['hand' + s + 'x'] = _e2.x; p['hand' + s + 'y'] = -_e2.y; p['hand' + s + 'z'] = -_e2.z;
    return p;
  }

  // ---- pose algebra ------------------------------------------------------------------------------------
  /** Blend two pose objects (missing keys count as 0). */
  function lerpPose(a, b, k) {
    const o = {}; a = a || {}; b = b || {}; k = N(k);
    for (const key in a) { const x = a[key]; if (typeof x === 'number') o[key] = lp(N(x), N(b[key]), k); }
    for (const key in b) if (!(key in o)) { const x = b[key]; if (typeof x === 'number') o[key] = N(x) * k; }
    return o;
  }
  const NEGC = { dx: 1, hipsY: 1, hipsZ: 1, spineY: 1, spineZ: 1, chestY: 1, chestZ: 1, neckY: 1, neckZ: 1, headY: 1, headZ: 1, capeZ: 1, hairZ: 1 };
  const _mk = new Map();
  function mirKey(k) {
    let r = _mk.get(k); if (r) return r;
    const mm = /^([a-zA-Z0-9]*?)(L|R)([a-z]?)$/.exec(k);
    if (mm) { const base = mm[1], sfx = mm[3]; r = [base + (mm[2] === 'L' ? 'R' : 'L') + sfx, (base === 'f' && (sfx === 'x' || sfx === 'h' || sfx === 'r' || sfx === 'k')) ? -1 : 1]; }
    else r = [k, NEGC[k] ? -1 : 1];
    _mk.set(k, r); return r;
  }
  /** Left-right mirror image of a pose. */
  function mirrorPose(p) { const o = {}; for (const k in p) { if (typeof p[k] !== 'number') continue; const r = mirKey(k); o[r[0]] = p[k] * r[1]; } return o; }
  function addPose(a, b, k = 1) { for (const key in b) if (typeof b[key] === 'number') a[key] = N(a[key]) + b[key] * k; return a; }

  // =====================================================================================================
  // 3. mesh builder: triangles with a colour and up to four bone weights per vertex, sorted into buckets
  // =====================================================================================================
  function Builder() {
    const buckets = {}; let fs = 3;
    const st = { mat: 'main', vary: 0.05 };
    const bk = n => buckets[n] || (buckets[n] = { pos: [], col: [], si: [], sw: [], n: 0 });
    function wspec(w) {
      if (typeof w === 'string') return [BIDX[w] || 0, 0, 0, 0, 1, 0, 0, 0];
      const idx = [0, 0, 0, 0], ws = [0, 0, 0, 0]; let sum = 0, n = 0;
      const arr = w.slice().sort((a, b) => b[1] - a[1]);
      for (const it of arr) { if (it[1] > 1e-4 && n < 4 && BIDX[it[0]] !== undefined) { idx[n] = BIDX[it[0]]; ws[n] = it[1]; sum += it[1]; n++; } }
      if (!n) { ws[0] = 1; sum = 1; }
      return [idx[0], idx[1], idx[2], idx[3], ws[0] / sum, ws[1] / sum, ws[2] / sum, ws[3] / sum];
    }
    /** vertex: plain object {x, y, z, w} where w is a bone name or [[bone, weight], ...] */
    const V = (x, y, z, w) => ({ x, y, z, w: w || 'hips' });
    function tri(a, b, c, col, o) {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const ar = Math.hypot(nx, ny, nz);
      if (!(ar > 1e-9)) return;
      const ref = o && o.ref;
      if (ref) { const cx = (a.x + b.x + c.x) / 3 - ref[0], cy = (a.y + b.y + c.y) / 3 - ref[1], cz = (a.z + b.z + c.z) / 3 - ref[2]; if (nx * cx + ny * cy + nz * cz < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; } }
      const B = bk((o && o.mat) || st.mat), vr = o && o.vary !== undefined ? o.vary : st.vary, k = 1 + (hash(fs++, 3) - 0.5) * 2 * vr, cc = C(col), al = o && o.alpha !== undefined ? o.alpha : 1;
      for (const v of [a, b, c]) {
        B.pos.push(v.x, v.y, v.z); B.col.push(cc[0] * k, cc[1] * k, cc[2] * k, v.a !== undefined ? v.a : al);
        const s = v._w || (v._w = wspec(v.w)); B.si.push(s[0], s[1], s[2], s[3]); B.sw.push(s[4], s[5], s[6], s[7]);
      }
      B.n++;
    }
    function quad(a, b, c, d, col, o) {
      // split along the shorter diagonal
      const d1 = (a.x - c.x) ** 2 + (a.y - c.y) ** 2 + (a.z - c.z) ** 2, d2 = (b.x - d.x) ** 2 + (b.y - d.y) ** 2 + (b.z - d.z) ** 2;
      if (d1 <= d2 * 1.0001) { tri(a, b, c, col, o); tri(a, c, d, col, o); } else { tri(a, b, d, col, o); tri(b, c, d, col, o); }
    }
    const centre = pts => { let x = 0, y = 0, z = 0; for (const p of pts) { x += p.x; y += p.y; z += p.z; } const n = pts.length || 1; return [x / n, y / n, z / n]; };
    /**
     * Skin a tube through rings. Each ring: {p: [vertex...], col: colour | fn(j) for the band that starts at this ring,
     * c: [x,y,z] centre (default: average)}. o: {col, capA, capB (true = flat fan), open (ring is not closed), mat, vary}
     */
    function loft(rings, o = {}) {
      const n = rings[0].p.length, wrap = o.open ? n - 1 : n;
      for (const r of rings) if (!r.c) r.c = centre(r.p);
      for (let i = 0; i + 1 < rings.length; i++) {
        const A = rings[i], Bq = rings[i + 1], ref = [(A.c[0] + Bq.c[0]) / 2, (A.c[1] + Bq.c[1]) / 2, (A.c[2] + Bq.c[2]) / 2];
        for (let j = 0; j < wrap; j++) {
          const j2 = (j + 1) % n; let col = A.col !== undefined ? A.col : o.col; if (typeof col === 'function') col = col(j, i);
          if (col === null) continue;
          quad(A.p[j], A.p[j2], Bq.p[j2], Bq.p[j], col, { ref, mat: A.mat || o.mat, vary: o.vary, alpha: o.alpha });
        }
      }
      const cap = (R, other, colr) => {
        const cc = R.c, ref = other ? [2 * other.c[0] - cc[0], 2 * other.c[1] - cc[1], 2 * other.c[2] - cc[2]] : cc;
        const mid = V(cc[0], cc[1], cc[2], R.p[0].w); mid.w = R.cw || R.p[0].w;
        for (let j = 0; j < n; j++) tri(mid, R.p[j], R.p[(j + 1) % n], colr, { ref: other ? other.c : ref, mat: R.mat || o.mat, vary: o.vary, alpha: o.alpha });
      };
      const c0 = typeof o.col === 'function' ? o.col(0, 0) : o.col;
      if (o.capA) cap(rings[0], rings[1], o.capA === true ? (typeof rings[0].col === 'function' ? rings[0].col(0, 0) : rings[0].col !== undefined ? rings[0].col : c0) : o.capA);
      if (o.capB) { const L = rings.length - 1, pr = rings[L - 1]; cap(rings[L], pr, o.capB === true ? (typeof pr.col === 'function' ? pr.col(0, L - 1) : pr.col !== undefined ? pr.col : c0) : o.capB); }
    }
    /** ring of n vertices on an ellipse in the plane spanned by unit vectors U and W around centre c */
    function ringUV(c, U, W, ru, rw, n, rot, w, f) {
      const p = [];
      for (let j = 0; j < n; j++) { const a = (rot || 0) + j * TAU / n, k = f ? f(j, a) : 1, cu = cos(a) * ru * k, sw = sin(a) * rw * k; p.push(V(c[0] + U[0] * cu + W[0] * sw, c[1] + U[1] * cu + W[1] * sw, c[2] + U[2] * cu + W[2] * sw, w)); }
      return { p, c: c.slice() };
    }
    /** horizontal ring: angle 0 = front (+Z), increasing toward +X */
    const ringH = (cx, cy, cz, rx, rz, n, rot, w, f) => ringUV([cx, cy, cz], [0, 0, 1], [1, 0, 0], rz, rx, n, rot, w, f);
    /** closed box from 8 corner vertices given as two quads (a: 4 verts, b: 4 verts, same winding) */
    function hexa(a, b, col, o) { loft([{ p: a }, { p: b }], Object.assign({ col, capA: col, capB: col }, o)); }
    function box(cx, cy, cz, sx, sy, sz, w, col, o) {
      const hx = sx / 2, hy = sy / 2, hz = sz / 2;
      const a = [V(cx - hx, cy - hy, cz - hz, w), V(cx + hx, cy - hy, cz - hz, w), V(cx + hx, cy - hy, cz + hz, w), V(cx - hx, cy - hy, cz + hz, w)];
      const b = [V(cx - hx, cy + hy, cz - hz, w), V(cx + hx, cy + hy, cz - hz, w), V(cx + hx, cy + hy, cz + hz, w), V(cx - hx, cy + hy, cz + hz, w)];
      hexa(a, b, col, o); return { a, b };
    }
    function count() { let n = 0; for (const k in buckets) n += buckets[k].n; return n; }
    return { V, tri, quad, loft, ringUV, ringH, hexa, box, buckets, st, count, centre };
  }

  // =====================================================================================================
  // 4. the character model
  // =====================================================================================================
  const BUILD = {
    slim:    { g: 0.88, cw: 0.94, ww: 0.9, hw: 0.95, belly: 0, sh: -0.008, nk: 0.9, armOut: 0.05 },
    average: { g: 1.0, cw: 1.0, ww: 1.0, hw: 1.0, belly: 0, sh: 0, nk: 1.0, armOut: 0.085 },
    heavy:   { g: 1.2, cw: 1.1, ww: 1.36, hw: 1.14, belly: 0.085, sh: 0.006, nk: 1.2, armOut: 0.24 },
    strong:  { g: 1.17, cw: 1.15, ww: 1.04, hw: 1.02, belly: 0, sh: 0.02, nk: 1.22, armOut: 0.17 },
  };
  const TOPS = {
    //            pad    arm k  sleeve  hem    collar      open  tuck
    tshirt:     { pad: 0.010, ak: 1.12, sl: 0.15, hem: 0.905, collar: 'crew' },
    longsleeve: { pad: 0.008, ak: 1.08, sl: 9, hem: 0.905, collar: 'crew' },
    shirt:      { pad: 0.011, ak: 1.12, sl: 9, hem: 0.895, collar: 'shirt', strip: 'placket', cuff: 1 },
    hoodie:     { pad: 0.024, ak: 1.26, sl: 9, hem: 0.885, collar: 'hood', rib: 1, cuff: 2, pocket: 'kangaroo' },
    jacket:     { pad: 0.021, ak: 1.24, sl: 9, hem: 0.905, collar: 'stand', strip: 'open', cuff: 2, rib: 1 },
    coat:       { pad: 0.027, ak: 1.26, sl: 9, hem: 0.56, collar: 'big', strip: 'vee', cuff: 0, long: 1 },
    suit:       { pad: 0.015, ak: 1.16, sl: 9, hem: 0.875, collar: 'lapel', strip: 'vee', cuff: 3 },
    dress:      { pad: 0.006, ak: 1.04, sl: 0.06, hem: 1.03, collar: 'scoop', skirt: 1 },
    tank:       { pad: 0.006, ak: 1.0, sl: 0, hem: 0.915, collar: 'tank' },
    vest:       { pad: 0.016, ak: 1.1, sl: 9, hem: 0.925, collar: 'none', strip: 'open', vest: 1, pocket: 'cargo' },
    labcoat:    { pad: 0.02, ak: 1.2, sl: 9, hem: 0.56, collar: 'lapel', strip: 'open', cuff: 0, long: 1, pocket: 'breast' },
    uniform:    { pad: 0.012, ak: 1.14, sl: 9, hem: 1.02, collar: 'shirt', strip: 'placket', cuff: 1, tuck: 1, pocket: 'chest2', epaulette: 1, belt: 1 },
    armor:      { pad: 0.022, ak: 1.2, sl: 9, hem: 0.99, collar: 'gorget', metal: 1, tuck: 1 },
    robe:       { pad: 0.03, ak: 1.5, sl: 9, hem: 0.07, collar: 'robe', strip: 'robe', long: 1, bell: 1 },
    spacesuit:  { pad: 0.045, ak: 1.5, sl: 9, hem: 0.99, collar: 'ring', suit: 1, tuck: 1 },
    hazmat:     { pad: 0.036, ak: 1.38, sl: 9, hem: 0.99, collar: 'none', suit: 1, tuck: 1, strip: 'zip' },
    none:       { pad: 0, ak: 1, sl: 0, hem: 1.2, collar: 'none', bare: 1 },
  };
  const TOPCOL = { tshirt: '#4a78a8', longsleeve: '#7a8a5a', shirt: '#e6e2d8', hoodie: '#6a7078', jacket: '#6b4a32', coat: '#2e3440', suit: '#2b2f3a', dress: '#b83a48', tank: '#e8e4dc', vest: '#6f7350', labcoat: '#eef0f0', uniform: '#55603c', armor: '#9aa3ad', robe: '#4a3a5a', spacesuit: '#e9ecef', hazmat: '#e2c230', none: '#000000' };
  const TOPCOL2 = { jacket: '#d9d4c8', coat: '#8a2f2f', suit: '#f0eee8', vest: '#c9c2ae', labcoat: '#7fa6c9', robe: '#c9a24a', spacesuit: '#d8552f', hazmat: '#3a3a3a', armor: '#7a2020', uniform: '#3c4428', hoodie: '#e8e6e0', shirt: '#d0ccc2', dress: '#f0e6e0' };

  function normCfg(u) {
    u = u || {};
    const pick = (v, list, d) => (list.indexOf(v) >= 0 ? v : d);
    const variant = pick(u.variant, ['human', 'zombie', 'ghost', 'alien', 'robot', 'skeleton', 'shadow'], 'human');
    const c = {
      height: cl(N(u.height, variant === 'alien' ? 1.95 : 1.75), 0.5, 3.5),
      build: pick(u.build, ['slim', 'average', 'heavy', 'strong'], variant === 'alien' ? 'slim' : 'average'),
      shape: pick(u.shape, ['m', 'f'], 'm'), age: pick(u.age, ['adult', 'elder'], 'adult'),
      skin: typeof u.skin === 'string' ? u.skin : '#e0b090', variant, seed: N(u.seed, 1),
      facialHair: pick(u.facialHair, ['none', 'beard', 'mustache', 'stubble'], 'none'),
    };
    const hs = u.hair || {};
    c.hair = { style: pick(hs.style, ['short', 'buzz', 'bald', 'long', 'bun', 'ponytail', 'curly', 'bob', 'afro', 'mohawk'], c.shape === 'f' ? 'bob' : 'short'), color: typeof hs.color === 'string' ? hs.color : (c.age === 'elder' ? '#c9c9c4' : '#3a2a1a') };
    const tp = u.top || {}, tt = pick(tp.type, Object.keys(TOPS), variant === 'alien' || variant === 'robot' || variant === 'skeleton' || variant === 'shadow' ? 'none' : 'tshirt');
    c.top = { type: tt, color: typeof tp.color === 'string' ? tp.color : TOPCOL[tt], color2: typeof tp.color2 === 'string' ? tp.color2 : (TOPCOL2[tt] || '#e8e4da') };
    const bt = u.bottom || {};
    c.bottom = { type: pick(bt.type, ['pants', 'jeans', 'shorts', 'skirt', 'longskirt', 'none'], tt === 'none' && !u.bottom ? 'none' : 'pants'), color: typeof bt.color === 'string' ? bt.color : (bt.type === 'jeans' ? '#3b5578' : tt === 'suit' ? c.top.color : tt === 'dress' ? c.top.color : '#2f3644') };
    const sh = u.shoes || {};
    c.shoes = { type: pick(sh.type, ['shoes', 'boots', 'heels', 'barefoot'], tt === 'none' && !u.shoes ? 'barefoot' : 'shoes'), color: typeof sh.color === 'string' ? sh.color : '#2c2826' };
    c.acc = {}; c.accCol = {};
    for (const a of Array.isArray(u.accessories) ? u.accessories : []) { if (typeof a === 'string') c.acc[a] = true; else if (a && typeof a.type === 'string') { c.acc[a.type] = true; if (a.color) c.accCol[a.type] = a.color; } }
    const ey = u.eyes || {};
    c.eyes = { color: typeof ey.color === 'string' ? ey.color : (variant === 'robot' ? '#6ad8ff' : variant === 'shadow' ? '#ffffff' : variant === 'zombie' ? '#c9d2b0' : '#1a1a1a'), glow: ey.glow !== undefined ? !!ey.glow : (variant === 'robot' || variant === 'shadow') };
    c.lips = typeof u.lips === 'string' ? u.lips : null;
    c.autoBlink = u.autoBlink !== false;
    return c;
  }

  // torso cross-sections of the average male body: [y, half-width, front z, back z]
  const TORSO = [
    [0.800, 0.085, 0.045, -0.070], [0.850, 0.150, 0.080, -0.105], [0.930, 0.170, 0.090, -0.112], [1.020, 0.150, 0.092, -0.090],
    [1.100, 0.140, 0.090, -0.078], [1.200, 0.150, 0.097, -0.088], [1.300, 0.166, 0.108, -0.100], [1.385, 0.172, 0.098, -0.098],
    [1.435, 0.130, 0.072, -0.082], [1.465, 0.066, 0.048, -0.068],
  ];
  const bump = (y, c, w) => { const k = (y - c) / w; return k > -1 && k < 1 ? (1 + cos(k * PI)) / 2 : 0; };
  const torsoW = y => (y < 0.985 ? 'hips' : y < 1.075 ? [['hips', 1 - (y - 0.985) / 0.09], ['spine', (y - 0.985) / 0.09]] : y < 1.16 ? 'spine' : y < 1.26 ? [['spine', 1 - (y - 1.16) / 0.1], ['chest', (y - 1.16) / 0.1]] : 'chest');

  function buildCharacter(c) {
    const G = Builder(), V = G.V, b = BUILD[c.build], f = c.shape === 'f', el = c.age === 'elder', vr = c.variant;
    const alien = vr === 'alien';
    const D = {
      g: b.g * (el ? 0.95 : 1) * (alien ? 0.66 : 1), armG: f ? 0.86 : 1, legG: f ? 0.95 : 1,
      shx: SHX + b.sh + (f ? -0.02 : 0) + (alien ? -0.03 : 0), cw: b.cw * (f ? 0.9 : 1) * (alien ? 0.8 : 1), ww: b.ww * (f ? 0.84 : 1) * (alien ? 0.82 : 1), hw: b.hw * (f ? 1.04 : 1) * (alien ? 0.8 : 1),
      belly: b.belly + (el ? 0.012 : 0), bust: f ? 0.024 : 0, neck: b.nk * (f ? 0.84 : 1) * (alien ? 0.6 : 1), hand: (f ? 0.92 : 1) * 1.06, foot: f ? 0.93 : 1, armOut: b.armOut,
    };
    const skin = vr === 'zombie' ? mixC(mixC(c.skin, '#7d9a6a', 0.62), '#5a6a58', 0.25) : vr === 'ghost' ? mixC(c.skin, '#dfe9f2', 0.75) : alien ? (c.skin === '#e0b090' ? C('#9aa39a') : C(c.skin)) : C(c.skin);
    const skinD = mulC(skin, 0.8);
    const top = c.top, TS = TOPS[top.type], bot = c.bottom;
    const zomb = vr === 'zombie';
    const dirty = col => (zomb ? mixC(mulC(col, 0.72), '#4a4a38', 0.3) : vr === 'ghost' ? mixC(col, '#dfe9f2', 0.72) : C(col));
    const topC = dirty(top.color), topC2 = dirty(top.color2), botC = dirty(bot.color), shoeC = dirty(c.shoes.color);
    const metal = TS.metal ? 'metal' : undefined;

    // ---------------------------------------------------------------------------------- torso
    const tsAt = y => {
      let i = 0; while (i < TORSO.length - 2 && y > TORSO[i + 1][0]) i++;
      const a = TORSO[i], d = TORSO[i + 1], k = cl((y - a[0]) / (d[0] - a[0]), 0, 1);
      let W = lp(a[1], d[1], k), F = lp(a[2], d[2], k), Bk = lp(a[3], d[3], k);
      const zh = 1 - smr(y, 0.96, 1.06), zw = bump(y, 1.1, 0.16), zc = smr(y, 1.16, 1.3) * (1 - smr(y, 1.4, 1.47)), zs = smr(y, 1.33, 1.42);
      W *= lp(1, D.hw, zh) * lp(1, D.ww, zw) * lp(1, D.cw, zc);
      W *= lp(1, D.shx / SHX, zs * 0.9);
      F = F * lp(1, 1 + (D.cw - 1) * 0.7, zc) * lp(1, 1 + (D.hw - 1) * 0.5, zh) + D.belly * bump(y, 1.09, 0.2) + D.bust * bump(y, 1.295, 0.075);
      Bk = Bk * lp(1, 1 + (D.cw - 1) * 0.5, zc) * lp(1, 1 + (D.hw - 1) * 0.8, zh) - D.belly * 0.25 * bump(y, 1.05, 0.2);
      return [W, F, Bk];
    };
    /** 10-point torso ring: front strip (2), front corners (2), sides (4), back corners (2). pad = clothing thickness. */
    const tring = (y, pad = 0, o = {}) => {
      const t = tsAt(y), W = t[0] + pad, F = t[1] + pad, Bk = t[2] - pad, w = o.w || torsoW(y);
      const fW = W * (o.fw || 0.6), bW = W * 0.64, sF = F * 0.42, sB = Bk * 0.5, cW = o.cw !== undefined ? o.cw : 0.014, cF = F - (o.cin || 0);
      const yy = o.yf ? i => y + o.yf(i) : () => y;
      const p = [V(cW, yy(0), cF, w), V(fW, yy(1), F, w), V(W, yy(2), sF, w), V(W, yy(3), sB, w), V(bW, yy(4), Bk, w), V(-bW, yy(4), Bk, w), V(-W, yy(3), sB, w), V(-W, yy(2), sF, w), V(-fW, yy(1), F, w), V(-cW, yy(0), cF, w)];
      return { p, c: [0, y, (F + Bk) / 2] };
    };
    const hasSkirt = TS.skirt || bot.type === 'skirt' || bot.type === 'longskirt';
    const bare = TS.bare;
    const pelvisC = bot.type === 'none' ? (alien || vr === 'robot' ? skin : mulC(skin, 0.96)) : hasSkirt ? mulC(botC, 0.55) : botC;
    // pelvis (always built: it closes the body under untucked tops and skirts)
    {
      const ys = [0.8, 0.85, 0.93, 1.02, 1.045], rs = ys.map((y, i) => tring(y, i === 0 ? 0 : 0.004, { w: 'hips' }));
      G.loft(rs, { col: pelvisC, capA: true, mat: undefined });
    }
    // the top garment (or bare skin)
    const hemY = TS.long ? 0.93 : TS.hem, pad = TS.pad;
    const stripCol = y => {
      const s = TS.strip;
      if (bare) return skin;
      if (s === 'open') return y < 1.03 ? (top.type === 'labcoat' ? (hasSkirt ? botC : botC) : topC2) : topC2;
      if (s === 'vee' || s === 'robe') return y > (top.type === 'coat' ? 1.3 : s === 'robe' ? 1.2 : 1.13) ? topC2 : topC;
      if (s === 'placket') return mulC(topC, lum(topC) > 0.4 ? 0.9 : 1.25);
      if (s === 'zip') return topC2;
      return topC;
    };
    const stripW = y => {
      const s = TS.strip;
      if (s === 'open') return top.type === 'vest' ? 0.04 : 0.045;
      if (s === 'vee') return top.type === 'coat' ? lp(0.006, 0.05, smr(y, 1.3, 1.44)) : lp(0.006, 0.058, smr(y, 1.13, 1.42));
      if (s === 'robe') return lp(0.004, 0.045, smr(y, 1.2, 1.44));
      if (s === 'placket') return 0.013; if (s === 'zip') return 0.01;
      return 0.02;
    };
    const neckline = TS.collar;   // skin shows on the top band for scoop / tank / vee
    const topCol = (ym, j) => {
      if (bare) return skin;
      if (j === 9) { if ((neckline === 'scoop' || neckline === 'tank') && ym > 1.36) return skin; return stripCol(ym); }
      if (neckline === 'scoop' && ym > 1.41) return skin;
      if (neckline === 'scoop' && ym > 1.36 && (j === 0 || j === 8)) return skin;
      if (neckline === 'tank') { if (ym > 1.41 && j !== 0 && j !== 8 && j !== 4) return skin; if (ym > 1.3 && (j === 2 || j === 6 || j === 3 || j === 5 || j === 1 || j === 7) && ym > 1.36) return skin; }
      if (TS.rib && ym < hemY + 0.03) return mulC(topC, 0.82);
      return topC;
    };
    {
      const ys = [hemY, 0.95, 1.02, 1.1, 1.2, 1.3, 1.385, 1.435, 1.465].filter((y, i) => i === 0 || y > hemY + 0.03);
      const rs = ys.map((y, i) => {
        const hemIn = TS.rib && i === 0 ? -0.006 : 0, vee = TS.strip === 'vee' || TS.strip === 'open' || TS.strip === 'robe' ? 0.007 : TS.strip ? 0.002 : 0;
        return tring(y, (bare ? 0 : pad * (y > 1.42 ? 0.6 : 1)) + hemIn, { cw: bare ? 0.014 : stripW(y), cin: bare ? 0 : vee });
      });
      for (let i = 0; i < rs.length - 1; i++) { const ym = (ys[i] + ys[i + 1]) / 2; rs[i].col = j => topCol(ym, j); if (metal) rs[i].mat = 'metal'; }
      G.loft(rs, {});
    }
    // ---------------------------------------------------------------------------------- neck
    {
      const nk = D.neck, w1 = 'chest', w2 = 'neck', w3 = 'head';
      const r0 = G.ringH(0, 1.44, -0.022, 0.06 * nk, 0.062 * nk, 6, PI / 6, w1), r1 = G.ringH(0, 1.5, -0.018, 0.05 * nk, 0.054 * nk, 6, PI / 6, w2), r2 = G.ringH(0, 1.58, -0.014, 0.047 * nk, 0.052 * nk, 6, PI / 6, w3);
      G.loft([r0, r1, r2], { col: skin });
    }

    // ---------------------------------------------------------------------------------- arms
    // radius of the bare arm at distance d below the shoulder joint
    const ARM = [[-0.045, 0.026], [0.04, 0.053], [0.14, 0.046], [0.24, 0.041], [0.285, 0.04], [0.33, 0.043], [0.44, 0.034], [0.535, 0.026]];
    const armR = d => { let i = 0; while (i < ARM.length - 2 && d > ARM[i + 1][0]) i++; const a = ARM[i], q = ARM[i + 1]; return lp(a[1], q[1], cl((d - a[0]) / (q[0] - a[0]))) * D.g * D.armG; };
    const sleeveEnd = bare ? -1 : TS.sl >= 9 ? 0.5 : TS.sl, armK = TS.ak, sleeveC = TS.vest ? topC2 : topC;
    const gloves = !!c.acc.gloves || TS.suit || TS.metal, gloveC = c.accCol.gloves ? C(c.accCol.gloves) : TS.suit ? (top.type === 'hazmat' ? C('#2a2a2e') : C('#c4c9cf')) : TS.metal ? mulC(topC, 0.82) : C('#2e2a28');
    for (const s of SIDES) {
      const m = s === 'L' ? 1 : -1, sx = D.shx * m, sy = REST.armL.ay, sz = REST.armL.az, aB = 'arm' + s, fB = 'fore' + s;
      const rs = [], cov = d => d < sleeveEnd;
      const mk = (d, covered, extra = 0, w) => {
        const r0 = armR(d), flat = smr(d, 0.44, 0.535), bell = TS.bell && covered ? smr(d, 0.2, 0.5) * 0.05 : 0;
        const r = (covered ? r0 * armK + 0.004 : r0) + extra + bell, rx = r * lp(1, 0.82, flat), rz = r * lp(1, 1.1, flat);
        const R = G.ringH(sx, sy - d, sz, rx, rz, 5, PI, w || (d < A1 ? aB : fB));
        R.d = d; R.covered = covered; return R;
      };
      const ds = [-0.045, 0.04, 0.14, 0.24, 0.285, 0.33, 0.44, 0.535];
      for (const d of ds) {
        const covered = cov(d);
        // sleeve hem: a ledge where the sleeve stops and skin begins
        if (!covered && rs.length && rs[rs.length - 1].covered) {
          const de = Math.min(sleeveEnd, d - 0.004);
          if (de > rs[rs.length - 1].d + 0.01) rs.push(mk(de, true, TS.cuff === 2 ? -0.004 : 0.002));
          const lip = mk(de, false); lip.col = () => mulC(sleeveC, 0.6); rs[rs.length - 1].lip = true; rs.push(lip);
        }
        const R = mk(d, covered);
        if (d === 0.285) {   // elbow: the point of the elbow travels with the forearm
          const p = R.p; p[0].w = fB; p[0].z -= 0.006; p[0].y += 0.012; p[1].w = [[fB, 0.65], [aB, 0.35]]; p[4].w = [[fB, 0.65], [aB, 0.35]]; p[2].w = [[fB, 0.5], [aB, 0.5]]; p[3].w = [[fB, 0.5], [aB, 0.5]];
        }
        rs.push(R);
      }
      // colours per band
      for (let i = 0; i < rs.length - 1; i++) {
        const A = rs[i], dm = (A.d + rs[i + 1].d) / 2;
        if (A.col) continue;
        if (A.lip) { A.col = mulC(sleeveC, 0.55); continue; }
        let col = A.covered && rs[i + 1].covered ? sleeveC : skin;
        if (A.covered && rs[i + 1].covered) {
          if (TS.cuff === 1 && dm > 0.45) col = mulC(sleeveC, lum(sleeveC) > 0.4 ? 0.88 : 1.3);
          if (TS.cuff === 2 && dm > 0.45) col = mulC(sleeveC, 0.82);
          if (TS.cuff === 3 && dm > 0.47) col = topC2;
          if (TS.suit && dm > 0.24 && dm < 0.33) col = top.type === 'spacesuit' ? topC2 : mulC(topC, 0.8);
          if (metal) A.mat = 'metal';
        } else if (gloves && dm > 0.47) col = gloveC;
        A.col = col;
      }
      G.loft(rs, { capA: true });
      // ---- hand (mitten + index finger + thumb) ----
      const hs = D.hand * (gloves ? 1.1 : 1), hx = sx, hy = REST.handL.ay, hz = REST.handL.az, hB = 'hand' + s;
      const hc = gloves ? gloveC : skin, hmat = TS.metal ? 'metal' : undefined;
      // local hand coords: x = thickness (palm side = -x for the left hand), y = along the fingers (down), z = width (thumb = +z)
      const P = (x, y, z, w) => V(hx + x * hs * m, hy + y * hs, hz + z * hs, w);
      const r4 = (y, x0, x1, z0, z1, w, yb) => ({ p: [P(x0, y, z0, w), P(x1, y, z0, w), P(x1, yb !== undefined ? yb : y, z1, w), P(x0, yb !== undefined ? yb : y, z1, w)] });
      G.loft([r4(0.012, -0.011, 0.011, -0.022, 0.022, hB), r4(-0.04, -0.014, 0.015, -0.046, 0.045, hB), r4(-0.1, -0.012, 0.013, -0.046, 0.045, hB)], { col: hc, capB: true, mat: hmat });
      const m1 = 'mitt1' + s, m2 = 'mitt2' + s, i1 = 'idx1' + s, i2 = 'idx2' + s;
      G.loft([r4(-0.096, -0.0115, 0.0125, -0.046, 0.013, m1), r4(-0.152, -0.0105, 0.0115, -0.045, 0.013, [[m1, 0.5], [m2, 0.5]]), r4(-0.176, -0.008, 0.009, -0.041, 0.011, m2, -0.2)], { col: hc, capB: true, mat: hmat });
      G.loft([r4(-0.096, -0.0115, 0.0125, 0.016, 0.045, i1), r4(-0.15, -0.0105, 0.0115, 0.017, 0.044, [[i1, 0.5], [i2, 0.5]]), r4(-0.19, -0.008, 0.009, 0.02, 0.041, i2)], { col: hc, capB: true, mat: hmat });
      {
        const tb = 'thumb' + s, ax = [-0.3, -0.72, 0.62], al = Math.hypot(ax[0], ax[1], ax[2]), a = ax.map(v => v / al), u = [0.9, -0.2, 0.2], ul = Math.hypot(u[0], u[1], u[2]), U = u.map(v => v / ul), W = [a[1] * U[2] - a[2] * U[1], a[2] * U[0] - a[0] * U[2], a[0] * U[1] - a[1] * U[0]];
        const tr = (t, r, w) => { const cx = -0.004 + a[0] * t, cy = -0.034 + a[1] * t, cz = 0.042 + a[2] * t, p = []; for (let j = 0; j < 4; j++) { const an = j * HPI + PI / 4; p.push(P(cx + (U[0] * cos(an) + W[0] * sin(an)) * r, cy + (U[1] * cos(an) + W[1] * sin(an)) * r, cz + (U[2] * cos(an) + W[2] * sin(an)) * r, w)); } return { p }; };
        G.loft([tr(-0.012, 0.012, hB), tr(0.03, 0.0125, tb), tr(0.064, 0.0085, tb)], { col: hc, capB: true, mat: hmat });
      }
    }

    // ---------------------------------------------------------------------------------- legs
    // [y, rx, rz, cz]
    const LEG = [[0.965, 0.062, 0.066, 0], [0.9, 0.084, 0.09, -0.004], [0.76, 0.073, 0.075, 0], [0.545, 0.055, 0.056, 0.002], [0.5, 0.053, 0.053, 0.002], [0.455, 0.05, 0.05, 0], [0.37, 0.052, 0.057, -0.008], [0.22, 0.039, 0.04, -0.004], [0.105, 0.033, 0.035, 0]];
    const legAt = y => { let i = 0; while (i < LEG.length - 2 && y < LEG[i + 1][0]) i++; const a = LEG[i], q = LEG[i + 1], k = cl((a[0] - y) / (a[0] - q[0])); const g = D.g * lp(D.legG * lp(1, D.hw, 0.5), 1, smr(a[0] - (a[0] - q[0]) * k, 0.9, 0.5) * 0.5); return [lp(a[1], q[1], k) * g, lp(a[2], q[2], k) * g, lp(a[3], q[3], k)]; };
    const pantsEnd = bot.type === 'shorts' ? 0.6 : (bot.type === 'pants' || bot.type === 'jeans') ? 0.095 : 2, boots = c.shoes.type === 'boots' || TS.suit || TS.metal;
    const bootTop = TS.suit ? 0.34 : TS.metal ? 0.0 : 0.3, legK = TS.suit ? 1.34 : bot.type === 'jeans' ? 1.07 : 1.13, legPad = TS.suit ? 0.01 : 0.005;
    const legC = TS.suit ? topC : botC, suitLeg = TS.suit;
    for (const s of SIDES) {
      const m = s === 'L' ? 1 : -1, lx = HIPX * m, lB = 'leg' + s, sB = 'shin' + s, rs = [];
      const cov = y => suitLeg || y > pantsEnd;
      const mk = (y, covered, extra = 0) => {
        const t = legAt(y), k = covered ? legK : 1, pd = covered ? legPad : 0, straight = covered && !suitLeg && y < 0.42 ? lp(0, 0.012, smr(y, 0.42, 0.12)) : 0;
        const R = G.ringH(lx + (y > 0.8 ? 0.004 * m : 0), y, t[2], t[0] * k + pd + extra + straight, t[1] * k + pd + extra + straight, 5, 0, y > 0.5 ? lB : sB);
        R.y = y; R.covered = covered; return R;
      };
      const ys = [0.965, 0.9, 0.76, 0.545, 0.5, 0.455, 0.37, 0.22, 0.105];
      for (const y of ys) {
        const covered = cov(y);
        if (!covered && rs.length && rs[rs.length - 1].covered) {
          const ye = Math.max(pantsEnd, y + 0.004);
          if (ye < rs[rs.length - 1].y - 0.012) rs.push(mk(ye, true, bot.type === 'shorts' ? 0.008 : 0.002));
          const lip = mk(ye, false); rs[rs.length - 1].lip = true; rs.push(lip);
        }
        const R = mk(y, covered);
        if (y === 0.5) { const p = R.p; p[0].w = lB; p[0].z += 0.007; p[0].y -= 0.012; p[1].w = [[lB, 0.65], [sB, 0.35]]; p[4].w = [[lB, 0.65], [sB, 0.35]]; p[2].w = [[lB, 0.5], [sB, 0.5]]; p[3].w = [[lB, 0.5], [sB, 0.5]]; }
        rs.push(R);
      }
      const legSkin = bot.type === 'none' ? skin : skin;
      for (let i = 0; i < rs.length - 1; i++) {
        const A = rs[i], ym = (A.y + rs[i + 1].y) / 2;
        if (A.lip) { A.col = mulC(legC, 0.55); continue; }
        let col = A.covered && rs[i + 1].covered ? legC : legSkin;
        if (A.covered && rs[i + 1].covered) {
          if (bot.type === 'jeans' && ym < 0.16) col = mulC(legC, 1.25);
          if (suitLeg && ym > 0.455 && ym < 0.545) col = top.type === 'spacesuit' ? topC2 : mulC(topC, 0.8);
        }
        if (hasSkirt && ym > 0.86) col = pelvisC;
        if (TS.metal && ym < 0.56) { col = topC; A.mat = 'metal'; }
        A.col = col;
      }
      G.loft(rs, { capA: true });
      if (boots && !TS.metal && vr !== 'ghost') {   // boot shaft over the trouser leg
        const bt = [bootTop, 0.2, 0.105].map((y, i) => { const t = legAt(y), k = (cov(y) ? legK : 1), e = 0.012 + (i === 0 ? 0.004 : 0); return G.ringH(lx, y, t[2], t[0] * k + e, t[1] * k + e, 5, 0, sB); });
        G.loft(bt, { col: TS.suit ? (top.type === 'hazmat' ? C('#2a2a2e') : C('#b9bec4')) : shoeC, capA: mulC(shoeC, 0.6) });
      }
      // ---- foot / shoe ----
      const fs = D.foot * (boots ? 1.08 : 1), fB = 'foot' + s, tB = 'toe' + s, st = c.shoes.type, bf = st === 'barefoot' && !TS.suit && !TS.metal;
      const soleH = bf ? 0.0 : boots ? 0.03 : st === 'heels' ? 0.012 : 0.022;
      const shoeCol = TS.suit ? (top.type === 'hazmat' ? C('#2a2a2e') : C('#b9bec4')) : TS.metal ? topC : bf ? skin : shoeC, soleC = bf ? skin : TS.suit ? mulC(shoeCol, 0.7) : lum(shoeCol) > 0.25 ? mulC(shoeCol, 0.45) : mixC(shoeCol, '#d8d2c4', st === 'shoes' ? 0.75 : 0.12);
      const fmat = TS.metal ? 'metal' : undefined;
      // cross-sections along z: [z, half-width, top y, top half-width, sole lift]
      let secs = bf
        ? [[-0.058, 0.026, 0.0, 0.02, 0.0], [-0.012, 0.033, 0.045, 0.029, 0], [0.05, 0.04, 0.014, 0.024, 0], [0.125, 0.046, -0.04, 0.036, 0], [0.19, 0.036, -0.056, 0.03, 0.004]]
        : st === 'heels' && !boots
          ? [[-0.05, 0.022, -0.002, 0.02, 0.0], [-0.012, 0.03, 0.02, 0.027, 0], [0.05, 0.036, -0.012, 0.022, 0], [0.125, 0.041, -0.044, 0.03, 0], [0.2, 0.014, -0.06, 0.01, 0.004]]
          : [[-0.064, 0.031, -0.004, 0.025, 0.004], [-0.014, 0.04, 0.05, 0.035, 0], [0.052, 0.045, 0.02, 0.027, 0], [0.125, 0.05, -0.034, 0.039, 0], [0.207, 0.034, -0.05, 0.026, 0.008]];
      const fr0 = secs.map((q, i) => {
        const z = q[0] * fs, hw = q[1] * fs, w = i < 3 ? fB : i === 3 ? [[fB, 0.5], [tB, 0.5]] : tB, y0 = q[4], yw = y0 + soleH, yt = ANK + q[2] * (bf ? 1 : fs), cx = lx;
        return { p: [V(cx + hw * m, y0, z, w), V(cx + hw * 1.03 * m, yw, z, w), V(cx + q[3] * fs * m, yt, z, w), V(cx - q[3] * fs * m, yt, z, w), V(cx - hw * 1.03 * m, yw, z, w), V(cx - hw * m, y0, z, w)], c: [cx, (y0 + yt) / 2, z] };
      });
      for (const R of fr0) R.col = j => (j === 0 || j === 4 || j === 5 ? soleC : shoeCol);
      if (vr !== 'ghost') G.loft(fr0, { capA: shoeCol, capB: st === 'shoes' && !TS.suit && !TS.metal ? soleC : shoeCol, mat: fmat });
      if (st === 'heels' && !boots && vr !== 'ghost') G.box(lx, 0.02, -0.04 * fs, 0.022, 0.04, 0.024, fB, shoeCol);
    }

    return { G, D, skin, skinD, topC, topC2, botC, TS, tring, tsAt, dirty };
  }

  // =====================================================================================================
  // 5. the head
  // =====================================================================================================
  // head-local coordinates (origin = head pivot at the top of the neck). Rows from the crown down, columns k0 (front
  // centre line) .. k6 (back centre line) on the left side; the right side is the mirror image.
  const HEAD = [
    [[0, 0.187, 0.04], [0.024, 0.188, 0.034], [0.042, 0.188, 0.016], [0.049, 0.188, -0.01], [0.042, 0.187, -0.036], [0.024, 0.185, -0.054], [0, 0.184, -0.06]],
    [[0, 0.152, 0.08], [0.036, 0.152, 0.072], [0.064, 0.151, 0.042], [0.076, 0.15, -0.008], [0.068, 0.149, -0.056], [0.038, 0.147, -0.09], [0, 0.146, -0.1]],
    [[0, 0.1, 0.094], [0.02, 0.1, 0.092], [0.058, 0.098, 0.074], [0.078, 0.098, 0.022], [0.077, 0.096, -0.05], [0.044, 0.093, -0.097], [0, 0.091, -0.108]],
    [[0, 0.05, 0.094], [0.02, 0.05, 0.09], [0.056, 0.05, 0.074], [0.076, 0.049, 0.022], [0.075, 0.05, -0.048], [0.042, 0.047, -0.092], [0, 0.045, -0.102]],
    [[0, 0.026, 0.093], [0.025, 0.026, 0.091], [0.052, 0.024, 0.068], [0.072, 0.019, 0.018], [0.069, 0.014, -0.044], [0.04, 0.01, -0.08], [0, 0.008, -0.088]],
    [[0, 0.005, 0.094], [0.026, 0.005, 0.092], [0.047, 0.003, 0.066], [0.066, -0.002, 0.016], [0.062, -0.004, -0.022], [0.036, -0.004, -0.06], [0, -0.006, -0.068]],
    [[0, -0.001, 0.094], [0.026, -0.001, 0.092], [0.046, -0.002, 0.065], [0.065, -0.005, 0.016], [0.062, -0.004, -0.022], [0.036, -0.004, -0.06], [0, -0.006, -0.068]],
    [[0, -0.034, 0.086], [0.022, -0.034, 0.082], [0.04, -0.03, 0.058], [0.052, -0.024, 0.018], [0.048, -0.022, -0.016], [0.03, -0.024, -0.04], [0, -0.026, -0.046]],
  ];
  const HEAD_APEX = [0, 0.205, -0.012], HEAD_BOT = [0, -0.046, 0.005], JAWP = [0, 0.02, -0.02];
  const HEADW = [null, null, null, null, null, null, ['jaw', 'jaw', [['jaw', 0.8], ['head', 0.2]], [['jaw', 0.45], ['head', 0.55]], 'head', 'head', 'head'], ['jaw', 'jaw', 'jaw', [['jaw', 0.7], ['head', 0.3]], [['jaw', 0.25], ['head', 0.75]], 'head', 'head']];

  function buildHead(c, M) {
    const { G, D, skin } = M, V = G.V, f = c.shape === 'f', hp = REST.head, vr = c.variant;
    const hsc = (f ? 0.965 : 1) * (c.build === 'heavy' ? 1.03 : 1), jawK = f ? 0.92 : c.build === 'heavy' ? 1.1 : c.build === 'strong' ? 1.06 : c.build === 'slim' ? 0.96 : 1;
    // copy + shape the table
    const rows = HEAD.map((r, ri) => r.map((p, k) => { let x = p[0], y = p[1], z = p[2]; if (ri >= 4 && k >= 1 && k <= 4) x *= jawK; if (ri === 7 && k <= 2 && f) { x *= 0.9; y += 0.003; } if (c.build === 'heavy' && ri >= 5 && k >= 1 && k <= 4) { y -= 0.004; } return [x, y, z]; }));
    // make the eye plane exactly flat: plane through L3k1, L3k2, L4k1; move L4k2 onto it
    const a = rows[2][1], b = rows[2][2], d = rows[3][1], e = rows[3][2];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const nl = Math.hypot(n[0], n[1], n[2]); n = n.map(q => q / nl); if (n[2] < 0) n = n.map(q => -q);
    e[2] = a[2] - (n[0] * (e[0] - a[0]) + n[1] * (e[1] - a[1])) / n[2];
    const toAbs = p => [p[0] * hsc, hp.ay + p[1] * hsc, hp.az + p[2] * hsc];
    const vert = (p, w, mir) => { const q = toAbs(p); return V(mir ? -q[0] : q[0], q[1], q[2], w); };
    const rings = rows.map((r, ri) => {
      const pts = [], W = HEADW[ri];
      for (let k = 0; k <= 6; k++) pts.push(vert(r[k], W ? W[k] : 'head'));
      for (let k = 5; k >= 1; k--) pts.push(vert(r[k], W ? W[k] : 'head', true));
      return { p: pts, c: toAbs([0, r[0][1], -0.01]) };
    });
    const stub = c.facialHair === 'stubble' ? mixC(skin, c.hair.color, 0.3) : null;
    const lipBand = mulC(skin, 0.5);
    for (let ri = 0; ri < rings.length - 1; ri++) {
      rings[ri].col = j => {
        const k = j < 6 ? j : 11 - j;    // column index of the face (0 = centre strip .. 5 = back)
        if (ri === 5 && k === 0) return lipBand;                        // the mouth slot (hidden behind the mouth decal)
        if (stub && ((ri >= 5 && k <= 3) || (ri === 4 && k >= 1 && k <= 3) || (ri === 3 && k === 3))) return stub;
        return skin;
      };
    }
    // flat-coloured eye planes (no per-face variation so that the eyelid decal blends in)
    const body = rings.slice();
    const apex = toAbs(HEAD_APEX), bot = toAbs(HEAD_BOT);
    const ap = V(apex[0], apex[1], apex[2], 'head'), bp = V(bot[0], bot[1], bot[2], [['jaw', 0.5], ['head', 0.5]]);
    const ctr = toAbs([0, 0.09, -0.01]);
    for (let j = 0; j < 12; j++) G.tri(ap, rings[0].p[j], rings[0].p[(j + 1) % 12], skin, { ref: ctr });
    for (let ri = 0; ri < body.length - 1; ri++) {
      const A = body[ri], B = body[ri + 1];
      for (let j = 0; j < 12; j++) {
        const j2 = (j + 1) % 12, k = j < 6 ? j : 11 - j, eye = ri === 2 && k === 1;
        G.quad(A.p[j], A.p[j2], B.p[j2], B.p[j], A.col(j), { ref: ctr, vary: eye ? 0 : 0.035 });
      }
    }
    const L = rings[rings.length - 1];
    for (let j = 0; j < 12; j++) G.tri(bp, L.p[j], L.p[(j + 1) % 12], skin, { ref: ctr });
    // nose
    const nz = f ? 0.9 : c.age === 'elder' ? 1.1 : 1, hv = (x, y, z, mir) => vert([mir ? -x : x, y, z], 'head');
    if (vr !== 'alien' && vr !== 'robot' && vr !== 'shadow') {
      const bL = hv(0.007, 0.096, 0.0935), bR = hv(-0.007, 0.096, 0.0935), tL = hv(0.0095, 0.047, 0.094 + 0.024 * nz), tR = hv(-0.0095, 0.047, 0.094 + 0.024 * nz), aL = hv(0.0165 * nz, 0.031, 0.0925), aR = hv(-0.0165 * nz, 0.031, 0.0925), sb = hv(0, 0.029, 0.0945), nref = toAbs([0, 0.06, 0.08]);
      const nc = mulC(skin, 1.03), nd = mulC(skin, 0.86);
      G.quad(bL, bR, tR, tL, nc, { ref: nref, vary: 0.02 }); G.tri(bL, tL, aL, mulC(skin, 0.95), { ref: nref, vary: 0.02 }); G.tri(bR, tR, aR, mulC(skin, 0.95), { ref: nref, vary: 0.02 });
      G.tri(tL, tR, sb, nd, { ref: nref, vary: 0.02 }); G.tri(tL, sb, aL, nd, { ref: nref, vary: 0.02 }); G.tri(tR, sb, aR, nd, { ref: nref, vary: 0.02 });
    }
    // ears
    if (vr !== 'alien' && vr !== 'robot') {
      for (const mir of [false, true]) {
        const f1 = hv(0.0755, 0.1, 0.006, mir), f2 = hv(0.0745, 0.05, 0.008, mir), o1 = hv(0.094, 0.104, -0.02, mir), o2 = hv(0.088, 0.054, -0.014, mir), b1 = hv(0.0765, 0.096, -0.03, mir), b2 = hv(0.0745, 0.052, -0.026, mir), er = toAbs([mir ? -0.07 : 0.07, 0.075, -0.012]);
        const ec = mulC(skin, 0.97);
        G.quad(f1, o1, o2, f2, ec, { ref: er }); G.quad(o1, b1, b2, o2, mulC(skin, 0.85), { ref: er }); G.tri(f1, o1, b1, ec, { ref: er }); G.tri(f2, o2, b2, ec, { ref: er });
      }
    }
    M.head = { rows, toAbs, hsc, n, vert };
  }

  // ---- hair: a shell grown from the head grid, plus style pieces -------------------------------------------
  function buildHair(c, M) {
    const { G } = M, V = G.V, H = M.head, st = c.hair.style, vr = c.variant;
    if (st === 'bald' || vr === 'alien' || vr === 'robot' || vr === 'skeleton' || vr === 'shadow') return;
    let hc = M.dirty(c.hair.color); const dark = mulC(hc, 0.78), lite = mulC(hc, 1.14);
    const ctr = [0, 0.095, -0.012];
    // per style: thickness t(row, col) or 0 for no hair; rows 0..7 of the head grid, -1 = apex
    const S = {
      short: (r, k) => (r <= 1 ? (k <= 1 ? 0.02 : 0.016) : r === 2 ? (k >= 3 ? 0.012 : 0) : r === 3 ? (k >= 4 ? 0.01 : 0) : r === 4 ? (k >= 5 ? 0.007 : 0) : 0),
      buzz: (r, k) => (r <= 1 ? 0.005 : r === 2 ? (k >= 3 ? 0.004 : 0) : r === 3 ? (k >= 4 ? 0.004 : 0) : 0),
      bob: (r, k) => (r <= 1 ? 0.022 : r === 2 ? (k >= 2 ? 0.022 : 0.016) : r <= 5 ? (k >= 3 ? 0.024 : 0) : 0),
      long: (r, k) => (r <= 1 ? 0.02 : r === 2 ? (k >= 2 ? 0.02 : 0) : r <= 5 ? (k >= 3 ? 0.022 : 0) : 0),
      bun: (r, k) => (r <= 1 ? 0.011 : r === 2 ? (k >= 3 ? 0.01 : 0) : r === 3 ? (k >= 4 ? 0.009 : 0) : r === 4 ? (k >= 5 ? 0.007 : 0) : 0),
      ponytail: (r, k) => (r <= 1 ? 0.012 : r === 2 ? (k >= 3 ? 0.011 : 0) : r === 3 ? (k >= 4 ? 0.009 : 0) : r === 4 ? (k >= 5 ? 0.007 : 0) : 0),
      curly: (r, k) => (r <= 1 ? 0.034 : r === 2 ? (k >= 2 ? 0.034 : 0.02) : r === 3 ? (k >= 3 ? 0.03 : 0) : r === 4 ? (k >= 4 ? 0.022 : 0) : 0),
      afro: (r, k) => (r <= 1 ? 0.075 : r === 2 ? (k >= 2 ? 0.075 : 0.03) : r === 3 ? (k >= 3 ? 0.06 : 0) : r === 4 ? (k >= 4 ? 0.035 : 0) : 0),
      mohawk: (r, k) => (r <= 1 ? 0.004 : r === 2 ? (k >= 3 ? 0.004 : 0) : r === 3 ? (k >= 4 ? 0.004 : 0) : 0),
    }[st];
    if (st === 'buzz' || st === 'mohawk') hc = mixC(hc, M.skin, 0.3);
    const jit = st === 'curly' ? 0.014 : st === 'afro' ? 0.02 : st === 'buzz' || st === 'mohawk' || st === 'bun' || st === 'ponytail' ? 0.0 : 0.004;
    const out = (p, t, r, k) => {
      const dx = p[0] - ctr[0], dy = p[1] - ctr[1], dz = p[2] - ctr[2], l = Math.hypot(dx, dy, dz) || 1, j = jit ? (hash(r * 13 + k * 7, c.seed) - 0.5) * 2 * jit : 0, tt = t + j;
      let q = [p[0] + dx / l * tt, p[1] + dy / l * tt, p[2] + dz / l * tt];
      if (st === 'short' && r <= 1 && k <= 2) { q[2] += 0.012; q[1] += r === 0 ? 0.006 : -0.004; if (r === 1) q[0] += 0.004; }       // a little quiff
      if (st === 'bob' && r === 2 && k <= 1) { q[1] -= 0.012; q[2] += 0.004; }                                                           // fringe to the brow
      if ((st === 'bob' || st === 'long') && r === 1 && k <= 2) q[2] += 0.006;
      return q;
    };
    // grid of hair vertices [row][col 0..11] (null where there is none)
    const nR = H.rows.length, grid = [], base = [];
    for (let r = 0; r < nR; r++) {
      const gr = [], br = [];
      for (let j = 0; j < 12; j++) {
        const k = j <= 6 ? j : 12 - j, mir = j > 6, p = H.rows[r][k], t = S(r, k);
        if (t > 0) { const q = out(p, t, r, k), aq = H.toAbs(q), ab = H.toAbs(out(p, 0.0012, r, k)); gr.push(V(mir ? -aq[0] : aq[0], aq[1], aq[2], 'head')); br.push(V(mir ? -ab[0] : ab[0], ab[1], ab[2], 'head')); }
        else { gr.push(null); br.push(null); }
      }
      grid.push(gr); base.push(br);
    }
    const cabs = H.toAbs(ctr), o = { ref: cabs, vary: 0.11 };
    const tA = S(-1, 0) || S(0, 0), ap = H.toAbs([HEAD_APEX[0], HEAD_APEX[1] + tA + (st === 'short' ? 0.004 : 0), HEAD_APEX[2]]), apv = V(ap[0], ap[1], ap[2], 'head');
    for (let j = 0; j < 12; j++) if (grid[0][j] && grid[0][(j + 1) % 12]) G.tri(apv, grid[0][j], grid[0][(j + 1) % 12], hc, o);
    const cell = (r, j) => r >= 0 && r < nR - 1 && grid[r][j] && grid[r][(j + 1) % 12] && grid[r + 1][j] && grid[r + 1][(j + 1) % 12];
    for (let r = 0; r < nR - 1; r++) for (let j = 0; j < 12; j++) {
      if (!cell(r, j)) continue; const j2 = (j + 1) % 12;
      G.quad(grid[r][j], grid[r][j2], grid[r + 1][j2], grid[r + 1][j], (r + j) % 3 === 0 ? lite : hc, o);
      // rims on the open sides of this cell
      if (!cell(r + 1, j)) G.quad(grid[r + 1][j], grid[r + 1][j2], base[r + 1][j2], base[r + 1][j], dark, { vary: 0.08 });
      if (!cell(r, (j + 11) % 12)) G.quad(grid[r][j], grid[r + 1][j], base[r + 1][j], base[r][j], dark, { vary: 0.08 });
      if (!cell(r, j2)) G.quad(grid[r][j2], grid[r + 1][j2], base[r + 1][j2], base[r][j2], dark, { vary: 0.08 });
      if (r > 0 && !cell(r - 1, j)) G.quad(grid[r][j], grid[r][j2], base[r][j2], base[r][j], dark, { vary: 0.08 });
    }
    M.hairGrid = grid; M.hairCol = hc;
    const hv = (x, y, z, w) => { const q = H.toAbs([x, y, z]); return V(q[0], q[1], q[2], w || 'head'); };
    if (st === 'bun') { const bc = H.toAbs([0, 0.165, -0.105]); const r1 = G.ringUV(bc, [1, 0, 0], [0, 0.6, 0.8], 0.04, 0.04, 6, 0, 'head'); const tip = H.toAbs([0, 0.2, -0.15]), r0 = G.ringUV(H.toAbs([0, 0.14, -0.07]), [1, 0, 0], [0, 0.6, 0.8], 0.03, 0.03, 6, 0, 'head'), r2 = G.ringUV(H.toAbs([0, 0.19, -0.137]), [1, 0, 0], [0, 0.6, 0.8], 0.024, 0.024, 6, 0, 'head'); G.loft([r0, r1, r2], { col: j => (j % 2 ? hc : lite), capB: dark, vary: 0.1 }); }
    if (st === 'ponytail') {
      const r0 = G.ringUV(H.toAbs([0, 0.14, -0.095]), [1, 0, 0], [0, 0.7, 0.7], 0.026, 0.026, 5, 0, 'head'), r1 = G.ringUV(H.toAbs([0, 0.13, -0.135]), [1, 0, 0], [0, 0.9, 0.4], 0.03, 0.03, 5, 0, 'hair1'), r2 = G.ringUV(H.toAbs([0, 0.04, -0.15]), [1, 0, 0], [0, 0.2, 1], 0.03, 0.026, 5, 0, [['hair1', 0.5], ['hair2', 0.5]]), r3 = G.ringUV(H.toAbs([0, -0.07, -0.14]), [1, 0, 0], [0, 0, 1], 0.012, 0.012, 5, 0, 'hair2');
      G.loft([r0, r1, r2, r3], { col: j => (j % 2 ? hc : lite), capB: dark, vary: 0.1 });
    }
    if (st === 'mohawk') {
      const hc2 = M.dirty(c.hair.color), pts = [[0.165, 0.085, 0.0], [0.2, 0.04, 0.062], [0.215, -0.02, 0.07], [0.19, -0.075, 0.06], [0.13, -0.11, 0.04], [0.06, -0.105, 0.0]];
      const rs = pts.map(q => { const up = [0, q[0] - 0.09, q[1] + 0.012], ul = Math.hypot(up[1], up[2]), ux = up[1] / ul, uz = up[2] / ul, bx = 0.013, h = q[2]; return { p: [hv(bx, q[0], q[1]), hv(0.004, q[0] + ux * h, q[1] + uz * h), hv(-0.004, q[0] + ux * h, q[1] + uz * h), hv(-bx, q[0], q[1])], c: H.toAbs([0, q[0] + ux * h * 0.3, q[1] + uz * h * 0.3]) }; });
      G.loft(rs, { col: j => (j === 1 ? lite : hc2), capA: hc2, capB: hc2, open: true, vary: 0.1 });
      G.loft(rs, { col: hc2, capA: hc2, capB: hc2, vary: 0.1 });
    }
    if (st === 'long' || st === 'bob') {
      // curtain below the head grid: sides and back hang down from row 5
      const cols = [3, 4, 5, 6, 7, 8, 9], top = cols.map(j => grid[5][j]), lvls = st === 'long' ? [[-0.05, 0.004, 0], [-0.14, 0.0, 0.5], [-0.25, -0.012, 0.75]] : [[-0.035, -0.002, 0]];
      let prev = top;
      lvls.forEach((lv, li) => {
        const cur = cols.map((j, i) => { const k = j <= 6 ? j : 12 - j, p = H.rows[5][k], q = H.toAbs([p[0] * (1 + lv[1] * 6) + 0.024 * (p[0] > 0 ? 1 : 0) * (k === 6 ? 0 : 1), lv[0], p[2] - 0.02 - (k >= 5 ? 0.012 : 0) * (li + 1) * 0.5]); const mir = j > 6; return V(mir ? -q[0] : q[0], q[1], q[2], lv[2] ? [['head', 1 - lv[2]], ['chest', lv[2]]] : 'head'); });
        for (let i = 0; i < cols.length - 1; i++) G.quad(prev[i], prev[i + 1], cur[i + 1], cur[i], (i + li) % 2 ? hc : lite, o);
        prev = cur;
      });
      // close the bottom edge
      const inner = cols.map((j, i) => { const v = prev[i]; return V(v.x * 0.8, v.y + 0.004, v.z + 0.02, v.w); });
      for (let i = 0; i < cols.length - 1; i++) G.quad(prev[i], prev[i + 1], inner[i + 1], inner[i], dark, { vary: 0.08 });
    }
  }

  // =====================================================================================================
  // 6. the face: a small dynamic mesh (eye whites, irises, lids, lashes, brows, mouth) rebuilt when it changes
  // =====================================================================================================
  const EXPR = {
    neutral: {},
    happy: { bi: 0.0015, bo: 0.002, ll: 0.42, mc: 0.0075, mw: 1.28, jaw: 0.09, teeth: 1, lpt: 0.3 },
    sad: { bi: 0.0055, bo: -0.0025, ul: 0.22, lt: -0.7, mc: -0.0055, mw: 0.9, ll: 0.1 },
    angry: { bi: -0.0055, bo: 0.002, ul: 0.2, lt: 0.9, ll: 0.25, mc: -0.004, mw: 1.02, lpt: 0.75, teeth: 1 },
    scared: { bi: 0.0065, bo: 0.002, ew: 1.38, ps: 0.72, jaw: 0.2, mw: 0.9, mc: -0.004, teeth: 0.6, lt: -0.25 },
    surprised: { bi: 0.007, bo: 0.007, ew: 1.42, ps: 0.82, jaw: 0.27, mw: 0.6 },
    suspicious: { biL: -0.0035, boL: -0.001, biR: 0.004, boR: 0.004, ul: 0.42, ll: 0.38, mw: 0.82, mcL: -0.002, mcR: 0.0015, gx: 0.5 },
    asleep: { ul: 1, bi: 0.001, jaw: 0.035, mw: 0.9, mc: -0.0005 },
    dead: { ul: 0.52, gy: 0.75, jaw: 0.3, mw: 0.88, mc: -0.003, ps: 0.9 },
    pain: { bi: -0.004, bo: -0.0015, ul: 0.8, ll: 0.7, lt: 0.5, mw: 1.22, mc: -0.0015, lpt: 1, teeth: 1 },
    determined: { bi: -0.004, bo: 0.001, ul: 0.14, lt: 0.55, ll: 0.16, mc: -0.0022, mw: 0.98 },
    smirk: { mcL: 0.0075, mcR: -0.0005, boR: 0.0045, biR: 0.002, ul: 0.2, mw: 1.05, ll: 0.15 },
    tired: { ul: 0.48, bi: 0.002, bo: -0.002, mc: -0.002, lt: -0.3 },
    shout: { bi: -0.004, bo: 0.002, lt: 0.6, ul: 0.1, jaw: 0.34, mw: 1.05, teeth: 1, mc: -0.002 },
    laugh: { bi: 0.002, bo: 0.003, ul: 0.75, ll: 0.7, mc: 0.008, mw: 1.3, jaw: 0.24, teeth: 1 },
  };
  const EKEYS = ['bi', 'bo', 'biL', 'boL', 'biR', 'boR', 'ul', 'll', 'lt', 'ew', 'ps', 'mw', 'mc', 'mcL', 'mcR', 'jaw', 'lpt', 'teeth', 'gx', 'gy'];
  const EDEF = { ew: 1, ps: 1, mw: 1 };

  function makeFace(A, c, M) {
    const H = M.head, vr = c.variant, f = c.shape === 'f';
    const noFace = vr === 'shadow' || vr === 'robot';
    // eye plane frame (left eye), head-bone local metres
    const hs = H.hsc, a = H.rows[2][1], b = H.rows[2][2], d = H.rows[3][1], e = H.rows[3][2], n = H.n;
    const ec = [(a[0] + b[0] + d[0] + e[0]) / 4 + 0.0005, (a[1] + b[1] + d[1] + e[1]) / 4 + 0.0015, (a[2] + b[2] + d[2] + e[2]) / 4];
    let ux = [b[0] - a[0], b[1] - a[1] * 1 + 0 * 0, b[2] - a[2]]; ux[1] = 0;   // keep the eye line level
    { const dd = ux[0] * n[0] + ux[2] * n[2]; ux = [ux[0] - n[0] * dd, -n[1] * dd, ux[2] - n[2] * dd]; const l = Math.hypot(ux[0], ux[1], ux[2]); ux = ux.map(q => q / l); }
    const uy = [n[1] * ux[2] - n[2] * ux[1], n[2] * ux[0] - n[0] * ux[2], n[0] * ux[1] - n[1] * ux[0]];
    const MAXV = 720, pos = new Float32Array(MAXV * 3), col = new Float32Array(MAXV * 4), nor = new Float32Array(MAXV * 3);
    for (let i = 0; i < MAXV; i++) { nor[i * 3 + 2] = 1; col[i * 4 + 3] = 1; }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 4)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    const glowPos = new Float32Array(180 * 3), glowCol = new Float32Array(180 * 4), ggeo = new T.BufferGeometry();
    ggeo.setAttribute('position', new T.BufferAttribute(glowPos, 3)); ggeo.setAttribute('color', new T.BufferAttribute(glowCol, 4));
    const mesh = new T.Mesh(geo, A.mats.face); mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.renderOrder = 2;
    const gmesh = new T.Mesh(ggeo, A.mats.faceGlow); gmesh.castShadow = false; gmesh.receiveShadow = false; gmesh.frustumCulled = false; gmesh.renderOrder = 3;
    A.bones.head.add(mesh); A.bones.head.add(gmesh);
    const st = { expr: {}, blink: 0, talk: 0, tw: 0, tr: 0, gx: 0, gy: 0, cur: {} };
    const skin = M.skin, lidC = mulC(skin, vr === 'zombie' ? 0.55 : 1), lashC = vr === 'zombie' ? mulC(skin, 0.3) : mixC(c.hair.color, '#141010', 0.75), browC = c.hair.style === 'bald' && c.age !== 'elder' ? C('#3a2a1a') : mixC(M.dirty(c.hair.color), '#101010', c.age === 'elder' ? 0.1 : 0.35);
    const white = vr === 'zombie' ? C('#cfd2a8') : vr === 'ghost' ? C('#f4f8ff') : C('#f1eee8'), iris = C(c.eyes.color), darkIris = lum(iris) < 0.03;
    const lipC = c.lips ? C(c.lips) : f ? mixC(skin, '#a03040', 0.42) : mixC(mulC(skin, 0.8), '#8a3030', 0.18);
    const mouthIn = C('#2a0e12'), teethC = vr === 'zombie' ? C('#c8c096') : C('#f2efe6'), tongue = C('#8a3438');
    let nv = 0, ng = 0, tint = null, tk = 0;
    const put = (x, y, z, cc) => { if (nv >= MAXV) return; pos[nv * 3] = x; pos[nv * 3 + 1] = y; pos[nv * 3 + 2] = z; let r = cc[0], g = cc[1], bb = cc[2]; if (tk > 0) { r = lp(r, tint[0], tk); g = lp(g, tint[1], tk); bb = lp(bb, tint[2], tk); } col[nv * 4] = r; col[nv * 4 + 1] = g; col[nv * 4 + 2] = bb; nv++; };
    const putG = (x, y, z, cc) => { if (ng >= 180) return; glowPos[ng * 3] = x; glowPos[ng * 3 + 1] = y; glowPos[ng * 3 + 2] = z; glowCol[ng * 4] = cc[0]; glowCol[ng * 4 + 1] = cc[1]; glowCol[ng * 4 + 2] = cc[2]; glowCol[ng * 4 + 3] = 1; ng++; };
    // eye-plane point: (u across, + = outward; v up; lift) for side m (+1 left, -1 right)
    const ep = (m, u, v, o, cc, glow) => { const x = (ec[0] + ux[0] * u + uy[0] * v + n[0] * o) * hs * m, y = (ec[1] + ux[1] * u + uy[1] * v + n[1] * o) * hs, z = (ec[2] + ux[2] * u + uy[2] * v + n[2] * o) * hs; if (glow) putG(x, y, z, cc); else put(x, y, z, cc); };
    const etri = (m, p, q, r, o, cc, glow) => { ep(m, p[0], p[1], o, cc, glow); if (m > 0) { ep(m, q[0], q[1], o, cc, glow); ep(m, r[0], r[1], o, cc, glow); } else { ep(m, r[0], r[1], o, cc, glow); ep(m, q[0], q[1], o, cc, glow); } };
    const equad = (m, p, q, r, s, o, cc, glow) => { etri(m, p, q, r, o, cc, glow); etri(m, p, r, s, o, cc, glow); };
    // mouth-plane point: x across, y up (head-local), with the jaw swinging the lower lip
    const r5 = H.rows[4], r6 = H.rows[5], r7 = H.rows[7];
    const mz = (x, y) => { const ax = Math.abs(x), kx = cl(ax / r6[1][0]), zt = lp(r5[0][2], r5[1][2], kx), zm = lp(r6[0][2], r6[1][2], kx), zb = lp(r7[0][2], r7[1][2], kx); const z = y >= r6[0][1] ? lp(zm, zt, cl((y - r6[0][1]) / (r5[0][1] - r6[0][1]))) : lp(zm, zb, cl((r6[0][1] - y) / (r6[0][1] - r7[0][1]))); return z - Math.max(0, ax - r6[1][0]) * 0.9; };
    let jawA = 0;
    const mp = (x, y, o, cc, onJaw) => {
      let z = mz(x, y) + o, yy = y;
      if (onJaw > 0 && jawA !== 0) { const ry = yy - JAWP[1], rz = z - JAWP[2], ca = cos(jawA), sa = sin(jawA), y2 = JAWP[1] + ry * ca - rz * sa, z2 = JAWP[2] + ry * sa + rz * ca; yy = lp(yy, y2, onJaw); z = lp(z, z2, onJaw); }
      put(x * hs, yy * hs, z * hs, cc);
    };
    const mquad = (p, q, r, s, o, cc) => { mp(p[0], p[1], o, cc, p[2]); mp(q[0], q[1], o, cc, q[2]); mp(r[0], r[1], o, cc, r[2]); mp(p[0], p[1], o, cc, p[2]); mp(r[0], r[1], o, cc, r[2]); mp(s[0], s[1], o, cc, s[2]); };

    const EW = vr === 'alien' ? 0.0185 : 0.0152 * (f ? 1.04 : 1), ET = vr === 'alien' ? 0.0125 : 0.0086 * (f ? 1.08 : 1), EB = vr === 'alien' ? 0.0105 : 0.0064, FR = 0.0038, YT = ET * 1.5 + 0.003, YB = -(EB + 0.0045);
    const SX = [-1, -0.5, 0, 0.5, 1], TOPS_ = [0.02, 0.8, 1, 0.82, 0.1], BOTS = [0.02, 0.72, 1, 0.78, 0.1], tiltE = vr === 'alien' ? 0.5 : f ? 0.12 : 0.04;
    function update() {
      nv = 0; ng = 0;
      const X = st.cur, g = k => N(X[k], EDEF[k] || 0);
      const blink = cl(st.blink), dead = vr === 'zombie';
      jawA = cl(g('jaw') + st.talk * 0.2, 0, 0.42);
      A.bones.jaw.quaternion.set(sin(jawA / 2), 0, 0, cos(jawA / 2));
      if (!noFace) {
        for (const m of [1, -1]) {
          const sd = m > 0 ? 'L' : 'R', ew = g('ew'), ul = cl(Math.max(g('ul'), blink)), ll = cl(g('ll')) * (1 - blink * 0.4), lt = g('lt');
          const gx = cl(g('gx') + st.gx * m, -1, 1), gy = cl(g('gy') + st.gy, -1, 1);
          const xs = SX.map(s => s * EW), top = SX.map((s, i) => TOPS_[i] * ET * ew + s * tiltE * 0.004), botm = SX.map((s, i) => -BOTS[i] * EB * lp(1, ew, 0.6) + s * tiltE * 0.004);
          const up = SX.map((s, i) => { let y = lp(top[i], botm[i] + 0.0002, ul) - lt * s * 0.0032 * (1 - ul * 0.6) * (i === 0 || i === 4 ? 0.6 : 1); return Math.min(top[i] + 0.002, Math.max(y, botm[i])); });
          const lo = SX.map((s, i) => Math.min(up[i], lp(botm[i], top[i] * 0.55, ll * 0.62)));
          const glow = c.eyes.glow;
          // white
          equad(m, [-EW, YB], [EW, YB], [EW, YT], [-EW, YT], 0.0006, vr === 'alien' ? C('#0a0c10') : white, false);
          // iris, pupil, highlight
          const ir = (vr === 'alien' ? 0 : 0.0066) * g('ps') * (dead ? 0.8 : 1), icx = gx * 0.0058, icy = gy * 0.0042 - 0.0006 + (ew - 1) * 0.0006;
          if (ir > 0) {
            const oct = []; for (let i = 0; i < 8; i++) { const an = i * PI / 4 + PI / 8; oct.push([icx + cos(an) * ir, icy + sin(an) * ir]); }
            for (let i = 1; i < 7; i++) etri(m, oct[0], oct[i], oct[i + 1], 0.0009, glow ? mulC(iris, 1.6) : iris, glow);
            if (!darkIris && !glow) { const pr = ir * (dead ? 0.3 : 0.5), hx = []; for (let i = 0; i < 6; i++) { const an = i * PI / 3; hx.push([icx + cos(an) * pr, icy + sin(an) * pr]); } for (let i = 1; i < 5; i++) etri(m, hx[0], hx[i], hx[i + 1], 0.0011, C('#0a0808'), false); }
            if (!dead && !glow) { const hx0 = icx - 0.0024 * m, hy0 = icy + 0.0026, hr = 0.0015; equad(m, [hx0 - hr, hy0 - hr], [hx0 + hr, hy0 - hr], [hx0 + hr, hy0 + hr], [hx0 - hr, hy0 + hr], 0.0013, C('#ffffff'), false); }
          } else if (vr === 'alien') { const hx0 = -0.004 * m + gx * 0.002, hy0 = 0.004, hr = 0.0022; equad(m, [hx0 - hr, hy0 - hr * 0.6], [hx0 + hr, hy0 - hr * 0.6], [hx0 + hr, hy0 + hr * 0.6], [hx0 - hr, hy0 + hr * 0.6], 0.0013, C('#5a6a7a'), false); }
          // lids (skin) above and below the opening, and beside it
          const o2 = 0.0016;
          for (let i = 0; i < 4; i++) {
            equad(m, [xs[i], up[i]], [xs[i + 1], up[i + 1]], [xs[i + 1], YT], [xs[i], YT], o2, lidC, false);
            equad(m, [xs[i], YB], [xs[i + 1], YB], [xs[i + 1], lo[i + 1]], [xs[i], lo[i]], o2, lidC, false);
          }
          equad(m, [-EW - FR, YB], [-EW, YB], [-EW, YT], [-EW - FR, YT], o2, lidC, false);
          equad(m, [EW, YB], [EW + FR, YB], [EW + FR, YT], [EW, YT], o2, lidC, false);
          // lash line along the upper lid (and a fine line under the eye)
          const lw = (f ? 0.0026 : 0.0017) * (vr === 'alien' ? 0 : 1);
          if (lw > 0) for (let i = 0; i < 4; i++) { const w0 = lw * (i === 0 ? 0.5 : 1), w1 = lw * (i === 3 ? (f ? 1.5 : 0.7) : 1); equad(m, [xs[i], up[i] - 0.0002], [xs[i + 1], up[i + 1] - 0.0002], [xs[i + 1] + (i === 3 && f ? 0.0025 : 0), up[i + 1] + w1 + (i === 3 && f ? 0.0012 : 0)], [xs[i], up[i] + w0], 0.0019, lashC, false); }
          if (vr !== 'alien') for (let i = 1; i < 3; i++) equad(m, [xs[i], lo[i] - 0.0009], [xs[i + 1], lo[i + 1] - 0.0009], [xs[i + 1], lo[i + 1]], [xs[i], lo[i]], 0.0019, mulC(skin, dead ? 0.35 : 0.72), false);
          // brow
          if (vr !== 'alien' && vr !== 'zombie' + 'x') {
            const bi = g('bi') + g('bi' + sd), bo = g('bo') + g('bo' + sd), by = YT + 0.0058 + (f ? 0.001 : 0), th = f ? 0.0034 : 0.0048;
            const P0 = [-EW * 1.02, by + bi - 0.0006], P1 = [EW * 0.1, by + (bi + bo) * 0.5 + 0.0022], P2 = [EW * 1.12, by + bo - 0.0002];
            equad(m, [P0[0], P0[1] - th * 0.5], [P1[0], P1[1] - th * 0.5], [P1[0], P1[1] + th * 0.5], [P0[0], P0[1] + th * 0.55], 0.0021, browC, false);
            equad(m, [P1[0], P1[1] - th * 0.5], [P2[0], P2[1] - th * 0.12], [P2[0], P2[1] + th * 0.2], [P1[0], P1[1] + th * 0.5], 0.0021, browC, false);
          }
        }
        // ---- mouth ----
        const mw = 0.0215 * g('mw') * (1 - st.tr * 0.25) * (vr === 'alien' ? 0.55 : 1), mc = g('mc'), y0 = r6[0][1] + 0.0015, lpt = cl(g('lpt') + st.talk * 0.25), teeth = cl(g('teeth') + st.talk * 0.6);
        const gapJ = jawA * 0.115, MS = [-1, -0.5, 0, 0.5, 1];
        const cr = s => (s < 0 ? mc + g('mcR') : mc + g('mcL')) * s * s;     // corners (s = -1 is the character's right)
        const yu = MS.map(s => y0 + cr(s) + lpt * 0.0022 * (1 - s * s)), shape = MS.map(s => Math.pow(1 - s * s, 0.6));
        const lowOpen = MS.map((s, i) => lpt * 0.003 * shape[i]);
        const line = 0.0012 + (vr === 'alien' ? -0.0004 : 0);
        // points of the lower lip edge: at rest on the lip line, travelling with the jaw in the middle
        const lowPt = (i, extra) => [MS[i] * mw, y0 + cr(MS[i]) - line * 2 * (i === 0 || i === 4 ? 0.4 : 1) - lowOpen[i] - extra, shape[i]];
        const upPt = (i, extra) => [MS[i] * mw, yu[i] + extra, 0];
        const o3 = 0.0012;
        for (let i = 0; i < 4; i++) mquad(lowPt(i, 0), lowPt(i + 1, 0), upPt(i + 1, 0), upPt(i, 0), o3, mouthIn);
        if (teeth > 0.05 && (gapJ + lpt * 0.005) > 0.0025) {
          const th = Math.min(0.0058, (gapJ + lpt * 0.005) * 0.5) * teeth;
          for (let i = 0; i < 4; i++) { const a0 = upPt(i, 0), a1 = upPt(i + 1, 0), w0 = shape[i] * 0.999, w1 = shape[i + 1] * 0.999; mquad([a0[0] * 0.92, a0[1] - th * w0, 0], [a1[0] * 0.92, a1[1] - th * w1, 0], [a1[0] * 0.92, a1[1], 0], [a0[0] * 0.92, a0[1], 0], o3 + 0.0003, teethC); }
          if (g('lpt') > 0.5 || gapJ > 0.016) for (let i = 0; i < 4; i++) { const a0 = lowPt(i, 0), a1 = lowPt(i + 1, 0), w0 = shape[i], w1 = shape[i + 1], t2 = th * 0.8; mquad([a0[0] * 0.9, a0[1], a0[2]], [a1[0] * 0.9, a1[1], a1[2]], [a1[0] * 0.9, a1[1] + t2 * w1, a1[2]], [a0[0] * 0.9, a0[1] + t2 * w0, a0[2]], o3 + 0.0003, g('lpt') > 0.5 ? teethC : tongue); }
        }
        // lips: a thin upper lip and a fuller lower lip
        if (vr !== 'alien') {
          const ulh = f || c.lips ? 0.0028 : 0.0012, llh = f || c.lips ? 0.0048 : 0.0036;
          for (let i = 0; i < 4; i++) {
            mquad(upPt(i, 0), upPt(i + 1, 0), upPt(i + 1, ulh * shape[i + 1]), upPt(i, ulh * shape[i]), o3 + 0.0002, f || c.lips ? lipC : mulC(skin, 0.86));
            const b0 = lowPt(i, 0), b1 = lowPt(i + 1, 0), c0 = lowPt(i, llh * shape[i]), c1 = lowPt(i + 1, llh * shape[i + 1]);
            mquad(c0, c1, b1, b0, o3 + 0.0002, lipC);
          }
        }
      } else if (vr === 'robot' || vr === 'shadow') {
        // glowing eyes only
        for (const m of [1, -1]) {
          const ul = cl(Math.max(g('ul'), blink)), lt = g('lt'), w = vr === 'robot' ? 0.012 : 0.0115, h = (vr === 'robot' ? 0.0075 : 0.006) * g('ew') * (1 - ul * 0.92), gx = cl(g('gx') + st.gx * m, -1, 1) * 0.003;
          const ec2 = mulC(C(c.eyes.color), 1.7);
          equad(m, [-w + gx, -h], [w + gx, -h - lt * 0.002], [w + gx, h - lt * 0.004], [-w + gx, h + lt * 0.003], 0.003, ec2, true);
        }
        if (vr === 'robot') { const hh = 0.0015 + st.talk * 0.009, cc = mulC(C(c.eyes.color), 1.4); for (let i = -2; i <= 2; i++) { const x = i * 0.0075, k = 1 - Math.abs(i) * 0.25, z = (r6[0][2] + 0.004) * hs; const y = (r6[0][1] - 0.004) * hs; putG((x - 0.0026) * hs, y - hh * k, z, cc); putG((x + 0.0026) * hs, y - hh * k, z, cc); putG((x + 0.0026) * hs, y + hh * k, z, cc); putG((x - 0.0026) * hs, y - hh * k, z, cc); putG((x + 0.0026) * hs, y + hh * k, z, cc); putG((x - 0.0026) * hs, y + hh * k, z, cc); } }
      }
      geo.setDrawRange(0, nv); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      ggeo.setDrawRange(0, ng); ggeo.attributes.position.needsUpdate = true; ggeo.attributes.color.needsUpdate = true;
      mesh.visible = nv > 0; gmesh.visible = ng > 0;
    }
    function setExpr(name, k) {
      const cur = {};
      const add = (nm, w) => { const E = EXPR[nm] || EXPR.neutral; for (const key of EKEYS) { const dflt = EDEF[key] || 0, v = E[key] !== undefined ? E[key] : dflt; cur[key] = (cur[key] !== undefined ? cur[key] : dflt) + (v - dflt) * w; } };
      if (name && typeof name === 'object') { for (const nm in name) add(nm, N(name[nm])); } else add(name, cl(N(k, 1), 0, 1.5));
      st.cur = cur;
    }
    return { st, update, setExpr, mesh, gmesh, setTint: (t, k) => { tint = t; tk = k; } };
  }

  // =====================================================================================================
  // 7. the actor
  // =====================================================================================================
  const IDENT = new T.Matrix4();
  const _w1 = new T.Vector3(), _w2 = new T.Vector3(), _wq = new T.Quaternion(), _wq2 = new T.Quaternion(), _wm = new T.Matrix4();
  let _uid = 0;

  function make(cfg) {
    const c = normCfg(cfg), A = { cfg: c, id: ++_uid };
    const root = new T.Group(), rig = new T.Group(); root.add(rig); rig.scale.setScalar(c.height / 1.75); root.name = 'ActorA' + A.id;
    // bones
    const bones = {}, list = [], inv = [];
    const M = buildCharacter(c);
    for (const n of BONES) {
      const r = REST[n], b = new T.Bone(); b.name = n; let x = r.x;
      if (n === 'armL' || n === 'armR') x = (M.D.shx - 0.035) * (x < 0 ? -1 : 1);
      b.position.set(x, r.y, r.z); bones[n] = b; list.push(b);
      if (r.parent) bones[r.parent].add(b); else rig.add(b);
    }
    for (const n of BONES) { let ax = 0, ay = 0, az = 0, q = bones[n]; while (q && q.isBone) { ax += q.position.x; ay += q.position.y; az += q.position.z; q = q.parent; } inv.push(new T.Matrix4().makeTranslation(-ax, -ay, -az)); bones[n].userData.rest = [ax, ay, az]; }
    const skeleton = new T.Skeleton(list, inv);
    A.root = root; A.rig = rig; A.bones = bones; A.skeleton = skeleton; A.scale = c.height / 1.75;
    buildHead(c, M); buildHair(c, M);
    // materials (per actor, so that opacity and tint are independent)
    const ghost = c.variant === 'ghost', shadow = c.variant === 'shadow';
    const std = o => new T.MeshStandardMaterial(Object.assign({ vertexColors: true, flatShading: true, roughness: 0.86, metalness: 0, side: T.DoubleSide }, o));
    const mats = A.mats = {
      main: shadow ? new T.MeshBasicMaterial({ color: 0x000000, side: T.DoubleSide }) : std({}),
      metal: std({ roughness: 0.42, metalness: 0.62 }), gloss: std({ roughness: 0.28, metalness: 0.12 }),
      glow: new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: T.DoubleSide }),
      glass: std({ transparent: true, opacity: 0.3, roughness: 0.12, metalness: 0.25, depthWrite: false }),
      sheer: std({ transparent: true, opacity: 0.62, depthWrite: false }),
      face: std({ polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, depthWrite: false, side: T.FrontSide }),
      faceGlow: new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, depthWrite: false }),
    };
    if (ghost) { mats.main.emissive = new T.Color('#9fc4ff'); mats.main.emissiveIntensity = 0.22; }
    A.meshes = []; A.tris = 0; A._base = {};
    for (const name in M.G.buckets) {
      const B = M.G.buckets[name]; if (!B.n) continue;
      const geo = new T.BufferGeometry(), pos = new Float32Array(B.pos), nrm = new Float32Array(B.pos.length);
      for (let i = 0; i < pos.length; i += 9) {
        const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2], vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        for (let k = 0; k < 9; k += 3) { nrm[i + k] = nx; nrm[i + k + 1] = ny; nrm[i + k + 2] = nz; }
      }
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nrm, 3));
      geo.setAttribute('color', new T.BufferAttribute(new Float32Array(B.col), 4));
      geo.setAttribute('skinIndex', new T.BufferAttribute(new Uint16Array(B.si), 4)); geo.setAttribute('skinWeight', new T.BufferAttribute(new Float32Array(B.sw), 4));
      const mesh = new T.SkinnedMesh(geo, mats[name] || mats.main); mesh.bind(skeleton, IDENT); mesh.frustumCulled = false;
      const lit = name !== 'glow' && name !== 'glass' && name !== 'sheer';
      mesh.castShadow = lit && !ghost; mesh.receiveShadow = lit; mesh.name = name; if (!lit) mesh.renderOrder = 4;
      rig.add(mesh); A.meshes.push(mesh); A.tris += B.n; A._base[name] = new Float32Array(B.col);
    }
    A.face_ = makeFace(A, c, M);
    A.face_.setExpr(c.variant === 'zombie' ? 'dead' : 'neutral', 1);
    A.traits = { armOut: M.D.armOut, shx: M.D.shx, seed: c.seed, variant: c.variant, elder: c.age === 'elder', f: c.shape === 'f', build: c.build };
    // grip anchors: a held prop's +Y points out of the thumb side of the fist, +Z along the fingers of an open hand
    A.grips = {};
    for (const s of SIDES) { const g = new T.Group(); g.position.set((s === 'L' ? -1 : 1) * 0.018 * M.D.hand, -0.085 * M.D.hand, 0.008); g.rotation.set(HPI, 0, 0); bones['hand' + s].add(g); A.grips[s] = g; }
    A._held = { L: null, R: null }; A._minGrip = { L: 0, R: 0 };
    A._pose = {}; A._op = 1; A._tint = null;

    // ---- API ----
    A.place = (x, y, z, heading) => { if (Array.isArray(x)) { heading = y; z = x[2]; y = x[1]; x = x[0]; } root.position.set(N(x), N(y), N(z)); root.rotation.set(0, N(heading), 0); return A; };
    A.pose = p => { applyPose(A, p || {}); return A; };
    A.anim = (clip, time, opts) => {
      const p = evalClip(clip, time, opts, A);
      applyPose(A, p); frameReset(A, N(time)); return A;
    };
    A.mix = list => {
      let acc = null, wsum = 0, t0 = 0; const layers = [];
      for (const it of list || []) {
        if (!it) continue; const w = N(it[2], 1); if (w <= 0) continue;
        const o = it[3] || {}, p = evalClip(it[0], it[1], o, A); t0 = N(it[1]);
        if (o.mask) { layers.push([p, w, o.mask]); continue; }
        if (!acc) { acc = Object.assign({}, p); wsum = w; } else { wsum += w; acc = lerpPose(acc, p, w / wsum); }
      }
      if (!acc) acc = evalClip('idle', t0, {}, A);
      for (const L of layers) maskBlend(acc, L[0], cl(L[1]), L[2]);
      solveLegs(acc);
      applyPose(A, acc); frameReset(A, t0); return A;
    };
    A.lookAt = (pt, weight = 1, o) => { lookAt(A, pt, weight, o); return A; };
    A.face = (expr, k = 1) => { A.face_.setExpr(expr, k); A.face_.update(); return A; };
    A.blink = time => { A.face_.st.blink = blinkAt(N(time), c.seed); A.face_.update(); return A; };
    A.talk = (time, amount = 1) => { const tv = talkAt(N(time), c.seed), am = cl(N(amount, 1), 0, 1.5); A.face_.st.talk = tv[0] * am; A.face_.st.tr = tv[1] * am; A.face_.update(); return A; };
    A.hold = (obj, hand = 'R', o) => {
      const s = hand === 'L' ? 'L' : 'R', g = A.grips[s], old = A._held[s];
      if (old && old !== obj && old.parent === g) g.remove(old);
      A._held[s] = obj || null; A._minGrip[s] = obj ? N(o && o.grip, 0.8) : 0;
      if (obj) { if (obj.parent !== g) g.add(obj); const ps = (o && o.pos) || [0, 0, 0], rt = (o && o.rot) || [0, 0, 0]; obj.position.set(N(ps[0]), N(ps[1]), N(ps[2])); obj.rotation.set(N(rt[0]), N(rt[1]), N(rt[2])); }
      applyHands(A); return A;
    };
    A.joint = name => (name === 'handL' ? A.grips.L : name === 'handR' ? A.grips.R : name === 'eyes' ? A.eyeAnchor : bones[name] || bones.hips);
    A.opacity = k => { setOpacity(A, cl(N(k, 1))); return A; };
    A.tint = (color, k) => { setTint(A, color, cl(N(k, color ? 1 : 0))); return A; };
    A.eyeAnchor = new T.Group(); A.eyeAnchor.position.set(0, 0.078 * M.head.hsc, 0.09 * M.head.hsc); bones.head.add(A.eyeAnchor);
    A.worldPos = (name, out) => { const j = A.joint(name); j.updateWorldMatrix(true, false); return (out || new T.Vector3()).setFromMatrixPosition(j.matrixWorld); };
    A.anim('idle', 0);
    return A;
  }

  function applyPose(A, p) {
    const b = A.bones; A._pose = p;
    for (let i = 0; i < BONES.length; i++) { const n = BONES[i]; if (n === 'jaw') continue; jointQ(n, p, b[n].quaternion); }
    const r = REST.hips; b.hips.position.set(r.x + N(p.dx), r.y + N(p.dy), r.z + N(p.dz));
    applyHands(A);
  }
  const _hp = {};
  function applyHands(A) {
    for (const s of SIDES) {
      const mg = A._minGrip[s]; if (!(mg > 0)) continue;
      _hp['grip' + s] = Math.max(N(A._pose['grip' + s]), mg); _hp['point' + s] = 0; _hp['thumb' + s] = 0;
      for (const n of ['mitt1', 'mitt2', 'idx1', 'idx2', 'thumb']) jointQ(n + s, _hp, A.bones[n + s].quaternion);
    }
  }
  const MASKS = {};
  {
    const arm = s => ['shrug' + s, 'shFwd' + s, 'arm' + s + 'x', 'arm' + s + 'y', 'arm' + s + 'z', 'elbow' + s, 'hand' + s + 'x', 'hand' + s + 'y', 'hand' + s + 'z', 'grip' + s, 'point' + s, 'thumb' + s];
    const head = ['neckX', 'neckY', 'neckZ', 'headX', 'headY', 'headZ'], torso = ['spineX', 'spineY', 'spineZ', 'chestX', 'chestY', 'chestZ'];
    const leg = s => ['leg' + s + 'x', 'leg' + s + 'y', 'leg' + s + 'z', 'knee' + s, 'foot' + s + 'x', 'foot' + s + 'y', 'foot' + s + 'z', 'toe' + s, 'ik' + s, 'f' + s + 'x', 'f' + s + 'y', 'f' + s + 'z', 'f' + s + 'p', 'f' + s + 'h', 'f' + s + 'r', 'f' + s + 'k'];
    MASKS.armL = arm('L'); MASKS.armR = arm('R'); MASKS.arms = MASKS.armL.concat(MASKS.armR); MASKS.head = head; MASKS.torso = torso;
    MASKS.upper = MASKS.arms.concat(head, torso); MASKS.legs = leg('L').concat(leg('R')); MASKS.lower = MASKS.legs.concat(['dx', 'dy', 'dz', 'hipsX', 'hipsY', 'hipsZ']);
    MASKS.armsHead = MASKS.arms.concat(head); MASKS.armLHead = MASKS.armL.concat(head); MASKS.armRHead = MASKS.armR.concat(head);
  }
  function maskBlend(base, over, w, mask) {
    const keys = Array.isArray(mask) ? mask : (MASKS[mask] || MASKS.upper);
    for (const k of keys) base[k] = lp(N(base[k]), N(over[k]), w);
    return base;
  }
  function frameReset(A, time) {
    const F = A.face_; F.st.talk = 0; F.st.tr = 0; F.st.gx = 0; F.st.gy = 0;
    F.st.blink = A.cfg.autoBlink ? blinkAt(time, A.cfg.seed) : 0; F.update();
  }
  /** eyelid closure 0..1 at `time`: natural irregular blinking (every 2-6 s, 0.16 s each, the odd double blink) */
  function blinkAt(time, seed = 1) {
    const per = 3.1, t = time + hash(seed, 9) * per, i = Math.floor(t / per), u = t - i * per, at = 0.4 + hash(i, seed + 2) * (per - 1.1), dbl = hash(i, seed + 5) > 0.78;
    const one = x => (x < 0 || x > 0.17 ? 0 : x < 0.06 ? sm(x / 0.06) : 1 - sm((x - 0.06) / 0.11));
    return Math.max(one(u - at), dbl ? one(u - at - 0.3) : 0);
  }
  /** [mouth opening 0..1, roundness 0..1] at `time`: syllables at about 5 per second with word gaps */
  function talkAt(time, seed = 1) {
    const t = time * 5.3 + seed * 3.7, i = Math.floor(t), u = t - i, on = hash(Math.floor(t / 7 + 0.3), seed + 11) > 0.16 || (i % 7) < 5 ? 1 : 0;
    const amp = (0.45 + 0.55 * hash(i, seed + 1)) * (hash(i, seed + 4) > 0.14 ? 1 : 0.15), prev = (0.45 + 0.55 * hash(i - 1, seed + 1)) * (hash(i - 1, seed + 4) > 0.14 ? 1 : 0.15);
    const env = sin(PI * u) ** 0.8, open = on * (env * amp * 0.85 + (1 - u) * prev * 0.12 + 0.06);
    return [cl(open), cl(0.5 + 0.5 * noise(t * 0.5, seed + 7))];
  }

  // ---- look at -----------------------------------------------------------------------------------------
  const _lp = {};
  function lookAt(A, pt, weight, o) {
    if (!pt) return; const w = cl(N(weight, 1)), b = A.bones, p = A._pose;
    const tx = pt.isVector3 ? pt.x : N(pt[0]), ty = pt.isVector3 ? pt.y : N(pt[1]), tz = pt.isVector3 ? pt.z : N(pt[2]);
    // direction to the target in the chest frame
    b.neck.updateWorldMatrix(true, false); b.chest.matrixWorld.decompose(_w1, _wq, _w2);
    A.eyeAnchor.updateWorldMatrix(true, false); _w1.setFromMatrixPosition(A.eyeAnchor.matrixWorld);
    _w2.set(tx, ty, tz).sub(_w1); if (_w2.lengthSq() < 1e-8) return; _w2.normalize().applyQuaternion(_wq.invert());
    const yt = Math.atan2(_w2.x, _w2.z), pt2 = -Math.asin(cl(_w2.y, -1, 1));
    // current head direction in the chest frame
    jointQ('neck', p, _wq); jointQ('head', p, _wq2); _wq.multiply(_wq2); _w1.set(0, 0, 1).applyQuaternion(_wq);
    const yc = Math.atan2(_w1.x, _w1.z), pc = -Math.asin(cl(_w1.y, -1, 1));
    const hw = w * N(o && o.head, 1), yl = cl(yt, -1.45, 1.45), pl = cl(pt2, -0.75, 0.8);
    const dy = (yl - yc) * hw, dp = (pl - pc) * hw;
    for (const k in _lp) delete _lp[k]; Object.assign(_lp, p);
    _lp.chestY = N(p.chestY) + dy * 0.16; _lp.neckY = N(p.neckY) + dy * 0.32; _lp.headY = N(p.headY) + dy * 0.52;
    _lp.chestX = N(p.chestX) + dp * 0.08; _lp.neckX = N(p.neckX) + dp * 0.34; _lp.headX = N(p.headX) + dp * 0.58;
    _lp.headZ = N(p.headZ) - dy * 0.06;
    jointQ('chest', _lp, b.chest.quaternion); jointQ('neck', _lp, b.neck.quaternion); jointQ('head', _lp, b.head.quaternion);
    // eyes take up what the head does not
    const ew = w * N(o && o.eyes, 1), ry = yt - (yc + dy), rp = pt2 - (pc + dp);
    A.face_.st.gx = cl(ry / 0.6, -1, 1) * ew; A.face_.st.gy = cl(-rp / 0.5, -1, 1) * ew; A.face_.update();
  }

  // ---- opacity and tint --------------------------------------------------------------------------------
  function setOpacity(A, k) {
    if (A._op === k && A._opInit) return; A._op = k; A._opInit = true;
    const ghost = A.cfg.variant === 'ghost', base = ghost ? 0.62 : 1, kk = k * base, tr = kk < 0.999;
    for (const n of ['main', 'metal', 'gloss', 'glow', 'face', 'faceGlow']) { const m = A.mats[n]; m.transparent = tr || (n === 'face' || n === 'faceGlow') && false; m.opacity = kk; m.depthWrite = n === 'face' || n === 'faceGlow' ? false : !tr; m.needsUpdate = true; }
    A.mats.glass.opacity = 0.3 * k; A.mats.sheer.opacity = 0.62 * k;
    // depth pre-pass twins so that a faded character shows only its outer surface
    if (tr && !A._twins) {
      A._twins = []; const dm = new T.MeshBasicMaterial({ colorWrite: false, side: T.DoubleSide });
      for (const m of A.meshes) { if (m.name === 'glow' || m.name === 'glass' || m.name === 'sheer') continue; const tw = new T.SkinnedMesh(m.geometry, dm); tw.bind(A.skeleton, IDENT); tw.frustumCulled = false; tw.renderOrder = 900; tw.castShadow = false; A.rig.add(tw); A._twins.push(tw); m.renderOrder = 1; }
    }
    if (A._twins) for (const tw of A._twins) tw.visible = tr && kk > 0.02;
    for (const m of A.meshes) { if (m.name === 'main' || m.name === 'metal' || m.name === 'gloss') m.castShadow = !ghost && kk > 0.5; m.visible = kk > 0.004; }
    A.face_.mesh.material.transparent = tr; A.face_.gmesh.material.transparent = tr;
    A.root.visible = k > 0.004;
  }
  function setTint(A, color, k) {
    const key = k > 0 ? color + '|' + k.toFixed(3) : ''; if (A._tintKey === key) return; A._tintKey = key;
    const t = k > 0 ? C(color) : null;
    for (const m of A.meshes) {
      const base = A._base[m.name], at = m.geometry.attributes.color, arr = at.array;
      if (!t) arr.set(base); else for (let i = 0; i < arr.length; i += 4) { arr[i] = lp(base[i], t[0], k); arr[i + 1] = lp(base[i + 1], t[1], k); arr[i + 2] = lp(base[i + 2], t[2], k); }
      at.needsUpdate = true;
    }
    A.face_.setTint(t, k); A.face_.update();
  }

  // =====================================================================================================
  // 8. clips
  // =====================================================================================================
  const clips = {};
  const NEUTRAL = { armOut: 0.085, shx: SHX, seed: 1, variant: 'human', elder: false, f: false, build: 'average' };
  function evalClip(clip, time, opts, A) {
    const o = Object.assign({}, opts || {}); o._a = A ? A.traits : (o._a || NEUTRAL);
    if (A && o.target) { _w1.set(N(o.target[0]), N(o.target[1]), N(o.target[2])); A.rig.updateWorldMatrix(true, false); _wm.copy(A.rig.matrixWorld).invert(); _w1.applyMatrix4(_wm); o.local = [_w1.x, _w1.y, _w1.z]; }
    let fn = typeof clip === 'function' ? clip : clips[clip]; if (!fn) fn = clips.idle;
    let t = N(time) * N(o.speed, 1);
    let p = fn(t, o) || {};
    if (o.mirror) p = mirrorPose(p);
    return p;
  }
  function addClip(name, fn) { if (typeof fn === 'function') clips[name] = fn; return fn; }

  /** standing base pose: soft knees, relaxed arms, feet planted (directives set, legs not yet solved) */
  function stand(o) {
    const a = (o && o._a) || NEUTRAL, ao = a.armOut;
    const p = {
      dy: -0.012, armLz: ao, armRz: ao, armLx: -0.02, armRx: -0.02, armLy: 0.12, armRy: 0.12, elbowL: 0.24, elbowR: 0.24, gripL: 0.32, gripR: 0.32, handLz: 0.05, handRz: 0.05,
      ikL: 1, ikR: 1, fLx: 0.098, fLy: ANK, fLz: 0, fLh: 0.16, fRx: -0.098, fRy: ANK, fRz: 0, fRh: -0.16,
    };
    if (a.elder) { p.spineX = 0.1; p.chestX = 0.16; p.neckX = -0.04; p.headX = -0.12; p.dy = -0.03; p.shFwdL = 0.12; p.shFwdR = 0.12; p.dz = -0.02; }
    return p;
  }
  /** finish a pose: solve the planted feet */
  function fin(p) { reachFix(p); return solveLegs(p); }
  function breathe(p, t, a, k = 1) {
    const ph = t * 1.55 + N(a && a.seed) * 2.1, br = (sin(ph) + 0.3 * sin(2 * ph + 0.6)) * k;
    p.chestX = N(p.chestX) - 0.012 * br; p.spineX = N(p.spineX) + 0.005 * br; p.shrugL = N(p.shrugL) + 0.012 * br; p.shrugR = N(p.shrugR) + 0.012 * br; p.neckX = N(p.neckX) + 0.006 * br;
    return p;
  }

  clips.idle = (t, o) => {
    const a = o._a || NEUTRAL, sd = a.seed * 1.37, p = stand(o), k = N(o.intensity, 1);
    const ws = noise(t * 0.13 + 3.1, sd) * k, w2 = noise(t * 0.31 + 9.2, sd + 4) * k;       // slow weight shift
    p.dx = 0.024 * ws + 0.004 * w2; p.dz = N(p.dz) + 0.006 * noise(t * 0.21, sd + 2);
    p.hipsZ = -0.035 * ws; p.spineZ = 0.022 * ws; p.chestZ = 0.012 * ws; p.hipsY = 0.03 * w2; p.chestY = -0.02 * w2;
    p.neckZ = -0.006 * ws; p.headY = 0.07 * noise(t * 0.17 + 1.7, sd + 6) * k; p.headX = N(p.headX) + 0.025 * noise(t * 0.23 + 5, sd + 7) * k; p.headZ = 0.02 * noise(t * 0.11, sd + 8);
    breathe(p, t, a);
    const sw = noise(t * 0.4 + 2, sd + 9) * 0.03;
    p.armLx += sw + 0.02 * ws; p.armRx += -sw * 0.6 - 0.02 * ws; p.elbowL += 0.03 * noise(t * 0.3, sd + 10); p.elbowR += 0.03 * noise(t * 0.27, sd + 11);
    return fin(p);
  };

  /** Blend the upper body of `over` onto a base clip (opts.base, default idle). */
  function acting(name, fn, mask = 'upper', defBase = 'idle') {
    clips[name] = (t, o) => {
      const bn = o.base || defBase, base = (clips[bn] && bn !== name ? clips[bn] : clips.idle)(t, o), p = fn(t, o, base);
      return p;
    };
  }

  return { make, clips, addClip, lerpPose, mirrorPose, walk: null, legIK, armIK, armTo, aimHand, solveLegs, stand, jointQ, frame, REST, BONES, EXPR, _dbg: { evalClip, blinkAt, talkAt, noise, hash } };
})();
