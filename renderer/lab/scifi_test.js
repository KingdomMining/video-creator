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
