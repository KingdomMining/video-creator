// Usage: node render.js timeline.json audio.wav out.mp4   (or: node render.js timeline.json --still 12.5 out.jpg)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');

(async () => {
  const [tlPath, a2, a3, a4] = process.argv.slice(2);
  const tl = JSON.parse(fs.readFileSync(tlPath, 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', e => { console.error('PAGE ERROR', e); process.exit(1); });
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.evaluate(t => window.init(t), tl);

  if (a2 === '--still') {
    await page.evaluate(t => window.renderFrame(t), parseFloat(a3));
    await page.screenshot({ path: a4, type: 'jpeg', quality: 85 });
    await browser.close(); return;
  }
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(tl.fps), '-c:v', 'mjpeg', '-i', '-', '-i', a2,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', a3],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round(tl.duration * tl.fps);
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => window.renderFrame(t), i / tl.fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`  frame ${i}/${n}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
})();
