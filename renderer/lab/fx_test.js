// fx_test.js - catalogue and scene shots for KitFX (renderer/kit/fx.js).
//   node renderer/render.js --shot fx_cat1 --scripts renderer/lab/fx_test.js --at 0.5,1.5,2.5 --scale 0.6 --clean --out /tmp/fx_cat1.jpg
// Shots: fx_cat1 .. fx_catN  labelled catalogue pages on a terraced stand; render each at 0.5, 1.5 and 2.5 s (burst effects are
//                            timed so those three moments show the start, the middle and the end of their life)
//        fx_look             one catalogue item up close:  --params '{"fx":"campfire"}'   (optional: "mood", "d" camera distance, "h" look height, "side")
//        fx_scene (night street in a storm), fx_scene_day (autumn clearing), and more composed scenes further down.
(() => {
  const { box, boxB, cyl, cylB, coneB, ball, blob, grp, glow, flare, ramp, label, plane, quad } = S3;
  const floor = Math.floor, PI = Math.PI;

  // 1.75 m reference figure made of simple boxes
  const person = (shirt = '#c8483a', pants = '#2c3a52') => grp(boxB(0.16, 0.86, 0.18, pants).at(-0.11, 0, 0), boxB(0.16, 0.86, 0.18, pants).at(0.11, 0, 0), boxB(0.42, 0.6, 0.24, shirt).at(0, 0.86, 0),
    box(0.12, 0.6, 0.12, shirt).at(-0.29, 1.15, 0), box(0.12, 0.6, 0.12, shirt).at(0.29, 1.15, 0), box(0.2, 0.24, 0.22, '#e2b08e').at(0, 1.63, 0));

  const MOOD = {
    studio: { sky: ['#1a212c', '#3a4350'], fog: ['#3a4350', 60, 200], ground: '#5b6067', stand: '#666b72', sun: ['#fff3e2', 0.8, [5, 8, 9]], hemi: ['#b9c8e0', '#3a3c40', 0.42] },
    dark: { sky: ['#06080e', '#131824'], fog: ['#131824', 60, 200], ground: '#3f444c', stand: '#484d55', sun: ['#a9c0ff', 0.2, [-4, 8, 9]], hemi: ['#3f4f72', '#131519', 0.3] },
    day: { sky: ['#2a66b8', '#bfe0f5'], fog: ['#bfe0f5', 70, 260], ground: '#6f8a58', stand: '#8a8f86', sun: ['#fff0d8', 1.0, [5, 8, 9]], hemi: ['#bcd8ff', '#4a5a36', 0.55] },
  };
  function setMood(s, name, c, area) { const m = MOOD[name] || MOOD.studio; s.sky({ top: m.sky[0], horizon: m.sky[1] }); s.fog(m.fog[0], m.fog[1], m.fog[2]); s.ground({ color: m.ground, vary: 0.04, seg: 120 });
    s.sun({ dir: m.sun[2], color: m.sun[0], intensity: m.sun[1], area: area || 16, center: c || [0, 0, 0] }); s.hemi(m.hemi[0], m.hemi[1], m.hemi[2]); return m; }

  // ---- catalogue items: name -> make(s, pos, T) where T = {at, every} places a burst so that 0.5 / 1.5 / 2.5 s show three phases of it ----
  const ITEMS = {};
  const item = (name, make, o = {}) => { ITEMS[name] = { name, make, ...o }; };
  // choose {at, every} so that the sample times hit early, middle and late moments of an effect that lives `L` seconds
  function fit(L, times = [0.5, 1.5, 2.5]) {
    if (!L) return {}; const want = [0.12, 0.42, 0.75]; let best = null;
    for (let ev = L + 0.1; ev < L + 3.2; ev += 0.05) for (let t1 = 0.02; t1 < L; t1 += 0.02) { const taus = times.map(t => ((t - times[0] + t1) % ev) / L).sort((a, b) => a - b), sc = taus.reduce((q, x, i) => q + Math.abs(x - want[i]) + (x > 0.97 ? 5 : 0), 0); if (!best || sc < best.sc) best = { sc, every: +ev.toFixed(2), at: +(times[0] - t1).toFixed(2) }; }
    return { at: best.at, every: best.every };
  }

  // A catalogue page: a terraced stand (so tall effects do not hide the ones behind), two items per step, each with its label and a figure for scale.
  function page(name, o) {
    const tiers = Math.ceil(o.items.length / 2), rise = o.rise || 2.7, depth = o.depth || 3.3, cx = o.cellX || 2.05, el = o.elev ?? 0.3, dist = 36;
    const ym = tiers * rise / 2 + 0.25, zm = -(tiers - 1) * depth / 2, span = tiers * (rise * Math.cos(el) + depth * Math.sin(el)) + 1.5;
    S3.shot(name, {
      build(s) {
        const m = setMood(s, o.mood, [0, ym, zm], Math.max(14, span * 0.75)); this.cells = [];
        for (let r = 1; r <= tiers; r++) { const len = (tiers - r) * depth + 0.6; s.add(boxB(26, r * rise, len, m.stand, { vary: 0.03, seed: r }), { pos: [0, 0, -(r - 0.5) * depth - len / 2] }); }
        o.items.forEach((nm, i) => { const it = ITEMS[nm], c = i % 2, r = floor(i / 2), p = [(c ? 1 : -1) * cx, r * rise, -r * depth];
          s.add(label(nm, 0.24, { bg: '#0d1218', color: '#ffe14a' }), { pos: [p[0], p[1] + 0.16, p[2] + depth / 2 - 0.3], rot: [-0.45, 0, 0] });
          this.cells.push(it.make(s, p, fit(it.L)) || {}); });
        for (let r = 0; r < tiers; r++) s.add(person(), { pos: [0, r * rise, -r * depth + 0.2] });
      },
      update(s, lt) { for (const c of this.cells) if (c.update) c.update(lt); s.cam.set({ pos: [0, ym + dist * Math.sin(el), zm + dist * Math.cos(el)], look: [0, ym, zm], fov: 2 * Math.atan(span / 2 / dist) * 180 / PI }); },
      post: o.post || { bloom: 0.38, vignette: 0.35, grain: 0.03 },
    });
  }
  // One item up close, at eye level.
  S3.shot('fx_look', {
    key: p => JSON.stringify(p),
    build(s, p) { const it = ITEMS[p.fx] || Object.values(ITEMS)[0]; setMood(s, p.mood || it.mood || 'studio', [0, 0, 0], 12); s.add(person(), { pos: [p.side ?? -1.5, 0, 0] });
      this.cell = it.make(s, [0, 0, 0], p.at != null ? { at: p.at, every: p.every } : { at: 0.3, every: (it.L || 2) + 0.8 }) || {}; this.it = it; },
    update(s, lt, d, t, p) { if (this.cell.update) this.cell.update(lt); const dd = p.d || this.it.d || 5, hh = p.h ?? this.it.h ?? 1.0; s.cam.set({ pos: [dd * 0.3, hh + dd * 0.12, dd], look: [0, hh, 0], fov: 46 }).shake(0.006, lt); },
    post: { bloom: 0.38, vignette: 0.5, grain: 0.04 },
  });

  // ---------------- weather (shown in a small column instead of around the camera) ----------------
  const Wx = { area: 1.3, height: 2.6 };
  item('rain', (s, p) => KitFX.rain(s, { ...Wx, center: p, count: 110, splashes: 30 }), { h: 1.2 });
  item('storm', (s, p) => KitFX.storm(s, { ...Wx, center: p, count: 240, splashes: 46, spray: 3 }), { h: 1.2 });
  item('snow', (s, p) => KitFX.snow(s, { ...Wx, center: p, count: 170 }), { h: 1.2 });
  item('hail', (s, p) => KitFX.hail(s, { ...Wx, center: p, count: 50, bounces: 40 }), { h: 1.2 });
  item('leaves', (s, p) => KitFX.leaves(s, { ...Wx, center: p, count: 26 }), { h: 1.2 });
  item('ash', (s, p) => KitFX.ash(s, { ...Wx, center: p, count: 130 }), { h: 1.2 });
  item('dust', (s, p) => KitFX.dust(s, { center: p, area: 1.4, count: 90, haze: 4, height: 2 }), { h: 1 });
  item('motes', (s, p) => KitFX.motes(s, { pos: p, size: [2.2, 2.2, 2.2] }), { h: 1.1, mood: 'dark' });
  item('fogBank', (s, p) => KitFX.fogBank(s, { center: p, area: 1.6, count: 4, size: 2.4, height: 2.0 }), { h: 1 });
  item('groundMist', (s, p) => KitFX.groundMist(s, { center: p, area: 1.5, count: 12, size: 1.5 }), { h: 0.6 });
  item('lightning', (s, p) => KitFX.lightning(s, { pos: [p[0], p[1], p[2] - 0.6], height: 2.5, width: 0.035, jag: 0.06, times: [0.45, 1.42, 2.4], flash: 0.35, sky: 0.1 }), { h: 1.3, mood: 'dark' });

  // ---------------- fire and smoke ----------------
  const stand = (s, p, h, w = 0.5) => s.add(boxB(w, h, w, '#4a4038', { vary: 0.08 }), { pos: p });   // a little plinth for small flames
  item('candle', (s, p) => { stand(s, p, 0.75); return KitFX.candle(s, { pos: [p[0], p[1] + 0.75, p[2]] }); }, { h: 0.85, d: 1.6, side: -0.7, mood: 'dark' });
  item('torch', (s, p) => KitFX.torch(s, { pos: [p[0], p[1] + 0.9, p[2]] }), { h: 1.4, d: 2.6, side: -0.8, mood: 'dark' });
  item('campfire', (s, p) => KitFX.campfire(s, { pos: p }), { h: 0.7, d: 4, mood: 'dark' });
  item('bonfire', (s, p) => KitFX.bonfire(s, { pos: p, smokeHeight: 4 }), { h: 1.6, d: 7.5, side: -2.4, mood: 'dark' });
  item('fire (green)', (s, p) => KitFX.fire(s, { pos: p, palette: 'green', smoke: 0 }), { h: 0.6, d: 3.5, mood: 'dark' });
  item('fire (blue)', (s, p) => KitFX.fire(s, { pos: p, palette: 'blue', smoke: 0, light: false }), { h: 0.6, d: 3.5, mood: 'dark' });
  item('smokeColumn', (s, p) => KitFX.smokeColumn(s, { pos: p, height: 3.2, width: 0.7, count: 14 }), { h: 1.5, d: 6 });
  item('chimneySmoke', (s, p) => { s.add(grp(boxB(0.5, 0.9, 0.5, '#8a4a3a', { vary: 0.1 }), boxB(0.6, 0.1, 0.6, '#6a3a2e').at(0, 0.9, 0)), { pos: p }); return KitFX.chimneySmoke(s, { pos: [p[0], p[1] + 1.0, p[2]], height: 1.9 }); }, { h: 1.6, d: 5 });
  item('steamJet', (s, p) => { s.add(cylB(0.06, 0.06, 0.5, 7, '#7b8088', { metal: 0.5 }), { pos: p }); return KitFX.steamJet(s, { pos: [p[0], p[1] + 0.5, p[2]], length: 1.7, width: 0.6 }); }, { h: 1.1, d: 4 });
  item('breath', (s, p) => { s.add(person('#3a6ea8'), { pos: [p[0] - 0.4, p[1], p[2]], rot: [0, 1.2, 0] }); return KitFX.breath(s, { pos: [p[0] - 0.4 + 0.11, p[1] + 1.58, p[2] + 0.04], dir: [1, -0.1, 0.35], period: 1.0 }); }, { h: 1.5, d: 2.6, side: -3, mood: 'dark' });

  page('fx_cat1', { mood: 'studio', items: ['rain', 'storm', 'snow', 'hail', 'leaves', 'ash', 'dust', 'groundMist'] });
  page('fx_cat2', { mood: 'dark', items: ['candle', 'torch', 'campfire', 'fire (green)', 'smokeColumn', 'chimneySmoke', 'steamJet', 'breath'] });
})();
