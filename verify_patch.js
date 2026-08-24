// verify_patch.js — verifies the fix/7955-range-normalize patch of regl-line2d
// keeps lines aligned with regl-scatter2d markers under deep zoom.
//
// Scenario (matches plotly.js#7955): the user zooms deeply onto a data point;
// the visible range shrinks to a tiny fraction of the data span centered on
// that point. We measure the line-vertex vs marker-center offset IN PIXELS for
// the zoomed-at point, through BOTH update paths:
//   init update {positions, range} then a range-only drag update {range}.
//
// CPU pipeline mirrors index.js verbatim using the real array-normalize +
// to-float32 modules; shader math is f32-exact (Math.fround).
//
// Run: node verify_patch.js

'use strict';
const path = require('path');
const NM = 'E:/Codex/Projects/plotly/plotly.js/node_modules';
const normalize = require(path.join(NM, 'array-normalize'));
const { float32, fract32 } = require(path.join(NM, 'to-float32'));

const f32 = Math.fround;
const fract = (x) => f32(x - f32(x));

// ---- issue #7955 data ----
const xs = [1, 5, 10];
const ys = [14e-6, 15e-6, 12e-6];
const minX = Math.min(...xs), maxX = Math.max(...xs);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const spanX = maxX - minX, spanY = maxY - minY;

const VP = 1000, PX = VP / 2; // px per NDC unit

function positionsArr() {
	return new Float64Array([xs[0], ys[0], xs[1], ys[1], xs[2], ys[2]]);
}

// --- rectVert project(), f32-exact ---
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

// marker (regl-scatter2d) grouped projection, f32-exact
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

// --- norm-basis selection ---
// PATCHED semantics: prefer o.range, then state.range, else bounds.
// CURRENT semantics: always bounds.
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

// --- index.js update(): scale/translate block (patched semantics) ---
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

// Zoom onto data point (xs[k], ys[k]): range spans zf of the FULL data span,
// centered on the point. Simulates: init at coarse zoom 1e-2, then range-only
// updates down to zf (plotly drag path). Returns gap in px at that point.
function gapAtPoint(k, zfEnd, rangeNorm) {
	const cx = xs[k], cy = ys[k];
	const mkRange = (zf) => [cx - zf * spanX / 2, cy - zf * spanY / 2,
		cx + zf * spanX / 2, cy + zf * spanY / 2];

	const state = {
		bounds: [minX, minY, maxX, maxY],
		range: null, rangeBasis: false, normBounds: null
	};

	// --- init update: {positions, range: 1e-2 zoom} ---
	const r0 = mkRange(1e-2);
	state.range = r0;
	state.rangeBasis = !!rangeNorm;
	const oInit = rangeNorm ? { range: r0 } : {};
	const normBounds = computeNormBounds(state, oInit, rangeNorm);
	const npos = new Float64Array(positionsArr());
	normalize(npos, 2, normBounds);
	const nf = new Float32Array(float32(npos));
	const npf = fract32(npos, float32(npos)); // fresh copy: fract32 mutates arg2

	// --- range-only drag updates: 1e-3 ... zfEnd ---
	const steps = [1e-3, 1e-4, 1e-5, 1e-6, zfEnd].filter(z => z >= zfEnd);
	let lastR = r0;
	for (const z of steps) { lastR = mkRange(z); state.range = lastR; }

	const lU = computeUniforms(state, lastR);
	const mU = markerUniforms(lastR);
	const lp = lineProject(nf[k * 2], nf[k * 2 + 1], npf[k * 2], npf[k * 2 + 1], lU);
	const mp = markerProject(xs[k], ys[k], mU);
	return Math.hypot((lp[0] - mp[0]) * PX, (lp[1] - mp[1]) * PX);
}

let pass = true;
console.log('regl-line2d #7955 patch verification (CPU-exact, no GL)');
console.log('scenario: zoom onto each data point; gap = line-vertex vs marker-center');
console.log('zoomFrac | point | current(bounds-norm) | PATCHED(range-norm) | improvement');
console.log('---------+-------+----------------------+---------------------+------------');
for (let k = 0; k < 3; k++) {
	for (const zf of [1e-3, 1e-4, 1e-5, 1e-6]) {
		const cur = gapAtPoint(k, zf, false);
		const fix = gapAtPoint(k, zf, true);
		const ok = fix <= cur && fix < 0.5;
		if (!ok) pass = false;
		console.log(
			zf.toExponential(0).padStart(8), '|', ('p' + k).padStart(5), '|',
			(cur.toFixed(3) + 'px').padStart(20), '|',
			(fix.toFixed(4) + 'px').padStart(19), '|',
			ok ? 'OK' : 'FAIL'
		);
	}
}
console.log(pass ? '\nPASS: patched pipeline tracks markers at every tested zoom depth'
                : '\nFAIL');
process.exit(pass ? 0 : 1);
