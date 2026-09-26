// mints a fresh furnace wallet into .env. the key is never printed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ethers } from 'ethers';

const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const existing = env.match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
if (existing) {
  console.log('furnace wallet already set:', new ethers.Wallet(existing[1]).address);
  process.exit(0);
}

const w = ethers.Wallet.createRandom();
const line = `PRIVATE_KEY=${w.privateKey}`;
writeFileSync('.env', /^PRIVATE_KEY=.*$/m.test(env) ? env.replace(/^PRIVATE_KEY=.*$/m, line) : `${env}\n${line}\n`);
console.log('furnace wallet:', w.address);
console.log('key saved to .env. back that file up, it is the only copy.');
