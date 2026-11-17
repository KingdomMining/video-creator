// Bespoke shots for DEEP SIGNAL — Episode 1. Hand-built, shot by shot. Loaded after scenes.js (shares its helpers).
const _cache = {};
function cached(key, w, h, fn) { if (!_cache[key]) { const k = document.createElement('canvas'); k.width = w; k.height = h; fn(k.getContext('2d'), w, h); _cache[key] = k; } return _cache[key]; }
const sm = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const strobe = t => Math.pow(0.5 + 0.5 * Math.sin(t * 5.2), 2);
const NAME = 'R. VOSS';

function starfield() {
  return cached('stars', 1700, 2400, (c, w, h) => {
    const r = rng(7);
    for (let i = 0; i < 70; i++) { const k = r(); glow(c, k * w + (r() - 0.5) * 380, h * 0.1 + k * h * 0.7 + (r() - 0.5) * 300, 180 + r() * 300, ['#3b5bd0', '#7a3bb8', '#1d8a9a', '#b0406a'][i % 4], 0.018 + r() * 0.03); }
    for (let i = 0; i < 3200; i++) {
      const x = r() * w, y = r() * h, big = r() < 0.012, m = big ? 1 : 0, s = big ? 1.8 + r() * 1.4 : 0.4 + Math.pow(r(), 3) * 1.3, hue = r();
      const col = hue < 0.15 ? '255,205,170' : hue < 0.32 ? '170,200,255' : '255,255,255';
      c.fillStyle = `rgba(${col},${Math.min(1, 0.15 + r() * 0.6 + m)})`; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill();
      if (big) { glow(c, x, y, s * 9, '#bcd8ff', 0.4); c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - s * 10, y); c.lineTo(x + s * 10, y); c.moveTo(x, y - s * 10); c.lineTo(x, y + s * 10); c.stroke(); }
    }
  });
}
function frostTex() {
  return cached('frost', 1000, 1000, (c, w) => {
    const r = rng(31), R = w / 2;
    for (let i = 0; i < 26000; i++) { const a = r() * 6.283, k = Math.pow(r(), 2.6), rr = R * (1 - k * 0.55), s = 1 + r() * 3; c.fillStyle = `rgba(225,242,255,${(1 - k) * 0.5 * r()})`; c.fillRect(R + Math.cos(a) * rr, R + Math.sin(a) * rr, s, s); }
    c.lineCap = 'round';
    for (let i = 0; i < 520; i++) { const a = r() * 6.283, r0 = R * (0.99 - r() * 0.05), len = 30 + Math.pow(r(), 2) * 190, wob = (r() - 0.5) * 0.25; c.strokeStyle = `rgba(235,246,255,${0.1 + r() * 0.3})`; c.lineWidth = 1 + r() * 2.4; c.beginPath(); c.moveTo(R + Math.cos(a) * r0, R + Math.sin(a) * r0); c.lineTo(R + Math.cos(a + wob) * (r0 - len), R + Math.sin(a + wob) * (r0 - len)); c.stroke(); }
    const g = c.createRadialGradient(R, R, R * 0.62, R, R, R); g.addColorStop(0, 'rgba(220,240,255,0)'); g.addColorStop(1, 'rgba(220,240,255,.34)'); c.fillStyle = g; c.fillRect(0, 0, w, w);
  });
}
function metalG(c, x0, y0, x1, y1, a = '#8793a6', b = '#343f50', d = '#0d121b') { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(0.45, b); g.addColorStop(1, d); return g; }
function bolts(c, cx, cy, r, n, size) { for (let i = 0; i < n; i++) { const a = i / n * 6.283 + 0.2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; c.fillStyle = '#0a0d13'; c.beginPath(); c.arc(x + 2, y + 3, size, 0, 7); c.fill(); const g = c.createRadialGradient(x - size * 0.3, y - size * 0.3, 1, x, y, size); g.addColorStop(0, '#aab4c4'); g.addColorStop(1, '#2c3544'); c.fillStyle = g; c.beginPath(); c.arc(x, y, size * 0.8, 0, 7); c.fill(); } }
function redWash(c, t, amt) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,30,40,${amt * strobe(t)})`; c.fillRect(-60, -60, W + 120, H + 120); c.restore(); }
function arcText(c, text, cx, cy, r, a0, a1) { const n = text.length; for (let i = 0; i < n; i++) { const a = lerp(a0, a1, n === 1 ? 0.5 : i / (n - 1)); c.save(); c.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r); c.rotate(a + Math.PI / 2 * Math.sign(a1 - a0)); c.fillText(text[i], 0, 0); c.restore(); } }

// ================= SHOT 1 — the Meridian passes a ringed giant =================
function dsPlanet(c, px, py, R) {
  const ring = front => { c.save(); c.translate(px, py); c.rotate(-0.36); c.scale(1, 0.2); for (let i = 0; i < 34; i++) { const rr = R * (1.22 + i * 0.022), a = [.5, .34, .62, .14, .46, .3, .56, .07, .42, .22, .6][i % 11]; c.strokeStyle = `rgba(${228 - i * 2},${196 - i * 2},${158 - i},${a * 0.6})`; c.lineWidth = R * 0.019; c.beginPath(); c.arc(0, 0, rr, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2); c.stroke(); } c.restore(); };
  ring(false);
  const g0 = c.createRadialGradient(px, py, R * 0.96, px, py, R * 1.09); g0.addColorStop(0, 'rgba(255,170,110,.5)'); g0.addColorStop(1, 'rgba(255,170,110,0)'); c.fillStyle = g0; c.beginPath(); c.arc(px, py, R * 1.09, 0, 7); c.fill();
  const body = cached('planet', 1700, 1700, (b, w) => {
    const r = rng(5), Rb = w / 2; b.translate(Rb, Rb); b.beginPath(); b.arc(0, 0, Rb, 0, 7); b.clip(); b.rotate(-0.36);
    const pal = ['#d9a066', '#b9713d', '#e8c79a', '#8a4a2a', '#c98a52', '#f0d9b5', '#a35a33', '#6e3a24'];
    let y = -Rb; while (y < Rb) { const hgt = 18 + r() * 90, col = pal[Math.floor(r() * pal.length)], ph = r() * 9, amp = 4 + r() * 12; b.fillStyle = col; b.beginPath(); b.moveTo(-Rb, y + hgt + 20); for (let x = -Rb; x <= Rb; x += 20) b.lineTo(x, y + Math.sin(x * 0.006 + ph) * amp + Math.sin(x * 0.021 + ph * 2) * amp * 0.4); b.lineTo(Rb, y + hgt + 20); b.fill(); y += hgt; }
    for (let i = 0; i < 9; i++) { const x = (r() - 0.5) * Rb * 1.5, yy = (r() - 0.5) * Rb * 1.5, w2 = 40 + r() * 130; b.fillStyle = `rgba(${r() > 0.5 ? '255,235,205' : '110,50,30'},.45)`; b.beginPath(); b.ellipse(x, yy, w2, w2 * 0.33, 0, 0, 7); b.fill(); }
    for (let i = 0; i < 2500; i++) { b.fillStyle = `rgba(${r() > 0.5 ? 255 : 40},${r() > 0.5 ? 230 : 20},${r() > 0.5 ? 200 : 10},.05)`; b.fillRect((r() - 0.5) * w, (r() - 0.5) * w, 30 + r() * 120, 3); }
  });
  c.drawImage(body, px - R, py - R, R * 2, R * 2);
  const sh = c.createRadialGradient(px + R * 0.62, py - R * 0.66, 0, px + R * 0.3, py - R * 0.3, R * 1.75); sh.addColorStop(0, 'rgba(30,10,0,.12)'); sh.addColorStop(0.3, 'rgba(20,6,0,.3)'); sh.addColorStop(0.56, 'rgba(2,2,10,.8)'); sh.addColorStop(0.8, 'rgba(1,1,8,.98)');
  c.fillStyle = sh; c.beginPath(); c.arc(px, py, R + 1, 0, 7); c.fill();
  ring(true);
}
function dsShip(c, t) {
  const hull = (y0, y1) => { const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, '#eef3fa'); g.addColorStop(0.22, '#93a1b6'); g.addColorStop(0.7, '#283244'); g.addColorStop(1, '#090c14'); return g; };
  // engine plume
  c.save(); c.globalCompositeOperation = 'lighter';
  for (const ny of [-46, 0, 46]) { const L = 330 + Math.sin(t * 31 + ny) * 28 + Math.sin(t * 13) * 16, g = c.createLinearGradient(-455, 0, -455 - L, 0); g.addColorStop(0, 'rgba(235,250,255,.95)'); g.addColorStop(0.14, 'rgba(90,205,255,.75)'); g.addColorStop(1, 'rgba(40,90,255,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(-455, ny - 16); c.quadraticCurveTo(-455 - L * 0.4, ny - 26, -455 - L, ny); c.quadraticCurveTo(-455 - L * 0.4, ny + 26, -455, ny + 16); c.fill(); }
  glow(c, -490, 0, 300, '#5ad7ff', 0.5); c.restore();
  // radiators
  for (const s of [-1, 1]) { poly(c, [[-340, s * 12], [-190, s * 12], [-160, s * 215], [-310, s * 215]], '#141922'); for (let i = 0; i < 7; i++) { c.strokeStyle = `rgba(255,${90 + i * 8},50,${0.55 - i * 0.05})`; c.lineWidth = 3; c.beginPath(); c.moveTo(-338 + i * 4.3, s * (22 + i * 28)); c.lineTo(-188 + i * 4.3, s * (22 + i * 28)); c.stroke(); } c.strokeStyle = 'rgba(160,180,210,.5)'; c.lineWidth = 2; c.beginPath(); c.moveTo(-340, s * 12); c.lineTo(-310, s * 215); c.lineTo(-160, s * 215); c.lineTo(-190, s * 12); c.stroke(); }
  // hab ring (back half) + spokes
  const rx = 215, spoke = front => { for (let i = 0; i < 6; i++) { const a = t * 0.9 + i * Math.PI / 3, f = Math.cos(a) > 0; if (f !== front) continue; c.strokeStyle = front ? '#8493a8' : '#3a4558'; c.lineWidth = 7; c.beginPath(); c.moveTo(rx, 0); c.lineTo(rx + Math.cos(a) * 34, Math.sin(a) * 172); c.stroke(); } };
  c.strokeStyle = '#2a3446'; c.lineWidth = 24; c.beginPath(); c.ellipse(rx, 0, 34, 172, 0, Math.PI / 2, Math.PI * 1.5); c.stroke(); spoke(false);
  // spine truss
  c.fillStyle = hull(-13, 13); c.fillRect(-360, -13, 600, 26); c.strokeStyle = 'rgba(10,14,22,.8)'; c.lineWidth = 2; for (let x = -360; x < 230; x += 26) { c.beginPath(); c.moveTo(x, -13); c.lineTo(x + 26, 13); c.moveTo(x + 26, -13); c.lineTo(x, 13); c.stroke(); }
  // cargo containers
  const r = rng(3), cols = ['#5d6b7a', '#8a6038', '#3f5468', '#7a4038', '#4e6f66', '#6a6f7c'];
  for (const s of [-1, 1]) for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) { const keep = r() > 0.13, col = cols[Math.floor(r() * cols.length)]; if (!keep) continue; const x = -170 + i * 60, y = s > 0 ? 15 + row * 46 : -15 - (row + 1) * 46; c.fillStyle = col; c.fillRect(x, y, 56, 43); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x, y + 30, 56, 13); for (let k = 1; k < 5; k++) c.fillRect(x + k * 11, y, 2, 43); c.fillStyle = s < 0 && row === 1 ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.18)'; c.fillRect(x, y, 56, 3); }
  // engine block
  poly(c, [[-362, -66], [-420, -74], [-456, -64], [-456, 64], [-420, 74], [-362, 66]], hull(-74, 74)); for (const ny of [-46, 0, 46]) { poly(c, [[-456, ny - 10], [-474, ny - 19], [-474, ny + 19], [-456, ny + 10]], '#0a0d14'); glow(c, -476, ny, 46, '#dff6ff', 0.95); }
  // command module
  c.fillStyle = hull(-56, 56); c.beginPath(); c.moveTo(244, -56); c.lineTo(378, -56); c.quadraticCurveTo(462, -44, 462, 0); c.quadraticCurveTo(462, 44, 378, 56); c.lineTo(244, 56); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(8,11,18,.6)'; c.lineWidth = 2; for (const x of [282, 330, 378]) { c.beginPath(); c.moveTo(x, -56); c.lineTo(x, 56); c.stroke(); }
  c.fillStyle = '#0b0f18'; c.font = '800 20px Inter'; c.textAlign = 'left'; c.fillText('MERIDIAN', 256, 30);
  for (let i = 0; i < 5; i++) { glow(c, 392 + i * 13, -14 + i * 3.4, 20, '#ffd9a0', 0.8); c.fillStyle = '#ffe9c4'; rrect(c, 386 + i * 13, -19 + i * 3.4, 9, 12, 3); c.fill(); }
  for (let i = 0; i < 6; i++) { c.fillStyle = `rgba(255,220,160,${i === 2 ? 0.25 : 0.8})`; c.fillRect(258 + i * 19, -22, 10, 7); }
  c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 3; c.beginPath(); c.moveTo(244, -56); c.lineTo(378, -56); c.quadraticCurveTo(450, -46, 460, -10); c.stroke();
  c.strokeStyle = '#9aa7ba'; c.lineWidth = 4; c.beginPath(); c.moveTo(300, -56); c.lineTo(300, -112); c.stroke(); c.beginPath(); c.arc(300, -140, 34, 0.5, Math.PI - 0.5); c.stroke(); c.beginPath(); c.moveTo(300, -112); c.lineTo(300, -128); c.stroke();
  // hab ring front half
  const rg = c.createLinearGradient(0, -172, 0, 172); rg.addColorStop(0, '#f2f6fb'); rg.addColorStop(0.3, '#8d9bb0'); rg.addColorStop(1, '#141a26'); c.strokeStyle = rg; c.lineWidth = 24; c.beginPath(); c.ellipse(rx, 0, 34, 172, 0, -Math.PI / 2, Math.PI / 2); c.stroke(); spoke(true);
  for (let i = 0; i < 10; i++) { const a = t * 0.9 + i * 0.628; if (Math.cos(a) > 0.1) { c.fillStyle = 'rgba(255,225,170,.95)'; c.fillRect(rx + Math.cos(a) * 34 - 3, Math.sin(a) * 172 - 3, 6, 6); } }
  // nav lights
  const bl = mod(t, 1.4) < 0.12 ? 1 : 0; glow(c, -410, -78, 60, '#ff3030', 0.4 + bl * 0.6); glow(c, 440, 40, 50, '#40ff80', 0.7); if (mod(t + 0.7, 1.4) < 0.08) glow(c, 300, -146, 90, '#ffffff', 1);
}
SCENES.ds_exterior = (c, t, lt, d) => {
  c.fillStyle = vgrad(c, 0, H, [[0, '#01020a'], [0.6, '#050919'], [1, '#090613']]); c.fillRect(-60, -60, W + 120, H + 120);
  c.drawImage(starfield(), -260 - lt * 9, -200 - lt * 3);
  const sx = W * 0.86, sy = H * 0.15; glow(c, sx, sy, 700, '#8fb8ff', 0.32); glow(c, sx, sy, 170, '#ffffff', 1);
  c.save(); c.globalCompositeOperation = 'lighter'; const sg = c.createLinearGradient(sx - 1000, 0, sx + 400, 0); sg.addColorStop(0, 'rgba(110,160,255,0)'); sg.addColorStop(0.71, 'rgba(200,225,255,.85)'); sg.addColorStop(1, 'rgba(110,160,255,0)'); c.fillStyle = sg; c.fillRect(sx - 1000, sy - 5, 1400, 10); c.fillRect(sx - 600, sy - 1.5, 900, 3); c.restore();
  dsPlanet(c, W * 0.07 - lt * 7, H * 1.03 + lt * 3, 860);
  c.save(); c.translate(W * 0.4 + lt * 26, H * 0.43 - lt * 7 + Math.sin(t * 0.5) * 6); c.rotate(-0.2); c.scale(0.98, 0.98); dsShip(c, t); c.restore();
  // lens ghosts on the sun→centre axis
  c.save(); c.globalCompositeOperation = 'lighter'; for (const [k, rr, a, col] of [[0.35, 46, 0.12, '#7fb0ff'], [0.62, 90, 0.07, '#b08cff'], [1.25, 150, 0.05, '#7fffe0'], [1.55, 60, 0.1, '#ffb080']]) glow(c, sx + (W / 2 - sx) * k * 1.6, sy + (H / 2 - sy) * k * 1.6, rr, col, a * 3); c.restore();
  const r = rng(77); for (let i = 0; i < 16; i++) { const x = mod(r() * W - lt * (30 + r() * 80), W + 300) - 150, y = r() * H, s = 12 + r() * 46; c.fillStyle = `rgba(180,205,255,${0.02 + r() * 0.04})`; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill(); }
};

// ================= SHOT 2 — the cryo bay, dolly to the one empty pod =================
function dsPod(c, x, t, name, empty, seed, flag) {
  const top = 610, bot = 1430, r = rng(seed);
  c.strokeStyle = '#04090c'; c.lineWidth = 16; c.lineCap = 'round'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(x + s * 90, top + 20); c.bezierCurveTo(x + s * 120, top - 160, x + s * 40, 380, x + s * 150, 250); c.stroke(); }
  c.fillStyle = metalG(c, x - 200, top, x + 200, bot, '#2f4350', '#152430', '#060c11'); rrect(c, x - 198, top - 20, 396, bot - top + 40, 70); c.fill(); c.strokeStyle = 'rgba(150,210,230,.25)'; c.lineWidth = 3; c.stroke();
  const gx = x - 142, gy = top + 34, gw = 284, gh = 742;
  c.save(); rrect(c, gx, gy, gw, gh, 140); c.clip();
  if (empty) {
    c.fillStyle = '#02070a'; c.fillRect(gx, gy, gw, gh); const fl = 0.7 + 0.3 * rng(Math.floor(t * 12))(); glow(c, x, gy + 110, 330, '#ffb23f', 0.4 * fl);
    c.fillStyle = '#0b161c'; rrect(c, x - 96, gy + 80, 192, 600, 90); c.fill(); c.strokeStyle = 'rgba(255,190,90,.3)'; c.lineWidth = 3; for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(x - 80, gy + 230 + i * 74); c.lineTo(x + 80, gy + 230 + i * 74); c.stroke(); }
    for (let i = 0; i < 7; i++) { const yy = gy + gh - mod(t * 46 + i * 110, gh); c.fillStyle = `rgba(220,240,255,${0.07 * (1 - (gy + gh - yy) / gh)})`; c.beginPath(); c.ellipse(x + Math.sin(t * 0.7 + i * 2) * 60, yy, 90, 40, 0, 0, 7); c.fill(); }
  } else {
    const g = c.createRadialGradient(x, gy + 300, 20, x, gy + 360, 470); g.addColorStop(0, '#c9f7ff'); g.addColorStop(0.4, '#3ba5c6'); g.addColorStop(1, '#052532'); c.fillStyle = g; c.fillRect(gx, gy, gw, gh);
    const hy = gy + 150 + r() * 50, br = Math.sin(t * 0.8 + seed) * 3; c.fillStyle = 'rgba(3,26,38,.8)'; c.beginPath(); c.arc(x, hy, 54, 0, 7); c.fill();
    c.beginPath(); c.moveTo(x - 26, hy + 44); c.lineTo(x + 26, hy + 44); c.quadraticCurveTo(x + 118 + br, hy + 74, x + 122 + br, hy + 170); c.lineTo(x + 100, hy + 660); c.lineTo(x - 100, hy + 660); c.lineTo(x - 122 - br, hy + 170); c.quadraticCurveTo(x - 118 - br, hy + 74, x - 26, hy + 44); c.fill();
    c.globalAlpha = 0.75; c.drawImage(frostTex(), gx - 240, gy - 20, gw + 480, gh + 40); c.globalAlpha = 1;
    for (let i = 0; i < 5; i++) { const yy = gy + mod(t * 20 + i * 170 + seed * 40, gh); c.fillStyle = 'rgba(235,250,255,.07)'; c.beginPath(); c.ellipse(x + Math.sin(t * 0.5 + i) * 50, yy, 130, 46, 0, 0, 7); c.fill(); }
  }
  c.fillStyle = 'rgba(255,255,255,.13)'; poly(c, [[gx + 30, gy], [gx + 96, gy], [gx + 40, gy + gh], [gx - 20, gy + gh]], 'rgba(255,255,255,.11)');
  c.restore();
  c.strokeStyle = empty ? 'rgba(255,190,90,.8)' : 'rgba(190,245,255,.85)'; c.lineWidth = 5; rrect(c, gx, gy, gw, gh, 140); c.stroke(); c.strokeStyle = '#03080b'; c.lineWidth = 12; rrect(c, gx - 9, gy - 9, gw + 18, gh + 18, 148); c.stroke();
  if (empty) { c.save(); c.globalAlpha = 0.5; poly(c, [[gx + gw + 14, gy + 30], [gx + gw + 130, gy - 30], [gx + gw + 130, gy + gh - 90], [gx + gw + 14, gy + gh - 20]], 'rgba(150,215,235,.16)'); c.strokeStyle = 'rgba(200,240,255,.7)'; c.lineWidth = 4; c.stroke(); c.restore(); }
  // name plate
  const col = flag ? '#ff5a64' : empty ? '#ffb23f' : '#7fe9ff', pu = empty || flag ? 0.75 + 0.25 * Math.sin(t * 6) : 1;
  c.fillStyle = '#03090d'; rrect(c, x - 172, 452, 344, 116, 14); c.fill(); c.strokeStyle = A(col, 0.9 * pu); c.lineWidth = 3; c.stroke();
  c.textAlign = 'center'; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 18 * pu; c.font = '800 46px Inter'; c.fillText(name, x, 506);
  c.font = 'bold 26px "DejaVu Sans Mono"'; c.fillStyle = flag ? A('#ff5a64', pu) : empty ? A('#ffb23f', pu) : '#58f29a'; c.fillText(flag ? 'PILOT · ASLEEP' : empty ? 'PILOT · AWAKE' : 'CRYO · STABLE', x, 546); c.shadowBlur = 0;
  // vitals strip
  c.fillStyle = '#02070a'; rrect(c, x - 120, bot - 96, 240, 62, 10); c.fill(); c.strokeStyle = empty ? 'rgba(255,178,63,.8)' : '#58f29a'; c.lineWidth = 3; c.beginPath();
  for (let i = 0; i <= 200; i += 4) { const ph = mod(i / 200 * 3 - t * (0.5 + seed * 0.03), 1), y = empty ? 0 : (ph < 0.06 ? -22 * Math.sin(ph / 0.06 * Math.PI) : ph < 0.1 ? 9 : 0); i ? c.lineTo(x - 100 + i, bot - 65 + y) : c.moveTo(x - 100 + i, bot - 65 + y); } c.stroke();
  const rf = c.createLinearGradient(0, bot + 14, 0, bot + 420); rf.addColorStop(0, empty ? 'rgba(255,178,63,.2)' : 'rgba(120,225,255,.3)'); rf.addColorStop(1, 'rgba(120,225,255,0)'); c.fillStyle = rf; for (let i = 0; i < 9; i++) c.fillRect(x - 128 + i * 4 + Math.sin(t * 1.4 + i * 2 + seed) * 5, bot + 14 + i * 44, 256 - i * 8, 26); glow(c, x, bot + 60, 330, empty ? '#ffb23f' : '#5ad7ff', 0.22);
}
SCENES.ds_cryo = (c, t, lt, d, p) => {
  const pan = lerp(-40, 1070, sm(lt / (d - 1.0)));
  c.fillStyle = vgrad(c, 0, H, [[0, '#010406'], [0.45, '#06222d'], [0.75, '#041219'], [1, '#010304']]); c.fillRect(-60, -60, W + 120, H + 120);
  for (let i = -1; i < 12; i++) { const x = i * 300 - pan * 0.6; c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x, 0, 6, 1440); c.fillStyle = 'rgba(120,200,220,.05)'; c.fillRect(x + 6, 0, 3, 1440); c.fillStyle = 'rgba(0,0,0,.25)'; rrect(c, x + 60, 700, 180, 300, 12); c.fill(); }
  for (const [y, h, col] of [[250, 44, '#0c1c24'], [316, 26, '#102a35'], [366, 60, '#081419']]) { c.fillStyle = vgrad(c, y, y + h, [[0, '#3b5562'], [0.3, col], [1, '#020507']]); c.fillRect(-60, y, W + 120, h); for (let i = 0; i < 9; i++) { c.fillStyle = '#02080b'; c.fillRect(mod(i * 260 - pan * 0.85, W + 400) - 200, y - 4, 22, h + 8); } }
  c.fillStyle = vgrad(c, 1430, H, [[0, '#0a2a36'], [0.25, '#051820'], [1, '#010304']]); c.fillRect(-60, 1430, W + 120, H);
  c.strokeStyle = 'rgba(140,220,240,.12)'; c.lineWidth = 2; for (let i = 0; i < 6; i++) { const y = 1440 + i * i * 14; c.beginPath(); c.moveTo(-60, y); c.lineTo(W + 60, y); c.stroke(); }
  const names = ['K. ADEYEMI', 'L. PARK', 'S. OKAFOR', NAME, 'M. HALE'];
  names.forEach((n, i) => { const x = 220 + i * 470 - pan; if (x < -330 || x > W + 330) return; c.save(); c.globalCompositeOperation = 'lighter'; const lg = c.createLinearGradient(0, 400, 0, 1300); lg.addColorStop(0, 'rgba(160,235,255,.16)'); lg.addColorStop(1, 'rgba(160,235,255,0)'); c.fillStyle = lg; poly(c, [[x - 60, 410], [x + 60, 410], [x + 330, 1440], [x - 330, 1440]], lg); c.restore(); c.fillStyle = '#dff8ff'; c.fillRect(x - 70, 402, 140, 10); glow(c, x, 408, 120, '#bff2ff', 0.7); dsPod(c, x, t, n, n === NAME && !p.occupied, i + 1, n === NAME && p.occupied); });
  for (let i = 0; i < 9; i++) { c.fillStyle = `rgba(200,240,255,${0.05 + 0.02 * Math.sin(t + i)})`; c.beginPath(); c.ellipse(mod(i * 310 + t * (14 + i * 5) - pan * 1.1, W + 900) - 450, 1450 + (i % 3) * 46, 420, 60, 0, 0, 7); c.fill(); }
  for (const wx of [700, 1830]) { const x = wx - pan * 1.7, g = c.createLinearGradient(x, 0, x + 120, 0); g.addColorStop(0, '#000203'); g.addColorStop(0.8, '#04141b'); g.addColorStop(1, '#2b5a6a'); c.fillStyle = g; c.fillRect(x, -60, 120, H + 120); }
};

// ================= SHOT 3 — cockpit, proximity alarm =================
SCENES.ds_alert = (c, t, lt, d, p) => {
  const calm = !!p.calm, S = calm ? 0 : strobe(t), on = mod(t, 0.5) < 0.3;
  c.fillStyle = '#020306'; c.fillRect(-60, -60, W + 120, H + 120);
  // canopy
  c.save(); c.beginPath(); c.moveTo(70, 880); c.lineTo(150, 300); c.quadraticCurveTo(540, 220, 930, 300); c.lineTo(1010, 880); c.closePath(); c.clip();
  c.fillStyle = vgrad(c, 250, 900, [[0, '#01030b'], [1, '#081028']]); c.fillRect(0, 200, W, 720); c.drawImage(starfield(), -500 - lt * 14, -700);
  const pg = c.createRadialGradient(900, 1700, 880, 900, 1700, 990); pg.addColorStop(0, '#2a140c'); pg.addColorStop(0.75, '#c97a42'); pg.addColorStop(0.9, 'rgba(255,170,110,.5)'); pg.addColorStop(1, 'rgba(255,170,110,0)'); c.fillStyle = pg; c.beginPath(); c.arc(900, 1700, 990, 0, 7); c.fill();
  // HUD
  if (!calm) {  const tx = lerp(700, 560, sm(lt / d)), ty = lerp(430, 600, sm(lt / d)), bs = 56 + 10 * Math.sin(t * 9);
  c.strokeStyle = `rgba(255,60,70,${on ? 1 : 0.35})`; c.lineWidth = 5; for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.beginPath(); c.moveTo(tx + a * bs, ty + b * (bs - 22)); c.lineTo(tx + a * bs, ty + b * bs); c.lineTo(tx + a * (bs - 22), ty + b * bs); c.stroke(); }
  glow(c, tx, ty, 26, '#ffffff', 0.9); c.fillStyle = '#fff'; c.beginPath(); c.arc(tx, ty, 3.5, 0, 7); c.fill();
  c.font = 'bold 26px "DejaVu Sans Mono"'; c.textAlign = 'left'; c.fillStyle = '#ff5a64'; c.fillText(`RNG ${Math.max(3, Math.round(lerp(140, 3, sm(lt / d))))} M`, tx + bs + 14, ty - 8); c.fillText('UNIDENTIFIED', tx + bs + 14, ty + 24); }
  c.strokeStyle = 'rgba(90,215,255,.3)'; c.lineWidth = 2; for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(500, 380 + i * 50); c.lineTo(i % 2 ? 530 : 560, 380 + i * 50); c.stroke(); }
  c.fillStyle = 'rgba(255,255,255,.05)'; poly(c, [[150, 300], [330, 270], [180, 880], [70, 880]], 'rgba(255,255,255,.045)');
  c.restore();
  c.strokeStyle = '#05070b'; c.lineWidth = 40; c.lineJoin = 'round'; c.beginPath(); c.moveTo(70, 880); c.lineTo(150, 300); c.quadraticCurveTo(540, 220, 930, 300); c.lineTo(1010, 880); c.closePath(); c.stroke(); c.lineWidth = 22; for (const [a, b] of [[395, 262], [685, 262]]) { c.beginPath(); c.moveTo(a, b); c.lineTo(a - (540 - a) * 0.25, 880); c.stroke(); }
  c.strokeStyle = calm ? 'rgba(120,190,255,.3)' : 'rgba(255,90,100,.35)'; c.lineWidth = 3; c.beginPath(); c.moveTo(92, 870); c.lineTo(168, 316); c.quadraticCurveTo(540, 240, 912, 316); c.stroke();
  c.textAlign = 'center';
  if (!calm) { c.fillStyle = `rgba(255,40,50,${on ? 0.9 : 0.45})`; rrect(c, 150, 322, 780, 86, 12); c.fill(); c.fillStyle = on ? '#fff' : 'rgba(255,255,255,.5)'; c.font = '800 54px Inter'; c.textAlign = 'center'; c.fillText('PROXIMITY ALERT', 570, 384); poly(c, [[212, 390], [246, 336], [280, 390]], on ? '#fff' : 'rgba(255,255,255,.5)'); c.fillStyle = '#ff2832'; c.font = '800 38px Inter'; c.fillText('!', 246, 386); } else { c.font = 'bold 30px "DejaVu Sans Mono"'; c.fillStyle = 'rgba(90,215,255,.75)'; c.fillText(p.hud || 'ALL SYSTEMS NOMINAL', 540, 372); }
  // dash
  poly(c, [[-60, 900], [W + 60, 900], [W + 60, H + 60], [-60, H + 60]], vgrad(c, 900, H, [[0, '#2a3446'], [0.1, '#121a26'], [0.45, '#0a0f17'], [1, '#020305']]));
  const scr = (x, y, w, h) => { c.fillStyle = '#010305'; rrect(c, x - 8, y - 8, w + 16, h + 16, 18); c.fill(); c.fillStyle = '#04121a'; rrect(c, x, y, w, h, 10); c.fill(); };
  scr(50, 950, 440, 300); scr(590, 950, 440, 300);
  const cx = 270, cy = 1100, R = 128; c.strokeStyle = 'rgba(90,215,255,.6)'; c.lineWidth = 3; for (let i = 1; i <= 3; i++) { c.beginPath(); c.arc(cx, cy, R * i / 3, 0, 7); c.stroke(); } c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
  for (let i = 0; i < 24; i++) { c.fillStyle = `rgba(90,215,255,${0.3 * (1 - i / 24)})`; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, t * 2.6 - i * 0.04 - 0.04, t * 2.6 - i * 0.04); c.fill(); }
  if (!calm) { const bd = lerp(0.95, 0.12, sm(lt / d)), bx = cx + Math.cos(-0.8) * R * bd, by = cy + Math.sin(-0.8) * R * bd, pu = mod(t * 2.2, 1); c.strokeStyle = `rgba(255,60,70,${1 - pu})`; c.lineWidth = 4; c.beginPath(); c.arc(bx, by, 8 + pu * 34, 0, 7); c.stroke(); glow(c, bx, by, 34, '#ff3344', 1); c.fillStyle = '#fff'; c.beginPath(); c.arc(bx, by, 6, 0, 7); c.fill(); }
  c.textAlign = 'left'; c.font = 'bold 30px "DejaVu Sans Mono"'; const lines = p.lines ? p.lines.map(q => q[0] === '!' ? [q.slice(1), '#ff5a64'] : q[0] === '*' ? [q.slice(1), '#ffffff'] : [q, '#5ad7ff']) : [['ON WATCH', '#5ad7ff'], [NAME + '  PILOT', '#ffffff'], ['CREW AWAKE  1', '#5ad7ff'], ['CONTACTS    1', '#ff5a64'], ['HULL TOUCH  ' + (lt > d * 0.7 ? 'YES' : '--'), '#ff5a64']];
  c.font = 'bold 27px "DejaVu Sans Mono"'; lines.forEach(([s, col], i) => { c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 12; c.fillText(s, 664, 998 + i * 47); }); c.shadowBlur = 0;
  for (let i = 0; i < 14; i++) { const lit = rng(i + Math.floor(t * 3) * 17)() > 0.5; c.fillStyle = i % 5 === 0 && !calm ? `rgba(255,50,60,${on ? 1 : 0.3})` : lit ? '#5ad7ff' : '#12303c'; rrect(c, 70 + i * 68, 1290, 46, 26, 6); c.fill(); }
  c.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 950; y < 1250; y += 5) c.fillRect(50, y, 980, 2);
  // pilot, over the shoulder
  const hx = 540 + (calm ? Math.sin(t * 0.4) * 8 : sm((lt - 0.5) / 0.7) * 34), hy = 1236;
  glow(c, 540, 1180, 520, '#5ad7ff', 0.16);
  c.fillStyle = '#010203'; rrect(c, 250, 1400, 580, 700, 90); c.fill(); rrect(c, 410, 1150, 260, 360, 60); c.fill();
  c.beginPath(); c.arc(hx, hy, 104, 0, 7); c.fill(); poly(c, [[200, H + 60], [250, 1560], [420, 1470], [660, 1470], [830, 1560], [880, H + 60]], '#010203');
  c.strokeStyle = calm ? 'rgba(150,200,255,.4)' : `rgba(255,60,70,${0.25 + 0.55 * S})`; c.lineWidth = 6; c.beginPath(); c.arc(hx, hy, 104, -2.7, -0.4); c.stroke(); c.strokeStyle = 'rgba(90,215,255,.45)'; c.beginPath(); c.arc(hx, hy, 104, 2.5, 3.5); c.stroke(); c.strokeStyle = calm ? 'rgba(150,200,255,.4)' : `rgba(255,60,70,${0.25 + 0.55 * S})`; c.beginPath(); c.moveTo(252, 1560); c.lineTo(420, 1472); c.moveTo(660, 1472); c.lineTo(828, 1560); c.stroke();
  if (!calm) { glow(c, lerp(-100, W + 100, mod(t * 0.9, 1)), 240, 520, '#ff2030', 0.35); redWash(c, t, 0.16); }
};

// ================= SHOT 4 — sprint down the corridor to the airlock =================
SCENES.ds_run = (c, t, lt, d) => {
  const cx = W / 2 + Math.sin(lt * 5.6) * 14, cy = H * 0.47 + Math.sin(lt * 11.2) * 20, cam = 15.2 * ease(lt / d), S = strobe(t);
  const pt = (sx, sy, f) => [cx + (sx - cx) * f, cy + (sy - cy) * f], zd = 19 - cam, fd = 1 / zd;
  c.fillStyle = '#020306'; c.fillRect(-60, -60, W + 120, H + 120);
  const wall = (a, b, x0) => { const g = c.createLinearGradient(x0, 0, cx, 0); g.addColorStop(0, '#2e3a4c'); g.addColorStop(0.6, '#0e141e'); g.addColorStop(1, '#04060a'); poly(c, [pt(...a, 1.3), pt(...a, fd), pt(...b, fd), pt(...b, 1.3)], g); };
  wall([0, 0], [0, H], 0); wall([W, 0], [W, H], W);
  poly(c, [pt(0, H, 1.3), pt(0, H, fd), pt(W, H, fd), pt(W, H, 1.3)], vgrad(c, H, cy, [[0, '#3a4658'], [0.5, '#101722'], [1, '#04060a']]));
  poly(c, [pt(0, 0, 1.3), pt(0, 0, fd), pt(W, 0, fd), pt(W, 0, 1.3)], vgrad(c, 0, cy, [[0, '#1a2230'], [1, '#04060a']]));
  for (const [sy, w, col] of [[H * 0.3, 16, '#5d6b80'], [H * 0.345, 8, '#8a5a30'], [H * 0.72, 22, '#3c4758']]) for (const sx of [0, W]) { const a = pt(sx, sy, 1.3), b = pt(sx, sy, fd); c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); }
  const fg = c.createLinearGradient(0, cy, 0, H); fg.addColorStop(0, 'rgba(255,40,50,0)'); fg.addColorStop(1, `rgba(255,40,50,${0.1 + 0.2 * S})`); poly(c, [pt(W * 0.3, H, 1.3), pt(W * 0.45, H, fd), pt(W * 0.55, H, fd), pt(W * 0.7, H, 1.3)], fg);
  c.strokeStyle = 'rgba(160,190,220,.14)'; c.lineWidth = 2; for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo(...pt(i * W / 8, H, 1.3)); c.lineTo(...pt(i * W / 8, H, fd)); c.stroke(); }
  // end wall + hatch
  const [ex0, ey0] = pt(0, 0, fd), [ex1, ey1] = pt(W, H, fd), ew = ex1 - ex0, eh = ey1 - ey0; c.fillStyle = metalG(c, ex0, ey0, ex1, ey1, '#39465a', '#182130', '#070a10'); c.fillRect(ex0, ey0, ew, eh);
  const hr = ew * 0.36, hcx = cx, hcy = ey0 + eh * 0.5; c.fillStyle = '#080b11'; c.beginPath(); c.arc(hcx, hcy, hr * 1.14, 0, 7); c.fill(); c.fillStyle = metalG(c, hcx - hr, hcy - hr, hcx + hr, hcy + hr); c.beginPath(); c.arc(hcx, hcy, hr, 0, 7); c.fill();
  c.fillStyle = '#02040a'; c.beginPath(); c.arc(hcx, hcy, hr * 0.42, 0, 7); c.fill(); glow(c, hcx, hcy, hr * 0.5, '#6fb4ff', 0.5); glow(c, hcx, ey0 + eh * 0.13, ew * 0.4, '#ff2030', 0.4 + 0.6 * S); c.fillStyle = '#ff5560'; c.fillRect(hcx - ew * 0.07, ey0 + eh * 0.11, ew * 0.14, eh * 0.025);
  // ribs + chasing emergency lights
  for (let i = 12; i >= 0; i--) { const z = i * 1.5 - cam + 0.4; if (z < 0.78 || z > zd) continue; const f = 1 / z, [x0, y0] = pt(0, 0, f), [x1, y1] = pt(W, H, f), a = clamp((z - 0.78) * 4);
    c.strokeStyle = `rgba(70,84,104,${a})`; c.lineWidth = 46 * f; c.strokeRect(x0, y0, x1 - x0, y1 - y0); c.strokeStyle = `rgba(150,170,200,${a * 0.5})`; c.lineWidth = 5 * f; c.strokeRect(x0 + 23 * f, y0 + 23 * f, x1 - x0 - 46 * f, y1 - y0 - 46 * f);
    const litp = Math.pow(0.5 + 0.5 * Math.sin(t * 9 - i * 1.1), 3); glow(c, cx, y0 + 34 * f, 520 * f, '#ff2030', 0.3 * a * (0.4 + 0.6 * litp)); c.save(); c.shadowColor = '#ff2030'; c.shadowBlur = 90 * f; c.strokeStyle = `rgba(255,${70 + 150 * litp},${80 + 120 * litp},${a * (0.6 + 0.4 * litp)})`; c.lineWidth = 24 * f;
    c.beginPath(); c.moveTo(cx - W * 0.2 * f, y0 + 34 * f); c.lineTo(cx + W * 0.2 * f, y0 + 34 * f); c.stroke(); for (const s of [0, 1]) { const xx = s ? x1 - 34 * f : x0 + 34 * f; c.beginPath(); c.moveTo(xx, cy - H * 0.12 * f); c.lineTo(xx, cy + H * 0.12 * f); c.stroke(); } c.restore(); }
  // speed streaks
  const r = rng(9), sp = 1 - ease(lt / d); for (let i = 0; i < 46; i++) { const a = r() * 6.283, r0 = 420 + r() * 700, len = (80 + r() * 300) * sp, ph = mod(r() + lt * 2.4, 1); c.strokeStyle = `rgba(255,200,205,${0.14 * sp * (1 - ph)})`; c.lineWidth = 3; c.beginPath(); c.moveTo(cx + Math.cos(a) * (r0 + ph * 300), cy + Math.sin(a) * (r0 + ph * 300) * 1.6); c.lineTo(cx + Math.cos(a) * (r0 + ph * 300 + len), cy + Math.sin(a) * (r0 + ph * 300 + len) * 1.6); c.stroke(); }
  redWash(c, t, 0.14);
};

// ================= SHOT 5 — the hatch. Three slow knocks. =================
function knockEnv(t) { let e = 0; for (const k of hits(['knock'])) { const dt = t - k; if (dt >= 0 && dt < 0.5) e = Math.max(e, Math.exp(-dt * 7)); } return e; }
SCENES.ds_hatch = (c, t, lt, d, p) => {
  if (p.tight) { c.translate(540, 900); c.scale(1.6, 1.6); c.translate(-540, -900); }
  const S = strobe(t), cx = 540, cy = 900, K = knockEnv(t);
  c.fillStyle = metalG(c, 0, 0, W, H, '#3d4a5e', '#1a2331', '#080b12'); c.fillRect(-60, -60, W + 120, H + 120);
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 7; for (let y = 60; y < H; y += 380) { c.beginPath(); c.moveTo(-60, y); c.lineTo(W + 60, y); c.stroke(); c.strokeStyle = 'rgba(170,195,225,.08)'; c.lineWidth = 2; c.beginPath(); c.moveTo(-60, y + 6); c.lineTo(W + 60, y + 6); c.stroke(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 7; }
  for (const x of [22, 70, 1016, 1058]) { c.fillStyle = vgrad(c, 0, 1, [[0, '#000']]); const g = c.createLinearGradient(x, 0, x + 34, 0); g.addColorStop(0, '#0a0e15'); g.addColorStop(0.4, '#566278'); g.addColorStop(1, '#0a0e15'); c.fillStyle = g; c.fillRect(x, -60, 34, H + 120); for (let y = 200; y < H; y += 460) { c.fillStyle = '#0b0f17'; c.fillRect(x - 5, y, 44, 26); } }
  c.font = '800 70px Inter'; c.textAlign = 'left'; c.fillStyle = 'rgba(235,240,250,.5)'; c.fillText('AIRLOCK 02', 130, 372); c.fillStyle = 'rgba(235,240,250,.3)'; c.font = '600 26px Inter'; c.fillText('EXTERIOR ACCESS · VACUUM BEYOND THIS POINT', 132, 412);
  c.save(); c.beginPath(); c.rect(-60, 1560, W + 120, 76); c.clip(); c.fillStyle = '#d9a514'; c.fillRect(-60, 1560, W + 120, 76); for (let i = -2; i < 20; i++) poly(c, [[i * 90, 1636], [i * 90 + 44, 1636], [i * 90 + 110, 1560], [i * 90 + 66, 1560]], '#0d0d0d'); c.restore(); c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(-60, 1636, W + 120, 400);
  // hatch
  c.fillStyle = 'rgba(0,0,0,.6)'; c.beginPath(); c.arc(cx + 10, cy + 18, 432, 0, 7); c.fill();
  c.fillStyle = metalG(c, cx - 420, cy - 420, cx + 420, cy + 420, '#a7b3c6', '#4a566a', '#131a26'); c.beginPath(); c.arc(cx, cy, 420, 0, 7); c.fill(); bolts(c, cx, cy, 388, 16, 15);
  c.fillStyle = '#070a10'; c.beginPath(); c.arc(cx, cy, 356, 0, 7); c.fill();
  c.fillStyle = metalG(c, cx - 340, cy - 340, cx + 340, cy + 340, '#7b889c', '#2f3a4c', '#0c111a'); c.beginPath(); c.arc(cx, cy, 340, 0, 7); c.fill();
  for (let i = 0; i < 4; i++) { c.save(); c.translate(cx, cy); c.rotate(i * Math.PI / 2 + Math.PI / 4); c.fillStyle = metalG(c, 0, -30, 0, 30, '#93a0b5', '#3a4558', '#10151f'); c.fillRect(196, -30, 140, 60); c.fillStyle = '#0a0d14'; c.fillRect(300, -20, 26, 40); c.restore(); }
  c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 5; c.beginPath(); c.arc(cx, cy, 262, 0, 7); c.stroke(); c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 338, 3.5, 5.2); c.stroke();
  // porthole
  c.fillStyle = metalG(c, cx - 190, cy - 190, cx + 190, cy + 190, '#b8c3d4', '#566277', '#161c28'); c.beginPath(); c.arc(cx, cy, 192, 0, 7); c.fill(); bolts(c, cx, cy, 172, 10, 9);
  c.save(); c.beginPath(); c.arc(cx, cy, 150, 0, 7); c.clip(); c.fillStyle = vgrad(c, cy - 150, cy + 150, [[0, '#01030a'], [1, '#07142c']]); c.fillRect(cx - 150, cy - 150, 300, 300);
  c.drawImage(starfield(), cx - 800, cy - 1300);
  if (K > 0.02) { c.save(); c.filter = 'blur(7px)'; c.fillStyle = `rgba(150,160,178,${0.9 * K})`; const fy = cy + 16 + (1 - K) * 30; rrect(c, cx - 62, fy - 40, 124, 110, 34); c.fill(); for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(cx - 45 + i * 30, fy - 40, 17, 0, 7); c.fill(); } c.restore(); c.filter = 'none'; }
  c.drawImage(frostTex(), cx - 150, cy - 150, 300, 300); c.fillStyle = 'rgba(255,255,255,.08)'; poly(c, [[cx - 150, cy - 50], [cx + 10, cy - 150], [cx + 70, cy - 150], [cx - 150, cy + 30]], 'rgba(255,255,255,.08)'); c.restore();
  c.strokeStyle = '#0a0d14'; c.lineWidth = 8; c.beginPath(); c.arc(cx, cy, 152, 0, 7); c.stroke();
  // lock readout
  c.fillStyle = '#030508'; rrect(c, cx - 130, cy + 222, 260, 64, 10); c.fill(); c.font = 'bold 40px "DejaVu Sans Mono"'; c.textAlign = 'center'; c.fillStyle = '#ff3344'; c.shadowColor = '#ff3344'; c.shadowBlur = 20; c.fillText('LOCKED', cx, cy + 268); c.shadowBlur = 0;
  // beacon
  c.fillStyle = '#0a0d14'; rrect(c, cx - 70, 196, 140, 40, 10); c.fill(); c.fillStyle = `rgb(255,${60 + 120 * S},${70 + 110 * S})`; rrect(c, cx - 52, 222, 104, 66, 26); c.fill(); glow(c, cx, 260, 520, '#ff2030', 0.25 + 0.6 * S);
  c.save(); c.globalCompositeOperation = 'lighter'; const lg = c.createLinearGradient(0, 240, 0, 1500); lg.addColorStop(0, `rgba(255,30,40,${0.3 * S})`); lg.addColorStop(1, 'rgba(255,30,40,0)'); poly(c, [[cx - 60, 270], [cx + 60, 270], [W + 100, 1700], [-100, 1700]], lg); c.restore();
  // knock: shock rings, falling frost, steam
  for (const k of hits(['knock'])) { const dt = t - k; if (dt > 0 && dt < 0.8) { const q = 1 - dt / 0.8; c.strokeStyle = `rgba(255,255,255,${0.45 * q})`; c.lineWidth = 9 * q + 1; c.beginPath(); c.arc(cx, cy, 150 + dt * 800, 0, 7); c.stroke(); const r = rng(Math.floor(k * 100)); for (let i = 0; i < 46; i++) { const a = r() * 6.283, rr = 150 + r() * 270; c.fillStyle = `rgba(230,240,255,${0.8 * q})`; c.fillRect(cx + Math.cos(a) * rr + (r() - 0.5) * 40 * dt, cy + Math.sin(a) * rr + dt * dt * 1100 * (0.3 + r()), 4 + r() * 4, 4 + r() * 4); } } }
  for (let i = 0; i < 8; i++) { const ph = mod(t * 0.35 + i / 8, 1); c.fillStyle = `rgba(220,230,245,${0.09 * (1 - ph)})`; c.beginPath(); c.ellipse(90 + ph * 260, 1500 - ph * 420 + Math.sin(i * 3 + t) * 30, 60 + ph * 180, 50 + ph * 120, 0, 0, 7); c.fill(); }
  c.fillStyle = vgrad(c, 0, H, [[0, 'rgba(0,0,0,.4)'], [0.35, 'rgba(0,0,0,0)'], [0.75, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.65)']]); c.fillRect(-60, -60, W + 120, H + 120);
};

// ================= SHOT 6 — through the glass =================
function patch(c, x, y, r) {
  c.fillStyle = '#b08a2e'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.fillStyle = '#0d1b3a'; c.beginPath(); c.arc(x, y, r * 0.9, 0, 7); c.fill();
  c.strokeStyle = '#e6c15a'; c.lineWidth = r * 0.025; c.setLineDash([r * 0.05, r * 0.04]); c.beginPath(); c.arc(x, y, r * 0.95, 0, 7); c.stroke(); c.beginPath(); c.arc(x, y, r * 0.62, 0, 7); c.stroke(); c.setLineDash([]);
  const g = c.createRadialGradient(x - r * 0.12, y - r * 0.12, 2, x, y, r * 0.36); g.addColorStop(0, '#f1c98f'); g.addColorStop(1, '#8c4a26'); c.fillStyle = g; c.beginPath(); c.arc(x, y + r * 0.04, r * 0.3, 0, 7); c.fill();
  c.strokeStyle = '#f3e3b0'; c.lineWidth = r * 0.045; c.beginPath(); c.ellipse(x, y + r * 0.04, r * 0.52, r * 0.13, -0.36, 0, 7); c.stroke();
  poly(c, [[x + r * 0.2, y - r * 0.42], [x + r * 0.5, y - r * 0.5], [x + r * 0.36, y - r * 0.24]], '#ffffff'); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = r * 0.03; c.beginPath(); c.moveTo(x + r * 0.3, y - r * 0.36); c.lineTo(x - r * 0.3, y - r * 0.02); c.stroke();
  c.fillStyle = '#f3e3b0'; c.font = `800 ${r * 0.17}px Inter`; c.textAlign = 'center'; c.textBaseline = 'middle'; arcText(c, 'MERIDIAN', x, y, r * 0.765, -2.25, -0.89); arcText(c, 'DEEP CARGO · 212', x, y, r * 0.765, 2.62, 0.52); c.textBaseline = 'alphabetic';
}
function nameTape(c, x, y, w, h) {
  c.fillStyle = 'rgba(0,0,0,.35)'; rrect(c, x + 4, y + 6, w, h, h * 0.1); c.fill(); c.fillStyle = '#e9e3cf'; rrect(c, x, y, w, h, h * 0.1); c.fill();
  c.strokeStyle = '#1a2a52'; c.lineWidth = h * 0.03; c.setLineDash([h * 0.09, h * 0.06]); rrect(c, x + h * 0.08, y + h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.06); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#12224a'; c.textAlign = 'center'; c.font = `800 ${h * 0.56}px Inter`; c.fillText(NAME, x + w / 2, y + h * 0.6); c.font = `700 ${h * 0.17}px Inter`; c.fillText('PILOT  ·  MERIDIAN', x + w / 2, y + h * 0.85);
}
function astronaut(c, t, S) {   // local origin = helmet centre
  const suit = (x0, y0, x1, y1) => { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, '#f4f6fa'); g.addColorStop(0.5, '#b9c1cf'); g.addColorStop(1, '#5a6475'); return g; };
  c.fillStyle = metalG(c, -280, -200, 280, 500, '#8c96a8', '#4a5466', '#161b26'); rrect(c, -282, -210, 564, 760, 70); c.fill();
  // torso + arms
  c.fillStyle = suit(-300, 180, 300, 900); c.beginPath(); c.moveTo(-150, 205); c.quadraticCurveTo(-360, 230, -400, 420); c.lineTo(-430, 1000); c.lineTo(430, 1000); c.lineTo(400, 420); c.quadraticCurveTo(360, 230, 150, 205); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(40,50,70,.5)'; c.lineWidth = 5; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 250, 290); c.quadraticCurveTo(s * 230, 560, s * 270, 1000); c.stroke(); for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(s * 262, 380 + i * 30); c.quadraticCurveTo(s * 330, 372 + i * 30, s * 398, 400 + i * 30); c.stroke(); } }
  c.strokeStyle = '#6d7789'; c.lineWidth = 26; c.lineCap = 'round'; c.beginPath(); c.moveTo(-96, 520); c.bezierCurveTo(-210, 600, -300, 420, -270, 250); c.stroke(); c.strokeStyle = '#c9772e'; c.lineWidth = 18; c.beginPath(); c.moveTo(96, 520); c.bezierCurveTo(200, 610, 300, 430, 268, 250); c.stroke();
  // chest unit
  c.fillStyle = metalG(c, -120, 420, 120, 620, '#dfe4ec', '#9099aa', '#444d5e'); rrect(c, -122, 426, 244, 190, 20); c.fill(); c.strokeStyle = 'rgba(20,26,40,.6)'; c.lineWidth = 4; c.stroke();
  c.fillStyle = '#04080c'; rrect(c, -98, 448, 120, 60, 8); c.fill(); c.fillStyle = '#58f29a'; c.font = 'bold 26px "DejaVu Sans Mono"'; c.textAlign = 'left'; c.fillText('O2 00%', -92, 488);
  for (let i = 0; i < 4; i++) { c.fillStyle = ['#ff3344', '#ffb23f', '#5ad7ff', '#e8ecf2'][i]; c.beginPath(); c.arc(-76 + i * 48, 566, 15, 0, 7); c.fill(); } c.fillStyle = '#1b2230'; c.beginPath(); c.arc(74, 478, 28, 0, 7); c.fill();
  patch(c, -236, 372, 68); nameTape(c, 150, 330, 186, 64);
  c.fillStyle = '#b2242c'; c.fillRect(292, 440, 84, 12); c.fillStyle = '#e9edf3'; c.fillRect(292, 452, 84, 12); c.fillStyle = '#1e3a8a'; c.fillRect(292, 464, 84, 12);
  // neck ring + helmet
  c.fillStyle = metalG(c, -180, 170, 180, 260, '#d6dce6', '#6f7a8c', '#232a38'); c.beginPath(); c.ellipse(0, 214, 182, 52, 0, 0, 7); c.fill();
  const hg = c.createRadialGradient(-70, -90, 20, 0, 0, 240); hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.55, '#c3cad6'); hg.addColorStop(1, '#5b6474'); c.fillStyle = hg; c.beginPath(); c.arc(0, 0, 226, 0, 7); c.fill();
  c.fillStyle = '#10141c'; c.beginPath(); c.ellipse(0, 14, 186, 170, 0, 0, 7); c.fill();
  c.save(); c.beginPath(); c.ellipse(0, 14, 172, 156, 0, 0, 7); c.clip();
  const vg = c.createRadialGradient(-64, -60, 10, 0, 14, 210); vg.addColorStop(0, '#fff1c0'); vg.addColorStop(0.2, '#e2a43a'); vg.addColorStop(0.6, '#6b3c0c'); vg.addColorStop(1, '#0d0703'); c.fillStyle = vg; c.fillRect(-200, -160, 400, 360);
  c.fillStyle = `rgba(255,40,50,${0.1 + 0.16 * S})`; c.beginPath(); c.ellipse(40, 70, 120, 70, -0.3, 0, 7); c.fill();   // corridor's red light in the visor
  c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.ellipse(-92, -66, 44, 20, -0.7, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,240,200,.35)'; c.lineWidth = 6; c.beginPath(); c.ellipse(0, 14, 150, 134, 0, 3.4, 4.7); c.stroke();
  c.restore();
  if (!window.ASTRO_OFF) for (const s of [-1, 1]) { c.fillStyle = '#2a313f'; rrect(c, s * 232 - 26, -44, 52, 88, 12); c.fill(); const fl = 0.75 + 0.25 * Math.sin(t * 17 + s); glow(c, s * 240, 0, 150, '#eaf6ff', 0.75 * fl); c.save(); c.globalCompositeOperation = 'lighter'; const sg = c.createLinearGradient(s * 240 - 330, 0, s * 240 + 330, 0); sg.addColorStop(0, 'rgba(180,220,255,0)'); sg.addColorStop(0.5, `rgba(220,240,255,${0.75 * fl})`); sg.addColorStop(1, 'rgba(180,220,255,0)'); c.fillStyle = sg; c.fillRect(s * 240 - 330, -4, 660, 8); c.restore(); c.fillStyle = '#fff'; c.beginPath(); c.arc(s * 240, 0, 14, 0, 7); c.fill(); }
}
function glove(c, k) {   // palm flat on the glass, local origin = palm centre
  c.save(); c.scale(k, k); const g = c.createLinearGradient(-90, -200, 90, 110); g.addColorStop(0, '#f0f3f8'); g.addColorStop(1, '#8c95a6');
  c.fillStyle = 'rgba(0,0,0,.4)'; rrect(c, -84, -78, 180, 200, 50); c.fill();
  c.fillStyle = g; rrect(c, -90, -90, 180, 200, 50); c.fill(); for (const [x, len, w] of [[-86, 118, 40], [-42, 150, 42], [4, 158, 42], [50, 132, 40]]) { rrect(c, x, -90 - len, w, len + 40, w / 2); c.fill(); c.strokeStyle = 'rgba(40,50,70,.45)'; c.lineWidth = 3; for (const f of [0.4, 0.7]) { c.beginPath(); c.moveTo(x + 5, -90 - len * f); c.lineTo(x + w - 5, -90 - len * f); c.stroke(); } }
  c.save(); c.translate(84, -8); c.rotate(0.85); rrect(c, -22, -120, 46, 140, 23); c.fill(); c.restore();
  c.fillStyle = '#39424f'; rrect(c, -70, -64, 140, 140, 34); c.fill(); c.fillStyle = metalG(c, -100, 100, 100, 170, '#c9d0db', '#778294', '#2a3140'); rrect(c, -104, 100, 208, 74, 22); c.fill(); c.restore();
}
SCENES.ds_window = (c, t, lt, d, p) => {
  const HT = p.still ? -9 : (p.hand ?? 2.3);
  if (p.close) { c.translate(540, 760); c.scale(1.38, 1.38); c.translate(-540, -760); }
  const S = strobe(t), cx = 540, cy = 860, R = 440;
  c.fillStyle = metalG(c, 0, 0, W, H, '#35415a', '#161d2a', '#06080e'); c.fillRect(-80, -80, W + 160, H + 160);
  c.fillStyle = metalG(c, cx - 540, cy - 540, cx + 540, cy + 540, '#b9c4d6', '#515d72', '#121824'); c.beginPath(); c.arc(cx, cy, 548, 0, 7); c.fill(); bolts(c, cx, cy, 496, 18, 20);
  c.fillStyle = '#05070c'; c.beginPath(); c.arc(cx, cy, R + 14, 0, 7); c.fill();
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip();
  c.fillStyle = vgrad(c, cy - R, cy + R, [[0, '#010208'], [1, '#050c1e']]); c.fillRect(cx - R, cy - R, R * 2, R * 2); c.drawImage(starfield(), -300 - lt * 5, -500);
  const a = p.still ? 1 : ease(lt / 1.7), ax = cx + 10 + (1 - a) * 130 + Math.sin(t * 0.6) * 9, ay = cy - 130 + (1 - a) * 330 + Math.sin(t * 0.45) * 12, sc = lerp(0.72, 0.9, a);
  c.save(); c.translate(ax, ay); c.rotate((1 - a) * 0.22 + Math.sin(t * 0.35) * 0.02); c.scale(sc, sc); astronaut(c, t, S); c.restore();
  c.fillStyle = `rgba(0,2,8,${p.still ? 0 : 0.9 * (1 - ease(lt / 1.2))})`; c.fillRect(cx - R, cy - R, R * 2, R * 2);
  const g2 = c.createRadialGradient(cx, cy + 260, 60, cx, cy + 200, 620); g2.addColorStop(0, `rgba(255,30,40,${0.2 * S * a})`); g2.addColorStop(1, 'rgba(255,30,40,0)'); c.fillStyle = g2; c.fillRect(cx - R, cy - R, R * 2, R * 2);
  // gloved hand comes up and lands on the glass
  const hk = ease((lt - HT + 0.55) / 0.55); if (hk > 0) { const press = sm((lt - HT) / 0.12), hx = cx - 205, hy = cy + 250 + (1 - hk) * 420; if (press > 0) { const hal = c.createRadialGradient(hx, hy - 40, 90, hx, hy - 40, 300); hal.addColorStop(0, `rgba(225,240,255,${0.3 * press})`); hal.addColorStop(1, 'rgba(225,240,255,0)'); c.fillStyle = hal; c.fillRect(hx - 320, hy - 360, 640, 640); } c.save(); c.translate(hx, hy); c.rotate(-0.16 + (1 - hk) * 0.3); glove(c, lerp(0.86, 1.02, hk)); c.restore(); }
  c.globalAlpha = 0.9; c.drawImage(frostTex(), cx - R, cy - R, R * 2, R * 2); c.globalAlpha = 1;
  c.fillStyle = 'rgba(255,255,255,.07)'; poly(c, [[cx - R, cy - 160], [cx + 40, cy - R], [cx + 200, cy - R], [cx - R, cy + 60]], 'rgba(255,255,255,.06)'); poly(c, [[cx - R, cy + 130], [cx + 300, cy - R], [cx + 340, cy - R], [cx - R, cy + 180]], 'rgba(255,255,255,.05)');
  const ig = c.createRadialGradient(cx, cy, R * 0.8, cx, cy, R); ig.addColorStop(0, 'rgba(0,0,0,0)'); ig.addColorStop(1, 'rgba(0,0,0,.6)'); c.fillStyle = ig; c.fillRect(cx - R, cy - R, R * 2, R * 2);
  c.restore();
  c.strokeStyle = `rgba(255,${70 + 60 * S},${80 + 50 * S},${0.25 + 0.5 * S})`; c.lineWidth = 6; c.beginPath(); c.arc(cx, cy, 546, 3.6, 5.8); c.stroke(); c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 4; c.beginPath(); c.arc(cx, cy, R + 8, 3.5, 5.0); c.stroke();
  redWash(c, t, 0.1); c.fillStyle = vgrad(c, 0, H, [[0, 'rgba(0,0,0,.5)'], [0.3, 'rgba(0,0,0,0)'], [0.8, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.7)']]); c.fillRect(-80, -80, W + 160, H + 160);
  if (p.radio) {   // suit-radio overlay
    c.setTransform(1, 0, 0, 1, 0, 0); const col = p.radio === 'scream' ? '#ff5a64' : '#5ad7ff', amp = p.radio === 'scream' ? 1 : 0.6, en = ease(lt / 0.3);
    c.globalAlpha = en; c.fillStyle = 'rgba(2,6,10,.82)'; rrect(c, 110, 270, 860, 190, 22); c.fill(); c.strokeStyle = A(col, 0.9); c.lineWidth = 3; c.stroke();
    c.font = 'bold 28px "DejaVu Sans Mono"'; c.textAlign = 'left'; c.fillStyle = col; c.fillText('SUIT RADIO · CH 1 · ' + NAME, 140, 314); if (mod(t, 0.8) < 0.5) { c.fillStyle = '#ff3344'; c.beginPath(); c.arc(928, 304, 11, 0, 7); c.fill(); }
    c.shadowColor = col; c.shadowBlur = 14; c.fillStyle = col; for (let i = 0; i < 64; i++) { const v = Math.abs(Math.sin(t * (7 + i % 5) + i * 1.9) * Math.sin(t * 3.1 + i * 0.37)) * amp * (0.4 + 0.6 * Math.abs(Math.sin(t * 2.2))), h = 8 + v * 96; c.fillRect(140 + i * 12.6, 388 - h / 2, 7, h); } c.shadowBlur = 0; c.globalAlpha = 1;
  }
};
let TL_HAND = 2.3;

// ================= SHOT 7 — the name tag =================
SCENES.ds_tag = (c, t, lt, d) => {
  const S = strobe(t), buf = cached('tagbuf', W, H, () => {}), b = buf.getContext('2d');
  b.setTransform(1, 0, 0, 1, 0, 0); const g = b.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#f1f3f7'); g.addColorStop(0.5, '#b4bccb'); g.addColorStop(1, '#58616f'); b.fillStyle = g; b.fillRect(0, 0, W, H);
  b.save(); b.translate(W / 2 + Math.sin(t * 0.6) * 10, H / 2 + Math.sin(t * 0.45) * 14); b.rotate(-0.045 + Math.sin(t * 0.35) * 0.008); b.translate(-W / 2, -H / 2);
  b.drawImage(cached('fabric', 600, 1000, (f, w, h) => { const r = rng(12); for (let i = 0; i < 60000; i++) { f.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '20,30,50'},${r() * 0.1})`; f.fillRect(r() * w, r() * h, 2, 1 + r() * 3); } }), -100, -100, W + 200, H + 200);
  b.strokeStyle = 'rgba(50,60,85,.5)'; b.lineWidth = 7; b.lineCap = 'round'; b.beginPath(); b.moveTo(-100, 520); b.quadraticCurveTo(540, 430, 1180, 560); b.moveTo(-100, 1530); b.quadraticCurveTo(540, 1640, 1180, 1500); b.stroke();
  b.strokeStyle = 'rgba(255,255,255,.5)'; b.lineWidth = 3; b.setLineDash([16, 12]); b.beginPath(); b.moveTo(-100, 538); b.quadraticCurveTo(540, 448, 1180, 578); b.moveTo(-100, 1512); b.quadraticCurveTo(540, 1622, 1180, 1482); b.stroke(); b.setLineDash([]);
  b.fillStyle = metalG(b, 0, 1600, 0, 1900, '#dfe4ec', '#8892a4', '#3a4352'); rrect(b, 120, 1640, 840, 400, 40); b.fill(); b.fillStyle = '#04080c'; rrect(b, 190, 1700, 330, 130, 14); b.fill(); b.fillStyle = '#58f29a'; b.font = 'bold 66px "DejaVu Sans Mono"'; b.textAlign = 'left'; b.fillText('O2 00%', 206, 1790);
  patch(b, 540, 790, 236); nameTape(b, 150, 1090, 780, 250);
  const fr = rng(4); for (let i = 0; i < 40; i++) { b.strokeStyle = 'rgba(40,50,70,.25)'; b.lineWidth = 2; const x = 170 + fr() * 740, y = 1110 + fr() * 210; b.beginPath(); b.moveTo(x, y); b.lineTo(x + (fr() - 0.5) * 60, y + (fr() - 0.5) * 14); b.stroke(); }
  b.restore();
  const sh = b.createLinearGradient(0, 0, W, H); sh.addColorStop(0, 'rgba(255,255,255,.1)'); sh.addColorStop(0.55, 'rgba(0,0,10,.12)'); sh.addColorStop(1, 'rgba(0,0,10,.6)'); b.fillStyle = sh; b.fillRect(0, 0, W, H);
  b.fillStyle = `rgba(255,20,35,${0.03 + 0.1 * S})`; b.fillRect(0, 0, W, H);
  const blur = 26 * (1 - ease(lt / 0.75)), z = lerp(1.22, 1.0, ease(lt / 0.9));
  c.save(); c.filter = blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : 'none'; c.translate(W / 2, 1100); c.scale(z, z); c.translate(-W / 2, -1100); c.drawImage(buf, 0, 0); c.restore(); c.filter = 'none';
  c.globalAlpha = 0.4; c.drawImage(frostTex(), -360, 0, W + 720, H); c.globalAlpha = 1;
  poly(c, [[-80, 700], [900, -80], [1160, -80], [-80, 1010]], 'rgba(255,255,255,.05)');
  const vg = c.createRadialGradient(W / 2, 1050, 420, W / 2, 1050, 1150); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.85)'); c.fillStyle = vg; c.fillRect(-80, -80, W + 160, H + 160);
};

// ================= hull schematic — the contact crawls along the ship =================
SCENES.ds_schematic = (c, t, lt, d, p) => {
  c.fillStyle = '#01060a'; c.fillRect(-60, -60, W + 120, H + 120); glow(c, W / 2, 840, 1000, '#5ad7ff', 0.12);
  c.strokeStyle = 'rgba(90,215,255,.08)'; c.lineWidth = 2; for (let x = 0; x <= W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); } for (let y = 0; y <= H; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.textAlign = 'left'; c.font = 'bold 42px "DejaVu Sans Mono"'; c.fillStyle = '#5ad7ff'; c.fillText('HULL SENSOR GRID', 80, 330); c.font = 'bold 26px "DejaVu Sans Mono"'; c.fillStyle = 'rgba(90,215,255,.55)'; c.fillText('MV MERIDIAN · EXTERIOR', 80, 370);
  let used = 0, ty = 450; c.font = 'bold 36px "DejaVu Sans Mono"';
  for (const raw of (p.lines || [])) { const warn = raw[0] === '!', line = warn ? raw.slice(1) : raw, shown = Math.floor(clamp(lt * 22 - used, 0, line.length)); used += line.length + 14; if (shown <= 0) break; const col = warn ? '#ff5a64' : '#5ad7ff'; c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 14; c.fillText('> ' + line.slice(0, shown), 80, ty); ty += 54; } c.shadowBlur = 0;
  const ship = cached('shipsil', 1100, 520, b => { b.translate(550, 260); dsShip(b, 0); b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = 'source-atop'; b.fillStyle = 'rgba(10,80,110,.78)'; b.fillRect(0, 0, 1100, 520); });
  const k0 = 0.94, ox = 540, oy = 900, X = x => ox + x * k0, Y = y => oy + y * k0;
  c.drawImage(ship, ox - 550 * k0, oy - 260 * k0, 1100 * k0, 520 * k0); c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.35; c.drawImage(ship, ox - 550 * k0, oy - 260 * k0, 1100 * k0, 520 * k0); c.restore();
  const sw = mod(t * 0.35, 1) * W; c.fillStyle = 'rgba(90,215,255,.1)'; c.fillRect(sw, 560, 5, 680);
  // airlock marker
  const ax = X(300), ay = Y(60); c.strokeStyle = '#ffb23f'; c.lineWidth = 3; c.strokeRect(ax - 16, ay - 16, 32, 32); c.beginPath(); c.moveTo(ax, ay + 16); c.lineTo(ax, ay + 150); c.lineTo(ax + 30, ay + 150); c.stroke(); c.font = 'bold 28px "DejaVu Sans Mono"'; c.fillStyle = '#ffb23f'; c.textAlign = 'left'; c.fillText('AIRLOCK 02', ax - 150, ay + 190);
  // the contact
  const from = p.from || [-340, -30], to = p.to || [300, 60], pos = k => { k = clamp(k); return [X(lerp(from[0], to[0], k)), Y(lerp(from[1], to[1], k) - Math.sin(k * Math.PI) * 52 + Math.sin(k * 40) * 4)]; };
  const k = sm(lt / (d - 0.5)), gone = p.lost && k >= 1;
  for (let i = 16; i > 0; i--) { const [px, py] = pos(k - i * 0.022); c.fillStyle = `rgba(255,70,80,${0.4 * (1 - i / 16)})`; c.beginPath(); c.arc(px, py, 6, 0, 7); c.fill(); }
  if (!gone || mod(t, 0.3) < 0.1) { const [bx, by] = pos(k), pu = mod(t * 2, 1); c.strokeStyle = `rgba(255,70,80,${1 - pu})`; c.lineWidth = 4; c.beginPath(); c.arc(bx, by, 12 + pu * 50, 0, 7); c.stroke(); glow(c, bx, by, 60, '#ff3344', 1); c.fillStyle = '#fff'; c.beginPath(); c.arc(bx, by, 8, 0, 7); c.fill();
    c.strokeStyle = '#ff5a64'; c.lineWidth = 3; c.beginPath(); c.moveTo(bx, by - 18); c.lineTo(bx, by - 120); c.stroke(); c.fillStyle = '#ff5a64'; c.textAlign = 'center'; c.fillText('CONTACT', bx, by - 134); }
  if (gone) { c.textAlign = 'center'; c.font = 'bold 60px "DejaVu Sans Mono"'; c.fillStyle = mod(t, 0.6) < 0.4 ? '#ff5a64' : 'rgba(255,90,100,.3)'; c.fillText('SIGNAL LOST', 540, 1200); }
  scanlines(c, 0.2);
};

// ================= the suit locker =================
SCENES.ds_locker = (c, t, lt, d) => {
  const fl = rng(Math.floor(t * 13))() > 0.14 ? 1 : 0.4, z = lerp(1, 1.3, sm(lt / d));
  c.translate(730, 1000); c.scale(z, z); c.translate(-730, -1000);
  c.fillStyle = metalG(c, 0, 0, W, H, '#3a465a', '#19212e', '#07090f'); c.fillRect(-200, -200, W + 400, H + 400);
  c.fillStyle = '#03050a'; rrect(c, 120, 330, 820, 1460, 26); c.fill(); c.strokeStyle = '#6a788e'; c.lineWidth = 8; c.stroke();
  c.fillStyle = `rgba(232,244,255,${fl})`; c.fillRect(250, 352, 560, 16); glow(c, 540, 380, 820, '#cfe6ff', 0.45 * fl);
  c.save(); c.globalCompositeOperation = 'lighter'; const lg = c.createLinearGradient(0, 360, 0, 1500); lg.addColorStop(0, `rgba(200,225,255,${0.22 * fl})`); lg.addColorStop(1, 'rgba(200,225,255,0)'); poly(c, [[260, 368], [800, 368], [930, 1780], [130, 1780]], lg); c.restore();
  c.strokeStyle = '#8f9bb0'; c.lineWidth = 10; c.beginPath(); c.moveTo(540, 368); c.lineTo(540, 470); c.stroke();
  const sway = Math.sin(t * 0.9) * 0.012; c.save(); c.translate(540, 700); c.rotate(sway); c.scale(0.8, 0.8); window.ASTRO_OFF = true; astronaut(c, t, 0); window.ASTRO_OFF = false; c.restore();
  c.fillStyle = `rgba(2,4,10,${0.55 - 0.3 * fl})`; rrect(c, 120, 330, 820, 1460, 26); c.fill();
  c.fillStyle = metalG(c, 0, 1470, 0, 1800, '#48556a', '#1c2532', '#090c13'); c.fillRect(120, 1480, 820, 310); c.fillStyle = 'rgba(0,0,0,.4)'; for (let i = 0; i < 9; i++) c.fillRect(170 + i * 84, 1530, 50, 12);
  poly(c, [[940, 330], [1180, 250], [1180, 1880], [940, 1790]], metalG(c, 940, 0, 1180, 0, '#5a6880', '#2a3444', '#141b27'));
  c.fillStyle = '#04070b'; rrect(c, 300, 1590, 480, 68, 10); c.fill(); c.strokeStyle = '#5ad7ff'; c.lineWidth = 3; c.stroke(); c.font = 'bold 32px "DejaVu Sans Mono"'; c.textAlign = 'center'; c.fillStyle = '#5ad7ff'; c.fillText('EVA SUIT 01 · ' + NAME, 540, 1636);
  const r = rng(21); for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(220,235,255,${0.15 * fl * r()})`; c.fillRect(mod(r() * 800 + t * 6 * (r() - 0.5), 800) + 130, mod(r() * 1100 + t * 10 * r(), 1100) + 370, 3, 3); }
};

// ================= the sleeper's face behind frosted glass =================
SCENES.ds_podface = (c, t, lt, d, p) => {
  const wake = !!p.wake, S = wake ? strobe(t * 0.9) : 0, br = Math.sin(t * 0.9) * 4;
  const bg = c.createRadialGradient(440, 760, 60, 540, 900, 1250); bg.addColorStop(0, '#c9f4ff'); bg.addColorStop(0.35, '#4aa9c9'); bg.addColorStop(1, '#03202c'); c.fillStyle = bg; c.fillRect(-80, -80, W + 160, H + 160);
  c.save(); c.filter = 'blur(2.2px)'; c.translate(0, br);
  // shoulders, neck
  c.fillStyle = metalG(c, 100, 1150, 980, 1900, '#28505f', '#0f2a36', '#041219'); c.beginPath(); c.moveTo(440, 1130); c.quadraticCurveTo(170, 1190, 70, 1420); c.lineTo(0, 2000); c.lineTo(1080, 2000); c.lineTo(1010, 1420); c.quadraticCurveTo(910, 1190, 640, 1130); c.closePath(); c.fill();
  const sk = c.createLinearGradient(330, 0, 760, 0); sk.addColorStop(0, '#cfe0e8'); sk.addColorStop(0.5, '#93abb8'); sk.addColorStop(1, '#3f5a69');
  c.fillStyle = '#5d7a89'; c.fillRect(455, 1000, 170, 190); c.fillStyle = 'rgba(8,30,42,.55)'; c.beginPath(); c.ellipse(540, 1090, 110, 46, 0, 0, 7); c.fill();
  c.strokeStyle = '#6fd0e8'; c.lineWidth = 16; c.beginPath(); c.moveTo(420, 1150); c.quadraticCurveTo(540, 1230, 660, 1150); c.stroke();
  // head
  c.fillStyle = sk; for (const ex of [334, 746]) { c.beginPath(); c.ellipse(ex, 830, 26, 52, 0, 0, 7); c.fill(); }
  c.beginPath(); c.ellipse(540, 770, 208, 250, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(540, 905, 168, 188, 0, 0, 7); c.fill();
  const shd = c.createLinearGradient(520, 0, 760, 0); shd.addColorStop(0, 'rgba(10,36,50,0)'); shd.addColorStop(1, 'rgba(10,36,50,.55)'); c.fillStyle = shd; c.beginPath(); c.ellipse(540, 800, 208, 290, 0, -1.4, 1.5); c.fill();
  // hair
  c.fillStyle = '#141a22'; c.beginPath(); c.moveTo(326, 800); c.quadraticCurveTo(300, 500, 540, 496); c.quadraticCurveTo(780, 500, 754, 800); c.quadraticCurveTo(740, 660, 660, 620); c.quadraticCurveTo(540, 580, 420, 622); c.quadraticCurveTo(340, 660, 326, 800); c.fill();
  c.strokeStyle = 'rgba(200,215,225,.55)'; c.lineWidth = 5; c.lineCap = 'round'; for (let i = 0; i < 7; i++) { c.beginPath(); c.moveTo(338 + i * 9, 760 - i * 22); c.quadraticCurveTo(346 + i * 12, 640 - i * 10, 400 + i * 16, 590 - i * 6); c.stroke(); c.beginPath(); c.moveTo(742 - i * 9, 760 - i * 22); c.quadraticCurveTo(734 - i * 12, 640 - i * 10, 680 - i * 16, 590 - i * 6); c.stroke(); }
  // brows, eyes, nose, mouth, scar
  c.strokeStyle = '#151b23'; c.lineWidth = 15; c.beginPath(); c.moveTo(394, 776); c.quadraticCurveTo(450, 754, 506, 772); c.moveTo(574, 772); c.quadraticCurveTo(630, 754, 686, 776); c.stroke();
  const o = wake ? clamp((Math.sin(lt * 9) * Math.sin(lt * 2.3) - 0.8) * 4) * 0.4 : 0;
  for (const ex of [450, 630]) { c.fillStyle = 'rgba(12,40,54,.35)'; c.beginPath(); c.ellipse(ex, 826, 62, 34, 0, 0, 7); c.fill(); if (o > 0.05) { c.fillStyle = '#e8f2f6'; c.beginPath(); c.ellipse(ex, 826, 44, 15 * o, 0, 0, 7); c.fill(); c.fillStyle = '#10202a'; c.beginPath(); c.arc(ex, 826, 12 * o, 0, 7); c.fill(); }
    c.strokeStyle = '#18222b'; c.lineWidth = 7; c.beginPath(); c.arc(ex, 800 - o * 8, 52, 0.22 * Math.PI, 0.78 * Math.PI); c.stroke(); c.lineWidth = 3; for (let i = 0; i < 6; i++) { const a = (0.26 + i * 0.096) * Math.PI; c.beginPath(); c.moveTo(ex + Math.cos(a) * 52, 800 + Math.sin(a) * 52); c.lineTo(ex + Math.cos(a) * 66, 800 + Math.sin(a) * 64); c.stroke(); } }
  poly(c, [[548, 810], [584, 946], [540, 960]], 'rgba(14,44,60,.38)'); c.strokeStyle = 'rgba(235,246,250,.55)'; c.lineWidth = 6; c.beginPath(); c.moveTo(530, 820); c.lineTo(522, 930); c.stroke(); c.strokeStyle = 'rgba(14,40,54,.7)'; c.lineWidth = 6; c.beginPath(); c.moveTo(500, 956); c.quadraticCurveTo(540, 976, 580, 956); c.stroke();
  c.strokeStyle = '#2b4250'; c.lineWidth = 8; c.beginPath(); c.moveTo(470, 1014); c.quadraticCurveTo(540, 1004 + o * 10, 610, 1014); c.stroke(); c.strokeStyle = 'rgba(14,40,54,.35)'; c.lineWidth = 10; c.beginPath(); c.moveTo(500, 1042); c.quadraticCurveTo(540, 1052, 580, 1042); c.stroke();
  const r = rng(8); for (let i = 0; i < 500; i++) { const a = 0.15 * Math.PI + r() * 0.7 * Math.PI, rr = 100 + r() * 78; c.fillStyle = `rgba(16,34,46,${0.25 * r()})`; c.fillRect(540 + Math.cos(a) * rr * 1.05, 900 + Math.sin(a) * rr * 1.05, 3, 4); }
  c.strokeStyle = 'rgba(240,250,255,.9)'; c.lineWidth = 6; c.beginPath(); c.moveTo(584, 1040); c.lineTo(612, 1082); c.stroke();
  nameTape(c, 590, 1500, 360, 118);
  if (wake) { const tw = Math.sin(lt * 23) * (mod(lt, 1.7) < 0.5 ? 9 : 0); c.fillStyle = sk; for (let i = 0; i < 4; i++) { rrect(c, 150 + i * 44, 1560 - (i % 2) * 14 + tw * (i % 2 ? 1 : -1), 36, 150, 18); c.fill(); } }
  c.restore(); c.filter = 'none';
  // frost layer with a hand-wiped clearing
  const buf = cached('frostbuf', W, H, () => {}), b = buf.getContext('2d'); b.globalCompositeOperation = 'source-over'; b.shadowBlur = 0; b.clearRect(0, 0, W, H); b.fillStyle = 'rgba(214,238,250,.8)'; b.fillRect(0, 0, W, H);
  b.drawImage(frostTex(), -260, 140, 1600, 1600); b.drawImage(frostTex(), 100, 500, 900, 900); b.drawImage(cached('frostn', 540, 960, (f, w, h) => { const q = rng(3); for (let i = 0; i < 9000; i++) { f.fillStyle = `rgba(255,255,255,${q() * 0.35})`; f.fillRect(q() * w, q() * h, 1 + q() * 3, 1 + q() * 3); } }), 0, 0, W, H);
  const path = [[230, 640], [840, 720], [270, 900], [850, 1010], [330, 1120], [800, 1150]], w = wake ? 1 : sm((lt - 0.35) / 2.0);
  let hx = path[0][0], hy = path[0][1];
  if (w > 0) { b.globalCompositeOperation = 'destination-out'; b.lineCap = 'round'; b.lineJoin = 'round'; b.lineWidth = 300; b.shadowColor = '#000'; b.shadowBlur = 70; b.strokeStyle = 'rgba(0,0,0,.93)'; b.beginPath(); b.moveTo(...path[0]); const seg = w * (path.length - 1); for (let i = 1; i < path.length; i++) { const f = clamp(seg - (i - 1)); if (f <= 0) break; hx = lerp(path[i - 1][0], path[i][0], f); hy = lerp(path[i - 1][1], path[i][1], f); b.lineTo(hx, hy); } b.stroke(); }
  c.globalAlpha = wake ? 1 - 0.75 * sm(lt / d) : 1; c.drawImage(buf, 0, 0); c.globalAlpha = 1;
  if (!wake && w > 0 && w < 1) { c.save(); c.filter = 'blur(9px)'; c.translate(hx + 30, hy + 60); c.rotate(-0.25); c.fillStyle = 'rgba(3,10,14,.9)'; rrect(c, -100, -60, 200, 260, 60); c.fill(); for (let i = 0; i < 4; i++) { rrect(c, -98 + i * 50, -210 + Math.abs(i - 1.5) * 26, 44, 190, 22); c.fill(); } c.fillRect(-90, 180, 180, 900); c.restore(); c.filter = 'none'; }
  if (wake) { for (let i = 0; i < 14; i++) { const q = rng(i + 50), x = 120 + q() * 840, sp = 120 + q() * 260, y = mod(q() * H + lt * sp, H + 300) - 150; c.strokeStyle = 'rgba(235,250,255,.5)'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y - 70 - q() * 90); c.lineTo(x, y); c.stroke(); c.fillStyle = 'rgba(245,252,255,.8)'; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); }
    const fog = 0.5 + 0.5 * Math.sin(lt * 2.2); c.fillStyle = `rgba(240,250,255,${0.22 * fog})`; c.beginPath(); c.ellipse(540, 1030, 150 + fog * 50, 90 + fog * 30, 0, 0, 7); c.fill(); }
  poly(c, [[-80, 760], [760, -80], [980, -80], [-80, 1020]], 'rgba(255,255,255,.07)'); poly(c, [[300, 2000], [1160, 1100], [1160, 1220], [420, 2000]], 'rgba(255,255,255,.04)');
  c.strokeStyle = '#020a0e'; c.lineWidth = 150; rrect(c, 20, 250, 1040, 1700, 330); c.stroke(); c.strokeStyle = wake ? `rgba(255,${150 + 60 * S},90,.9)` : 'rgba(190,245,255,.8)'; c.lineWidth = 6; rrect(c, 96, 326, 888, 1548, 262); c.stroke();
  if (wake) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = `rgba(255,120,30,${0.07 + 0.14 * S})`; c.fillRect(-80, -80, W + 160, H + 160); c.restore();
    c.fillStyle = 'rgba(3,6,9,.88)'; rrect(c, 250, 290, 580, 190, 20); c.fill(); c.strokeStyle = '#ff5a64'; c.lineWidth = 4; c.stroke(); c.textAlign = 'center'; c.font = 'bold 32px "DejaVu Sans Mono"'; c.fillStyle = '#ffb23f'; c.fillText('WAKE CYCLE STARTED', 540, 340);
    c.font = 'bold 104px "DejaVu Sans Mono"'; c.fillStyle = '#ff5a64'; c.shadowColor = '#ff3344'; c.shadowBlur = 30; c.fillText('00:' + String(Math.max(0, 60 - Math.floor(lt))).padStart(2, '0'), 540, 446); c.shadowBlur = 0; }
};
