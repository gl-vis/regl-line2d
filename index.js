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
const dprop = require('dprop')
const triangulate = require('earcut')

module.exports = createLine


function createLine (options) {
	if (!options) options = {}
	else if (typeof options === 'function') options = {regl: options}
	else if (options.length) options = {positions: options}

	// persistent variables
	let regl, gl, properties, drawMiterLine, drawRectLine, drawFill, colorBuffer, offsetBuffer, positionBuffer, positionFractBuffer, dashTexture, fbo,

		// used to for new lines instances
		defaultOptions = {
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

	const dashMult = 2, dashTextureWidth = 1024, dashTextureHeight = 256, precisionThreshold = 3e6


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
		if (!opts.optionalExtensions) opts.optionalExtensions = []

		//FIXME: use fallback if not available
		opts.extensions.push('ANGLE_instanced_arrays')
		opts.optionalExtensions.push('EXT_blend_minmax')

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
	positionFractBuffer = regl.buffer({
		usage: 'dynamic',
		type: 'float',
		data: null
	})
	dashTexture = regl.texture({
		channels: 1,
		width: dashTextureWidth,
		height: dashTextureHeight,
		mag: 'linear',
		min: 'linear'
	})
	fbo = regl.framebuffer({
		width: gl.drawingBufferWidth,
		height: gl.drawingBufferHeight,
		depthStencil: false
	})

	//expose API
	extend(line2d, {
		update: update,
		draw: line2d,
		destroy: destroy,
		regl: regl,
		gl: gl,
		canvas: gl.canvas,
		lines: lines
	})

	//init defaults
	update(options)


	let shaderOptions = {
		primitive: 'triangle strip',
		instances: regl.prop('count'),
		count: 4,
		offset: 0,

		uniforms: {
			miterLimit: regl.prop('miterLimit'),
			scale: regl.prop('scale'),
			scaleFract: regl.prop('scaleFract'),
			translateFract: regl.prop('translateFract'),
			translate: regl.prop('translate'),
			thickness: regl.prop('thickness'),
			dashPattern: dashTexture,
			dashLength: regl.prop('dashLength'),
			dashShape: [dashTextureWidth, dashTextureHeight],
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

	//create regl draw
	drawMiterLine = regl(extend({
		//culling removes polygon creasing
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
		}
	}, shaderOptions))

	//simplified rectangular line shader
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
			color: (ctx, prop) => prop.color.length > 4 ? {
				buffer: colorBuffer,
				stride: 4,
				offset: 0,
				divisor: 1
			} : {
				constant: prop.color
			}
		}
	}, shaderOptions))


	//fill shader
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
		let batch = lines.filter(state => state.count)

 		let [rectBatch, miterBatch, fillBatch] = batch.reduce((acc, s, i) => {
 			if (s.fill) acc[2].push(s)

 			if (!s.thickness || !s.count || !s.color || !s.opacity) return acc

 			s.scaleRatio = [
 				s.scale[0] * s.viewport.width,
 				s.scale[1] * s.viewport.height
 			]

 			//high scale is only available for rect mode with precision
 			if (s.scaleRatio[0] > precisionThreshold || s.scaleRatio[1] > precisionThreshold) {
 				acc[0].push(s)
 			}

 			else if (s.join === 'rect' || (!s.join && (s.thickness <= 2 || s.positions.length >= 1e4))) {
 				acc[0].push(s)
 			}
 			else acc[1].push(s)
			return acc
 		}, [[], [], []])

		regl._refresh()
		drawFill(fillBatch)

 		regl._refresh()
		drawMiterLine(miterBatch)

 		regl._refresh()
		drawRectLine(rectBatch)
	}


	function update (options) {
		if (options.length != null) {
			if (typeof options[0] === 'number') options = {positions: options}
		}

		//make options a batch
		if (!Array.isArray(options)) options = [options]

		//global count of points
		let pointCount = 0

		//process per-line settings
		lines = options.map((options, i) => {
			if (!options) return
			if (typeof options[0] === 'number') options = {positions: options}

			let state = lines[i]

			//reduce by aliases
			options = pick(options, {
				positions: 'positions points data',
				thickness: 'thickness lineWidth lineWidths line-width linewidth width stroke-width strokewidth strokeWidth',
				join: 'lineJoin linejoin join',
				miterLimit: 'miterlimit miterLimit',
				dashes: 'dash dashes dasharray dash-array dashArray',
				color: 'color stroke colors stroke-color strokeColor',
				fill: 'fill fill-color fillColor',
				opacity: 'alpha opacity',
				overlay: 'overlay crease overlap intersect',
				close: 'closed close closed-path closePath',
				range: 'bounds range dataBox',
				viewport: 'viewport viewBox'
			})

			//prototype here keeps defaultOptions live-updated
			if (!state) {
				lines[i] = state = {
					id: i,
					raw: {},
					scale: null,
					translate: null,
					count: 0,
					offset: 0,
					dashLength: 0
				}
				options = extend({}, defaultOptions, options)
			}

			//consider only not changed properties
			options = filter(options, (key, value) => {
				if (Array.isArray(value)) return true
				return value !== undefined && state.raw[key] !== value
			})

			//cache properties
			extend(state.raw, options)

			//calculate state values
			extend(state, mapProp(options, {
				thickness: parseFloat,
				opacity: parseFloat,
				miterLimit: parseFloat,
				overlay: Boolean,
				join: j => j,

				positions: positions => {
					positions = flatten(positions, 'float64')

					let count = state.count = Math.floor(positions.length / 2)
					let bounds = state.bounds = getBounds(positions, 2)

					//grouped positions
					let points = Array(count)
					for (let i = 0; i < count; i++) {
						points[i] = [
							positions[i*2],
							positions[i*2+1]
						]
					}
					state.points = points

					//remove repeating tail/beginning points

					if (!state.range) state.range = bounds

					pointCount += count

					return positions
				},

				fill: c => {
					if (typeof c === 'string') {
						c = rgba(c, false)
						c[3] *= 255
						c = new Uint8Array(c)
					}
					else if (Array.isArray(c) || c instanceof Float32Array || c instanceof Float64Array) {
						c = new Uint8Array(c)
						c[0] *= 255
						c[1] *= 255
						c[2] *= 255
						c[3] *= 255
					}

					return c
				},

				color: colors => {
					let color

					if (!colors) colors = 'transparent'

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

				dashes: dashes => {
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

						//repeat texture two times to provide smooth 0-step
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
			}))

			//dependent properties & complement actions
			extend(state, mapProp(options, {
				close: close => {
					if (close != null) return close
					if (state.positions.length >= 4 &&
						state.positions[0] === state.positions[state.positions.length - 2] &&
						state.positions[1] === state.positions[state.positions.length - 1]) {
						return true
					}
					return false
				},

				positions: p => {
					if (state.fill && p.length) {
						state.triangles = triangulate(state.positions)
					}
				},

				range: range => {
					let bounds = state.bounds
					if (!range) range = bounds

					state.scale = [1 / (range[2] - range[0]), 1 / (range[3] - range[1])]
					state.translate = [-range[0], -range[1]]

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
			}))


			return state
		})

		//put collected data into buffers
		//FIXME: possible optimization is updating only segment subdata
		if (pointCount) {
			let len = pointCount * 2 + lines.length * 6;
			let positionData = new Float64Array(len)
			let offset = 0

			lines.forEach((state, i) => {
				let {positions, count} = state
				state.offset = offset

				if (!count) return

				//rotate first segment join
				if (state.close) {
					if (positions[0] === positions[count*2 - 2] &&
						positions[1] === positions[count*2 - 1]) {
						positionData[offset*2 + 0] = positions[count*2 - 4]
						positionData[offset*2 + 1] = positions[count*2 - 3]
					}
					else {
						positionData[offset*2 + 0] = positions[count*2 - 2]
						positionData[offset*2 + 1] = positions[count*2 - 1]
					}
				}
				else {
					positionData[offset*2 + 0] = positions[0]
					positionData[offset*2 + 1] = positions[1]
				}

				positionData.set(positions, offset * 2 + 2)

				//add last segment
				if (state.close) {
					//ignore coinciding start/end
					if (positions[0] === positions[count*2 - 2] &&
						positions[1] === positions[count*2 - 1]) {
						positionData[offset*2 + count*2 + 2] = positions[2]
						positionData[offset*2 + count*2 + 3] = positions[3]
						offset += count + 2
						state.count -= 1
					}
					else {
						positionData[offset*2 + count*2 + 2] = positions[0]
						positionData[offset*2 + count*2 + 3] = positions[1]
						positionData[offset*2 + count*2 + 4] = positions[2]
						positionData[offset*2 + count*2 + 5] = positions[3]
						offset += count + 3
					}
				}
				//add stub
				else {
					positionData[offset*2 + count*2 + 2] = positions[count*2 - 2]
					positionData[offset*2 + count*2 + 3] = positions[count*2 - 1]
					positionData[offset*2 + count*2 + 4] = positions[count*2 - 2]
					positionData[offset*2 + count*2 + 5] = positions[count*2 - 1]
					offset += count + 3
				}
			})

			positionBuffer(float32(positionData))
			positionFractBuffer(fract32(positionData))
		}

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


//return fractional part of float32 array
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
