precision highp float;

uniform sampler2D dashPattern;
uniform float dashLength;

varying vec4 fragColor;
varying vec2 tangent;

void main() {
	float alpha = 1.;

	float t = fract(dot(tangent, gl_FragCoord.xy) / dashLength) * .5 + .25;

	gl_FragColor = fragColor;
	gl_FragColor.a *= texture2D(dashPattern, vec2(t, 0.)).r;
}
