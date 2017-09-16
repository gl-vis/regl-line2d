precision highp float;

attribute vec2 aCoord, bCoord, nextCoord, prevCoord;// joinStart, joinEnd;
attribute vec4 aColor, bColor;
attribute float lineEnd, lineOffset, aDistance, bDistance;

uniform vec2 scale, translate;
uniform float thickness, pixelRatio;
uniform vec4 viewport;
uniform float totalDistance, miterLimit, dashLength;

varying vec4 fragColor;
varying float fragLength;
varying vec4 startCutoff, endCutoff;
varying vec2 tangent;

const float REVERSE_MITER = -1e-6;

void main() {
	vec2 pixelScale = pixelRatio / viewport.zw;
	vec2 scaleRatio = scale / pixelScale;

	float lineStart = 1. - lineEnd;

	vec2 prevDirection = aCoord - prevCoord;
	vec2 currDirection = bCoord - aCoord;
	vec2 nextDirection = nextCoord - bCoord;

	vec2 prevTangent = normalize(prevDirection * scale * pixelScale.yx);
	vec2 currTangent = normalize(currDirection * scale * pixelScale.yx);
	vec2 nextTangent = normalize(nextDirection * scale * pixelScale.yx);

	vec2 prevNormal = normalize(vec2(-prevDirection.y, prevDirection.x));
	vec2 currNormal = normalize(vec2(-currDirection.y, currDirection.x));
	vec2 nextNormal = normalize(vec2(-nextDirection.y, nextDirection.x));

	vec2 startJoin = normalize(prevDirection - currDirection);
	vec2 endJoin = normalize(currDirection - nextDirection);

	float startMiterRatio = 1. / dot(prevNormal, startJoin);
	float endMiterRatio = 1. / dot(currNormal, endJoin);

	vec2 startMiter = normalize(currNormal * scale.yx * pixelScale);
	vec2 endMiter = normalize(currNormal * scale.yx * pixelScale);

	vec2 offset = pixelScale * lineOffset * thickness;
	vec2 position = aCoord * lineStart + bCoord * lineEnd;
	position = (position + translate) * scale;

	vec2 rectPosition = position;
	rectPosition += offset * startMiter * lineStart * .5;
	rectPosition += offset * endMiter * lineEnd * .5;

	// vec2 joinStart = joinStart * normalize(scale.xy * pixelScale.yx);
	// vec2 joinEnd = joinEnd * normalize(scale.xy * pixelScale.yx);

	// vec2 joinPosition = position;
	// joinPosition += offset * joinStart * lineStart * .5;
	// joinPosition += offset * joinEnd * lineEnd * .5;

	gl_Position = vec4(rectPosition * 2.0 - 1.0, 0, 1);

	// vec2 joinStart = length(joinStart) * normalize(joinStart * scale.yx * pixelScale),
	// 	joinEnd = length(joinEnd) * normalize(joinEnd * scale.yx * pixelScale);
	// vec2 joinPosition = position;
	// joinPosition += offset * joinStart * lineStart * .5;
	// joinPosition += offset * joinEnd * lineEnd * .5;


	//provides even dash pattern
	// fragLength = fract(aDistance * scale.x * viewport.zw / pixelRatio / dashLength)
	// 	+ (
	// 	  lineEnd * (bDistance - aDistance)
	// 	+ dot((joinPosition - rectPosition) / scale, normalize(abDirection))
	// 	) * scaleRatio.x / dashLength;

	//provides miter slicing
	// startCutoff = vec4(
	// 	aCoord + translate,
	// 	aCoord + translate
	// 	+ (aDistance == 0. ? normal : vec2(-joinStart.y, joinStart.x))
	// ) * scaleRatio.xyxy;
	// endCutoff = vec4(
	// 	bCoord + translate,
	// 	bCoord + translate
	// 	+ (bDistance == totalDistance ? normal : vec2(-joinEnd.y, joinEnd.x))
	// ) * scaleRatio.xyxy;

	// if (dot(abDirection, joinStart) > REVERSE_MITER) {
	// 	startCutoff.xyzw = startCutoff.zwxy;
	// 	miterWidth.xy = -miterWidth.xy;
	// }
	// if (dot(abDirection, joinEnd) < REVERSE_MITER) {
	// 	endCutoff.xyzw = endCutoff.zwxy;
	// 	miterWidth.zw = -miterWidth.zw;
	// }

	// startCutoff += miterWidth.xyxy;
	// endCutoff += miterWidth.zwzw;

	tangent = currTangent;

	fragColor = (lineEnd * bColor + lineStart * aColor) / 255.;
}
