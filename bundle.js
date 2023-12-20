'use strict';

const rgba = require('color-normalize');
const getBounds = require('array-bounds');
const extend = require('object-assign');
const glslify = require('glslify');
const pick = require('pick-by-alias');
const flatten = require('flatten-vertex-data');
const triangulate = require('earcut');
const normalize = require('array-normalize');
const {
  float32,
  fract32
} = require('to-float32');
const WeakMap = require('es6-weak-map');
const parseRect = require('parse-rect');
const findIndex = require('array-find-index');
var reglLine2d = Line2D;

/** @constructor */
function Line2D(regl, options) {
  if (!(this instanceof Line2D)) return new Line2D(regl, options);
  if (typeof regl === 'function') {
    if (!options) options = {};
    options.regl = regl;
  } else {
    options = regl;
  }
  if (options.length) options.positions = options;
  regl = options.regl;
  if (!regl.hasExtension('ANGLE_instanced_arrays')) {
    throw Error('regl-error2d: `ANGLE_instanced_arrays` extension should be enabled');
  }

  // persistent variables
  this.gl = regl._gl;
  this.regl = regl;

  // list of options for lines
  this.passes = [];

  // cached shaders instance
  this.shaders = Line2D.shaders.has(regl) ? Line2D.shaders.get(regl) : Line2D.shaders.set(regl, Line2D.createShaders(regl)).get(regl);

  // init defaults
  this.update(options);
}
Line2D.dashMult = 2;
Line2D.maxPatternLength = 256;
Line2D.precisionThreshold = 3e6;
Line2D.maxPoints = 1e4;
Line2D.maxLines = 2048;

// cache of created draw calls per-regl instance
Line2D.shaders = new WeakMap();

// create static shaders once
Line2D.createShaders = function (regl) {
  let offsetBuffer = regl.buffer({
    usage: 'static',
    type: 'float',
    data: [0, 1, 0, 0, 1, 1, 1, 0]
  });
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
      dashTexture: regl.prop('dashTexture'),
      opacity: regl.prop('opacity'),
      pixelRatio: regl.context('pixelRatio'),
      id: regl.prop('id'),
      dashLength: regl.prop('dashLength'),
      viewport: (c, p) => [p.viewport.x, p.viewport.y, c.viewportWidth, c.viewportHeight],
      depth: regl.prop('depth')
    },
    blend: {
      enable: true,
      color: [0, 0, 0, 0],
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
      enable: (c, p) => {
        return !p.overlay;
      }
    },
    stencil: {
      enable: false
    },
    scissor: {
      enable: true,
      box: regl.prop('viewport')
    },
    viewport: regl.prop('viewport')
  };

  // simplified rectangular line shader
  let drawRectLine = regl(extend({
    vert: glslify(["precision highp float;\n#define GLSLIFY 1\n\nattribute vec2 aCoord, bCoord, aCoordFract, bCoordFract;\nattribute vec4 color;\nattribute float lineEnd, lineTop;\n\nuniform vec2 scale, scaleFract, translate, translateFract;\nuniform float thickness, pixelRatio, id, depth;\nuniform vec4 viewport;\n\nvarying vec4 fragColor;\nvarying vec2 tangent;\n\nvec2 project(vec2 position, vec2 positionFract, vec2 scale, vec2 scaleFract, vec2 translate, vec2 translateFract) {\n\t// the order is important\n\treturn position * scale + translate\n       + positionFract * scale + translateFract\n       + position * scaleFract\n       + positionFract * scaleFract;\n}\n\nvoid main() {\n\tfloat lineStart = 1. - lineEnd;\n\tfloat lineOffset = lineTop * 2. - 1.;\n\n\tvec2 diff = (bCoord + bCoordFract - aCoord - aCoordFract);\n\ttangent = normalize(diff * scale * viewport.zw);\n\tvec2 normal = vec2(-tangent.y, tangent.x);\n\n\tvec2 position = project(aCoord, aCoordFract, scale, scaleFract, translate, translateFract) * lineStart\n\t\t+ project(bCoord, bCoordFract, scale, scaleFract, translate, translateFract) * lineEnd\n\n\t\t+ thickness * normal * .5 * lineOffset / viewport.zw;\n\n\tgl_Position = vec4(position * 2.0 - 1.0, depth, 1);\n\n\tfragColor = color / 255.;\n}\n"]),
    frag: glslify(["precision highp float;\n#define GLSLIFY 1\n\nuniform float dashLength, pixelRatio, thickness, opacity, id;\nuniform sampler2D dashTexture;\n\nvarying vec4 fragColor;\nvarying vec2 tangent;\n\nvoid main() {\n\tfloat alpha = 1.;\n\n\tfloat t = fract(dot(tangent, gl_FragCoord.xy) / dashLength) * .5 + .25;\n\tfloat dash = texture2D(dashTexture, vec2(t, .5)).r;\n\n\tgl_FragColor = fragColor;\n\tgl_FragColor.a *= alpha * opacity * dash;\n}\n"]),
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
  }, shaderOptions));

  // create regl draw
  let drawMiterLine;
  try {
    drawMiterLine = regl(extend({
      // culling removes polygon creasing
      cull: {
        enable: true,
        face: 'back'
      },
      vert: glslify(["precision highp float;\n#define GLSLIFY 1\n\nattribute vec2 aCoord, bCoord, nextCoord, prevCoord;\nattribute vec4 aColor, bColor;\nattribute float lineEnd, lineTop;\n\nuniform vec2 scale, translate;\nuniform float thickness, pixelRatio, id, depth;\nuniform vec4 viewport;\nuniform float miterLimit, miterMode;\n\nvarying vec4 fragColor;\nvarying vec4 startCutoff, endCutoff;\nvarying vec2 tangent;\nvarying vec2 startCoord, endCoord;\nvarying float enableStartMiter, enableEndMiter;\n\nconst float REVERSE_THRESHOLD = -.875;\nconst float MIN_DIFF = 1e-6;\n\n// TODO: possible optimizations: avoid overcalculating all for vertices and calc just one instead\n// TODO: precalculate dot products, normalize things beforehead etc.\n// TODO: refactor to rectangular algorithm\n\nfloat distToLine(vec2 p, vec2 a, vec2 b) {\n\tvec2 diff = b - a;\n\tvec2 perp = normalize(vec2(-diff.y, diff.x));\n\treturn dot(p - a, perp);\n}\n\nbool isNaN( float val ){\n  return ( val < 0.0 || 0.0 < val || val == 0.0 ) ? false : true;\n}\n\nvoid main() {\n\tvec2 aCoord = aCoord, bCoord = bCoord, prevCoord = prevCoord, nextCoord = nextCoord;\n\n  vec2 adjustedScale;\n  adjustedScale.x = (abs(scale.x) < MIN_DIFF) ? MIN_DIFF : scale.x;\n  adjustedScale.y = (abs(scale.y) < MIN_DIFF) ? MIN_DIFF : scale.y;\n\n  vec2 scaleRatio = adjustedScale * viewport.zw;\n\tvec2 normalWidth = thickness / scaleRatio;\n\n\tfloat lineStart = 1. - lineEnd;\n\tfloat lineBot = 1. - lineTop;\n\n\tfragColor = (lineStart * aColor + lineEnd * bColor) / 255.;\n\n\tif (isNaN(aCoord.x) || isNaN(aCoord.y) || isNaN(bCoord.x) || isNaN(bCoord.y)) return;\n\n\tif (aCoord == prevCoord) prevCoord = aCoord + normalize(bCoord - aCoord);\n\tif (bCoord == nextCoord) nextCoord = bCoord - normalize(bCoord - aCoord);\n\n\tvec2 prevDiff = aCoord - prevCoord;\n\tvec2 currDiff = bCoord - aCoord;\n\tvec2 nextDiff = nextCoord - bCoord;\n\n\tvec2 prevTangent = normalize(prevDiff * scaleRatio);\n\tvec2 currTangent = normalize(currDiff * scaleRatio);\n\tvec2 nextTangent = normalize(nextDiff * scaleRatio);\n\n\tvec2 prevNormal = vec2(-prevTangent.y, prevTangent.x);\n\tvec2 currNormal = vec2(-currTangent.y, currTangent.x);\n\tvec2 nextNormal = vec2(-nextTangent.y, nextTangent.x);\n\n\tvec2 startJoinDirection = normalize(prevTangent - currTangent);\n\tvec2 endJoinDirection = normalize(currTangent - nextTangent);\n\n\t// collapsed/unidirectional segment cases\n\t// FIXME: there should be more elegant solution\n\tvec2 prevTanDiff = abs(prevTangent - currTangent);\n\tvec2 nextTanDiff = abs(nextTangent - currTangent);\n\tif (max(prevTanDiff.x, prevTanDiff.y) < MIN_DIFF) {\n\t\tstartJoinDirection = currNormal;\n\t}\n\tif (max(nextTanDiff.x, nextTanDiff.y) < MIN_DIFF) {\n\t\tendJoinDirection = currNormal;\n\t}\n\tif (aCoord == bCoord) {\n\t\tendJoinDirection = startJoinDirection;\n\t\tcurrNormal = prevNormal;\n\t\tcurrTangent = prevTangent;\n\t}\n\n\ttangent = currTangent;\n\n\t//calculate join shifts relative to normals\n\tfloat startJoinShift = dot(currNormal, startJoinDirection);\n\tfloat endJoinShift = dot(currNormal, endJoinDirection);\n\n\tfloat startMiterRatio = abs(1. / startJoinShift);\n\tfloat endMiterRatio = abs(1. / endJoinShift);\n\n\tvec2 startJoin = startJoinDirection * startMiterRatio;\n\tvec2 endJoin = endJoinDirection * endMiterRatio;\n\n\tvec2 startTopJoin, startBotJoin, endTopJoin, endBotJoin;\n\tstartTopJoin = sign(startJoinShift) * startJoin * .5;\n\tstartBotJoin = -startTopJoin;\n\n\tendTopJoin = sign(endJoinShift) * endJoin * .5;\n\tendBotJoin = -endTopJoin;\n\n\tvec2 aTopCoord = aCoord + normalWidth * startTopJoin;\n\tvec2 bTopCoord = bCoord + normalWidth * endTopJoin;\n\tvec2 aBotCoord = aCoord + normalWidth * startBotJoin;\n\tvec2 bBotCoord = bCoord + normalWidth * endBotJoin;\n\n\t//miter anti-clipping\n\tfloat baClipping = distToLine(bCoord, aCoord, aBotCoord) / dot(normalize(normalWidth * endBotJoin), normalize(normalWidth.yx * vec2(-startBotJoin.y, startBotJoin.x)));\n\tfloat abClipping = distToLine(aCoord, bCoord, bTopCoord) / dot(normalize(normalWidth * startBotJoin), normalize(normalWidth.yx * vec2(-endBotJoin.y, endBotJoin.x)));\n\n\t//prevent close to reverse direction switch\n\tbool prevReverse = dot(currTangent, prevTangent) <= REVERSE_THRESHOLD && abs(dot(currTangent, prevNormal)) * min(length(prevDiff), length(currDiff)) <  length(normalWidth * currNormal);\n\tbool nextReverse = dot(currTangent, nextTangent) <= REVERSE_THRESHOLD && abs(dot(currTangent, nextNormal)) * min(length(nextDiff), length(currDiff)) <  length(normalWidth * currNormal);\n\n\tif (prevReverse) {\n\t\t//make join rectangular\n\t\tvec2 miterShift = normalWidth * startJoinDirection * miterLimit * .5;\n\t\tfloat normalAdjust = 1. - min(miterLimit / startMiterRatio, 1.);\n\t\taBotCoord = aCoord + miterShift - normalAdjust * normalWidth * currNormal * .5;\n\t\taTopCoord = aCoord + miterShift + normalAdjust * normalWidth * currNormal * .5;\n\t}\n\telse if (!nextReverse && baClipping > 0. && baClipping < length(normalWidth * endBotJoin)) {\n\t\t//handle miter clipping\n\t\tbTopCoord -= normalWidth * endTopJoin;\n\t\tbTopCoord += normalize(endTopJoin * normalWidth) * baClipping;\n\t}\n\n\tif (nextReverse) {\n\t\t//make join rectangular\n\t\tvec2 miterShift = normalWidth * endJoinDirection * miterLimit * .5;\n\t\tfloat normalAdjust = 1. - min(miterLimit / endMiterRatio, 1.);\n\t\tbBotCoord = bCoord + miterShift - normalAdjust * normalWidth * currNormal * .5;\n\t\tbTopCoord = bCoord + miterShift + normalAdjust * normalWidth * currNormal * .5;\n\t}\n\telse if (!prevReverse && abClipping > 0. && abClipping < length(normalWidth * startBotJoin)) {\n\t\t//handle miter clipping\n\t\taBotCoord -= normalWidth * startBotJoin;\n\t\taBotCoord += normalize(startBotJoin * normalWidth) * abClipping;\n\t}\n\n\tvec2 aTopPosition = (aTopCoord) * adjustedScale + translate;\n\tvec2 aBotPosition = (aBotCoord) * adjustedScale + translate;\n\n\tvec2 bTopPosition = (bTopCoord) * adjustedScale + translate;\n\tvec2 bBotPosition = (bBotCoord) * adjustedScale + translate;\n\n\t//position is normalized 0..1 coord on the screen\n\tvec2 position = (aTopPosition * lineTop + aBotPosition * lineBot) * lineStart + (bTopPosition * lineTop + bBotPosition * lineBot) * lineEnd;\n\n\tstartCoord = aCoord * scaleRatio + translate * viewport.zw + viewport.xy;\n\tendCoord = bCoord * scaleRatio + translate * viewport.zw + viewport.xy;\n\n\tgl_Position = vec4(position  * 2.0 - 1.0, depth, 1);\n\n\tenableStartMiter = step(dot(currTangent, prevTangent), .5);\n\tenableEndMiter = step(dot(currTangent, nextTangent), .5);\n\n\t//bevel miter cutoffs\n\tif (miterMode == 1.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tvec2 startMiterWidth = vec2(startJoinDirection) * thickness * miterLimit * .5;\n\t\t\tstartCutoff = vec4(aCoord, aCoord);\n\t\t\tstartCutoff.zw += vec2(-startJoinDirection.y, startJoinDirection.x) / scaleRatio;\n\t\t\tstartCutoff = startCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tstartCutoff += viewport.xyxy;\n\t\t\tstartCutoff += startMiterWidth.xyxy;\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tvec2 endMiterWidth = vec2(endJoinDirection) * thickness * miterLimit * .5;\n\t\t\tendCutoff = vec4(bCoord, bCoord);\n\t\t\tendCutoff.zw += vec2(-endJoinDirection.y, endJoinDirection.x)  / scaleRatio;\n\t\t\tendCutoff = endCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tendCutoff += viewport.xyxy;\n\t\t\tendCutoff += endMiterWidth.xyxy;\n\t\t}\n\t}\n\n\t//round miter cutoffs\n\telse if (miterMode == 2.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tvec2 startMiterWidth = vec2(startJoinDirection) * thickness * abs(dot(startJoinDirection, currNormal)) * .5;\n\t\t\tstartCutoff = vec4(aCoord, aCoord);\n\t\t\tstartCutoff.zw += vec2(-startJoinDirection.y, startJoinDirection.x) / scaleRatio;\n\t\t\tstartCutoff = startCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tstartCutoff += viewport.xyxy;\n\t\t\tstartCutoff += startMiterWidth.xyxy;\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tvec2 endMiterWidth = vec2(endJoinDirection) * thickness * abs(dot(endJoinDirection, currNormal)) * .5;\n\t\t\tendCutoff = vec4(bCoord, bCoord);\n\t\t\tendCutoff.zw += vec2(-endJoinDirection.y, endJoinDirection.x)  / scaleRatio;\n\t\t\tendCutoff = endCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tendCutoff += viewport.xyxy;\n\t\t\tendCutoff += endMiterWidth.xyxy;\n\t\t}\n\t}\n}\n"]),
      frag: glslify(["precision highp float;\n#define GLSLIFY 1\n\nuniform float dashLength, pixelRatio, thickness, opacity, id, miterMode;\nuniform sampler2D dashTexture;\n\nvarying vec4 fragColor;\nvarying vec2 tangent;\nvarying vec4 startCutoff, endCutoff;\nvarying vec2 startCoord, endCoord;\nvarying float enableStartMiter, enableEndMiter;\n\nfloat distToLine(vec2 p, vec2 a, vec2 b) {\n\tvec2 diff = b - a;\n\tvec2 perp = normalize(vec2(-diff.y, diff.x));\n\treturn dot(p - a, perp);\n}\n\nvoid main() {\n\tfloat alpha = 1., distToStart, distToEnd;\n\tfloat cutoff = thickness * .5;\n\n\t//bevel miter\n\tif (miterMode == 1.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tdistToStart = distToLine(gl_FragCoord.xy, startCutoff.xy, startCutoff.zw);\n\t\t\tif (distToStart < -1.) {\n\t\t\t\tdiscard;\n\t\t\t\treturn;\n\t\t\t}\n\t\t\talpha *= min(max(distToStart + 1., 0.), 1.);\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tdistToEnd = distToLine(gl_FragCoord.xy, endCutoff.xy, endCutoff.zw);\n\t\t\tif (distToEnd < -1.) {\n\t\t\t\tdiscard;\n\t\t\t\treturn;\n\t\t\t}\n\t\t\talpha *= min(max(distToEnd + 1., 0.), 1.);\n\t\t}\n\t}\n\n\t// round miter\n\telse if (miterMode == 2.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tdistToStart = distToLine(gl_FragCoord.xy, startCutoff.xy, startCutoff.zw);\n\t\t\tif (distToStart < 0.) {\n\t\t\t\tfloat radius = length(gl_FragCoord.xy - startCoord);\n\n\t\t\t\tif(radius > cutoff + .5) {\n\t\t\t\t\tdiscard;\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n\t\t\t\talpha -= smoothstep(cutoff - .5, cutoff + .5, radius);\n\t\t\t}\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tdistToEnd = distToLine(gl_FragCoord.xy, endCutoff.xy, endCutoff.zw);\n\t\t\tif (distToEnd < 0.) {\n\t\t\t\tfloat radius = length(gl_FragCoord.xy - endCoord);\n\n\t\t\t\tif(radius > cutoff + .5) {\n\t\t\t\t\tdiscard;\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n\t\t\t\talpha -= smoothstep(cutoff - .5, cutoff + .5, radius);\n\t\t\t}\n\t\t}\n\t}\n\n\tfloat t = fract(dot(tangent, gl_FragCoord.xy) / dashLength) * .5 + .25;\n\tfloat dash = texture2D(dashTexture, vec2(t, .5)).r;\n\n\tgl_FragColor = fragColor;\n\tgl_FragColor.a *= alpha * opacity * dash;\n}\n"]),
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
    }, shaderOptions));
  } catch (e) {
    // IE/bad Webkit fallback
    drawMiterLine = drawRectLine;
  }

  // fill shader
  let drawFill = regl({
    primitive: 'triangle',
    elements: (ctx, prop) => prop.triangles,
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
      viewport: (ctx, prop) => [prop.viewport.x, prop.viewport.y, ctx.viewportWidth, ctx.viewportHeight]
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
    depth: {
      enable: false
    },
    scissor: shaderOptions.scissor,
    stencil: shaderOptions.stencil,
    viewport: shaderOptions.viewport
  });
  return {
    fill: drawFill,
    rect: drawRectLine,
    miter: drawMiterLine
  };
};

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
};
Line2D.prototype.render = function () {
  if (arguments.length) {
    this.update(...arguments);
  }
  this.draw();
};
Line2D.prototype.draw = function () {
  for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }
  // render multiple polylines via regl batch
  (args.length ? args : this.passes).forEach((s, i) => {
    // render array pass as a list of passes
    if (s && Array.isArray(s)) return this.draw(...s);
    if (typeof s === 'number') s = this.passes[s];
    if (!(s && s.count > 1 && s.opacity)) return;
    this.regl._refresh();
    if (s.fill && s.triangles && s.triangles.length > 2) {
      this.shaders.fill(s);
    }
    if (!s.thickness) return;

    // high scale is only available for rect mode with precision
    if (s.scale[0] * s.viewport.width > Line2D.precisionThreshold || s.scale[1] * s.viewport.height > Line2D.precisionThreshold) {
      this.shaders.rect(s);
    }

    // thin this.passes or too many points are rendered as simplified rect shader
    else if (s.join === 'rect' || !s.join && (s.thickness <= 2 || s.count >= Line2D.maxPoints)) {
      this.shaders.rect(s);
    } else {
      this.shaders.miter(s);
    }
  });
  return this;
};
Line2D.prototype.update = function (options) {
  if (!options) return;
  if (options.length != null) {
    if (typeof options[0] === 'number') options = [{
      positions: options
    }];
  }

  // make options a batch
  else if (!Array.isArray(options)) options = [options];
  let {
    regl,
    gl
  } = this;

  // process per-line settings
  options.forEach((o, i) => {
    let state = this.passes[i];
    if (o === undefined) return;

    // null-argument removes pass
    if (o === null) {
      this.passes[i] = null;
      return;
    }
    if (typeof o[0] === 'number') o = {
      positions: o
    };

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
      hole: 'holes hole hollow',
      splitNull: 'splitNull'
    });

    // init state
    if (!state) {
      this.passes[i] = state = {
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
      };
      o = extend({}, Line2D.defaults, o);
    }
    if (o.thickness != null) state.thickness = parseFloat(o.thickness);
    if (o.opacity != null) state.opacity = parseFloat(o.opacity);
    if (o.miterLimit != null) state.miterLimit = parseFloat(o.miterLimit);
    if (o.overlay != null) {
      state.overlay = !!o.overlay;
      if (i < Line2D.maxLines) {
        state.depth = 2 * (Line2D.maxLines - 1 - i % Line2D.maxLines) / Line2D.maxLines - 1.;
      }
    }
    if (o.join != null) state.join = o.join;
    if (o.hole != null) state.hole = o.hole;
    if (o.fill != null) state.fill = !o.fill ? null : rgba(o.fill, 'uint8');
    if (o.viewport != null) state.viewport = parseRect(o.viewport);
    if (!state.viewport) {
      state.viewport = parseRect([gl.drawingBufferWidth, gl.drawingBufferHeight]);
    }
    if (o.close != null) state.close = o.close;

    // reset positions
    if (o.positions === null) o.positions = [];
    if (o.positions) {
      let positions, count;

      // if positions are an object with x/y
      if (o.positions.x && o.positions.y) {
        let xPos = o.positions.x;
        let yPos = o.positions.y;
        count = state.count = Math.max(xPos.length, yPos.length);
        positions = new Float64Array(count * 2);
        for (let i = 0; i < count; i++) {
          positions[i * 2] = xPos[i];
          positions[i * 2 + 1] = yPos[i];
        }
      } else {
        positions = flatten(o.positions, 'float64');
        count = state.count = Math.floor(positions.length / 2);
      }
      let bounds = state.bounds = getBounds(positions, 2);

      // create fill positions
      // FIXME: fill positions can be set only along with positions
      if (state.fill) {
        let pos = [];

        // filter bad vertices and remap triangles to ensure shape
        let ids = {};
        let lastId = 0;
        for (let i = 0, ptr = 0, l = state.count; i < l; i++) {
          let x = positions[i * 2];
          let y = positions[i * 2 + 1];
          if (isNaN(x) || isNaN(y) || x == null || y == null) {
            x = positions[lastId * 2];
            y = positions[lastId * 2 + 1];
            ids[i] = lastId;
          } else {
            lastId = i;
          }
          pos[ptr++] = x;
          pos[ptr++] = y;
        }

        // split the input into multiple polygon at Null/NaN
        if (o.splitNull) {
          // use "ids" to track the boundary of segment
          // the keys in "ids" is the end boundary of a segment, or split point

          // make sure there is at least one segment
          if (!(state.count - 1 in ids)) ids[state.count] = state.count - 1;
          let splits = Object.keys(ids).map(Number).sort((a, b) => a - b);
          let split_triangles = [];
          let base = 0;

          // do not split holes
          let hole_base = state.hole != null ? state.hole[0] : null;
          if (hole_base != null) {
            let last_id = findIndex(splits, e => e >= hole_base);
            splits = splits.slice(0, last_id);
            splits.push(hole_base);
          }
          for (let i = 0; i < splits.length; i++) {
            // create temporary pos array with only one segment and all the holes
            let seg_pos = pos.slice(base * 2, splits[i] * 2).concat(hole_base ? pos.slice(hole_base * 2) : []);
            let hole = (state.hole || []).map(e => e - hole_base + (splits[i] - base));
            let triangles = triangulate(seg_pos, hole);
            // map triangle index back to the original pos buffer
            triangles = triangles.map(e => e + base + (e + base < splits[i] ? 0 : hole_base - splits[i]));
            split_triangles.push(...triangles);

            // skip split point
            base = splits[i] + 1;
          }
          for (let i = 0, l = split_triangles.length; i < l; i++) {
            if (ids[split_triangles[i]] != null) split_triangles[i] = ids[split_triangles[i]];
          }
          state.triangles = split_triangles;
        } else {
          // treat the wholw input as a single polygon
          let triangles = triangulate(pos, state.hole || []);
          for (let i = 0, l = triangles.length; i < l; i++) {
            if (ids[triangles[i]] != null) triangles[i] = ids[triangles[i]];
          }
          state.triangles = triangles;
        }
      }

      // update position buffers
      let npos = new Float64Array(positions);
      normalize(npos, 2, bounds);
      let positionData = new Float64Array(count * 2 + 6);

      // rotate first segment join
      if (state.close) {
        if (positions[0] === positions[count * 2 - 2] && positions[1] === positions[count * 2 - 1]) {
          positionData[0] = npos[count * 2 - 4];
          positionData[1] = npos[count * 2 - 3];
        } else {
          positionData[0] = npos[count * 2 - 2];
          positionData[1] = npos[count * 2 - 1];
        }
      } else {
        positionData[0] = npos[0];
        positionData[1] = npos[1];
      }
      positionData.set(npos, 2);

      // add last segment
      if (state.close) {
        // ignore coinciding start/end
        if (positions[0] === positions[count * 2 - 2] && positions[1] === positions[count * 2 - 1]) {
          positionData[count * 2 + 2] = npos[2];
          positionData[count * 2 + 3] = npos[3];
          state.count -= 1;
        } else {
          positionData[count * 2 + 2] = npos[0];
          positionData[count * 2 + 3] = npos[1];
          positionData[count * 2 + 4] = npos[2];
          positionData[count * 2 + 5] = npos[3];
        }
      }
      // add stub
      else {
        positionData[count * 2 + 2] = npos[count * 2 - 2];
        positionData[count * 2 + 3] = npos[count * 2 - 1];
        positionData[count * 2 + 4] = npos[count * 2 - 2];
        positionData[count * 2 + 5] = npos[count * 2 - 1];
      }
      var float_data = float32(positionData);
      state.positionBuffer(float_data);
      var frac_data = fract32(positionData, float_data);
      state.positionFractBuffer(frac_data);
    }
    if (o.range) {
      state.range = o.range;
    } else if (!state.range) {
      state.range = state.bounds;
    }
    if ((o.range || o.positions) && state.count) {
      let bounds = state.bounds;
      let boundsW = bounds[2] - bounds[0],
        boundsH = bounds[3] - bounds[1];
      let rangeW = state.range[2] - state.range[0],
        rangeH = state.range[3] - state.range[1];
      state.scale = [boundsW / rangeW, boundsH / rangeH];
      state.translate = [-state.range[0] / rangeW + bounds[0] / rangeW || 0, -state.range[1] / rangeH + bounds[1] / rangeH || 0];
      state.scaleFract = fract32(state.scale);
      state.translateFract = fract32(state.translate);
    }
    if (o.dashes) {
      let dashLength = 0.,
        dashData;
      if (!o.dashes || o.dashes.length < 2) {
        dashLength = 1.;
        dashData = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);
      } else {
        dashLength = 0.;
        for (let i = 0; i < o.dashes.length; ++i) {
          dashLength += o.dashes[i];
        }
        dashData = new Uint8Array(dashLength * Line2D.dashMult);
        let ptr = 0;
        let fillColor = 255;

        // repeat texture two times to provide smooth 0-step
        for (let k = 0; k < 2; k++) {
          for (let i = 0; i < o.dashes.length; ++i) {
            for (let j = 0, l = o.dashes[i] * Line2D.dashMult * .5; j < l; ++j) {
              dashData[ptr++] = fillColor;
            }
            fillColor ^= 255;
          }
        }
      }
      state.dashLength = dashLength;
      state.dashTexture({
        channels: 1,
        data: dashData,
        width: dashData.length,
        height: 1,
        mag: 'linear',
        min: 'linear'
      }, 0, 0);
    }
    if (o.color) {
      let count = state.count;
      let colors = o.color;
      if (!colors) colors = 'transparent';
      let colorData = new Uint8Array(count * 4 + 4);

      // convert colors to typed arrays
      if (!Array.isArray(colors) || typeof colors[0] === 'number') {
        let c = rgba(colors, 'uint8');
        for (let i = 0; i < count + 1; i++) {
          colorData.set(c, i * 4);
        }
      } else {
        for (let i = 0; i < count; i++) {
          let c = rgba(colors[i], 'uint8');
          colorData.set(c, i * 4);
        }
        colorData.set(rgba(colors[0], 'uint8'), count * 4);
      }
      state.colorBuffer({
        usage: 'dynamic',
        type: 'uint8',
        data: colorData
      });
    }
  });

  // remove unmentioned passes
  if (options.length < this.passes.length) {
    for (let i = options.length; i < this.passes.length; i++) {
      let pass = this.passes[i];
      if (!pass) continue;
      pass.colorBuffer.destroy();
      pass.positionBuffer.destroy();
      pass.dashTexture.destroy();
    }
    this.passes.length = options.length;
  }

  // remove null items
  let passes = [];
  for (let i = 0; i < this.passes.length; i++) {
    if (this.passes[i] !== null) passes.push(this.passes[i]);
  }
  this.passes = passes;
  return this;
};
Line2D.prototype.destroy = function () {
  this.passes.forEach(pass => {
    pass.colorBuffer.destroy();
    pass.positionBuffer.destroy();
    pass.dashTexture.destroy();
  });
  this.passes.length = 0;
  return this;
};

module.exports = reglLine2d;
