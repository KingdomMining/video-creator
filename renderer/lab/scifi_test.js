// Catalogue, inspection and scene shots for KitSciFi (renderer/kit/scifi.js).
//   node renderer/render.js --shot scifi_cat1 --scripts renderer/lab/scifi_test.js --at 0.5 --out /tmp/claude-0/scifi_cat1.jpg --clean
//   node renderer/render.js --shot scifi_one --scripts renderer/lab/scifi_test.js --params '{"b":"door","open":0.5,"a":0.5}' --at 0.5 --out /tmp/claude-0/one.jpg --clean
//   node renderer/render.js --shot scifi_scene --scripts renderer/lab/scifi_test.js --n 4 --dur 6 --out /tmp/claude-0/scene.jpg --clean
(() => {
  const { box, boxB, grp, label, ramp } = S3, K = KitSciFi, T = S3.T;
  /** 1.75 m reference figure made of boxes. */
  const figure = (shirt = '#d9773a') => grp(
    boxB(0.15, 0.86, 0.17, '#2c3a52').at(-0.1, 0, 0), boxB(0.15, 0.86, 0.17, '#2c3a52').at(0.1, 0, 0),
    boxB(0.42, 0.6, 0.22, shirt).at(0, 0.86, 0), boxB(0.11, 0.58, 0.12, shirt).at(-0.28, 0.86, 0), boxB(0.11, 0.58, 0.12, shirt).at(0.28, 0.86, 0),
    boxB(0.2, 0.25, 0.21, '#e2b08e').at(0, 1.5, 0));
  /** Neutral studio: dark grey floor, soft key with shadows, cool fill. Dark enough that glows and additive beams still read. */
  const studio = (s, o = {}) => {
    const bg = o.dark ? '#0b0e13' : '#33383f';
    s.sky({ top: o.dark ? '#05070a' : '#22262c', horizon: bg }); s.fog(bg, o.fogNear || 60, o.fogFar || 400);
    s.ground({ color: o.ground || (o.dark ? '#1b1f25' : '#565c64'), vary: 0.03, seg: 40, size: 600 });
    s.sun({ dir: o.sun || [4, 8, 6], color: '#fff3e2', intensity: o.dark ? 0.25 : 1.0, area: o.area || 14, center: o.center || [0, 0, 0] });
    s.hemi(o.dark ? '#3a4a6a' : '#c9d8ee', o.dark ? '#14161a' : '#5a5650', o.dark ? 0.3 : 0.6);
  };
  const POST = { bloom: 0.3, vignette: 0.25, grain: 0 };

  /** Camera that frames a box from a direction: az (0 = from +Z, positive toward +X), el (elevation, radians). */
  function fitCam(bb, az = 0.3, el = 0.6, fov = 28, m = {}) {
    const c = bb.getCenter(new T.Vector3()), dir = new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)), cam = new T.PerspectiveCamera(fov, 1080 / 1920, 0.1, 9000);
    const pts = []; for (let i = 0; i < 8; i++) pts.push(new T.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z));
    const L = m.l ?? -0.9, R = m.r ?? 0.9, B = m.b ?? -0.5, U = m.t ?? 0.66; let lo = 0.5, hi = 4000, look = c.clone(), v = new T.Vector3();
    const fits = d => { cam.position.copy(look).addScaledVector(dir, d); cam.lookAt(look); cam.updateMatrixWorld(true); cam.updateProjectionMatrix(); let x0 = 9, x1 = -9, y0 = 9, y1 = -9; for (const p of pts) { v.copy(p).project(cam); if (v.z > 1) return null; x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); } return [x0, x1, y0, y1]; };
    for (let it = 0; it < 4; it++) {      // alternate: fit distance, then recentre the look point inside the safe frame
      lo = 0.5; hi = 4000; for (let i = 0; i < 40; i++) { const d = (lo + hi) / 2, f = fits(d); if (f && f[1] - f[0] <= R - L && f[3] - f[2] <= U - B) hi = d; else lo = d; }
      const f = fits(hi), right = new T.Vector3().crossVectors(new T.Vector3(0, 1, 0), dir).normalize(), up = new T.Vector3().crossVectors(dir, right).normalize(), hh = Math.tan(fov * Math.PI / 360) * hi, hw = hh * 1080 / 1920;
      look.addScaledVector(right, ((f[0] + f[1]) / 2 - (L + R) / 2) * hw).addScaledVector(up, ((f[2] + f[3]) / 2 - (B + U) / 2) * hh);
    }
    return { pos: look.clone().addScaledVector(dir, hi).toArray(), look: look.toArray(), fov };
  }
  /**
   * Register a catalogue shot. items: [name, () => Group, {rot, scale, fig: [x, z] | false, dx, dz, y, open, note}].
   * o: {cols, cw, cd (cell size), az, el, fov, fig, dark, lh (label height), top (tallest thing, for framing)}
   */
  function cat(name, items, o = {}) {
    S3.shot(name, {
      build(s) {
        const cols = o.cols || 2, cw = o.cw || 4, cd = o.cd || 4, rows = Math.ceil(items.length / cols), lh = o.lh || cw * 0.06, objs = [];
        studio(s, { area: Math.max(cw * cols, cd * rows) * 0.62 + 4, dark: o.dark });
        const bb = new T.Box3(new T.Vector3(-cols * cw / 2, 0, -rows * cd / 2), new T.Vector3(cols * cw / 2, 0.2, rows * cd / 2 + lh));
        items.forEach(([nm, make, q = {}], i) => {
          const cx = (i % cols - (cols - 1) / 2) * cw, cz = (Math.floor(i / cols) - (rows - 1) / 2) * cd;
          const obj = s.add(make(), { pos: [cx + (q.dx || 0), q.y || 0, cz + (q.dz || 0)], rot: [0, q.rot ?? o.rot ?? 0, 0], scale: q.scale });
          if (q.open != null && obj.userData.open) obj.userData.open(q.open);
          objs.push(obj); bb.expandByObject(obj);
          s.add(label(nm + (q.note ? '  ' + q.note : q.scale ? '  (x' + q.scale + ')' : ''), lh, { bg: '#10161d', color: '#ffe9a8' }), { pos: [cx, lh * 0.62, cz + cd * 0.5 - lh * 0.4], rot: [-0.5, 0, 0] });
          const f = q.fig === undefined ? o.fig : q.fig;
          if (f !== false) s.add(figure(), { pos: [cx + (f ? f[0] : cw * 0.4), 0, cz + (f ? f[1] : cd * 0.3)], rot: [0, 0.3, 0] });
        });
        K.animate(s, objs); this.objs = objs;
        this.cam = fitCam(bb, o.az ?? 0.32, o.el ?? 0.62, o.fov || 26, o.m);
      },
      update(s, lt, d) { this.objs.forEach(ob => { if (ob.userData.open && o.swing) ob.userData.open(ramp(lt, 0.3, d - 0.3)); }); s.cam.set(this.cam); },
      post: POST,
    });
  }

  cat('scifi_tmp', [
    ['corridor', () => K.corridor()], ['junction', () => K.junction({ arms: [1, 1, 0, 1] })],
    ['door', () => K.door({ sign: 'deck03' }), { open: 0.35 }], ['airlock', () => K.airlock(), { open: 0.7 }],
    ['crate + canister', () => grp(K.crate().at(-0.6, 0, 0), K.canister().at(0.4, 0, 0.2), K.crate({ w: 0.6, h: 0.5, d: 0.5, color: '#8c6a3a', symbol: 'rad' }).at(-0.5, 0.8, 0))], ['crateStack', () => K.crateStack({ seed: 3 })],
    ['pipes + cables', () => grp(K.pipes(), K.cables({ loose: true, y: 2.6 }))], ['vent / fan', () => grp(K.vent().at(-0.8, 0, 0), K.vent({ fan: true }).at(0.7, 0, 0))],
  ], { cols: 2, cw: 5.2, cd: 5 });

  // ---- inspect one builder: params {b: name, o: options, a: orbit angle, r: distance, h: camera height, look: [x,y,z], open: k, t0, dark, fig, ry, spin} ----
  S3.shot('scifi_one', {
    build(s, p) {
      const obj = K[p.b || 'crate'](p.o || {}); this.obj = s.add(obj, { rot: [0, p.ry || 0, 0], scale: p.scale });
      for (let i = 1; i < (p.tile || 1); i++) s.add(K[p.b](Object.assign({}, p.o, { seed: i + 1 })), { pos: [0, 0, -i * (obj.userData.length || 3)] });
      (p.lamps || []).forEach(l => s.point(l.slice(0, 3), l[3] || '#bfe9ff', l[4] || 0.6, l[5] || 7));
      const bb = new T.Box3().setFromObject(obj), sz = bb.getSize(new T.Vector3()), c = bb.getCenter(new T.Vector3()); this.c = c; this.sz = sz;
      studio(s, { dark: p.dark, area: Math.max(6, sz.length() * 0.75), center: [c.x, 0, c.z] });
      if (p.fig !== false) s.add(figure(), { pos: p.figPos || [bb.max.x + 0.6, 0, bb.max.z * 0.5] });
      console.warn(`[${p.b}] size ${sz.x.toFixed(2)} x ${sz.y.toFixed(2)} x ${sz.z.toFixed(2)}  min ${bb.min.x.toFixed(2)},${bb.min.y.toFixed(2)},${bb.min.z.toFixed(2)}  centre ${c.x.toFixed(2)},${c.z.toFixed(2)}`);
    },
    update(s, lt, d, t, p) {
      const u = this.obj.userData, c = this.c, sz = this.sz;
      if (u.open) u.open(p.open != null ? p.open : ramp(lt, 0.5, d - 0.5));
      if (u.update) u.update((p.t0 || 0) + lt);
      this.obj.traverse(o => { if (o !== this.obj && o.userData.update && !o.userData.driven) o.userData.update((p.t0 || 0) + lt); });
      const fov = p.fov || 40, w = Math.max(sz.x, sz.z), r = p.r || Math.max(sz.y / (2 * Math.tan(fov * Math.PI / 360)), w / (2 * Math.tan(fov * Math.PI / 360) * 0.5625)) * 1.25 + w * 0.3;
      if (p.cam) { s.cam.set(p.cam); return; }
      s.cam.set({ pos: S3.orbit([c.x, 0, c.z], r, (p.a ?? 0.55) + (p.spin || 0) * lt, p.h ?? Math.max(1.5, c.y + sz.y * 0.35)), look: p.look || [c.x, c.y * (p.lookK ?? 1), c.z], fov });
    },
    post: POST,
  });
})();
