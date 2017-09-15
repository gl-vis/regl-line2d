precision highp float;

attribute vec2 startCoord, endCoord;
attribute vec4 startColor, endColor;
attribute float lineEnd, lineOffset;

uniform vec2 scale, translate;
uniform float thickness, pixelRatio;
uniform vec4 viewport;

varying vec4 fragColor;
varying vec2 tangent;

void main() {
	float lineStart = 1. - lineEnd;
	vec2 pixelScale = pixelRatio / viewport.zw;

	vec2 direction = endCoord - startCoord;
	vec2 normal = normalize(vec2(-direction.y, direction.x) * scale.yx * pixelScale);

	tangent = normalize(direction * scale * pixelScale);

	vec2 offset = pixelScale * lineOffset * thickness;

	vec2 position = startCoord + direction * lineEnd;
	position = (position + translate) * scale;

	vec2 rectPosition = position;
	rectPosition += offset * normal * lineStart * .5;
	rectPosition += offset * normal * lineEnd * .5;

	gl_Position = vec4(rectPosition * 2.0 - 1.0, 0, 1);

	fragColor = (lineEnd * endColor + lineStart * startColor) / 255.;
}
