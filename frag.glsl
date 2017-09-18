precision highp float;

uniform sampler2D dashPattern;
uniform float dashLength, pixelRatio, thickness;

varying vec4 fragColor;
varying float fragLength;
varying vec2 tangent;
varying vec4 startCutoff, endCutoff;
varying vec2 startCoord, endCoord;

float distToLine(vec2 p, vec2 a, vec2 b) {
	vec2 diff = b - a;
	vec2 perp = normalize(vec2(-diff.y, diff.x));
	return dot(p - a, perp);
}

void main() {
	float alpha = 1., distToStart, distToEnd;

	//bevel miter
	distToStart = distToLine(gl_FragCoord.xy, startCutoff.xy, startCutoff.zw);
	if (distToStart < 0.) {
		discard;
		return;
	}

	distToEnd = distToLine(gl_FragCoord.xy, endCutoff.xy, endCutoff.zw);
	if (distToEnd < 0.) {
		discard;
		return;
	}

	alpha *= min(max(distToStart, 0.), 1.);
	alpha *= min(max(distToEnd, 0.), 1.);

	// round miter
	// distToStart = distToLine(gl_FragCoord.xy, startCutoff.xy, startCutoff.zw);
	// if (distToStart < 0.) {
	// 	float radius = length(gl_FragCoord.xy - startCoord);

	// 	if(radius > thickness * pixelRatio * .5) {
	// 		discard;
	// 		return;
	// 	}
	// }

	// distToEnd = distToLine(gl_FragCoord.xy, endCutoff.xy, endCutoff.zw);
	// if (distToEnd < 0.) {
	// 	float radius = length(gl_FragCoord.xy - endCoord);

	// 	if(radius > thickness * pixelRatio * .5) {
	// 		discard;
	// 		return;
	// 	}
	// }

	// alpha -= smoothstep(1.0 - delta, 1.0 + delta, radius);

	float t = fract(dot(tangent, gl_FragCoord.xy) / dashLength / pixelRatio) * .5 + .25;

	gl_FragColor = fragColor;
	gl_FragColor.a *= alpha * texture2D(dashPattern, vec2(t, 0.)).r;
}
