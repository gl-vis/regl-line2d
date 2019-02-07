(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.reglLine2d = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
'use strict'


var rgba = require('color-normalize')
var getBounds = require('array-bounds')
var extend = require('object-assign')
var glslify = require('glslify')
var pick = require('pick-by-alias')
var flatten = require('flatten-vertex-data')
var triangulate = require('earcut')
var normalize = require('array-normalize')
var ref = require('to-float32');
var float32 = ref.float32;
var fract32 = ref.fract32;
var WeakMap = require('es6-weak-map')
var parseRect = require('parse-rect')


module.exports = Line2D


/** @constructor */
function Line2D (regl, options) {
	if (!(this instanceof Line2D)) { return new Line2D(regl, options) }

	if (typeof regl === 'function') {
		if (!options) { options = {} }
		options.regl = regl
	}
	else {
		options = regl
	}
	if (options.length) { options.positions = options }
	regl = options.regl

	if (!regl.hasExtension('ANGLE_instanced_arrays')) {
		throw Error('regl-error2d: `ANGLE_instanced_arrays` extension should be enabled');
	}

	// persistent variables
	this.gl = regl._gl
	this.regl = regl

	// list of options for lines
	this.passes = []

	// cached shaders instance
	this.shaders = Line2D.shaders.has(regl) ? Line2D.shaders.get(regl) : Line2D.shaders.set(regl, Line2D.createShaders(regl)).get(regl)


	// init defaults
	this.update(options)
}


Line2D.dashMult = 2
Line2D.maxPatternLength = 256
Line2D.precisionThreshold = 3e6
Line2D.maxPoints = 1e4
Line2D.maxLines = 2048


// cache of created draw calls per-regl instance
Line2D.shaders = new WeakMap()


// create static shaders once
Line2D.createShaders = function (regl) {
	var offsetBuffer = regl.buffer({
		usage: 'static',
		type: 'float',
		data: [0,1, 0,0, 1,1, 1,0]
	})

	var shaderOptions = {
		primitive: 'triangle strip',
		instances: regl.prop('count'),
		count: 4,
		offset: 0,

		uniforms: {
			miterMode: function (ctx, prop) { return prop.join === 'round' ? 2 : 1; },
			miterLimit: regl.prop('miterLimit'),
			scale: regl.prop('scale'),
			scaleFract: regl.prop('scaleFract'),
			translateFract: regl.prop('translateFract'),
			translate: regl.prop('translate'),
			thickness: regl.prop('thickness'),
			dashPattern: regl.prop('dashTexture'),
			opacity: regl.prop('opacity'),
			pixelRatio: regl.context('pixelRatio'),
			id: regl.prop('id'),
			dashSize: regl.prop('dashLength'),
			viewport: function (c, p) { return [p.viewport.x, p.viewport.y, c.viewportWidth, c.viewportHeight]; },
			depth: regl.prop('depth')
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
			enable: function (c, p) {
				return !p.overlay
			}
		},
		stencil: {enable: false},
		scissor: {
			enable: true,
			box: regl.prop('viewport')
		},
		viewport: regl.prop('viewport')
	}


	// simplified rectangular line shader
	var drawRectLine = regl(extend({
		vert: glslify(["precision highp float;\n#define GLSLIFY 1\n\nattribute vec2 aCoord, bCoord, aCoordFract, bCoordFract;\nattribute vec4 color;\nattribute float lineEnd, lineTop;\n\nuniform vec2 scale, scaleFract, translate, translateFract;\nuniform float thickness, pixelRatio, id, depth;\nuniform vec4 viewport;\n\nvarying vec4 fragColor;\nvarying vec2 tangent;\n\nvec2 project(vec2 position, vec2 positionFract, vec2 scale, vec2 scaleFract, vec2 translate, vec2 translateFract) {\n\t// the order is important\n\treturn position * scale + translate\n       + positionFract * scale + translateFract\n       + position * scaleFract\n       + positionFract * scaleFract;\n}\n\nvoid main() {\n\tfloat lineStart = 1. - lineEnd;\n\tfloat lineOffset = lineTop * 2. - 1.;\n\n\tvec2 diff = (bCoord + bCoordFract - aCoord - aCoordFract);\n\ttangent = normalize(diff * scale * viewport.zw);\n\tvec2 normal = vec2(-tangent.y, tangent.x);\n\n\tvec2 position = project(aCoord, aCoordFract, scale, scaleFract, translate, translateFract) * lineStart\n\t\t+ project(bCoord, bCoordFract, scale, scaleFract, translate, translateFract) * lineEnd\n\n\t\t+ thickness * normal * .5 * lineOffset / viewport.zw;\n\n\tgl_Position = vec4(position * 2.0 - 1.0, depth, 1);\n\n\tfragColor = color / 255.;\n}\n"]),
		frag: glslify(["precision highp float;\n#define GLSLIFY 1\n\nuniform sampler2D dashPattern;\n\nuniform float dashSize, pixelRatio, thickness, opacity, id;\n\nvarying vec4 fragColor;\nvarying vec2 tangent;\n\nvoid main() {\n\tfloat alpha = 1.;\n\n\tfloat t = fract(dot(tangent, gl_FragCoord.xy) / dashSize) * .5 + .25;\n\tfloat dash = texture2D(dashPattern, vec2(t, .5)).r;\n\n\tgl_FragColor = fragColor;\n\tgl_FragColor.a *= alpha * opacity * dash;\n}\n"]),

		attributes: {
			// if point is at the end of segment
			lineEnd: {
				buffer: offsetBuffer,
				divisor: 0,
				stride: 8,
				offset: 0
			},
			// if point is at the top of segment
			lineTop: {
				buffer: offsetBuffer,
				divisor: 0,
				stride: 8,
				offset: 4
			},
			// beginning of line coordinate
			aCoord: {
				buffer: regl.prop('positionBuffer'),
				stride: 8,
				offset: 8,
				divisor: 1
			},
			// end of line coordinate
			bCoord: {
				buffer: regl.prop('positionBuffer'),
				stride: 8,
				offset: 16,
				divisor: 1
			},
			aCoordFract: {
				buffer: regl.prop('positionFractBuffer'),
				stride: 8,
				offset: 8,
				divisor: 1
			},
			bCoordFract: {
				buffer: regl.prop('positionFractBuffer'),
				stride: 8,
				offset: 16,
				divisor: 1
			},
			color: {
				buffer: regl.prop('colorBuffer'),
				stride: 4,
				offset: 0,
				divisor: 1
			}
		}
	}, shaderOptions))

	// create regl draw
	var drawMiterLine

	try {
		drawMiterLine = regl(extend({
			// culling removes polygon creasing
			cull: {
				enable: true,
				face: 'back'
			},

			vert: glslify(["precision highp float;\n#define GLSLIFY 1\n\nattribute vec2 aCoord, bCoord, nextCoord, prevCoord;\nattribute vec4 aColor, bColor;\nattribute float lineEnd, lineTop;\n\nuniform vec2 scale, translate;\nuniform float thickness, pixelRatio, id, depth;\nuniform vec4 viewport;\nuniform float miterLimit, miterMode;\n\nvarying vec4 fragColor;\nvarying vec4 startCutoff, endCutoff;\nvarying vec2 tangent;\nvarying vec2 startCoord, endCoord;\nvarying float enableStartMiter, enableEndMiter;\n\nconst float REVERSE_THRESHOLD = -.875;\nconst float MIN_DIFF = 1e-6;\n\n// TODO: possible optimizations: avoid overcalculating all for vertices and calc just one instead\n// TODO: precalculate dot products, normalize things beforehead etc.\n// TODO: refactor to rectangular algorithm\n\nfloat distToLine(vec2 p, vec2 a, vec2 b) {\n\tvec2 diff = b - a;\n\tvec2 perp = normalize(vec2(-diff.y, diff.x));\n\treturn dot(p - a, perp);\n}\n\nbool isNaN( float val ){\n  return ( val < 0.0 || 0.0 < val || val == 0.0 ) ? false : true;\n}\n\nvoid main() {\n\tvec2 aCoord = aCoord, bCoord = bCoord, prevCoord = prevCoord, nextCoord = nextCoord;\n\n  vec2 adjustedScale;\n  adjustedScale.x = (abs(scale.x) < MIN_DIFF) ? MIN_DIFF : scale.x;\n  adjustedScale.y = (abs(scale.y) < MIN_DIFF) ? MIN_DIFF : scale.y;\n\n  vec2 scaleRatio = adjustedScale * viewport.zw;\n\tvec2 normalWidth = thickness / scaleRatio;\n\n\tfloat lineStart = 1. - lineEnd;\n\tfloat lineBot = 1. - lineTop;\n\n\tfragColor = (lineStart * aColor + lineEnd * bColor) / 255.;\n\n\tif (isNaN(aCoord.x) || isNaN(aCoord.y) || isNaN(bCoord.x) || isNaN(bCoord.y)) return;\n\n\tif (aCoord == prevCoord) prevCoord = aCoord + normalize(bCoord - aCoord);\n\tif (bCoord == nextCoord) nextCoord = bCoord - normalize(bCoord - aCoord);\n\n\tvec2 prevDiff = aCoord - prevCoord;\n\tvec2 currDiff = bCoord - aCoord;\n\tvec2 nextDiff = nextCoord - bCoord;\n\n\tvec2 prevTangent = normalize(prevDiff * scaleRatio);\n\tvec2 currTangent = normalize(currDiff * scaleRatio);\n\tvec2 nextTangent = normalize(nextDiff * scaleRatio);\n\n\tvec2 prevNormal = vec2(-prevTangent.y, prevTangent.x);\n\tvec2 currNormal = vec2(-currTangent.y, currTangent.x);\n\tvec2 nextNormal = vec2(-nextTangent.y, nextTangent.x);\n\n\tvec2 startJoinDirection = normalize(prevTangent - currTangent);\n\tvec2 endJoinDirection = normalize(currTangent - nextTangent);\n\n\t// collapsed/unidirectional segment cases\n\t// FIXME: there should be more elegant solution\n\tvec2 prevTanDiff = abs(prevTangent - currTangent);\n\tvec2 nextTanDiff = abs(nextTangent - currTangent);\n\tif (max(prevTanDiff.x, prevTanDiff.y) < MIN_DIFF) {\n\t\tstartJoinDirection = currNormal;\n\t}\n\tif (max(nextTanDiff.x, nextTanDiff.y) < MIN_DIFF) {\n\t\tendJoinDirection = currNormal;\n\t}\n\tif (aCoord == bCoord) {\n\t\tendJoinDirection = startJoinDirection;\n\t\tcurrNormal = prevNormal;\n\t\tcurrTangent = prevTangent;\n\t}\n\n\ttangent = currTangent;\n\n\t//calculate join shifts relative to normals\n\tfloat startJoinShift = dot(currNormal, startJoinDirection);\n\tfloat endJoinShift = dot(currNormal, endJoinDirection);\n\n\tfloat startMiterRatio = abs(1. / startJoinShift);\n\tfloat endMiterRatio = abs(1. / endJoinShift);\n\n\tvec2 startJoin = startJoinDirection * startMiterRatio;\n\tvec2 endJoin = endJoinDirection * endMiterRatio;\n\n\tvec2 startTopJoin, startBotJoin, endTopJoin, endBotJoin;\n\tstartTopJoin = sign(startJoinShift) * startJoin * .5;\n\tstartBotJoin = -startTopJoin;\n\n\tendTopJoin = sign(endJoinShift) * endJoin * .5;\n\tendBotJoin = -endTopJoin;\n\n\tvec2 aTopCoord = aCoord + normalWidth * startTopJoin;\n\tvec2 bTopCoord = bCoord + normalWidth * endTopJoin;\n\tvec2 aBotCoord = aCoord + normalWidth * startBotJoin;\n\tvec2 bBotCoord = bCoord + normalWidth * endBotJoin;\n\n\t//miter anti-clipping\n\tfloat baClipping = distToLine(bCoord, aCoord, aBotCoord) / dot(normalize(normalWidth * endBotJoin), normalize(normalWidth.yx * vec2(-startBotJoin.y, startBotJoin.x)));\n\tfloat abClipping = distToLine(aCoord, bCoord, bTopCoord) / dot(normalize(normalWidth * startBotJoin), normalize(normalWidth.yx * vec2(-endBotJoin.y, endBotJoin.x)));\n\n\t//prevent close to reverse direction switch\n\tbool prevReverse = dot(currTangent, prevTangent) <= REVERSE_THRESHOLD && abs(dot(currTangent, prevNormal)) * min(length(prevDiff), length(currDiff)) <  length(normalWidth * currNormal);\n\tbool nextReverse = dot(currTangent, nextTangent) <= REVERSE_THRESHOLD && abs(dot(currTangent, nextNormal)) * min(length(nextDiff), length(currDiff)) <  length(normalWidth * currNormal);\n\n\tif (prevReverse) {\n\t\t//make join rectangular\n\t\tvec2 miterShift = normalWidth * startJoinDirection * miterLimit * .5;\n\t\tfloat normalAdjust = 1. - min(miterLimit / startMiterRatio, 1.);\n\t\taBotCoord = aCoord + miterShift - normalAdjust * normalWidth * currNormal * .5;\n\t\taTopCoord = aCoord + miterShift + normalAdjust * normalWidth * currNormal * .5;\n\t}\n\telse if (!nextReverse && baClipping > 0. && baClipping < length(normalWidth * endBotJoin)) {\n\t\t//handle miter clipping\n\t\tbTopCoord -= normalWidth * endTopJoin;\n\t\tbTopCoord += normalize(endTopJoin * normalWidth) * baClipping;\n\t}\n\n\tif (nextReverse) {\n\t\t//make join rectangular\n\t\tvec2 miterShift = normalWidth * endJoinDirection * miterLimit * .5;\n\t\tfloat normalAdjust = 1. - min(miterLimit / endMiterRatio, 1.);\n\t\tbBotCoord = bCoord + miterShift - normalAdjust * normalWidth * currNormal * .5;\n\t\tbTopCoord = bCoord + miterShift + normalAdjust * normalWidth * currNormal * .5;\n\t}\n\telse if (!prevReverse && abClipping > 0. && abClipping < length(normalWidth * startBotJoin)) {\n\t\t//handle miter clipping\n\t\taBotCoord -= normalWidth * startBotJoin;\n\t\taBotCoord += normalize(startBotJoin * normalWidth) * abClipping;\n\t}\n\n\tvec2 aTopPosition = (aTopCoord) * adjustedScale + translate;\n\tvec2 aBotPosition = (aBotCoord) * adjustedScale + translate;\n\n\tvec2 bTopPosition = (bTopCoord) * adjustedScale + translate;\n\tvec2 bBotPosition = (bBotCoord) * adjustedScale + translate;\n\n\t//position is normalized 0..1 coord on the screen\n\tvec2 position = (aTopPosition * lineTop + aBotPosition * lineBot) * lineStart + (bTopPosition * lineTop + bBotPosition * lineBot) * lineEnd;\n\n\tstartCoord = aCoord * scaleRatio + translate * viewport.zw + viewport.xy;\n\tendCoord = bCoord * scaleRatio + translate * viewport.zw + viewport.xy;\n\n\tgl_Position = vec4(position  * 2.0 - 1.0, depth, 1);\n\n\tenableStartMiter = step(dot(currTangent, prevTangent), .5);\n\tenableEndMiter = step(dot(currTangent, nextTangent), .5);\n\n\t//bevel miter cutoffs\n\tif (miterMode == 1.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tvec2 startMiterWidth = vec2(startJoinDirection) * thickness * miterLimit * .5;\n\t\t\tstartCutoff = vec4(aCoord, aCoord);\n\t\t\tstartCutoff.zw += vec2(-startJoinDirection.y, startJoinDirection.x) / scaleRatio;\n\t\t\tstartCutoff = startCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tstartCutoff += viewport.xyxy;\n\t\t\tstartCutoff += startMiterWidth.xyxy;\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tvec2 endMiterWidth = vec2(endJoinDirection) * thickness * miterLimit * .5;\n\t\t\tendCutoff = vec4(bCoord, bCoord);\n\t\t\tendCutoff.zw += vec2(-endJoinDirection.y, endJoinDirection.x)  / scaleRatio;\n\t\t\tendCutoff = endCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tendCutoff += viewport.xyxy;\n\t\t\tendCutoff += endMiterWidth.xyxy;\n\t\t}\n\t}\n\n\t//round miter cutoffs\n\telse if (miterMode == 2.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tvec2 startMiterWidth = vec2(startJoinDirection) * thickness * abs(dot(startJoinDirection, currNormal)) * .5;\n\t\t\tstartCutoff = vec4(aCoord, aCoord);\n\t\t\tstartCutoff.zw += vec2(-startJoinDirection.y, startJoinDirection.x) / scaleRatio;\n\t\t\tstartCutoff = startCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tstartCutoff += viewport.xyxy;\n\t\t\tstartCutoff += startMiterWidth.xyxy;\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tvec2 endMiterWidth = vec2(endJoinDirection) * thickness * abs(dot(endJoinDirection, currNormal)) * .5;\n\t\t\tendCutoff = vec4(bCoord, bCoord);\n\t\t\tendCutoff.zw += vec2(-endJoinDirection.y, endJoinDirection.x)  / scaleRatio;\n\t\t\tendCutoff = endCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tendCutoff += viewport.xyxy;\n\t\t\tendCutoff += endMiterWidth.xyxy;\n\t\t}\n\t}\n}\n"]),
			frag: glslify(["precision highp float;\n#define GLSLIFY 1\n\nuniform sampler2D dashPattern;\nuniform float dashSize, pixelRatio, thickness, opacity, id, miterMode;\n\nvarying vec4 fragColor;\nvarying vec2 tangent;\nvarying vec4 startCutoff, endCutoff;\nvarying vec2 startCoord, endCoord;\nvarying float enableStartMiter, enableEndMiter;\n\nfloat distToLine(vec2 p, vec2 a, vec2 b) {\n\tvec2 diff = b - a;\n\tvec2 perp = normalize(vec2(-diff.y, diff.x));\n\treturn dot(p - a, perp);\n}\n\nvoid main() {\n\tfloat alpha = 1., distToStart, distToEnd;\n\tfloat cutoff = thickness * .5;\n\n\t//bevel miter\n\tif (miterMode == 1.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tdistToStart = distToLine(gl_FragCoord.xy, startCutoff.xy, startCutoff.zw);\n\t\t\tif (distToStart < -1.) {\n\t\t\t\tdiscard;\n\t\t\t\treturn;\n\t\t\t}\n\t\t\talpha *= min(max(distToStart + 1., 0.), 1.);\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tdistToEnd = distToLine(gl_FragCoord.xy, endCutoff.xy, endCutoff.zw);\n\t\t\tif (distToEnd < -1.) {\n\t\t\t\tdiscard;\n\t\t\t\treturn;\n\t\t\t}\n\t\t\talpha *= min(max(distToEnd + 1., 0.), 1.);\n\t\t}\n\t}\n\n\t// round miter\n\telse if (miterMode == 2.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tdistToStart = distToLine(gl_FragCoord.xy, startCutoff.xy, startCutoff.zw);\n\t\t\tif (distToStart < 0.) {\n\t\t\t\tfloat radius = length(gl_FragCoord.xy - startCoord);\n\n\t\t\t\tif(radius > cutoff + .5) {\n\t\t\t\t\tdiscard;\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n\t\t\t\talpha -= smoothstep(cutoff - .5, cutoff + .5, radius);\n\t\t\t}\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tdistToEnd = distToLine(gl_FragCoord.xy, endCutoff.xy, endCutoff.zw);\n\t\t\tif (distToEnd < 0.) {\n\t\t\t\tfloat radius = length(gl_FragCoord.xy - endCoord);\n\n\t\t\t\tif(radius > cutoff + .5) {\n\t\t\t\t\tdiscard;\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n\t\t\t\talpha -= smoothstep(cutoff - .5, cutoff + .5, radius);\n\t\t\t}\n\t\t}\n\t}\n\n\tfloat t = fract(dot(tangent, gl_FragCoord.xy) / dashSize) * .5 + .25;\n\tfloat dash = texture2D(dashPattern, vec2(t, .5)).r;\n\n\tgl_FragColor = fragColor;\n\tgl_FragColor.a *= alpha * opacity * dash;\n}\n"]),

			attributes: {
				// is line end
				lineEnd: {
					buffer: offsetBuffer,
					divisor: 0,
					stride: 8,
					offset: 0
				},
				// is line top
				lineTop: {
					buffer: offsetBuffer,
					divisor: 0,
					stride: 8,
					offset: 4
				},
				// left color
				aColor: {
					buffer: regl.prop('colorBuffer'),
					stride: 4,
					offset: 0,
					divisor: 1
				},
				// right color
				bColor: {
					buffer: regl.prop('colorBuffer'),
					stride: 4,
					offset: 4,
					divisor: 1
				},
				prevCoord: {
					buffer: regl.prop('positionBuffer'),
					stride: 8,
					offset: 0,
					divisor: 1
				},
				aCoord: {
					buffer: regl.prop('positionBuffer'),
					stride: 8,
					offset: 8,
					divisor: 1
				},
				bCoord: {
					buffer: regl.prop('positionBuffer'),
					stride: 8,
					offset: 16,
					divisor: 1
				},
				nextCoord: {
					buffer: regl.prop('positionBuffer'),
					stride: 8,
					offset: 24,
					divisor: 1
				}
			}
		}, shaderOptions))
	} catch (e) {
		// IE/bad Webkit fallback
		drawMiterLine = drawRectLine
	}

	// fill shader
	var drawFill = regl({
		primitive: 'triangle',
		elements: function (ctx, prop) { return prop.triangles; },
		offset: 0,

		vert: glslify(["precision highp float;\n#define GLSLIFY 1\n\nattribute vec2 position, positionFract;\n\nuniform vec4 color;\nuniform vec2 scale, scaleFract, translate, translateFract;\nuniform float pixelRatio, id;\nuniform vec4 viewport;\nuniform float opacity;\n\nvarying vec4 fragColor;\n\nconst float MAX_LINES = 256.;\n\nvoid main() {\n\tfloat depth = (MAX_LINES - 4. - id) / (MAX_LINES);\n\n\tvec2 position = position * scale + translate\n       + positionFract * scale + translateFract\n       + position * scaleFract\n       + positionFract * scaleFract;\n\n\tgl_Position = vec4(position * 2.0 - 1.0, depth, 1);\n\n\tfragColor = color / 255.;\n\tfragColor.a *= opacity;\n}\n"]),
		frag: glslify(["precision highp float;\n#define GLSLIFY 1\n\nvarying vec4 fragColor;\n\nvoid main() {\n\tgl_FragColor = fragColor;\n}\n"]),

		uniforms: {
			scale: regl.prop('scale'),
			color: regl.prop('fill'),
			scaleFract: regl.prop('scaleFract'),
			translateFract: regl.prop('translateFract'),
			translate: regl.prop('translate'),
			opacity: regl.prop('opacity'),
			pixelRatio: regl.context('pixelRatio'),
			id: regl.prop('id'),
			viewport: function (ctx, prop) { return [prop.viewport.x, prop.viewport.y, ctx.viewportWidth, ctx.viewportHeight]; }
		},

		attributes: {
			position: {
				buffer: regl.prop('positionBuffer'),
				stride: 8,
				offset: 8
			},
			positionFract: {
				buffer: regl.prop('positionFractBuffer'),
				stride: 8,
				offset: 8
			}
		},

		blend: shaderOptions.blend,

		depth: { enable: false },
		scissor: shaderOptions.scissor,
		stencil: shaderOptions.stencil,
		viewport: shaderOptions.viewport
	})

	return {
		fill: drawFill, rect: drawRectLine, miter: drawMiterLine
	}
}


// used to for new lines instances
Line2D.defaults = {
	dashes: null,
	join: 'miter',
	miterLimit: 1,
	thickness: 10,
	cap: 'square',
	color: 'black',
	opacity: 1,
	overlay: false,
	viewport: null,
	range: null,
	close: false,
	fill: null
}


Line2D.prototype.render = function () {
	var ref;

	var args = [], len = arguments.length;
	while ( len-- ) args[ len ] = arguments[ len ];
	if (args.length) {
		(ref = this).update.apply(ref, args)
	}

	this.draw()
}


Line2D.prototype.draw = function () {
	var this$1 = this;
	var args = [], len = arguments.length;
	while ( len-- ) args[ len ] = arguments[ len ];

	// render multiple polylines via regl batch
	(args.length ? args : this.passes).forEach(function (s, i) {
		var ref;

		// render array pass as a list of passes
		if (s && Array.isArray(s)) { return (ref = this$1).draw.apply(ref, s) }

		if (typeof s === 'number') { s = this$1.passes[s] }

		if (!(s && s.count > 1 && s.opacity)) { return }

		this$1.regl._refresh()

		if (s.fill && s.triangles && s.triangles.length > 2) {
			this$1.shaders.fill(s)
		}

		if (!s.thickness) { return }

		// high scale is only available for rect mode with precision
		if (s.scale[0] * s.viewport.width > Line2D.precisionThreshold || s.scale[1] * s.viewport.height > Line2D.precisionThreshold) {
			this$1.shaders.rect(s)
		}

		// thin this.passes or too many points are rendered as simplified rect shader
		else if (s.join === 'rect' || (!s.join && (s.thickness <= 2 || s.count >= Line2D.maxPoints))) {
			this$1.shaders.rect(s)
		}
		else {
			this$1.shaders.miter(s)
		}
	})

	return this
}

Line2D.prototype.update = function (options) {
	var this$1 = this;

	if (!options) { return }

	if (options.length != null) {
		if (typeof options[0] === 'number') { options = [{positions: options}] }
	}

	// make options a batch
	else if (!Array.isArray(options)) { options = [options] }

	var ref = this;
	var regl = ref.regl;
	var gl = ref.gl;

	// process per-line settings
	options.forEach(function (o, i) {
		var state = this$1.passes[i]

		if (o === undefined) { return }

		// null-argument removes pass
		if (o === null) {
			this$1.passes[i] = null
			return
		}

		if (typeof o[0] === 'number') { o = {positions: o} }

		// handle aliases
		o = pick(o, {
			positions: 'positions points data coords',
			thickness: 'thickness lineWidth lineWidths line-width linewidth width stroke-width strokewidth strokeWidth',
			join: 'lineJoin linejoin join type mode',
			miterLimit: 'miterlimit miterLimit',
			dashes: 'dash dashes dasharray dash-array dashArray',
			color: 'color colour stroke colors colours stroke-color strokeColor',
			fill: 'fill fill-color fillColor',
			opacity: 'alpha opacity',
			overlay: 'overlay crease overlap intersect',
			close: 'closed close closed-path closePath',
			range: 'range dataBox',
			viewport: 'viewport viewBox',
			hole: 'holes hole hollow'
		})

		// init state
		if (!state) {
			this$1.passes[i] = state = {
				id: i,
				scale: null,
				scaleFract: null,
				translate: null,
				translateFract: null,
				count: 0,
				hole: [],
				depth: 0,

				dashLength: 1,
				dashTexture: regl.texture({
					channels: 1,
					data: new Uint8Array([255]),
					width: 1,
					height: 1,
					mag: 'linear',
					min: 'linear'
				}),

				colorBuffer: regl.buffer({
					usage: 'dynamic',
					type: 'uint8',
					data: new Uint8Array()
				}),
				positionBuffer: regl.buffer({
					usage: 'dynamic',
					type: 'float',
					data: new Uint8Array()
				}),
				positionFractBuffer: regl.buffer({
					usage: 'dynamic',
					type: 'float',
					data: new Uint8Array()
				})
			}

			o = extend({}, Line2D.defaults, o)
		}
		if (o.thickness != null) { state.thickness = parseFloat(o.thickness) }
		if (o.opacity != null) { state.opacity = parseFloat(o.opacity) }
		if (o.miterLimit != null) { state.miterLimit = parseFloat(o.miterLimit) }
		if (o.overlay != null) {
			state.overlay = !!o.overlay
			if (i < Line2D.maxLines) {
				state.depth = 2 * (Line2D.maxLines - 1 - i % Line2D.maxLines) / Line2D.maxLines - 1.;
			}
		}
		if (o.join != null) { state.join = o.join }
		if (o.hole != null) { state.hole = o.hole }
		if (o.fill != null) { state.fill = !o.fill ? null : rgba(o.fill, 'uint8') }
		if (o.viewport != null) { state.viewport = parseRect(o.viewport) }

		if (!state.viewport) {
			state.viewport = parseRect([
				gl.drawingBufferWidth,
				gl.drawingBufferHeight
			])
		}

		if (o.close != null) { state.close = o.close }

		// reset positions
		if (o.positions === null) { o.positions = [] }
		if (o.positions) {
			var positions, count

			// if positions are an object with x/y
			if (o.positions.x && o.positions.y) {
				var xPos = o.positions.x
				var yPos = o.positions.y
				count = state.count = Math.max(
					xPos.length,
					yPos.length
				)
				positions = new Float64Array(count * 2)
				for (var i$1 = 0; i$1 < count; i$1++) {
					positions[i$1 * 2] = xPos[i$1]
					positions[i$1 * 2 + 1] = yPos[i$1]
				}
			}
			else {
				positions = flatten(o.positions, 'float64')
				count = state.count = Math.floor(positions.length / 2)
			}

			var bounds = state.bounds = getBounds(positions, 2)

			// create fill positions
			// FIXME: fill positions can be set only along with positions
			if (state.fill) {
				var pos = []

				// filter bad vertices and remap triangles to ensure shape
				var ids = {}
				var lastId = 0

				for (var i$2 = 0, ptr = 0, l = state.count; i$2 < l; i$2++) {
					var x = positions[i$2*2]
					var y = positions[i$2*2 + 1]
					if (isNaN(x) || isNaN(y) || x == null || y == null) {
						x = positions[lastId*2]
						y = positions[lastId*2 + 1]
						ids[i$2] = lastId
					}
					else {
						lastId = i$2
					}
					pos[ptr++] = x
					pos[ptr++] = y
				}

				var triangles = triangulate(pos, state.hole || [])

				for (var i$3 = 0, l$1 = triangles.length; i$3 < l$1; i$3++) {
					if (ids[triangles[i$3]] != null) { triangles[i$3] = ids[triangles[i$3]] }
				}

				state.triangles = triangles
			}

			// update position buffers
			var npos = new Float64Array(positions)
			normalize(npos, 2, bounds)

			var positionData = new Float64Array(count * 2 + 6)

			// rotate first segment join
			if (state.close) {
				if (positions[0] === positions[count*2 - 2] &&
					positions[1] === positions[count*2 - 1]) {
					positionData[0] = npos[count*2 - 4]
					positionData[1] = npos[count*2 - 3]
				}
				else {
					positionData[0] = npos[count*2 - 2]
					positionData[1] = npos[count*2 - 1]
				}
			}
			else {
				positionData[0] = npos[0]
				positionData[1] = npos[1]
			}

			positionData.set(npos, 2)

			// add last segment
			if (state.close) {
				// ignore coinciding start/end
				if (positions[0] === positions[count*2 - 2] &&
					positions[1] === positions[count*2 - 1]) {
					positionData[count*2 + 2] = npos[2]
					positionData[count*2 + 3] = npos[3]
					state.count -= 1
				}
				else {
					positionData[count*2 + 2] = npos[0]
					positionData[count*2 + 3] = npos[1]
					positionData[count*2 + 4] = npos[2]
					positionData[count*2 + 5] = npos[3]
				}
			}
			// add stub
			else {
				positionData[count*2 + 2] = npos[count*2 - 2]
				positionData[count*2 + 3] = npos[count*2 - 1]
				positionData[count*2 + 4] = npos[count*2 - 2]
				positionData[count*2 + 5] = npos[count*2 - 1]
			}

			state.positionBuffer(float32(positionData))
			state.positionFractBuffer(fract32(positionData))
		}

		if (o.range) {
			state.range = o.range
		} else if (!state.range) {
			state.range = state.bounds
		}

		if ((o.range || o.positions) && state.count) {
			var bounds$1 = state.bounds

			var boundsW = bounds$1[2] - bounds$1[0],
				boundsH = bounds$1[3] - bounds$1[1]

			var rangeW = state.range[2] - state.range[0],
				rangeH = state.range[3] - state.range[1]

			state.scale = [
				boundsW / rangeW,
				boundsH / rangeH
			]
			state.translate = [
				-state.range[0] / rangeW + bounds$1[0] / rangeW || 0,
				-state.range[1] / rangeH + bounds$1[1] / rangeH || 0
			]

			state.scaleFract = fract32(state.scale)
			state.translateFract = fract32(state.translate)
		}

		if (o.dashes) {
			var dashLength = 0., dashData

			if (!o.dashes || o.dashes.length < 2) {
				dashLength = 1.
				dashData = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255])
			}

			else {
				dashLength = 0.;
				for(var i$4 = 0; i$4 < o.dashes.length; ++i$4) {
					dashLength += o.dashes[i$4]
				}
				dashData = new Uint8Array(dashLength * Line2D.dashMult)
				var ptr$1 = 0
				var fillColor = 255

				// repeat texture two times to provide smooth 0-step
				for (var k = 0; k < 2; k++) {
					for(var i$5 = 0; i$5 < o.dashes.length; ++i$5) {
						for(var j = 0, l$2 = o.dashes[i$5] * Line2D.dashMult * .5; j < l$2; ++j) {
							dashData[ptr$1++] = fillColor
						}
						fillColor ^= 255
					}
				}
			}

			state.dashLength = dashLength
			state.dashTexture({
				channels: 1,
				data: dashData,
				width: dashData.length,
				height: 1,
				mag: 'linear',
				min: 'linear'
			}, 0, 0)
		}

		if (o.color) {
			var count$1 = state.count
			var colors = o.color

			if (!colors) { colors = 'transparent' }

			var colorData = new Uint8Array(count$1 * 4 + 4)

			// convert colors to typed arrays
			if (!Array.isArray(colors) || typeof colors[0] === 'number') {
				var c = rgba(colors, 'uint8')

				for (var i$6 = 0; i$6 < count$1 + 1; i$6++) {
					colorData.set(c, i$6 * 4)
				}
			} else {
				for (var i$7 = 0; i$7 < count$1; i$7++) {
					var c$1 = rgba(colors[i$7], 'uint8')
					colorData.set(c$1, i$7 * 4)
				}
				colorData.set(rgba(colors[0], 'uint8'), count$1 * 4)
			}

			state.colorBuffer({
				usage: 'dynamic',
				type: 'uint8',
				data: colorData
			})
		}
	})

	// remove unmentioned passes
	if (options.length < this.passes.length) {
		for (var i = options.length; i < this.passes.length; i++) {
			var pass = this.passes[i]
			if (!pass) { continue }
			pass.colorBuffer.destroy()
			pass.positionBuffer.destroy()
			pass.dashTexture.destroy()
		}
		this.passes.length = options.length
	}

	// remove null items
	var passes = []
	for (var i$1 = 0; i$1 < this.passes.length; i$1++) {
		if (this.passes[i$1] !== null) { passes.push(this.passes[i$1]) }
	}
	this.passes = passes

	return this
}

Line2D.prototype.destroy = function () {
	this.passes.forEach(function (pass) {
		pass.colorBuffer.destroy()
		pass.positionBuffer.destroy()
		pass.dashTexture.destroy()
	})

	this.passes.length = 0

	return this
}

},{"array-bounds":2,"array-normalize":3,"color-normalize":6,"earcut":15,"es6-weak-map":66,"flatten-vertex-data":70,"glslify":71,"object-assign":73,"parse-rect":74,"pick-by-alias":75,"to-float32":76}],2:[function(require,module,exports){
'use strict'

module.exports = normalize;

function normalize (arr, dim) {
	if (!arr || arr.length == null) throw Error('Argument should be an array')

	if (dim == null) dim = 1
	else dim = Math.floor(dim)

	var bounds = Array(dim * 2)

	for (var offset = 0; offset < dim; offset++) {
		var max = -Infinity, min = Infinity, i = offset, l = arr.length;

		for (; i < l; i+=dim) {
			if (arr[i] > max) max = arr[i];
			if (arr[i] < min) min = arr[i];
		}

		bounds[offset] = min
		bounds[dim + offset] = max
	}

	return bounds;
}

},{}],3:[function(require,module,exports){
'use strict'

var getBounds = require('array-bounds')

module.exports = normalize;

function normalize (arr, dim, bounds) {
	if (!arr || arr.length == null) throw Error('Argument should be an array')

	if (dim == null) dim = 1
	if (bounds == null) bounds = getBounds(arr, dim)

	for (var offset = 0; offset < dim; offset++) {
		var max = bounds[dim + offset], min = bounds[offset], i = offset, l = arr.length;

		if (max === Infinity && min === -Infinity) {
			for (i = offset; i < l; i+=dim) {
				arr[i] = arr[i] === max ? 1 : arr[i] === min ? 0 : .5
			}
		}
		else if (max === Infinity) {
			for (i = offset; i < l; i+=dim) {
				arr[i] = arr[i] === max ? 1 : 0
			}
		}
		else if (min === -Infinity) {
			for (i = offset; i < l; i+=dim) {
				arr[i] = arr[i] === min ? 0 : 1
			}
		}
		else {
			var range = max - min
			for (i = offset; i < l; i+=dim) {
				arr[i] = range === 0 ? .5 : (arr[i] - min) / range
			}
		}
	}

	return arr;
}

},{"array-bounds":2}],4:[function(require,module,exports){
module.exports = clamp

function clamp(value, min, max) {
  return min < max
    ? (value < min ? min : value > max ? max : value)
    : (value < max ? max : value > min ? min : value)
}

},{}],5:[function(require,module,exports){
'use strict'

module.exports = {
	"aliceblue": [240, 248, 255],
	"antiquewhite": [250, 235, 215],
	"aqua": [0, 255, 255],
	"aquamarine": [127, 255, 212],
	"azure": [240, 255, 255],
	"beige": [245, 245, 220],
	"bisque": [255, 228, 196],
	"black": [0, 0, 0],
	"blanchedalmond": [255, 235, 205],
	"blue": [0, 0, 255],
	"blueviolet": [138, 43, 226],
	"brown": [165, 42, 42],
	"burlywood": [222, 184, 135],
	"cadetblue": [95, 158, 160],
	"chartreuse": [127, 255, 0],
	"chocolate": [210, 105, 30],
	"coral": [255, 127, 80],
	"cornflowerblue": [100, 149, 237],
	"cornsilk": [255, 248, 220],
	"crimson": [220, 20, 60],
	"cyan": [0, 255, 255],
	"darkblue": [0, 0, 139],
	"darkcyan": [0, 139, 139],
	"darkgoldenrod": [184, 134, 11],
	"darkgray": [169, 169, 169],
	"darkgreen": [0, 100, 0],
	"darkgrey": [169, 169, 169],
	"darkkhaki": [189, 183, 107],
	"darkmagenta": [139, 0, 139],
	"darkolivegreen": [85, 107, 47],
	"darkorange": [255, 140, 0],
	"darkorchid": [153, 50, 204],
	"darkred": [139, 0, 0],
	"darksalmon": [233, 150, 122],
	"darkseagreen": [143, 188, 143],
	"darkslateblue": [72, 61, 139],
	"darkslategray": [47, 79, 79],
	"darkslategrey": [47, 79, 79],
	"darkturquoise": [0, 206, 209],
	"darkviolet": [148, 0, 211],
	"deeppink": [255, 20, 147],
	"deepskyblue": [0, 191, 255],
	"dimgray": [105, 105, 105],
	"dimgrey": [105, 105, 105],
	"dodgerblue": [30, 144, 255],
	"firebrick": [178, 34, 34],
	"floralwhite": [255, 250, 240],
	"forestgreen": [34, 139, 34],
	"fuchsia": [255, 0, 255],
	"gainsboro": [220, 220, 220],
	"ghostwhite": [248, 248, 255],
	"gold": [255, 215, 0],
	"goldenrod": [218, 165, 32],
	"gray": [128, 128, 128],
	"green": [0, 128, 0],
	"greenyellow": [173, 255, 47],
	"grey": [128, 128, 128],
	"honeydew": [240, 255, 240],
	"hotpink": [255, 105, 180],
	"indianred": [205, 92, 92],
	"indigo": [75, 0, 130],
	"ivory": [255, 255, 240],
	"khaki": [240, 230, 140],
	"lavender": [230, 230, 250],
	"lavenderblush": [255, 240, 245],
	"lawngreen": [124, 252, 0],
	"lemonchiffon": [255, 250, 205],
	"lightblue": [173, 216, 230],
	"lightcoral": [240, 128, 128],
	"lightcyan": [224, 255, 255],
	"lightgoldenrodyellow": [250, 250, 210],
	"lightgray": [211, 211, 211],
	"lightgreen": [144, 238, 144],
	"lightgrey": [211, 211, 211],
	"lightpink": [255, 182, 193],
	"lightsalmon": [255, 160, 122],
	"lightseagreen": [32, 178, 170],
	"lightskyblue": [135, 206, 250],
	"lightslategray": [119, 136, 153],
	"lightslategrey": [119, 136, 153],
	"lightsteelblue": [176, 196, 222],
	"lightyellow": [255, 255, 224],
	"lime": [0, 255, 0],
	"limegreen": [50, 205, 50],
	"linen": [250, 240, 230],
	"magenta": [255, 0, 255],
	"maroon": [128, 0, 0],
	"mediumaquamarine": [102, 205, 170],
	"mediumblue": [0, 0, 205],
	"mediumorchid": [186, 85, 211],
	"mediumpurple": [147, 112, 219],
	"mediumseagreen": [60, 179, 113],
	"mediumslateblue": [123, 104, 238],
	"mediumspringgreen": [0, 250, 154],
	"mediumturquoise": [72, 209, 204],
	"mediumvioletred": [199, 21, 133],
	"midnightblue": [25, 25, 112],
	"mintcream": [245, 255, 250],
	"mistyrose": [255, 228, 225],
	"moccasin": [255, 228, 181],
	"navajowhite": [255, 222, 173],
	"navy": [0, 0, 128],
	"oldlace": [253, 245, 230],
	"olive": [128, 128, 0],
	"olivedrab": [107, 142, 35],
	"orange": [255, 165, 0],
	"orangered": [255, 69, 0],
	"orchid": [218, 112, 214],
	"palegoldenrod": [238, 232, 170],
	"palegreen": [152, 251, 152],
	"paleturquoise": [175, 238, 238],
	"palevioletred": [219, 112, 147],
	"papayawhip": [255, 239, 213],
	"peachpuff": [255, 218, 185],
	"peru": [205, 133, 63],
	"pink": [255, 192, 203],
	"plum": [221, 160, 221],
	"powderblue": [176, 224, 230],
	"purple": [128, 0, 128],
	"rebeccapurple": [102, 51, 153],
	"red": [255, 0, 0],
	"rosybrown": [188, 143, 143],
	"royalblue": [65, 105, 225],
	"saddlebrown": [139, 69, 19],
	"salmon": [250, 128, 114],
	"sandybrown": [244, 164, 96],
	"seagreen": [46, 139, 87],
	"seashell": [255, 245, 238],
	"sienna": [160, 82, 45],
	"silver": [192, 192, 192],
	"skyblue": [135, 206, 235],
	"slateblue": [106, 90, 205],
	"slategray": [112, 128, 144],
	"slategrey": [112, 128, 144],
	"snow": [255, 250, 250],
	"springgreen": [0, 255, 127],
	"steelblue": [70, 130, 180],
	"tan": [210, 180, 140],
	"teal": [0, 128, 128],
	"thistle": [216, 191, 216],
	"tomato": [255, 99, 71],
	"turquoise": [64, 224, 208],
	"violet": [238, 130, 238],
	"wheat": [245, 222, 179],
	"white": [255, 255, 255],
	"whitesmoke": [245, 245, 245],
	"yellow": [255, 255, 0],
	"yellowgreen": [154, 205, 50]
};

},{}],6:[function(require,module,exports){
/** @module  color-normalize */

'use strict'

var rgba = require('color-rgba')
var clamp = require('clamp')
var dtype = require('dtype')

module.exports = function normalize (color, type) {
	if (type === 'float' || !type) type = 'array'
	if (type === 'uint') type = 'uint8'
	if (type === 'uint_clamped') type = 'uint8_clamped'
	var Ctor = dtype(type)
	var output = new Ctor(4)

	var normalize = type !== 'uint8' && type !== 'uint8_clamped'

	// attempt to parse non-array arguments
	if (!color.length || typeof color === 'string') {
		color = rgba(color)
		color[0] /= 255
		color[1] /= 255
		color[2] /= 255
	}

	// 0, 1 are possible contradictory values for Arrays:
	// [1,1,1] input gives [1,1,1] output instead of [1/255,1/255,1/255], which may be collision if input is meant to be uint.
	// converting [1,1,1] to [1/255,1/255,1/255] in case of float input gives larger mistake since [1,1,1] float is frequent edge value, whereas [0,1,1], [1,1,1] etc. uint inputs are relatively rare
	if (isInt(color)) {
		output[0] = color[0]
		output[1] = color[1]
		output[2] = color[2]
		output[3] = color[3] != null ? color[3] : 255

		if (normalize) {
			output[0] /= 255
			output[1] /= 255
			output[2] /= 255
			output[3] /= 255
		}

		return output
	}

	if (!normalize) {
		output[0] = clamp(Math.floor(color[0] * 255), 0, 255)
		output[1] = clamp(Math.floor(color[1] * 255), 0, 255)
		output[2] = clamp(Math.floor(color[2] * 255), 0, 255)
		output[3] = color[3] == null ? 255 : clamp(Math.floor(color[3] * 255), 0, 255)
	} else {
		output[0] = color[0]
		output[1] = color[1]
		output[2] = color[2]
		output[3] = color[3] != null ? color[3] : 1
	}

	return output
}

function isInt(color) {
	if (color instanceof Uint8Array || color instanceof Uint8ClampedArray) return true

	if (Array.isArray(color) &&
		(color[0] > 1 || color[0] === 0) &&
		(color[1] > 1 || color[1] === 0) &&
		(color[2] > 1 || color[2] === 0) &&
		(!color[3] || color[3] > 1)
	) return true

	return false
}

},{"clamp":4,"color-rgba":8,"dtype":14}],7:[function(require,module,exports){
(function (global){
/**
 * @module color-parse
 */

'use strict'

var names = require('color-name')
var isObject = require('is-plain-obj')
var defined = require('defined')

module.exports = parse

/**
 * Base hues
 * http://dev.w3.org/csswg/css-color/#typedef-named-hue
 */
//FIXME: use external hue detector
var baseHues = {
	red: 0,
	orange: 60,
	yellow: 120,
	green: 180,
	blue: 240,
	purple: 300
}

/**
 * Parse color from the string passed
 *
 * @return {Object} A space indicator `space`, an array `values` and `alpha`
 */
function parse (cstr) {
	var m, parts = [], alpha = 1, space

	if (typeof cstr === 'string') {
		//keyword
		if (names[cstr]) {
			parts = names[cstr].slice()
			space = 'rgb'
		}

		//reserved words
		else if (cstr === 'transparent') {
			alpha = 0
			space = 'rgb'
			parts = [0,0,0]
		}

		//hex
		else if (/^#[A-Fa-f0-9]+$/.test(cstr)) {
			var base = cstr.slice(1)
			var size = base.length
			var isShort = size <= 4
			alpha = 1

			if (isShort) {
				parts = [
					parseInt(base[0] + base[0], 16),
					parseInt(base[1] + base[1], 16),
					parseInt(base[2] + base[2], 16)
				]
				if (size === 4) {
					alpha = parseInt(base[3] + base[3], 16) / 255
				}
			}
			else {
				parts = [
					parseInt(base[0] + base[1], 16),
					parseInt(base[2] + base[3], 16),
					parseInt(base[4] + base[5], 16)
				]
				if (size === 8) {
					alpha = parseInt(base[6] + base[7], 16) / 255
				}
			}

			if (!parts[0]) parts[0] = 0
			if (!parts[1]) parts[1] = 0
			if (!parts[2]) parts[2] = 0

			space = 'rgb'
		}

		//color space
		else if (m = /^((?:rgb|hs[lvb]|hwb|cmyk?|xy[zy]|gray|lab|lchu?v?|[ly]uv|lms)a?)\s*\(([^\)]*)\)/.exec(cstr)) {
			var name = m[1]
			var base = name.replace(/a$/, '')
			space = base
			var size = base === 'cmyk' ? 4 : base === 'gray' ? 1 : 3
			parts = m[2].trim()
				.split(/\s*,\s*/)
				.map(function (x, i) {
					//<percentage>
					if (/%$/.test(x)) {
						//alpha
						if (i === size)	return parseFloat(x) / 100
						//rgb
						if (base === 'rgb') return parseFloat(x) * 255 / 100
						return parseFloat(x)
					}
					//hue
					else if (base[i] === 'h') {
						//<deg>
						if (/deg$/.test(x)) {
							return parseFloat(x)
						}
						//<base-hue>
						else if (baseHues[x] !== undefined) {
							return baseHues[x]
						}
					}
					return parseFloat(x)
				})

			if (name === base) parts.push(1)
			alpha = parts[size] === undefined ? 1 : parts[size]
			parts = parts.slice(0, size)
		}

		//named channels case
		else if (cstr.length > 10 && /[0-9](?:\s|\/)/.test(cstr)) {
			parts = cstr.match(/([0-9]+)/g).map(function (value) {
				return parseFloat(value)
			})

			space = cstr.match(/([a-z])/ig).join('').toLowerCase()
		}
	}

	//numeric case
	else if (!isNaN(cstr)) {
		space = 'rgb'
		parts = [cstr >>> 16, (cstr & 0x00ff00) >>> 8, cstr & 0x0000ff]
	}

	//object case - detects css cases of rgb and hsl
	else if (isObject(cstr)) {
		var r = defined(cstr.r, cstr.red, cstr.R, null)

		if (r !== null) {
			space = 'rgb'
			parts = [
				r,
				defined(cstr.g, cstr.green, cstr.G),
				defined(cstr.b, cstr.blue, cstr.B)
			]
		}
		else {
			space = 'hsl'
			parts = [
				defined(cstr.h, cstr.hue, cstr.H),
				defined(cstr.s, cstr.saturation, cstr.S),
				defined(cstr.l, cstr.lightness, cstr.L, cstr.b, cstr.brightness)
			]
		}

		alpha = defined(cstr.a, cstr.alpha, cstr.opacity, 1)

		if (cstr.opacity != null) alpha /= 100
	}

	//array
	else if (Array.isArray(cstr) || global.ArrayBuffer && ArrayBuffer.isView && ArrayBuffer.isView(cstr)) {
		parts = [cstr[0], cstr[1], cstr[2]]
		space = 'rgb'
		alpha = cstr.length === 4 ? cstr[3] : 1
	}

	return {
		space: space,
		values: parts,
		alpha: alpha
	}
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"color-name":5,"defined":13,"is-plain-obj":72}],8:[function(require,module,exports){
/** @module  color-rgba */

'use strict'

var parse = require('color-parse')
var hsl = require('color-space/hsl')
var clamp = require('clamp')

module.exports = function rgba (color) {
	var values, i, l

	//attempt to parse non-array arguments
	var parsed = parse(color)

	if (!parsed.space) return []

	values = Array(3)
	values[0] = clamp(parsed.values[0], 0, 255)
	values[1] = clamp(parsed.values[1], 0, 255)
	values[2] = clamp(parsed.values[2], 0, 255)

	if (parsed.space[0] === 'h') {
		values = hsl.rgb(values)
	}

	values.push(clamp(parsed.alpha, 0, 1))

	return values
}

},{"clamp":4,"color-parse":7,"color-space/hsl":9}],9:[function(require,module,exports){
/**
 * @module color-space/hsl
 */
'use strict'

var rgb = require('./rgb');

module.exports = {
	name: 'hsl',
	min: [0,0,0],
	max: [360,100,100],
	channel: ['hue', 'saturation', 'lightness'],
	alias: ['HSL'],

	rgb: function(hsl) {
		var h = hsl[0] / 360,
				s = hsl[1] / 100,
				l = hsl[2] / 100,
				t1, t2, t3, rgb, val;

		if (s === 0) {
			val = l * 255;
			return [val, val, val];
		}

		if (l < 0.5) {
			t2 = l * (1 + s);
		}
		else {
			t2 = l + s - l * s;
		}
		t1 = 2 * l - t2;

		rgb = [0, 0, 0];
		for (var i = 0; i < 3; i++) {
			t3 = h + 1 / 3 * - (i - 1);
			if (t3 < 0) {
				t3++;
			}
			else if (t3 > 1) {
				t3--;
			}

			if (6 * t3 < 1) {
				val = t1 + (t2 - t1) * 6 * t3;
			}
			else if (2 * t3 < 1) {
				val = t2;
			}
			else if (3 * t3 < 2) {
				val = t1 + (t2 - t1) * (2 / 3 - t3) * 6;
			}
			else {
				val = t1;
			}

			rgb[i] = val * 255;
		}

		return rgb;
	}
};


//extend rgb
rgb.hsl = function(rgb) {
	var r = rgb[0]/255,
			g = rgb[1]/255,
			b = rgb[2]/255,
			min = Math.min(r, g, b),
			max = Math.max(r, g, b),
			delta = max - min,
			h, s, l;

	if (max === min) {
		h = 0;
	}
	else if (r === max) {
		h = (g - b) / delta;
	}
	else if (g === max) {
		h = 2 + (b - r) / delta;
	}
	else if (b === max) {
		h = 4 + (r - g)/ delta;
	}

	h = Math.min(h * 60, 360);

	if (h < 0) {
		h += 360;
	}

	l = (min + max) / 2;

	if (max === min) {
		s = 0;
	}
	else if (l <= 0.5) {
		s = delta / (max + min);
	}
	else {
		s = delta / (2 - max - min);
	}

	return [h, s * 100, l * 100];
};

},{"./rgb":10}],10:[function(require,module,exports){
/**
 * RGB space.
 *
 * @module  color-space/rgb
 */
'use strict'

module.exports = {
	name: 'rgb',
	min: [0,0,0],
	max: [255,255,255],
	channel: ['red', 'green', 'blue'],
	alias: ['RGB']
};

},{}],11:[function(require,module,exports){
'use strict';

var copy             = require('es5-ext/object/copy')
  , normalizeOptions = require('es5-ext/object/normalize-options')
  , ensureCallable   = require('es5-ext/object/valid-callable')
  , map              = require('es5-ext/object/map')
  , callable         = require('es5-ext/object/valid-callable')
  , validValue       = require('es5-ext/object/valid-value')

  , bind = Function.prototype.bind, defineProperty = Object.defineProperty
  , hasOwnProperty = Object.prototype.hasOwnProperty
  , define;

define = function (name, desc, options) {
	var value = validValue(desc) && callable(desc.value), dgs;
	dgs = copy(desc);
	delete dgs.writable;
	delete dgs.value;
	dgs.get = function () {
		if (!options.overwriteDefinition && hasOwnProperty.call(this, name)) return value;
		desc.value = bind.call(value, options.resolveContext ? options.resolveContext(this) : this);
		defineProperty(this, name, desc);
		return this[name];
	};
	return dgs;
};

module.exports = function (props/*, options*/) {
	var options = normalizeOptions(arguments[1]);
	if (options.resolveContext != null) ensureCallable(options.resolveContext);
	return map(props, function (desc, name) { return define(name, desc, options); });
};

},{"es5-ext/object/copy":32,"es5-ext/object/map":41,"es5-ext/object/normalize-options":42,"es5-ext/object/valid-callable":46,"es5-ext/object/valid-value":48}],12:[function(require,module,exports){
'use strict';

var assign        = require('es5-ext/object/assign')
  , normalizeOpts = require('es5-ext/object/normalize-options')
  , isCallable    = require('es5-ext/object/is-callable')
  , contains      = require('es5-ext/string/#/contains')

  , d;

d = module.exports = function (dscr, value/*, options*/) {
	var c, e, w, options, desc;
	if ((arguments.length < 2) || (typeof dscr !== 'string')) {
		options = value;
		value = dscr;
		dscr = null;
	} else {
		options = arguments[2];
	}
	if (dscr == null) {
		c = w = true;
		e = false;
	} else {
		c = contains.call(dscr, 'c');
		e = contains.call(dscr, 'e');
		w = contains.call(dscr, 'w');
	}

	desc = { value: value, configurable: c, enumerable: e, writable: w };
	return !options ? desc : assign(normalizeOpts(options), desc);
};

d.gs = function (dscr, get, set/*, options*/) {
	var c, e, options, desc;
	if (typeof dscr !== 'string') {
		options = set;
		set = get;
		get = dscr;
		dscr = null;
	} else {
		options = arguments[3];
	}
	if (get == null) {
		get = undefined;
	} else if (!isCallable(get)) {
		options = get;
		get = set = undefined;
	} else if (set == null) {
		set = undefined;
	} else if (!isCallable(set)) {
		options = set;
		set = undefined;
	}
	if (dscr == null) {
		c = true;
		e = false;
	} else {
		c = contains.call(dscr, 'c');
		e = contains.call(dscr, 'e');
	}

	desc = { get: get, set: set, configurable: c, enumerable: e };
	return !options ? desc : assign(normalizeOpts(options), desc);
};

},{"es5-ext/object/assign":29,"es5-ext/object/is-callable":35,"es5-ext/object/normalize-options":42,"es5-ext/string/#/contains":49}],13:[function(require,module,exports){
module.exports = function () {
    for (var i = 0; i < arguments.length; i++) {
        if (arguments[i] !== undefined) return arguments[i];
    }
};

},{}],14:[function(require,module,exports){
module.exports = function(dtype) {
  switch (dtype) {
    case 'int8':
      return Int8Array
    case 'int16':
      return Int16Array
    case 'int32':
      return Int32Array
    case 'uint8':
      return Uint8Array
    case 'uint16':
      return Uint16Array
    case 'uint32':
      return Uint32Array
    case 'float32':
      return Float32Array
    case 'float64':
      return Float64Array
    case 'array':
      return Array
    case 'uint8_clamped':
      return Uint8ClampedArray
  }
}

},{}],15:[function(require,module,exports){
'use strict';

module.exports = earcut;
module.exports.default = earcut;

function earcut(data, holeIndices, dim) {

    dim = dim || 2;

    var hasHoles = holeIndices && holeIndices.length,
        outerLen = hasHoles ? holeIndices[0] * dim : data.length,
        outerNode = linkedList(data, 0, outerLen, dim, true),
        triangles = [];

    if (!outerNode || outerNode.next === outerNode.prev) return triangles;

    var minX, minY, maxX, maxY, x, y, invSize;

    if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);

    // if the shape is not too simple, we'll use z-order curve hash later; calculate polygon bbox
    if (data.length > 80 * dim) {
        minX = maxX = data[0];
        minY = maxY = data[1];

        for (var i = dim; i < outerLen; i += dim) {
            x = data[i];
            y = data[i + 1];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }

        // minX, minY and invSize are later used to transform coords into integers for z-order calculation
        invSize = Math.max(maxX - minX, maxY - minY);
        invSize = invSize !== 0 ? 1 / invSize : 0;
    }

    earcutLinked(outerNode, triangles, dim, minX, minY, invSize);

    return triangles;
}

// create a circular doubly linked list from polygon points in the specified winding order
function linkedList(data, start, end, dim, clockwise) {
    var i, last;

    if (clockwise === (signedArea(data, start, end, dim) > 0)) {
        for (i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
    } else {
        for (i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
    }

    if (last && equals(last, last.next)) {
        removeNode(last);
        last = last.next;
    }

    return last;
}

// eliminate colinear or duplicate points
function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;

    var p = start,
        again;
    do {
        again = false;

        if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
            removeNode(p);
            p = end = p.prev;
            if (p === p.next) break;
            again = true;

        } else {
            p = p.next;
        }
    } while (again || p !== end);

    return end;
}

// main ear slicing loop which triangulates a polygon (given as a linked list)
function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
    if (!ear) return;

    // interlink polygon nodes in z-order
    if (!pass && invSize) indexCurve(ear, minX, minY, invSize);

    var stop = ear,
        prev, next;

    // iterate through ears, slicing them one by one
    while (ear.prev !== ear.next) {
        prev = ear.prev;
        next = ear.next;

        if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
            // cut off the triangle
            triangles.push(prev.i / dim);
            triangles.push(ear.i / dim);
            triangles.push(next.i / dim);

            removeNode(ear);

            // skipping the next vertex leads to less sliver triangles
            ear = next.next;
            stop = next.next;

            continue;
        }

        ear = next;

        // if we looped through the whole remaining polygon and can't find any more ears
        if (ear === stop) {
            // try filtering points and slicing again
            if (!pass) {
                earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);

            // if this didn't work, try curing all small self-intersections locally
            } else if (pass === 1) {
                ear = cureLocalIntersections(ear, triangles, dim);
                earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);

            // as a last resort, try splitting the remaining polygon into two
            } else if (pass === 2) {
                splitEarcut(ear, triangles, dim, minX, minY, invSize);
            }

            break;
        }
    }
}

// check whether a polygon node forms a valid ear with adjacent nodes
function isEar(ear) {
    var a = ear.prev,
        b = ear,
        c = ear.next;

    if (area(a, b, c) >= 0) return false; // reflex, can't be an ear

    // now make sure we don't have other points inside the potential ear
    var p = ear.next.next;

    while (p !== ear.prev) {
        if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
            area(p.prev, p, p.next) >= 0) return false;
        p = p.next;
    }

    return true;
}

function isEarHashed(ear, minX, minY, invSize) {
    var a = ear.prev,
        b = ear,
        c = ear.next;

    if (area(a, b, c) >= 0) return false; // reflex, can't be an ear

    // triangle bbox; min & max are calculated like this for speed
    var minTX = a.x < b.x ? (a.x < c.x ? a.x : c.x) : (b.x < c.x ? b.x : c.x),
        minTY = a.y < b.y ? (a.y < c.y ? a.y : c.y) : (b.y < c.y ? b.y : c.y),
        maxTX = a.x > b.x ? (a.x > c.x ? a.x : c.x) : (b.x > c.x ? b.x : c.x),
        maxTY = a.y > b.y ? (a.y > c.y ? a.y : c.y) : (b.y > c.y ? b.y : c.y);

    // z-order range for the current triangle bbox;
    var minZ = zOrder(minTX, minTY, minX, minY, invSize),
        maxZ = zOrder(maxTX, maxTY, minX, minY, invSize);

    var p = ear.prevZ,
        n = ear.nextZ;

    // look for points inside the triangle in both directions
    while (p && p.z >= minZ && n && n.z <= maxZ) {
        if (p !== ear.prev && p !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
            area(p.prev, p, p.next) >= 0) return false;
        p = p.prevZ;

        if (n !== ear.prev && n !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
            area(n.prev, n, n.next) >= 0) return false;
        n = n.nextZ;
    }

    // look for remaining points in decreasing z-order
    while (p && p.z >= minZ) {
        if (p !== ear.prev && p !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
            area(p.prev, p, p.next) >= 0) return false;
        p = p.prevZ;
    }

    // look for remaining points in increasing z-order
    while (n && n.z <= maxZ) {
        if (n !== ear.prev && n !== ear.next &&
            pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, n.x, n.y) &&
            area(n.prev, n, n.next) >= 0) return false;
        n = n.nextZ;
    }

    return true;
}

// go through all polygon nodes and cure small local self-intersections
function cureLocalIntersections(start, triangles, dim) {
    var p = start;
    do {
        var a = p.prev,
            b = p.next.next;

        if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {

            triangles.push(a.i / dim);
            triangles.push(p.i / dim);
            triangles.push(b.i / dim);

            // remove two nodes involved
            removeNode(p);
            removeNode(p.next);

            p = start = b;
        }
        p = p.next;
    } while (p !== start);

    return p;
}

// try splitting polygon into two and triangulate them independently
function splitEarcut(start, triangles, dim, minX, minY, invSize) {
    // look for a valid diagonal that divides the polygon into two
    var a = start;
    do {
        var b = a.next.next;
        while (b !== a.prev) {
            if (a.i !== b.i && isValidDiagonal(a, b)) {
                // split the polygon in two by the diagonal
                var c = splitPolygon(a, b);

                // filter colinear points around the cuts
                a = filterPoints(a, a.next);
                c = filterPoints(c, c.next);

                // run earcut on each half
                earcutLinked(a, triangles, dim, minX, minY, invSize);
                earcutLinked(c, triangles, dim, minX, minY, invSize);
                return;
            }
            b = b.next;
        }
        a = a.next;
    } while (a !== start);
}

// link every hole into the outer loop, producing a single-ring polygon without holes
function eliminateHoles(data, holeIndices, outerNode, dim) {
    var queue = [],
        i, len, start, end, list;

    for (i = 0, len = holeIndices.length; i < len; i++) {
        start = holeIndices[i] * dim;
        end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
        list = linkedList(data, start, end, dim, false);
        if (list === list.next) list.steiner = true;
        queue.push(getLeftmost(list));
    }

    queue.sort(compareX);

    // process holes from left to right
    for (i = 0; i < queue.length; i++) {
        eliminateHole(queue[i], outerNode);
        outerNode = filterPoints(outerNode, outerNode.next);
    }

    return outerNode;
}

function compareX(a, b) {
    return a.x - b.x;
}

// find a bridge between vertices that connects hole with an outer ring and and link it
function eliminateHole(hole, outerNode) {
    outerNode = findHoleBridge(hole, outerNode);
    if (outerNode) {
        var b = splitPolygon(outerNode, hole);
        filterPoints(b, b.next);
    }
}

// David Eberly's algorithm for finding a bridge between hole and outer polygon
function findHoleBridge(hole, outerNode) {
    var p = outerNode,
        hx = hole.x,
        hy = hole.y,
        qx = -Infinity,
        m;

    // find a segment intersected by a ray from the hole's leftmost point to the left;
    // segment's endpoint with lesser x will be potential connection point
    do {
        if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
            var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
            if (x <= hx && x > qx) {
                qx = x;
                if (x === hx) {
                    if (hy === p.y) return p;
                    if (hy === p.next.y) return p.next;
                }
                m = p.x < p.next.x ? p : p.next;
            }
        }
        p = p.next;
    } while (p !== outerNode);

    if (!m) return null;

    if (hx === qx) return m.prev; // hole touches outer segment; pick lower endpoint

    // look for points inside the triangle of hole point, segment intersection and endpoint;
    // if there are no points found, we have a valid connection;
    // otherwise choose the point of the minimum angle with the ray as connection point

    var stop = m,
        mx = m.x,
        my = m.y,
        tanMin = Infinity,
        tan;

    p = m.next;

    while (p !== stop) {
        if (hx >= p.x && p.x >= mx && hx !== p.x &&
                pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {

            tan = Math.abs(hy - p.y) / (hx - p.x); // tangential

            if ((tan < tanMin || (tan === tanMin && p.x > m.x)) && locallyInside(p, hole)) {
                m = p;
                tanMin = tan;
            }
        }

        p = p.next;
    }

    return m;
}

// interlink polygon nodes in z-order
function indexCurve(start, minX, minY, invSize) {
    var p = start;
    do {
        if (p.z === null) p.z = zOrder(p.x, p.y, minX, minY, invSize);
        p.prevZ = p.prev;
        p.nextZ = p.next;
        p = p.next;
    } while (p !== start);

    p.prevZ.nextZ = null;
    p.prevZ = null;

    sortLinked(p);
}

// Simon Tatham's linked list merge sort algorithm
// http://www.chiark.greenend.org.uk/~sgtatham/algorithms/listsort.html
function sortLinked(list) {
    var i, p, q, e, tail, numMerges, pSize, qSize,
        inSize = 1;

    do {
        p = list;
        list = null;
        tail = null;
        numMerges = 0;

        while (p) {
            numMerges++;
            q = p;
            pSize = 0;
            for (i = 0; i < inSize; i++) {
                pSize++;
                q = q.nextZ;
                if (!q) break;
            }
            qSize = inSize;

            while (pSize > 0 || (qSize > 0 && q)) {

                if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) {
                    e = p;
                    p = p.nextZ;
                    pSize--;
                } else {
                    e = q;
                    q = q.nextZ;
                    qSize--;
                }

                if (tail) tail.nextZ = e;
                else list = e;

                e.prevZ = tail;
                tail = e;
            }

            p = q;
        }

        tail.nextZ = null;
        inSize *= 2;

    } while (numMerges > 1);

    return list;
}

// z-order of a point given coords and inverse of the longer side of data bbox
function zOrder(x, y, minX, minY, invSize) {
    // coords are transformed into non-negative 15-bit integer range
    x = 32767 * (x - minX) * invSize;
    y = 32767 * (y - minY) * invSize;

    x = (x | (x << 8)) & 0x00FF00FF;
    x = (x | (x << 4)) & 0x0F0F0F0F;
    x = (x | (x << 2)) & 0x33333333;
    x = (x | (x << 1)) & 0x55555555;

    y = (y | (y << 8)) & 0x00FF00FF;
    y = (y | (y << 4)) & 0x0F0F0F0F;
    y = (y | (y << 2)) & 0x33333333;
    y = (y | (y << 1)) & 0x55555555;

    return x | (y << 1);
}

// find the leftmost node of a polygon ring
function getLeftmost(start) {
    var p = start,
        leftmost = start;
    do {
        if (p.x < leftmost.x) leftmost = p;
        p = p.next;
    } while (p !== start);

    return leftmost;
}

// check if a point lies within a convex triangle
function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) - (ax - px) * (cy - py) >= 0 &&
           (ax - px) * (by - py) - (bx - px) * (ay - py) >= 0 &&
           (bx - px) * (cy - py) - (cx - px) * (by - py) >= 0;
}

// check if a diagonal between two polygon nodes is valid (lies in polygon interior)
function isValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) &&
           locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b);
}

// signed area of a triangle
function area(p, q, r) {
    return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

// check if two points are equal
function equals(p1, p2) {
    return p1.x === p2.x && p1.y === p2.y;
}

// check if two segments intersect
function intersects(p1, q1, p2, q2) {
    if ((equals(p1, q1) && equals(p2, q2)) ||
        (equals(p1, q2) && equals(p2, q1))) return true;
    return area(p1, q1, p2) > 0 !== area(p1, q1, q2) > 0 &&
           area(p2, q2, p1) > 0 !== area(p2, q2, q1) > 0;
}

// check if a polygon diagonal intersects any polygon segments
function intersectsPolygon(a, b) {
    var p = a;
    do {
        if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
                intersects(p, p.next, a, b)) return true;
        p = p.next;
    } while (p !== a);

    return false;
}

// check if a polygon diagonal is locally inside the polygon
function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0 ?
        area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 :
        area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

// check if the middle point of a polygon diagonal is inside the polygon
function middleInside(a, b) {
    var p = a,
        inside = false,
        px = (a.x + b.x) / 2,
        py = (a.y + b.y) / 2;
    do {
        if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y &&
                (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x))
            inside = !inside;
        p = p.next;
    } while (p !== a);

    return inside;
}

// link two polygon vertices with a bridge; if the vertices belong to the same ring, it splits polygon into two;
// if one belongs to the outer ring and another to a hole, it merges it into a single ring
function splitPolygon(a, b) {
    var a2 = new Node(a.i, a.x, a.y),
        b2 = new Node(b.i, b.x, b.y),
        an = a.next,
        bp = b.prev;

    a.next = b;
    b.prev = a;

    a2.next = an;
    an.prev = a2;

    b2.next = a2;
    a2.prev = b2;

    bp.next = b2;
    b2.prev = bp;

    return b2;
}

// create a node and optionally link it with previous one (in a circular doubly linked list)
function insertNode(i, x, y, last) {
    var p = new Node(i, x, y);

    if (!last) {
        p.prev = p;
        p.next = p;

    } else {
        p.next = last.next;
        p.prev = last;
        last.next.prev = p;
        last.next = p;
    }
    return p;
}

function removeNode(p) {
    p.next.prev = p.prev;
    p.prev.next = p.next;

    if (p.prevZ) p.prevZ.nextZ = p.nextZ;
    if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}

function Node(i, x, y) {
    // vertex index in coordinates array
    this.i = i;

    // vertex coordinates
    this.x = x;
    this.y = y;

    // previous and next vertex nodes in a polygon ring
    this.prev = null;
    this.next = null;

    // z-order curve value
    this.z = null;

    // previous and next nodes in z-order
    this.prevZ = null;
    this.nextZ = null;

    // indicates whether this is a steiner point
    this.steiner = false;
}

// return a percentage difference between the polygon area and its triangulation area;
// used to verify correctness of triangulation
earcut.deviation = function (data, holeIndices, dim, triangles) {
    var hasHoles = holeIndices && holeIndices.length;
    var outerLen = hasHoles ? holeIndices[0] * dim : data.length;

    var polygonArea = Math.abs(signedArea(data, 0, outerLen, dim));
    if (hasHoles) {
        for (var i = 0, len = holeIndices.length; i < len; i++) {
            var start = holeIndices[i] * dim;
            var end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
            polygonArea -= Math.abs(signedArea(data, start, end, dim));
        }
    }

    var trianglesArea = 0;
    for (i = 0; i < triangles.length; i += 3) {
        var a = triangles[i] * dim;
        var b = triangles[i + 1] * dim;
        var c = triangles[i + 2] * dim;
        trianglesArea += Math.abs(
            (data[a] - data[c]) * (data[b + 1] - data[a + 1]) -
            (data[a] - data[b]) * (data[c + 1] - data[a + 1]));
    }

    return polygonArea === 0 && trianglesArea === 0 ? 0 :
        Math.abs((trianglesArea - polygonArea) / polygonArea);
};

function signedArea(data, start, end, dim) {
    var sum = 0;
    for (var i = start, j = end - dim; i < end; i += dim) {
        sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
        j = i;
    }
    return sum;
}

// turn a polygon in a multi-dimensional array form (e.g. as in GeoJSON) into a form Earcut accepts
earcut.flatten = function (data) {
    var dim = data[0][0].length,
        result = {vertices: [], holes: [], dimensions: dim},
        holeIndex = 0;

    for (var i = 0; i < data.length; i++) {
        for (var j = 0; j < data[i].length; j++) {
            for (var d = 0; d < dim; d++) result.vertices.push(data[i][j][d]);
        }
        if (i > 0) {
            holeIndex += data[i - 1].length;
            result.holes.push(holeIndex);
        }
    }
    return result;
};

},{}],16:[function(require,module,exports){
// Inspired by Google Closure:
// http://closure-library.googlecode.com/svn/docs/
// closure_goog_array_array.js.html#goog.array.clear

"use strict";

var value = require("../../object/valid-value");

module.exports = function () {
	value(this).length = 0;
	return this;
};

},{"../../object/valid-value":48}],17:[function(require,module,exports){
"use strict";

module.exports = require("./is-implemented")()
	? Array.from
	: require("./shim");

},{"./is-implemented":18,"./shim":19}],18:[function(require,module,exports){
"use strict";

module.exports = function () {
	var from = Array.from, arr, result;
	if (typeof from !== "function") return false;
	arr = ["raz", "dwa"];
	result = from(arr);
	return Boolean(result && (result !== arr) && (result[1] === "dwa"));
};

},{}],19:[function(require,module,exports){
"use strict";

var iteratorSymbol = require("es6-symbol").iterator
  , isArguments    = require("../../function/is-arguments")
  , isFunction     = require("../../function/is-function")
  , toPosInt       = require("../../number/to-pos-integer")
  , callable       = require("../../object/valid-callable")
  , validValue     = require("../../object/valid-value")
  , isValue        = require("../../object/is-value")
  , isString       = require("../../string/is-string")
  , isArray        = Array.isArray
  , call           = Function.prototype.call
  , desc           = { configurable: true, enumerable: true, writable: true, value: null }
  , defineProperty = Object.defineProperty;

// eslint-disable-next-line complexity
module.exports = function (arrayLike /*, mapFn, thisArg*/) {
	var mapFn = arguments[1]
	  , thisArg = arguments[2]
	  , Context
	  , i
	  , j
	  , arr
	  , length
	  , code
	  , iterator
	  , result
	  , getIterator
	  , value;

	arrayLike = Object(validValue(arrayLike));

	if (isValue(mapFn)) callable(mapFn);
	if (!this || this === Array || !isFunction(this)) {
		// Result: Plain array
		if (!mapFn) {
			if (isArguments(arrayLike)) {
				// Source: Arguments
				length = arrayLike.length;
				if (length !== 1) return Array.apply(null, arrayLike);
				arr = new Array(1);
				arr[0] = arrayLike[0];
				return arr;
			}
			if (isArray(arrayLike)) {
				// Source: Array
				arr = new Array(length = arrayLike.length);
				for (i = 0; i < length; ++i) arr[i] = arrayLike[i];
				return arr;
			}
		}
		arr = [];
	} else {
		// Result: Non plain array
		Context = this;
	}

	if (!isArray(arrayLike)) {
		if ((getIterator = arrayLike[iteratorSymbol]) !== undefined) {
			// Source: Iterator
			iterator = callable(getIterator).call(arrayLike);
			if (Context) arr = new Context();
			result = iterator.next();
			i = 0;
			while (!result.done) {
				value = mapFn ? call.call(mapFn, thisArg, result.value, i) : result.value;
				if (Context) {
					desc.value = value;
					defineProperty(arr, i, desc);
				} else {
					arr[i] = value;
				}
				result = iterator.next();
				++i;
			}
			length = i;
		} else if (isString(arrayLike)) {
			// Source: String
			length = arrayLike.length;
			if (Context) arr = new Context();
			for (i = 0, j = 0; i < length; ++i) {
				value = arrayLike[i];
				if (i + 1 < length) {
					code = value.charCodeAt(0);
					// eslint-disable-next-line max-depth
					if (code >= 0xd800 && code <= 0xdbff) value += arrayLike[++i];
				}
				value = mapFn ? call.call(mapFn, thisArg, value, j) : value;
				if (Context) {
					desc.value = value;
					defineProperty(arr, j, desc);
				} else {
					arr[j] = value;
				}
				++j;
			}
			length = j;
		}
	}
	if (length === undefined) {
		// Source: array or array-like
		length = toPosInt(arrayLike.length);
		if (Context) arr = new Context(length);
		for (i = 0; i < length; ++i) {
			value = mapFn ? call.call(mapFn, thisArg, arrayLike[i], i) : arrayLike[i];
			if (Context) {
				desc.value = value;
				defineProperty(arr, i, desc);
			} else {
				arr[i] = value;
			}
		}
	}
	if (Context) {
		desc.value = null;
		arr.length = length;
	}
	return arr;
};

},{"../../function/is-arguments":20,"../../function/is-function":21,"../../number/to-pos-integer":27,"../../object/is-value":37,"../../object/valid-callable":46,"../../object/valid-value":48,"../../string/is-string":52,"es6-symbol":61}],20:[function(require,module,exports){
"use strict";

var objToString = Object.prototype.toString
  , id = objToString.call(
	(function () {
		return arguments;
	})()
);

module.exports = function (value) {
	return objToString.call(value) === id;
};

},{}],21:[function(require,module,exports){
"use strict";

var objToString = Object.prototype.toString, id = objToString.call(require("./noop"));

module.exports = function (value) {
	return typeof value === "function" && objToString.call(value) === id;
};

},{"./noop":22}],22:[function(require,module,exports){
"use strict";

// eslint-disable-next-line no-empty-function
module.exports = function () {};

},{}],23:[function(require,module,exports){
"use strict";

module.exports = require("./is-implemented")()
	? Math.sign
	: require("./shim");

},{"./is-implemented":24,"./shim":25}],24:[function(require,module,exports){
"use strict";

module.exports = function () {
	var sign = Math.sign;
	if (typeof sign !== "function") return false;
	return (sign(10) === 1) && (sign(-20) === -1);
};

},{}],25:[function(require,module,exports){
"use strict";

module.exports = function (value) {
	value = Number(value);
	if (isNaN(value) || (value === 0)) return value;
	return value > 0 ? 1 : -1;
};

},{}],26:[function(require,module,exports){
"use strict";

var sign = require("../math/sign")

  , abs = Math.abs, floor = Math.floor;

module.exports = function (value) {
	if (isNaN(value)) return 0;
	value = Number(value);
	if ((value === 0) || !isFinite(value)) return value;
	return sign(value) * floor(abs(value));
};

},{"../math/sign":23}],27:[function(require,module,exports){
"use strict";

var toInteger = require("./to-integer")

  , max = Math.max;

module.exports = function (value) {
 return max(0, toInteger(value));
};

},{"./to-integer":26}],28:[function(require,module,exports){
// Internal method, used by iteration functions.
// Calls a function for each key-value pair found in object
// Optionally takes compareFn to iterate object in specific order

"use strict";

var callable                = require("./valid-callable")
  , value                   = require("./valid-value")
  , bind                    = Function.prototype.bind
  , call                    = Function.prototype.call
  , keys                    = Object.keys
  , objPropertyIsEnumerable = Object.prototype.propertyIsEnumerable;

module.exports = function (method, defVal) {
	return function (obj, cb /*, thisArg, compareFn*/) {
		var list, thisArg = arguments[2], compareFn = arguments[3];
		obj = Object(value(obj));
		callable(cb);

		list = keys(obj);
		if (compareFn) {
			list.sort(typeof compareFn === "function" ? bind.call(compareFn, obj) : undefined);
		}
		if (typeof method !== "function") method = list[method];
		return call.call(method, list, function (key, index) {
			if (!objPropertyIsEnumerable.call(obj, key)) return defVal;
			return call.call(cb, thisArg, obj[key], key, obj, index);
		});
	};
};

},{"./valid-callable":46,"./valid-value":48}],29:[function(require,module,exports){
"use strict";

module.exports = require("./is-implemented")()
	? Object.assign
	: require("./shim");

},{"./is-implemented":30,"./shim":31}],30:[function(require,module,exports){
"use strict";

module.exports = function () {
	var assign = Object.assign, obj;
	if (typeof assign !== "function") return false;
	obj = { foo: "raz" };
	assign(obj, { bar: "dwa" }, { trzy: "trzy" });
	return (obj.foo + obj.bar + obj.trzy) === "razdwatrzy";
};

},{}],31:[function(require,module,exports){
"use strict";

var keys  = require("../keys")
  , value = require("../valid-value")
  , max   = Math.max;

module.exports = function (dest, src /*, …srcn*/) {
	var error, i, length = max(arguments.length, 2), assign;
	dest = Object(value(dest));
	assign = function (key) {
		try {
			dest[key] = src[key];
		} catch (e) {
			if (!error) error = e;
		}
	};
	for (i = 1; i < length; ++i) {
		src = arguments[i];
		keys(src).forEach(assign);
	}
	if (error !== undefined) throw error;
	return dest;
};

},{"../keys":38,"../valid-value":48}],32:[function(require,module,exports){
"use strict";

var aFrom  = require("../array/from")
  , assign = require("./assign")
  , value  = require("./valid-value");

module.exports = function (obj/*, propertyNames, options*/) {
	var copy = Object(value(obj)), propertyNames = arguments[1], options = Object(arguments[2]);
	if (copy !== obj && !propertyNames) return copy;
	var result = {};
	if (propertyNames) {
		aFrom(propertyNames, function (propertyName) {
			if (options.ensure || propertyName in obj) result[propertyName] = obj[propertyName];
		});
	} else {
		assign(result, obj);
	}
	return result;
};

},{"../array/from":17,"./assign":29,"./valid-value":48}],33:[function(require,module,exports){
// Workaround for http://code.google.com/p/v8/issues/detail?id=2804

"use strict";

var create = Object.create, shim;

if (!require("./set-prototype-of/is-implemented")()) {
	shim = require("./set-prototype-of/shim");
}

module.exports = (function () {
	var nullObject, polyProps, desc;
	if (!shim) return create;
	if (shim.level !== 1) return create;

	nullObject = {};
	polyProps = {};
	desc = {
		configurable: false,
		enumerable: false,
		writable: true,
		value: undefined
	};
	Object.getOwnPropertyNames(Object.prototype).forEach(function (name) {
		if (name === "__proto__") {
			polyProps[name] = {
				configurable: true,
				enumerable: false,
				writable: true,
				value: undefined
			};
			return;
		}
		polyProps[name] = desc;
	});
	Object.defineProperties(nullObject, polyProps);

	Object.defineProperty(shim, "nullPolyfill", {
		configurable: false,
		enumerable: false,
		writable: false,
		value: nullObject
	});

	return function (prototype, props) {
		return create(prototype === null ? nullObject : prototype, props);
	};
}());

},{"./set-prototype-of/is-implemented":44,"./set-prototype-of/shim":45}],34:[function(require,module,exports){
"use strict";

module.exports = require("./_iterate")("forEach");

},{"./_iterate":28}],35:[function(require,module,exports){
// Deprecated

"use strict";

module.exports = function (obj) {
 return typeof obj === "function";
};

},{}],36:[function(require,module,exports){
"use strict";

var isValue = require("./is-value");

var map = { function: true, object: true };

module.exports = function (value) {
	return (isValue(value) && map[typeof value]) || false;
};

},{"./is-value":37}],37:[function(require,module,exports){
"use strict";

var _undefined = require("../function/noop")(); // Support ES3 engines

module.exports = function (val) {
 return (val !== _undefined) && (val !== null);
};

},{"../function/noop":22}],38:[function(require,module,exports){
"use strict";

module.exports = require("./is-implemented")() ? Object.keys : require("./shim");

},{"./is-implemented":39,"./shim":40}],39:[function(require,module,exports){
"use strict";

module.exports = function () {
	try {
		Object.keys("primitive");
		return true;
	} catch (e) {
		return false;
	}
};

},{}],40:[function(require,module,exports){
"use strict";

var isValue = require("../is-value");

var keys = Object.keys;

module.exports = function (object) { return keys(isValue(object) ? Object(object) : object); };

},{"../is-value":37}],41:[function(require,module,exports){
"use strict";

var callable = require("./valid-callable")
  , forEach  = require("./for-each")
  , call     = Function.prototype.call;

module.exports = function (obj, cb /*, thisArg*/) {
	var result = {}, thisArg = arguments[2];
	callable(cb);
	forEach(obj, function (value, key, targetObj, index) {
		result[key] = call.call(cb, thisArg, value, key, targetObj, index);
	});
	return result;
};

},{"./for-each":34,"./valid-callable":46}],42:[function(require,module,exports){
"use strict";

var isValue = require("./is-value");

var forEach = Array.prototype.forEach, create = Object.create;

var process = function (src, obj) {
	var key;
	for (key in src) obj[key] = src[key];
};

// eslint-disable-next-line no-unused-vars
module.exports = function (opts1 /*, …options*/) {
	var result = create(null);
	forEach.call(arguments, function (options) {
		if (!isValue(options)) return;
		process(Object(options), result);
	});
	return result;
};

},{"./is-value":37}],43:[function(require,module,exports){
"use strict";

module.exports = require("./is-implemented")()
	? Object.setPrototypeOf
	: require("./shim");

},{"./is-implemented":44,"./shim":45}],44:[function(require,module,exports){
"use strict";

var create = Object.create, getPrototypeOf = Object.getPrototypeOf, plainObject = {};

module.exports = function (/* CustomCreate*/) {
	var setPrototypeOf = Object.setPrototypeOf, customCreate = arguments[0] || create;
	if (typeof setPrototypeOf !== "function") return false;
	return getPrototypeOf(setPrototypeOf(customCreate(null), plainObject)) === plainObject;
};

},{}],45:[function(require,module,exports){
/* eslint no-proto: "off" */

// Big thanks to @WebReflection for sorting this out
// https://gist.github.com/WebReflection/5593554

"use strict";

var isObject        = require("../is-object")
  , value           = require("../valid-value")
  , objIsPrototypeOf = Object.prototype.isPrototypeOf
  , defineProperty  = Object.defineProperty
  , nullDesc        = {
	configurable: true,
	enumerable: false,
	writable: true,
	value: undefined
}
  , validate;

validate = function (obj, prototype) {
	value(obj);
	if (prototype === null || isObject(prototype)) return obj;
	throw new TypeError("Prototype must be null or an object");
};

module.exports = (function (status) {
	var fn, set;
	if (!status) return null;
	if (status.level === 2) {
		if (status.set) {
			set = status.set;
			fn = function (obj, prototype) {
				set.call(validate(obj, prototype), prototype);
				return obj;
			};
		} else {
			fn = function (obj, prototype) {
				validate(obj, prototype).__proto__ = prototype;
				return obj;
			};
		}
	} else {
		fn = function self(obj, prototype) {
			var isNullBase;
			validate(obj, prototype);
			isNullBase = objIsPrototypeOf.call(self.nullPolyfill, obj);
			if (isNullBase) delete self.nullPolyfill.__proto__;
			if (prototype === null) prototype = self.nullPolyfill;
			obj.__proto__ = prototype;
			if (isNullBase) defineProperty(self.nullPolyfill, "__proto__", nullDesc);
			return obj;
		};
	}
	return Object.defineProperty(fn, "level", {
		configurable: false,
		enumerable: false,
		writable: false,
		value: status.level
	});
}(
	(function () {
		var tmpObj1 = Object.create(null)
		  , tmpObj2 = {}
		  , set
		  , desc = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__");

		if (desc) {
			try {
				set = desc.set; // Opera crashes at this point
				set.call(tmpObj1, tmpObj2);
			} catch (ignore) {}
			if (Object.getPrototypeOf(tmpObj1) === tmpObj2) return { set: set, level: 2 };
		}

		tmpObj1.__proto__ = tmpObj2;
		if (Object.getPrototypeOf(tmpObj1) === tmpObj2) return { level: 2 };

		tmpObj1 = {};
		tmpObj1.__proto__ = tmpObj2;
		if (Object.getPrototypeOf(tmpObj1) === tmpObj2) return { level: 1 };

		return false;
	})()
));

require("../create");

},{"../create":33,"../is-object":36,"../valid-value":48}],46:[function(require,module,exports){
"use strict";

module.exports = function (fn) {
	if (typeof fn !== "function") throw new TypeError(fn + " is not a function");
	return fn;
};

},{}],47:[function(require,module,exports){
"use strict";

var isObject = require("./is-object");

module.exports = function (value) {
	if (!isObject(value)) throw new TypeError(value + " is not an Object");
	return value;
};

},{"./is-object":36}],48:[function(require,module,exports){
"use strict";

var isValue = require("./is-value");

module.exports = function (value) {
	if (!isValue(value)) throw new TypeError("Cannot use null or undefined");
	return value;
};

},{"./is-value":37}],49:[function(require,module,exports){
"use strict";

module.exports = require("./is-implemented")()
	? String.prototype.contains
	: require("./shim");

},{"./is-implemented":50,"./shim":51}],50:[function(require,module,exports){
"use strict";

var str = "razdwatrzy";

module.exports = function () {
	if (typeof str.contains !== "function") return false;
	return (str.contains("dwa") === true) && (str.contains("foo") === false);
};

},{}],51:[function(require,module,exports){
"use strict";

var indexOf = String.prototype.indexOf;

module.exports = function (searchString/*, position*/) {
	return indexOf.call(this, searchString, arguments[1]) > -1;
};

},{}],52:[function(require,module,exports){
"use strict";

var objToString = Object.prototype.toString, id = objToString.call("");

module.exports = function (value) {
	return (
		typeof value === "string" ||
		(value &&
			typeof value === "object" &&
			(value instanceof String || objToString.call(value) === id)) ||
		false
	);
};

},{}],53:[function(require,module,exports){
"use strict";

var generated = Object.create(null), random = Math.random;

module.exports = function () {
	var str;
	do {
		str = random()
			.toString(36)
			.slice(2);
	} while (generated[str]);
	return str;
};

},{}],54:[function(require,module,exports){
"use strict";

var setPrototypeOf = require("es5-ext/object/set-prototype-of")
  , contains       = require("es5-ext/string/#/contains")
  , d              = require("d")
  , Symbol         = require("es6-symbol")
  , Iterator       = require("./");

var defineProperty = Object.defineProperty, ArrayIterator;

ArrayIterator = module.exports = function (arr, kind) {
	if (!(this instanceof ArrayIterator)) throw new TypeError("Constructor requires 'new'");
	Iterator.call(this, arr);
	if (!kind) kind = "value";
	else if (contains.call(kind, "key+value")) kind = "key+value";
	else if (contains.call(kind, "key")) kind = "key";
	else kind = "value";
	defineProperty(this, "__kind__", d("", kind));
};
if (setPrototypeOf) setPrototypeOf(ArrayIterator, Iterator);

// Internal %ArrayIteratorPrototype% doesn't expose its constructor
delete ArrayIterator.prototype.constructor;

ArrayIterator.prototype = Object.create(Iterator.prototype, {
	_resolve: d(function (i) {
		if (this.__kind__ === "value") return this.__list__[i];
		if (this.__kind__ === "key+value") return [i, this.__list__[i]];
		return i;
	})
});
defineProperty(ArrayIterator.prototype, Symbol.toStringTag, d("c", "Array Iterator"));

},{"./":57,"d":12,"es5-ext/object/set-prototype-of":43,"es5-ext/string/#/contains":49,"es6-symbol":61}],55:[function(require,module,exports){
"use strict";

var isArguments = require("es5-ext/function/is-arguments")
  , callable    = require("es5-ext/object/valid-callable")
  , isString    = require("es5-ext/string/is-string")
  , get         = require("./get");

var isArray = Array.isArray, call = Function.prototype.call, some = Array.prototype.some;

module.exports = function (iterable, cb /*, thisArg*/) {
	var mode, thisArg = arguments[2], result, doBreak, broken, i, length, char, code;
	if (isArray(iterable) || isArguments(iterable)) mode = "array";
	else if (isString(iterable)) mode = "string";
	else iterable = get(iterable);

	callable(cb);
	doBreak = function () {
		broken = true;
	};
	if (mode === "array") {
		some.call(iterable, function (value) {
			call.call(cb, thisArg, value, doBreak);
			return broken;
		});
		return;
	}
	if (mode === "string") {
		length = iterable.length;
		for (i = 0; i < length; ++i) {
			char = iterable[i];
			if (i + 1 < length) {
				code = char.charCodeAt(0);
				if (code >= 0xd800 && code <= 0xdbff) char += iterable[++i];
			}
			call.call(cb, thisArg, char, doBreak);
			if (broken) break;
		}
		return;
	}
	result = iterable.next();

	while (!result.done) {
		call.call(cb, thisArg, result.value, doBreak);
		if (broken) return;
		result = iterable.next();
	}
};

},{"./get":56,"es5-ext/function/is-arguments":20,"es5-ext/object/valid-callable":46,"es5-ext/string/is-string":52}],56:[function(require,module,exports){
"use strict";

var isArguments    = require("es5-ext/function/is-arguments")
  , isString       = require("es5-ext/string/is-string")
  , ArrayIterator  = require("./array")
  , StringIterator = require("./string")
  , iterable       = require("./valid-iterable")
  , iteratorSymbol = require("es6-symbol").iterator;

module.exports = function (obj) {
	if (typeof iterable(obj)[iteratorSymbol] === "function") return obj[iteratorSymbol]();
	if (isArguments(obj)) return new ArrayIterator(obj);
	if (isString(obj)) return new StringIterator(obj);
	return new ArrayIterator(obj);
};

},{"./array":54,"./string":59,"./valid-iterable":60,"es5-ext/function/is-arguments":20,"es5-ext/string/is-string":52,"es6-symbol":61}],57:[function(require,module,exports){
"use strict";

var clear    = require("es5-ext/array/#/clear")
  , assign   = require("es5-ext/object/assign")
  , callable = require("es5-ext/object/valid-callable")
  , value    = require("es5-ext/object/valid-value")
  , d        = require("d")
  , autoBind = require("d/auto-bind")
  , Symbol   = require("es6-symbol");

var defineProperty = Object.defineProperty, defineProperties = Object.defineProperties, Iterator;

module.exports = Iterator = function (list, context) {
	if (!(this instanceof Iterator)) throw new TypeError("Constructor requires 'new'");
	defineProperties(this, {
		__list__: d("w", value(list)),
		__context__: d("w", context),
		__nextIndex__: d("w", 0)
	});
	if (!context) return;
	callable(context.on);
	context.on("_add", this._onAdd);
	context.on("_delete", this._onDelete);
	context.on("_clear", this._onClear);
};

// Internal %IteratorPrototype% doesn't expose its constructor
delete Iterator.prototype.constructor;

defineProperties(
	Iterator.prototype,
	assign(
		{
			_next: d(function () {
				var i;
				if (!this.__list__) return undefined;
				if (this.__redo__) {
					i = this.__redo__.shift();
					if (i !== undefined) return i;
				}
				if (this.__nextIndex__ < this.__list__.length) return this.__nextIndex__++;
				this._unBind();
				return undefined;
			}),
			next: d(function () {
				return this._createResult(this._next());
			}),
			_createResult: d(function (i) {
				if (i === undefined) return { done: true, value: undefined };
				return { done: false, value: this._resolve(i) };
			}),
			_resolve: d(function (i) {
				return this.__list__[i];
			}),
			_unBind: d(function () {
				this.__list__ = null;
				delete this.__redo__;
				if (!this.__context__) return;
				this.__context__.off("_add", this._onAdd);
				this.__context__.off("_delete", this._onDelete);
				this.__context__.off("_clear", this._onClear);
				this.__context__ = null;
			}),
			toString: d(function () {
				return "[object " + (this[Symbol.toStringTag] || "Object") + "]";
			})
		},
		autoBind({
			_onAdd: d(function (index) {
				if (index >= this.__nextIndex__) return;
				++this.__nextIndex__;
				if (!this.__redo__) {
					defineProperty(this, "__redo__", d("c", [index]));
					return;
				}
				this.__redo__.forEach(function (redo, i) {
					if (redo >= index) this.__redo__[i] = ++redo;
				}, this);
				this.__redo__.push(index);
			}),
			_onDelete: d(function (index) {
				var i;
				if (index >= this.__nextIndex__) return;
				--this.__nextIndex__;
				if (!this.__redo__) return;
				i = this.__redo__.indexOf(index);
				if (i !== -1) this.__redo__.splice(i, 1);
				this.__redo__.forEach(function (redo, j) {
					if (redo > index) this.__redo__[j] = --redo;
				}, this);
			}),
			_onClear: d(function () {
				if (this.__redo__) clear.call(this.__redo__);
				this.__nextIndex__ = 0;
			})
		})
	)
);

defineProperty(
	Iterator.prototype,
	Symbol.iterator,
	d(function () {
		return this;
	})
);

},{"d":12,"d/auto-bind":11,"es5-ext/array/#/clear":16,"es5-ext/object/assign":29,"es5-ext/object/valid-callable":46,"es5-ext/object/valid-value":48,"es6-symbol":61}],58:[function(require,module,exports){
"use strict";

var isArguments = require("es5-ext/function/is-arguments")
  , isValue     = require("es5-ext/object/is-value")
  , isString    = require("es5-ext/string/is-string");

var iteratorSymbol = require("es6-symbol").iterator
  , isArray        = Array.isArray;

module.exports = function (value) {
	if (!isValue(value)) return false;
	if (isArray(value)) return true;
	if (isString(value)) return true;
	if (isArguments(value)) return true;
	return typeof value[iteratorSymbol] === "function";
};

},{"es5-ext/function/is-arguments":20,"es5-ext/object/is-value":37,"es5-ext/string/is-string":52,"es6-symbol":61}],59:[function(require,module,exports){
// Thanks @mathiasbynens
// http://mathiasbynens.be/notes/javascript-unicode#iterating-over-symbols

"use strict";

var setPrototypeOf = require("es5-ext/object/set-prototype-of")
  , d              = require("d")
  , Symbol         = require("es6-symbol")
  , Iterator       = require("./");

var defineProperty = Object.defineProperty, StringIterator;

StringIterator = module.exports = function (str) {
	if (!(this instanceof StringIterator)) throw new TypeError("Constructor requires 'new'");
	str = String(str);
	Iterator.call(this, str);
	defineProperty(this, "__length__", d("", str.length));
};
if (setPrototypeOf) setPrototypeOf(StringIterator, Iterator);

// Internal %ArrayIteratorPrototype% doesn't expose its constructor
delete StringIterator.prototype.constructor;

StringIterator.prototype = Object.create(Iterator.prototype, {
	_next: d(function () {
		if (!this.__list__) return undefined;
		if (this.__nextIndex__ < this.__length__) return this.__nextIndex__++;
		this._unBind();
		return undefined;
	}),
	_resolve: d(function (i) {
		var char = this.__list__[i], code;
		if (this.__nextIndex__ === this.__length__) return char;
		code = char.charCodeAt(0);
		if (code >= 0xd800 && code <= 0xdbff) return char + this.__list__[this.__nextIndex__++];
		return char;
	})
});
defineProperty(StringIterator.prototype, Symbol.toStringTag, d("c", "String Iterator"));

},{"./":57,"d":12,"es5-ext/object/set-prototype-of":43,"es6-symbol":61}],60:[function(require,module,exports){
"use strict";

var isIterable = require("./is-iterable");

module.exports = function (value) {
	if (!isIterable(value)) throw new TypeError(value + " is not iterable");
	return value;
};

},{"./is-iterable":58}],61:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? Symbol : require('./polyfill');

},{"./is-implemented":62,"./polyfill":64}],62:[function(require,module,exports){
'use strict';

var validTypes = { object: true, symbol: true };

module.exports = function () {
	var symbol;
	if (typeof Symbol !== 'function') return false;
	symbol = Symbol('test symbol');
	try { String(symbol); } catch (e) { return false; }

	// Return 'true' also for polyfills
	if (!validTypes[typeof Symbol.iterator]) return false;
	if (!validTypes[typeof Symbol.toPrimitive]) return false;
	if (!validTypes[typeof Symbol.toStringTag]) return false;

	return true;
};

},{}],63:[function(require,module,exports){
'use strict';

module.exports = function (x) {
	if (!x) return false;
	if (typeof x === 'symbol') return true;
	if (!x.constructor) return false;
	if (x.constructor.name !== 'Symbol') return false;
	return (x[x.constructor.toStringTag] === 'Symbol');
};

},{}],64:[function(require,module,exports){
// ES2015 Symbol polyfill for environments that do not (or partially) support it

'use strict';

var d              = require('d')
  , validateSymbol = require('./validate-symbol')

  , create = Object.create, defineProperties = Object.defineProperties
  , defineProperty = Object.defineProperty, objPrototype = Object.prototype
  , NativeSymbol, SymbolPolyfill, HiddenSymbol, globalSymbols = create(null)
  , isNativeSafe;

if (typeof Symbol === 'function') {
	NativeSymbol = Symbol;
	try {
		String(NativeSymbol());
		isNativeSafe = true;
	} catch (ignore) {}
}

var generateName = (function () {
	var created = create(null);
	return function (desc) {
		var postfix = 0, name, ie11BugWorkaround;
		while (created[desc + (postfix || '')]) ++postfix;
		desc += (postfix || '');
		created[desc] = true;
		name = '@@' + desc;
		defineProperty(objPrototype, name, d.gs(null, function (value) {
			// For IE11 issue see:
			// https://connect.microsoft.com/IE/feedbackdetail/view/1928508/
			//    ie11-broken-getters-on-dom-objects
			// https://github.com/medikoo/es6-symbol/issues/12
			if (ie11BugWorkaround) return;
			ie11BugWorkaround = true;
			defineProperty(this, name, d(value));
			ie11BugWorkaround = false;
		}));
		return name;
	};
}());

// Internal constructor (not one exposed) for creating Symbol instances.
// This one is used to ensure that `someSymbol instanceof Symbol` always return false
HiddenSymbol = function Symbol(description) {
	if (this instanceof HiddenSymbol) throw new TypeError('Symbol is not a constructor');
	return SymbolPolyfill(description);
};

// Exposed `Symbol` constructor
// (returns instances of HiddenSymbol)
module.exports = SymbolPolyfill = function Symbol(description) {
	var symbol;
	if (this instanceof Symbol) throw new TypeError('Symbol is not a constructor');
	if (isNativeSafe) return NativeSymbol(description);
	symbol = create(HiddenSymbol.prototype);
	description = (description === undefined ? '' : String(description));
	return defineProperties(symbol, {
		__description__: d('', description),
		__name__: d('', generateName(description))
	});
};
defineProperties(SymbolPolyfill, {
	for: d(function (key) {
		if (globalSymbols[key]) return globalSymbols[key];
		return (globalSymbols[key] = SymbolPolyfill(String(key)));
	}),
	keyFor: d(function (s) {
		var key;
		validateSymbol(s);
		for (key in globalSymbols) if (globalSymbols[key] === s) return key;
	}),

	// To ensure proper interoperability with other native functions (e.g. Array.from)
	// fallback to eventual native implementation of given symbol
	hasInstance: d('', (NativeSymbol && NativeSymbol.hasInstance) || SymbolPolyfill('hasInstance')),
	isConcatSpreadable: d('', (NativeSymbol && NativeSymbol.isConcatSpreadable) ||
		SymbolPolyfill('isConcatSpreadable')),
	iterator: d('', (NativeSymbol && NativeSymbol.iterator) || SymbolPolyfill('iterator')),
	match: d('', (NativeSymbol && NativeSymbol.match) || SymbolPolyfill('match')),
	replace: d('', (NativeSymbol && NativeSymbol.replace) || SymbolPolyfill('replace')),
	search: d('', (NativeSymbol && NativeSymbol.search) || SymbolPolyfill('search')),
	species: d('', (NativeSymbol && NativeSymbol.species) || SymbolPolyfill('species')),
	split: d('', (NativeSymbol && NativeSymbol.split) || SymbolPolyfill('split')),
	toPrimitive: d('', (NativeSymbol && NativeSymbol.toPrimitive) || SymbolPolyfill('toPrimitive')),
	toStringTag: d('', (NativeSymbol && NativeSymbol.toStringTag) || SymbolPolyfill('toStringTag')),
	unscopables: d('', (NativeSymbol && NativeSymbol.unscopables) || SymbolPolyfill('unscopables'))
});

// Internal tweaks for real symbol producer
defineProperties(HiddenSymbol.prototype, {
	constructor: d(SymbolPolyfill),
	toString: d('', function () { return this.__name__; })
});

// Proper implementation of methods exposed on Symbol.prototype
// They won't be accessible on produced symbol instances as they derive from HiddenSymbol.prototype
defineProperties(SymbolPolyfill.prototype, {
	toString: d(function () { return 'Symbol (' + validateSymbol(this).__description__ + ')'; }),
	valueOf: d(function () { return validateSymbol(this); })
});
defineProperty(SymbolPolyfill.prototype, SymbolPolyfill.toPrimitive, d('', function () {
	var symbol = validateSymbol(this);
	if (typeof symbol === 'symbol') return symbol;
	return symbol.toString();
}));
defineProperty(SymbolPolyfill.prototype, SymbolPolyfill.toStringTag, d('c', 'Symbol'));

// Proper implementaton of toPrimitive and toStringTag for returned symbol instances
defineProperty(HiddenSymbol.prototype, SymbolPolyfill.toStringTag,
	d('c', SymbolPolyfill.prototype[SymbolPolyfill.toStringTag]));

// Note: It's important to define `toPrimitive` as last one, as some implementations
// implement `toPrimitive` natively without implementing `toStringTag` (or other specified symbols)
// And that may invoke error in definition flow:
// See: https://github.com/medikoo/es6-symbol/issues/13#issuecomment-164146149
defineProperty(HiddenSymbol.prototype, SymbolPolyfill.toPrimitive,
	d('c', SymbolPolyfill.prototype[SymbolPolyfill.toPrimitive]));

},{"./validate-symbol":65,"d":12}],65:[function(require,module,exports){
'use strict';

var isSymbol = require('./is-symbol');

module.exports = function (value) {
	if (!isSymbol(value)) throw new TypeError(value + " is not a symbol");
	return value;
};

},{"./is-symbol":63}],66:[function(require,module,exports){
'use strict';

module.exports = require('./is-implemented')() ? WeakMap : require('./polyfill');

},{"./is-implemented":67,"./polyfill":69}],67:[function(require,module,exports){
'use strict';

module.exports = function () {
	var weakMap, x;
	if (typeof WeakMap !== 'function') return false;
	try {
		// WebKit doesn't support arguments and crashes
		weakMap = new WeakMap([[x = {}, 'one'], [{}, 'two'], [{}, 'three']]);
	} catch (e) {
		return false;
	}
	if (String(weakMap) !== '[object WeakMap]') return false;
	if (typeof weakMap.set !== 'function') return false;
	if (weakMap.set({}, 1) !== weakMap) return false;
	if (typeof weakMap.delete !== 'function') return false;
	if (typeof weakMap.has !== 'function') return false;
	if (weakMap.get(x) !== 'one') return false;

	return true;
};

},{}],68:[function(require,module,exports){
// Exports true if environment provides native `WeakMap` implementation, whatever that is.

'use strict';

module.exports = (function () {
	if (typeof WeakMap !== 'function') return false;
	return (Object.prototype.toString.call(new WeakMap()) === '[object WeakMap]');
}());

},{}],69:[function(require,module,exports){
'use strict';

var setPrototypeOf    = require('es5-ext/object/set-prototype-of')
  , object            = require('es5-ext/object/valid-object')
  , value             = require('es5-ext/object/valid-value')
  , randomUniq        = require('es5-ext/string/random-uniq')
  , d                 = require('d')
  , getIterator       = require('es6-iterator/get')
  , forOf             = require('es6-iterator/for-of')
  , toStringTagSymbol = require('es6-symbol').toStringTag
  , isNative          = require('./is-native-implemented')

  , isArray = Array.isArray, defineProperty = Object.defineProperty
  , hasOwnProperty = Object.prototype.hasOwnProperty, getPrototypeOf = Object.getPrototypeOf
  , WeakMapPoly;

module.exports = WeakMapPoly = function (/*iterable*/) {
	var iterable = arguments[0], self;
	if (!(this instanceof WeakMapPoly)) throw new TypeError('Constructor requires \'new\'');
	if (isNative && setPrototypeOf && (WeakMap !== WeakMapPoly)) {
		self = setPrototypeOf(new WeakMap(), getPrototypeOf(this));
	} else {
		self = this;
	}
	if (iterable != null) {
		if (!isArray(iterable)) iterable = getIterator(iterable);
	}
	defineProperty(self, '__weakMapData__', d('c', '$weakMap$' + randomUniq()));
	if (!iterable) return self;
	forOf(iterable, function (val) {
		value(val);
		self.set(val[0], val[1]);
	});
	return self;
};

if (isNative) {
	if (setPrototypeOf) setPrototypeOf(WeakMapPoly, WeakMap);
	WeakMapPoly.prototype = Object.create(WeakMap.prototype, {
		constructor: d(WeakMapPoly)
	});
}

Object.defineProperties(WeakMapPoly.prototype, {
	delete: d(function (key) {
		if (hasOwnProperty.call(object(key), this.__weakMapData__)) {
			delete key[this.__weakMapData__];
			return true;
		}
		return false;
	}),
	get: d(function (key) {
		if (hasOwnProperty.call(object(key), this.__weakMapData__)) {
			return key[this.__weakMapData__];
		}
	}),
	has: d(function (key) {
		return hasOwnProperty.call(object(key), this.__weakMapData__);
	}),
	set: d(function (key, value) {
		defineProperty(object(key), this.__weakMapData__, d('c', value));
		return this;
	}),
	toString: d(function () { return '[object WeakMap]'; })
});
defineProperty(WeakMapPoly.prototype, toStringTagSymbol, d('c', 'WeakMap'));

},{"./is-native-implemented":68,"d":12,"es5-ext/object/set-prototype-of":43,"es5-ext/object/valid-object":47,"es5-ext/object/valid-value":48,"es5-ext/string/random-uniq":53,"es6-iterator/for-of":55,"es6-iterator/get":56,"es6-symbol":61}],70:[function(require,module,exports){
/*eslint new-cap:0*/
var dtype = require('dtype')

module.exports = flattenVertexData

function flattenVertexData (data, output, offset) {
  if (!data) throw new TypeError('must specify data as first parameter')
  offset = +(offset || 0) | 0

  if (Array.isArray(data) && (data[0] && typeof data[0][0] === 'number')) {
    var dim = data[0].length
    var length = data.length * dim
    var i, j, k, l

    // no output specified, create a new typed array
    if (!output || typeof output === 'string') {
      output = new (dtype(output || 'float32'))(length + offset)
    }

    var dstLength = output.length - offset
    if (length !== dstLength) {
      throw new Error('source length ' + length + ' (' + dim + 'x' + data.length + ')' +
        ' does not match destination length ' + dstLength)
    }

    for (i = 0, k = offset; i < data.length; i++) {
      for (j = 0; j < dim; j++) {
        output[k++] = data[i][j] === null ? NaN : data[i][j]
      }
    }
  } else {
    if (!output || typeof output === 'string') {
      // no output, create a new one
      var Ctor = dtype(output || 'float32')

      // handle arrays separately due to possible nulls
      if (Array.isArray(data) || output === 'array') {
        output = new Ctor(data.length + offset)
        for (i = 0, k = offset, l = output.length; k < l; k++, i++) {
          output[k] = data[i] === null ? NaN : data[i]
        }
      } else {
        if (offset === 0) {
          output = new Ctor(data)
        } else {
          output = new Ctor(data.length + offset)

          output.set(data, offset)
        }
      }
    } else {
      // store output in existing array
      output.set(data, offset)
    }
  }

  return output
}

},{"dtype":14}],71:[function(require,module,exports){
module.exports = function(strings) {
  if (typeof strings === 'string') strings = [strings]
  var exprs = [].slice.call(arguments,1)
  var parts = []
  for (var i = 0; i < strings.length-1; i++) {
    parts.push(strings[i], exprs[i] || '')
  }
  parts.push(strings[i])
  return parts.join('')
}

},{}],72:[function(require,module,exports){
'use strict';
var toString = Object.prototype.toString;

module.exports = function (x) {
	var prototype;
	return toString.call(x) === '[object Object]' && (prototype = Object.getPrototypeOf(x), prototype === null || prototype === Object.getPrototypeOf({}));
};

},{}],73:[function(require,module,exports){
/*
object-assign
(c) Sindre Sorhus
@license MIT
*/

'use strict';
/* eslint-disable no-unused-vars */
var getOwnPropertySymbols = Object.getOwnPropertySymbols;
var hasOwnProperty = Object.prototype.hasOwnProperty;
var propIsEnumerable = Object.prototype.propertyIsEnumerable;

function toObject(val) {
	if (val === null || val === undefined) {
		throw new TypeError('Object.assign cannot be called with null or undefined');
	}

	return Object(val);
}

function shouldUseNative() {
	try {
		if (!Object.assign) {
			return false;
		}

		// Detect buggy property enumeration order in older V8 versions.

		// https://bugs.chromium.org/p/v8/issues/detail?id=4118
		var test1 = new String('abc');  // eslint-disable-line no-new-wrappers
		test1[5] = 'de';
		if (Object.getOwnPropertyNames(test1)[0] === '5') {
			return false;
		}

		// https://bugs.chromium.org/p/v8/issues/detail?id=3056
		var test2 = {};
		for (var i = 0; i < 10; i++) {
			test2['_' + String.fromCharCode(i)] = i;
		}
		var order2 = Object.getOwnPropertyNames(test2).map(function (n) {
			return test2[n];
		});
		if (order2.join('') !== '0123456789') {
			return false;
		}

		// https://bugs.chromium.org/p/v8/issues/detail?id=3056
		var test3 = {};
		'abcdefghijklmnopqrst'.split('').forEach(function (letter) {
			test3[letter] = letter;
		});
		if (Object.keys(Object.assign({}, test3)).join('') !==
				'abcdefghijklmnopqrst') {
			return false;
		}

		return true;
	} catch (err) {
		// We don't expect any of the above to throw, but better to be safe.
		return false;
	}
}

module.exports = shouldUseNative() ? Object.assign : function (target, source) {
	var from;
	var to = toObject(target);
	var symbols;

	for (var s = 1; s < arguments.length; s++) {
		from = Object(arguments[s]);

		for (var key in from) {
			if (hasOwnProperty.call(from, key)) {
				to[key] = from[key];
			}
		}

		if (getOwnPropertySymbols) {
			symbols = getOwnPropertySymbols(from);
			for (var i = 0; i < symbols.length; i++) {
				if (propIsEnumerable.call(from, symbols[i])) {
					to[symbols[i]] = from[symbols[i]];
				}
			}
		}
	}

	return to;
};

},{}],74:[function(require,module,exports){
'use strict'

var pick = require('pick-by-alias')

module.exports = parseRect

function parseRect (arg) {
  var rect

  // direct arguments sequence
  if (arguments.length > 1) {
    arg = arguments
  }

  // svg viewbox
  if (typeof arg === 'string') {
    arg = arg.split(/\s/).map(parseFloat)
  }
  else if (typeof arg === 'number') {
    arg = [arg]
  }

  // 0, 0, 100, 100 - array-like
  if (arg.length && typeof arg[0] === 'number') {
    // [w, w]
    if (arg.length === 1) {
      rect = {
        width: arg[0],
        height: arg[0],
        x: 0, y: 0
      }
    }
    // [w, h]
    else if (arg.length === 2) {
      rect = {
        width: arg[0],
        height: arg[1],
        x: 0, y: 0
      }
    }
    // [l, t, r, b]
    else {
      rect = {
        x: arg[0],
        y: arg[1],
        width: (arg[2] - arg[0]) || 0,
        height: (arg[3] - arg[1]) || 0
      }
    }
  }
  // {x, y, w, h} or {l, t, b, r}
  else if (arg) {
    arg = pick(arg, {
      left: 'x l left Left',
      top: 'y t top Top',
      width: 'w width W Width',
      height: 'h height W Width',
      bottom: 'b bottom Bottom',
      right: 'r right Right'
    })

    rect = {
      x: arg.left || 0,
      y: arg.top || 0
    }

    if (arg.width == null) {
      if (arg.right) rect.width = arg.right - rect.x
      else rect.width = 0
    }
    else {
      rect.width = arg.width
    }

    if (arg.height == null) {
      if (arg.bottom) rect.height = arg.bottom - rect.y
      else rect.height = 0
    }
    else {
      rect.height = arg.height
    }
  }

  return rect
}

},{"pick-by-alias":75}],75:[function(require,module,exports){
'use strict'


module.exports = function pick (src, props, keepRest) {
	var result = {}, prop, i

	if (typeof props === 'string') props = toList(props)
	if (Array.isArray(props)) {
		var res = {}
		for (i = 0; i < props.length; i++) {
			res[props[i]] = true
		}
		props = res
	}

	// convert strings to lists
	for (prop in props) {
		props[prop] = toList(props[prop])
	}

	// keep-rest strategy requires unmatched props to be preserved
	var occupied = {}

	for (prop in props) {
		var aliases = props[prop]

		if (Array.isArray(aliases)) {
			for (i = 0; i < aliases.length; i++) {
				var alias = aliases[i]

				if (keepRest) {
					occupied[alias] = true
				}

				if (alias in src) {
					result[prop] = src[alias]

					if (keepRest) {
						for (var j = i; j < aliases.length; j++) {
							occupied[aliases[j]] = true
						}
					}

					break
				}
			}
		}
		else if (prop in src) {
			if (props[prop]) {
				result[prop] = src[prop]
			}

			if (keepRest) {
				occupied[prop] = true
			}
		}
	}

	if (keepRest) {
		for (prop in src) {
			if (occupied[prop]) continue
			result[prop] = src[prop]
		}
	}

	return result
}

var CACHE = {}

function toList(arg) {
	if (CACHE[arg]) return CACHE[arg]
	if (typeof arg === 'string') {
		arg = CACHE[arg] = arg.split(/\s*,\s*|\s+/)
	}
	return arg
}

},{}],76:[function(require,module,exports){
/* @module to-float32 */

'use strict'

module.exports = float32
module.exports.float32 =
module.exports.float = float32
module.exports.fract32 =
module.exports.fract = fract32

var narr = new Float32Array(1)

// return fractional part of float32 array
function fract32 (arr) {
	if (arr.length) {
		var fract = float32(arr)
		for (var i = 0, l = fract.length; i < l; i++) {
			fract[i] = arr[i] - fract[i]
		}
		return fract
	}

	// number
	return float32(arr - float32(arr))
}

// make sure data is float32 array
function float32 (arr) {
	if (arr.length) {
		if (arr instanceof Float32Array) return arr
		var float = new Float32Array(arr)
		float.set(arr)
		return float
	}

	// number
	narr[0] = arr
	return narr[0]
}

},{}]},{},[1])(1)
});
