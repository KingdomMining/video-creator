// Catalogue and demo shots for KitInterior (renderer/kit/interior.js).
//   node renderer/render.js --shot interior_cat1 --scripts renderer/lab/interior_test.js --at 0.5 --out /tmp/x.jpg --clean
(() => {
  const K = KitInterior, T = S3.T, { box, boxB, ball, grp, label, ramp } = S3, PI = Math.PI;

  /** 1.75 m reference figure made of boxes. */
  const figure = (shirt = '#c8563a') => grp(boxB(0.15, 0.86, 0.17, '#2f3b52').at(-0.1, 0, 0), boxB(0.15, 0.86, 0.17, '#2f3b52').at(0.1, 0, 0), boxB(0.42, 0.6, 0.23, shirt).at(0, 0.86, 0),
    box(0.11, 0.58, 0.12, shirt).at(-0.27, 1.16, 0), box(0.11, 0.58, 0.12, shirt).at(0.27, 1.16, 0), boxB(0.1, 0.06, 0.1, '#dba98a').at(0, 1.46, 0), boxB(0.2, 0.23, 0.21, '#dba98a').at(0, 1.52, 0));

  /** Camera that frames a set of points exactly: looks from (yaw, pitch) with a vertical fov, returns {pos, look}. */
  function fit(pts, yaw, pitch, fov, mx = 0.93, my = 0.93) {
    const dir = new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)), fwd = dir.clone().negate();
    const right = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize(), up = new T.Vector3().crossVectors(right, fwd).normalize();
    const tv = Math.tan(fov * PI / 360), th = tv * 1080 / 1920, P = pts.map(p => [p.dot(right), p.dot(up), p.dot(fwd)]);
    const span = (D, i, tn) => { let lo = -1e9, hi = 1e9; for (const p of P) { const m = tn * (p[2] + D); lo = Math.max(lo, p[i] - m); hi = Math.min(hi, p[i] + m); } return [lo, hi]; };
    let a = 0, b = 600; for (let k = 0; k < 44; k++) { const D = (a + b) / 2, X = span(D, 0, th * mx), Y = span(D, 1, tv * my); if (X[0] <= X[1] && Y[0] <= Y[1] && P.every(p => p[2] + D > 0.5)) b = D; else a = D; }
    const X = span(b, 0, th * mx), Y = span(b, 1, tv * my), pos = right.clone().multiplyScalar((X[0] + X[1]) / 2).add(up.clone().multiplyScalar((Y[0] + Y[1]) / 2)).add(fwd.clone().multiplyScalar(-b));
    return { pos, look: pos.clone().add(fwd.clone().multiplyScalar(20)) };
  }
  const corners = (obj, out) => { const b = new T.Box3().setFromObject(obj); for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new T.Vector3(x, y, z)); return b; };

  /**
   * Catalogue sheet: items on a camera-aligned grid over neutral ground, each with a label, soft shadows, auto-framed.
   * Rows are spaced automatically so that nothing hides the row behind it. First items are the back row: put tall things first.
   * items: [name, object | () => object, {wall: true (stand it against a piece of wall), ceil: h (hang it under a piece of ceiling), rot, t0}]
   */
  function sheet(name, o, items) {
    const cols = o.cols || 2, cw = o.cw ?? 2.8, yaw = o.yaw ?? 0.42, pitch = o.pitch ?? 0.56, fov = o.fov ?? 20, lh = o.label ?? cw * 0.058, gap = o.gap ?? 0.5;
    S3.shot(name, {
      build(s) {
        s.sky({ top: '#77849a', horizon: '#c3c9d2' }); s.fog('#bcc3cc', 90, 500);
        s.ground({ color: '#8d939b', vary: 0.03, seg: 90, size: 420 }); s.hemi('#e4ecfb', '#7b756c', 0.6);
        const rows = Math.ceil(items.length / cols), Rv = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), Fv = new T.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), pts = [], tmp = [];
        this.ups = [];
        const made = items.map((it, i) => {
          const op = it[2] || {}, obj = typeof it[1] === 'function' ? it[1]() : it[1], holder = grp(obj);
          if (op.wall) { const b = new T.Box3().setFromObject(obj), bw = Math.max(1.0, b.max.x - b.min.x + 0.5), bh = Math.max(2.2, b.max.y + 0.3); holder.add(boxB(bw, bh, 0.1, '#b4ada1').at((b.max.x + b.min.x) / 2, 0, b.min.z - 0.05)); }
          if (op.ceil) holder.add(box(1.1, 0.06, 1.0, '#cfcabf').at(0, op.ceil + 0.03, 0), boxB(0.07, op.ceil, 0.07, '#a9a399').at(-0.5, 0, -0.45));
          holder.rotation.y = op.rot || 0; holder.updateMatrixWorld(true); tmp.length = 0; corners(holder, tmp);
          const f = tmp.map(p => p.dot(Fv)), r = tmp.map(p => p.dot(Rv)), h = Math.max(...tmp.map(p => p.y));
          if (obj.userData.update) { this.ups.push(obj); if (op.t0 !== undefined) obj.userData.update(op.t0); }
          return { it, holder, fmin: Math.min(...f), fmax: Math.max(...f), rmid: (Math.min(...r) + Math.max(...r)) / 2, h, row: Math.floor(i / cols), col: i % cols };
        });
        const rowF = []; let fpos = 0;
        for (let r = 0; r < rows; r++) { const m = made.filter(q => q.row === r), hmax = Math.max(...m.map(q => q.h)), fmax = Math.max(...m.map(q => q.fmax)), fmin = Math.min(...m.map(q => q.fmin));
          if (r > 0) fpos -= hmax / Math.tan(pitch) * 1.08 + fmax + gap; rowF.push({ f: fpos, fmin }); fpos += fmin - lh * 2.6; }
        made.forEach(q => { const rf = rowF[q.row], c = Rv.clone().multiplyScalar((q.col - (cols - 1) / 2) * cw - q.rmid).add(Fv.clone().multiplyScalar(rf.f));
          q.holder.position.copy(c); s.add(q.holder); corners(q.holder, pts);
          const lab = label(q.it[0], lh, { bg: '#1d232c', color: '#ffffff', glow: true, pad: 24 }); lab.rotation.order = 'YXZ'; lab.rotation.y = yaw; lab.rotation.x = -pitch;
          lab.position.copy(Rv.clone().multiplyScalar((q.col - (cols - 1) / 2) * cw)).add(Fv.clone().multiplyScalar(rf.f + rf.fmin - lh * 1.5)); lab.position.y = lh * 0.6; s.add(lab); corners(lab, pts); });
        const sd = Rv.clone().multiplyScalar(-0.75).add(Fv.clone().multiplyScalar(-0.55)).add(new T.Vector3(0, 1.5, 0)), ctr = new T.Box3().setFromPoints(pts), sz = ctr.getSize(new T.Vector3()), cc = ctr.getCenter(new T.Vector3());
        s.sun({ dir: [sd.x, sd.y, sd.z], color: '#fff3e2', intensity: 0.95, area: Math.max(sz.x, sz.z) * 0.75 + 2, center: [cc.x, 0, cc.z] });
        this.view = fit(pts, yaw, pitch, fov);
      },
      update(s, lt) { for (const u of this.ups) u.userData.update(lt); s.cam.set({ pos: this.view.pos, look: this.view.look, fov }); },
      post: { bloom: 0.1, vignette: 0.1, grain: 0 },
    });
  }

  // ---------------- catalogue ----------------
  sheet('interior_cat1', { cw: 3.0 }, [
    ['liftDoors', () => K.liftDoors({ open: 0.6, floor: '3' })], ['slidingDoor', () => K.slidingDoor({ open: 0.4 })],
    ['doubleDoors', () => K.doubleDoors({ open: 0.3 })], ['frontDoor', () => K.frontDoor({ number: '13', open: 0.15 })],
    ['door', () => K.door({ open: 0.35 })], ['slidingDoor barn', () => K.slidingDoor({ style: 'barn', open: 0.3 })],
    ['cellarDoor', () => K.cellarDoor({ hatch: true, open: 0.2 })], ['1.75 m', figure()],
  ]);
  sheet('interior_cat2', { cw: 3.3 }, [
    ['stairs', () => K.stairs({ runner: '#7a2e2e' })], ['stairs open', () => K.stairs({ style: 'open', h: 2.4, w: 0.9, rail: 'right' })],
    ['vaultDoor', () => K.vaultDoor({ open: 0.75 })], ['bars', () => K.bars({ w: 2.6, open: 0.4 })],
    ['window', () => K.window({ curtains: true, view: 'day', spill: true })], ['window blinds', () => K.window({ blinds: 1, view: 'night', panes: [1, 1] })],
    ['ladder', () => K.ladder()], ['1.75 m', figure()],
  ]);
  sheet('interior_cat3', { cw: 2.8 }, [
    ['bookcase', () => K.bookcase()], ['floorLamp', () => K.floorLamp()],
    ['sofa', () => K.sofa()], ['tv', () => K.tv({ show: 'news' })],
    ['armchair', () => K.armchair()], ['tv crt', () => K.tv({ style: 'crt', show: 'static' })],
    ['coffeeTable', () => K.coffeeTable()], ['plant', () => K.plant()],
    ['rug', () => K.rug()], ['1.75 m', figure()],
  ]);
  sheet('interior_cat4', { cw: 2.7 }, [
    ['fireplace', () => K.fireplace({ breast: 2.5 }), { wall: 1 }], ['ceilingLamp pendant / bulb', () => grp(K.ceilingLamp().at(-0.3, 0, 0), K.ceilingLamp({ style: 'bulb' }).at(0.3, 0, 0.25)), { ceil: 2.6 }],
    ['picture', () => grp(K.picture({ style: 'landscape' }).at(-0.45, 0, 0), K.picture({ style: 'portrait', y: 1.6 }).at(0.4, 0, 0), K.picture({ style: 'family', w: 0.4, h: 0.3, y: 1.05 }).at(-0.4, 0, 0)), { wall: 1 }], ['ceilingLamp tube / chandelier', () => grp(K.ceilingLamp({ style: 'tube' }).at(0, 0, -0.3), K.ceilingLamp({ style: 'chandelier' }).at(0, 0, 0.2)), { ceil: 2.6 }],
    ['mirror + wallClock', () => grp(K.mirror().at(-0.35, 0, 0), K.wallClock({ y: 1.7 }).at(0.4, 0, 0)), { wall: 1 }], ['picture cork', () => K.picture({ style: 'cork' }), { wall: 1 }],
    ['mirror floor', () => K.mirror({ style: 'floor' })], ['plant palm / snake', () => grp(K.plant({ style: 'palm' }).at(-0.45, 0, 0), K.plant({ style: 'snake' }).at(0.45, 0, 0))],
    ['tableLamp + plant small', () => grp(boxB(0.5, 0.55, 0.4, '#8a6a4a'), K.tableLamp().at(-0.1, 0.55, 0), K.plant({ style: 'small' }).at(0.16, 0.55, 0.08))], ['1.75 m', figure()],
  ]);
  S3.shot('interior_room0', {
    build(s) {
      s.fog('#0c0d12', 20, 60); s.ground({ color: '#17181c' });
      s.sun({ dir: [3, 6, 5], color: '#fff0dc', intensity: 0.9, area: 8 }); s.hemi('#cdd9f0', '#5a5246', 0.5);
      this.room = s.add(K.room({ w: 5, d: 4, wall: { color: '#c9bfa6', style: 'panel' }, floor: 'wood', openings: [{ wall: 'back', type: 'door', x: 1.6, open: 0.4 }, { wall: 'back', type: 'window', x: -0.8, curtains: true, view: 'day', spill: true }, { wall: 'left', type: 'arch', x: 0 }, { wall: 'right', type: 'window', x: 0.3, blinds: 0.7 }] }));
      s.add(figure(), { pos: [0.5, 0, 0.3] });
    },
    update(s, lt, d) { s.cam.set({ pos: [1.5, 1.7, 7.4], look: [0, 1.15, 0], fov: 42 }); },
    post: { bloom: 0.2, vignette: 0.3, grain: 0.02 },
  });
})();
