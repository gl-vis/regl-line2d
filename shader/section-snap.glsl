precision highp float;

// turn, or 2 * pi
const float TAU = 6.283185307179586;

// snap tangent to angle section
vec2 snap(vec2 tangent, float sections) {
	float angle = atan(tangent.y, tangent.x);
	float step = TAU / sections;

	angle = floor(angle / step) * step;

	// shift section by half
	angle += TAU * .5 / sections;

	if (angle > TAU) angle -= TAU;
	if (angle < 0.) angle += TAU;


	return vec2(cos(angle), sin(angle));
}

#pragma glslify: export(snap)
