// Catalogue of in-world placements of the channel handle.
(() => {
  const { box, boxB, grp, ball } = S3;
  S3.shot('brand_cat', {
    build(s) {
      s.fog('#141821', 14, 50); s.ground({ color: '#2a2d33', vary: 0.05, seg: 20 }); s.sun({ dir: [3, 6, 5], intensity: 0.8 }); s.hemi('#aab8d8', '#30302a', 0.6);
      s.add(boxB(9, 4.2, 0.3, '#6b4a3a', { vary: 0.08 }), { pos: [0, 0, -1.5] });
      s.add(KitBrand.poster({ w: 0.7 }), { pos: [-2.6, 2.6, -1.33] });
      s.add(KitBrand.graffiti({ w: 2.6 }), { pos: [0.3, 3.3, -1.34] });
      s.add(KitBrand.neon({ w: 2.0, color: '#5ad7ff' }), { pos: [2.4, 2.2, -1.33] }); s.point([2.4, 2.2, -0.9], '#5ad7ff', 0.35, 4);
      s.add(KitBrand.stencil({ w: 1.5 }), { pos: [-0.5, 1.9, -1.34] });
      s.add(KitBrand.tag({ w: 0.8 }), { pos: [-0.7, 1.35, -1.34] });
      s.add(KitBrand.chalk({ w: 0.9 }), { pos: [-2.6, 1.3, -1.34] });
      s.add(KitBrand.sign({ w: 1.8 }), { pos: [0.6, 0.72, -1.3] });
      const crate = s.add(boxB(0.6, 0.5, 0.5, '#8a6a44'), { pos: [2.4, 0, 0] }); crate.add(KitBrand.sticker({ w: 0.3 }).at(0, 0.3, 0.26)); crate.add(KitBrand.label({ w: 0.3, glow: true }).at(0, 0.12, 0.26));
      const person = grp(boxB(0.42, 0.62, 0.24, '#2c5a8a').at(0, 0.86, 0), ball(0.17, '#e2b08e', 1).at(0, 1.66, 0), boxB(0.16, 0.86, 0.18, '#2c3a52').at(-0.11, 0, 0), boxB(0.16, 0.86, 0.18, '#2c3a52').at(0.11, 0, 0));
      const chest = new THREE.Group(); chest.position.set(0, 1.15, 0); person.add(chest); KitBrand.wear(chest, 'chest'); s.add(person, { pos: [1.2, 0, 0.6], rot: [0, -0.3, 0] });
      const p2 = person.clone(true); s.add(p2, { pos: [-1.4, 0, 0.8], rot: [0, Math.PI + 0.5, 0] }); const c2 = new THREE.Group(); c2.position.set(0, 1.15, 0); p2.add(c2); KitBrand.wear(c2, 'back');
    },
    update(s, lt) { s.cam.set({ pos: [0.2, 2.0, 6.2], look: [0, 1.9, -1], fov: 52 }); },
  });
})();
