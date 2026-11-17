// Props kit test. Registers:
//   props_cat1 .. props_catN   labelled catalogue shots with a 1.75 m reference figure
//   props_close                close-up of any builders: --params '{"items":["mug",["laptop",{"open":0.4}]],"pitch":30}'
//   props_anim                 the animated builders (render at several times: --at 0,1,2,3)
//   props_scene                a composed scene under mood lighting
//   props_audit                prints size / triangles / grip of every builder (console.warn)
(() => {
  const T = THREE, { box, boxB, cylB, ball, grp, label } = S3, K = KitProps, PI = Math.PI;

  // 1.75 m reference figure made of simple boxes
  const figure = (col = '#77818d') => grp(
    boxB(0.15, 0.86, 0.17, '#59626e').at(-0.1, 0, 0), boxB(0.15, 0.86, 0.17, '#59626e').at(0.1, 0, 0),
    boxB(0.4, 0.6, 0.22, col).at(0, 0.86, 0), boxB(0.1, 0.05, 0.1, '#c9a58c').at(0, 1.46, 0), boxB(0.2, 0.24, 0.21, '#d1ad94').at(0, 1.51, 0),
    boxB(0.11, 0.56, 0.12, col).at(-0.26, 0.88, 0), boxB(0.11, 0.56, 0.12, col).at(0.26, 0.88, 0), boxB(0.09, 0.1, 0.1, '#d1ad94').at(-0.26, 0.78, 0), boxB(0.09, 0.1, 0.1, '#d1ad94').at(0.26, 0.78, 0));

  // camera that frames a set of world points inside the vertical frame
  function fit(pts, o) {
    const cam = new T.PerspectiveCamera(o.fov, 1080 / 1920, 0.05, 200), pad = o.pad || [50, 120, 50, 60], yaw = o.yaw || 0, pitch = o.pitch || 0.4;
    const dir = new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)), bb = new T.Box3().setFromPoints(pts), c = bb.getCenter(new T.Vector3()), v = new T.Vector3();
    const L = -1 + 2 * pad[0] / 1080, R = 1 - 2 * pad[2] / 1080, Tp = 1 - 2 * pad[1] / 1920, Bt = -1 + 2 * pad[3] / 1920; let dist = 4;
    for (let it = 0; it < 40; it++) {
      cam.position.copy(c).addScaledVector(dir, dist); cam.lookAt(c); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const p of pts) { v.copy(p).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
      const sc = Math.max((x1 - x0) / (R - L), (y1 - y0) / (Tp - Bt)), th = Math.tan(o.fov * PI / 360) * dist;
      const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      c.addScaledVector(right, ((x0 + x1) / 2 - (L + R) / 2) * th * (1080 / 1920) * 0.8).addScaledVector(up, ((y0 + y1) / 2 - (Tp + Bt) / 2) * th * 0.8); dist *= 1 + (sc - 1) * 0.8;
    }
    return { pos: cam.position.toArray(), look: c.toArray(), fov: o.fov };
  }
  const corners = obj => { obj.updateMatrixWorld(true); const bb = new T.Box3(); obj.traverse(m => { if (m.isMesh && !m.userData.fx && !(m.parent && m.parent.userData.fx)) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); } }); const a = bb.min, b = bb.max; return bb.isEmpty() ? [] : [0, 1, 2, 3, 4, 5, 6, 7].map(i => new T.Vector3(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z)); };
  const look = s => { s.sky({ top: '#8fa3b8', horizon: '#cdd4d8' }); s.fog('#cdd4d8', 40, 160); s.ground({ color: '#a7a399', vary: 0.03, seg: 40 }); s.hemi('#e2ebf5', '#8d877c', 0.62); };
  const title = (c, text) => { c.font = '800 40px Inter'; c.textAlign = 'left'; c.fillStyle = 'rgba(10,14,20,.78)'; const w = c.measureText(text).width + 48; c.fillRect(0, 34, w, 66); c.fillStyle = '#ffffff'; c.fillText(text, 24, 82); };
  const make = it => { const [name, opt, tf] = Array.isArray(it) ? it : [it, {}, {}]; if (!K[name]) throw new Error('KitProps.' + name + ' is not a builder'); const p = K[name](opt || {}); if (tf && tf.rot) p.rotation.set(tf.rot[0], tf.rot[1], tf.rot[2]); return { name: (tf && tf.label) || name, p, tf: tf || {} }; };

  /** Catalogue shot. o.mode 'stand' (small props on a stepped stand in front of the figure) or 'floor' (large props on the ground beside it). */
  function cat(n, text, items, o = {}) {
    S3.shot('props_cat' + n, {
      post: { bloom: 0.14, vignette: 0.22, grain: 0 },
      build(s) {
        look(s); const pts = [], live = [], cols = o.cols || 3, rows = Math.ceil(items.length / cols), stand = o.mode !== 'floor';
        const cw = o.cell || (stand ? 0.33 : 0.95), cd = o.depth || (stand ? 0.31 : 1.0), y0 = o.y0 ?? 0.75, rise = o.rise ?? 0.07, lh = o.lh || (stand ? 0.034 : 0.1);
        s.sun({ dir: o.sun || [2.2, 6, 4.5], color: '#fff3e2', intensity: 0.95, area: stand ? 2.4 : 4.2, center: [0, 0.6, 0] });
        const zc = i => ((rows - 1) / 2 - i) * cd, W = cols * cw + (stand ? 0.05 : 0);
        if (stand) { for (let i = 0; i < rows; i++) s.add(boxB(W + 0.08, 0.05 + i * rise, cd + (i ? 0 : 0.04), i % 2 ? '#6b727b' : '#737a83', { vary: 0.02 }), { pos: [0, y0 - 0.05, zc(i) + (i ? 0 : 0.02)] }); for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.add(boxB(0.06, y0 - 0.05, 0.06, '#4b5159'), { pos: [sx * (W / 2 - 0.02), 0, sz * (rows * cd / 2 - 0.04)] }); }
        items.forEach((it, k) => {
          const { name, p, tf } = make(it), c = k % cols, i = Math.floor(k / cols), x = (c - (cols - 1) / 2) * cw, y = stand ? y0 + i * rise : 0;
          s.add(p, { pos: [x + (tf.dx || 0), y + (tf.dy || 0), zc(i) + (tf.dz || 0) - (stand ? 0.03 : 0)] }); if (tf.scale) p.scale.setScalar(tf.scale); pts.push(...corners(p)); if (p.userData.update) live.push(p);
          const lb = label(name, lh, { bg: '#10151c', color: '#f3f5f7', font: '700 80px Inter', pad: 22 });
          if (stand) s.add(lb, { pos: [x, y + lh * 0.3, zc(i) + cd / 2 - lh * 0.55], rot: [-0.95, 0, 0] }); else s.add(lb, { pos: [x, lh * 0.55, zc(i) + cd * 0.47], rot: [-0.5, 0, 0] });
          pts.push(...corners(lb));
        });
        const fg = s.add(figure(), { pos: o.fig || (stand ? [0, 0, zc(rows - 1) - cd / 2 - 0.2] : [((items.length % cols) - (cols - 1) / 2) * cw, 0, zc(rows - 1)]) }); pts.push(...corners(fg));
        if (!stand && items.length % cols === 0) fg.position.set(W / 2 + 0.35, 0, zc(rows - 1)), pts.push(...corners(fg));
        this.view = fit(pts, { fov: o.fov || (stand ? 50 : 36), yaw: o.yaw ?? (stand ? 0.12 : 0.3), pitch: o.pitch ?? (stand ? 0.6 : 0.42), pad: [36, 124, 36, 40] });
        K.animate(s, live);
      },
      update(s, lt) { s.cam.set(this.view); },
      overlay(c) { title(c, 'KitProps ' + n + ' · ' + text); },
    });
  }

  // close-up of any builders, on the ground with a 10 cm scale bar
  S3.shot('props_close', {
    post: { bloom: 0.14, vignette: 0.2, grain: 0 },
    key: p => JSON.stringify(p),
    build(s, p) {
      look(s); const items = (p.items || ['mug']).map(make), pts = [], live = [];
      const sizes = items.map(i => Math.max(i.p.userData.size[0], i.p.userData.size[2], i.p.userData.size[1] * 0.5)), cell = p.cell || Math.max(...sizes) * 1.3 + 0.02, cols = p.cols || (items.length <= 3 ? 1 : 2), rows = Math.ceil(items.length / cols), lh = p.lh || cell * 0.09;
      s.sun({ dir: p.sun || [2.2, 6, 4.5], color: '#fff3e2', intensity: p.dim ? 0.25 : 0.95, area: Math.max(0.6, cell * Math.max(cols, rows) * 0.9), center: [0, 0, 0] }); if (p.dim) s.exposure = 0.7;
      items.forEach((it, k) => { const c = k % cols, i = Math.floor(k / cols), x = (c - (cols - 1) / 2) * cell, z = ((rows - 1) / 2 - i) * cell; s.add(it.p, { pos: [x, 0, z] }); if (p.held) it.p.userData.held(), it.p.position.y = cell * 0.5; pts.push(...corners(it.p)); if (it.p.userData.update) live.push(it.p);
        const lb = s.add(label(it.name, lh, { bg: '#10151c', color: '#f3f5f7', font: '700 80px Inter', pad: 22 }), { pos: [x, lh * 0.55, z + cell * 0.47], rot: [-0.6, 0, 0] }); pts.push(...corners(lb)); });
      const bar = grp(); for (let i = 0; i < 10; i++) bar.add(boxB(0.01, 0.002, 0.012, i % 2 ? '#f4f4f4' : '#15181d').at(-0.045 + i * 0.01, 0, 0)); s.add(bar, { pos: [(-(cols - 1) / 2) * cell - cell * 0.3, 0, ((rows - 1) / 2) * cell + cell * 0.47] }); pts.push(...corners(bar));
      if (p.fig) pts.push(...corners(s.add(figure(), { pos: [0, 0, -((rows - 1) / 2) * cell - cell * 0.5 - 0.3] })));
      this.view = fit(pts, { fov: p.fov || 32, yaw: p.yaw ?? 0.45, pitch: p.pitch != null ? p.pitch * PI / 180 : 0.5, pad: [50, 110, 50, 70] });
      K.animate(s, live);
    },
    update(s, lt) { s.cam.set(this.view); },
    overlay(c, s, lt, d, t, p) { title(c, 'close-up · bar = 10 cm'); },
  });

  // every builder: size, triangles, grip
  S3.shot('props_audit', {
    build(s) {
      look(s); const out = [];
      for (const name of K.list()) { if (K.meta[name].alias) continue; let p; try { p = K[name](); } catch (e) { console.warn('AUDIT FAIL ' + name + ': ' + (e.stack || e)); continue; }
        const u = p.userData, bb = new T.Box3(); p.updateMatrixWorld(true); p.traverse(m => { if (m.isMesh && !m.userData.fx && !(m.parent && m.parent.userData.fx) && !(m.parent && m.parent.parent && m.parent.parent.userData.fx)) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); } });
        let meshes = 0; p.traverse(m => { if (m.isMesh || m.isSprite) meshes++; });
        out.push([name.padEnd(18), K.meta[name].group.padEnd(8), 'size ' + u.size.map(v => v.toFixed(3)).join(' x '), 'minY ' + bb.min.y.toFixed(3), 'cx ' + ((bb.min.x + bb.max.x) / 2).toFixed(3), 'cz ' + ((bb.min.z + bb.max.z) / 2).toFixed(3), 'tris ' + K.tris(p), 'draws ' + meshes, 'grip ' + u.grip.pos.join(','), u.update ? 'anim' : ''].join(' | ')); }
      console.warn('AUDIT\n' + out.join('\n'));
    },
    update(s) { s.cam.set({ pos: [0, 2, 5], look: [0, 1, 0], fov: 40 }); },
  });

  // ---------------- catalogue ----------------
  cat(2, 'tech', [['smartphone', {}, { label: 'smartphone' }], ['smartphone', { screen: 'chat' }, { label: 'screen: chat' }], ['smartphone', { screen: 'call', caller: 'MUM' }, { label: 'screen: call', rot: [0, 0.5, 0] }], 'walkieTalkie', 'camera', 'tvRemote', 'usbStick', ['keyCard', { lanyard: false }], 'gameController']);
  cat(3, 'tech 2', ['headphones', ['tablet', { screen: 'map' }], ['headphones', { pose: 'worn', color: '#eef0f2', accent: '#2f6fb5' }, { label: 'pose: worn' }], ['laptop', {}, {}], 'radio', ['laptop', { screen: 'cctv', open: 0.55, color: '#2b2e34', backlit: true }, { label: 'laptop cctv' }]], { cell: 0.42 });
  cat(1, 'light sources', ['flashlight', 'lantern', 'candle', ['candle', { style: 'pillar' }, { label: 'candle pillar' }], 'fireTorch', 'glowStick', 'match', ['candle', { style: 'tea' }, { label: 'candle tea' }], ['flashlight', { on: false, color: '#b8322a', accent: '#f0c330' }, { rot: [0, -0.9, 0], label: 'flashlight off' }]]);
})();
