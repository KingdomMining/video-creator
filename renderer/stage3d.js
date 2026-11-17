// stage3d.js - low-poly 3D stage on top of three.js (global THREE, r160). Loaded after scenes.js.
// A film registers shots with S3.shot(name, {build, update, overlay}). Each shot owns a THREE.Scene.
// EVERYTHING IS A PURE FUNCTION OF TIME: update(s, lt, ...) must set the whole state from `lt` (seconds since
// the shot started). Never accumulate state between frames - frames are rendered out of order for previews.
// Units: metres. Y is up. Ground is y = 0. Characters face +Z by default. Full reference: docs/STAGE3D.md
const S3 = (() => {
  const T = THREE;
  const V = a => (a && a.isVector3) ? a.clone() : new T.Vector3(a[0], a[1], a[2]);
  let renderer = null, glc = null;
  const defs = {}, live = new Map();

  // ---------- chainable sugar on every Object3D ----------
  const P3 = T.Object3D.prototype;
  P3.at = function (x, y, z) { if (Array.isArray(x)) this.position.set(x[0], x[1], x[2]); else this.position.set(x, y, z); return this; };
  P3.rot = function (x, y, z) { this.rotation.set(x || 0, y || 0, z || 0); return this; };
  P3.scl = function (x, y, z) { if (y === undefined) this.scale.setScalar(x); else this.scale.set(x, y, z); return this; };
  P3.to = function (parent) { parent.add(this); return this; };
  P3.named = function (n) { this.name = n; return this; };
  P3.noShadow = function () { this.traverse(o => { o.castShadow = false; o.receiveShadow = false; }); return this; };
  P3.shadows = function (cast = true, receive = true) { this.traverse(o => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } }); return this; };

  // ---------- deterministic noise ----------
  const hash1 = (n, seed = 0) => { const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); };
  /** Smooth 1D value noise in [-1, 1]. Use for camera shake, flicker, sway. */
  const noise1 = (x, seed = 0) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u) * 2 - 1; };
  /** Smooth 2D value noise in [0, 1]. Use for terrain. */
  const noise2 = (x, z, seed = 0) => { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf); const h = (a, b) => hash1(a * 57 + b * 131, seed); return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v; };
  /** Flicker multiplier around 1 for lamps and fire (amount 0..1). */
  const flicker = (t, amount = 0.2, speed = 9, seed = 0) => 1 + amount * (0.6 * noise1(t * speed, seed) + 0.4 * noise1(t * speed * 2.7, seed + 5));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  /** 0 before a, 1 after b, smooth in between: the basic tool for timing actions. */
  const ramp = (x, a, b) => smooth((x - a) / (b - a));
  /** 0 -> 1 -> 0 pulse: rises from a to b, holds, falls from c to d. */
  const pulse = (x, a, b, c, d) => ramp(x, a, b) * (1 - ramp(x, c, d));

  // ---------- materials ----------
  const _mats = new Map();
  /** Flat-shaded standard material, cached. o: {rough, metal, emissive, ei, opacity, side:'double'|'back', vc, flat:false, basic:true (unlit), blend:'add', own:true (private copy you may animate)} */
  function mat(color, o = {}) {
    if (color && color.isMaterial) return color;
    const key = [color, o.rough, o.metal, o.emissive, o.ei, o.opacity, o.side, o.vc, o.flat, o.basic, o.fog, o.blend, o.depthWrite].join('|');
    if (!o.own && _mats.has(key)) return _mats.get(key);
    let m;
    if (o.basic) m = new T.MeshBasicMaterial({ color, toneMapped: false, fog: o.fog !== false });
    else m = new T.MeshStandardMaterial({ color, flatShading: o.flat !== false, roughness: o.rough ?? 0.9, metalness: o.metal ?? 0, emissive: o.emissive || 0x000000, emissiveIntensity: o.ei ?? 1 });
    if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = o.depthWrite ?? false; }
    if (o.side === 'double') m.side = T.DoubleSide; else if (o.side === 'back') m.side = T.BackSide;
    if (o.vc) m.vertexColors = true;
    if (o.blend === 'add') { m.blending = T.AdditiveBlending; m.transparent = true; m.depthWrite = false; }
    if (!o.own) _mats.set(key, m);
    return m;
  }
  /** Unlit glowing material (lamps, screens, eyes, fire). k > 1 blooms harder. o: {opacity, blend:'add', side:'double'}. Not cached: you may animate its .color / .opacity. */
  const glow = (color, k = 1, o = {}) => { const m = new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(k), toneMapped: false, fog: o.fog !== false }); if (o.opacity != null && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; } if (o.blend === 'add') { m.blending = T.AdditiveBlending; m.transparent = true; m.depthWrite = false; } if (o.side === 'double') m.side = T.DoubleSide; return m; };

  // ---------- geometry helpers ----------
  /** Per-face brightness variation (the low-poly look). Returns non-indexed geometry with a colour attribute. */
  function vary(geo, amount = 0.08, seed = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count, col = new Float32Array(n * 3), r = rng(seed * 9973 + 7);
    for (let i = 0; i < n; i += 3) { const k = 1 + (r() - 0.5) * 2 * amount; for (let j = 0; j < 9; j++) col[i * 3 + j] = k; }
    g.setAttribute('color', new T.BufferAttribute(col, 3)); return g;
  }
  /** Displace vertices randomly (coincident vertices move together, so the mesh stays closed). */
  function jitter(geo, amt, seed = 0) {
    const p = geo.attributes.position, h = (x, y, z, k) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.19 + seed * 7.77) * 43758.5453; return (s - Math.floor(s)) - 0.5; };
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rx = Math.round(x * 500) / 500, ry = Math.round(y * 500) / 500, rz = Math.round(z * 500) / 500; p.setXYZ(i, x + h(rx, ry, rz, 1) * 2 * amt, y + h(rx, ry, rz, 2) * 2 * amt, z + h(rx, ry, rz, 3) * 2 * amt); }
    p.needsUpdate = true; geo.computeVertexNormals(); return geo;
  }
  /** Wrap a geometry in a shadow-casting mesh. o: material options plus {vary, seed, jitter, shadow:false}. `col` may be a Material. */
  function mesh(geo, col, o = {}) {
    if (o.jitter) geo = jitter(geo, o.jitter, o.seed || 0);
    if (o.vary) geo = vary(geo, o.vary, o.seed || 1);
    const m = new T.Mesh(geo, col && col.isMaterial ? col : mat(col, o.vary ? { ...o, vc: true } : o));
    const lit = !(col && col.isMaterial ? col.isMeshBasicMaterial : o.basic), solid = !(o.opacity < 1);
    m.castShadow = o.shadow !== false && lit && solid; m.receiveShadow = o.shadow !== false && lit; return m;
  }
  const lift = (g, h) => g.translate(0, h / 2, 0);
  /** Box centred on its origin. */
  const box = (w, h, d, col, o) => mesh(new T.BoxGeometry(w, h, d), col, o);
  /** Box standing on its origin (y from 0 to h): use for anything that sits on the ground. */
  const boxB = (w, h, d, col, o) => mesh(lift(new T.BoxGeometry(w, h, d), h), col, o);
  /** Cylinder / tapered prism. seg = sides (4-8 reads as low-poly). */
  const cyl = (rTop, rBot, h, seg, col, o) => mesh(new T.CylinderGeometry(rTop, rBot, h, seg || 6), col, o);
  const cylB = (rTop, rBot, h, seg, col, o) => mesh(lift(new T.CylinderGeometry(rTop, rBot, h, seg || 6), h), col, o);
  const cone = (r, h, seg, col, o) => mesh(new T.ConeGeometry(r, h, seg || 6), col, o);
  const coneB = (r, h, seg, col, o) => mesh(lift(new T.ConeGeometry(r, h, seg || 6), h), col, o);
  /** Low-poly sphere (icosahedron). detail 0 = 20 faces, 1 = 80, 2 = 320. */
  const ball = (r, col, detail = 1, o) => mesh(new T.IcosahedronGeometry(r, detail), col, o);
  /** Irregular rock / foliage blob. o: {bump (0.18 = lumpy), detail, squash:[sx,sy,sz]} plus material options. */
  const blob = (r, col, seed = 1, o = {}) => { const g = jitter(new T.IcosahedronGeometry(r, o.detail ?? 1), r * (o.bump ?? 0.18), seed); if (o.squash) g.scale(o.squash[0], o.squash[1], o.squash[2]); const { bump, detail, squash, ...m } = o; return mesh(g, col, { vary: 0.1, seed, ...m }); };
  /** Horizontal rectangle in the XZ plane, facing up. */
  const plane = (w, d, col, o) => mesh(new T.PlaneGeometry(w, d, (o && o.seg) || 1, (o && o.seg) || 1).rotateX(-Math.PI / 2), col, o);
  /** Vertical rectangle in the XY plane, facing +Z. */
  const quad = (w, h, col, o) => mesh(new T.PlaneGeometry(w, h), col, o);
  const torus = (r, tube, col, o = {}) => mesh(new T.TorusGeometry(r, tube, o.rs || 5, o.ts || 12, o.arc || Math.PI * 2), col, o);
  /** Extrude a 2D outline [[x,y],...] (in the XY plane) along Z by `depth`. Good for walls with a silhouette, signs, wedges. */
  const extrude = (pts, depth, col, o = {}) => { const sh = new T.Shape(pts.map(p => new T.Vector2(p[0], p[1]))); (o.holes || []).forEach(h => sh.holes.push(new T.Path(h.map(p => new T.Vector2(p[0], p[1]))))); return mesh(new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false }), col, o); };
  /** Surface of revolution from a profile [[radius, y],...]. Bottles, vases, towers, domes. */
  const lathe = (profile, seg, col, o) => mesh(new T.LatheGeometry(profile.map(p => new T.Vector2(p[0], p[1])), seg || 8), col, o);
  /** Tube along a smooth path through 3D points. Cables, pipes, tentacles, ropes. */
  const tube = (pts, r, col, o = {}) => mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(V)), o.seg || pts.length * 6, r, o.rs || 5, !!o.closed), col, o);
  /** Group of objects. */
  const grp = (...kids) => { const g = new T.Group(); kids.flat().forEach(k => k && g.add(k)); return g; };

  // ---------- textures ----------
  /** Canvas texture: draw(ctx2d, w, h). For signs, facades with lit windows, posters, decals. */
  function canvasTex(w, h, draw, o = {}) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; if (o.pixel) { t.magFilter = T.NearestFilter; } if (o.repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); } t.anisotropy = 4; return t; }
  /** Material from a canvas texture. o: {basic:true (unlit/glowing), emissive:true (lit surface whose texture also glows), opacity, side} */
  function texMat(tex, o = {}) { let m; if (o.basic) m = new T.MeshBasicMaterial({ map: tex, toneMapped: false, fog: o.fog !== false }); else { m = new T.MeshStandardMaterial({ map: tex, roughness: o.rough ?? 0.9, flatShading: true }); if (o.emissive) { m.emissiveMap = tex; m.emissive = new T.Color('#ffffff'); m.emissiveIntensity = o.ei ?? 1; } } if (o.transparent || o.opacity != null) { m.transparent = true; m.opacity = o.opacity ?? 1; m.depthWrite = false; } if (o.side === 'double') m.side = T.DoubleSide; if (o.blend === 'add') { m.blending = T.AdditiveBlending; m.transparent = true; m.depthWrite = false; } return m; }
  /** Flat sign or label: a vertical quad `height` metres tall showing text. o: {font, color, bg, pad, glow:true} */
  function label(text, height = 0.4, o = {}) {
    const font = o.font || '800 96px Inter', pad = o.pad ?? 28, probe = document.createElement('canvas').getContext('2d'); probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + pad * 2, h = 96 + pad * 2;
    const tex = canvasTex(w, h, c => { if (o.bg) { c.fillStyle = o.bg; c.fillRect(0, 0, w, h); } c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = o.color || '#ffffff'; c.fillText(text, w / 2, h / 2 + 4); });
    const m = quad(height * w / h, height, texMat(tex, { basic: !!o.glow, transparent: !o.bg, side: 'double' })); m.castShadow = false; return m;
  }
  let _soft = null;
  const softTex = () => _soft || (_soft = canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }));
  /** Soft additive glow billboard (always faces the camera): halos around lamps, eyes, the sun, headlights. size in metres. */
  function flare(color, size = 1, opacity = 1) { const s = new T.Sprite(new T.SpriteMaterial({ map: softTex(), color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false })); s.scale.setScalar(size); return s; }

  // ---------- camera ----------
  class Cam {
    constructor() { this.cam = new T.PerspectiveCamera(45, W / H, 0.1, 1500); this.pos = new T.Vector3(0, 1.6, 6); this.look = new T.Vector3(0, 1.2, 0); this.fov = 45; this.roll = 0; this._sp = new T.Vector3(); this._sl = new T.Vector3(); }
    /** set({pos:[x,y,z], look:[x,y,z], fov, roll}). fov is the VERTICAL field of view in degrees: ~60 wide, 45 normal, 28 telephoto. */
    set(o) { if (o.pos) this.pos = V(o.pos); if (o.look) this.look = V(o.look); if (o.fov) this.fov = o.fov; this.roll = o.roll || 0; return this; }
    /** Handheld shake. amp in metres (0.01 subtle breathing, 0.05 running, 0.15 impact). Call after set(), every frame. */
    shake(amp, t, freq = 1.3, seed = 0) { this._sp.x += noise1(t * freq * 3.1, seed + 1) * amp; this._sp.y += noise1(t * freq * 2.7, seed + 2) * amp; this._sl.x += noise1(t * freq * 2.3, seed + 3) * amp * 1.5; this._sl.y += noise1(t * freq * 3.7, seed + 4) * amp * 1.5; return this; }
    _reset() { this._sp.set(0, 0, 0); this._sl.set(0, 0, 0); }
    _apply() { const c = this.cam; c.position.copy(this.pos).add(this._sp); c.fov = this.fov; c.up.set(Math.sin(this.roll), Math.cos(this.roll), 0); c.lookAt(this.look.clone().add(this._sl)); c.updateProjectionMatrix(); }
  }
  /** Blend two camera specs {pos, look, fov}: camMix(a, b, ramp(lt, 0, d)). */
  const camMix = (a, b, k) => ({ pos: V(a.pos).lerp(V(b.pos), k), look: V(a.look).lerp(V(b.look), k), fov: lerp(a.fov || 45, b.fov || 45, k), roll: lerp(a.roll || 0, b.roll || 0, k) });
  /** Position on a circle around `center`: orbit([0,1,0], 6, angle, 2). angle 0 = +Z side, increases toward +X. */
  const orbit = (center, radius, angle, height = 0) => { const c = V(center); return new T.Vector3(c.x + Math.sin(angle) * radius, c.y + height, c.z + Math.cos(angle) * radius); };
  /** Smooth path through points. Returns {at(u) -> Vector3, heading(u) -> radians for .place(), length}. u in 0..1 at constant speed. */
  function path(pts, closed = false) { const c = new T.CatmullRomCurve3(pts.map(V), closed, 'catmullrom', 0.5), length = c.getLength(); return { length, at: u => c.getPointAt(clamp(u)), heading: u => { const g = c.getTangentAt(clamp(u)); return Math.atan2(g.x, g.z); } }; }

  // ---------- the stage: one per shot ----------
  class Stage {
    constructor(name) {
      this.name = name; this.scene = new T.Scene(); this.cam = new Cam(); this.exposure = 1; this.state = {}; this.post = {};
      this._ticks = []; this._sky = null; this._sun = null; this._lights = []; this.actors = [];
      this.t = 0; this.lt = 0; this.d = 1; this.p = {}; this.scene.background = new T.Color('#000000');
    }
    /** Add an object. o: {pos:[x,y,z], rot:[x,y,z], scale}. Returns the object. */
    add(obj, o = {}) { if (o.pos) obj.position.set(o.pos[0], o.pos[1], o.pos[2]); if (o.rot) obj.rotation.set(o.rot[0], o.rot[1], o.rot[2]); if (o.scale != null) Array.isArray(o.scale) ? obj.scale.set(o.scale[0], o.scale[1], o.scale[2]) : obj.scale.setScalar(o.scale); this.scene.add(obj); return obj; }
    /** Run fn(lt, t, stage) every frame after update(): for self-animating props and effects. Must be a pure function of time. */
    tick(fn) { this._ticks.push(fn); return this; }

    /** Gradient sky. o: {top, horizon, bottom, stars: count, starSize}. Also sets the fog/clear colour to `horizon` unless fog() is called later. */
    sky(o = {}) {
      const top = new T.Color(o.top || '#1b3a6b'), hor = new T.Color(o.horizon || '#9ec3e6'), bot = new T.Color(o.bottom || o.horizon || '#9ec3e6');
      const g = new T.SphereGeometry(900, 24, 14), p = g.attributes.position, col = new Float32Array(p.count * 3), c = new T.Color();
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 900; if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, o.curve || 0.55)); else c.copy(hor).lerp(bot, Math.min(1, -y * 4)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new T.BufferAttribute(col, 3));
      const dome = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false, toneMapped: false })); dome.renderOrder = -100; dome.frustumCulled = false;
      if (this._sky) this.scene.remove(this._sky); this._sky = grp(dome); this.scene.add(this._sky); this.scene.background = hor.clone();
      if (o.stars) {
        const r = rng(o.seed || 5), mk = (n, size, op) => { const pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, e = Math.asin(r() * 0.97 + 0.03), R = 850; pos[i * 3] = Math.cos(a) * Math.cos(e) * R; pos[i * 3 + 1] = Math.sin(e) * R; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * R; }
          const bg = new T.BufferGeometry(); bg.setAttribute('position', new T.BufferAttribute(pos, 3)); const pts = new T.Points(bg, new T.PointsMaterial({ color: '#ffffff', size, sizeAttenuation: false, transparent: true, opacity: op, fog: false, depthWrite: false, toneMapped: false })); pts.renderOrder = -99; pts.frustumCulled = false; this._sky.add(pts); };
        mk(Math.floor(o.stars * 0.75), o.starSize || 2.2, 0.65); mk(Math.ceil(o.stars * 0.25), (o.starSize || 2.2) * 1.9, 1);
      }
      return this;
    }
    /** Sun or moon disc with a halo, drawn on the sky. o: {dir:[x,y,z] direction TO the body, color, size (deg-ish, 1 = sun), glow}. Purely visual: pair with sun() for light. */
    skyDisc(o = {}) { const d = V(o.dir || [0.3, 0.6, -1]).normalize().multiplyScalar(800), size = (o.size || 1) * 34, g = grp(); const disc = new T.Mesh(new T.CircleGeometry(size, 24), new T.MeshBasicMaterial({ color: o.color || '#fff6d8', fog: false, depthWrite: false, toneMapped: false })); disc.renderOrder = -98; g.add(disc); const f = flare(o.glowColor || o.color || '#fff6d8', size * (o.glow ?? 7), o.glowOpacity ?? 0.55); f.renderOrder = -97; g.add(f); g.position.copy(d); g.userData.face = true; if (!this._sky) this.sky({}); this._sky.add(g); return g; }
    /** Distance fog. Also the clear colour. Keep it close to the sky horizon colour. near/far in metres. */
    fog(color, near = 10, far = 80) { this.scene.fog = new T.Fog(color, near, far); this.scene.background = new T.Color(color); return this; }
    /** Flat ground plane. o: {size, color, vary, seg, y}. For hills use terrain(). */
    ground(o = {}) { const size = o.size || 600, seg = o.seg || 1; const m = plane(size, size, o.color || '#3a4a3a', { seg, vary: o.vary, seed: o.seed, rough: o.rough ?? 1 }); m.castShadow = false; m.position.y = o.y || 0; this.scene.add(m); return m; }
    /** Rolling low-poly terrain, flat (y=0) within `flat` metres of the origin. o: {size, seg, height, scale, flat, color, vary, seed, fn(x,z)->extra height}. Returns the mesh with .heightAt(x,z). */
    terrain(o = {}) {
      const size = o.size || 200, seg = o.seg || 48, hgt = o.height ?? 6, sc = o.scale || 0.04, flat = o.flat ?? 12, seed = o.seed || 3;
      const hAt = (x, z) => { const d = Math.hypot(x, z), k = smooth((d - flat) / (flat * 1.5 + 6)); return k * hgt * (noise2(x * sc + 31, z * sc + 17, seed) * 0.7 + noise2(x * sc * 2.7, z * sc * 2.7, seed + 1) * 0.3) + (o.fn ? o.fn(x, z) : 0); };
      const g = new T.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hAt(p.getX(i), p.getZ(i)));
      g.computeVertexNormals(); const m = mesh(g, o.color || '#3d5a3a', { vary: o.vary ?? 0.07, seed, rough: 1 }); m.castShadow = false; m.heightAt = hAt; this.scene.add(m); return m;
    }
    /** Key light with shadows. o: {dir:[x,y,z] direction the light comes FROM, color, intensity (1 = normal daylight), shadow (default true), area (half-size in metres of the shadowed region, default 22), center:[x,y,z], res}. */
    sun(o = {}) {
      const l = new T.DirectionalLight(o.color || '#fff1dc', (o.intensity ?? 1) * Math.PI), c = V(o.center || [0, 0, 0]);
      l.position.copy(c).add(V(o.dir || [3, 6, 4]).normalize().multiplyScalar(90)); l.target.position.copy(c);
      if (o.shadow !== false) { const a = o.area || 22; l.castShadow = true; l.shadow.mapSize.set(o.res || 2048, o.res || 2048); Object.assign(l.shadow.camera, { left: -a, right: a, top: a, bottom: -a, near: 1, far: 220 }); l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03; }
      this.scene.add(l, l.target); this._sun = l; this._lights.push(l); return l;
    }
    /** Soft fill from the sky (first colour) and the ground bounce (second). intensity 1 = bright overcast; 0.3-0.6 is typical next to a sun. */
    hemi(skyColor = '#bcd6ff', groundColor = '#4a4436', intensity = 0.5) { const l = new T.HemisphereLight(skyColor, groundColor, intensity * Math.PI); this.scene.add(l); this._lights.push(l); return l; }
    /** Flat fill light. Use sparingly; hemi() looks better. */
    ambient(color = '#ffffff', intensity = 0.2) { const l = new T.AmbientLight(color, intensity * Math.PI); this.scene.add(l); this._lights.push(l); return l; }
    /** Local lamp. intensity 1 lights surfaces about range/3 away as brightly as daylight (closer is brighter: 0.4-0.8 is typical for a lamp near a character). range = cut-off in metres. No shadows (cheap). l.userData.base holds the intensity so you can flicker: l.intensity = l.userData.base * S3.flicker(lt). */
    point(pos, color = '#ffd9a0', intensity = 1, range = 8) { const l = new T.PointLight(color, intensity * Math.PI * Math.pow(range / 3, 1.5), range, 1.5); l.position.copy(V(pos)); l.userData.base = l.intensity; this.scene.add(l); this._lights.push(l); return l; }
    /** Cone light: flashlights, headlights, stage spots, a doorway spill. angle = full cone in degrees. intensity 1 lights a surface at range/2 like daylight. o: {shadow:true, penumbra}. Move it with l.position / l.target.position (the target is already in the scene). */
    spot(pos, target, color = '#ffffff', intensity = 1, range = 14, angle = 40, o = {}) { const l = new T.SpotLight(color, intensity * Math.PI * Math.pow(range / 2, 1.5), range, angle * Math.PI / 360, o.penumbra ?? 0.5, 1.5); l.position.copy(V(pos)); l.target.position.copy(V(target)); l.userData.base = l.intensity; if (o.shadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0006; l.shadow.normalBias = 0.03; } this.scene.add(l, l.target); this._lights.push(l); return l; }

    /** Deterministic particle cloud. o: {count, size (metres), color, opacity, additive, seed, at(i, lt, rand, out) -> fills out.x/y/z (rand = that particle's fixed 0..1 numbers [a,b,c,d])}. Returns THREE.Points. */
    particles(o) {
      const n = o.count, geo = new T.BufferGeometry(), pos = new Float32Array(n * 3), r = rng(o.seed || 11), rnd = []; for (let i = 0; i < n; i++) rnd.push([r(), r(), r(), r()]);
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const pts = new T.Points(geo, new T.PointsMaterial({ map: o.square ? null : softTex(), color: o.color || '#ffffff', size: o.size || 0.06, sizeAttenuation: true, transparent: true, opacity: o.opacity ?? 0.8, depthWrite: false, blending: o.additive ? T.AdditiveBlending : T.NormalBlending, toneMapped: !o.additive, fog: o.fog !== false }));
      pts.frustumCulled = false; const out = new T.Vector3(); this.scene.add(pts);
      this.tick((lt, t) => { for (let i = 0; i < n; i++) { o.at(i, o.global ? t : lt, rnd[i], out); pos[i * 3] = out.x; pos[i * 3 + 1] = out.y; pos[i * 3 + 2] = out.z; } geo.attributes.position.needsUpdate = true; });
      return pts;
    }
    /** A screen whose picture is redrawn every frame: draw(ctx2d, lt, t, pxW, pxH). Returns a vertical quad w x h metres. For monitors, phones, TVs, signs that animate. */
    screen(w, h, pxW, pxH, draw, o = {}) { const cv = document.createElement('canvas'); cv.width = pxW; cv.height = pxH; const c2 = cv.getContext('2d'), tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; const m = quad(w, h, texMat(tex, { basic: o.lit ? false : true, emissive: !!o.lit, side: o.side })); m.castShadow = false; this.tick((lt, t) => { c2.setTransform(1, 0, 0, 1, 0, 0); draw(c2, lt, t, pxW, pxH); tex.needsUpdate = true; }); return m; }

    /** Local time (seconds into this shot) at which the narrator says `word` in this scene (nth occurrence, default first). Returns `fallback` if the word is not in this scene. Use it to land actions on the narration: const k = s.cue('knocks', 2.0). */
    cue(word, fallback = null, nth = 1) { const sc = this._sc; if (!sc || !sc.words) return fallback; const w = String(word).toUpperCase().replace(/[^A-Z0-9']/g, ''); let n = 0; for (const x of sc.words) if (x.w.replace(/[^A-Z0-9']/g, '') === w && ++n === nth) return x.t; return fallback; }
    /** Local times of sound events of `type` inside this scene (from the episode's sfx list). */
    sfxTimes(type) { const sc = this._sc; if (!sc || typeof TL === 'undefined' || !TL) return []; return TL.sfx.filter(e => e.type === type && e.t >= sc.start - 0.01 && e.t < sc.end).map(e => e.t - sc.start); }
  }

  // ---------- registry + render ----------
  function ensure() {
    if (renderer) return;
    const rs = window.DRAFT ? 0.5 : 1; glc = document.createElement('canvas'); glc.width = Math.round(W * rs); glc.height = Math.round(H * rs);
    renderer = new T.WebGLRenderer({ canvas: glc, antialias: true, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.outputColorSpace = T.SRGBColorSpace;
  }
  /**
   * Register a shot. def = {
   *   build(s, p)                 once: create the set, lights, actors. `this` is the def, so store things on `this` or s.state.
   *   update(s, lt, d, t, p)      every frame: pose everything and set the camera from lt (seconds into the shot, d = shot length).
   *   overlay(c, s, lt, d, t, p)  optional 2D drawing on the 1080x1920 canvas after the 3D render (phone screens, HUD text).
   *   post: {bloom, vignette, grain, grade:{color, alpha, mode}}   optional look overrides for this shot.
   * }
   */
  function shot(name, def) {
    defs[name] = def;
    const fn = (c, t, lt, d, p, P, sc) => render(name, c, t, lt, d, p || {}, sc);
    fn.raw = true; fn.is3d = true; fn.post = def.post || null; SCENES[name] = fn; return def;
  }
  function render(name, c, t, lt, d, p, sc) {
    ensure(); const def = defs[name], key = name + '|' + (def.key ? def.key(p) : JSON.stringify(p));
    let s = live.get(key);
    if (!s) { s = new Stage(name); s.p = p; s._sc = sc; def.build && def.build.call(def, s, p); live.set(key, s); if (live.size > 4) { const old = live.keys().next().value; if (old !== key) { dispose(live.get(old)); live.delete(old); } } }
    s.t = t; s.lt = lt; s.d = d; s.p = p; s._sc = sc; s.k = clamp(lt / d); s.cam._reset();
    def.update && def.update.call(def, s, lt, d, t, p);
    for (const f of s._ticks) f(lt, t, s);
    // impact shake from knock / boom / impact sound events
    if (typeof TL !== 'undefined' && TL) for (const k of hits(['knock', 'boom', 'impact', 'slam', 'thunder'])) { const dt = t - k; if (dt >= 0 && dt < 0.35) { const a = 0.05 * (1 - dt / 0.35); s.cam._sp.x += Math.sin(dt * 95) * a; s.cam._sp.y += Math.cos(dt * 80) * a * 0.6; } }
    s.cam._apply();
    if (s._sky) { s._sky.position.copy(s.cam.cam.position); s._sky.children.forEach(k => { if (k.userData.face) k.lookAt(s.cam.cam.position); }); }
    renderer.toneMappingExposure = s.exposure;
    renderer.render(s.scene, s.cam.cam);
    c.drawImage(glc, 0, 0, W, H);
    if (def.overlay) { c.save(); def.overlay.call(def, c, s, lt, d, t, p); c.restore(); }
    return s;
  }
  function dispose(s) { if (!s) return; s._lights.forEach(l => { if (l.shadow && l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } }); }
  /** Project a world point to canvas pixels [x, y] for the shot being drawn (use inside overlay()). */
  function project(s, p) { const v = V(p).project(s.cam.cam); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, v.z]; }

  return { T, V, shot, defs, mat, glow, mesh, vary, jitter, box, boxB, cyl, cylB, cone, coneB, ball, blob, plane, quad, torus, extrude, lathe, tube, grp,
    canvasTex, texMat, label, flare, softTex, camMix, orbit, path, noise1, noise2, flicker, smooth, ramp, pulse, project, Stage, hash1, info: () => renderer && renderer.info };
})();
