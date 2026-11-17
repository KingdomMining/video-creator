// Catalogue and test shots for KitFantasy (renderer/kit/fantasy.js).
//   node renderer/render.js --shot fantasy_cat1 --scripts renderer/lab/fantasy_test.js --at 0.5 --out /tmp/x.jpg --clean
//   node renderer/render.js --shot fantasy_close --params '{"b":"chest","k":1}' --scripts renderer/lab/fantasy_test.js --at 1 --out /tmp/x.jpg --clean
// Shots: fantasy_cat1..N (labelled catalogue pages), fantasy_anim1..N (animated builders at several times: use --at 0,1,2,3),
//        fantasy_scene (a composed mood scene), fantasy_set_* (the one-call sets), fantasy_close (any builder, close up).
(() => {
  const K = KitFantasy, T = THREE, { box, boxB, grp, label, ramp } = S3;

  /** 1.75 m reference figure made of simple boxes. */
  const figure = (shirt = '#c8483a') => grp(boxB(0.15, 0.85, 0.17, '#2c3a52').at(-0.1, 0, 0), boxB(0.15, 0.85, 0.17, '#2c3a52').at(0.1, 0, 0), boxB(0.42, 0.6, 0.24, shirt).at(0, 0.85, 0),
    box(0.11, 0.58, 0.13, shirt).at(-0.28, 1.14, 0), box(0.11, 0.58, 0.13, shirt).at(0.28, 1.14, 0), boxB(0.2, 0.24, 0.21, '#e2b08e').at(0, 1.51, 0));

  /** Camera that frames a set of boxes (or one box) from direction (az, el in degrees), filling the vertical frame. */
  function fit(boxes, az = 20, el = 22, fov = 26, m = 0.9) {
    if (!Array.isArray(boxes)) boxes = [boxes];
    const a = az * Math.PI / 180, e = el * Math.PI / 180, dir = new T.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)), cam = new T.PerspectiveCamera(fov, 1080 / 1920, 0.1, 5000), pts = [], v = new T.Vector3();
    for (const bb of boxes) for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) pts.push(new T.Vector3(x, y, z));
    const c = new T.Box3().setFromPoints(pts).getCenter(new T.Vector3()); let dist = 200;
    // two passes: centre the projected extent, then find the distance at which everything fits
    for (let pass = 0; pass < 6; pass++) {
      cam.position.copy(c).addScaledVector(dir, dist); cam.lookAt(c); cam.updateMatrixWorld();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of pts) { v.copy(p).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
      const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 1), hh = Math.tan(fov * Math.PI / 360) * dist, hw = hh * 1080 / 1920;
      c.addScaledVector(right, (x0 + x1) / 2 * hw).addScaledVector(up, (y0 + y1) / 2 * hh);
      dist *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / m;
    }
    cam.position.copy(c).addScaledVector(dir, dist);
    return { pos: cam.position.toArray(), look: c.toArray(), fov };
  }
  const daylight = (s, area, o = {}) => {
    s.sky({ top: o.top || '#6f8fb8', horizon: o.horizon || '#cdd6de' }); s.fog(o.horizon || '#cdd6de', 200, 1200); s.ground({ color: o.ground || '#8d9187' });
    s.sun({ dir: o.dir || [5, 9, 7], color: '#fff3df', intensity: o.sun ?? 1.0, area: area, center: o.center || [0, 0, 0] }); s.hemi('#dfe9ff', '#6e675b', o.hemi ?? 0.55);
  };

  /**
   * A labelled catalogue page `name`, plus `name_tour`: a close-up of item i at time i (use --at 0,1,2,... for a contact sheet).
   * items: [[label, () => Object3D, {rot, fig: false, lift, az, el}]...]
   * o: {cols: 2, cell: [dx, dz], az, el, fov, label (text height in m), figs: true (a figure beside every item) | false (one at the front left), title, stand: true (stepped display for small props)}
   */
  function catalogue(name, items, o = {}) {
    S3.shot(name, {
      post: { bloom: 0.25, vignette: 0.25, grain: 0 },
      build(s) {
        const cols = o.cols || 2, [dx, dz] = o.cell || [4, 4], rows = Math.ceil(items.length / cols), lh = o.label || dx * 0.07, el = o.el ?? 34, az = o.az ?? 14, all = grp(), bbs = [];
        daylight(s, Math.max(cols * dx, rows * dz) * 0.8 + 3, o);
        const th = o.step || 0.36, td = o.stand ? dz : 0;
        if (o.stand) for (let r = 0; r < rows; r++) s.add(boxB(cols * dx + 0.1, th * (rows - r), td, '#b9b4a8'), { pos: [0, 0, -(r + 0.5) * td] });
        items.forEach(([nm, make, io = {}], i) => {
          const c = i % cols, r = Math.floor(i / cols), x = (c - (cols - 1) / 2) * dx, y = o.stand ? th * (rows - r) : 0, z = o.stand ? -(r + 0.5) * td : (r - (rows - 1) / 2) * dz;
          const obj = make(); obj.position.set(x + (io.x || 0), y + (io.lift || 0), z + (io.z || 0)); if (io.rot != null) obj.rotation.y = io.rot; if (io.scale) obj.scale.setScalar(io.scale); all.add(obj);
          const ob = new T.Box3().setFromObject(obj); bbs.push(ob);
          const lb = label(nm, lh, { bg: 'rgba(18,22,28,.85)', color: '#ffffff' }), lw = lh * lb.geometry.parameters.width / lb.geometry.parameters.height;
          if (o.stand) lb.position.set(x, y - lh * 0.62, z + td / 2 + 0.006); else { lb.position.set(Math.max(x - dx * 0.46 + lw / 2, Math.min(x, ob.min.x + lw / 2)), lh * 0.55, Math.max(ob.max.z, z + 0.2) + lh * 1.1); lb.rotation.x = -el * Math.PI / 180 * 0.7; }
          all.add(lb); bbs.push(new T.Box3().setFromObject(lb));
          if (o.figs !== false && !o.stand && io.fig !== false) { const f = figure(); f.position.set(ob.max.x + 0.6, 0, Math.min(ob.max.z, z + dz * 0.3)); all.add(f); bbs.push(new T.Box3().setFromObject(f)); }
        });
        if (o.figs === false || o.stand) { const bb = new T.Box3(); bbs.forEach(b => bb.union(b)); const f = figure(); f.position.set(bb.min.x - 0.45, 0, o.stand ? 0.2 : bb.max.z - 0.3); all.add(f); bbs.push(new T.Box3().setFromObject(f)); }
        s.add(all); K.animate(s, all); this.cam = fit(bbs, az, el, o.fov || 22, 0.94);
      },
      update(s, lt) { s.cam.set(this.cam); },
      overlay(c) { if (!o.title) return; c.font = '800 40px Inter'; c.textAlign = 'left'; c.fillStyle = 'rgba(10,14,20,.78)'; const w = c.measureText(o.title).width; c.fillRect(28, 26, w + 44, 64); c.fillStyle = '#ffe9a8'; c.fillText(o.title, 50, 72); },
    });
    S3.shot(name + '_tour', {
      post: { bloom: 0.3, vignette: 0.3, grain: 0 },
      build(s, p) {
        daylight(s, 10, { dir: p.dir }); this.sun = s._sun; this.objs = []; this.cams = []; this.fig = s.add(figure());
        items.forEach(([nm, make, io = {}], i) => { const obj = make(); if (io.rot != null) obj.rotation.y = io.rot; s.add(obj); const bb = new T.Box3().setFromObject(obj), sz = bb.getSize(new T.Vector3()), ext = Math.max(sz.x, sz.y, sz.z); this.objs.push({ obj, bb, ext, nm });
          this.cams.push(fit(bb, p.az ?? io.az ?? (i % 2 ? -24 : 24), p.el ?? io.el ?? 14, p.fov || 30, p.m || 0.88)); });
        K.animate(s, ...this.objs.map(x => x.obj));
      },
      update(s, lt, d, t, p) {
        const i = Math.min(items.length - 1, Math.floor(lt + 1e-6)), cur = this.objs[i]; this.objs.forEach((x, j) => { x.obj.visible = j === i; });
        const a = cur.ext * 0.9 + 1.5, sc = this.sun.shadow.camera; sc.left = -a; sc.right = a; sc.top = a; sc.bottom = -a; sc.updateProjectionMatrix();
        this.fig.position.set(cur.bb.max.x + 0.5, 0, cur.bb.max.z - 0.15); this.fig.visible = p.fig !== false; this.cur = cur;
        const U = cur.obj.userData, k = p.k; if (k != null) { if (U.open) U.open(k); if (U.lower) U.lower(k); }
        s.cam.set(this.cams[i]);
      },
      overlay(c) { c.font = '800 54px Inter'; c.textAlign = 'left'; c.fillStyle = 'rgba(10,14,20,.8)'; const w = c.measureText(this.cur.nm).width; c.fillRect(28, 26, w + 44, 82); c.fillStyle = '#ffe9a8'; c.fillText(this.cur.nm, 50, 86); },
    });
  }

  catalogue('fantasy_cat1', [
    ['wall', () => K.wall()],
    ['towerRound', () => K.towerRound()],
    ['towerSquare', () => K.towerSquare()],
    ['towerRound {top:"both"}', () => K.towerRound({ top: 'both', height: 9, flag: '#2c5196' })],
    ['gatehouse', () => K.gatehouse({ open: 0.35 })],
    ['keep', () => K.keep()],
    ['drawbridge', () => K.drawbridge({ open: 0.75 })],
    ['towerSquare {top:"roof"}', () => K.towerSquare({ top: 'roof', height: 8, flag: null })],
  ], { cols: 2, cell: [18, 24], title: 'KitFantasy 1 · castle', label: 0.9 });

  catalogue('fantasy_cat2', [
    ['house', () => K.house()],
    ['house {roof:"tile", front:"eave"}', () => K.house({ roof: 'tile', front: 'eave', width: 7, depth: 5, seed: 3, shutters: '#3d6a8a' })],
    ['tavern', () => K.tavern()],
    ['forge', () => K.forge()],
    ['windmill', () => K.windmill()],
    ['stoneBridge', () => K.stoneBridge()],
  ], { cols: 2, cell: [14, 16], title: 'KitFantasy 2 · village buildings', label: 0.7 });

  catalogue('fantasy_cat3', [
    ['marketStall', () => K.marketStall()],
    ['marketStall {goods:"potions"}', () => K.marketStall({ goods: 'potions', color: '#5e3c93', stripe: '#e9d8a6' })],
    ['cart', () => K.cart()],
    ['cart {type:"wagon"}', () => K.cart({ type: 'wagon', load: 'barrels' })],
    ['haystack', () => K.haystack()],
    ['well', () => K.well()],
    ['anvil', () => K.anvil()],
    ['barrel / crate / sack', () => grp(K.barrel().at(-0.6, 0, 0), K.barrel({ open: true, fill: 'apples' }).at(0.25, 0, -0.3), K.crate().at(0.9, 0, 0.3), K.sack().at(0.1, 0, 0.6))],
    ['lantern', () => K.lantern()],
  ], { cols: 2, cell: [5, 5.4], title: 'KitFantasy 3 · village props', figs: false });

  /** Any builder, close up: --params '{"b":"chest","o":{...},"k":1,"az":25,"el":15,"fov":30,"night":false,"fig":true}' */
  S3.shot('fantasy_close', {
    post: { bloom: 0.3, vignette: 0.3, grain: 0 },
    build(s, p) {
      const obj = K[p.b || 'wallTorch'](p.o || {}), bb = new T.Box3().setFromObject(obj), size = bb.getSize(new T.Vector3()), ext = Math.max(size.x, size.y, size.z);
      if (p.night) { s.sky({ top: '#05070f', horizon: '#141b30', stars: 300 }); s.fog('#0d1322', 40, 300); s.ground({ color: '#2a2f33' }); s.sun({ dir: [-4, 7, 5], color: '#8fb0ff', intensity: 0.25, area: ext * 1.3 + 2 }); s.hemi('#35486e', '#14161a', 0.3); K.lightFlames(s, obj, { max: 3 }); }
      else daylight(s, ext * 1.3 + 2, { dir: p.dir });
      s.add(obj); this.obj = obj; K.animate(s, obj);
      if (p.fig !== false) { const f = figure(); f.position.set(bb.max.x + 0.5, 0, bb.max.z - 0.2); s.add(f); if (p.figIn) bb.expandByObject(f); }
      if (p.zoom) { const c = bb.getCenter(new T.Vector3()), h = size.clone().multiplyScalar(0.5 / p.zoom); if (p.at) c.set(p.at[0], p.at[1], p.at[2]); bb.set(c.clone().sub(h), c.clone().add(h)); }
      this.cam = fit(bb, p.az ?? 25, p.el ?? 15, p.fov || 30, 0.9);
    },
    update(s, lt, d, t, p) { const U = this.obj.userData; if (p.k != null) { if (U.open) U.open(p.k); if (U.lower) U.lower(p.k); } if (p.fn && U[p.fn]) U[p.fn](p.k ?? lt); s.cam.set(this.cam); },
  });
})();
