import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { provider, readBurnLogs, ethSpentInTx } from './chain.js';

let file;
export const ledger = { burns: [], decisions: [], lastBlock: 0 };

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

export function addDecision(decision) {
  ledger.decisions.push(decision);
  if (ledger.decisions.length > 60) ledger.decisions.splice(0, ledger.decisions.length - 60);
  save();
}

// pick up burns that happened on chain but are not in the ledger (first boot, lost disk, or a demo token)
export async function syncBurns(launch, from, head) {
  const logs = await readBurnLogs(launch, from, ledger.lastBlock ? ledger.lastBlock + 1 : 0, head);
  const known = new Set(ledger.burns.map((b) => b.burnTx));
  const fresh = [];
  for (const log of logs) {
    if (known.has(log.tx)) continue;
    const [block, buy] = await Promise.all([provider.getBlock(log.block), ethSpentInTx(launch, log.tx)]);
    const burn = {
      ts: block.timestamp * 1000,
      block: log.block,
      ethSpent: buy.spent.toString(),
      tokensBurned: log.tokens.toString(),
      venue: buy.venue,
      buyTx: buy.venue ? log.tx : null,
      burnTx: log.tx,
      reason: 'chain',
    };
    ledger.burns.push(burn);
    fresh.push(burn);
  }
  ledger.burns.sort((a, b) => a.ts - b.ts);
  ledger.lastBlock = head;
  save();
  return fresh;
}
