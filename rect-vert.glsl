precision highp float;

attribute vec2 aCoord, bCoord;
attribute vec4 color;
attribute float lineEnd, lineTop;

uniform vec2 scale, translate;
uniform float thickness, pixelRatio, id;
uniform vec4 viewport;

varying vec4 fragColor;
varying vec2 tangent;

const float MAX_LINES = 256.;

void main() {
	float lineStart = 1. - lineEnd;
	float lineOffset = lineTop * 2. - 1.;
	float depth = (MAX_LINES - 1. - id) / (MAX_LINES);
	vec2 scaleRatio = scale * viewport.zw;
	vec2 normalWidth = thickness / scaleRatio;

	vec2 diff = bCoord - aCoord;
	tangent = normalize(diff * scaleRatio);
	vec2 normal = vec2(-tangent.y, tangent.x);

	vec2 coord = aCoord + diff * lineEnd + normalWidth * normal * .5 * lineOffset;

	vec2 position = (coord + translate) * scale;

	gl_Position = vec4(position * 2.0 - 1.0, depth, 1);

	fragColor = color / 255.;
}
