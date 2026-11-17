#!/usr/bin/env node
// Frame renderer: drives the page in headless Chromium (software WebGL) and pipes frames to ffmpeg.
//
//   Full video, both cuts in one pass:
//     node renderer/render.js TIMELINE.json AUDIO.wav OUT.mp4 [--meta OUT-meta.mp4]
//   One frame / contact sheet / thumbnail of a built timeline:
//     node renderer/render.js TIMELINE.json --still 12.5 out.jpg
//     node renderer/render.js TIMELINE.json --sheet 16 out.jpg            (16 evenly spaced frames; or --sheet 1.0,2.5,7)
//     node renderer/render.js TIMELINE.json --thumb out.jpg
//   Preview ONE shot without a timeline (fast iteration while building a shot):
//     node renderer/render.js --shot NAME --scripts renderer/films/x/a.js,renderer/films/x/b.js --n 6 --dur 7 --out sheet.jpg
//       --at 0,1.5,3     exact local times instead of --n evenly spaced
//       --params '{"k":1}'  shot params      --text "words shown as captions"
//   --kits nature,fx   load only these kits from renderer/kit/ (default: all; brand.js always loads)
//   Common flags: --draft (half-res 3D, 4x faster)  --guides (show platform UI zones)  --clean (no text overlays)
//                 --soft (Facebook/Instagram end card)  --cols N  --scale 0.3 (sheet tile scale)  --q 0.9
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const R = __dirname;

function parse(argv) {
  const pos = [], f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (['draft', 'guides', 'clean', 'soft'].includes(k)) f[k] = true; else f[k] = argv[++i]; }
    else pos.push(a);
  }
  return { pos, f };
}
function kitScripts() {
  const dir = path.join(R, 'kit'); if (!fs.existsSync(dir)) return [];
  const all = fs.readdirSync(dir).filter(x => x.endsWith('.js')).sort();
  const man = path.join(dir, 'manifest.json');
  const order = fs.existsSync(man) ? JSON.parse(fs.readFileSync(man, 'utf8')) : [];
  return [...order.filter(x => all.includes(x)), ...all.filter(x => !order.includes(x))].map(x => path.join(dir, x));
}
const BRAND = fs.existsSync(path.join(R, '..', 'brand.json')) ? JSON.parse(fs.readFileSync(path.join(R, '..', 'brand.json'), 'utf8')) : null;
async function open(tl, f, extraScripts) {
  if (!tl.brand && BRAND) tl.brand = BRAND;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files', '--disable-web-security'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const errs = [];
  page.on('pageerror', e => { errs.push(String(e.stack || e)); console.error('PAGE ERROR:', String(e.stack || e).split('\n').slice(0, 4).join('\n')); });
  page.on('console', m => { const t = m.text(); if (m.type() === 'error' || (m.type() === 'warning' && !/deprecated with r150|GPU stall|GL Driver Message/i.test(t))) console.error('console.' + m.type() + ':', t.slice(0, 400)); });
  await page.goto('file://' + path.join(R, 'index.html'));
  const scripts = ['vendor/three.min.js', 'scenes.js', 'fonts.js', 'film_deep_signal.js', 'stage3d.js'].map(x => path.join(R, x))
    .concat(kitScripts(), (tl.scripts || []).map(x => path.resolve(R, '..', x)), extraScripts || []);
  await page.evaluate(o => { window.DRAFT = !!o.draft; window.GUIDES = !!o.guides; window.CLEAN = !!o.clean; }, f);
  // Kits are built by different teams: a broken kit must not break everyone else's previews. A kit that fails to
  // load is reported and skipped; an error in the core or in the film's own scripts is fatal.
  const kitDir = path.join(R, 'kit') + path.sep, skip = (f.kits !== undefined) ? f.kits.split(',').filter(Boolean) : null;
  for (const s of scripts) {
    const isKit = s.startsWith(kitDir);
    if (isKit && skip && !skip.includes(path.basename(s, '.js')) && path.basename(s) !== 'brand.js') continue;
    if (!fs.existsSync(s)) { console.error('missing script', s); process.exit(2); }
    const before = errs.length;
    try { await page.addScriptTag({ path: s }); } catch (e) { errs.push(String(e)); }
    await page.evaluate(() => 0);
    if (errs.length > before) { if (isKit) { console.error(`WARNING: kit ${path.basename(s)} failed to load and was skipped (not your problem unless it is your kit).`); errs.length = before; } else { console.error('FAILED to load ' + s); await browser.close(); process.exit(3); } }
  }
  await page.evaluate(t => window.init(t), tl);
  return { browser, page, errs };
}
const grab = async (page, q) => Buffer.from((await page.evaluate(q => document.getElementById('c').toDataURL('image/jpeg', q), q)).split(',')[1], 'base64');

async function sheet(page, times, out, f, labels) {
  const cols = +f.cols || Math.min(times.length, 6), scale = +f.scale || (times.length > 8 ? 0.3 : 0.4);
  const b64 = await page.evaluate(async ({ times, cols, scale, soft, labels }) => {
    const tw = Math.round(1080 * scale), th = Math.round(1920 * scale), rows = Math.ceil(times.length / cols);
    const sh = document.createElement('canvas'); sh.width = tw * cols; sh.height = th * rows; const g = sh.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, sh.width, sh.height);
    for (let i = 0; i < times.length; i++) {
      window.renderFrame(times[i], soft); const x = (i % cols) * tw, y = Math.floor(i / cols) * th;
      g.drawImage(document.getElementById('c'), x, y, tw, th);
      const lab = labels[i]; g.font = 'bold 18px monospace'; const w = g.measureText(lab).width + 12; g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(x, y, w, 24); g.fillStyle = '#7fffd4'; g.fillText(lab, x + 6, y + 18);
    }
    return sh.toDataURL('image/jpeg', 0.88).split(',')[1];
  }, { times, cols, scale, soft: !!f.soft, labels });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
}

(async () => {
  const { pos, f } = parse(process.argv.slice(2));
  const q = +f.q || 0.93;

  // ---- single-shot preview (no timeline needed) ----
  if (f.shot) {
    const dur = +f.dur || 6, n = +f.n || 6;
    const times = f.at ? f.at.split(',').map(Number) : Array.from({ length: n }, (_, i) => +(dur * (i + 0.5) / n).toFixed(3));
    const words = (f.text || '').split(/\s+/).filter(Boolean).map((w, i, a) => ({ w: w.toUpperCase().replace(/[^A-Z0-9'\-]/g, ''), t: +(0.2 + i * (dur - 0.6) / Math.max(1, a.length)).toFixed(3) }));
    const chunks = []; for (let i = 0; i < words.length; i += 3) { const g = words.slice(i, i + 3); chunks.push({ start: g[0].t, end: (words[i + 3] || { t: dur }).t, words: g.map((w, k) => ({ w: w.w, start: w.t, end: (words[i + k + 1] || { t: dur }).t })) }); }
    const tl = { fps: 30, duration: dur, theme: 'space', series: f.series || 'PREVIEW', episode: 1, scenes: [{ visual: f.shot, params: f.params ? JSON.parse(f.params) : {}, start: 0, end: dur, words }], chunks, sfx: [], choice: { start: 1e9, question: '', a: '', b: '' }, style: f.style ? JSON.parse(f.style) : undefined };
    const { browser, page, errs } = await open(tl, f, (f.scripts || '').split(',').filter(Boolean).map(x => path.resolve(x)));
    const has = await page.evaluate(n => !!SCENES[n], f.shot); if (!has) { console.error(`shot "${f.shot}" is not registered. Registered 3D shots: ` + (await page.evaluate(() => Object.keys(S3.defs).join(', ')))); await browser.close(); process.exit(4); }
    const out = f.out || 'shot.jpg', t0 = Date.now();
    if (times.length === 1) { await page.evaluate(t => window.renderFrame(t), times[0]); fs.writeFileSync(out, await grab(page, q)); }
    else await sheet(page, times, out, f, times.map(t => `${f.shot} t=${t.toFixed(2)}s`));
    console.log(`${out}  (${times.length} frame${times.length > 1 ? 's' : ''}, ${((Date.now() - t0) / 1000).toFixed(1)}s)` + (errs.length ? `  WITH ${errs.length} PAGE ERRORS` : ''));
    await browser.close(); process.exit(errs.length ? 5 : 0);
  }

  const tl = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
  const { browser, page, errs } = await open(tl, f);
  const sceneAt = t => tl.scenes.find(s => t >= s.start && t < s.end) || tl.scenes[tl.scenes.length - 1];

  if (f.still !== undefined) { await page.evaluate(([t, soft]) => window.renderFrame(t, soft), [parseFloat(f.still), !!f.soft]); fs.writeFileSync(pos[1], await grab(page, q)); console.log(pos[1]); await browser.close(); process.exit(errs.length ? 5 : 0); }
  if (f.thumb !== undefined) { await page.evaluate(() => { window.renderBase(0); window.CLEAN = true; window.renderOver(0, false); }); fs.writeFileSync(f.thumb, await grab(page, 0.95)); console.log(f.thumb); await browser.close(); process.exit(errs.length ? 5 : 0); }
  if (f.sheet !== undefined) {
    const times = f.sheet.includes(',') ? f.sheet.split(',').map(Number) : Array.from({ length: +f.sheet }, (_, i) => +(tl.duration * (i + 0.5) / +f.sheet).toFixed(2));
    await sheet(page, times, pos[1], f, times.map(t => `${t.toFixed(1)}s ${sceneAt(t).visual}`)); console.log(pos[1]); await browser.close(); process.exit(errs.length ? 5 : 0);
  }

  // ---- full render: one pass, two encoders (standard cut + Facebook/Instagram cut) ----
  const enc = out => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(tl.fps), '-c:v', 'mjpeg', '-i', '-', '-i', pos[1],
    '-vf', 'scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=pc:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.2', '-crf', '19', '-preset', 'veryfast', '-g', String(tl.fps * 2), '-bf', '2',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const std = enc(pos[2]), meta = f.meta ? enc(f.meta) : null;
  const write = (p, buf) => p.stdin.write(buf) ? null : new Promise(r => p.stdin.once('drain', r));
  const n = Math.round(tl.duration * tl.fps), t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = i / tl.fps;
    await page.evaluate(t => { window.renderBase(t); window.renderOver(t, false); }, t);
    const a = await grab(page, q); await write(std, a);
    if (meta) { if (t >= tl.choice.start - 0.05) { await page.evaluate(t => window.renderOver(t, true), t); await write(meta, await grab(page, q)); } else await write(meta, a); }
    if (i % 150 === 0) console.log(`  frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (errs.length) { console.error('aborting: page errors'); process.exit(5); }
  }
  std.stdin.end(); if (meta) meta.stdin.end();
  await Promise.all([std, meta].filter(Boolean).map(p => new Promise(r => p.on('close', r))));
  console.log(`rendered ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
