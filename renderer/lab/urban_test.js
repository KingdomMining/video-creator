// Catalogue, inspection and scene shots for KitUrban.
//   node renderer/render.js --shot urban_cat1 --scripts renderer/lab/urban_test.js --at 0.5 --out /tmp/claude-0/urban_cat1.jpg --clean
//   node renderer/render.js --shot urban_view --scripts renderer/lab/urban_test.js --params '{"b":"saloon","o":{"seed":3}}' --at 0,1,2,3 --out /tmp/claude-0/urban_view.jpg --clean
(() => {
  const { box, boxB, grp, label, ramp } = S3, K = KitUrban;
  /** 1.75 m reference figure made of boxes. */
  const figure = (shirt = '#c8483a') => grp(
    boxB(0.15, 0.86, 0.17, '#2c3a52').at(-0.1, 0, 0), boxB(0.15, 0.86, 0.17, '#2c3a52').at(0.1, 0, 0),
    boxB(0.42, 0.6, 0.22, shirt).at(0, 0.86, 0), boxB(0.11, 0.58, 0.12, shirt).at(-0.28, 0.86, 0), boxB(0.11, 0.58, 0.12, shirt).at(0.28, 0.86, 0),
    boxB(0.2, 0.25, 0.21, '#e2b08e').at(0, 1.5, 0));
  const daylight = (s, o = {}) => {
    s.sky({ top: '#5d86b8', horizon: '#cdd8e2' }); s.fog('#cdd8e2', o.fogNear || 70, o.fogFar || 260);
    s.ground({ color: o.ground || '#8e9296', vary: 0.03, seg: 30, size: 400 });
    s.sun({ dir: o.sun || [5, 8, 6], color: '#fff2de', intensity: 1.0, area: o.area || 24, center: o.center || [0, 0, 0] }); s.hemi('#c4d8f2', '#5c5a52', 0.55);
  };
  const night = (s, o = {}) => {
    s.sky({ top: '#03050c', horizon: '#131a2e', stars: 300 }); s.fog('#0e1424', o.fogNear || 25, o.fogFar || 120);
    s.ground({ color: o.ground || '#2a2d31', vary: 0.04, seg: 30, size: 400 });
    s.sun({ dir: o.sun || [-4, 7, 5], color: '#8fa8e8', intensity: 0.3, area: o.area || 24, center: o.center || [0, 0, 0] }); s.hemi('#3a4a70', '#14161a', 0.4);
  };

  /**
   * Register a catalogue shot. items: [name, () => Group, {rot, fig: [x, z] | false, dx, dz}]. o: {cols, cw, cd, rot, cam: {pos, look, fov}, lh, night}
   */
  function cat(name, items, o = {}) {
    S3.shot(name, {
      build(s) {
        const cols = o.cols || 2, cw = o.cw || 7, cd = o.cd || 7, rows = Math.ceil(items.length / cols), lh = o.lh || 0.42;
        (o.night ? night : daylight)(s, { area: Math.max(cw * cols, cd * rows) * 0.62 + 4, ...o.env });
        items.forEach(([nm, make, q = {}], i) => {
          const cx = (i % cols - (cols - 1) / 2) * cw, cz = (Math.floor(i / cols) - (rows - 1) / 2) * cd;
          s.add(make(), { pos: [cx + (q.dx || 0), 0, cz + (q.dz || 0)], rot: [0, q.rot ?? o.rot ?? 0, 0] });
          s.add(label(nm, lh, { bg: '#18222c', color: '#ffe9a8' }), { pos: [cx, lh * 0.55, cz + cd * 0.47], rot: [-0.45, 0, 0] });
          const f = q.fig === undefined ? o.fig : q.fig;
          if (f !== false) s.add(figure(), { pos: [cx + (f ? f[0] : cw * 0.38), 0, cz + (f ? f[1] : cd * 0.3)], rot: [0, 0.3, 0] });
        });
        this.span = [cols * cw, rows * cd];
      },
      update(s, lt) {
        const c = o.cam || {}, [w, d] = this.span;
        s.cam.set({ pos: c.pos || [0, d * 0.95 + 4, d * 1.1 + 6], look: c.look || [0, 0.4, 0.4], fov: c.fov || 30 });
      },
      post: { bloom: 0.25, vignette: 0.2, grain: 0 },
    });
  }

  // ---- inspection: any builder from any angle ----
  S3.shot('urban_view', {
    key: p => JSON.stringify(p),
    build(s, p) {
      (p.night ? night : daylight)(s, { area: p.area || 16 });
      const fn = K[p.b || 'saloon']; this.obj = s.add(fn(p.o || {}), { rot: [0, p.rot || 0, 0] });
      if (p.fig !== false) s.add(figure(), { pos: p.figPos || [(p.r || 7) * 0.28, 0, 1.2] });
      if (p.night) { this.pl = s.point([3, 4, 5], '#ffd9a0', 0.5, 16); }
    },
    update(s, lt, d, t, p) {
      const r = p.r || 7, a = (p.a ?? 0.6) + lt * (p.spin ?? 1.05);
      if (p.fn && this.obj.userData[p.fn]) this.obj.userData[p.fn](p.arg !== undefined ? p.arg : lt);
      s.cam.set({ pos: S3.orbit(p.look || [0, 0.8, 0], r, a, p.h ?? 1.6), look: p.look || [0, 0.8, 0], fov: p.fov || 40 });
    },
    post: { bloom: 0.3, vignette: 0.25, grain: 0 },
  });

  cat('urban_cat1', [
    ['saloon', () => K.saloon({ seed: 1 })], ['hatchback', () => K.hatchback({ seed: 2 })],
    ['saloon interior', () => K.saloon({ seed: 3, interior: true })], ['hatchback night', () => K.hatchback({ seed: 4, lights: 1 })],
    ['saloon abandoned', () => K.saloon({ seed: 5, abandoned: true })], ['hatchback abandoned', () => K.hatchback({ seed: 6, abandoned: true })],
  ], { cols: 2, cw: 6.4, cd: 6.4, rot: 0.75 });
})();
