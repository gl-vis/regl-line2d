'use strict'

const createRegl = require('regl')
const rgba = require('color-rgba')
const getBounds = require('array-bounds')
const extend = require('object-assign')
const glslify = require('glslify')
const pick = require('pick-by-alias')
const filter = require('filter-obj')
const mapProp = require('obj-map-prop')
const flatten = require('flatten-vertex-data')
const blacklist = require('blacklist')

module.exports = createLine


function createLine (options) {
	if (!options) options = {}
	else if (typeof options === 'function') options = {regl: options}
	else if (options.length) options = {positions: options}

	// persistent variables
	let regl, gl, properties, drawLine, colorBuffer, offsetBuffer, positionBuffer, dashTexture,

		// last raw options reference for diff-update
		rawOptions = {},

		// used to for new lines instances
		defaultOptions = {
			positions: [],
			precise: false,
			dashes: null,
			join: 'bevel',
			miterLimit: 1,
			thickness: 10,
			cap: 'square',
			color: 'black',
			opacity: 1,
			viewport: null,
			range: null,
			offset: 0
		},

		// list of states for lines
		lines = []


	// regl instance
	if (options.regl) regl = options.regl

	// container/gl/canvas case
	else {
		let opts

		if (options instanceof HTMLCanvasElement) opts = {canvas: options}
		else if (options instanceof HTMLElement) opts = {container: options}
		else if (options.drawingBufferWidth || options.drawingBufferHeight) opts = {gl: options}

		else {
			opts = pick(options, 'pixelRatio canvas container gl extensions')
		}

		if (!opts.extensions) opts.extensions = []

		//FIXME: use fallback if not available
		opts.extensions.push('ANGLE_instanced_arrays')

		regl = createRegl(opts)
	}

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

	//expose API
	extend(line2d, {
		update: update,
		draw: line2d,
		destroy: destroy,
		regl: regl,
		gl: regl._gl,
		canvas: regl._gl.canvas,
		lines: lines
	})

	//init defaults
	update(extend(defaultOptions, options))


	//create regl draw
	drawLine = regl({
		primitive: 'triangle strip',
		instances: (ctx, prop) => prop.count - 1,
		count: 4,
		offset: 0,

		//culling removes polygon creasing
		cull: {
			enable: true,
			face: 'back'
		},

		vert: glslify('./vert.glsl'),
		frag: glslify('./frag.glsl'),

		uniforms: {
			miterLimit: regl.prop('miterLimit'),
			scale: regl.prop('scale'),
			translate: regl.prop('translate'),
			thickness: regl.prop('thickness'),
			dashPattern: dashTexture,
			dashLength: regl.prop('dashLength'),
			totalDistance: regl.prop('totalDistance'),
			opacity: regl.prop('opacity'),
			pixelRatio: regl.context('pixelRatio'),
			viewport: (ctx, prop) => [prop.viewport.x, prop.viewport.y, ctx.viewportWidth, ctx.viewportHeight]
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
			aColor: (ctx, prop) => prop.color.length > 4 ? {
				buffer: colorBuffer,
				stride: 4,
				offset: 0,
				divisor: 1
			} : {
				constant: prop.color
			},
			bColor: (ctx, prop) => prop.color.length > 4 ? {
				buffer: colorBuffer,
				stride: 4,
				offset: 4,
				divisor: 1
			} : {
				constant: prop.color
			},
			prevCoord: {
				buffer: positionBuffer,
				stride: 8,
				offset: (ctx, prop) => prop.offset * 8,
				divisor: 1
			},
			aCoord: {
				buffer: positionBuffer,
				stride: 8,
				offset: (ctx, prop) => 8 + prop.offset * 8,
				divisor: 1
			},
			bCoord: {
				buffer: positionBuffer,
				stride: 8,
				offset: (ctx, prop) => 16 + prop.offset * 8,
				divisor: 1
			},
			nextCoord: {
				buffer: positionBuffer,
				stride: 8,
				offset: (ctx, prop) => 24 + prop.offset * 8,
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
			box: regl.prop('viewport')
		},

		viewport: regl.prop('viewport')
	})


	function line2d (opts) {
		//update
		if (opts) {
			update(opts)
		}

		//destroy
		else if (opts === null) {
			destroy()
		}

		//render multiple polylines via regl batch
		let batch = lines.filter(state => {
			return state.count && state.positions && state.positions.length
		})

		drawLine(batch)
	}


	function update (options) {
		if (options.length != null) {
			options = {positions: options}

			if (typeof options[0] === 'number') options = {positions: options}
			else {
				//batch properties: positions, thickness
			}
		}

		//reduce by aliases
		options = pick(options, {
			positions: 'positions points data',
			thickness: 'thickness lineWidth lineWidths  line-width linewidth width stroke-width strokewidth strokeWidth',
			join: 'lineJoin linejoin join',
			miterLimit: 'miterlimit miterLimit',
			dashes: 'dash dashes dasharray dash-array dashArray',
			color: 'color stroke colors stroke-color strokeColor',
			opacity: 'alpha opacity',

			range: 'bounds range dataBox',
			viewport: 'viewport viewBox',
			precise: 'precise hiprecision'
		})

		//consider only not changed properties
		options = filter(options, (key, value) => {
			if (Array.isArray(value)) return true
			return value !== undefined && rawOptions[key] !== value
		})

		//cache properties
		extend(rawOptions, options)

		if (options.positions) {
			//force positions to be for multiple lines
			if (options.positions.length && (typeof options.positions[0] === 'number' || options.positions[0].length === 2)) {
				options.positions = [options.positions]
			}
		}

		//separate options to per-line property and shared property values
		let multiOptions = filter(options, (key, value) => {
			if (key === 'positions') return true

			if (!Array.isArray(value)) return false
			if (typeof value[0] === 'number') return false

			return true
		})
		let singleOptions = blacklist(options, multiOptions)

		let properties = {
			thickness: parseFloat,
			opacity: parseFloat,
			miterLimit: parseFloat,
			// join: j => join = j,

			positions: (positions, state) => {
				positions = flatten(positions)

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

				let count = state.count = Math.floor(positions.length / 2)

				let positionData = new Float32Array(count * 2 + 4)

				//we duplicate first and last points to get [prev, a, b, next] coords valid
				positionData[0] = positions[0]
				positionData[1] = positions[1]
				positionData.set(positions, 2)
				positionData[count*2 + 2] = positionData[count*2 + 0]
				positionData[count*2 + 3] = positionData[count*2 + 1]

				positionBuffer(positionData)

				return positions
			},

			color: colors => {
				let color

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

				return color
			},

			dashes: (dashes, state) => {
				let dashLength = state.dashLength,
					dashData = new Uint8Array([255])

				const dashMult = 4;

				if (!dashes || dashes.length < 2) {
					dashLength = 1.
					dashTexture({
						channels: 1,
						data: dashData,
						width: 1,
						height: 1,
						mag: 'linear',
						min: 'linear'
					})
				}

				else {
					dashLength = 0.;
					for(let i = 0; i < dashes.length; ++i) {
						dashLength += dashes[i]
					}
					dashData = new Uint8Array(dashLength * dashMult)
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

					dashTexture({
						channels: 1,
						data: dashData,
						width: dashLength * dashMult,
						height: 1,
						mag: 'linear',
						min: 'linear'
					})
				}

				state.dashLength = dashLength

				return dashData
			},

			range: (range, state) => {
				let bounds = state.bounds
				if (!state.range) state.range = bounds

				if (state.precise) {
					let boundX = bounds[2] - bounds[0],
						boundY = bounds[3] - bounds[1]

					let nrange = [
						(range[0] - bounds[0]) / boundX,
						(range[1] - bounds[1]) / boundY,
						(range[2] - bounds[0]) / boundX,
						(range[3] - bounds[1]) / boundY
					]

					state.scale = [1 / (nrange[2] - nrange[0]), 1 / (nrange[3] - nrange[1])]
					state.translate = [-nrange[0], -nrange[1]]

					// scaleFract = fract32(scale)
					// translateFract = fract32(translate)
				}
				else {
					state.scale = [1 / (range[2] - range[0]), 1 / (range[3] - range[1])]
					state.translate = [-range[0], -range[1]]

					// scaleFract = [0, 0]
					// translateFract = [0, 0]
				}

				return range
			},

			viewport: vp => {
				let viewport

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

				return viewport
			}
		}

		//put newly obtained shared properties to defaults
		let processedOptions = mapProp(singleOptions, properties)
		extend(defaultOptions, singleOptions, processedOptions)

		//ensure there is enough line instances
		if (options.positions) {
			lines = options.positions.map((p, i) => {
				let state = lines[i]

				//prototype here keeps defaultOptions live-updated
				if (!state) state = Object.create(defaultOptions)

				state.bounds = getBounds(p, 2)

				return state
			})
		}

		//distribute every new multi property per polyline instance
		lines = lines.map((state, i) => {
			let options = {}
			for (let prop in multiOptions) {
				let value = multiOptions[prop][i]
				options[prop] = value
			}
			let changes = mapProp(options, properties)

			return extend(state, options, changes)
		})

		return line2d
	}

	function destroy () {
		rawOptions = null
		colorBuffer.destroy()
		offsetBuffer.destroy()
		positionBuffer.destroy()
		dashTexture.destroy()
		regl.destroy()
	}

	return line2d
}
