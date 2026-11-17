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
    s.ground({ color: o.ground || '#8e9296', vary: 0.03, seg: 30, size: 600 });
    s.sun({ dir: o.sun || [5, 8, 6], color: '#fff2de', intensity: 1.0, area: o.area || 24, center: o.center || [0, 0, 0] }); s.hemi('#c4d8f2', '#5c5a52', 0.55);
  };
  const night = (s, o = {}) => {
    s.sky({ top: '#03050c', horizon: '#131a2e', stars: 300 }); s.fog('#0e1424', o.fogNear || 25, o.fogFar || 120);
    s.ground({ color: o.ground || '#2a2d31', vary: 0.04, seg: 30, size: 600 });
    s.sun({ dir: o.sun || [-4, 7, 5], color: '#8fa8e8', intensity: 0.3, area: o.area || 24, center: o.center || [0, 0, 0] }); s.hemi('#3a4a70', '#14161a', 0.4);
  };

  /**
   * Register a catalogue shot. items: [name, () => Group, {rot, fig: [x, z] | false, dx, dz}].
   * o: {cols, cw, cd, rot, lh, night, elev (deg), fov, fig, fn(obj, lt) per-frame hook, top (extra height to frame)}
   */
  function cat(name, items, o = {}) {
    S3.shot(name, {
      build(s) {
        const cols = o.cols || 2, cw = o.cw || 7, cd = o.cd || 7, rows = Math.ceil(items.length / cols), lh = o.lh || cw * 0.062;
        const W = cols * cw, D = rows * cd, fov = o.fov || 20, e = (o.elev || 46) * Math.PI / 180, top = o.top || 2;
        const hh = Math.atan(Math.tan(fov * Math.PI / 360) * 9 / 16), dist = Math.max((W / 2 + cw * 0.04) / Math.tan(hh) + D / 2 * Math.cos(e), (D * Math.sin(e) + top * Math.cos(e) + 1) / 2 / Math.tan(fov * Math.PI / 360));
        (o.night ? night : daylight)(s, { area: Math.max(W, D) * 0.6 + 4, fogNear: dist * 2, fogFar: dist * 6, ...o.env });
        this.objs = items.map(([nm, make, q = {}], i) => {
          const cx = (i % cols - (cols - 1) / 2) * cw, cz = (Math.floor(i / cols) - (rows - 1) / 2) * cd;
          const obj = s.add(make(), { pos: [cx + (q.dx || 0), 0, cz + (q.dz || 0)], rot: [0, q.rot ?? o.rot ?? 0, 0] });
          s.add(label(nm, lh, { bg: '#18222c', color: '#ffe9a8' }), { pos: [cx + (q.lx ?? o.lx ?? 0), lh * 0.6, cz + (q.lz ?? o.lz ?? cd * 0.4)], rot: [-0.7, 0, 0] });
          const f = q.fig === undefined ? o.fig : q.fig;
          if (f !== false) s.add(figure(), { pos: [cx + (f ? f[0] : cw * 0.38), 0, cz + (f ? f[1] : cd * 0.28)], rot: [0, 0.3, 0] });
          return obj;
        });
        const look = [0, top * 0.3, o.lookZ ?? 0];
        this.cam = { pos: [look[0], look[1] + Math.sin(e) * dist, look[2] + Math.cos(e) * dist], look, fov };
      },
      update(s, lt) { if (o.fn) this.objs.forEach((ob, i) => o.fn(ob, lt, i)); s.cam.set(this.cam); },
      post: { bloom: o.night ? 0.45 : 0.22, vignette: 0.15, grain: 0 },
    });
  }

  // ---- inspection: any builder from any angle ----
  S3.shot('urban_view', {
    key: p => JSON.stringify(p),
    build(s, p) {
      (p.night ? night : daylight)(s, { area: p.area || 16 });
      const fn = K[p.b || 'saloon']; this.obj = s.add(fn(p.o || {}), { rot: [0, p.rot || 0, 0] });
      if (p.fig !== false) s.add(figure(), { pos: p.figPos || [(p.r || 9) * 0.22, 0, 1.6] });
      if (p.night) { this.pl = s.point([3, 4, 5], '#ffd9a0', 0.5, 16); }
    },
    update(s, lt, d, t, p) {
      const r = p.r || 9, a = (p.a ?? 0.6) + lt * (p.spin ?? 1.05);
      if (p.fn && this.obj.userData[p.fn]) this.obj.userData[p.fn](p.arg !== undefined ? p.arg : lt);
      s.cam.set({ pos: S3.orbit(p.look || [0, 0.8, 0], r, a, p.h ?? 1.6), look: p.look || [0, 0.8, 0], fov: p.fov || 50 });
    },
    post: { bloom: 0.3, vignette: 0.25, grain: 0 },
  });

  // ---- vehicles ----
  cat('urban_cat1', [
    ['saloon', () => K.saloon({ seed: 1 })], ['hatchback', () => K.hatchback({ seed: 2 })],
    ['suv', () => K.suv({ seed: 1 })], ['pickup', () => K.pickup({ seed: 1 })],
    ['taxi', () => K.taxi({})], ['policeCar', () => K.policeCar({})],
    ['van', () => K.van({ text: 'KETTLEBROOK\nDAIRY CO.', stripe: '#2e7d6b' })], ['ambulance', () => K.ambulance({})],
  ], { cols: 2, cw: 7, cd: 6.6, rot: 0.75 });
  cat('urban_cat2', [
    ['bus', () => K.bus({}), { rot: 0.95 }], ['lorry', () => K.lorry({ text: 'ORBIT PARCEL' }), { rot: 0.95 }],
    ['lorry tanker', () => K.lorry({ load: 'tanker', color: '#a8342c' }), { rot: 0.95 }], ['lorry flatbed', () => K.lorry({ load: 'flatbed', color: '#3d6a56' }), { rot: 0.95 }],
    ['motorbike', () => K.motorbike({ lean: true }), { rot: 0.9 }], ['bicycle', () => K.bicycle({ basket: true, lean: true }), { rot: 0.9 }],
  ], { cols: 2, cw: 11, cd: 9.5, rot: 0.75, top: 3.5 });
  cat('urban_cat3', [
    ['saloon abandoned', () => K.saloon({ seed: 5, abandoned: true })], ['suv abandoned', () => K.suv({ seed: 6, abandoned: true })],
    ['policeCar abandoned', () => K.policeCar({ seed: 2, abandoned: true })], ['van abandoned', () => K.van({ seed: 4, abandoned: true })],
    ['saloon interior', () => K.saloon({ seed: 3, interior: true })], ['pickup tailgate', () => K.pickup({ seed: 3, tailgate: true }), { rot: 2.4 }],
    ['bus abandoned', () => K.bus({ seed: 2, abandoned: true }), { rot: 1.0 }], ['motorbike abandoned', () => K.motorbike({ seed: 2, abandoned: true })],
  ], { cols: 2, cw: 8, cd: 7, rot: 0.75 });
  cat('urban_cat4', [
    ['saloon lights', () => K.saloon({ seed: 2, lights: 1 })], ['taxi lights', () => K.taxi({ lights: 1 })],
    ['policeCar siren(t)', () => K.policeCar({ lights: 1 })], ['ambulance siren(t)', () => K.ambulance({ lights: 1 })],
    ['bus lights', () => K.bus({ lights: 1, route: '9', dest: 'HARBOUR' }), { rot: 1.0 }], ['hatchback brake', () => { const g = K.hatchback({ seed: 4, lights: 1 }); g.userData.brake(1); return g; }, { rot: 2.5 }],
  ], { cols: 2, cw: 8.5, cd: 7.5, rot: 0.75, night: true, fn: (ob, lt) => { if (ob.userData.siren) ob.userData.siren(lt); } });
})();
