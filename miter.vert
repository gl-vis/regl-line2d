precision highp float;

attribute vec2 startCoord, endCoord, joinStart, joinEnd;
attribute vec4 startColor, endColor;
attribute float lineEnd, lineOffset, distanceStart, distanceEnd;

uniform vec2 scale, translate;
uniform float thickness;
uniform vec2 pixelScale;
uniform float totalDistance, miterLimit, dashLength;

varying vec4 fragColor;
varying float fragLength;
varying vec4 startCutoff, endCutoff;

const float REVERSE_MITER = -1e-6;

void main() {
	float lineStart = 1. - lineEnd;
	vec2 joinStart = joinStart, joinEnd = joinEnd;
	vec4 miterWidth = vec4(vec2(normalize(joinStart)), vec2(normalize(joinEnd))) * miterLimit;

	vec2 scaleRatio = scale / pixelScale;

	vec2 direction = endCoord - startCoord;
	vec2 normal = normalize(vec2(-direction.y, direction.x));

	vec2 offset = pixelScale * lineOffset * thickness;

	vec2 position = startCoord + direction * lineEnd;
	position = (position + translate) * scale;

	vec2 joinPosition = position;
	joinPosition += offset * joinStart * lineStart * .5;
	joinPosition += offset * joinEnd * lineEnd * .5;

	vec2 rectPosition = position;
	rectPosition += offset * normal * lineStart * .5;
	rectPosition += offset * normal * lineEnd * .5;

	//provides even dash pattern
	fragLength = fract(distanceStart * scaleRatio.x / dashLength)
		+ (
		  lineEnd * (distanceEnd - distanceStart)
		+ dot((joinPosition - rectPosition) / scale, normalize(direction))
		) * scaleRatio.x / dashLength;

	//provides miter slicing
	startCutoff = vec4(
		startCoord + translate,
		startCoord + translate
		+ (distanceStart == 0. ? normal : vec2(-joinStart.y, joinStart.x))
	) * scaleRatio.xyxy;
	endCutoff = vec4(
		endCoord + translate,
		endCoord + translate
		+ (distanceEnd == totalDistance ? normal : vec2(-joinEnd.y, joinEnd.x))
	) * scaleRatio.xyxy;

	if (dot(direction, joinStart) > REVERSE_MITER) {
		startCutoff.xyzw = startCutoff.zwxy;
		miterWidth.xy = -miterWidth.xy;
	}
	if (dot(direction, joinEnd) < REVERSE_MITER) {
		endCutoff.xyzw = endCutoff.zwxy;
		miterWidth.zw = -miterWidth.zw;
	}

	startCutoff += miterWidth.xyxy;
	endCutoff += miterWidth.zwzw;

	gl_Position = vec4(joinPosition * 2.0 - 1.0, 0, 1);

	fragColor = (lineEnd * endColor + lineStart * startColor) / 255.;
}
