// everything that moves because you scrolled or pointed. data lives in app.js, the tree in tree.js.
import { animate, onScroll, stagger, splitText } from './vendor/anime.esm.min.js';

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (min-width: 861px)').matches;
const $$ = (sel) => [...document.querySelectorAll(sel)];

// a 0..1 custom property on `el`, tied to how far `el` has travelled through the viewport
function scrub(el, enter, leave, smooth = 0.35) {
  return animate(el, { '--p': [0, 1], ease: 'linear', autoplay: onScroll({ target: el, enter, leave, sync: smooth }) });
}

export function initMotion(tree) {
  document.querySelector('.fuse').classList.add('on');
  fuse();
  ticker();
  scene(tree);
  if (still) return document.getElementById('card').classList.remove('armed');

  // the wordmark is forged letter by letter
  const brand = splitText('.brand-word', { chars: { class: 'ch' } });
  animate(brand.chars, {
    '--wght': [900, 400], '--soft': [100, 0], opacity: [0, 1], y: ['0.35em', 0], delay: stagger(110, { start: 150 }), duration: 1800, ease: 'out(4)',
    // hand the axes back to the stylesheet, which ties them to the scroll
    onComplete: () => brand.chars.forEach((c) => (c.style.removeProperty('--wght'), c.style.removeProperty('--soft'))),
  });

  // plate titles cool from molten to ink as they rise into view, one letter after another
  for (const h2 of $$('.plate-head h2')) {
    const { chars } = splitText(h2, { chars: { class: 'ch' } });
    animate(chars, {
      '--wght': [720, 300], '--soft': [100, 0], color: ['#ff6b2c', '#e8e0cf'], opacity: [0, 1], y: ['0.5em', 0], rotate: [6, 0],
      delay: stagger(60), duration: 900, ease: 'out(3)',
      autoplay: onScroll({ target: h2, enter: 'bottom-=6% top', leave: 'bottom-=46% bottom', sync: 0.5 }),
    });
  }

  // giant numerals drift behind their plates
  for (const g of $$('.ghost')) {
    animate(g, { y: ['-12vh', '34vh'], rotate: [-3, 2], ease: 'linear', autoplay: onScroll({ target: g.parentElement, enter: 'bottom top', leave: 'top bottom', sync: 0.6 }) });
  }

  scrub(document.querySelector('.chart'), 'bottom-=10% top', 'bottom-=55% bottom');
  scrub(document.querySelector('.log'), 'bottom-=10% top', 'bottom-=50% bottom');
  scrub(document.querySelector('.wordmark'), 'bottom-=5% top', 'bottom bottom', 0.5);
  scrub(document.querySelector('.colophon-moth'), 'bottom-=10% top', 'bottom-=55% bottom', 0.5);
  onScroll({ target: '.chart', enter: 'bottom-=55% bottom', onEnter: () => document.querySelector('.chart').classList.add('done') });

  // the verdict card plays itself in once: corners, word, gauge, bars, meters
  onScroll({ target: '#card', enter: 'bottom-=22% top', onEnter: () => document.getElementById('card').classList.remove('armed') });

  if (fine) pointer(tree);
}

// the pinned opening. the stage holds still for 160vh of scrolling while three things happen in turn:
// the hero lifts away, the camera pushes in on the crown, and the fire runs ahead of the chain to the end of the tree.
// then the plates slide over it. scrolling back up undoes all of it.
function scene(tree) {
  const stage = document.querySelector('.stage');
  const wrap = document.querySelector('.stage-wrap');
  const out = document.getElementById('proj-pct');
  const ramp = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));
  const smooth = (v) => v * v * (3 - 2 * v);
  const tick = () => {
    const pin = wrap.offsetHeight - innerHeight; // how long the stage stays pinned
    const s = ramp(scrollY, 0, pin);
    const proj = smooth(ramp(s, 0.22, 0.96));
    const cover = ramp(scrollY, pin, pin + innerHeight);
    stage.style.setProperty('--cover', cover.toFixed(3));
    tree.sleep(cover >= 1);
    if (still) return; // no pinned scene without motion: the plates simply follow the hero
    stage.style.setProperty('--lift', smooth(ramp(s, 0, 0.2)).toFixed(3));
    stage.style.setProperty('--proj', proj.toFixed(3));
    stage.style.setProperty('--show', (smooth(ramp(s, 0.2, 0.34)) * (1 - ramp(cover, 0, 0.5))).toFixed(3));
    // in on the crown while it catches, back out at the end so the last thing seen is the whole tree, spent
    const camera = smooth(ramp(s, 0.04, 0.5)) * (1 - 0.9 * smooth(ramp(s, 0.66, 0.96)));
    const burned = tree.scene(camera, proj);
    out.textContent = (burned * 100).toFixed(2);
  };
  tick();
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', tick);
}

// scroll progress burning down the right edge, with the plates marked along it
function fuse() {
  const el = document.querySelector('.fuse');
  const marks = $$('.fuse a').map((a) => ({ a, sec: document.getElementById(a.dataset.sec) }));
  const place = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    for (const m of marks) m.a.style.top = (Math.min(1, (m.sec.id === 'top' ? 0 : m.sec.getBoundingClientRect().top + scrollY) / max) * 100).toFixed(2) + '%';
  };
  const tick = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? scrollY / max : 0;
    el.style.setProperty('--p', p.toFixed(4));
    for (const m of marks) m.a.classList.toggle('lit', parseFloat(m.a.style.top) / 100 <= p + 0.002);
  };
  place();
  tick();
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', () => (place(), tick()));
  new ResizeObserver(() => (place(), tick())).observe(document.body);
}

// the band of recent burns. it idles along, and scrolling the page drags it faster in that direction.
let tickerWidth = 0;
function ticker() {
  const run = document.getElementById('ticker');
  let x = 0;
  let last = scrollY;
  let push = 0;
  const step = () => {
    push += (scrollY - last) * 0.35;
    last = scrollY;
    push *= 0.9;
    if (tickerWidth) {
      x -= (still ? 0 : 0.6) + push;
      x = ((x % tickerWidth) - tickerWidth) % tickerWidth;
      run.style.transform = `translate3d(${x.toFixed(1)}px,0,0) skewX(${Math.max(-10, Math.min(10, -push * 0.6)).toFixed(2)}deg)`;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function setTicker(items) {
  const run = document.getElementById('ticker');
  const html = items.map((t) => `<span>${t}</span><i>✦</i>`).join('');
  run.innerHTML = html.repeat(items.length < 6 ? 8 : 3);
  tickerWidth = run.scrollWidth / (items.length < 6 ? 8 : 3);
}

// the pointer is a draught: the tree leans away from it, the page warms under it, a click throws sparks
function pointer(tree) {
  const warm = document.querySelector('.warmth');
  const stage = document.querySelector('.stage');
  let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty, px = tx;
  addEventListener('pointermove', (e) => {
    tx = e.clientX;
    ty = e.clientY;
    warm.classList.add('on');
    if (e.target.closest('.stage')) tree.attract(tx, ty); // the pointer is warm, and ashe is a moth
  }, { passive: true });
  document.addEventListener('pointerleave', () => warm.classList.remove('on'));
  stage.addEventListener('pointerdown', (e) => tree.puff(e.clientX, e.clientY));
  (function follow() {
    x += (tx - x) * 0.12;
    y += (ty - y) * 0.12;
    warm.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    if (scrollY < innerHeight * 2.6) tree.wind((tx - px) * 0.0009);
    px += (tx - px) * 0.2;
    requestAnimationFrame(follow);
  })();
}
