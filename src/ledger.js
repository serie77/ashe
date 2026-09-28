import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { provider, readBurnLogs, readIncoming, ethSpentInTx } from './chain.js';

let file;
export const ledger = { burns: [], decisions: [], lastBlock: 0, kept: '0' };

export function openLedger(tokenAddr) {
  mkdirSync(config.dataDir, { recursive: true });
  file = join(config.dataDir, `ledger-${tokenAddr.toLowerCase()}.json`);
  if (existsSync(file)) Object.assign(ledger, JSON.parse(readFileSync(file, 'utf8')));
}

function save() {
  writeFileSync(file + '.tmp', JSON.stringify(ledger));
  renameSync(file + '.tmp', file);
}

export function addBurn(burn) {
  ledger.burns.push(burn);
  ledger.burns.sort((a, b) => a.ts - b.ts);
  save();
}

export function setKept(wei) {
  ledger.kept = wei.toString();
  save();
}

export function addDecision(decision) {
  ledger.decisions.push(decision);
  if (ledger.decisions.length > 60) ledger.decisions.splice(0, ledger.decisions.length - 60);
  save();
}

// pick up burns that happened on chain but are not in the ledger (first boot, lost disk, or a demo token)
export async function syncBurns(launch, from, head) {
  const start = ledger.lastBlock ? ledger.lastBlock + 1 : 0;
  const logs = await readBurnLogs(launch, from, start, head);
  const known = new Set(ledger.burns.map((b) => b.burnTx));
  const fresh = [];
  if (!logs.some((l) => !known.has(l.tx))) return finish(head, fresh);
  // buys that landed in the burner's wallet: a burn in its own transaction is paired with the latest one before it
  const incoming = (await readIncoming(launch, from, Math.max(0, start - 50_000), head)).filter((t) => !logs.some((l) => l.tx === t.tx));
  const used = new Set(ledger.burns.map((b) => b.buyTx));
  for (const log of logs) {
    if (known.has(log.tx)) continue;
    let buy = await ethSpentInTx(launch, log.tx);
    let buyTx = buy.venue ? log.tx : null;
    if (!buy.venue) {
      const prior = incoming.filter((t) => t.block <= log.block && !used.has(t.tx)).pop();
      if (prior) {
        const found = await ethSpentInTx(launch, prior.tx);
        if (found.venue) (buy = found), (buyTx = prior.tx), used.add(prior.tx);
      }
    }
    const block = await provider.getBlock(log.block);
    const burn = {
      ts: block.timestamp * 1000,
      block: log.block,
      ethSpent: buy.spent.toString(),
      tokensBurned: log.tokens.toString(),
      venue: buy.venue,
      buyTx,
      burnTx: log.tx,
      reason: 'chain',
    };
    ledger.burns.push(burn);
    fresh.push(burn);
  }
  return finish(head, fresh);
}

function finish(head, fresh) {
  ledger.burns.sort((a, b) => a.ts - b.ts);
  ledger.lastBlock = head;
  save();
  return fresh;
}
