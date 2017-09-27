precision highp float;

uniform float opacity;

varying vec4 fragColor;

void main() {
	gl_FragColor = fragColor;
	gl_FragColor.a *= opacity;
}
