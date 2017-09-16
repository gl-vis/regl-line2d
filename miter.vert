precision highp float;

attribute vec2 aCoord, bCoord, nextCoord, prevCoord;// joinStart, joinEnd;
attribute vec4 aColor, bColor;
attribute float lineEnd, lineOffset;

uniform vec2 scale, translate;
uniform float thickness, pixelRatio;
uniform vec4 viewport;
uniform float miterLimit, dashLength;

varying vec4 fragColor;
varying vec4 startCutoff, endCutoff;
varying vec2 tangent;

const float REVERSE_MITER = -1e-5;

void main() {
	vec2 pixelScale = pixelRatio / viewport.zw;
	vec2 scaleRatio = scale / pixelScale;

	float lineStart = 1. - lineEnd;

	vec2 prevDirection = aCoord - prevCoord;
	vec2 currDirection = bCoord - aCoord;
	vec2 nextDirection = nextCoord - bCoord;

	vec2 prevTangent = normalize(prevDirection * scaleRatio);
	vec2 currTangent = normalize(currDirection * scaleRatio);
	vec2 nextTangent = normalize(nextDirection * scaleRatio);

	vec2 prevNormal = vec2(-prevTangent.y, prevTangent.x);
	vec2 currNormal = vec2(-currTangent.y, currTangent.x);
	vec2 nextNormal = vec2(-nextTangent.y, nextTangent.x);

	vec2 startJoin = prevTangent - currTangent;
	vec2 endJoin = currTangent - nextTangent;

	if (prevCoord == aCoord) {
		startJoin = currNormal;
	}
	if (aCoord == bCoord) {
		endJoin = startJoin;
	}
	if (bCoord == nextCoord) {
		endJoin = currNormal;
	}

	float startMiterRatio = 1. / dot(startJoin, currNormal);
	float endMiterRatio = 1. / dot(endJoin, currNormal);

	startJoin *= startMiterRatio;
	endJoin *= endMiterRatio;

	vec2 offset = pixelScale * lineOffset * thickness;
	vec2 position = aCoord * lineStart + bCoord * lineEnd;
	position = (position + translate) * scale;

	position += offset * startJoin * lineStart * .5;
	position += offset * endJoin * lineEnd * .5;

	gl_Position = vec4(position * 2.0 - 1.0, 0, 1);

	//provides miter slicing
	startCutoff = vec4(aCoord, aCoord);
	startCutoff.zw += prevCoord == aCoord ? startJoin : vec2(-startJoin.y, startJoin.x);
	startCutoff += translate.xyxy;
	startCutoff *= scaleRatio.xyxy;

	endCutoff = vec4(bCoord, bCoord);
	endCutoff.zw += nextCoord == bCoord ? endJoin : vec2(-endJoin.y, endJoin.x);
	endCutoff += translate.xyxy;
	endCutoff *= scaleRatio.xyxy;

	if (dot(currTangent, startJoin) > REVERSE_MITER) {
		startCutoff.xyzw = startCutoff.zwxy;
		// miterWidth.xy = -miterWidth.xy;
	}
	if (dot(currTangent, endJoin) < REVERSE_MITER) {
		endCutoff.xyzw = endCutoff.zwxy;
		// miterWidth.zw = -miterWidth.zw;
	}

	startCutoff += viewport.xyxy;
	endCutoff += viewport.xyxy;

	// startCutoff += miterWidth.xyxy;
	// endCutoff += miterWidth.zwzw;

	tangent = currTangent;

	fragColor = (lineEnd * bColor + lineStart * aColor) / 255.;
}
