'use strict';
/* Regression test for plotly.js#7955 — deep-zoom line/marker alignment.

   Under a deep zoom the visible range is a tiny sliver of the data bounds.
   regl-line2d previously normalized vertex positions against the static data
   BOUNDS, so the bounds-normalized coordinates sat far outside 0..1 and the
   float32 shader projection suffered catastrophic cancellation: drawn lines
   drifted away from markers rendered by regl-scatter2d (which uses range-based
   coordinates). The fix normalizes against the view RANGE instead.

   This test re-implements the exact float32 pipeline (array-normalize +
   to-float32, mirroring index.js verbatim) and asserts that, at every tested
   zoom depth, the patched (range-normalized) line tracks the marker centre
   while the old bounds-normalized path drifts — proving the assertion is
   discriminating, not trivially passing. This is the same analysis dy
   validated on the PR; here it is promoted to a runnable test.

   Run: node test/range-normalize.js
*/

const path = require('path');
const NM = path.resolve(__dirname, '..', 'node_modules');
const test = require('tape');
const normalize = require('array-normalize');
const { float32, fract32 } = require('to-float32');

const f32 = Math.fround;
const fract = (x) => f32(x - f32(x));

// plotly.js#7955-style data
const xs = [1, 5, 10];
const ys = [14e-6, 15e-6, 12e-6];
const minX = Math.min(...xs), maxX = Math.max(...xs);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const spanX = maxX - minX, spanY = maxY - minY;
const VP = 1000, PX = VP / 2; // px per NDC unit

function positionsArr() {
  return new Float64Array([xs[0], ys[0], xs[1], ys[1], xs[2], ys[2]]);
}

// index.js rect shader project(), f32-exact
function lineProject(px, py, pfx, pfy, u) {
  return [
    f32(f32(f32(f32(f32(px * u.scale[0]) + u.translate[0]) +
        f32(pfx * u.scale[0])) + u.translateFract[0]) +
        f32(f32(px * u.scaleFract[0]) + f32(pfx * u.scaleFract[0]))),
    f32(f32(f32(f32(f32(py * u.scale[1]) + u.translate[1]) +
        f32(pfy * u.scale[1])) + u.translateFract[1]) +
        f32(f32(py * u.scaleFract[1]) + f32(pfy * u.scaleFract[1])))
  ];
}
// regl-scatter2d grouped projection, f32-exact
function markerProject(px, py, mU) {
  return [
    f32(f32(f32(f32(px + mU.translate[0]) * mU.scale[0]) +
        f32(mU.translateFract[0] * mU.scale[0])) +
        f32((px + mU.translate[0]) * mU.scaleFract[0])) +
        f32(mU.translateFract[0] * mU.scaleFract[0]),
    f32(f32(f32(f32(py + mU.translate[1]) * mU.scale[1]) +
        f32(mU.translateFract[1] * mU.scale[1])) +
        f32((py + mU.translate[1]) * mU.scaleFract[1])) +
        f32(mU.translateFract[1] * mU.scaleFract[1])
  ];
}
function markerUniforms(range) {
  const sF64 = [1 / (range[2] - range[0]), 1 / (range[3] - range[1])];
  const tF64 = [-range[0], -range[1]];
  return {
    scale: float32(sF64), translate: float32(tF64),
    scaleFract: [fract(sF64[0]), fract(sF64[1])],
    translateFract: [fract(tF64[0]), fract(tF64[1])]
  };
}
// norm-basis selection. rangeNorm=true -> patched; false -> old bounds path.
function computeNormBounds(state, o, rangeNorm) {
  let normBounds = state.bounds;
  if (rangeNorm) {
    const targetRange = o.range || state.range;
    if (targetRange) {
      normBounds = targetRange.slice();
      if (!(normBounds[2] > normBounds[0])) normBounds[2] = normBounds[0] + 1e-155;
      if (!(normBounds[3] > normBounds[1])) normBounds[3] = normBounds[1] + 1e-155;
    }
  }
  state.normBounds = normBounds;
  return normBounds;
}
// index.js scale/translate block
function computeUniforms(state, range) {
  const bounds = state.bounds;
  const rangeW = range[2] - range[0], rangeH = range[3] - range[1];
  let scale, translate;
  if (state.rangeBasis && state.normBounds) {
    const nbW = state.normBounds[2] - state.normBounds[0],
      nbH = state.normBounds[3] - state.normBounds[1];
    scale = [nbW / rangeW, nbH / rangeH];
    translate = [
      -range[0] / rangeW + state.normBounds[0] / rangeW || 0,
      -range[1] / rangeH + state.normBounds[1] / rangeH || 0
    ];
  } else {
    const boundsW = bounds[2] - bounds[0], boundsH = bounds[3] - bounds[1];
    scale = [boundsW / rangeW, boundsH / rangeH];
    translate = [
      -range[0] / rangeW + bounds[0] / rangeW || 0,
      -range[1] / rangeH + bounds[1] / rangeH || 0
    ];
  }
  return {
    scale: float32(scale),
    translate: float32(translate),
    scaleFract: [fract(scale[0]), fract(scale[1])],
    translateFract: [fract(translate[0]), fract(translate[1])]
  };
}
// zoom onto point k; range-only drag path. Returns line/marker gap in px.
function gapAtPoint(k, zfEnd, rangeNorm) {
  const cx = xs[k], cy = ys[k];
  const mkRange = (zf) => [cx - zf * spanX / 2, cy - zf * spanY / 2,
    cx + zf * spanX / 2, cy + zf * spanY / 2];
  const state = { bounds: [minX, minY, maxX, maxY], range: null, rangeBasis: false, normBounds: null };
  const r0 = mkRange(1e-2);
  state.range = r0; state.rangeBasis = !!rangeNorm;
  const oInit = rangeNorm ? { range: r0 } : {};
  computeNormBounds(state, oInit, rangeNorm);
  const npos = new Float64Array(positionsArr());
  normalize(npos, 2, state.normBounds);
  const nf = new Float32Array(float32(npos));
  const npf = fract32(npos, float32(npos));
  const steps = [1e-3, 1e-4, 1e-5, 1e-6, zfEnd].filter((z) => z >= zfEnd);
  let lastR = r0;
  for (const z of steps) { lastR = mkRange(z); state.range = lastR; }
  const lU = computeUniforms(state, lastR);
  const mU = markerUniforms(lastR);
  const lp = lineProject(nf[k * 2], nf[k * 2 + 1], npf[k * 2], npf[k * 2 + 1], lU);
  const mp = markerProject(xs[k], ys[k], mU);
  return Math.hypot((lp[0] - mp[0]) * PX, (lp[1] - mp[1]) * PX);
}

test('range-normalized line tracks markers under deep zoom (#7955)', (t) => {
  const zoomFracs = [1e-3, 1e-4, 1e-5, 1e-6];
  for (let k = 0; k < 3; k++) {
    for (const zf of zoomFracs) {
      const cur = gapAtPoint(k, zf, false); // old bounds-normalized path
      const fix = gapAtPoint(k, zf, true);  // patched range-normalized path
      // patched must track the marker tightly
      t.ok(fix < 0.5, `p${k} zf=${zf.toExponential(0)} patched gap ${fix.toFixed(4)}px < 0.5`);
      // the fix must be an improvement over the old path
      t.ok(fix <= cur, `p${k} zf=${zf.toExponential(0)} patched (${fix.toFixed(4)}) <= old (${cur.toFixed(4)})`);
    }
  }
  t.end();
});

test('old bounds-normalized path drifts under deep zoom (discrimination check)', (t) => {
  // Sanity: if the old path never drifted, the regression test above would be
  // trivially passing. Assert at least one deep-zoom point drifts > 1px pre-fix.
  let maxDrift = 0;
  for (let k = 0; k < 3; k++) {
    for (const zf of [1e-4, 1e-5, 1e-6]) {
      const cur = gapAtPoint(k, zf, false);
      if (cur > maxDrift) maxDrift = cur;
    }
  }
  t.ok(maxDrift > 1, `old path drifts (max ${maxDrift.toFixed(3)}px) — test is discriminating`);
  t.end();
});
