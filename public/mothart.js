// ashe's wings, grown the way the tree is: from a fixed seed, branching outward until they reach the wing's edge.
// units: body centre at the origin, wingspan about 44. everything here is the right-hand side; the left is its mirror.
// shared by the hero moth (canvas) and the coin image (svg), so they are the same drawing.

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// wing outlines as cubic béziers: [start, ...[c1, c2, end]]
const FORE = [[1, -2.7], [[5, -7.8], [14, -12.4], [24, -10.4]], [[22.8, -5.2], [17.6, -0.6], [11, 1.2]], [[7.4, 2], [3.6, 1.2], [1.1, -0.5]]];
const HIND = [[1.1, -0.2], [[5, 1.4], [10, 2.2], [11.6, 5.6]], [[12.8, 9.8], [9.6, 13.2], [6.2, 11.6]], [[3.9, 10], [2.1, 5.4], [1, 2.4]]];

export const BODY = 'M0 -4.8 C1.5 -3.4 1.6 3.4 0 12 C-1.6 3.4 -1.5 -3.4 0 -4.8 Z';
export const HEAD = [0, -5.5, 1];
export const outlinePath = (o) => `M${o[0][0]} ${o[0][1]} ` + o.slice(1).map((c) => `C${c.flat().join(' ')}`).join(' ') + ' Z';
export const FORE_PATH = outlinePath(FORE);
export const HIND_PATH = outlinePath(HIND);

function polygon(outline, steps = 28) {
  const pts = [];
  let p0 = outline[0];
  for (const [c1, c2, p3] of outline.slice(1)) {
    for (let i = 0; i < steps; i++) {
      const t = i / steps, u = 1 - t;
      pts.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]]);
    }
    p0 = p3;
  }
  return pts;
}
function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// one wing: veins fan out from the root and fork like branches, each stopping where it meets the wing's edge
function growWing(outline, root, fan, first, seed, levels) {
  const rand = rng(seed);
  const poly = polygon(outline);
  const segs = [];
  function grow(x, y, angle, len, level) {
    let ex = x + Math.cos(angle) * len, ey = y + Math.sin(angle) * len;
    let reached = false;
    if (!inside(poly, ex, ey)) {
      // pull the vein back until its tip sits just inside the edge
      let lo = 0, hi = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (inside(poly, x + Math.cos(angle) * len * mid, y + Math.sin(angle) * len * mid)) lo = mid; else hi = mid;
      }
      if (lo < 0.12) return;
      ex = x + Math.cos(angle) * len * lo;
      ey = y + Math.sin(angle) * len * lo;
      reached = true;
    }
    segs.push({ x0: x, y0: y, x1: ex, y1: ey, level, reach: Math.hypot(ex - root[0], ey - root[1]) });
    if (reached || level >= levels) return;
    const spread = 0.17 + rand() * 0.2;
    const shrink = 0.72 + rand() * 0.12;
    grow(ex, ey, angle - spread * (0.7 + rand() * 0.6), len * shrink, level + 1);
    grow(ex, ey, angle + spread * (0.7 + rand() * 0.6), len * shrink, level + 1);
  }
  const [a0, a1, count] = fan;
  for (let i = 0; i < count; i++) grow(root[0], root[1], a0 + ((a1 - a0) * i) / (count - 1) + (rand() - 0.5) * 0.05, first * (0.85 + rand() * 0.3), 0);
  const far = Math.max(...segs.map((s) => s.reach));
  for (const s of segs) s.heat = Math.max(0, (s.reach / far - 0.83) / 0.17); // the outer edge of the wing is alight
  return segs;
}

export function buildMoth() {
  const fore = growWing(FORE, [1.1, -1.6], [-0.92, 0.1, 5], 4.6, 7, 7);
  const hind = growWing(HIND, [1.1, 1], [0.16, 1.22, 4], 3.1, 19, 6).map((s) => ({ ...s, heat: 0 }));
  // feathered antenna: a curve with barbs, like a twig
  const antenna = [];
  let px = 0.5, py = -6.2;
  for (let i = 1; i <= 9; i++) {
    const t = i / 9, u = 1 - t;
    const x = u * u * u * 0.5 + 3 * u * u * t * 2.2 + 3 * u * t * t * 4.6 + t * t * t * 7.2;
    const y = u * u * u * -6.2 + 3 * u * u * t * -9.8 + 3 * u * t * t * -11.8 + t * t * t * -12.6;
    antenna.push({ x0: px, y0: py, x1: x, y1: y, level: 3, heat: 0 });
    if (i > 1) {
      const a = Math.atan2(y - py, x - px);
      const barb = 1.25 * (1 - t * 0.55);
      antenna.push({ x0: x, y0: y, x1: x + Math.cos(a - 1.15) * barb, y1: y + Math.sin(a - 1.15) * barb, level: 5, heat: 0 });
      antenna.push({ x0: x, y0: y, x1: x + Math.cos(a + 1.15) * barb * 0.7, y1: y + Math.sin(a + 1.15) * barb * 0.7, level: 5, heat: 0 });
    }
    px = x;
    py = y;
  }
  return { fore, hind, antenna };
}

// stroke width for a vein level, in moth units: thick limbs, fine twigs, like the tree
export const veinWidth = (level) => Math.max(0.085, 0.4 * Math.pow(0.7, level));
