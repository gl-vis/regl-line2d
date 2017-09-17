'use strict'

const createRegl = require('regl')
const rgba = require('color-rgba')
const getBounds = require('array-bounds')
const extend = require('object-assign')
const glslify = require('glslify')
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
		data: [0,1, 0,-1, 1,1, 1,-1]
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
	let shaderOptions = {
		primitive: 'triangle strip',
		instances: regl.prop('count'),
		count: 4,
		offset: regl.prop('offset'),

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
			lineOffset: {
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
	}

	//draw rectangle-segment line
	let rectLineOptions = extend({}, shaderOptions)
	rectLineOptions.vert = glslify('./rect.vert')
	rectLineOptions.frag = glslify('./rect.frag')
	drawRectLine = regl(rectLineOptions)


	//draw bevel-miter line
	let miterLineOptions = extend({}, shaderOptions)
	miterLineOptions.vert = glslify('./miter.vert')
	miterLineOptions.frag = glslify('./miter.frag')
	drawMiterLine = regl(miterLineOptions)


	return draw

	function draw (opts) {
	    if (opts) {
	      update(opts)
	      if (opts.draw === false) return
	    }

	    if (!count) return

		//we draw one more sement than actual points
	    drawMiterLine({ count: count - 1, offset: 0, thickness, scale, translate, miterLimit, dashLength, viewport: [viewport.x, viewport.y, viewport.width, viewport.height] })
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
}
