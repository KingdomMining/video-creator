// fx_test.js - catalogue and scene shots for KitFX (renderer/kit/fx.js).
//   node renderer/render.js --shot fx_cat1 --scripts renderer/lab/fx_test.js --at 0.5,1.5,2.5 --scale 0.6 --clean --out /tmp/fx_cat1.jpg
// Shots: fx_cat1 .. fx_catN (labelled catalogue pages, render each at three times), fx_scene (night), fx_scene_day.
(() => {
  const { box, boxB, cyl, cylB, coneB, ball, blob, grp, glow, flare, ramp, label, plane, quad } = S3;
  const floor = Math.floor;

  // 1.75 m reference figure made of simple boxes
  const person = (shirt = '#c8483a', pants = '#2c3a52') => grp(boxB(0.16, 0.86, 0.18, pants).at(-0.11, 0, 0), boxB(0.16, 0.86, 0.18, pants).at(0.11, 0, 0), boxB(0.42, 0.6, 0.24, shirt).at(0, 0.86, 0),
    box(0.12, 0.6, 0.12, shirt).at(-0.29, 1.15, 0), box(0.12, 0.6, 0.12, shirt).at(0.29, 1.15, 0), box(0.2, 0.24, 0.22, '#e2b08e').at(0, 1.63, 0));

  const MOOD = {
    studio(s) { s.sky({ top: '#1a212c', horizon: '#3a4350' }); s.fog('#3a4350', 30, 95); s.ground({ color: '#5b6067', vary: 0.05, seg: 80 }); s.sun({ dir: [4, 7, 5], color: '#fff3e2', intensity: 0.75, area: 16, center: [0, 0, -4] }); s.hemi('#b9c8e0', '#3a3c40', 0.4); },
    dark(s) { s.sky({ top: '#070a11', horizon: '#161c28' }); s.fog('#161c28', 25, 85); s.ground({ color: '#4b5058', vary: 0.05, seg: 80 }); s.sun({ dir: [-3, 7, 4], color: '#a9c0ff', intensity: 0.25, area: 16, center: [0, 0, -4] }); s.hemi('#44557a', '#15171c', 0.32); },
    day(s) { s.sky({ top: '#2a66b8', horizon: '#bfe0f5' }); s.fog('#bfe0f5', 40, 160); s.ground({ color: '#6f8a58', vary: 0.06, seg: 80 }); s.sun({ dir: [4, 6, 3], color: '#fff0d8', intensity: 1.0, area: 16, center: [0, 0, -4] }); s.hemi('#bcd8ff', '#4a5a36', 0.55); },
  };

  // A catalogue page: items = [[label, (s, [x, 0, z], shot) => handle or {update(lt)}], ...] laid out on a grid that recedes from the camera.
  function page(name, o) {
    S3.shot(name, {
      build(s) {
        MOOD[o.mood || 'studio'](s); this.cells = [];
        const cols = o.cols || 2, dx = o.dx || 3.6, dz = o.dz || 4.2;
        o.items.forEach((it, i) => { const c = i % cols, r = floor(i / cols), x = (c - (cols - 1) / 2) * dx, z = -r * dz;
          s.add(label(it[0], o.labelH || 0.26, { bg: '#10151c', color: '#ffe14a' }), { pos: [x, 0.2, z + (o.labelZ ?? 1.55)], rot: [-0.5, 0, 0] });
          this.cells.push(it[1](s, [x, 0, z], this) || {}); });
        s.add(person(), { pos: o.figure || [0, 0, 0.4] });
        if (o.extra) o.extra.call(this, s);
      },
      update(s, lt) { for (const c of this.cells) if (c.update) c.update(lt); if (o.update) o.update.call(this, s, lt);
        s.cam.set(typeof o.cam === 'function' ? o.cam(lt) : (o.cam || { pos: [0, 7.6, 10.6], look: [0, 0.6, -4.3], fov: 54 })); },
      post: o.post || { bloom: 0.38, vignette: 0.45, grain: 0.03 },
    });
  }

  page('fx_cat1', { mood: 'studio', items: [
    ['rain', (s, p) => KitFX.rain(s, { center: p, area: 1.4, count: 200, splashes: 40, height: 6 })],
    ['rain (windy)', (s, p) => KitFX.rain(s, { center: p, area: 1.4, count: 200, splashes: 40, height: 6, wind: [5, 1] })],
  ] });
})();
