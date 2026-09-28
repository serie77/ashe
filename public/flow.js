// the live diagram in "the mind": one look by jev, played as it happens.
// fees and the market stream into jev, the four answers come back, and either the gate opens
// and the pulse carries on through the buy to the burn, or it stays shut and the furnace holds.
const NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createFlow({ fmtEth, fmtTok }) {
  const layer = $('f-particles');
  const particles = [];
  let run = 0;
  let inView = false;
  let nextLookAt = 0;
  let intervalMs = 60000;
  let last = null; // the most recent decision, for the replay button and first sight

  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (inView && last && !layer.dataset.played) (layer.dataset.played = '1'), play(last);
  }, { threshold: 0.35 }).observe($('flow'));

  function emit(pathId, count, kind, stopAt = 1, spread = 700) {
    const path = $(pathId);
    const len = path.getTotalLength();
    for (let i = 0; i < count; i++) {
      const el = document.createElementNS(NS, 'circle');
      el.setAttribute('r', kind === 'ember' ? 2.6 : 1.8);
      if (kind === 'ember') el.setAttribute('class', 'ember');
      el.style.opacity = 0;
      layer.appendChild(el);
      particles.push({ el, path, len, t: -(i / count) * (spread / 1000), speed: 0.9 + Math.random() * 0.35, stopAt });
    }
  }

  let prev = performance.now();
  let ambient = 0;
  (function tick(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt * p.speed;
      if (p.t < 0) continue;
      if (p.t >= p.stopAt) {
        p.el.remove();
        particles.splice(i, 1);
        continue;
      }
      const pt = p.path.getPointAtLength(p.t * p.len);
      p.el.setAttribute('cx', pt.x);
      p.el.setAttribute('cy', pt.y);
      // a pulse that dies at the shut gate fades as it gets there
      p.el.style.opacity = p.stopAt < 1 ? Math.min(1, (p.stopAt - p.t) * 6) : 1;
    }
    if (inView && !still) {
      // between looks: fees trickle in, the market keeps talking
      ambient += dt;
      if (ambient > 1.3) {
        ambient = 0;
        emit('p-fees', 1, 'ember');
        emit('p-market', 1, 'ink');
      }
      const left = Math.max(0, nextLookAt - Date.now());
      $('f-count').style.strokeDashoffset = nextLookAt ? Math.min(1, left / intervalMs) : 1;
    }
    requestAnimationFrame(tick);
  })(prev);

  // synapses: short strokes round jev's ring that fire at random while it thinks
  {
    const g = $('f-synapse');
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + (i % 3) * 0.05;
      const r0 = 80 + (i % 4) * 3, r1 = r0 + 7 + (i % 5) * 3;
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', 600 + Math.cos(a) * r0); l.setAttribute('y1', 200 + Math.sin(a) * r0);
      l.setAttribute('x2', 600 + Math.cos(a) * r1); l.setAttribute('y2', 200 + Math.sin(a) * r1);
      l.style.setProperty('--d', `${((i * 7919) % 900) / 1000}s`);
      g.appendChild(l);
    }
  }

  // the thought line, typed out a character at a time
  const figure = $('flow');
  let typing = 0;
  async function type(text, speed = 14) {
    const my = ++typing;
    const el = $('f-cap');
    if (still) return (el.textContent = text);
    figure.classList.add('typing');
    for (let i = 1; i <= text.length; i++) {
      if (my !== typing) return;
      el.textContent = text.slice(0, i);
      await wait(speed);
    }
    if (my === typing) figure.classList.remove('typing');
  }
  const pct = (n) => (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const reading = (m, budget) => m ? `reading \u00b7 price ${pct(m.price_change_15m_pct)} in 15m, ${pct(m.vs_2h_high_pct)} from the 2h high \u00b7 ${fmtEth(m.last_15m.buys_eth)} eth bought, ${fmtEth(m.last_15m.sells_eth)} sold \u00b7 budget ${fmtEth(budget)} eth \u2192 buy now, or wait?` : 'reading the market \u2192 buy now, or wait?';

  const yesno = (v) => `${v >= 0.5 ? 'yes' : 'no'} · ${v.toFixed(2)}`;
  const sizeWord = (v) => (v < 0.67 ? 'a nibble' : v < 1.34 ? 'standard' : 'heavy');

  function reset() {
    for (const id of ['n-fees', 'n-furnace', 'n-market', 'n-buy', 'n-burn']) $(id).classList.remove('lit');
    for (const id of ['c-1', 'c-2', 'c-3', 'c-4']) $(id).classList.remove('lit', 'hot');
    for (const id of ['f-q1', 'f-q2', 'f-q3', 'f-q4']) $(id).textContent = '·';
    $('n-jev').classList.remove('buy', 'wait', 'thinking');
    $('n-gate').classList.remove('open', 'shut');
    $('f-verdict').textContent = 'looking';
    $('f-gate').textContent = 'the gate';
    $('f-buy').textContent = '·';
    $('f-burn').textContent = 'supply falls, for good';
  }

  // the four answers come back one by one, then the verdict. returns false if a newer run took over.
  async function reveal(d, alive, pace) {
    const buy = d.choice === 'buy_now';
    const answers = [
      ['c-1', 'f-q1', `${buy ? 'buy' : 'wait'} · ${d.confidence.toFixed(2)}`, buy],
      ['c-2', 'f-q2', `${sizeWord(d.size)} · ${d.size.toFixed(2)}`, false],
      ['c-3', 'f-q3', yesno(d.sellPressure), d.sellPressure >= 0.5],
      ['c-4', 'f-q4', yesno(d.chasing), d.chasing >= 0.5],
    ];
    for (const [chip, text, value, hot] of answers) {
      if (!alive()) return false;
      $(text).textContent = value;
      $(chip).classList.add('lit');
      if (hot) $(chip).classList.add('hot');
      await wait(190 * pace);
    }
    $('n-jev').classList.remove('thinking');
    figure.classList.remove('thinking');
    $('n-jev').classList.add(buy ? 'buy' : 'wait');
    $('f-verdict').textContent = buy ? 'buy' : 'wait';
    await wait(450 * pace);
    return alive();
  }

  // ---- live: the diagram follows the furnace step by step, as it happens ----
  let liveQueue = Promise.resolve();
  let liveTs = null; // the decision the diagram showed live, so it is not replayed when it lands
  let thinkingSince = 0;
  const MIN_THINK = 2200; // jev answers in about a second; hold the thought long enough to be seen
  function live(ph) {
    if (ph.name === 'asking') liveTs = 'pending';
    if (ph.name === 'decided') liveTs = ph.ts; // claimed now, so the stored decision landing a moment later is not replayed
    liveQueue = liveQueue.then(() => step(ph)).catch(() => {});
  }
  async function step(ph) {
    const pace = still ? 0 : 1;
    if (ph.name === 'asking') {
      const my = ++run;
      reset();
      thinkingSince = Date.now();
      figure.classList.add('thinking');
      type(reading(ph.market, ph.budgetEth));
      if (ph.budgetEth != null) $('f-budget').textContent = `budget · ${fmtEth(ph.budgetEth)} eth`;
      $('n-market').classList.add('lit');
      $('n-furnace').classList.add('lit');
      if (!still) (emit('p-market', 8, 'ink'), emit('p-furnace', 6, 'ember'), emit('p-fees', 4, 'ember'));
      $('n-jev').classList.add('thinking');
      $('f-verdict').textContent = 'thinking';
      step.run = my;
      return;
    }
    const alive = () => run === step.run;
    if (!alive()) return;
    if (ph.name === 'decided') {
      await wait(Math.max(0, thinkingSince + MIN_THINK - Date.now()) * pace);
      const d = { ...ph.jev, reason: ph.reason };
      if (!(await reveal(d, alive, pace))) return;
      layer.dataset.played = '1';
      if (!ph.reason) {
        if (!still) emit('p-jevbuy', 4, 'ink', 0.44, 300);
        await wait(520 * pace);
        $('n-gate').classList.add('shut');
        $('f-gate').textContent = 'shut · the furnace holds';
        type('jev said wait. the furnace holds, and looks again next minute.');
        return;
      }
      $('n-gate').classList.add('open');
      $('f-gate').textContent = ph.reason === 'heartbeat' ? 'open · heartbeat' : 'open';
      type(ph.reason === 'heartbeat' ? 'quiet too long. a small heartbeat buy is going through.' : `jev said buy, ${ph.jev.confidence.toFixed(2)} sure. the furnace is buying now.`);
      if (!still) emit('p-jevbuy', 10, 'ember');
      return;
    }
    if (ph.name === 'buying') {
      $('n-buy').classList.add('lit', 'pending');
      $('f-buy').textContent = `${fmtEth(ph.amountEth)} eth · sending`;
      return;
    }
    if (ph.name === 'burning') {
      $('n-buy').classList.remove('pending');
      $('f-buy').textContent = `${fmtEth(ph.amountEth)} eth in`;
      if (!still) emit('p-buyburn', 14, 'ember');
      await wait(900 * pace);
      $('n-burn').classList.add('lit', 'pending');
      $('f-burn').textContent = 'burning';
      type('bought. burning it now.');
    }
  }

  async function play(d, note) {
    const my = ++run;
    const alive = () => my === run;
    const pace = still ? 0 : 1;
    reset();
    type(note ? `${note} ${reading(d.market, d.budgetEth)}` : reading(d.market, d.budgetEth));
    $('n-market').classList.add('lit');
    $('n-furnace').classList.add('lit');
    if (!still) (emit('p-market', 8, 'ink'), emit('p-furnace', 6, 'ember'), emit('p-fees', 4, 'ember'));
    await wait(1000 * pace);
    if (!alive()) return;
    $('n-jev').classList.add('thinking');
    figure.classList.add('thinking');
    await wait(1400 * pace);

    if (!(await reveal(d, alive, pace))) return;

    const acted = d.outcome === 'burned' || d.outcome === 'rehearsed';
    if (!acted) {
      if (!still) emit('p-jevbuy', 4, 'ink', 0.44, 300);
      await wait(520 * pace);
      if (!alive()) return;
      $('n-gate').classList.add('shut');
      $('f-gate').textContent = d.outcome === 'failed' ? 'the chain refused' : 'shut · the furnace holds';
      type(d.outcome === 'failed' ? 'the buy was attempted and the chain refused it. it will try again.' : d.choice === 'buy_now' ? 'jev leaned buy, but not firmly enough. the furnace holds.' : 'jev said wait. the furnace holds, and looks again next minute.');
      return;
    }
    $('n-gate').classList.add('open');
    $('f-gate').textContent = d.reason === 'heartbeat' ? 'open · heartbeat' : 'open';
    if (!still) emit('p-jevbuy', 10, 'ember');
    await wait(1050 * pace);
    if (!alive()) return;
    $('n-buy').classList.add('lit');
    $('f-buy').textContent = `${fmtEth(d.amountEth)} eth in`;
    if (!still) emit('p-buyburn', 14, 'ember');
    await wait(1100 * pace);
    if (!alive()) return;
    $('n-burn').classList.add('lit');
    $('f-burn').textContent = `${fmtTok(d.tokens)} burned`;
    type(d.outcome === 'rehearsed'
      ? 'rehearsal: jev was asked for real and the buy was simulated against the live pool. nothing was sent.'
      : 'bought and burned. the transactions are in the ledger.');
  }

  $('f-replay').onclick = () => last && play(last, 'replaying the last look.');

  return {
    // called on every state update
    update(state) {
      nextLookAt = state.nextLookAt;
      if (state.rules) intervalMs = state.rules.intervalSec * 1000;
      const d = state.decisions[0];
      $('f-budget').textContent = d ? `budget · ${fmtEth(d.budgetEth)} eth` : 'budget ·';
      $('f-market').textContent = state.token ? `${state.token.phase === 'curve' ? 'pons curve' : 'uniswap v4'} · two hours of trades` : 'price · two hours of trades';
      if (!d) return;
      const fresh = !last || d.ts !== last.ts;
      last = d;
      if (d.ts === liveTs) {
        if (fresh && d.amountEth) liveQueue = liveQueue.then(() => {
          $('n-burn').classList.remove('pending');
          $('f-buy').textContent = `${fmtEth(d.amountEth)} eth in`;
          $('f-burn').textContent = `${fmtTok(d.tokens)} burned`;
          $('f-cap').textContent = d.outcome === 'rehearsed' ? 'rehearsal: jev was asked for real and the buy was simulated against the live pool. nothing was sent.' : d.outcome === 'failed' ? 'the buy was attempted and the chain refused it. it will try again.' : 'bought and burned. the transactions are in the ledger below.';
        });
        return;
      }
      if (inView && (fresh || !layer.dataset.played)) (layer.dataset.played = '1'), play(d);
      else if (fresh) delete layer.dataset.played; // it will play when it scrolls into view
    },
    play,
    live,
  };
}
