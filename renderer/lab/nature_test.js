// Nature kit: catalogue shots (nature_cat1..), animation sheets (nature_anim_*) and composed scenes (nature_scene*).
// Preview: node renderer/render.js --shot nature_cat1 --scripts renderer/lab/nature_test.js --at 0.5 --out /tmp/x.jpg --clean
(() => {
  const { box, boxB, grp, label } = S3, K = KitNature, flr = Math.floor;
  // 1.75 m reference figure made of boxes
  const person = (shirt = '#c8483a') => grp(boxB(0.4, 0.62, 0.22, shirt).at(0, 0.86, 0), boxB(0.2, 0.25, 0.22, '#e2b08e').at(0, 1.5, 0), boxB(0.16, 0.86, 0.18, '#2c3a52').at(-0.11, 0, 0), boxB(0.16, 0.86, 0.18, '#2c3a52').at(0.11, 0, 0), box(0.11, 0.6, 0.12, shirt).at(-0.27, 1.17, 0), box(0.11, 0.6, 0.12, shirt).at(0.27, 1.17, 0));

  // Camera that frames a set of objects from a given pitch (radians above the horizon), looking toward -Z.
  function fit(objs, pitch, fov, margin = 1.08) {
    const bb = new THREE.Box3(); objs.forEach(o => bb.expandByObject(o));
    const sp = Math.sin(pitch), cp = Math.cos(pitch), tn = Math.tan(fov * Math.PI / 360), cs = [];
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) cs.push([x, y * cp - z * sp, y * sp + z * cp]);
    const cx = (bb.min.x + bb.max.x) / 2, vs = cs.map(c => c[1]), vm = (Math.min(...vs) + Math.max(...vs)) / 2;
    let D = 0; for (const c of cs) D = Math.max(D, Math.abs(c[1] - vm) / tn + c[2], Math.abs(c[0] - cx) / (tn * 0.5625) + c[2]);
    D *= margin; const look = [cx, vm * cp, -vm * sp];
    return { pos: [cx, look[1] + D * sp, look[2] + D * cp], look, fov };
  }
  // A catalogue page: items on a grid on neutral ground, each with a name plate, plus reference figures.
  function cat(name, items, o = {}) {
    S3.shot(name, {
      build(s) {
        s.sky({ top: '#7f9cc0', horizon: '#e4e9ec' }); s.fog('#e4e9ec', 400, 2000);
        if (o.ground !== false) s.ground({ color: o.ground || '#8c9284', vary: 0.03, seg: 40 });
        const cols = o.cols || 3, dx = o.dx || 5, dz = o.dz || 6, lh = o.labelH || 0.34, pitch = o.pitch ?? 0.42, all = [];
        this.objs = items.map((it, i) => {
          const x = (i % cols - (cols - 1) / 2) * dx + (it.x || 0), z = -flr(i / cols) * dz + (it.z || 0);
          const obj = s.add(it.make(), { pos: [x, it.y || 0, z], rot: [0, it.ry || 0, 0] });
          const bb = new THREE.Box3().setFromObject(obj), front = it.front != null ? z + it.front : bb.max.z + 0.2 + lh * 0.4;
          all.push(obj, s.add(label(it.name, lh, { bg: '#1b232b', color: '#eef3f6', glow: true }), { pos: [x + (it.lx || 0), lh * 0.5 + 0.04, front + (it.lz || 0)], rot: [-pitch, 0, 0] }));
          return obj;
        });
        (o.people || []).forEach(p => all.push(s.add(person(p[3]), { pos: [p[0], p[1], p[2]], rot: [0, p[4] || 0, 0] })));
        if (o.extra) o.extra.call(this, s, all);
        this.cam = o.cam ? { pos: o.cam, look: o.look, fov: o.fov || 30 } : fit(all, pitch, o.fov || 16, o.margin);
        const bb = new THREE.Box3(); all.forEach(q => bb.expandByObject(q)); const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
        s.sun({ dir: o.sun || [5, 8, 6], color: '#fff2dc', intensity: 1.05, area: Math.max(sz.x, sz.z) * 0.62 + sz.y * 0.5, center: [c.x, 0, c.z] }); s.hemi('#d4e0f2', '#6c6a5c', 0.55);
      },
      update(s, lt) { this.objs.forEach(ob => ob.userData.animate && ob.userData.animate(lt)); if (o.tick) o.tick.call(this, s, lt); s.cam.set(this.cam); },
    });
  }

  // Inspect any builder up close: --shot nature_look --params '{"b":"pine","o":{"seed":3}}' --at 0,1,2,3  (the camera orbits 80 degrees per second)
  S3.shot('nature_look', {
    build(s, p) {
      s.sky({ top: '#7f9cc0', horizon: '#e4e9ec' }); s.fog('#e4e9ec', 90, 600);
      if (p.ground !== false) s.ground({ color: p.ground || '#8c9284', vary: 0.03, seg: 40 });
      const obj = this.obj = s.add(K[p.b](p.o || {})), bb = new THREE.Box3().setFromObject(obj), sz = bb.getSize(new THREE.Vector3());
      this.c = bb.getCenter(new THREE.Vector3()); this.w = Math.max(sz.x, sz.z); this.h = sz.y;
      s.sun({ dir: p.sun || [5, 8, 6], color: '#fff2dc', intensity: 1.05, area: Math.max(6, this.w, this.h) * 1.3, center: [this.c.x, 0, this.c.z] }); s.hemi('#d4e0f2', '#6c6a5c', 0.55);
      if (p.person !== false) s.add(person(), { pos: p.personAt || [bb.max.x + 0.5, 0, bb.max.z * 0.5] });
      if (p.sky) { s.sky({ top: '#3f79c4', horizon: '#cfe3f2' }); s.fog('#cfe3f2', 120, 900); s.skyDisc({ dir: [0.4, 0.5, -1] }); }
    },
    update(s, lt, d, t, p) {
      const o = this.obj.userData; if (o.animate) o.animate(lt * (p.speed || 1)); if (p.open != null && o.open) o.open(p.open);
      const fov = p.fov || 36, tn = Math.tan(fov * Math.PI / 360), w = this.w + (p.person !== false ? 1.4 : 0), D = Math.max(this.h / (2 * tn), w / (2 * tn * 0.5625)) * (p.zoom ? 1 / p.zoom : 1.2);
      if (p.cam) s.cam.set({ pos: p.cam, look: p.lookAt || [0, 1, 0], fov });
      else s.cam.set({ pos: S3.orbit([this.c.x, this.c.y, this.c.z], D, (p.a0 ?? 0.5) + lt * (p.spin ?? 1.4), D * (p.tilt ?? 0.3)), look: [this.c.x, this.c.y, this.c.z], fov });
    },
  });

  cat('nature_cat1', [
    { name: 'pine', make: () => K.pine({ seed: 1 }) },
    { name: 'snowyPine', make: () => K.snowyPine({ seed: 2 }) },
    { name: 'broadleaf', make: () => K.broadleaf({ seed: 1 }) },
    { name: 'birch', make: () => K.birch({ seed: 1 }) },
    { name: 'deadTree', make: () => K.deadTree({ seed: 1 }) },
    { name: 'palm', make: () => K.palm({ seed: 1 }) },
  ], { cols: 2, dx: 7.4, dz: 19, labelH: 0.62, pitch: 0.38, fov: 14, people: [[0, 0, 0.5], [0, 0, -18.5], [0, 0, -37.5]] });

  cat('nature_cat2', [
    { name: 'bush', make: () => K.bush({ seed: 1 }) },
    { name: 'bush berries', make: () => K.bush({ seed: 2, berries: true, size: 1.1 }) },
    { name: 'stump', make: () => K.stump({ seed: 1 }) },
    { name: 'log', make: () => K.log({ seed: 1 }) },
    { name: 'logSeat', make: () => K.logSeat({ seed: 1 }) },
    { name: 'logSeat upright', make: () => K.logSeat({ seed: 2, upright: true }) },
    { name: 'grass + grassTuft', make: () => grp(K.grass({ seed: 1, count: 90, area: 1.2 }), K.grassTuft({ seed: 1 }).at(1.55, 0, 0.9)) },
    { name: 'flowerPatch', make: () => K.flowerPatch({ seed: 1, count: 36, area: 1.1 }) },
    { name: 'reeds', make: () => K.reeds({ seed: 1 }) },
  ], { cols: 2, dx: 4.2, dz: 4.6, labelH: 0.2, pitch: 0.5, fov: 14, people: [[0, 0, -4.4], [0, 0, -13.6]] });

  cat('nature_cat3', [
    { name: 'rock', make: () => K.rock({ seed: 1 }) },
    { name: 'rock moss', make: () => K.rock({ seed: 2, size: 0.9, moss: 0.7 }) },
    { name: 'boulder', make: () => K.boulder({ seed: 1 }) },
    { name: 'rockPile', make: () => K.rockPile({ seed: 1 }) },
  ], { cols: 2, dx: 4, dz: 4.5, labelH: 0.24, pitch: 0.5, fov: 14, people: [[0, 0, -2]] });
})();
