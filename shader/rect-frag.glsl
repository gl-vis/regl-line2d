#pragma glslify: snapToSection = require('./section-snap.glsl')

precision highp float;

uniform sampler2D dashPattern;

uniform float dashSize, pixelRatio, thickness, opacity, id, sections;

varying vec4 fragColor;
varying vec2 tangent;


void main() {
	float alpha = 1.;

	vec2 tangent = snapToSection(tangent, sections);

	float t = fract(dot(tangent, gl_FragCoord.xy) / dashSize) * .5 + .25;

	float dash = texture2D(dashPattern, vec2(t, .5)).r;

	gl_FragColor = fragColor;
	gl_FragColor.a *= alpha * opacity * dash;
}
