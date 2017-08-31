'use strict'

const createRegl = require('regl')
const rgba = require('color-rgba')
const getBounds = require('array-bounds')
const getNormals = require('polyline-normals')

module.exports = createLine

function createLine (options) {
	if (!options) options = {}
	else if (typeof options === 'function') options = {regl: options}
	else if (options.length) options = {positions: options}

	// persistent variables
	let regl, viewport, range, bounds, count, elements,
		drawLine, mesh, colorBuffer, offsetBuffer, positionBuffer, joinBuffer,
		positions, joins, color, dashes,
		stroke, thickness = 10, join = 'bevel', miterlimit = 2, cap = 'square'


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
		opts.optionalExtensions = [
			'ANGLE_instanced_arrays'
		]

		regl = createRegl(opts)
	}

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
	joinBuffer = regl.buffer({
		usage: 'dynamic',
		type: 'float',
		data: null
	})

	update(options)



	drawLine = regl({
		primitive: 'triangle strip',
		instances: regl.prop('count'),
		count: 4,

		vert: `
		precision highp float;

		attribute vec2 start, end, joinStart, joinEnd;
		attribute vec4 color;
		attribute float length, lineOffset;

		uniform vec4 range;
		uniform float thickness;
		uniform vec2 pixelScale;

		varying vec4 fragColor;

		void main() {
			fragColor = color;

			vec2 direction = end - start;
			vec2 offset = pixelScale*lineOffset*thickness;

			vec2 position = start + direction*length;

			vec2 normal = normalize(vec2(-direction.y, direction.x));

			position = 2.0 * (position - range.xy) / vec2(range.z - range.x, range.w - range.y) - 1.0;

			position += offset * normal * (1. - length);
			position += offset * normal * length;

			gl_Position = vec4(position, 0, 1);

		}

		`,
		frag: `
		precision mediump float;

		varying vec4 fragColor;

		void main() {
			gl_FragColor = fragColor / 255.;
		}`,
		uniforms: {
			range: regl.prop('range'),
			thickness: regl.prop('thickness'),
			pixelScale: ctx => [
				ctx.pixelRatio / ctx.viewportWidth,
				ctx.pixelRatio / ctx.viewportHeight
			]
		},
		attributes: {
			length: {
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
			color: () => color.length > 4 ? {
				buffer: colorBuffer,
				divisor: 1
			} : {
				constant: color
			},
			start: {
				buffer: positionBuffer,
				stride: 16,
				offset: 0,
				divisor: 1
			},
			end: {
				buffer: positionBuffer,
				stride: 16,
				offset: 8,
				divisor: 1
			},
			joinStart: {
				buffer: joinBuffer,
				stride: 16,
				offset: 0,
				divisor: 1,
			},
			joinEnd: {
				buffer: joinBuffer,
				stride: 16,
				offset: 8,
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
			box: ctx => {
			return viewport ? viewport : {
				x: 0, y: 0,
				width: ctx.drawingBufferWidth,
				height: ctx.drawingBufferHeight
			};
			}
		},

		viewport: ctx => {
			return !viewport ? {
				x: 0, y: 0,
				width: ctx.drawingBufferWidth,
				height: ctx.drawingBufferHeight
			} : viewport
		}
	})



	return draw

	function draw (opts) {
	    if (opts) {
	      update(opts)
	      if (opts.draw === false) return
	    }

	    if (!count) return

	    drawLine({ count, range, bounds, thickness })
	}

	function update (options) {
	    if (options.length != null) options = {positions: options}

		//line style
		if (options.lineWidth) options.thickness = options.lineWidth
		if (options.width) options.thickness = options.width
		if (options.linewidth) options.thickness = options.linewidth
		if ('thickness' in options) {
			thickness = +options.thickness
		}

		if (options.lineJoin) options.join = options.lineJoin
		if (options.linejoin) options.join = options.linejoin
		if (options.join) {
			join = options.join
		}

		if (options.miterlimit) options.miterLimit = options.miterlimit
		if (options.miterLimit) {
			miterLimit = options.miterLimit
		}

		//update positions
		if (options.data) options.positions = options.data
		if (options.points) options.positions = options.points
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

			positions = unrolled
			count = Math.floor(positions.length / 2)
			bounds = getBounds(positions, 2)

			joins = getNormals(coords)

			let positionData = Array(count * 4)
			for (let i = 0, l = count; i < l; i++) {
				positionData[i*4+0] = coords[i][0]
				positionData[i*4+1] = coords[i][1]
				positionData[i*4+2] = i+1 < l ? coords[i+1][0] : coords[i][0]
				positionData[i*4+3] = i+1 < l ? coords[i+1][1] : coords[i][1]
			}
			positionBuffer(positionData)

			let joinData = Array(count * 4)
			for (let i = 0, l = count; i < l; i++) {
				let join = joins[i]
				let miterLen = join[1]
				joinData[i*4] = join[0][0] * miterLen
				joinData[i*4+1] = join[0][1] * miterLen

				join = i+1 < l ? joins[i+1] : joins[i]
				miterLen = i+1 < l ? join[1] : 1
				joinData[i*4+2] = join[0][0] * miterLen
				joinData[i*4+3] = join[0][1] * miterLen
			}
			joinBuffer(joinData)
		}

		//process colors
		if (options.colors) options.color = options.colors
		if (options.color) {
			let colors = options.color

			if (!Array.isArray(colors)) {
				colors = [colors]
			}

			if (colors.length > 1 && colors.length != count) throw Error('Not enough colors')

			if (colors.length > 1) {
				color = new Uint8Array(count * 4)

				//convert colors to float arrays
				for (let i = 0; i < colors.length; i++) {
				  if (typeof colors[i] === 'string') {
				    colors[i] = rgba(colors[i], false)
				  }
				  color[i*4] = colors[i][0]
				  color[i*4 + 1] = colors[i][1]
				  color[i*4 + 2] = colors[i][2]
				  color[i*4 + 3] = colors[i][3] * 255
				}
				colorBuffer(color)
			}
			else {
				color = rgba(colors[0], false)
				color[3] *= 255
				color = new Uint8Array(color)
			}
		}

		if (!options.range && !range) options.range = bounds

		//update range
		if (options.range) {
			range = options.range
		}

		//update visible attribs
		if ('viewport' in options) {
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
		}
	}
}
