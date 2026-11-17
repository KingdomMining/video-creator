// Procedural scene renderer. Everything is a pure function of time `t` so frames are deterministic.
const W = 1080, H = 1920;
let TL = null, cv, ctx;

const PAL = {
  space:  { bg0: '#02040c', bg1: '#0b1a33', accent: '#5ad7ff', warn: '#ff3344', metal: '#141c29', metal2: '#2b3a50', fog: '#7fb8ff' },
  bunker: { bg0: '#0a0705', bg1: '#3a1208', accent: '#ffb23f', warn: '#ff3b2f', metal: '#1c1713', metal2: '#3b322a', fog: '#ff9a5a' },
  war:    { bg0: '#060806', bg1: '#1d2616', accent: '#c8f25a', warn: '#ff5a2a', metal: '#161a13', metal2: '#30382a', fog: '#b8c49a' },
};

// ---------- helpers ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = x => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };
const mod = (a, n) => ((a % n) + n) % n;
function A(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function vgrad(c, y0, y1, stops) { const g = c.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; }
function glow(c, x, y, r, col, a = 1) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, A(col, a)); g.addColorStop(1, A(col, 0)); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); }
function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function poly(c, pts, fill) { c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.closePath(); c.fillStyle = fill; c.fill(); }
function wrap(c, text, maxW) { const out = []; let line = ''; for (const w of text.split(' ')) { const tr = line ? line + ' ' + w : w; if (c.measureText(tr).width > maxW && line) { out.push(line); line = w; } else line = tr; } if (line) out.push(line); return out; }
function hits(types) { const out = []; for (const e of TL.sfx) { if (!types.includes(e.type)) continue; if (e.type === 'knock') out.push(e.t, e.t + 0.32, e.t + 0.64); else out.push(e.t); } return out; }

function figure(c, x, yFeet, h, col, o = {}) {
  c.save(); c.translate(x, yFeet); c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round';
  const hr = h * (o.helmet ? 0.105 : 0.075);
  c.beginPath(); c.arc(0, -h * 0.9, hr, 0, 7); c.fill();
  poly(c, [[-h * 0.14, -h * 0.8], [h * 0.14, -h * 0.8], [h * 0.1, -h * 0.44], [-h * 0.1, -h * 0.44]], col);
  if (o.pack) c.fillRect(-h * 0.17, -h * 0.8, h * 0.34, h * 0.3);
  c.lineWidth = h * 0.065;
  const sw = o.swing || 0;
  c.beginPath(); c.moveTo(-h * 0.14, -h * 0.77); c.lineTo(-h * 0.18 - sw * h * 0.05, -h * 0.45); c.moveTo(h * 0.14, -h * 0.77); c.lineTo(h * 0.18 + sw * h * 0.05, -h * 0.45); c.stroke();
  c.lineWidth = h * 0.085;
  c.beginPath(); c.moveTo(-h * 0.055, -h * 0.46); c.lineTo(-h * 0.07 + sw * h * 0.08, 0); c.moveTo(h * 0.055, -h * 0.46); c.lineTo(h * 0.07 - sw * h * 0.08, 0); c.stroke();
  if (o.eyes) { c.fillStyle = o.eyes; c.shadowColor = o.eyes; c.shadowBlur = 18; c.beginPath(); c.arc(-hr * 0.38, -h * 0.91, hr * 0.13, 0, 7); c.arc(hr * 0.38, -h * 0.91, hr * 0.13, 0, 7); c.fill(); }
  if (o.visor) { c.fillStyle = o.visor; c.beginPath(); c.ellipse(0, -h * 0.9, hr * 0.7, hr * 0.5, 0, 0, 7); c.fill(); }
  c.restore();
}
function stars(c, t, n, seed, speed) { const r = rng(seed); for (let i = 0; i < n; i++) { const x = mod(r() * W - t * speed * (0.3 + r()), W), y = r() * H, s = 0.6 + r() * 2.2, tw = 0.55 + 0.45 * Math.sin(t * (1 + r() * 3) + r() * 6); c.fillStyle = `rgba(255,255,255,${tw * (0.3 + r() * 0.7)})`; c.fillRect(x, y, s, s); } }
function particles(c, t, n, seed, vx, vy, col, size = 3) { const r = rng(seed); for (let i = 0; i < n; i++) { const sp = 0.4 + r(), x = mod(r() * W + t * vx * sp + Math.sin(t + i) * 20, W), y = mod(r() * H + t * vy * sp, H), s = 1 + r() * size; c.fillStyle = A(col, 0.15 + r() * 0.5); c.fillRect(x, y, s, s); } }
function scanlines(c, a = 0.12) { c.fillStyle = `rgba(0,0,0,${a})`; for (let y = 0; y < H; y += 6) c.fillRect(0, y, W, 2); }

// ---------- scenes ----------
const SCENES = {
  space(c, t, lt, d, p, P) {
    c.fillStyle = vgrad(c, 0, H, [[0, P.bg0], [1, P.bg1]]); c.fillRect(0, 0, W, H);
    glow(c, W * 0.2, H * 0.25, 700, P.accent, 0.10); glow(c, W * 0.9, H * 0.5, 600, '#a060ff', 0.08);
    stars(c, t, 160, 11, 4); stars(c, t, 90, 22, 12);
    if (p.planet !== false) {
      const px = W * 0.8, py = H * 0.8, pr = 470;
      glow(c, px, py, pr * 1.5, P.accent, 0.28);
      const g = c.createRadialGradient(px - 170, py - 190, 40, px, py, pr); g.addColorStop(0, p.planetColor || '#c66a3a'); g.addColorStop(0.7, '#3a1a14'); g.addColorStop(1, '#090508');
      c.fillStyle = g; c.beginPath(); c.arc(px, py, pr, 0, 7); c.fill();
      c.save(); c.beginPath(); c.arc(px, py, pr, 0, 7); c.clip(); c.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 7; i++) c.fillRect(px - pr, py - pr + i * 140 + Math.sin(i * 3) * 30, pr * 2, 34 + i * 6); c.restore();
    }
    if (p.ship !== false) {
      c.save(); c.translate(W * 0.46 + Math.sin(t * 0.3) * 24 + lt * 10, H * 0.4 + Math.cos(t * 0.4) * 14); c.rotate(-0.14); const s = p.shipScale || 1; c.scale(s, s);
      glow(c, -360, 0, 240 + Math.sin(t * 20) * 14, P.accent, 0.85); glow(c, -340, 0, 90, '#ffffff', 0.9);
      poly(c, [[-300, 0], [-230, -58], [130, -66], [310, -18], [310, 18], [130, 66], [-230, 58]], c.createLinearGradient(0, -70, 0, 70));
      const hg = c.createLinearGradient(0, -70, 0, 70); hg.addColorStop(0, '#6b7c94'); hg.addColorStop(0.5, P.metal2); hg.addColorStop(1, '#0a0e16');
      poly(c, [[-300, 0], [-230, -58], [130, -66], [310, -18], [310, 18], [130, 66], [-230, 58]], hg);
      c.fillStyle = '#0c1220'; c.fillRect(-340, -34, 50, 68); c.fillStyle = '#39485e'; c.fillRect(-200, 60, 130, 44); c.fillRect(-40, 60, 130, 44); c.fillRect(-200, -104, 130, 44);
      c.strokeStyle = '#6b7c94'; c.lineWidth = 4; c.beginPath(); c.moveTo(60, -64); c.lineTo(90, -150); c.stroke();
      for (let i = 0; i < 9; i++) { c.fillStyle = A(P.accent, i === 7 ? 0.5 + 0.5 * Math.sin(t * 5) : 0.25); c.fillRect(-190 + i * 44, -14, 22, 12); }
      c.fillStyle = A(P.accent, 0.9); poly(c, [[230, -20], [296, -10], [296, 4], [230, 6]], A(P.accent, 0.8));
      c.restore();
    }
    if (p.debris) particles(c, t, 40, 5, -30, 12, '#aab4c4', 6);
  },

  corridor(c, t, lt, d, p, P) {
    const cx = W / 2, cy = H * 0.47, n = 10, speed = p.speed ?? 0.9;
    const pt = (sx, sy, f) => [cx + (sx - cx) * f, cy + (sy - cy) * f], ff = 1 / (n + 1);
    c.fillStyle = P.bg0; c.fillRect(0, 0, W, H);
    const wall = (a, b, x0) => { const g = c.createLinearGradient(x0, 0, cx, 0); g.addColorStop(0, P.metal2); g.addColorStop(1, P.bg0); poly(c, [pt(...a, 1), pt(...a, ff), pt(...b, ff), pt(...b, 1)], g); };
    wall([0, 0], [0, H], 0); wall([W, 0], [W, H], W);
    poly(c, [pt(0, H, 1), pt(0, H, ff), pt(W, H, ff), pt(W, H, 1)], vgrad(c, H, cy, [[0, P.metal2], [1, P.bg0]]));
    poly(c, [pt(0, 0, 1), pt(0, 0, ff), pt(W, 0, ff), pt(W, 0, 1)], vgrad(c, 0, cy, [[0, P.metal], [1, P.bg0]]));
    c.strokeStyle = A(P.accent, 0.12); c.lineWidth = 2;
    for (let i = 1; i < 8; i++) { const a = pt(i * W / 8, H, 1), b = pt(i * W / 8, H, ff); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); }
    const ribs = []; for (let i = 0; i < n; i++) ribs.push([mod(i - lt * speed, n) + 1, i]);
    ribs.sort((a, b) => b[0] - a[0]);
    for (const [z, i] of ribs) {
      const f = 1 / z, a = clamp(f * 3) * clamp((n + 1 - z)), [x0, y0] = pt(0, 0, f), [x1, y1] = pt(W, H, f);
      c.strokeStyle = A('#55657c', a * 0.9); c.lineWidth = 34 * f; c.strokeRect(x0, y0, x1 - x0, y1 - y0);
      const on = !p.flicker || rng(i * 77 + Math.floor(t * 11))() > 0.25;
      if (on) { c.save(); c.shadowColor = p.alarm ? P.warn : P.accent; c.shadowBlur = 70 * f; c.strokeStyle = A(p.alarm ? P.warn : P.accent, a); c.lineWidth = 16 * f; c.beginPath(); c.moveTo(cx - W * 0.2 * f, y0 + 20 * f); c.lineTo(cx + W * 0.2 * f, y0 + 20 * f); c.stroke(); c.restore(); }
    }
    const [fx0, fy0] = pt(0, 0, ff), [fx1, fy1] = pt(W, H, ff); c.fillStyle = '#000'; c.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
    glow(c, cx, cy, 260, p.alarm ? P.warn : P.accent, 0.25);
    if (p.alarm) { c.fillStyle = A(P.warn, 0.08 + 0.14 * (0.5 + 0.5 * Math.sin(t * 7))); c.fillRect(0, 0, W, H); }
  },

  door(c, t, lt, d, p, P) {
    c.fillStyle = vgrad(c, 0, H, [[0, P.metal], [0.5, P.metal2], [1, P.bg0]]); c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 6; for (let y = 160; y < H; y += 320) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    for (let x = 60; x < W; x += 240) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    const dx = 150, dy = 420, dw = 780, dh = 1180;
    c.fillStyle = '#05070a'; rrect(c, dx - 34, dy - 34, dw + 68, dh + 68, 50); c.fill();
    const dg = c.createLinearGradient(dx, dy, dx + dw, dy + dh); dg.addColorStop(0, '#5a6678'); dg.addColorStop(0.5, P.metal2); dg.addColorStop(1, P.metal);
    c.fillStyle = dg; rrect(c, dx, dy, dw, dh, 30); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 8; rrect(c, dx + 40, dy + 40, dw - 80, dh - 80, 20); c.stroke();
    c.fillStyle = 'rgba(0,0,0,.55)'; for (let i = 0; i < 6; i++) { for (const yy of [dy + 22, dy + dh - 22]) { c.beginPath(); c.arc(dx + 60 + i * (dw - 120) / 5, yy, 9, 0, 7); c.fill(); } }
    // hazard stripe
    c.save(); rrect(c, dx + 40, dy + dh - 190, dw - 80, 90, 10); c.clip(); c.fillStyle = '#e8b21c'; c.fillRect(dx, dy + dh - 200, dw, 120); c.fillStyle = '#111';
    for (let i = -2; i < 14; i++) poly(c, [[dx + i * 80, dy + dh - 100], [dx + i * 80 + 40, dy + dh - 100], [dx + i * 80 + 110, dy + dh - 190], [dx + i * 80 + 70, dy + dh - 190]], '#111'); c.restore();
    const cx = W / 2, wy = dy + 370;
    if (p.variant === 'vault') {
      c.save(); c.translate(cx, wy + 120); c.rotate(Math.sin(lt * 0.6) * 0.08); c.strokeStyle = '#11151b'; c.lineWidth = 40; c.beginPath(); c.arc(0, 0, 190, 0, 7); c.stroke();
      c.lineWidth = 26; for (let i = 0; i < 6; i++) { c.rotate(Math.PI / 3); c.beginPath(); c.moveTo(0, 0); c.lineTo(190, 0); c.stroke(); } c.fillStyle = '#2a323d'; c.beginPath(); c.arc(0, 0, 54, 0, 7); c.fill(); c.restore();
    } else {
      c.fillStyle = '#0a0d12'; c.beginPath(); c.arc(cx, wy, 190, 0, 7); c.fill();
      c.save(); c.beginPath(); c.arc(cx, wy, 160, 0, 7); c.clip();
      c.fillStyle = vgrad(c, wy - 160, wy + 160, [[0, '#020611'], [1, '#0d2444']]); c.fillRect(cx - 160, wy - 160, 320, 320); stars(c, t, 400, 9, 2);
      if (p.figure) { const a = ease(lt / 0.9); c.globalAlpha = a; figure(c, cx + Math.sin(t * 0.7) * 6, wy + 640, 800, '#d9dee6', { helmet: true, visor: '#0a0f1a', pack: true }); glow(c, cx - 30, wy - 90, 60, '#ffffff', 0.5 * a); c.globalAlpha = 1; }
      c.fillStyle = 'rgba(255,255,255,.07)'; poly(c, [[cx - 160, wy - 60], [cx + 20, wy - 160], [cx + 90, wy - 160], [cx - 160, wy + 30]], 'rgba(255,255,255,.07)');
      c.restore(); c.strokeStyle = '#778499'; c.lineWidth = 10; c.beginPath(); c.arc(cx, wy, 172, 0, 7); c.stroke();
    }
    c.font = '800 54px Inter'; c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.55)'; c.fillText(p.label || 'AIRLOCK 02', cx, dy + 130);
    // status lamp
    const blink = 0.5 + 0.5 * Math.sin(t * 8), lc = p.alarm ? P.warn : P.accent;
    glow(c, cx, 250, 330, lc, p.alarm ? 0.3 + 0.5 * blink : 0.35); c.fillStyle = lc; rrect(c, cx - 70, 215, 140, 70, 20); c.fill();
    // knock rings + dust
    for (const k of hits(['knock'])) { const dt = t - k; if (dt > 0 && dt < 0.7) { c.strokeStyle = `rgba(255,255,255,${0.5 * (1 - dt / 0.7)})`; c.lineWidth = 10 * (1 - dt / 0.7) + 1; c.beginPath(); c.arc(cx, dy + dh * 0.5, 80 + dt * 900, 0, 7); c.stroke(); const r = rng(Math.floor(k * 100)); for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(210,200,190,${0.6 * (1 - dt / 0.7)})`; c.fillRect(dx + r() * dw, dy - 30 + dt * dt * 900 * (0.4 + r()), 5, 5); } } }
    c.fillStyle = vgrad(c, 0, H, [[0, 'rgba(0,0,0,.35)'], [0.4, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.6)']]); c.fillRect(0, 0, W, H);
  },

  console(c, t, lt, d, p, P) {
    c.fillStyle = '#020405'; c.fillRect(0, 0, W, H); glow(c, W / 2, H * 0.45, 1100, P.accent, 0.13);
    c.strokeStyle = A(P.accent, 0.08); c.lineWidth = 2; for (let x = 0; x < W; x += 90) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); } for (let y = 0; y < H; y += 90) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    let ty = 520;
    if (p.radar !== false) {
      const cx = W / 2, cy = 590, R = 300; c.strokeStyle = A(P.accent, 0.55); c.lineWidth = 4;
      for (let i = 1; i <= 4; i++) { c.beginPath(); c.arc(cx, cy, R * i / 4, 0, 7); c.stroke(); }
      c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
      const ang = t * 2.2; for (let i = 0; i < 30; i++) { c.fillStyle = A(P.accent, 0.3 * (1 - i / 30)); c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, ang - i * 0.03 - 0.03, ang - i * 0.03); c.fill(); }
      const bd = lerp(p.from ?? 0.92, p.to ?? 0.2, clamp(lt / d)), ba = -0.9, bx = cx + Math.cos(ba) * R * bd, by = cy + Math.sin(ba) * R * bd, pu = mod(t * 1.6, 1);
      c.strokeStyle = A(P.warn, 1 - pu); c.lineWidth = 5; c.beginPath(); c.arc(bx, by, 14 + pu * 60, 0, 7); c.stroke(); glow(c, bx, by, 60, P.warn, 0.9); c.fillStyle = '#fff'; c.beginPath(); c.arc(bx, by, 9, 0, 7); c.fill();
      c.fillStyle = P.accent; c.beginPath(); c.arc(cx, cy, 12, 0, 7); c.fill(); ty = 990;
    }
    c.textAlign = 'left'; c.font = 'bold 50px "DejaVu Sans Mono"'; let used = 0;
    for (const raw of (p.lines || [])) {
      const warn = raw[0] === '!', line = warn ? raw.slice(1) : raw, shown = Math.floor(clamp(lt * 26 - used, 0, line.length)); used += line.length + 6;
      if (shown <= 0) break; const col = warn ? P.warn : P.accent; c.shadowColor = col; c.shadowBlur = 22; c.fillStyle = col;
      c.fillText('> ' + line.slice(0, shown) + (shown < line.length || mod(t, 0.6) < 0.3 ? '_' : ''), 90, ty); ty += 84;
    }
    c.shadowBlur = 0;
    if (p.big) { const v = typeof p.big === 'object' ? Math.max(0, Math.ceil(p.big.from - lt * (p.big.rate ?? 1))) : p.big; const s = typeof v === 'number' ? `00:${String(v).padStart(2, '0')}` : v; c.textAlign = 'center'; c.font = 'bold 190px "DejaVu Sans Mono"'; c.shadowColor = P.warn; c.shadowBlur = 50; c.fillStyle = P.warn; c.fillText(s, W / 2, p.radar === false ? 1080 + (p.lines || []).length * 30 : 1560); c.shadowBlur = 0; }
    scanlines(c, 0.22); c.fillStyle = `rgba(255,255,255,${0.03 * rng(Math.floor(t * 30))()})`; c.fillRect(0, 0, W, H);
  },

  city(c, t, lt, d, p, P) {
    c.fillStyle = vgrad(c, 0, H, [[0, P.bg0], [0.45, P.bg1], [0.72, P.warn], [1, '#1a0805']]); c.fillRect(0, 0, W, H);
    glow(c, W * 0.62, H * 0.58, 520, '#ffd9a0', 0.55); c.fillStyle = 'rgba(255,225,180,.75)'; c.beginPath(); c.arc(W * 0.62, H * 0.58, 120, 0, 7); c.fill();
    const layers = [[0.5, '#3a140c', 600, 6], [0.75, '#1c0a07', 760, 14], [1, '#080403', 900, 26]];
    layers.forEach(([sc, col, base, sp], li) => {
      const r = rng(100 + li), off = t * sp; c.fillStyle = col; let x = -300;
      while (x < W + 600) { const w = (70 + r() * 150) * sc, h = (200 + r() * base) * sc, y0 = H * (0.66 + li * 0.09), X = x - off; const jag = [[X, y0]]; const steps = 3 + Math.floor(r() * 4); for (let i = 0; i <= steps; i++) jag.push([X + w * i / steps, y0 - h + r() * 90 * sc * (r() > 0.5 ? 1 : 0.2)]); jag.push([X + w, y0], [X + w, H], [X, H]); poly(c, jag, col); if (li < 2 && r() > 0.7) { c.fillStyle = A('#ffb060', 0.5 + 0.3 * Math.sin(t * 3 + x)); c.fillRect(X + w * 0.3, y0 - h * 0.5, 8 * sc, 12 * sc); c.fillStyle = col; } x += w + r() * 40 * sc; }
      c.fillStyle = A(P.warn, 0.07); c.fillRect(0, 0, W, H);
    });
    c.fillStyle = '#050302'; c.fillRect(0, H * 0.9, W, H * 0.1); c.strokeStyle = '#050302'; c.lineWidth = 14; c.beginPath(); c.moveTo(180, H * 0.92); c.lineTo(210, H * 0.7); c.lineTo(330, H * 0.72); c.stroke();
    if (p.figure) figure(c, W * 0.5, H * 0.91, 230, '#050302', { pack: true });
    particles(c, t, 170, 3, 26, 90, '#e8d8c8', 4);
  },

  figure(c, t, lt, d, p, P) {
    const fog = p.cam ? '#9fd8a8' : P.fog; c.fillStyle = vgrad(c, 0, H, [[0, '#020202'], [0.6, A(fog, 0.25)], [1, '#020202']]); c.fillRect(0, 0, W, H); c.fillStyle = '#030303'; c.globalCompositeOperation = 'destination-over'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over';
    const gy = H * 0.74; glow(c, W / 2, gy - 420, 760, fog, 0.5 + 0.06 * Math.sin(t * 9)); glow(c, W / 2, gy - 440, 300, '#ffffff', 0.4);
    c.fillStyle = '#040404'; c.fillRect(0, gy, W, H - gy); c.fillStyle = A(fog, 0.12); c.beginPath(); c.ellipse(W / 2, gy + 30, 380, 40, 0, 0, 7); c.fill();
    const h = (p.small ? 430 : 820) * lerp(0.86, 1.06, ease(lt / d));
    figure(c, W / 2 + Math.sin(t * 0.8) * 5, gy + 10, h, '#020202', { eyes: p.eyes ? (p.eyeColor || '#ffffff') : null, helmet: p.helmet, pack: p.pack });
    for (let i = 0; i < 5; i++) { c.fillStyle = A(fog, 0.07); c.beginPath(); c.ellipse(mod(i * 330 + t * (20 + i * 9), W + 800) - 400, gy - 120 + i * 60, 520, 90, 0, 0, 7); c.fill(); }
    if (p.cam) { scanlines(c, 0.3); const r = rng(Math.floor(t * 30)); for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(255,255,255,${r() * 0.12})`; c.fillRect(r() * W, r() * H, 4, 3); } const by = mod(t * 300, H + 200) - 100; c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(0, by, W, 70);
      c.font = 'bold 44px "DejaVu Sans Mono"'; c.textAlign = 'left'; c.fillStyle = '#e8ffe8'; c.fillText(p.cam, 70, 420); if (mod(t, 1) < 0.6) { c.fillStyle = '#ff3030'; c.beginPath(); c.arc(W - 220, 405, 16, 0, 7); c.fill(); } c.fillStyle = '#e8ffe8'; c.fillText('REC', W - 190, 420); }
  },

  room(c, t, lt, d, p, P) {
    c.fillStyle = vgrad(c, 0, H, [[0, '#060504'], [0.6, P.metal], [1, '#050403']]); c.fillRect(0, 0, W, H);
    const ang = Math.sin(t * 1.3) * 0.1, lx = W / 2 + Math.sin(ang) * 520, ly = 150 + Math.cos(ang) * 520, fl = 0.85 + 0.15 * rng(Math.floor(t * 14))();
    glow(c, lx, ly + 300, 1000, P.accent, 0.3 * fl);
    c.save(); c.globalAlpha = 0.16 * fl; poly(c, [[lx - 50, ly], [lx + 50, ly], [lx + 620, H], [lx - 620, H]], P.accent); c.restore();
    c.fillStyle = '#0b0907'; c.fillRect(0, H * 0.78, W, H * 0.22);
    const r = rng(42);
    for (const sx of [40, W - 330]) for (let s = 0; s < 4; s++) { const sy = 760 + s * 190; c.fillStyle = '#0d0a08'; c.fillRect(sx, sy, 290, 16); let x = sx + 8; while (x < sx + 260) { const w = 26 + r() * 30, h = 50 + r() * 70; if (r() > 0.25) { c.fillStyle = A(P.metal2, 0.9); c.fillRect(x, sy - h, w, h); c.fillStyle = A(P.accent, 0.25); c.fillRect(x, sy - h * 0.6, w, 10); } x += w + 8; } }
    c.strokeStyle = '#000'; c.lineWidth = 5; c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(lx, ly); c.stroke(); c.fillStyle = '#111'; poly(c, [[lx - 60, ly], [lx + 60, ly], [lx + 26, ly - 60], [lx - 26, ly - 60]], '#111'); glow(c, lx, ly + 14, 110, '#fff2c8', fl); c.fillStyle = '#fff6d8'; c.beginPath(); c.arc(lx, ly + 12, 22, 0, 7); c.fill();
    c.fillStyle = '#060504'; c.fillRect(W / 2 - 300, H * 0.72, 600, 26); c.fillRect(W / 2 - 270, H * 0.72, 22, 220); c.fillRect(W / 2 + 248, H * 0.72, 22, 220);
    if (p.figure !== false) { c.fillStyle = '#030302'; c.beginPath(); c.arc(W / 2, H * 0.72 - 290 + Math.sin(t) * 3, 62, 0, 7); c.fill(); poly(c, [[W / 2 - 150, H * 0.72], [W / 2 - 120, H * 0.72 - 200], [W / 2 - 40, H * 0.72 - 236], [W / 2 + 40, H * 0.72 - 236], [W / 2 + 120, H * 0.72 - 200], [W / 2 + 150, H * 0.72]], '#030302'); }
    c.fillStyle = A(P.accent, 0.8); c.fillRect(W / 2 + 150, H * 0.72 - 46, 30, 46);
    particles(c, t, 40, 8, 6, 14, '#ffe8c0', 2);
  },

  radio(c, t, lt, d, p, P) {
    c.fillStyle = vgrad(c, 0, H, [[0, '#040404'], [0.5, P.metal], [1, '#030303']]); c.fillRect(0, 0, W, H); glow(c, W / 2, 900, 900, P.accent, 0.18);
    const bx = 130, by = 520, bw = 820, bh = 800; c.fillStyle = '#0a0a0a'; rrect(c, bx - 14, by - 14, bw + 28, bh + 28, 50); c.fill(); c.fillStyle = vgrad(c, by, by + bh, [[0, '#3a3f3a'], [1, '#161816']]); rrect(c, bx, by, bw, bh, 40); c.fill();
    c.fillStyle = '#060806'; rrect(c, bx + 50, by + 50, bw - 100, 280, 16); c.fill();
    const N = 46, amp = p.quiet ? 0.15 : 1, env = clamp(lt / 0.3);
    for (let i = 0; i < N; i++) { const v = (0.15 + 0.85 * Math.abs(Math.sin(t * (6 + (i % 7)) + i * 1.7) * Math.sin(t * 2.3 + i * 0.4))) * amp * env, h = 20 + v * 210, x = bx + 70 + i * ((bw - 140) / N); c.fillStyle = P.accent; c.shadowColor = P.accent; c.shadowBlur = 16; c.fillRect(x, by + 190 - h / 2, 9, h); } c.shadowBlur = 0;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 5; j++) { c.fillStyle = '#080908'; c.beginPath(); c.arc(bx + 90 + i * 44, by + 420 + j * 44, 13, 0, 7); c.fill(); }
    const kx = bx + bw - 190, ky = by + 510; c.fillStyle = '#0b0b0b'; c.beginPath(); c.arc(kx, ky, 120, 0, 7); c.fill(); c.strokeStyle = P.accent; c.lineWidth = 10; const na = -1.2 + Math.sin(t * 9) * 0.06; c.beginPath(); c.moveTo(kx, ky); c.lineTo(kx + Math.cos(na) * 95, ky + Math.sin(na) * 95); c.stroke();
    c.font = 'bold 70px "DejaVu Sans Mono"'; c.textAlign = 'center'; c.fillStyle = P.accent; c.fillText(p.freq || '87.5 MHz', W / 2, by + bh - 70);
    c.strokeStyle = '#222'; c.lineWidth = 10; c.beginPath(); c.moveTo(bx + 120, by); c.lineTo(bx + 330, by - 330); c.stroke();
    if (mod(t, 1) < 0.5) { glow(c, bx + 80, by + bh - 90, 50, P.warn, 0.9); c.fillStyle = P.warn; c.beginPath(); c.arc(bx + 80, by + bh - 90, 13, 0, 7); c.fill(); }
    const r = rng(Math.floor(t * 30)); for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(255,255,255,${r() * 0.1})`; c.fillRect(r() * W, r() * H, 3, 3); }
  },

  wasteland(c, t, lt, d, p, P) {
    const hz = H * 0.62; c.fillStyle = vgrad(c, 0, hz, [[0, P.bg0], [0.7, P.bg1], [1, A(P.warn, 0.55)]]); c.fillRect(0, 0, W, H); stars(c, t, 60, 4, 1);
    if (p.flares) for (let i = 0; i < 6; i++) { const r = rng(i * 13 + Math.floor((t + i * 0.9) / 2.2)), ph = mod(t + i * 0.9, 2.2), x = r() * W, a = ph < 0.5 ? Math.exp(-ph * 9) : 0; if (a > 0.01) { glow(c, x, hz - 20, 520, '#fff0c0', a * 0.9); glow(c, x, hz, 900, P.warn, a * 0.4); } }
    for (let i = 0; i < 3; i++) { const sx = 150 + i * 380, sway = Math.sin(t * 0.4 + i) * 40; c.fillStyle = 'rgba(10,10,10,.5)'; poly(c, [[sx - 20, hz], [sx + 20, hz], [sx + 120 + sway, hz - 700], [sx - 60 + sway, hz - 700]], 'rgba(8,8,8,.45)'); }
    const cols = ['#141a10', '#0c100a', '#050604'];
    for (let l = 0; l < 3; l++) { const pts = [[0, H]]; for (let x = 0; x <= W; x += 30) pts.push([x, hz + l * 150 + Math.sin((x + t * (6 + l * 10)) * 0.006 + l * 2) * 40 + Math.sin((x + t * 12) * 0.017 + l) * 14]); pts.push([W, H]); poly(c, pts, cols[l]); }
    if (p.tower) { c.fillStyle = '#060705'; c.fillRect(760, hz - 430, 16, 520); c.fillRect(900, hz - 430, 16, 520); c.fillRect(730, hz - 520, 220, 110); poly(c, [[710, hz - 520], [970, hz - 520], [840, hz - 600]], '#060705'); c.strokeStyle = '#060705'; c.lineWidth = 8; c.beginPath(); c.moveTo(768, hz - 400); c.lineTo(908, hz); c.moveTo(908, hz - 400); c.lineTo(768, hz); c.stroke(); glow(c, 840, hz - 470, 90 + Math.sin(t * 3) * 10, P.accent, 0.8); }
    const nf = p.figures || 0; for (let i = 0; i < nf; i++) figure(c, 200 + i * 130 + lt * 14, hz + 190 + (i % 2) * 24, 190, '#030403', { swing: Math.sin(t * 5 + i), pack: true });
    c.strokeStyle = '#040504'; c.lineWidth = 4; for (let x = -40; x < W; x += 210) { c.beginPath(); c.moveTo(x, H * 0.9); c.lineTo(x + 14, H * 0.82); c.stroke(); c.beginPath(); c.moveTo(x + 14, H * 0.84); c.quadraticCurveTo(x + 110, H * 0.86, x + 224, H * 0.84); c.stroke(); }
    particles(c, t, 120, 6, 120, 16, '#d8cfb8', 3);
  },
};

// ---------- layout: platform safe zones (1080x1920) ----------
// Platform UI hides the top ~250px, the bottom ~480px and a button column on the right (x > 940 for y 850-1500).
// Keep faces and key action inside x 70-940, y 300-1080. Captions sit at y ~1190. Nothing important below y 1400.
const SAFE = { top: 250, bottom: 1400, left: 70, right: 940, capY: 1190 };
const STYLE0 = { accent: '#5ad7ff', warn: '#ff3344', hi: '#ffe14a', alt: '#8fe6ff', titleFont: 'Anton', titleWeight: 400, bloom: 0.38, vignette: 0.72, grain: 0.06 };
function sty() { const P = PAL[TL.theme]; return Object.assign({}, STYLE0, P ? { accent: P.accent, warn: P.warn } : {}, TL.style || {}); }
const tfont = (S, size) => `${S.titleWeight} ${size}px "${S.titleFont}"`;

function captions(c, t, S) {
  const cov = TL.cover || 0; if (t >= TL.choice.start || t < cov || (TL.vote && t < TL.vote.end + 0.2)) return;
  const ch = TL.chunks.find(k => t >= k.start && t < k.end); if (!ch) return;
  c.font = '800 88px Inter'; c.textAlign = 'left'; c.lineJoin = 'round';
  const pop = 1 + 0.08 * (1 - ease((t - Math.max(ch.start, cov)) / 0.12));
  const lines = []; let cur = [];
  for (const w of ch.words) { const test = [...cur, w].map(x => x.w).join(' '); if (c.measureText(test).width > 820 && cur.length) { lines.push(cur); cur = [w]; } else cur.push(w); }
  if (cur.length) lines.push(cur);
  c.save(); c.translate(W / 2, SAFE.capY + 30); c.scale(pop, pop);
  lines.forEach((ln, li) => { const sp = c.measureText(' ').width, tw = ln.reduce((s, w) => s + c.measureText(w.w).width, 0) + sp * (ln.length - 1); let x = -tw / 2; const y = (li - (lines.length - 1) / 2) * 104;
    for (const w of ln) { const active = t >= w.start && t < w.end; c.strokeStyle = '#000'; c.lineWidth = 20; c.strokeText(w.w, x, y); c.fillStyle = active ? S.hi : (w.alt ? S.alt : '#ffffff'); c.fillText(w.w, x, y); x += c.measureText(w.w).width + sp; } });
  c.restore();
}

function header(c, t, S) {
  const cov = TL.cover || 0; if (t < cov) return;
  const v0 = TL.vote ? TL.vote.end + 0.25 : cov, a = (t < TL.choice.start ? 1 : 1 - ease((t - TL.choice.start) / 0.3)) * ease((t - v0) / 0.25); if (a <= 0) return;
  c.save(); c.globalAlpha = a; c.font = '800 36px Inter'; c.textAlign = 'center';
  const label = `${TL.series}  ·  PART ${TL.episode}`, tw = c.measureText(label).width + 56;
  c.fillStyle = 'rgba(0,0,0,.55)'; rrect(c, W / 2 - tw / 2, 262, tw, 64, 32); c.fill(); c.strokeStyle = A(S.accent, 0.9); c.lineWidth = 3; c.stroke(); c.fillStyle = '#fff'; c.fillText(label, W / 2, 307);
  if (TL.hook && t < v0 + 3.0) { const k = ease((t - v0) / 0.3) * (1 - ease((t - v0 - 2.6) / 0.4)); c.globalAlpha = k * a; c.font = tfont(S, 84); const ls = wrap(c, String(TL.hook).toUpperCase(), 860); ls.forEach((l, i) => { c.strokeStyle = '#000'; c.lineWidth = 18; c.lineJoin = 'round'; c.strokeText(l, W / 2, 468 + i * 96); c.fillStyle = S.warn; c.fillText(l, W / 2, 468 + i * 96); }); }
  c.restore();
}

function choiceCard(c, t, S, soft) {
  const ch = TL.choice, lt = t - ch.start; if (lt < 0) return;
  c.fillStyle = `rgba(0,0,0,${0.7 * ease(lt / 0.4)})`; c.fillRect(0, 0, W, H);
  c.textAlign = 'center'; c.lineJoin = 'round';
  let a = ease(lt / 0.4); c.globalAlpha = a; c.font = '800 38px Inter'; c.fillStyle = S.accent; c.fillText(`${TL.series}  ·  PART ${TL.episode}`, W / 2, 300);
  c.font = '800 92px Inter'; c.fillStyle = '#fff'; const ql = wrap(c, ch.question, 860); ql.forEach((l, i) => c.fillText(l, W / 2, 440 + i * 100 - (1 - a) * 40));
  const PX = 140, PW = 800, PH = 232, GAP = 76, y0 = 440 + (ql.length - 1) * 100 + 70;
  const panel = (y, letter, text, c0, c1, delay, dir, hot) => {
    const k = ease((lt - delay) / 0.45); if (k <= 0) return; const x = PX + dir * (1 - k) * W, s = 1 + (hot ? 0.025 : 0);
    c.save(); c.globalAlpha = k; c.translate(W / 2, y + PH / 2); c.scale(s, s); c.translate(-W / 2, -(y + PH / 2));
    c.shadowColor = c0; c.shadowBlur = hot ? 70 : 30; const g = c.createLinearGradient(x, y, x + PW, y + PH); g.addColorStop(0, c0); g.addColorStop(1, c1); c.fillStyle = g; rrect(c, x, y, PW, PH, 40); c.fill(); c.shadowBlur = 0;
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 5; c.stroke();
    if (!soft) { c.fillStyle = '#fff'; c.beginPath(); c.arc(x + 118, y + PH / 2, 76, 0, 7); c.fill(); c.fillStyle = c1; c.font = '800 104px Inter'; c.textAlign = 'center'; c.fillText(letter, x + 118, y + PH / 2 + 37); }
    c.fillStyle = '#fff'; c.font = '800 58px Inter'; c.textAlign = soft ? 'center' : 'left'; const ls = wrap(c, text, PW - (soft ? 100 : 270)); ls.forEach((l, i) => c.fillText(l, soft ? x + PW / 2 : x + 228, y + PH / 2 + 21 + (i - (ls.length - 1) / 2) * 68)); c.restore();
  };
  const hot = lt > 1.4 ? Math.floor(lt / 0.75) % 2 : -1, yB = y0 + PH + GAP;
  panel(y0, 'A', ch.a, '#2f7bff', '#0a2f9c', 0.25, -1, hot === 0); panel(yB, 'B', ch.b, '#ff4646', '#96101f', 0.5, 1, hot === 1);
  a = ease((lt - 0.55) / 0.3); if (a > 0) { c.globalAlpha = a; c.fillStyle = '#0b0b0b'; c.beginPath(); c.arc(W / 2, y0 + PH + GAP / 2, 52, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 5; c.stroke(); c.fillStyle = '#fff'; c.font = '800 42px Inter'; c.textAlign = 'center'; c.fillText('OR', W / 2, y0 + PH + GAP / 2 + 15); }
  a = ease((lt - 1.0) / 0.4); if (a > 0) { const pu = 1 + 0.04 * Math.sin(lt * 7), CTA = soft ? 'WHAT WOULD YOU DO?' : 'COMMENT  A  OR  B', yc = yB + PH + 108; c.save(); c.globalAlpha = a; c.translate(W / 2, yc); c.scale(pu, pu); c.font = soft ? '800 66px Inter' : '800 76px Inter'; c.textAlign = 'center'; c.strokeStyle = '#000'; c.lineWidth = 16; c.strokeText(CTA, 0, 0); c.fillStyle = S.hi; c.fillText(CTA, 0, 0); c.restore();
    c.globalAlpha = a; c.font = '600 36px Inter'; c.fillStyle = 'rgba(255,255,255,.9)'; c.fillText(soft ? `Part ${TL.episode + 1} follows what most of you would do` : `Top answer decides Part ${TL.episode + 1}`, W / 2, yc + 58);
    const rem = clamp(1 - lt / ((TL.outro ? TL.outro.start : TL.duration) - ch.start)); c.fillStyle = 'rgba(255,255,255,.2)'; rrect(c, 190, yc + 86, 700, 14, 7); c.fill(); c.fillStyle = S.warn; rrect(c, 190, yc + 86, Math.max(14, 700 * rem), 14, 7); c.fill(); }
  c.globalAlpha = 1;
}

// Part 2 onward opens with the result of the last vote: both options, the percentages filling up, and a tap on the winner.
// TL.vote = {start, end, click, question, a, b, a_pct, b_pct, chosen: 'A'|'B'}
function voteCard(c, t, S) {
  const v = TL.vote; if (!v) return; const lt = t - v.start; if (lt < 0 || t > v.end + 0.45) return;
  const al = ease(lt / 0.3) * (1 - ease((t - v.end) / 0.45)); if (al <= 0) return;
  c.save(); c.globalAlpha = al; c.fillStyle = 'rgba(0,0,0,.76)'; c.fillRect(0, 0, W, H); c.textAlign = 'center'; c.lineJoin = 'round';
  c.font = '800 38px Inter'; c.fillStyle = S.accent; c.fillText('THE VOTES ARE IN', W / 2, 300);
  c.font = '800 66px Inter'; c.fillStyle = '#fff'; const ql = wrap(c, v.question, 860); ql.forEach((l, i) => c.fillText(l, W / 2, 432 + i * 76));
  const PX = 140, PW = 800, PH = 196, GAP = 44, y0 = 432 + (ql.length - 1) * 76 + 64, tc = v.click - v.start, grow = ease((lt - 0.5) / 1.3), won = ease((lt - tc) / 0.25);
  const panel = (y, letter, text, pct, c0, c1, win) => {
    const pop = win ? 1 + 0.045 * Math.sin(clamp((lt - tc) / 0.35) * Math.PI) : 1, dim = win ? 1 : 1 - 0.6 * won;
    c.save(); c.globalAlpha = al * dim; c.translate(W / 2, y + PH / 2); c.scale(pop, pop); c.translate(-W / 2, -(y + PH / 2));
    c.fillStyle = 'rgba(255,255,255,.09)'; rrect(c, PX, y, PW, PH, 36); c.fill();
    c.save(); rrect(c, PX, y, PW, PH, 36); c.clip(); const g = c.createLinearGradient(PX, y, PX + PW, y); g.addColorStop(0, c0); g.addColorStop(1, c1); c.fillStyle = g; c.fillRect(PX, y, PW * pct / 100 * grow, PH); c.restore();
    if (win && won > 0) { c.shadowColor = c0; c.shadowBlur = 60 * won; } c.strokeStyle = win && won > 0 ? '#ffffff' : 'rgba(255,255,255,.6)'; c.lineWidth = win && won > 0 ? 7 : 4; rrect(c, PX, y, PW, PH, 36); c.stroke(); c.shadowBlur = 0;
    c.fillStyle = '#fff'; c.beginPath(); c.arc(PX + 96, y + PH / 2, 60, 0, 7); c.fill(); c.fillStyle = c1; c.font = '800 82px Inter'; c.textAlign = 'center'; c.fillText(letter, PX + 96, y + PH / 2 + 29);
    c.fillStyle = '#fff'; c.font = '800 46px Inter'; c.textAlign = 'left'; const ls = wrap(c, text, PW - 420); ls.forEach((l, i) => c.fillText(l, PX + 180, y + PH / 2 + 16 + (i - (ls.length - 1) / 2) * 54));
    c.font = '800 96px Inter'; c.textAlign = 'right'; c.fillText(Math.round(pct * grow) + '%', PX + PW - 30, y + PH / 2 + 34); c.restore();
  };
  const yB = y0 + PH + GAP, wA = v.chosen === 'A';
  panel(y0, 'A', v.a, v.a_pct, '#2f7bff', '#0a2f9c', wA); panel(yB, 'B', v.b, v.b_pct, '#ff4646', '#96101f', !wA);
  c.font = '600 32px Inter'; c.fillStyle = 'rgba(255,255,255,.85)'; c.textAlign = 'center'; c.fillText('Votes from ' + ((TL.brand && TL.brand.platforms) || []).join(' · '), W / 2, yB + PH + 62);
  // the tap: a pointer slides to the winner and presses it
  const ty = (wA ? y0 : yB) + PH / 2 + 30, tx = PX + PW * 0.55, k = ease((lt - (tc - 0.7)) / 0.6), px = lerp(980, tx, k), py = lerp(1500, ty, k), press = 1 - 0.14 * Math.sin(clamp((lt - tc) / 0.3) * Math.PI);
  if (lt > tc - 0.7) { if (lt > tc) { const r = (lt - tc) / 0.5; if (r < 1) { c.strokeStyle = `rgba(255,255,255,${1 - r})`; c.lineWidth = 8 * (1 - r) + 2; c.beginPath(); c.arc(px, py, 30 + r * 110, 0, 7); c.stroke(); } }
    c.save(); c.translate(px, py); c.scale(press, press); c.fillStyle = '#ffffff'; c.strokeStyle = '#0a0c12'; c.lineWidth = 7; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 86); c.lineTo(22, 66); c.lineTo(38, 104); c.lineTo(56, 96); c.lineTo(40, 60); c.lineTo(70, 60); c.closePath(); c.stroke(); c.fill(); c.restore(); }
  if (won > 0) { const s = 1 + 0.25 * (1 - ease((lt - tc) / 0.3)); c.save(); c.globalAlpha = al * won; c.translate(W / 2, yB + PH + 178); c.scale(s, s); c.font = '800 92px Inter'; c.strokeStyle = '#000'; c.lineWidth = 18; const m = `${v.chosen} IT IS`; c.strokeText(m, 0, 0); c.fillStyle = S.hi; c.fillText(m, 0, 0); c.restore(); }
  c.restore();
}

// End card: where to find the channel. TL.outro = {start}; TL.brand = {name, handle, platforms, outro_text}
function outroCard(c, t, S, soft) {
  const o = TL.outro, b = TL.brand; if (!o || !b) return; const lt = t - o.start; if (lt < 0) return;
  const k = ease(lt / 0.35), ch = TL.choice, up = (d0) => ease((lt - d0) / 0.35);
  c.save(); c.fillStyle = `rgba(5,7,13,${(lt < 0.36 ? 1 : 0.9) * k})`; c.fillRect(0, 0, W, H); c.textAlign = 'center'; c.lineJoin = 'round';
  c.globalAlpha = k; c.font = '800 38px Inter'; c.fillStyle = S.accent; c.fillText(`${TL.series}  ·  PART ${TL.episode}`, W / 2, 300);
  // the two options stay on screen, small
  const opt = (y, letter, text, c0, c1, d0) => { const a = up(d0); if (a <= 0) return; c.save(); c.globalAlpha = a; c.translate((1 - a) * -60, 0); const g = c.createLinearGradient(140, y, 940, y); g.addColorStop(0, c0); g.addColorStop(1, c1); c.fillStyle = g; rrect(c, 140, y, 800, 84, 26); c.fill(); c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 3; c.stroke();
    c.fillStyle = '#fff'; c.font = '800 40px Inter'; if (!soft) { c.beginPath(); c.arc(190, y + 42, 28, 0, 7); c.fill(); c.fillStyle = c1; c.font = '800 38px Inter'; c.textAlign = 'center'; c.fillText(letter, 190, y + 56); c.fillStyle = '#fff'; c.font = '800 40px Inter'; c.textAlign = 'left'; c.fillText(text, 240, y + 56); } else { c.textAlign = 'center'; c.fillText(text, W / 2, y + 56); } c.restore(); };
  opt(388, 'A', ch.a, '#2f7bff', '#0a2f9c', 0.05); opt(488, 'B', ch.b, '#ff4646', '#96101f', 0.12);
  let a = up(0.2); c.globalAlpha = a; c.textAlign = 'center'; c.font = '800 52px Inter'; c.strokeStyle = '#000'; c.lineWidth = 12; const cta = soft ? 'WHAT WOULD YOU DO?' : 'COMMENT  A  OR  B'; c.strokeText(cta, W / 2, 648); c.fillStyle = S.hi; c.fillText(cta, W / 2, 648);
  c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(240, 700, 600, 3);
  // the channel
  const words = String(b.name).toUpperCase().split(' '), l1 = words.slice(0, -1).join(' '), l2 = words.slice(-1)[0];
  a = up(0.3); c.globalAlpha = a; c.save(); c.translate(W / 2, 860); c.scale(1 + 0.12 * (1 - a), 1 + 0.12 * (1 - a)); c.font = tfont(STYLE0, 124); c.strokeStyle = '#000'; c.lineWidth = 16; c.strokeText(l1, 0, -40); c.fillStyle = '#ffffff'; c.fillText(l1, 0, -40); c.strokeText(l2, 0, 82); c.fillStyle = S.hi; c.fillText(l2, 0, 82); c.restore();
  a = up(0.45); c.globalAlpha = a; c.font = '800 62px Inter'; c.fillStyle = S.accent; c.fillText(b.handle, W / 2, 1030);
  a = up(0.6); c.globalAlpha = a; c.font = '600 38px Inter'; c.fillStyle = 'rgba(255,255,255,.92)'; c.fillText(b.outro_text || 'Find us on', W / 2, 1098);
  const cols = { instagram: '#e1306c', facebook: '#1877f2', youtube: '#ff2b2b', tiktok: '#25d9e6' };
  (b.platforms || []).slice(0, 4).forEach((pn, i) => { const d0 = 0.75 + i * 0.13, q = ease((lt - d0) / 0.3); if (q <= 0) return; const x = i % 2 ? 560 : 140, y = 1128 + Math.floor(i / 2) * 96, col = cols[pn.toLowerCase()] || S.accent, sc = 0.85 + 0.15 * q;
    c.save(); c.globalAlpha = q; c.translate(x + 190, y + 39); c.scale(sc, sc); c.translate(-(x + 190), -(y + 39)); c.fillStyle = 'rgba(255,255,255,.08)'; rrect(c, x, y, 380, 78, 39); c.fill(); c.strokeStyle = col; c.lineWidth = 4; c.stroke(); c.fillStyle = col; c.beginPath(); c.arc(x + 44, y + 39, 13, 0, 7); c.fill(); c.fillStyle = '#fff'; c.font = '800 40px Inter'; c.textAlign = 'left'; c.fillText(pn, x + 74, y + 53); c.restore(); });
  a = up(1.3); c.globalAlpha = a * 0.9; c.textAlign = 'center'; c.font = '600 34px Inter'; c.fillStyle = '#fff'; c.fillText(soft ? `Part ${TL.episode + 1} follows what most of you would do` : `Top answer decides Part ${TL.episode + 1}`, W / 2, 1368);
  c.restore();
}

// Cover / thumbnail text. TL.thumb = {visual, params, title, tagline, layout:'top'|'center'|'bottom', colors:[..], size, lines:[..], text:false to draw your own in the shot overlay}
function thumbText(c, S) {
  const th = TL.thumb; if (!th || !th.title || th.text === false) return;
  const lay = th.layout || 'top', maxW = th.maxW || 900; let size = th.size || 210, lines;
  for (; size >= 90; size -= 6) { c.font = tfont(S, size); lines = th.lines || wrap(c, String(th.title).toUpperCase(), maxW); if (lines.length <= (th.maxLines || 2) && lines.every(l => c.measureText(l).width <= maxW)) break; }
  const lh = size * 1.0, blockH = lines.length * lh, tagH = th.tagline ? 130 : 0, partH = 86;
  let y = lay === 'top' ? 380 + partH : lay === 'center' ? 960 - (blockH + tagH + partH) / 2 + partH : 1440 - tagH - blockH;
  c.save(); c.textAlign = 'center'; c.lineJoin = 'round';
  c.font = '800 40px Inter'; const pl = TL.partLabel || `PART ${TL.episode}`, pw = c.measureText(pl).width + 56; c.fillStyle = S.accent; rrect(c, W / 2 - pw / 2, y - partH, pw, 62, 31); c.fill(); c.fillStyle = '#06080c'; c.fillText(pl, W / 2, y - partH + 45);
  c.font = tfont(S, size);
  lines.forEach((l, i) => { const yy = y + size * 0.84 + i * lh; c.shadowColor = 'rgba(0,0,0,.65)'; c.shadowBlur = 34; c.shadowOffsetY = 12; c.lineWidth = Math.max(16, size * 0.15); c.strokeStyle = '#000'; c.strokeText(l, W / 2, yy); c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0; c.fillStyle = (th.colors || ['#ffffff', S.hi])[i % 2]; c.fillText(l, W / 2, yy); });
  if (th.tagline) { c.font = '800 54px Inter'; const tl = wrap(c, String(th.tagline).toUpperCase(), 820), ty = y + blockH + 44; tl.forEach((l, i) => { const w = c.measureText(l).width + 60; c.fillStyle = th.tagBg || S.warn; rrect(c, W / 2 - w / 2, ty + i * 84, w, 76, 14); c.fill(); c.fillStyle = th.tagColor || '#ffffff'; c.fillText(l, W / 2, ty + i * 84 + 56); }); }
  c.restore();
}

// The channel handle, small, on EVERY frame (cover, story and choice card) so re-uploads carry it.
// Films also place it inside their sets (see renderer/kit/brand.js); this is the guaranteed copy.
function watermark(c, t, S) {
  const b = TL.brand; if (!b || !b.handle) return;
  const cov = TL.cover || 0, ch = TL.choice.start, story = t >= cov && t < ch;
  const k = t >= ch ? ease((t - ch) / 0.3) : 0, y = story || t >= ch ? lerp(362, 340, k) : 340, big = !story || k > 0;
  c.save(); c.textAlign = 'center'; c.lineJoin = 'round'; c.font = `600 ${big ? 30 : 27}px Inter`; c.globalAlpha = story ? lerp(0.62, 0.9, k) : 0.9;
  c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeText(b.handle, W / 2, y); c.fillStyle = '#ffffff'; c.fillText(b.handle, W / 2, y); c.restore();
}

function guides(c) {   // --guides: where platform UI will cover the frame
  c.save(); c.fillStyle = 'rgba(255,0,60,.28)'; c.fillRect(0, 0, W, SAFE.top); c.fillRect(0, 1500, W, H - 1500); c.fillRect(SAFE.right, 850, W - SAFE.right, 650);
  c.fillStyle = 'rgba(255,160,0,.18)'; c.fillRect(0, SAFE.bottom, W, 1500 - SAFE.bottom);
  c.strokeStyle = 'rgba(0,255,160,.8)'; c.lineWidth = 3; c.setLineDash([14, 10]); c.strokeRect(130, SAFE.capY - 110, 820, 220); c.strokeStyle = 'rgba(255,255,0,.7)'; c.strokeRect(1, 285, W - 2, 1350);
  c.setLineDash([]); c.font = '600 26px Inter'; c.textAlign = 'left'; c.fillStyle = '#fff'; c.fillText('platform UI', 16, 40); c.fillText('captions', 140, SAFE.capY - 120); c.fillText('4:5 grid crop', 16, 316); c.restore();
}

function postFx(c, t, P) {
  if (P.grade) { c.save(); c.globalCompositeOperation = P.grade.mode || 'soft-light'; c.globalAlpha = P.grade.alpha ?? 0.15; c.fillStyle = P.grade.color || '#ff8800'; c.fillRect(0, 0, W, H); c.restore(); }
  if (P.bloom > 0) { if (!window._bl) { window._bl = document.createElement('canvas'); _bl.width = W / 4; _bl.height = H / 4; }
    const b = _bl.getContext('2d'); b.filter = 'blur(7px) contrast(1.55) brightness(0.82)'; b.drawImage(cv, 0, 0, W / 4, H / 4);
    c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = P.bloom; c.drawImage(_bl, 0, 0, W, H); c.restore(); }
  if (P.vignette > 0) { const vg = c.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${P.vignette})`); c.fillStyle = vg; c.fillRect(0, 0, W, H); }
  if (P.grain > 0) { const r = rng(Math.floor(t * 30) + 1); for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(255,255,255,${r() * P.grain})`; c.fillRect(r() * W, r() * H, 3, 3); } }
}

// ---------- main ----------
let _base = null;
window.init = tl => {
  TL = tl; cv = document.getElementById('c'); ctx = cv.getContext('2d'); _base = document.createElement('canvas'); _base.width = W; _base.height = H;
  const fl = (typeof FONT_LIST !== 'undefined' ? FONT_LIST : []).map(f => document.fonts.load(`${f.style === 'italic' ? 'italic ' : ''}${f.weight} 40px "${f.family}"`));
  return Promise.all([...fl, document.fonts.load('800 96px Inter'), document.fonts.load('600 40px Inter'), document.fonts.load('bold 40px "DejaVu Sans Mono"')]).then(() => true);
};
function sceneAt(t) {
  const cov = TL.cover || 0;
  if (t < cov && TL.thumb && SCENES[TL.thumb.visual]) return { visual: TL.thumb.visual, params: TL.thumb.params || {}, start: 0, end: TL.thumb.dur || 3, cover: true, words: [] };
  return TL.scenes.find(s => t >= s.start && t < s.end) || TL.scenes[TL.scenes.length - 1];
}
// Draw the picture (scene + look) without any text overlay, and keep a copy so both cuts can share it.
window.renderBase = t => {
  const c = ctx, S = sty(), P0 = PAL[TL.theme] || PAL.space, sc = sceneAt(t), cov = TL.cover || 0;
  const lt = t - sc.start, d = Math.min(sc.end, TL.duration) - sc.start, fn = SCENES[sc.visual] || SCENES.space;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.shadowBlur = 0; c.filter = 'none'; c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  c.save();
  if (!fn.raw) {   // 2D scenes get a slow push-in and impact shake; 3D shots do both with the real camera
    let sx = 0, sy = 0; for (const k of hits(['knock', 'boom', 'impact'])) { const dt = t - k; if (dt >= 0 && dt < 0.3) { const a = 22 * (1 - dt / 0.3); sx += Math.sin(dt * 95) * a; sy += Math.cos(dt * 80) * a * 0.6; } }
    const z = 1.03 + 0.05 * clamp(lt / d); c.translate(W / 2 + sx, H / 2 + sy); c.scale(z, z); c.translate(-W / 2, -H / 2);
  }
  fn(c, t, lt, d, sc.params || {}, P0, sc);
  c.restore(); c.setTransform(1, 0, 0, 1, 0, 0); c.shadowBlur = 0; c.globalAlpha = 1; c.filter = 'none'; c.globalCompositeOperation = 'source-over';
  postFx(c, t, Object.assign({}, S, fn.post || {}, sc.post || {}));
  const tin = sc.in || (fn.raw ? 'cut' : 'fade');
  if (tin === 'fade' && lt < 0.14) { c.fillStyle = `rgba(0,0,0,${1 - lt / 0.14})`; c.fillRect(0, 0, W, H); }
  if (tin === 'flash' && lt < 0.14) { c.fillStyle = `rgba(255,255,255,${0.9 * (1 - lt / 0.14)})`; c.fillRect(0, 0, W, H); }
  if (!fn.raw && d - lt < 0.1 && sc !== TL.scenes[TL.scenes.length - 1]) { c.fillStyle = `rgba(0,0,0,${0.7 * (1 - (d - lt) / 0.1)})`; c.fillRect(0, 0, W, H); }
  if (sc.cover) thumbText(c, S);
  else if (cov && t - cov < 0.16) { c.fillStyle = `rgba(255,255,255,${0.85 * (1 - (t - cov) / 0.16)})`; c.fillRect(0, 0, W, H); }
  _base.getContext('2d').drawImage(cv, 0, 0);
};
// Draw the text layer over the saved picture. soft = Facebook/Instagram cut (no "comment A or B").
window.renderOver = (t, soft) => {
  const c = ctx, S = sty(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.drawImage(_base, 0, 0);
  if (!window.CLEAN) { header(c, t, S); captions(c, t, S); voteCard(c, t, S); if (!TL.outro || t < TL.outro.start + 0.36) choiceCard(c, t, S, !!soft); outroCard(c, t, S, !!soft); }
  if (!window.NOMARK) watermark(c, t, S);
  if (window.GUIDES) guides(c);
};
window.renderFrame = (t, soft) => { renderBase(t); renderOver(t, soft ?? TL.soft); };
