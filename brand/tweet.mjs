// renders brand/tweet.html frame by frame into ashe-burn.gif (960 x 540, 25 fps) and, when ffmpeg is installed,
// ashe-burn.mp4 (1920 x 1080). every frame is stepped by hand, so the timing below is exact.
// the word is set in the real fraunces outlines, fetched once from the google fonts repo and cached in the temp dir.
//   node brand/tweet.mjs
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([a-z]):/i, '$1:');
const FRAMES = join(ROOT, 'brand', '.frames');
const FPS = 25, DT = 1000 / FPS;
const END = 9.4; // seconds
const GROW = 2.45; // the tree's own growth takes 3.4s; the clock runs faster through it so the picture arrives sooner

// the storyboard, in seconds
const ramp = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));
const smooth = (v) => v * v * (3 - 2 * v);
const FIRE = [4.4, 8.2]; // the fire runs through the crown
const FLIGHT = [4.8, 7.8]; // ashe leaves
const FADE = [8.6, 9.4]; // to dark, so the loop lands on the tree growing again
const WRITE = { start: 1.1, step: 0.62, each: 0.9 }; // the letters are written one after another while the tree grows

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(ROOT, new URL(req.url, 'http://x').pathname));
    res.writeHead(200, { 'content-type': MIME[extname(req.url)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${server.address().port}/brand/tweet.html`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.ready);

// the word, as outlines at a thin and a heavy weight; the page interpolates between them as the fire fills it
const FONT = join(tmpdir(), 'fraunces-variable.ttf');
if (!existsSync(FONT)) await writeFile(FONT, Buffer.from(await (await fetch('https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf')).arrayBuffer()));
const fk = await import('fontkit');
const font = (fk.create ?? fk.default.create)(await readFile(FONT));
const [thin, heavy] = [300, 720].map((wght) => font.getVariation({ opsz: 144, wght, SOFT: 0, WONK: 1 }).layout('ashe'));
const OP = { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C', closePath: 'Z' };
const cmds = (g) => g.path.commands.map((c) => [OP[c.command], ...c.args]);
let xA = 0, xB = 0;
const glyphs = thin.glyphs.map((g, i) => {
  const out = { a: cmds(g), b: cmds(heavy.glyphs[i]), xA: xA + thin.positions[i].xOffset, xB: xB + heavy.positions[i].xOffset, advA: thin.positions[i].xAdvance, advB: heavy.positions[i].xAdvance };
  xA += thin.positions[i].xAdvance;
  xB += heavy.positions[i].xAdvance;
  return out;
});
await page.evaluate((w) => setWord(w), { glyphs, upm: font.unitsPerEm, ascent: font.ascent, descent: font.descent, size: 360, left: 118, baseline: 790 });

const total = Math.round(END * FPS);
for (let i = 0; i < total; i++) {
  const t = i / FPS;
  const fire = smooth(ramp(t, ...FIRE));
  const camera = 0.06 * smooth(ramp(t, FIRE[0], END)); // the faintest push in, keeping the whole tree in frame
  const q = ramp(t, ...FLIGHT);
  const fade = smooth(ramp(t, ...FADE));
  const write = glyphs.map((_, i) => smooth(ramp(t, WRITE.start + i * WRITE.step, WRITE.start + i * WRITE.step + WRITE.each)));
  await page.evaluate(({ dt, fire, camera, q, fade, write }) => {
    tree.scene(camera, fire);
    wordFrame({ write, fire, k: fire });
    if (q > 0) {
      // she leaves her branch and climbs away to the upper left, faster as she goes
      if (!window.flightFrom) window.flightFrom = [...tree.anchors.moth];
      const [x0, y0] = window.flightFrom;
      const k = q * q;
      tree.attract(x0 - 1100 * k + Math.sin(q * 9) * 40, y0 - (y0 + 350) * k + Math.sin(q * 14) * 25);
    }
    document.getElementById('fade').style.opacity = fade;
    step(dt);
  }, { dt: DT * (t < GROW ? 1.4 : 1), fire, camera, q, fade, write });
  await page.screenshot({ path: join(FRAMES, `f${String(i).padStart(3, '0')}.png`) });
  if (i % 25 === 0) process.stdout.write(`\r${t.toFixed(1)}s of ${END}s`);
}
console.log('\nframes done');
await browser.close();
server.close();

// gif: half size, one palette drawn from frames across the whole run
const files = (await readdir(FRAMES)).sort();
const half = (png) => {
  const w = png.width / 2, h = png.height / 2, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const i = (2 * y * png.width + 2 * x) * 4 + c;
        out[(y * w + x) * 4 + c] = (png.data[i] + png.data[i + 4] + png.data[i + png.width * 4] + png.data[i + png.width * 4 + 4]) >> 2;
      }
  return { w, h, data: out };
};
const sample = [];
for (const f of files.filter((_, i) => i % 20 === 10)) sample.push(half(PNG.sync.read(await readFile(join(FRAMES, f)))).data);
const joined = new Uint8Array(sample.reduce((n, s) => n + s.length, 0));
sample.reduce((o, s) => (joined.set(s, o), o + s.length), 0);
const palette = quantize(joined, 256);
const gif = GIFEncoder();
for (const [i, f] of files.entries()) {
  const { w, h, data } = half(PNG.sync.read(await readFile(join(FRAMES, f))));
  gif.writeFrame(applyPalette(data, palette), w, h, { palette: i === 0 ? palette : undefined, delay: DT });
}
gif.finish();
await writeFile(join(ROOT, 'brand', 'ashe-burn.gif'), gif.bytes());
console.log(`gif: ${(gif.bytes().length / 1048576).toFixed(1)} MB, ${files.length} frames at ${FPS} fps`);

try {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(FRAMES, 'f%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-movflags', '+faststart', join(ROOT, 'brand', 'ashe-burn.mp4')]);
  console.log('mp4: brand/ashe-burn.mp4');
} catch {
  console.log('no ffmpeg on this machine, so no mp4');
}
if (!process.argv.includes('--keep')) await rm(FRAMES, { recursive: true, force: true });
