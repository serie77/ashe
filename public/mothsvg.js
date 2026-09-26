// ashe as an inline svg, from the same drawing as the hero moth and the coin image.
// strokes are non-scaling, so widths are in screen pixels and she stays crisp at any size.
import { buildMoth, FORE_PATH, HIND_PATH, BODY, HEAD } from './mothart.js';

const ART = buildMoth();
const seg = (v) => `M${v.x0.toFixed(2)} ${v.y0.toFixed(2)}L${v.x1.toFixed(2)} ${v.y1.toFixed(2)}`;

function veins(list, levels, cls) {
  const cold = new Map();
  let hot = '';
  for (const v of list) {
    if (v.heat) hot += seg(v); // the burning tips are always drawn, however few twigs the rest gets
    else if (v.level > levels) continue;
    else cold.set(v.level, (cold.get(v.level) ?? '') + seg(v));
  }
  return [...cold].map(([level, d]) => `<path class="mo-vein ${cls}" style="--l:${level}" d="${d}"/>`).join('') + (hot ? `<path class="mo-hot" d="${hot}"/>` : '');
}

// levels: how deep into the twigs to draw. outline: draw the wing edges. beat: let the wings move.
export function mothSvg({ levels = 7, outline = false, beat = false, cls = '' } = {}) {
  const side =
    (outline ? `<path class="mo-edge" d="${HIND_PATH}"/><path class="mo-edge" d="${FORE_PATH}"/>` : '') +
    `<g class="mo-veins">${veins(ART.hind, levels, 'hind')}${veins(ART.fore, levels, '')}</g>`;
  const antenna = `<path class="mo-vein" style="--l:3" d="${ART.antenna.map(seg).join('')}"/>`;
  const wing = (flip) => `<g${flip ? ' transform="scale(-1 1)"' : ''}><g class="${beat ? 'mo-beat' : ''}">${side}</g></g>`;
  return `<svg class="moth-svg ${cls}" viewBox="-26 -14.5 52 28.5" aria-hidden="true">${wing(false)}${wing(true)}
    <g>${antenna}</g><g transform="scale(-1 1)">${antenna}</g>
    <path class="mo-body" d="${BODY}"/><circle class="mo-body" cx="${HEAD[0]}" cy="${HEAD[1]}" r="${HEAD[2]}"/></svg>`;
}
