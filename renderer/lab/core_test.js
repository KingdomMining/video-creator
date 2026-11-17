// Core smoke test: exercises sky, terrain, lights, shadows, primitives, particles, screen, camera.
(() => {
  const { box, boxB, cylB, coneB, ball, blob, grp, glow, flare, ramp, flicker, label } = S3;
  const tree = (seed) => { const r = rng(seed), h = 2.4 + r() * 1.6, g = grp(cylB(0.1, 0.16, h * 0.4, 5, '#5b3a22')); for (let i = 0; i < 3; i++) g.add(coneB(1.0 - i * 0.22, h * 0.42, 6, i % 2 ? '#2f6b45' : '#27593a', { vary: 0.12, seed: seed + i }).at(0, h * (0.28 + i * 0.22), 0)); return g; };
  const person = (shirt) => grp(boxB(0.42, 0.62, 0.24, shirt).at(0, 0.86, 0), ball(0.17, '#e2b08e', 1).at(0, 1.66, 0), boxB(0.16, 0.86, 0.18, '#2c3a52').at(-0.11, 0, 0), boxB(0.16, 0.86, 0.18, '#2c3a52').at(0.11, 0, 0), box(0.12, 0.6, 0.12, shirt).at(-0.29, 1.16, 0), box(0.12, 0.6, 0.12, shirt).at(0.29, 1.16, 0));

  S3.shot('core_day', {
    build(s) {
      s.sky({ top: '#2a66b8', horizon: '#bfe0f5' }); s.skyDisc({ dir: [0.5, 0.5, -1], color: '#fff8e0', size: 1 }); s.fog('#bfe0f5', 30, 140);
      s.terrain({ size: 260, seg: 60, height: 9, flat: 10, color: '#4f7a3f' });
      s.sun({ dir: [4, 6, 3], color: '#fff0d8', intensity: 1.0 }); s.hemi('#bcd8ff', '#4a5a36', 0.55);
      const r = rng(4); for (let i = 0; i < 60; i++) { const a = r() * 6.283, d = 9 + r() * 40; s.add(tree(i), { pos: [Math.cos(a) * d, 0, Math.sin(a) * d - 6], scale: 0.9 + r() * 0.6 }); }
      for (let i = 0; i < 8; i++) s.add(blob(0.3 + r() * 0.5, '#7d8087', i, { squash: [1, 0.7, 1] }), { pos: [-4 + r() * 8, 0.1, -3 + r() * 6] });
      this.a = s.add(person('#c8483a'), { pos: [-0.6, 0, 0] }); this.b = s.add(person('#3a7bc8'), { pos: [0.9, 0, 0.4] });
      s.add(boxB(1.6, 1.2, 1.0, '#8a5a34', { vary: 0.08 }), { pos: [3, 0, -1], rot: [0, 0.4, 0] }); s.add(label('CAMP 7', 0.5, { bg: '#22313f', color: '#ffd24a' }), { pos: [3, 1.6, -0.45], rot: [0, 0.4, 0] });
    },
    update(s, lt, d) { const k = ramp(lt, 0, d); this.a.position.x = -0.6 - k * 0.8; s.cam.set({ pos: [2.5 - k * 2, 1.7 + k * 0.4, 7 - k * 1.5], look: [0, 1.1, 0], fov: 50 }).shake(0.012, lt); },
  });

  S3.shot('core_night', {
    build(s) {
      s.sky({ top: '#04060f', horizon: '#141c33', stars: 500 }); s.skyDisc({ dir: [-0.4, 0.55, -1], color: '#dfe9ff', size: 0.8, glow: 9, glowOpacity: 0.4 }); s.fog('#0d1322', 12, 60);
      s.ground({ color: '#232a2a', vary: 0.06, seg: 40 });
      s.sun({ dir: [-3, 6, -4], color: '#8fb0ff', intensity: 0.22 }); s.hemi('#35486e', '#101418', 0.35);
      const r = rng(9); for (let i = 0; i < 40; i++) { const a = r() * 6.283, d = 8 + r() * 30; s.add(tree(i + 50), { pos: [Math.cos(a) * d, 0, Math.sin(a) * d - 4] }); }
      // campfire
      const fire = grp(); for (let i = 0; i < 5; i++) fire.add(coneB(0.16 - i * 0.02, 0.5 + i * 0.1, 5, glow(i < 2 ? '#ffd27a' : '#ff7a2a', 1.6)).at((r() - 0.5) * 0.2, 0, (r() - 0.5) * 0.2));
      for (let i = 0; i < 6; i++) fire.add(blob(0.14, '#4a4a50', i).at(Math.cos(i) * 0.45, 0.05, Math.sin(i) * 0.45)); fire.add(flare('#ff8a3a', 3.2, 0.5).at(0, 0.5, 0));
      this.fire = s.add(fire, { pos: [0, 0, 0] }); this.fl = s.point([0, 0.7, 0], '#ff8a3a', 1.4, 9);
      s.particles({ count: 40, size: 0.07, color: '#ffb060', additive: true, at: (i, t, q, o) => { const p = (t * (0.25 + q[0] * 0.3) + q[1]) % 1; o.set((q[2] - 0.5) * 0.5 + Math.sin(p * 9 + i) * 0.15, 0.3 + p * 2.6, (q[3] - 0.5) * 0.5); } });
      this.a = s.add(person('#c8483a'), { pos: [-1.3, 0, 0.3], rot: [0, 1.2, 0] }); this.b = s.add(person('#6a8f4a'), { pos: [1.2, 0, -0.2], rot: [0, -1.3, 0] });
      this.tv = s.add(s.screen(1.2, 0.7, 240, 140, (c, lt) => { c.fillStyle = '#04121a'; c.fillRect(0, 0, 240, 140); c.fillStyle = '#5ad7ff'; c.font = 'bold 28px monospace'; c.fillText('SIGNAL ' + Math.floor(lt * 10) % 100, 16, 50); c.fillRect(16, 80, 208 * ((lt * 0.3) % 1), 14); }), { pos: [-2.6, 1.3, -1.6], rot: [0, 0.7, 0] });
      this.sp = s.spot([4, 3, 3], [0, 0, 0], '#cfe2ff', 1.2, 16, 30, { shadow: true });
    },
    update(s, lt, d) { this.fl.intensity = this.fl.userData.base * flicker(lt, 0.35); this.fire.scale.y = 1 + 0.12 * S3.noise1(lt * 8); s.cam.set({ pos: S3.orbit([0, 1, 0], 6.5, 0.5 + lt * 0.08, 1.2), look: [0, 0.9, 0], fov: 46 }).shake(0.008, lt); },
  });
})();
