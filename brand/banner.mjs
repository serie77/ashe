// renders brand/banner.html to png: ashe-banner.png (3000 x 1000, for retina) and ashe-banner-1500x500.png.
// serves the repo over http so the page can import the site's own modules.
//   node brand/banner.mjs [--check]   (--check also writes a copy with x's profile-picture zone drawn on it)
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([a-z]):/i, '$1:');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(ROOT, new URL(req.url, 'http://x').pathname));
    res.writeHead(200, { 'content-type': MIME[extname(req.url)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
async function render(dpr, path, check) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 500, deviceScaleFactor: dpr });
  await page.goto(`http://127.0.0.1:${port}/brand/banner.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.dataset.fonts === '1');
  await sleep(10500); // the tree grows, the crown catches, ashe settles on her branch
  await page.screenshot({ path });
  if (check) {
    // where x puts the profile picture: bottom left, about a third of the banner's height into it
    await page.evaluate(() => {
      const z = document.createElement('div');
      z.style.cssText = 'position:absolute;left:40px;top:335px;width:335px;height:335px;border-radius:50%;background:rgba(80,160,255,.45);border:2px solid #6cf';
      document.querySelector('.banner').appendChild(z);
    });
    await page.screenshot({ path: path.replace('.png', '-check.png') });
  }
  await page.close();
}
const check = process.argv.includes('--check');
await render(2, join(ROOT, 'brand/ashe-banner.png'), check);
await render(1, join(ROOT, 'brand/ashe-banner-1500x500.png'), false);
await browser.close();
server.close();
console.log('wrote brand/ashe-banner.png (3000x1000) and brand/ashe-banner-1500x500.png');
