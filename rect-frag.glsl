precision highp float;

uniform float dashLength, pixelRatio, thickness, opacity, id;
uniform sampler2D dashTexture;

varying vec4 fragColor;
varying vec2 tangent;

void main() {
	float alpha = 1.;

	float t = fract(dot(tangent, gl_FragCoord.xy) / dashLength) * .5 + .25;
	float dash = texture2D(dashTexture, vec2(t, .5)).r;

	gl_FragColor = fragColor;
	gl_FragColor.a *= alpha * opacity * dash;
}
