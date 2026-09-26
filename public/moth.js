// ashe. the moth that lives in the tree. it rests while jev waits, comes to a warm pointer,
// and goes to the fire when jev buys. her wings are grown like the tree's crown, and burn at the tips.
import { buildMoth, veinWidth, BODY, HEAD } from './mothart.js';

const TAU = Math.PI * 2;
const ART = buildMoth();

export function createMoth() {
  const m = { x: -60, y: -60, vx: 0, vy: 0, heading: 0, flap: 0, open: 0.3, orbit: Math.random() * TAU, perched: false, born: false, excited: 0, flick: 0, mode: 'perch' };

  // env: { ready, perch:[x,y]|null, fire:[x,y]|null, pointer:[x,y]|null, projection:0..1, size, t, W }
  function update(env) {
    if (!env.ready) return;
    if (!m.born) {
      m.born = true;
      m.x = env.W * 0.42;
      m.y = -30;
      m.vy = 1.5;
    }
    if (m.excited > 0) m.excited--;
    if (m.flick > 0) m.flick--;

    let target = null;
    let radius = 0;
    if (m.excited > 0 && env.fire) (target = env.fire), (radius = 20), (m.mode = 'fire');
    else if (env.pointer) (target = env.pointer), (radius = 34), (m.mode = 'pointer');
    else if (env.projection > 0.03 && env.fire) (target = env.fire), (radius = 38), (m.mode = 'fire');
    else if (env.perch) (target = env.perch), (m.mode = 'perch');
    else if (env.fire) (target = env.fire), (radius = 46), (m.mode = 'fire');
    if (!target) return;

    const s = env.size;
    if (m.mode === 'perch') {
      const d = Math.hypot(target[0] - m.x, target[1] - m.y);
      if (m.perched || d < 5) {
        // settled: ride the branch, wings nearly closed, breathing
        m.perched = true;
        m.x = target[0];
        m.y = target[1];
        m.vx = m.vy = 0;
        m.heading += (-Math.PI / 2 - 0.35 - m.heading) * 0.1;
        const rest = 0.52 + 0.1 * Math.sin(env.t * 1.3) + (m.flick > 0 ? 0.4 * Math.abs(Math.sin(m.flick * 0.45)) : 0);
        m.open += (rest - m.open) * 0.25;
        return;
      }
    } else m.perched = false;

    m.orbit += 0.04 + 0.02 * Math.sin(env.t * 0.7);
    const gx = target[0] + Math.cos(m.orbit) * radius * s;
    const gy = target[1] + Math.sin(m.orbit * 1.3) * radius * s * 0.7;
    const hurry = m.excited > 0 ? 1.8 : 1;
    m.vx += (gx - m.x) * 0.0045 * hurry - m.vx * 0.06 + Math.sin(env.t * 3.1) * 0.05;
    m.vy += (gy - m.y) * 0.0045 * hurry - m.vy * 0.06 + Math.cos(env.t * 2.3) * 0.05;
    const speed = Math.hypot(m.vx, m.vy);
    const cap = 5 * s * hurry;
    if (speed > cap) (m.vx *= cap / speed), (m.vy *= cap / speed);
    m.x += m.vx;
    m.y += m.vy;
    if (speed > 0.15) {
      let turn = Math.atan2(m.vy, m.vx) - m.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      m.heading += turn * 0.18;
    }
    m.flap += 0.55 + speed * 0.06;
    m.open = 0.14 + 0.86 * (0.5 + 0.5 * Math.sin(m.flap));
  }

  // the drawing itself lives in mothart.js, shared with the coin image. here it is turned into canvas paths once.
  const seg = (v) => `M${v.x0.toFixed(2)} ${v.y0.toFixed(2)}L${v.x1.toFixed(2)} ${v.y1.toFixed(2)}`;
  const byLevel = (list) => {
    const levels = new Map();
    for (const v of list) if (!v.heat) levels.set(v.level, (levels.get(v.level) ?? '') + seg(v));
    return [...levels].map(([level, d]) => [level, new Path2D(d)]);
  };
  const fore = byLevel(ART.fore);
  const hind = byLevel(ART.hind);
  const alight = new Path2D(ART.fore.filter((v) => v.heat).map(seg).join(''));
  const antenna = new Path2D(ART.antenna.map(seg).join(''));
  const body = new Path2D(BODY);

  function draw(ctx, size) {
    if (!m.born) return;
    const thin = 0.5 / size; // never finer than half a pixel on screen, however small she is drawn
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.heading + Math.PI / 2);
    ctx.scale(size, size);
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side * m.open, 1);
      for (const [wing, alpha] of [[hind, 0.6], [fore, 1]]) {
        for (const [level, path] of wing) {
          ctx.strokeStyle = `rgba(232,224,207,${(alpha * (0.95 - level * 0.06)).toFixed(2)})`;
          ctx.lineWidth = Math.max(veinWidth(level), thin);
          ctx.stroke(path);
        }
      }
      // the wingtips are alight, brighter when she is at the fire
      ctx.strokeStyle = '#ff8a3c';
      ctx.shadowColor = '#ff6b2c';
      ctx.shadowBlur = m.mode === 'fire' ? 14 : 7;
      ctx.lineWidth = Math.max(0.16, thin);
      ctx.stroke(alight);
      ctx.shadowBlur = 0;
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(232,224,207,0.85)';
    ctx.lineWidth = Math.max(0.13, thin);
    ctx.stroke(antenna);
    ctx.save();
    ctx.scale(-1, 1);
    ctx.stroke(antenna);
    ctx.restore();
    ctx.fillStyle = '#e8e0cf';
    ctx.fill(body);
    ctx.beginPath();
    ctx.arc(HEAD[0], HEAD[1], HEAD[2], 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  return {
    state: m,
    update,
    draw,
    // jev bought: go to the fire
    excite() {
      m.excited = 520;
      m.perched = false;
    },
    // jev looked and waited: a twitch of the wings
    flick() {
      m.flick = 42;
    },
  };
}
