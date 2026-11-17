// Preview shots for actors_a.js (the ActorsA character system).
//   node renderer/render.js --shot a_dev --scripts renderer/lab/actors_a.js,renderer/lab/actors_a_test.js --at 0,1,2,4 --cols 4 --scale 0.5 --out /tmp/x.jpg --clean
(() => {
  const { box, boxB, cylB, ball, grp, glow, flare, ramp, label } = S3;

  const CAST = {
    def: {},
    hero: { build: 'average', hair: { style: 'short', color: '#2a1c12' }, top: { type: 'jacket', color: '#6b4a32', color2: '#d9d4c8' }, bottom: { type: 'jeans' }, shoes: { type: 'boots', color: '#3a2c22' } },
    fem: { shape: 'f', height: 1.66, hair: { style: 'bob', color: '#2a1810' }, top: { type: 'longsleeve', color: '#a8443a' }, bottom: { type: 'jeans' } },
  };
  const studio = (s, o = {}) => {
    s.sky({ top: o.top || '#5f86b8', horizon: o.hor || '#cfe0ee' }); s.fog(o.hor || '#cfe0ee', 60, 300);
    s.ground({ color: o.ground || '#8f9690', vary: 0.03, seg: 30 });
    s.sun({ dir: o.sun || [3, 6, 5], color: '#fff3e0', intensity: 1.0, area: o.area || 8 }); s.hemi('#cfe0ff', '#6a6458', 0.6);
    s.cam.cam.near = o.near || 0.5;
  };

  // generic development shot. params: {c: 'def,hero' (cast names), cfg: {...} (inline cfg), clip, t, dist, h, look, fov, sp (spacing), face}
  // lt picks the camera angle: angle = lt * 45 degrees around the group (0 = front).
  S3.shot('a_dev', {
    build(s, p) {
      studio(s, p);
      const names = (p.c || 'def').split(',');
      this.A = names.map((n, i) => { const A = ActorsA.make(p.cfg && i === 0 ? p.cfg : (CAST[n] || {})); s.add(A.root); A.place((i - (names.length - 1) / 2) * (p.sp || 0.9), 0, 0, 0); return A; });
      this.info = this.A.map(a => a.tris + ' tris, ' + a.meshes.length + ' meshes').join(' | ');
    },
    update(s, lt, d, t, p) {
      for (const A of this.A) { if (p.pose) A.pose(p.pose); else A.anim(p.clip || 'idle', p.t !== undefined ? p.t : 0.4, p.opts || {}); if (p.face) A.face(p.face); if (p.talk) A.talk(p.talk, 1); }
      const ang = lt * Math.PI / 4, look = p.look || [0, 0.92, 0];
      s.cam.set({ pos: S3.orbit(look, p.dist || 5.2, ang, p.h || 0.25), look, fov: p.fov || 24 });
    },
    overlay(c, s, lt, d, t, p) { c.font = '600 26px Inter'; c.fillStyle = '#102030'; c.fillText(this.info, 20, 40); },
    post: { bloom: 0, vignette: 0, grain: 0 },
  });
})();
