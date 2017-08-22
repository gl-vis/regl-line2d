'use strict'

const createRegl = require('regl')
const rgba = require('color-rgba')
const getBounds = require('array-bounds')
const createStroke = require('extrude-polyline')

module.exports = createLine

function createLine (options) {
	if (!options) options = {}
	else if (typeof options === 'function') options = {regl: options}
	else if (options.length) options = {positions: options}

	// persistent variables
	let regl, viewport, range, bounds,
		positions, count, color, width, dashes,
		drawLine, mesh,
		stroke, width = 10, join = 'bevel', miterlimit = 2, cap = 'square'


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

		regl = createRegl(opts)
	}

	update(options)

	drawLine = regl({
		vert: ``,
		frag: ``,
		uniforms: {

		},
		attributes: {

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
		},

		count: regl.prop('count')
	})

	return draw

	function draw (opts) {
	    if (opts) {
	      update(opts)
	      if (opts.draw === false) return
	    }

	    if (!count) return

	}

	function update (options) {
	    if (options.length != null) options = {positions: options}

		//line style
		if (options.lineWidth) options.width = options.lineWidth
		if (options.thickness) options.width = options.thickness
		if (options.linewidth) options.width = options.linewidth
		if ('width' in options) {
			width = +options.width
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

		if (options.join || options.miterLimit || options.width) {
			stroke = createStroke({
				thickness: width,
				cap, miterLimit, join
			})
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

			mesh = stroke.build(coords)
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
