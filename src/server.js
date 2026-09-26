import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { config } from './config.js';
import { wallet } from './chain.js';
import { live, ledger, events, RULES } from './bot.js';

const PUBLIC = join(process.cwd(), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.ico': 'image/x-icon' };
const num = (wei) => Number(wei) / 1e18;

function snapshot() {
  const burns = ledger.burns.map((b) => ({ ...b, ethSpent: num(b.ethSpent), tokensBurned: num(b.tokensBurned) }));
  const l = live.launch;
  return {
    name: config.name,
    mode: live.mode,
    network: config.network,
    rules: RULES,
    status: live.status,
    nextLookAt: live.nextLookAt,
    explorer: config.explorer,
    head: live.head,
    token: l && { address: l.address, name: l.name, symbol: l.symbol, phase: l.phase, creatorTaxBps: l.creatorTaxBps },
    fees: l?.fees && { ...l.fees, tradeFeeBps: l.phase === 'curve' ? l.fees.curveFeeBps : l.fees.poolFeeBps },
    furnace: wallet && { address: wallet.address, balanceEth: live.furnace ? num(live.furnace.balance) : null },
    watch: config.watch || wallet?.address || null,
    supply: live.supply && { burned: num(live.supply.burned), total: num(live.supply.total), pct: live.supply.pct },
    price: live.price,
    mcapEth: live.price && live.supply ? live.price * num(live.supply.total) : null,
    market: live.market,
    totals: {
      count: burns.length,
      eth: burns.reduce((s, b) => s + b.ethSpent, 0),
      tokens: burns.reduce((s, b) => s + b.tokensBurned, 0),
    },
    burns: burns.reverse(),
    decisions: ledger.decisions.slice(-30).reverse(),
  };
}

export function startServer() {
  const clients = new Set();
  const send = (res, msg) => {
    if (res.writableEnded || res.destroyed) return clients.delete(res);
    res.write(msg);
  };
  const push = () => {
    const msg = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) send(res, msg);
  };
  events.on('update', push);
  events.on('burn', push);

  createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(snapshot()));
    }
    if (path === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => send(res, ': ping\n\n'), 25000);
      const drop = () => (clearInterval(ping), clients.delete(res));
      req.on('close', drop);
      res.on('error', drop); // a browser that vanishes mid-write must not take the process down
      return;
    }
    const file = normalize(join(PUBLIC, path === '/' ? 'index.html' : path));
    if (!file.startsWith(PUBLIC)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  }).listen(config.port, () => console.log(`${config.name}: site on http://localhost:${config.port}`));
}
