// the ash tree. grown once from a fixed seed, burned from the tips inward in proportion to supply burned.
import { createMoth } from './moth.js';

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createTree(canvas, { onCatch } = {}) {
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = () => innerWidth < 860;
  const rand = rng(23);
  const LEVELS = small() ? 9 : 10;
  const GROW_MS = 3400;
  const nodes = [];

  function grow(parent, level, len, rel, chain) {
    const n = { parent, level, len, kids: [], phase: rand() * TAU, a: 0, x: 0, y: 0, px: 0, py: 0, g: 0 };
    // branches reach for light: steep angles are pulled back toward vertical
    n.rest = ((parent ? parent.rest : 0) + rel) * 0.93;
    n.rel = n.rest - (parent ? parent.rest : 0);
    n.dist0 = parent ? parent.dist0 + parent.len : 0;
    nodes.push(n);
    parent?.kids.push(n);
    if (chain > 0) return grow(n, level, len * 0.92, (rand() - 0.5) * 0.18, chain - 1);
    if (level >= LEVELS || len < 0.011) return;
    const count = level > 0 && level < 7 && rand() < 0.22 ? 3 : 2;
    const spread = 0.34 + rand() * 0.26;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1) - 0.5;
      grow(n, level + 1, len * (0.72 + rand() * 0.12), t * 2 * spread * (0.75 + rand() * 0.5) + (rand() - 0.5) * 0.2, 0);
    }
  }
  grow(null, 0, 0.2, 0, 2);

  // rest pose, bounds, and the order things burn in
  const box = { x0: 0, x1: 0, y0: 0 };
  let maxDist = 0;
  for (const n of nodes) {
    const p = n.parent;
    n.rx = (p ? p.rx : 0) + Math.sin(n.rest) * n.len;
    n.ry = (p ? p.ry : 0) - Math.cos(n.rest) * n.len;
    box.x0 = Math.min(box.x0, n.rx);
    box.x1 = Math.max(box.x1, n.rx);
    box.y0 = Math.min(box.y0, n.ry);
    maxDist = Math.max(maxDist, n.dist0 + n.len);
  }
  // fire starts high on the right and a limb only goes once everything it carries is gone
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    n.key = n.kids.length ? Math.max(...n.kids.map((k) => k.key)) + 1e-4 : -(-n.ry * 0.8 + n.rx * 0.7) + rand() * 0.16;
  }
  const order = [...nodes].sort((a, b) => a.key - b.key);
  const totalLen = nodes.reduce((s, n) => s + n.len, 0);
  const byLevel = Array.from({ length: LEVELS + 1 }, (_, l) => nodes.filter((n) => n.level === l));
  let acc = 0;
  for (const n of order) n.burnAt = (acc += n.len) / totalLen;

  // where the crown sits, in tree units: the camera pushes in on it as the page scrolls
  const leaves = nodes.filter((n) => !n.kids.length);
  const crownX = leaves.reduce((s, n) => s + n.rx, 0) / leaves.length;
  const crownY = leaves.reduce((s, n) => s + n.ry, 0) / leaves.length;

  let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
  const wide = { scale: 1, ox: 0, oy: 0 }; // the plate as first seen
  const close = { scale: 1, ox: 0, oy: 0 }; // pushed in on the crown
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const top = small() ? 330 : H * 0.025;
    wide.oy = small() ? H - 180 : H - Math.max(100, H * 0.12);
    wide.ox = small() ? W * 0.5 : W * 0.655;
    const targetW = small() ? W * 0.94 : W * 0.62;
    wide.scale = Math.min((wide.oy - top) / -box.y0, targetW / (box.x1 - box.x0));
    close.scale = wide.scale * (small() ? 1.5 : 1.7);
    close.ox = W * (small() ? 0.5 : 0.63) - crownX * close.scale;
    close.oy = H * (small() ? 0.5 : 0.56) - crownY * close.scale;
  }
  resize();
  addEventListener('resize', resize);

  // ashe's branch: a limb low on the left of the crown, the side the fire reaches last
  const perchNode = nodes.filter((n) => n.level === 4).reduce((a, b) => (b.rx < a.rx ? b : a));
  const moth = createMoth();
  let pointer = null; // last place the pointer was, and when
  let pointerAt = 0;

  const embers = [];
  const flakes = [];
  const rings = [];
  let target = 0; // burned fraction we are heading to
  let shown = 0; // burned fraction on screen
  let pulse = 0;
  let cam = 0; // 0 = the whole plate, 1 = close on the crown
  let camTo = 0;
  let fore = 0; // how far the page has scrolled into the projection, 0..1
  let gust = 0; // the pointer's draught, eased
  let gustTo = 0;
  let caught = still;
  const t0 = performance.now();
  const anchors = { crown: [0, 0], trunk: [0, 0], ash: [0, 0], species: [0, 0], moth: [0, 0], mothMode: 'perch', ready: false };

  let asleep = false;
  function frame(now) {
    if (asleep) return;
    const T = now - t0;
    const t = still ? 0 : now / 1000;
    const reach = still ? maxDist : easeOut(T / GROW_MS) * maxDist;
    if (!caught && T > GROW_MS * 0.86) {
      caught = true;
      onCatch?.();
    }
    // scrolling runs the fire forward from where the chain really is toward the end of the tree
    const goal = target + (1 - target) * fore;
    if (caught) shown += (goal - shown) * (still ? 1 : fore > 0 || shown > target + 0.002 ? 0.12 : 0.018);
    pulse *= 0.986;
    cam += (camTo - cam) * (still ? 1 : 0.1);
    scale = wide.scale + (close.scale - wide.scale) * cam;
    ox = wide.ox + (close.ox - wide.ox) * cam;
    oy = wide.oy + (close.oy - wide.oy) * cam;
    gust += (gustTo - gust) * 0.07;
    gustTo *= 0.9;

    // pose
    const px = (n) => ox + n * scale;
    for (const n of nodes) {
      const p = n.parent;
      const sway = still ? 0 : Math.sin(t * 0.8 + n.rx * 3) * 0.0055 + Math.sin(t * 1.9 + n.phase) * 0.0026;
      n.a = (p ? p.a : 0) + n.rel + sway + gust * (n.level ? 0.3 : 0.04);
      n.g = clamp((reach - n.dist0) / n.len);
      n.px = p ? p.x : 0;
      n.py = p ? p.y : 0;
      n.x = n.px + Math.sin(n.a) * n.len * n.g;
      n.y = n.py - Math.cos(n.a) * n.len * n.g;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';

    // ground line, and the ash that has settled on it
    const gw = (box.x1 - box.x0) * scale * 0.75;
    ctx.strokeStyle = 'rgba(232,224,207,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox - gw, oy + 0.5);
    ctx.lineTo(ox + gw, oy + 0.5);
    for (let i = -6; i <= 6; i++) {
      ctx.moveTo(ox + (i * gw) / 6.5, oy);
      ctx.lineTo(ox + (i * gw) / 6.5, oy + (i % 3 === 0 ? 7 : 4));
    }
    ctx.stroke();
    if (shown > 0) {
      const pw = gw * (0.25 + 0.75 * Math.sqrt(shown));
      const pile = ctx.createRadialGradient(ox + gw * 0.2, oy, 0, ox + gw * 0.2, oy, pw);
      pile.addColorStop(0, 'rgba(150,142,128,0.30)');
      pile.addColorStop(1, 'rgba(150,142,128,0)');
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, oy);
      ctx.clip();
      ctx.translate(0, oy);
      ctx.scale(1, 0.09 + shown * 0.25);
      ctx.translate(0, -oy);
      ctx.fillStyle = pile;
      ctx.fillRect(ox - gw * 2, oy - pw, gw * 4, pw * 2);
      ctx.restore();
    }

    // standing wood and cold char, batched by level
    const edge = 0.018 + pulse * 0.03;
    const hot = [];
    const width = (n) => Math.max(0.55, 8.5 * Math.pow(0.66, n.level) * (scale / 620));
    for (let level = 0; level <= LEVELS; level++) {
      for (const burned of [false, true]) {
        ctx.beginPath();
        let any = false;
        for (const n of byLevel[level]) {
          if (n.g <= 0) continue;
          const isBurned = shown >= n.burnAt;
          if (isBurned && shown - n.burnAt < edge) {
            if (!burned) hot.push(n);
            continue;
          }
          if (isBurned !== burned) continue;
          ctx.moveTo(px(n.px), oy + n.py * scale);
          ctx.lineTo(px(n.x), oy + n.y * scale);
          any = true;
        }
        if (!any) continue;
        ctx.lineWidth = width({ level }) * (burned ? 0.8 : 1);
        ctx.strokeStyle = burned ? 'rgba(109,102,91,0.5)' : `rgba(232,224,207,${0.95 - level * 0.035})`;
        ctx.stroke();
      }
    }

    // the burning edge
    let cx = -1e9, cy = 0, fx = 0, fy = 0;
    for (const n of hot) {
      const heat = 1 - (shown - n.burnAt) / edge;
      const flick = still ? 0.85 : 0.62 + 0.38 * Math.sin(t * 9 + n.phase * 5);
      const k = clamp(heat * flick + pulse * 0.5);
      const x = px(n.x), y = oy + n.y * scale;
      ctx.shadowColor = '#ff6b2c';
      ctx.shadowBlur = 6 + 14 * k;
      ctx.strokeStyle = `rgb(255,${Math.round(107 + 100 * k)},${Math.round(44 + 70 * k)})`;
      ctx.lineWidth = width(n) + 0.5 + k * 0.7;
      ctx.beginPath();
      ctx.moveTo(px(n.px), oy + n.py * scale);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (x > cx) (cx = x), (cy = y);
      fx += x;
      fy += y;
      if (!still && embers.length < (small() ? 110 : 240) * (1 + fore) && Math.random() < 0.012 * (1 + pulse * 9 + fore * 2.5)) {
        embers.push({ x, y, vx: 0.15 + Math.random() * 0.35, vy: -(0.35 + Math.random() * 0.8), life: 0, max: 110 + Math.random() * 150, r: (0.7 + Math.random() * 1.2) * (small() ? 0.7 : 1), ph: Math.random() * TAU });
      }
    }
    ctx.shadowBlur = 0;

    if (!still && shown > 0 && flakes.length < 70 && Math.random() < 0.07) {
      const n = order[Math.floor(Math.random() * order.length * shown)];
      if (n) flakes.push({ x: px(n.x), y: oy + n.y * scale, vy: 0.22 + Math.random() * 0.32, life: 0, max: 380 + Math.random() * 300, r: 0.6 + Math.random() * 0.9, ph: Math.random() * TAU });
    }
    for (let i = flakes.length - 1; i >= 0; i--) {
      const f = flakes[i];
      f.life++;
      f.x += Math.sin(f.life * 0.02 + f.ph) * 0.35 + 0.08;
      f.y += f.vy;
      if (f.life > f.max || f.y > oy) { flakes.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(190,182,168,${0.4 * Math.sin((f.life / f.max) * Math.PI)})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, TAU);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'lighter';
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.life++;
      e.vy -= 0.004;
      e.x += e.vx + Math.sin(e.life * 0.05 + e.ph) * 0.4;
      e.y += e.vy;
      if (e.life > e.max) { embers.splice(i, 1); continue; }
      const a = Math.sin((e.life / e.max) * Math.PI);
      ctx.fillStyle = `rgba(255,120,50,${0.1 * a})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * 4.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `rgba(255,${170 + Math.round(60 * a)},110,${0.95 * a})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, TAU);
      ctx.fill();
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += 3.2;
      r.a *= 0.972;
      if (r.a < 0.01) { rings.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(255,120,50,${r.a})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ashe
    moth.update({
      ready: T > GROW_MS * 0.9 || still,
      perch: shown < perchNode.burnAt - 0.01 ? [px(perchNode.x), oy + perchNode.y * scale] : null,
      fire: hot.length ? [fx / hot.length, fy / hot.length] : null,
      pointer: pointer && now - pointerAt < 3500 ? pointer : null,
      projection: fore,
      size: clamp(scale / 400, 1.1, 3),
      t,
      W,
    });
    moth.draw(ctx, clamp(scale / 400, 1.1, 3));

    // where the plate's annotations hang
    const tip = order[0];
    anchors.crown = hot.length ? [cx, cy] : [px(tip.x), oy + tip.y * scale];
    anchors.trunk = [px(nodes[1].x) + width(nodes[1]) / 2, oy + nodes[1].y * scale];
    anchors.ash = [ox + gw * 0.55, oy - 5];
    anchors.species = [ox - gw, oy - 18];
    anchors.moth = [moth.state.x, moth.state.y];
    anchors.mothMode = moth.state.perched ? 'perched' : moth.state.mode;
    anchors.ready = T > GROW_MS || still;

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    anchors,
    moth,
    // something warm is moving over the stage
    attract(x, y) {
      pointer = [x, y];
      pointerAt = performance.now();
    },
    // stop drawing while the stage is scrolled out of sight
    sleep(on) {
      if (on === asleep) return;
      asleep = on;
      if (!on) requestAnimationFrame(frame);
    },
    setBurned(fraction) {
      target = clamp(fraction);
    },
    // scroll drives two things: the camera pushing in, and the fire running ahead of the chain.
    // returns the fraction of the tree the projection shows as burned.
    scene(camera, projection) {
      camTo = clamp(camera);
      fore = clamp(projection);
      return target + (1 - target) * fore;
    },
    // the pointer moved: lean away from it
    wind(v) {
      gustTo = clamp(gustTo + v, -0.045, 0.045);
    },
    // a click on the stage throws a handful of sparks
    puff(x, y) {
      if (still) return;
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * TAU;
        const v = 0.4 + Math.random() * 1.6;
        embers.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.6, life: 0, max: 60 + Math.random() * 90, r: 0.6 + Math.random() * 1.3, ph: Math.random() * TAU });
      }
      rings.push({ x, y, r: 2, a: 0.6 });
    },
    // a burn just landed
    flare() {
      pulse = 1;
      const [x, y] = anchors.crown;
      rings.push({ x, y, r: 6, a: 0.9 }, { x, y, r: 0, a: 0.5 });
    },
  };
}
