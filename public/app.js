import { createTree } from './tree.js';
import { initMotion, setTicker } from './motion.js';
import { createFlow } from './flow.js';
import { mothSvg } from './mothsvg.js';

const $ = (id) => document.getElementById(id);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- formatting ----------
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmtEth = (n) => (n === 0 ? '0' : n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(3) : n >= 0.001 ? n.toFixed(4) : n.toPrecision(2));
const fmtTok = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toFixed(0));
const fmtPrice = (n) => (n ? n.toExponential(3).replace('e', ' e') : '·');
const fmtPct = (n) => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const ago = (ts) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};
const stamp = (ts) => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).toLowerCase();

// numbers roll to their new value instead of snapping
const rolling = new Map();
const waiting = new Map(); // numbers below the fold hold their roll until they scroll into view
const seenIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    seenIO.unobserve(e.target);
    e.target.dataset.seen = '1';
    const args = waiting.get(e.target);
    waiting.delete(e.target);
    if (args) roll(e.target, ...args);
  }
}, { threshold: 0.6 });
function roll(el, to, fmt, ms = 1600) {
  if (!el.dataset.seen) {
    if (!waiting.has(el)) seenIO.observe(el);
    waiting.set(el, [to, fmt, ms]);
    return (el.textContent = fmt(0));
  }
  const from = rolling.get(el) ?? 0;
  if (from === to) return (el.textContent = fmt(to));
  rolling.set(el, to);
  if (still) return (el.textContent = fmt(to));
  const t0 = performance.now();
  const step = (now) => {
    if (rolling.get(el) !== to) return;
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 4)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ashe beside the name, and her outline in the footer
$('brand-moth').innerHTML = mothSvg({ levels: 3, beat: true });
$('watch-moth').innerHTML = mothSvg({ levels: 2, beat: true });
$('colophon-moth').innerHTML = mothSvg({ levels: 7, outline: true });

// ---------- tree ----------
let caught = false;
let state = null;
const tree = createTree($('tree'), {
  onCatch() {
    caught = true;
    if (state) paintHero(state);
  },
});

const notes = document.querySelector('.notes');
const species = document.querySelector('.species');
const mothNote = $('note-moth');
(function hang() {
  const a = tree.anchors;
  if (a.ready) {
    notes.classList.add('on');
    for (const [id, key] of [['note-crown', 'crown'], ['note-trunk', 'trunk'], ['note-ash', 'ash']]) {
      const el = $(id);
      const x = Math.min(a[key][0] + 10, innerWidth - el.offsetWidth - 20);
      el.style.transform = `translate(${x}px, ${a[key][1] - el.offsetHeight / 2}px)`;
    }
    species.style.translate = `${a.species[0]}px ${a.species[1]}px`;
    mothNote.classList.toggle('hide', a.mothMode !== 'perched');
    mothNote.style.transform = `translate(${a.moth[0] - mothNote.offsetWidth - 14}px, ${a.moth[1] - mothNote.offsetHeight / 2}px)`;
  }
  requestAnimationFrame(hang);
})();

// ---------- hero ----------
function paintHero(s) {
  if (!s.supply || !caught) return;
  tree.setBurned(s.supply.pct / 100);
  dispatchEvent(new Event('scroll')); // the projection readout starts from the real figure
  roll($('pct'), s.supply.pct, (n) => n.toFixed(2), 3200);
  $('note-crown').lastElementChild.textContent = s.supply.pct > 0 ? 'crown, burning' : 'crown, untouched';
  $('note-trunk').lastElementChild.textContent = `heartwood · ${fmtTok(s.supply.total)} standing`;
  $('note-ash').lastElementChild.textContent = `ash · ${fmtTok(s.supply.burned)}`;
}

function paintReadouts(s) {
  roll($('r-block'), s.head, fmtInt, 900);
  roll($('r-burns'), s.totals.count, fmtInt);
  roll($('r-eth'), s.totals.eth, fmtEth);
  $('r-price').textContent = fmtPrice(s.price);
  $('status').textContent = s.status;
  const mode = $('mode');
  mode.hidden = s.mode === 'live' && s.network === 'mainnet';
  mode.textContent = s.network === 'testnet' ? `testnet · ${s.mode}` : s.mode;
}

setInterval(() => {
  if (!state?.nextLookAt) return;
  const left = Math.max(0, Math.round((state.nextLookAt - Date.now()) / 1000));
  $('next').textContent = left ? `· next look ${left}s` : '· looking';
}, 500);

// ---------- mind ----------
let pinned = null; // a past look the visitor clicked on
let lastLook = null; // newest decision already shown, so ashe and the diagram only react to new ones
let flow;

// the rulebook, printed from the numbers the furnace is actually running with
function paintRules(r) {
  if (!r) return;
  const pct = (v) => Math.round(v * 100) + '%';
  $('rules').innerHTML = [
    `jev looks once every <b>${r.intervalSec} seconds</b>.`,
    `it buys only when it is at least <b>${pct(r.minConfidence)}</b> sure, and never into a pump.`,
    `each buy spends <b>${pct(r.sizeMin)} to ${pct(r.sizeMax)}</b> of what the furnace holds. jev picks how much.`,
    `quiet for <b>${r.maxIdleMin} minutes</b>? a small buy goes through anyway, so the fire never goes out.`,
  ].map((t) => `<li><span>${t}</span></li>`).join('');
}

// where the money comes from: this launch's real pons fee terms, read from chain by the server
function paintFuel(f) {
  const fuel = $('fuel');
  fuel.hidden = !f;
  if (!f) return;
  const pc = (bps) => +(bps / 100).toFixed(2) + '%';
  const share = f.tradeFeeBps * (1 - f.ponsShareBps / 10000); // the creator's side of the trade fee
  const locked = share * (f.lockShareBps / 10000); // pons's own buyback-and-lock, if it was switched on
  const furnace = share - locked + f.creatorTaxBps;
  const total = f.tradeFeeBps + f.creatorTaxBps;
  fuel.style.setProperty('--furnace', (furnace / total) * 100 + '%');
  fuel.style.setProperty('--pons', ((total - furnace) / total) * 100 + '%');
  $('fuel-furnace').textContent = pc(furnace);
  $('fuel-pons').textContent = pc(total - furnace);
  $('fuel-lines').innerHTML =
    `<li><b>${pc(f.tradeFeeBps)}</b><span>the pons trade fee. pons keeps ${pc(f.ponsShareBps)} of it, the creator side gets the rest.</span></li>` +
    (f.creatorTaxBps ? `<li><b>${pc(f.creatorTaxBps)}</b><span>the creator tax, fixed when the token launched, paid to the creator side.</span></li>` : '') +
    (locked ? `<li><b>${pc(locked)}</b><span>is taken by pons's own buyback-and-lock, which this launch has switched on.</span></li>` : '') +
    `<li><i>then</i><span>the fees wait in the pons escrow. the furnace claims from there, and what it claims is what it spends on buybacks.</span></li>`;
}

// why the furnace did what it did on one look, line by line
function trace(d, s) {
  const r = s.rules;
  const row = (cls, mark, text, note = '') => `<li class="${cls}"><i>${mark}</i><span>${text}</span><span>${note}</span></li>`;
  const buy = d.choice === 'buy_now';
  const sure = d.confidence >= r.minConfidence;
  const chasing = d.chasing >= r.chasingMax;
  const rows = [
    buy ? row(sure ? 'yes' : 'no', sure ? '✓' : '✕', `jev said <b>buy</b>${sure ? '' : ', but not firmly enough'}`, `${d.confidence.toFixed(2)} ${sure ? '≥' : '<'} ${r.minConfidence.toFixed(2)}`)
        : row('no', '✕', 'jev said <b>wait</b>', `buy probability ${(d.probabilities.buy_now ?? 0).toFixed(2)}`),
    row(chasing ? 'no' : 'yes', chasing ? '✕' : '✓', chasing ? 'it would be <b>chasing a pump</b>' : 'not chasing a pump', `${d.chasing.toFixed(2)} ${chasing ? '≥' : '<'} ${r.chasingMax.toFixed(2)}`),
  ];
  if (d.reason === 'heartbeat') rows.push(row('go', '→', '<b>heartbeat</b>: too long without a buy', `${d.idleMin ?? '·'} of ${r.maxIdleMin} min`));
  else if (d.outcome === 'waited' && d.idleMin !== undefined) rows.push(row('', '·', 'heartbeat not due', `idle ${d.idleMin} of ${r.maxIdleMin} min`));
  if (d.amountEth) {
    if (d.frac) rows.push(row('go', '→', d.reason === 'jev' ? `size <b>${d.size.toFixed(2)}</b> of 2` : 'heartbeat size', `${Math.round(d.frac * 100)}% of ${fmtEth(d.budgetEth)} eth`));
    const links = d.buyTx ? `<a href="${s.explorer}/tx/${d.buyTx}" target="_blank" rel="noopener">buy ↗</a><a href="${s.explorer}/tx/${d.burnTx}" target="_blank" rel="noopener">burn ↗</a>` : '';
    rows.push(row('go', '→', d.outcome === 'rehearsed' ? `<b>rehearsed</b>: ${fmtEth(d.amountEth)} eth for ${fmtTok(d.tokens)} tokens` : `<b>bought and burned</b> ${fmtTok(d.tokens)} tokens for ${fmtEth(d.amountEth)} eth`, d.outcome === 'rehearsed' ? 'simulated, nothing sent' : links));
  } else rows.push(row('', '→', d.outcome === 'failed' ? 'tried to buy. <b>the chain refused</b>, it will retry' : '<b>held.</b> nothing bought', ''));
  return rows.join('');
}

function paintMind(s) {
  paintRules(s.rules);
  paintFuel(s.fees);
  flow ??= createFlow({ fmtEth, fmtTok });
  flow.update(s);
  const list = s.decisions;
  // ashe reacts to each new look: a twitch for a wait, a flight to the fire for a buy
  if (list[0]) lastLook = list[0].ts;
  const d = pinned !== null ? list.find((x) => x.ts === pinned) ?? list[0] : list[0];
  $('d-latest').hidden = pinned === null;

  const strip = $('strip');
  strip.style.setProperty('--bar', s.rules?.minConfidence ?? 0.55); // the dashed line: how sure jev has to be
  $('h-from').textContent = list.length ? `${list.length} looks ago` : '';
  strip.replaceChildren(
    ...[...list].reverse().map((x, i) => {
      const b = document.createElement('button');
      b.className = (x.outcome === 'burned' || x.outcome === 'rehearsed' ? 'fire ' : x.outcome === 'failed' ? 'fail ' : '') + (x.ts === d?.ts ? 'on' : '');
      b.style.setProperty('--h', (x.probabilities?.buy_now ?? 0).toFixed(3));
      b.style.setProperty('--i', i);
      b.title = `${stamp(x.ts)} · wanted to buy ${Math.round((x.probabilities?.buy_now ?? 0) * 100)}% · ${x.outcome}`;
      b.onclick = () => ((pinned = x.ts === list[0].ts ? null : x.ts), paintMind(state), flow.play(x, `replaying the look from ${stamp(x.ts)}.`));
      return b;
    }),
  );

  if (!d) {
    $('d-trace').innerHTML = `<li><i>·</i><span>${s.mode === 'watch' || s.mode === 'standby' ? 'jev is not wired in this mode.' : 'waiting for the first look.'}</span><span></span></li>`;
    return;
  }
  const buy = d.choice === 'buy_now';
  $('d-when').textContent = `${pinned === null ? 'latest look' : 'a past look'} · ${stamp(d.ts)}`;
  const word = $('d-verdict');
  word.textContent = buy ? 'buy' : 'wait';
  word.classList.toggle('buy', buy);
  $('d-conf').textContent = d.confidence.toFixed(2);
  $('d-gauge').style.strokeDashoffset = 1 - d.confidence;

  $('d-trace').innerHTML = trace(d, s);
}
$('d-latest').onclick = () => ((pinned = null), paintMind(state));

// ---------- ledger ----------
let shownRows = 12;
let introduced = false;
let seen = null; // burn txs already on the page; anything new ignites
const born = new Map(); // when each new burn first appeared, so a re-render resumes its glow instead of restarting it
function paintLedger(s) {
  const fresh = seen ? s.burns.filter((b) => !seen.has(b.burnTx)) : [];
  seen = new Set(s.burns.map((b) => b.burnTx));
  if (fresh.length) tree.flare();
  for (const b of fresh) born.set(b.burnTx, Date.now());

  setTicker(
    s.burns.length
      ? s.burns.slice(0, 14).map((b) => `burned <b>${fmtInt(b.tokensBurned)}</b>${b.ethSpent ? ` for ${fmtEth(b.ethSpent)} eth` : ''}, ${ago(b.ts)}`)
      : ['the furnace is cold', 'nothing burned yet', 'jev is watching'],
  );

  const tx = (hash, label) => `<a href="${s.explorer}/tx/${hash}" target="_blank" rel="noopener">${label} ↗</a>`;
  // the first time the table is on screen its rows file in; after that only new burns animate
  const wrap = document.querySelector('.table-wrap');
  if (!introduced && wrap.classList.contains('in')) {
    introduced = true;
    $('rows').classList.add('intro');
    setTimeout(() => $('rows').classList.remove('intro'), 2200);
  }
  $('rows').innerHTML = s.burns
    .slice(0, shownRows)
    .map((b, i) => {
      const by = b.reason === 'jev' ? `jev · ${b.confidence.toFixed(2)}` : b.reason === 'heartbeat' ? 'heartbeat' : b.reason === 'sweep' ? 'leftovers' : 'chain record';
      const links = b.buyTx && b.buyTx !== b.burnTx ? tx(b.buyTx, 'buy') + tx(b.burnTx, 'burn') : tx(b.burnTx, short(b.burnTx));
      const age = Date.now() - (born.get(b.burnTx) ?? 0);
      return `<tr ${age < 4500 ? `class="ignite" style="--age:-${age}ms"` : `style="--i:${i}"`}>
        <td><span class="ago">${ago(b.ts)}</span><span class="abs">${stamp(b.ts)}</span></td>
        <td class="r">${b.ethSpent ? fmtEth(b.ethSpent) : '·'}</td>
        <td class="r tok">${fmtInt(b.tokensBurned)}</td>
        <td>${b.venue === 'v4' ? 'uniswap v4' : b.venue === 'curve' ? 'pons curve' : '·'}</td>
        <td>${by}</td>
        <td class="r">${links}</td></tr>`;
    })
    .join('');
  $('empty').hidden = s.burns.length > 0;
  $('more').hidden = s.burns.length <= shownRows;
  paintChart(s.burns);
}
$('more').onclick = () => ((shownRows += 25), paintLedger(state));

function paintChart(burns) {
  const pts = [...burns].reverse();
  if (pts.length < 2) return;
  const t0 = pts[0].ts;
  const span = Math.max(1, pts[pts.length - 1].ts - t0);
  const total = pts.reduce((s, b) => s + b.tokensBurned, 0);
  let sum = 0;
  let d = 'M0,240';
  for (const b of pts) {
    const x = ((b.ts - t0) / span) * 1000;
    d += ` L${x.toFixed(1)},${(240 - (sum / total) * 226).toFixed(1)}`;
    sum += b.tokensBurned;
    d += ` L${x.toFixed(1)},${(240 - (sum / total) * 226).toFixed(1)}`;
  }
  $('chart-line').setAttribute('d', d);
  $('chart-area').setAttribute('d', d + ' L1000,240 Z');
  $('chart-tip').style.top = ((14 / 240) * $('chart').clientHeight).toFixed(1) + 'px';
  $('c-from').textContent = stamp(t0);
  $('c-to').textContent = `${stamp(pts[pts.length - 1].ts)} · ${fmtTok(total)}`;
}

// ---------- supply + colophon ----------
const MILESTONES = [[1, 'first smoke'], [5, 'kindling'], [10, 'a steady flame'], [25, 'the crown is lit'], [50, 'half the tree']];
function paintSupply(s) {
  if (!s.supply) return;
  document.querySelector('.log').style.setProperty('--pct', s.supply.pct);
  $('s-burned').textContent = fmtInt(s.supply.burned);
  $('s-left').textContent = fmtInt(s.supply.total);
  for (const tick of document.querySelectorAll('#log-ticks i')) tick.classList.toggle('lit', s.supply.pct >= Number(tick.dataset.at));
  const next = MILESTONES.find(([at]) => s.supply.pct < at);
  $('s-next').textContent = next ? `next: ${next[1]}, at ${next[0]}%` : 'past half the tree';
}

function paintColophon(s) {
  const row = (label, addr) => (addr ? `<div><dt>${label}</dt><dd><a href="${s.explorer}/address/${addr}" target="_blank" rel="noopener">${addr}</a></dd></div>` : '');
  $('addrs').innerHTML =
    row(s.token ? `token · ${s.token.symbol}` : 'token', s.token?.address) +
    row('furnace wallet', s.furnace?.address) +
    (s.watch && s.watch.toLowerCase() !== s.furnace?.address.toLowerCase() ? row('burns shown are by', s.watch) : '') +
    (s.network === 'mainnet' ? row('pons factory', '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e') + row('pons fee escrow', '0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e') : '') +
    row('uniswap universal router', '0x8876789976decbfcbbbe364623c63652db8c0904');
  $('fine-mode').textContent = {
    standby: 'standby: no token is wired yet.',
    watch: 'watch mode: the furnace is not trading, the page only reads the chain.',
    rehearsal: 'rehearsal: jev is consulted for real and every buy is simulated against the live pool, but nothing is sent.',
    live: s.network === 'testnet' ? 'testnet: every buy and burn here is a real transaction on robinhood chain testnet, in a uniswap v4 pool. pons is mainnet only.' : '',
  }[s.mode];
}

// ---------- wiring ----------
// ---------- the watch: jev's live state, as it happens ----------
let lastPhaseAt = 0;
let watchUntil = 0; // after a look ends, its outcome stays on the watch for a moment
let liveLookTs = null;
function showWatch(text, mode) {
  const w = $('watch');
  w.hidden = false;
  w.dataset.mode = mode;
  $('watch-text').innerHTML = text;
}
// live steps can arrive within a second of each other; each holds the watch long enough to be read
const HOLD = { thinking: 2200, fire: 1400, calm: 0, idle: 0 };
let watchQueue = Promise.resolve();
let watchBusy = 0;
function setWatch(text, mode, linger = 0) {
  watchBusy++;
  watchQueue = watchQueue
    .then(() => (showWatch(text, mode), new Promise((r) => setTimeout(r, still ? 0 : HOLD[mode] ?? 0))))
    .then(() => { watchBusy--; if (linger) watchUntil = Date.now() + linger; });
}
function onPhase(s) {
  const ph = s.phase;
  if (!ph || ph.at === lastPhaseAt) return;
  lastPhaseAt = ph.at;
  flow ??= createFlow({ fmtEth, fmtTok });
  if (['asking', 'decided', 'buying', 'burning'].includes(ph.name)) flow.live(ph);
  if (ph.name === 'asking') {
    liveLookTs = null;
    tree.moth.flick();
    setWatch('jev is thinking<i class="dots"><b>.</b><b>.</b><b>.</b></i>', 'thinking');
  } else if (ph.name === 'decided') {
    liveLookTs = ph.ts;
    const conf = ph.jev.confidence.toFixed(2);
    if (ph.reason) {
      tree.moth.excite();
      setWatch(ph.reason === 'heartbeat' ? 'heartbeat buy' : `jev said <b>buy</b> · ${conf}`, 'fire');
    } else {
      setWatch(`jev said <b>wait</b> · ${conf}`, 'calm', 4500);
    }
  } else if (ph.name === 'buying') setWatch(`buying · ${fmtEth(ph.amountEth)} eth`, 'fire');
  else if (ph.name === 'burning') setWatch('burning<i class="dots"><b>.</b><b>.</b><b>.</b></i>', 'fire');
}
function onLookLanded(s) {
  const d = s.decisions[0];
  if (!d || d.ts !== liveLookTs) return;
  liveLookTs = null;
  if (d.amountEth) setWatch(d.outcome === 'rehearsed' ? `rehearsed · ${fmtTok(d.tokens)} would burn` : d.outcome === 'failed' ? 'the chain refused. retrying' : `burned <b>${fmtTok(d.tokens)}</b>`, d.outcome === 'failed' ? 'calm' : 'fire', 6000);
}
// between looks the watch counts down to the next one, once the hero (which has its own countdown) is out of view
setInterval(() => {
  if (!state) return;
  const busy = (state.phase && state.phase.name !== 'idle') || watchBusy;
  if (busy || Date.now() < watchUntil) return;
  const left = Math.max(0, Math.round((state.nextLookAt - Date.now()) / 1000));
  const pastHero = scrollY > document.querySelector('.stage-wrap').offsetHeight - innerHeight * 0.5;
  if (!state.nextLookAt || state.mode === 'watch' || state.mode === 'standby' || !pastHero) return ($('watch').dataset.mode = 'gone');
  showWatch(left ? `jev looks again in ${left}s` : 'jev is about to look', 'idle');
}, 500);
$('watch').onclick = () => document.getElementById('flow').scrollIntoView({ behavior: 'smooth', block: 'center' });

function paint(s) {
  state = s;
  paintHero(s);
  paintReadouts(s);
  onPhase(s);
  paintMind(s);
  onLookLanded(s);
  paintLedger(s);
  paintSupply(s);
  paintColophon(s);
}

const io = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (!e.isIntersecting) return;
  e.target.classList.add('in');
  io.unobserve(e.target);
  if (e.target.classList.contains('table-wrap') && state) paintLedger(state);
}), { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

initMotion(tree);

const stream = new EventSource('/api/stream');
stream.onmessage = (e) => paint(JSON.parse(e.data));
stream.onerror = () => ($('status').textContent = 'lost the feed, reconnecting');
setInterval(() => state && paintLedger(state), 60000); // keep "5m ago" honest
