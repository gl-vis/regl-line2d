precision highp float;

uniform sampler2D dashPattern;
uniform vec2 dashShape;
uniform float dashLength, pixelRatio, thickness, opacity, id;

varying vec4 fragColor;
varying vec2 tangent;

void main() {
	float alpha = 1.;

	float t = fract(dot(tangent, gl_FragCoord.xy) / dashLength) * .5 + .25;
	float dash = texture2D(dashPattern, vec2(t * dashLength * 2. / dashShape.x, (id + .5) / dashShape.y)).r;

	gl_FragColor = fragColor * dash;
	gl_FragColor.a *= alpha * opacity * dash;
}
