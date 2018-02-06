precision highp float;

attribute vec2 position, positionFract;

uniform vec4 color;
uniform vec2 scale, scaleFract, translate, translateFract, scaleRatio;
uniform float pixelRatio, id;
uniform vec4 viewport;

varying vec4 fragColor;

const float MAX_LINES = 256.;

void main() {
	float depth = (MAX_LINES - 4. - id) / (MAX_LINES);

	vec2 position = position * scale
       + positionFract * scale
       + position * scaleFract + translate
       + positionFract * scaleFract + translateFract;

	gl_Position = vec4(position * 2.0 - 1.0, depth, 1);

	fragColor = color / 255.;
}
