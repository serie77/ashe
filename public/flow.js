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

  async function play(d, note) {
    const my = ++run;
    const alive = () => my === run;
    const pace = still ? 0 : 1;
    reset();
    $('f-cap').textContent = note || 'live. jev is looking right now.';
    $('n-market').classList.add('lit');
    $('n-furnace').classList.add('lit');
    if (!still) (emit('p-market', 8, 'ink'), emit('p-furnace', 6, 'ember'), emit('p-fees', 4, 'ember'));
    await wait(1000 * pace);
    if (!alive()) return;
    $('n-jev').classList.add('thinking');
    await wait(650 * pace);

    const buy = d.choice === 'buy_now';
    const answers = [
      ['c-1', 'f-q1', `${buy ? 'buy' : 'wait'} · ${d.confidence.toFixed(2)}`, buy],
      ['c-2', 'f-q2', `${sizeWord(d.size)} · ${d.size.toFixed(2)}`, false],
      ['c-3', 'f-q3', yesno(d.sellPressure), d.sellPressure >= 0.5],
      ['c-4', 'f-q4', yesno(d.chasing), d.chasing >= 0.5],
    ];
    for (const [chip, text, value, hot] of answers) {
      if (!alive()) return;
      $(text).textContent = value;
      $(chip).classList.add('lit');
      if (hot) $(chip).classList.add('hot');
      await wait(190 * pace);
    }
    $('n-jev').classList.remove('thinking');
    $('n-jev').classList.add(buy ? 'buy' : 'wait');
    $('f-verdict').textContent = buy ? 'buy' : 'wait';
    await wait(450 * pace);
    if (!alive()) return;

    const acted = d.outcome === 'burned' || d.outcome === 'rehearsed';
    if (!acted) {
      if (!still) emit('p-jevbuy', 4, 'ink', 0.44, 300);
      await wait(520 * pace);
      if (!alive()) return;
      $('n-gate').classList.add('shut');
      $('f-gate').textContent = d.outcome === 'failed' ? 'the chain refused' : 'shut · the furnace holds';
      $('f-cap').textContent = d.outcome === 'failed' ? 'the buy was attempted and the chain refused it. it will try again.' : 'jev said wait, so nothing was bought. it looks again in a minute.';
      return;
    }
    $('n-gate').classList.add('open');
    $('f-gate').textContent = d.reason === 'heartbeat' ? 'open · heartbeat' : 'open';
    if (!still) emit('p-jevbuy', 10, 'ember');
    await wait(1050 * pace);
    if (!alive()) return;
    $('n-buy').classList.add('lit');
    $('f-buy').textContent = `${fmtEth(d.amountEth)} sol in`;
    if (!still) emit('p-buyburn', 14, 'ember');
    await wait(1100 * pace);
    if (!alive()) return;
    $('n-burn').classList.add('lit');
    $('f-burn').textContent = `${fmtTok(d.tokens)} burned`;
    $('f-cap').textContent = d.outcome === 'rehearsed'
      ? 'rehearsal: jev was asked for real and the buy was simulated against the live pool. nothing was sent.'
      : 'bought and burned. the transactions are in the ledger below.';
  }

  $('f-replay').onclick = () => last && play(last, 'replaying the last look.');

  return {
    // called on every state update
    update(state) {
      nextLookAt = state.nextLookAt;
      if (state.rules) intervalMs = state.rules.intervalSec * 1000;
      const d = state.decisions[0];
      $('f-budget').textContent = d ? `budget · ${fmtEth(d.budgetEth)} sol` : 'budget ·';
      $('f-market').textContent = state.token ? `${state.token.phase === 'curve' ? 'pump.fun curve' : 'pumpswap'} · two hours of trades` : 'price · two hours of trades';
      if (!d) return;
      const fresh = !last || d.ts !== last.ts;
      last = d;
      if (inView && (fresh || !layer.dataset.played)) (layer.dataset.played = '1'), play(d);
      else if (fresh) delete layer.dataset.played; // it will play when it scrolls into view
    },
    play,
  };
}
