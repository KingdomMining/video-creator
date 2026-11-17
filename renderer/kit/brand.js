// brand.js - the channel handle as things that exist INSIDE the world of a film (posters, graffiti, stickers,
// neon, clothing patches, vehicle lettering), so the handle is part of the picture and cannot be cropped off.
// The text comes from brand.json via TL.brand. Every shot should carry at least one of these where a surface
// allows; the engine also draws a small handle under the header on every frame. See docs/FILM_GUIDE.md.
const KitBrand = (() => {
  const B = () => (typeof TL !== 'undefined' && TL && TL.brand) || window.BRAND || { name: 'This or That Galaxy', handle: '@ThisOrThatGalaxy' };
  /** The handle, e.g. "@ThisOrThatGalaxy". */
  const handle = () => B().handle;
  /** The page name, e.g. "This or That Galaxy". */
  const name = () => B().name;
  const _tex = new Map();
  const fit = (c, text, font, maxW, size) => { for (; size > 10; size -= 2) { c.font = font.replace('{s}', size); if (c.measureText(text).width <= maxW) break; } return size; };
  function tex(style, o = {}) {
    const key = style + '|' + JSON.stringify(o) + '|' + handle(); if (_tex.has(key)) return _tex.get(key);
    const h = handle(), nm = name().toUpperCase();
    const draw = {
      // gig-poster: dark sky, stars, a ringed planet, the page name and the handle
      poster: [400, 600, (c, w, hh) => { const g = c.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, o.top || '#0b1030'); g.addColorStop(1, o.bottom || '#3a1c5a'); c.fillStyle = g; c.fillRect(0, 0, w, hh); const r = rng(o.seed || 3); for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`; c.fillRect(r() * w, r() * hh * 0.7, 2, 2); }
        c.fillStyle = o.planet || '#ffb347'; c.beginPath(); c.arc(w / 2, 250, 86, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 7; c.beginPath(); c.ellipse(w / 2, 258, 150, 30, -0.3, 0, 7); c.stroke();
        c.textAlign = 'center'; c.fillStyle = '#ffffff'; const s1 = fit(c, 'THIS OR THAT', '400 {s}px Anton', w - 50, 84); c.fillText('THIS OR THAT', w / 2, 440); c.fillStyle = o.accent || '#ffe14a'; fit(c, 'GALAXY', '400 {s}px Anton', w - 50, 110); c.fillText(nm.split(' ').pop(), w / 2, 530); c.fillStyle = 'rgba(255,255,255,.92)'; fit(c, h, '800 {s}px Inter', w - 60, 34); c.fillText(h, w / 2, 575); c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 6; c.strokeRect(10, 10, w - 20, hh - 20); }],
      // die-cut sticker
      sticker: [360, 120, (c, w, hh) => { c.fillStyle = o.bg || '#ffffff'; rrect(c, 4, 4, w - 8, hh - 8, 30); c.fill(); c.strokeStyle = o.edge || '#1a1f33'; c.lineWidth = 6; c.stroke(); c.fillStyle = o.color || '#1a1f33'; c.textAlign = 'center'; fit(c, h, '800 {s}px Inter', w - 44, 40); c.fillText(h, w / 2, hh / 2 + 13); }],
      // spray paint on a wall (transparent background)
      graffiti: [900, 220, (c, w, hh) => { c.textAlign = 'center'; c.lineJoin = 'round'; const s = fit(c, h, '400 {s}px "Permanent Marker"', w - 60, 150); c.strokeStyle = o.outline || 'rgba(0,0,0,.55)'; c.lineWidth = 14; c.strokeText(h, w / 2, hh / 2 + s * 0.3); c.fillStyle = o.color || '#ff4fa3'; c.fillText(h, w / 2, hh / 2 + s * 0.3); const r = rng(o.seed || 7); c.fillStyle = o.color || '#ff4fa3'; for (let i = 0; i < 7; i++) c.fillRect(80 + r() * (w - 160), hh / 2 + s * 0.3, 5, 14 + r() * 40); }],
      // plain small writing or stencil (transparent background)
      tag: [700, 110, (c, w, hh) => { c.textAlign = 'center'; c.fillStyle = o.color || 'rgba(255,255,255,.8)'; fit(c, h, (o.font || '800 {s}px Inter'), w - 30, 70); c.fillText(h, w / 2, hh / 2 + 22); }],
      stencil: [760, 130, (c, w, hh) => { c.textAlign = 'center'; c.fillStyle = o.color || 'rgba(240,235,210,.85)'; fit(c, h.toUpperCase(), '700 {s}px Oswald', w - 30, 78); c.fillText(h.toUpperCase(), w / 2, hh / 2 + 26); }],
      // neon sign lettering (transparent background, meant for an unlit glowing material)
      neon: [900, 200, (c, w, hh) => { c.textAlign = 'center'; const s = fit(c, h, '700 {s}px "Dancing Script"', w - 80, 130), col = o.color || '#ff5ad0'; c.shadowColor = col; c.shadowBlur = 34; c.fillStyle = col; c.fillText(h, w / 2, hh / 2 + s * 0.3); c.shadowBlur = 10; c.fillStyle = '#ffffff'; c.globalAlpha = 0.85; c.fillText(h, w / 2, hh / 2 + s * 0.3); }],
      // embroidered patch for clothing
      patch: [320, 130, (c, w, hh) => { c.fillStyle = o.bg || '#1a2140'; rrect(c, 4, 4, w - 8, hh - 8, 56); c.fill(); c.strokeStyle = o.edge || '#ffe14a'; c.lineWidth = 7; c.setLineDash([12, 7]); rrect(c, 12, 12, w - 24, hh - 24, 48); c.stroke(); c.setLineDash([]); c.fillStyle = o.color || '#ffffff'; c.textAlign = 'center'; fit(c, h, '800 {s}px Inter', w - 56, 34); c.fillText(h, w / 2, hh / 2 + 11); }],
      // lettering for the side of a van, a shop sign board, a crate label
      sign: [900, 240, (c, w, hh) => { c.fillStyle = o.bg || '#1b2338'; c.fillRect(0, 0, w, hh); c.textAlign = 'center'; c.fillStyle = o.color || '#ffffff'; fit(c, nm, '400 {s}px Anton', w - 70, 120); c.fillText(nm, w / 2, 132); c.fillStyle = o.accent || '#ffe14a'; fit(c, h, '800 {s}px Inter', w - 80, 54); c.fillText(h, w / 2, 204); }],
      // chalk on a board
      chalk: [700, 130, (c, w, hh) => { c.textAlign = 'center'; c.fillStyle = 'rgba(245,245,235,.9)'; fit(c, h, '400 {s}px "Permanent Marker"', w - 30, 76); c.fillText(h, w / 2, hh / 2 + 24); }],
      // tiny maker's label / monitor bezel text
      label: [420, 70, (c, w, hh) => { c.fillStyle = o.bg || '#0e1118'; c.fillRect(0, 0, w, hh); c.textAlign = 'center'; c.fillStyle = o.color || '#9fe8ff'; fit(c, h, 'bold {s}px "DejaVu Sans Mono"', w - 20, 34); c.fillText(h, w / 2, hh / 2 + 11); }],
    }[style];
    if (!draw) throw new Error('KitBrand: unknown style ' + style);
    const t = S3.canvasTex(draw[0], draw[1], draw[2]); t.userData = { aspect: draw[0] / draw[1] }; _tex.set(key, t); return t;
  }
  const flat = (style, w, o, mo) => { const t = tex(style, o), m = S3.quad(w, w / t.userData.aspect, S3.texMat(t, mo)); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2; return m; };
  /** Framed gig-style poster for a wall. o: {w (0.6 m), top, bottom, accent, planet, seed, frame:false}. Origin at its centre, facing +Z; place it 1-2 cm off the wall. */
  function poster(o = {}) { const w = o.w || 0.6, p = flat('poster', w, o, { rough: 0.8 }), g = S3.grp(p); if (o.frame !== false) g.add(S3.box(w + 0.05, w * 1.5 + 0.05, 0.02, o.frameColor || '#20232b').at(0, 0, -0.012)); return g; }
  /** Small sticker for a laptop lid, a locker, a car window, a guitar case. o: {w (0.16 m), bg, color}. */
  const sticker = (o = {}) => flat('sticker', o.w || 0.16, o, { rough: 0.6 });
  /** Spray-painted handle for a wall, a shutter, a container. o: {w (2.2 m), color, seed}. Transparent background. */
  const graffiti = (o = {}) => flat('graffiti', o.w || 2.2, o, { transparent: true, rough: 1 });
  /** Small plain lettering: scratched, painted or printed on a wall, a crate, a pipe, a hull. o: {w (0.8 m), color, font}. Transparent background. */
  const tag = (o = {}) => flat('tag', o.w || 0.8, o, { transparent: true, rough: 1 });
  /** Military or industrial stencil lettering. o: {w (1.2 m), color}. Transparent background. */
  const stencil = (o = {}) => flat('stencil', o.w || 1.2, o, { transparent: true, rough: 1 });
  /** Glowing neon handwriting for a bar, a shop window, a bedroom wall. o: {w (1.8 m), color}. Add your own s.point light of the same colour next to it. */
  const neon = (o = {}) => flat('neon', o.w || 1.8, o, { basic: true, transparent: true, blend: 'add' });
  /** Sign board with the page name and the handle: van side, shop fascia, billboard, crate. o: {w (2 m), bg, color, accent}. */
  const sign = (o = {}) => flat('sign', o.w || 2, o, { rough: 0.8 });
  /** Chalk lettering for a blackboard or a pavement. o: {w (0.9 m)}. Transparent background. */
  const chalk = (o = {}) => flat('chalk', o.w || 0.9, o, { transparent: true, rough: 1 });
  /** Tiny maker's label for a monitor bezel, a device, a control panel. o: {w (0.2 m), bg, color, glow:true}. */
  const label = (o = {}) => flat('label', o.w || 0.2, o, o.glow ? { basic: true } : { rough: 0.6 });
  /** Embroidered patch. o: {w (0.13 m), bg, edge, color}. Use wear() to put it on a character. */
  const patch = (o = {}) => flat('patch', o.w || 0.13, o, { rough: 1 });
  /** Put the handle on a character's clothes. where: 'back' | 'chest' | 'armL' | 'armR'. o: {w, y, z, style:'patch'|'tag'} offsets in metres relative to the chest joint. Returns the patch mesh (so you can adjust .position). */
  function wear(actor, where = 'back', o = {}) {
    const m = o.style === 'tag' ? tag({ w: o.w || 0.26, color: o.color }) : patch({ w: o.w || (where === 'back' ? 0.2 : 0.11), bg: o.bg, edge: o.edge, color: o.color });
    const j = actor.joint ? actor.joint('chest') : actor; const z = o.z ?? 0.125;
    if (where === 'back') m.at(o.x || 0, o.y ?? 0.16, -z).rot(0, Math.PI, 0); else if (where === 'chest') m.at(o.x ?? -0.09, o.y ?? 0.2, z); else m.at((where === 'armL' ? 1 : -1) * (o.x ?? 0.25), o.y ?? 0.16, 0).rot(0, (where === 'armL' ? 1 : -1) * Math.PI / 2, 0);
    j.add(m); return m;
  }
  /** Draw the handle on a 2D canvas (phone screens, monitors, s.screen textures, UI inserts). o: {size, color, alpha, align, font}. */
  function draw2d(c, x, y, o = {}) { c.save(); c.globalAlpha = o.alpha ?? 0.7; c.font = o.font || `600 ${o.size || 24}px Inter`; c.textAlign = o.align || 'left'; c.fillStyle = o.color || '#ffffff'; c.fillText(handle(), x, y); c.restore(); }
  return { handle, name, tex, poster, sticker, graffiti, tag, stencil, neon, sign, chalk, label, patch, wear, draw2d };
})();
