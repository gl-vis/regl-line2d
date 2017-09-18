'use strict'

const createRegl = require('regl')
const rgba = require('color-rgba')
const getBounds = require('array-bounds')
const extend = require('object-assign')
const pick = require('pick-by-alias')

module.exports = createLine

function createLine (options) {
	if (!options) options = {}
	else if (typeof options === 'function') options = {regl: options}
	else if (options.length) options = {positions: options}

	// persistent variables
	let regl, gl, viewport, range, bounds, count, scale, translate, precise,
		drawLine, drawMiterLine, drawRectLine,
		colorBuffer, offsetBuffer, positionBuffer, dashTexture,
		positions, color, dashes, dashLength,
		stroke, thickness = 10, join, miterLimit, cap


	// regl instance
	if (options.regl) regl = options.regl

	// container/gl/canvas case
	else {
		let opts = {}
		opts.pixelRatio = options.pixelRatio || global.devicePixelRatio

		if (options instanceof HTMLCanvasElement) opts.canvas = options
		else if (options instanceof HTMLElement) opts.container = options
		else if (options.drawingBufferWidth || options.drawingBufferHeight) opts.gl = options
		else {
			if (options.canvas) opts.canvas = options.canvas
			if (options.container) opts.container = options.container
			if (options.gl) opts.gl = options.gl
		}

		//FIXME: use fallback if not available
		opts.extensions = [
			'ANGLE_instanced_arrays'
		]

		regl = createRegl(opts)
	}
	//TODO: test if required extensions are supported

	gl = regl._gl

	//color per-point
	colorBuffer = regl.buffer({
		usage: 'dynamic',
		type: 'uint8',
		data: null
	})
	offsetBuffer = regl.buffer({
		usage: 'static',
		type: 'float',
		data: [0,1, 0,0, 1,1, 1,0]
	})
	positionBuffer = regl.buffer({
		usage: 'dynamic',
		type: 'float',
		data: null
	})
	dashTexture = regl.texture({
		channels: 1,
		data: [255],
		width: 1,
		height: 1,
		mag: 'nearest',
		min: 'nearest'
	})

	//init defaults
	update(extend({
		dashes: null,
		join: 'bevel',
		miterLimit: 1,
		cap: 'square',
		viewport: null
	}, options))


	//common shader options
	drawLine = regl({
		primitive: 'triangle strip',
		instances: regl.prop('count'),
		count: 4,
		offset: regl.prop('offset'),

		vert: vert(),
		frag: frag(),

		uniforms: {
			miterLimit: regl.prop('miterLimit'),
			scale: regl.prop('scale'),
			translate: regl.prop('translate'),
			thickness: regl.prop('thickness'),
			dashPattern: dashTexture,
			dashLength: regl.prop('dashLength'),
			totalDistance: regl.prop('totalDistance'),
			viewport: regl.prop('viewport'),
			pixelRatio: regl.context('pixelRatio')
		},
		attributes: {
			lineEnd: {
				buffer: offsetBuffer,
				divisor: 0,
				stride: 8,
				offset: 0
			},
			lineTop: {
				buffer: offsetBuffer,
				divisor: 0,
				stride: 8,
				offset: 4
			},
			aColor: () => color.length > 4 ? {
				buffer: colorBuffer,
				stride: 4,
				offset: 0,
				divisor: 1
			} : {
				constant: color
			},
			bColor: () => color.length > 4 ? {
				buffer: colorBuffer,
				stride: 4,
				offset: 4,
				divisor: 1
			} : {
				constant: color
			},
			prevCoord: {
				buffer: positionBuffer,
				stride: 8,
				offset: 0,
				divisor: 1
			},
			aCoord: {
				buffer: positionBuffer,
				stride: 8,
				offset: 8,
				divisor: 1
			},
			bCoord: {
				buffer: positionBuffer,
				stride: 8,
				offset: 16,
				divisor: 1
			},
			nextCoord: {
				buffer: positionBuffer,
				stride: 8,
				offset: 24,
				divisor: 1
			}
		},

		//culling removes polygon creasing
		cull: {
			enable: true,
			face: 'back'
		},

		blend: {
			enable: true,
			color: [0,0,0,1],
			func: {
				srcRGB:   'src alpha',
				srcAlpha: 1,
				dstRGB:   'one minus src alpha',
				dstAlpha: 'one minus src alpha'
			}
		},

		depth: {
			enable: false
		},

		scissor: {
		  enable: true,
		  box: ctx => viewport
		},

		viewport: ctx => viewport
	})


	return draw

	function draw (opts) {
	    if (opts) {
	      update(opts)
	      if (opts.draw === false) return
	    }

	    if (!count) return

		//we draw one more sement than actual points
	    drawLine({ count: count - 1, offset: 0, thickness, scale, translate, miterLimit, dashLength, viewport: [viewport.x, viewport.y, viewport.width, viewport.height] })
	}

	function update (options) {
		//copy options to avoid mutation & handle aliases
		options = pick(options, {
			positions: 'positions points data',
			thickness: 'thickness lineWidth lineWidths linewidth width stroke-width strokewidth',
			join: 'lineJoin linejoin join',
			miterLimit: 'miterlimit miterLimit',
			dashes: 'dash dashes dasharray',
			color: 'stroke colors color',
			range: 'bounds range dataBox',
			viewport: 'viewport viewBox',
			precise: 'precise hiprecision'
		})

	    if (options.length != null) options = {positions: options}

		if (options.thickness != null) {
			thickness = +options.thickness
		}

		if (options.join) {
			join = options.join
		}

		if (options.miterLimit != null) {
			miterLimit = +options.miterLimit
		}
		if (miterLimit == null) miterLimit = 1;

		//update positions
		if (options.positions && options.positions.length) {
			//unroll
			let unrolled, coords
			if (options.positions[0].length) {
				unrolled = Array(options.positions.length)
				for (let i = 0, l = options.positions.length; i<l; i++) {
					unrolled[i*2] = options.positions[i][0]
					unrolled[i*2+1] = options.positions[i][1]
				}
				coords = options.positions
			}

			//roll
			else {
				unrolled = options.positions
				coords = []
				for (let i = 0, l = unrolled.length; i < l; i+=2) {
					coords.push([
						unrolled[i],
						unrolled[i+1]
					])
				}
			}

			//hi-precision buffer has normalized coords and [hi,hi, lo,lo, hi,hi, lo,lo...] layout
			// if (precise) {
			// 	precisePositions = new Float32Array(count * 2)
			// }
			// else {
			// 	let precisePositions = new Float32Array(count * 4)

			// 	//float numbers are more precise around 0
			// 	let boundX = bounds[2] - bounds[0], boundY = bounds[3] - bounds[1]

			// 	for (let i = 0, l = count; i < l; i++) {
			// 		let nx = (unrolled[i * 2] - bounds[0]) / boundX
			// 		let ny = (unrolled[i * 2 + 1] - bounds[1]) / boundY

			// 		precisePositions[i * 4] = nx
			// 		precisePositions[i * 4 + 1] = ny
			// 		precisePositions[i * 4 + 2] = nx - precisePositions[i * 4]
			// 		precisePositions[i * 4 + 3] = ny - precisePositions[i * 4 + 1]
			// 	}

			// 	positionBuffer(precisePositions)
			// }

			positions = unrolled
			count = Math.floor(positions.length / 2)
			bounds = getBounds(positions, 2)

			let positionData = Array(count * 2 + 4)

			//we duplicate first and last point to get [prev, a, b, next] coords valid
			positionData[0] = coords[0][0]
			positionData[1] = coords[0][1]
			for (let i = 0, l = count; i < l; i++) {
				positionData[i*2 + 2] = coords[i][0]
				positionData[i*2 + 3] = coords[i][1]
			}
			positionData[count*2 + 2] = positionData[count*2 + 0]
			positionData[count*2 + 3] = positionData[count*2 + 1]

			positionBuffer(positionData)
		}

		//process colors
		if (options.colors) options.color = options.colors
		if (options.color) {
			let colors = options.color

			// 'black' or [0,0,0,0] case
			if (!Array.isArray(colors) || typeof colors[0] === 'number') {
				colors = [colors]
			}

			if (colors.length > 1 && colors.length < count) throw Error('Not enough colors')

			if (colors.length > 1) {
				color = new Uint8Array(count * 4 + 4)

				//convert colors to float arrays
				for (let i = 0; i < colors.length; i++) {
					let c = colors[i]
					if (typeof c === 'string') {
						c = rgba(c, false)
					}
					color[i*4] = c[0]
					color[i*4 + 1] = c[1]
					color[i*4 + 2] = c[2]
					color[i*4 + 3] = c[3] * 255
				}

				//put last color
				color[count*4 + 0] = color[count*4 - 4]
				color[count*4 + 1] = color[count*4 - 3]
				color[count*4 + 2] = color[count*4 - 2]
				color[count*4 + 3] = color[count*4 - 1]

				colorBuffer(color)
			}
			else {
				color = rgba(colors[0], false)
				color[3] *= 255
				color = new Uint8Array(color)
			}
		}

		//generate dash texture
		if (options.dashes !== undefined) {
			dashes = options.dashes
			dashLength = 1

			if (!dashes || dashes.length < 2) {
				dashTexture = regl.texture({
					channels: 1,
					data: [255],
					width: 1,
					height: 1,
					mag: 'linear',
					min: 'linear'
				})
			}

			else {
				//enlarges dash pattern this amount of times, creates antialiasing
				const dashMult = 2

				dashLength = 0.;
				for(let i = 0; i < dashes.length; ++i) {
					dashLength += dashes[i]
				}
				let dashData = new Uint8Array(dashLength * dashMult)
				let ptr = 0
				let fillColor = 255

				//repeat texture two times to provide smooth 0-step
				for (let k = 0; k < 2; k++) {
					for(let i = 0; i < dashes.length; ++i) {
						for(let j = 0, l = dashes[i] * dashMult * .5; j < l; ++j) {
							dashData[ptr++] = fillColor
						}
						fillColor ^= 255
					}
				}

				dashTexture = regl.texture({
					channels: 1,
					data: dashData,
					width: dashLength * dashMult,
					height: 1,
					mag: 'linear',
					min: 'linear'
				})
			}
		}

		if (!options.range && !range) options.range = bounds

		//update range
		if (options.range) {
			range = options.range

			if (precise) {
				let boundX = bounds[2] - bounds[0],
					boundY = bounds[3] - bounds[1]

				let nrange = [
					(range[0] - bounds[0]) / boundX,
					(range[1] - bounds[1]) / boundY,
					(range[2] - bounds[0]) / boundX,
					(range[3] - bounds[1]) / boundY
				]

				scale = [1 / (nrange[2] - nrange[0]), 1 / (nrange[3] - nrange[1])]
				translate = [-nrange[0], -nrange[1]]
				// scaleFract = fract32(scale)
				// translateFract = fract32(translate)
			}
			else {
				scale = [1 / (range[2] - range[0]), 1 / (range[3] - range[1])]
				translate = [-range[0], -range[1]]

				// scaleFract = [0, 0]
				// translateFract = [0, 0]
			}
		}

		//update visible attribs
		if (options.viewport !== undefined) {
			let vp = options.viewport
			if (Array.isArray(vp)) {
				viewport = {
					x: vp[0],
					y: vp[1],
					width: vp[2] - vp[0],
					height: vp[3] - vp[1]
				}
			}
			else if (vp) {
				viewport = {
					x: vp.x || vp.left || 0,
					y: vp.y || vp.top || 0
				}

				if (vp.right) viewport.width = vp.right - viewport.x
				else viewport.width = vp.w || vp.width || 0

				if (vp.bottom) viewport.height = vp.bottom - viewport.y
				else viewport.height = vp.h || vp.height || 0
			}
			else {
				viewport = {
					x: 0, y: 0,
					width: gl.drawingBufferWidth,
					height: gl.drawingBufferHeight
				}
			}
		}
	}

	//generate vertex code
	function vert (options) {
		return `
		precision highp float;

		attribute vec2 aCoord, bCoord, nextCoord, prevCoord;
		attribute vec4 aColor, bColor;
		attribute float lineEnd, lineTop;

		uniform vec2 scale, translate;
		uniform float thickness, pixelRatio;
		uniform vec4 viewport;
		uniform float miterLimit, dashLength;

		varying vec4 fragColor;
		varying vec4 startCutoff, endCutoff;
		varying vec2 tangent;
		varying vec2 startCoord, endCoord;

		const float REVERSE_MITER = -1e-5;

		float distToLine(vec2 p, vec2 a, vec2 b) {
			vec2 diff = b - a;
			vec2 perp = normalize(vec2(-diff.y, diff.x));
			return dot(p - a, perp);
		}

		void main() {
			vec2 aCoord = aCoord, bCoord = bCoord, prevCoord = prevCoord, nextCoord = nextCoord;
			vec2 scaleRatio = scale * viewport.zw;

			float lineStart = 1. - lineEnd;
			float lineBot = 1. - lineTop;

			vec2 prevDiff = aCoord - prevCoord;
			vec2 currDiff = bCoord - aCoord;
			vec2 nextDiff = nextCoord - bCoord;

			vec2 prevDirection = normalize(prevDiff);
			vec2 currDirection = normalize(currDiff);
			vec2 nextDirection = normalize(nextDiff);

			if (dot(currDirection, nextDirection) == -1.) {
				nextCoord = bCoord;
				nextDiff = nextCoord - bCoord;
			}
			if (dot(currDirection, prevDirection) == -1.) {
				if (length(currDiff) <= length(prevDiff)) {
					return;
				}
				aCoord = prevCoord;
				currDiff = bCoord - aCoord;
			}

			vec2 prevTangent = normalize(prevDiff * scaleRatio);
			vec2 currTangent = normalize(currDiff * scaleRatio);
			vec2 nextTangent = normalize(nextDiff * scaleRatio);

			vec2 prevNormal = vec2(-prevTangent.y, prevTangent.x);
			vec2 currNormal = vec2(-currTangent.y, currTangent.x);
			vec2 nextNormal = vec2(-nextTangent.y, nextTangent.x);

			vec2 startJoinNormal = normalize(prevTangent - currTangent);
			vec2 endJoinNormal = normalize(currTangent - nextTangent);

			if (prevDirection == currDirection) {
				startJoinNormal = currNormal;
			}
			if (nextDirection == currDirection) {
				endJoinNormal = currNormal;
			}
			if (prevCoord == aCoord) {
				startJoinNormal = currNormal;
				prevTangent = currTangent;
				prevNormal = currNormal;
			}
			if (aCoord == bCoord) {
				endJoinNormal = startJoinNormal;
				currNormal = prevNormal;
				currTangent = prevTangent;
			}
			if (bCoord == nextCoord) {
				endJoinNormal = currNormal;
				nextTangent = currTangent;
				nextNormal = currNormal;
			}

			float startJoinShift = dot(currNormal, startJoinNormal);
			float endJoinShift = dot(currNormal, endJoinNormal);

			float startMiterRatio = abs(1. / startJoinShift);
			float endMiterRatio = abs(1. / endJoinShift);

			vec2 startJoin = startJoinNormal * startMiterRatio;
			vec2 endJoin = endJoinNormal * endMiterRatio;

			vec2 startTopJoin, startBotJoin, endTopJoin, endBotJoin;
			startTopJoin = sign(startJoinShift) * startJoin * .5;
			startBotJoin = -startTopJoin;

			endTopJoin = sign(endJoinShift) * endJoin * .5;
			endBotJoin = -endTopJoin;

			vec2 normalWidth = pixelRatio * thickness / scaleRatio;

			vec2 aBotCoord = aCoord + normalWidth * startBotJoin;
			vec2 aTopCoord = aCoord + normalWidth * startTopJoin;
			vec2 bBotCoord = bCoord + normalWidth * endBotJoin;
			vec2 bTopCoord = bCoord + normalWidth * endTopJoin;

			//reduce the length of startJoin/endJoin to avoid crease of thick lines
			//TODO: optimize this part
			// if (dot(currNormal, nextTangent) <= 0. && currTangent != nextTangent) {
			float abClipping = abs(distToLine(aCoord, bCoord, bBotCoord) / dot(normalize(normalWidth * startBotJoin), normalize(normalWidth.yx * vec2(-endBotJoin.y, endBotJoin.x))));
			float baClipping = abs(distToLine(bCoord, aCoord, aBotCoord) / dot(normalize(normalWidth * endBotJoin), normalize(normalWidth.yx * vec2(-startBotJoin.y, startBotJoin.x))));
			if (dot(prevNormal, currTangent) <= 0. && dot(currNormal, nextTangent) <= 0.) {
				if (abClipping < length(normalWidth * startBotJoin)) {
					aBotCoord -= normalWidth * startBotJoin;
					aBotCoord += normalize(startBotJoin * normalWidth) * abClipping;
				}
			}
			if (dot(prevNormal, currTangent) >= 0. && dot(currNormal, nextTangent) >= 0.) {
				if (baClipping < length(normalWidth * endBotJoin)) {
					bTopCoord -= normalWidth * endTopJoin;
					bTopCoord += normalize(endTopJoin * normalWidth) * baClipping;
				}
			}

			vec2 aPosition = (aCoord + translate) * scale;
			vec2 aTopPosition = (aTopCoord + translate) * scale;
			vec2 aBotPosition = (aBotCoord + translate) * scale;

			vec2 bPosition = (bCoord + translate) * scale;
			vec2 bTopPosition = (bTopCoord + translate) * scale;
			vec2 bBotPosition = (bBotCoord + translate) * scale;

			//position is normalized 0..1 coord on the screen
			vec2 position = (aTopPosition * lineTop + aBotPosition * lineBot) * lineStart + (bTopPosition * lineTop + bBotPosition * lineBot) * lineEnd;

			gl_Position = vec4(position  * 2.0 - 1.0, 0, 1);


			vec4 miterWidth = vec4(vec2(normalize(startJoin)), vec2(normalize(endJoin))) * thickness * pixelRatio * miterLimit * .5;

			//provides miter slicing
			startCutoff = vec4(aCoord, aCoord);
			startCutoff.zw += (prevCoord == aCoord ? startBotJoin : vec2(-startJoin.y, startJoin.x)) / scaleRatio;
			startCutoff = (startCutoff + translate.xyxy) * scaleRatio.xyxy;
			startCutoff += viewport.xyxy;
			startCutoff += miterWidth.xyxy;

			endCutoff = vec4(bCoord, bCoord);
			endCutoff.zw += (nextCoord == bCoord ? endTopJoin : vec2(-endJoin.y, endJoin.x))  / scaleRatio;
			endCutoff = (endCutoff + translate.xyxy) * scaleRatio.xyxy;
			endCutoff += viewport.xyxy;
			endCutoff += miterWidth.zwzw;

			startCoord = (aCoord + translate) * scaleRatio + viewport.xy;
			endCoord = (bCoord + translate) * scaleRatio + viewport.xy;

			tangent = currTangent;

			fragColor = (lineEnd * bColor + lineStart * aColor) / 255.;
		}`
	}

	function frag (options) {
		return `
		precision highp float;

		uniform sampler2D dashPattern;
		uniform float dashLength, pixelRatio, thickness;

		varying vec4 fragColor;
		varying float fragLength;
		varying vec2 tangent;
		varying vec4 startCutoff, endCutoff;
		varying vec2 startCoord, endCoord;

		//get shortest distance from point p to line [a, b]
		float distToLine(vec2 p, vec4 line) {
			vec2 a = line.xy, b = line.zw;
			vec2 diff = b - a;
			vec2 perp = normalize(vec2(-diff.y, diff.x));
			return dot(p - a, perp);
		}

		void main() {
			float alpha = 1., distToStart, distToEnd;

			//round miter case
			// distToStart = distToLine(gl_FragCoord.xy, startCutoff);
			// if (distToStart < 0.) {
			// 	float radius = length(gl_FragCoord.xy - startCoord);

			// 	if(radius > thickness * pixelRatio * .5) {
			// 		discard;
			// 		return;
			// 	}
			// }

			// distToEnd = distToLine(gl_FragCoord.xy, endCutoff);
			// if (distToEnd < 0.) {
			// 	float radius = length(gl_FragCoord.xy - endCoord);

			// 	if(radius > thickness * pixelRatio * .5) {
			// 		discard;
			// 		return;
			// 	}
			// }

			// alpha -= smoothstep(1.0 - delta, 1.0 + delta, radius);




			// bevel miter case
			distToStart = distToLine(gl_FragCoord.xy, startCutoff);
			if (distToStart < 0.) {
				discard;
				return;
			}

			distToEnd = distToLine(gl_FragCoord.xy, endCutoff);
			if (distToEnd < 0.) {
				discard;
				return;
			}

			alpha *= min(max(distToStart, 0.), 1.);
			alpha *= min(max(distToEnd, 0.), 1.);



			float t = fract(dot(tangent, gl_FragCoord.xy) / dashLength / pixelRatio) * .5 + .25;

			gl_FragColor = fragColor;
			gl_FragColor.a *= alpha * texture2D(dashPattern, vec2(t, 0.)).r;
		}
		`
	}
}
