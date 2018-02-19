'use strict'

const rgba = require('color-normalize')
const getBounds = require('array-bounds')
const extend = require('object-assign')
const glslify = require('glslify')
const pick = require('pick-by-alias')
const updateDiff = require('update-diff')
const flatten = require('flatten-vertex-data')
const triangulate = require('earcut')
const normalize = require('array-normalize')

module.exports = createLine


const MAX_SCALE = 1e10;


function createLine (regl, options) {
	if (typeof regl === 'function') {
		if (!options) options = {}
		options.regl = regl
	}
	else {
		options = regl
	}
	if (options.length) options.positions = options
	regl = options.regl

	if (!regl.hasExtension('ANGLE_instanced_arrays')) {
		throw Error('regl-error2d: `ANGLE_instanced_arrays` extension should be enabled');
	}

	// persistent variables
	let gl = regl._gl, drawMiterLine, drawRectLine, drawFill, colorBuffer, offsetBuffer, positionBuffer, positionFractBuffer, dashTexture,

		// used to for new lines instances
		defaults = {
			positions: [],
			dashes: null,
			join: null,
			miterLimit: 1,
			thickness: 10,
			cap: 'square',
			color: 'black',
			opacity: 1,
			overlay: false,
			viewport: null,
			range: null,
			close: null,
			fill: null
		},

		// list of options for lines
		lines = []

	const dashMult = 2, maxPatternLength = 256, maxLinesNumber = 2048, precisionThreshold = 3e6, maxPoints = 1e4


	// color per-point
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
	positionFractBuffer = regl.buffer({
		usage: 'dynamic',
		type: 'float',
		data: null
	})
	dashTexture = regl.texture({
		channels: 1,
		data: new Uint8Array(maxPatternLength * maxLinesNumber),
		width: maxPatternLength,
		height: maxLinesNumber,
		mag: 'linear',
		min: 'linear'
	})

	// init defaults
	update(options)

	let shaderOptions = {
		primitive: 'triangle strip',
		instances: regl.prop('count'),
		count: 4,
		offset: 0,

		uniforms: {
			miterMode: (ctx, prop) => prop.join === 'round' ? 2 : 1,
			miterLimit: regl.prop('miterLimit'),
			scale: regl.prop('scale'),
			scaleFract: regl.prop('scaleFract'),
			translateFract: regl.prop('translateFract'),
			translate: regl.prop('translate'),
			thickness: regl.prop('thickness'),
			dashPattern: dashTexture,
			dashLength: regl.prop('dashLength'),
			dashShape: [maxPatternLength, maxLinesNumber],
			opacity: regl.prop('opacity'),
			pixelRatio: regl.context('pixelRatio'),
			id: regl.prop('id'),
			scaleRatio: regl.prop('scaleRatio'),
			viewport: (ctx, prop) => [prop.viewport.x, prop.viewport.y, ctx.viewportWidth, ctx.viewportHeight]
		},

		blend: {
			enable: true,
			color: [0,0,0,0],
			equation: {
				rgb: 'add',
				alpha: 'add'
			},
			func: {
				srcRGB: 'src alpha',
				dstRGB: 'one minus src alpha',
				srcAlpha: 'one minus dst alpha',
				dstAlpha: 'one'
			}
		},
		depth: {
			enable: (ctx, prop) => {
				return !prop.overlay
			}
		},
		scissor: {
			enable: true,
			box: regl.prop('viewport')
		},
		stencil: false,
		viewport: regl.prop('viewport')
	}

	// create regl draw
	drawMiterLine = regl(extend({
		// culling removes polygon creasing
		cull: {
			enable: true,
			face: 'back'
		},

		vert: glslify('./miter-vert.glsl'),
		frag: glslify('./miter-frag.glsl'),

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
			aColor: {
				buffer: colorBuffer,
				stride: 4,
				offset: (ctx, prop) => prop.offset * 4,
				divisor: 1
			},
			bColor: {
				buffer: colorBuffer,
				stride: 4,
				offset: (ctx, prop) => prop.offset * 4 + 4,
				divisor: 1
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
		}
	}, shaderOptions))

	// simplified rectangular line shader
	drawRectLine = regl(extend({
		vert: glslify('./rect-vert.glsl'),
		frag: glslify('./rect-frag.glsl'),

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
			aCoordFract: {
				buffer: positionFractBuffer,
				stride: 8,
				offset: (ctx, prop) => 8 + prop.offset * 8,
				divisor: 1
			},
			bCoordFract: {
				buffer: positionFractBuffer,
				stride: 8,
				offset: (ctx, prop) => 16 + prop.offset * 8,
				divisor: 1
			},
			color: {
				buffer: colorBuffer,
				stride: 4,
				offset: (ctx, prop) => prop.offset * 4,
				divisor: 1
			}
		}
	}, shaderOptions))


	// fill shader
	drawFill = regl({
		primitive: 'triangle',
		elements: (ctx, prop) => prop.triangles,
		offset: 0,

		vert: glslify('./fill-vert.glsl'),
		frag: glslify('./fill-frag.glsl'),

		uniforms: {
			scale: regl.prop('scale'),
			color: regl.prop('fill'),
			scaleFract: regl.prop('scaleFract'),
			translateFract: regl.prop('translateFract'),
			translate: regl.prop('translate'),
			opacity: regl.prop('opacity'),
			pixelRatio: regl.context('pixelRatio'),
			id: regl.prop('id'),
			viewport: (ctx, prop) => [prop.viewport.x, prop.viewport.y, ctx.viewportWidth, ctx.viewportHeight]
		},

		attributes: {
			position: {
				buffer: positionBuffer,
				stride: 8,
				offset: (ctx, prop) => 8 + prop.offset * 8
			},
			positionFract: {
				buffer: positionFractBuffer,
				stride: 8,
				offset: (ctx, prop) => 8 + prop.offset * 8
			}
		},

		blend: shaderOptions.blend,

		depth: {
			enable: false
		},
		scissor: shaderOptions.scissor,
		stencil: shaderOptions.stencil,
		viewport: shaderOptions.viewport
	})

	// expose API
	extend(line2d, {
		update: update,
		draw: draw,
		destroy: destroy,
		regl: regl,
		gl: gl,
		canvas: gl.canvas,
		lines: lines
	})

	function line2d (opts) {
		// update
		if (opts) {
			update(opts)
		}

		// destroy
		else if (opts === null) {
			destroy()
		}

		draw()
	}

	function draw (options) {
		if (typeof options === 'number') return drawLine(options)

		// make options a batch
		if (options && !Array.isArray(options)) options = [options]

		// render multiple polylines via regl batch
		lines.forEach((s, i) => {
			drawLine(i)
		})
	}

	// draw single line by id
	function drawLine (s) {
		if (typeof s === 'number') s = lines[s]

		if (!(s && s.count && s.opacity && s.positions && s.positions.length > 2)) return

		regl._refresh()

		if (s.fill && s.triangles && s.triangles.length > 2) {
			drawFill(s)
		}

		if (!s.thickness || !s.color) return

		s.scaleRatio = [
			s.scale[0] * s.viewport.width,
			s.scale[1] * s.viewport.height
		]

		// high scale is only available for rect mode with precision
		if (s.scaleRatio[0] > precisionThreshold || s.scaleRatio[1] > precisionThreshold) {
			drawRectLine(s)
		}

		// thin lines or too many points are rendered as simplified rect shader
		else if (s.join === 'rect' || (!s.join && (s.thickness <= 2 || s.positions.length >= maxPoints))) {
			drawRectLine(s)
		}
		else {
			drawMiterLine(s)
		}

		if (s.after) s.after(s)
	}

	function update (options) {
		if (!options) return

		if (options.length != null) {
			if (typeof options[0] === 'number') options = [{positions: options}]
		}

		// make options a batch
		else if (!Array.isArray(options)) options = [options]

		// global count of points
		let pointCount = 0

		// process per-line settings
		line2d.lines = lines = options.map((options, i) => {
			let state = lines[i]

			if (options === undefined) return state

			// null-argument resets positions
			if (options === null) options = { positions: null }
			else if (typeof options === 'function') options = {after: options}
			else if (typeof options[0] === 'number') options = {positions: options}

			// reduce by aliases
			options = pick(options, {
				positions: 'positions points data coords',
				thickness: 'thickness lineWidth lineWidths line-width linewidth width stroke-width strokewidth strokeWidth',
				join: 'lineJoin linejoin join type mode',
				miterLimit: 'miterlimit miterLimit',
				dashes: 'dash dashes dasharray dash-array dashArray',
				color: 'color stroke colors stroke-color strokeColor',
				fill: 'fill fill-color fillColor',
				opacity: 'alpha opacity',
				overlay: 'overlay crease overlap intersect',
				close: 'closed close closed-path closePath',
				range: 'range dataBox',
				viewport: 'viewport viewBox',
				hole: 'holes hole hollow',
				after: 'after callback done pass'
			})

			// reset positions
			if (options.positions === null) options.positions = []

			if (!state) {
				lines[i] = state = {
					id: i,
					scale: null,
					scaleFract: null,
					translate: null,
					translateFract: null,
					count: 0,
					offset: 0,
					dashLength: 0,
					hole: true
				}
				options = extend({}, defaults, options)
			}


			// calculate state values
			updateDiff(state, options, [{
				thickness: parseFloat,
				opacity: parseFloat,
				miterLimit: parseFloat,
				overlay: Boolean,
				join: j => j,
				after: fn => fn,
				hole: h => h || [],

				positions: (positions, state, options) => {
					positions = flatten(positions, 'float64')

					let count = Math.floor(positions.length / 2)
					let bounds = getBounds(positions, 2)

					// FIXME: make it dynamic
					if (!state.range && !options.range) {
						options.range = bounds
					}

					state.count = count
					state.bounds = bounds

					pointCount += count

					return positions
				},

				fill: c => {
					return !c ? null : rgba(c, 'uint8')
				},

				dashes: (dashes, state, options) => {
					let dashLength = state.dashLength,
						dashData

					if (!dashes || dashes.length < 2) {
						dashLength = 1.
						dashData = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255])
					}

					else {
						dashLength = 0.;
						for(let i = 0; i < dashes.length; ++i) {
							dashLength += dashes[i]
						}
						dashData = new Uint8Array(dashLength * dashMult)
						let ptr = 0
						let fillColor = 255

						// repeat texture two times to provide smooth 0-step
						for (let k = 0; k < 2; k++) {
							for(let i = 0; i < dashes.length; ++i) {
								for(let j = 0, l = dashes[i] * dashMult * .5; j < l; ++j) {
									dashData[ptr++] = fillColor
								}
								fillColor ^= 255
							}
						}
					}

					dashTexture.subimage({
						// channels: 1,
						data: dashData,
						width: dashData.length,
						height: 1
					}, 0, state.id)

					state.dashLength = dashLength

					return dashData
				}
			},

			// dependent properties & complement actions
			{
				close: (close, state, options) => {
					if (close != null) return close
					if (state.positions.length >= 4 &&
						state.positions[0] === state.positions[state.positions.length - 2] &&
						state.positions[1] === state.positions[state.positions.length - 1]) {
						return true
					}
					return false
				},

				positions: (p, state, options) => {
					if (state.fill && p.length) {
						let pos = []

						// filter bad vertices and remap triangles to ensure shape
						let ids = {}
						let lastId = 0

						for (let i = 0, ptr = 0, l = state.count; i < l; i++) {
							let x = state.positions[i*2]
							let y = state.positions[i*2 + 1]
							if (Number.isNaN(x) || Number.isNaN(y)) {
								x = state.positions[lastId*2]
								y = state.positions[lastId*2 + 1]
								ids[i] = lastId
							}
							else {
								lastId = i
							}
							pos[ptr++] = x
							pos[ptr++] = y
						}

						let triangles = triangulate(pos, state.hole)

						for (let i = 0, l = triangles.length; i < l; i++) {
							if (ids[triangles[i]] != null) triangles[i] = ids[triangles[i]]
						}

						state.triangles = triangles
					}
					return state.positions
				},

				color: (colors, state, options) => {
					let count = state.count

					if (!colors) colors = 'transparent'

					// 'black' or [0,0,0,0] case
					if (!Array.isArray(colors) || typeof colors[0] === 'number') {
						let color = colors;
						colors = Array(count);
						for (let i = 0; i < count; i++) {
							colors[i] = color
						}
					}

					if (colors.length < count) throw Error('Not enough colors')

					let colorData = new Uint8Array(count * 4 + 4)

					// convert colors to float arrays
					for (let i = 0; i < count; i++) {
						let c = rgba(colors[i], 'uint8')
						colorData.set(c, i * 4)
					}

					return colorData
				},

				range: (range, state, options) => {
					if (!state.count) return null

					let bounds = state.bounds
					if (!range) range = bounds

					let boundsW = bounds[2] - bounds[0],
						boundsH = bounds[3] - bounds[1]

					let rangeW = range[2] - range[0],
						rangeH = range[3] - range[1]

					state.scale = [
						boundsW / rangeW,
						boundsH / rangeH
					]
					state.translate = [
						-range[0] / rangeW + bounds[0] / rangeW || 0,
						-range[1] / rangeH + bounds[1] / rangeH || 0
					]

					state.scaleFract = fract32(state.scale)
					state.translateFract = fract32(state.translate)

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
			}])

			return state
		})

		// put collected data into buffers
		// FIXME: possible optimization is updating only segment subdata
		if (pointCount) {
			let len = pointCount * 2 + lines.length * 6;
			let positionData = new Float64Array(len)
			let offset = 0
			let colorData = new Uint8Array(len * 2)

			lines.forEach((state, i) => {
				if (!state) return

				let {positions, count, color} = state
				state.offset = offset

				if (!count) return

				// provide normalized positions
				let npos = new Float64Array(positions.length)
				npos.set(positions)
				normalize(npos, 2, state.bounds)

				// rotate first segment join
				if (state.close) {
					if (positions[0] === positions[count*2 - 2] &&
						positions[1] === positions[count*2 - 1]) {
						positionData[offset*2 + 0] = npos[count*2 - 4]
						positionData[offset*2 + 1] = npos[count*2 - 3]
					}
					else {
						positionData[offset*2 + 0] = npos[count*2 - 2]
						positionData[offset*2 + 1] = npos[count*2 - 1]
					}
				}
				else {
					positionData[offset*2 + 0] = npos[0]
					positionData[offset*2 + 1] = npos[1]
				}
				colorData[offset*4 + 0] = color[0]
				colorData[offset*4 + 1] = color[1]
				colorData[offset*4 + 2] = color[2]
				colorData[offset*4 + 3] = color[3]

				positionData.set(npos, offset * 2 + 2)
				colorData.set(color, offset * 4 + 4)

				// add last segment
				if (state.close) {
					// ignore coinciding start/end
					if (positions[0] === positions[count*2 - 2] &&
						positions[1] === positions[count*2 - 1]) {
						positionData[offset*2 + count*2 + 2] = npos[2]
						positionData[offset*2 + count*2 + 3] = npos[3]
						offset += count + 2
						state.count -= 1
					}
					else {
						positionData[offset*2 + count*2 + 2] = npos[0]
						positionData[offset*2 + count*2 + 3] = npos[1]
						positionData[offset*2 + count*2 + 4] = npos[2]
						positionData[offset*2 + count*2 + 5] = npos[3]
						offset += count + 3
					}
				}
				// add stub
				else {
					positionData[offset*2 + count*2 + 2] = npos[count*2 - 2]
					positionData[offset*2 + count*2 + 3] = npos[count*2 - 1]
					positionData[offset*2 + count*2 + 4] = npos[count*2 - 2]
					positionData[offset*2 + count*2 + 5] = npos[count*2 - 1]
					offset += count + 3
				}
			})

			colorBuffer(colorData)
			positionBuffer(float32(positionData))
			positionFractBuffer(fract32(positionData))
		}

		return line2d
	}

	function destroy () {
		lines.length = 0
		colorBuffer.destroy()
		offsetBuffer.destroy()
		positionBuffer.destroy()
		dashTexture.destroy()
	}

	return line2d
}


// return fractional part of float32 array
function fract32 (arr) {
	let fract = new Float32Array(arr.length)
	fract.set(arr)
	for (let i = 0, l = fract.length; i < l; i++) {
		fract[i] = arr[i] - fract[i]
	}
	return fract
}
function float32 (arr) {
	if (arr instanceof Float32Array) return arr

	let float = new Float32Array(arr)
	float.set(arr)
	return float
}
