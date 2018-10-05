precision highp float;

// turn, or 2 * pi
const float TAU = 6.283185307179586;
const float PI = 3.141592653589793;

float round (float v) {
	return floor(v + .5);
}

// snap tangent to angle section
vec2 snap(vec2 tangent, float sections) {
	float angle = atan(tangent.y, tangent.x);

	float step = TAU / sections;

	angle = round(angle / step) * step;

	// exploit symmetrical pattern alignment
	angle = mod(angle, PI);

	return vec2(cos(angle), sin(angle));
}

#pragma glslify: export(snap)
