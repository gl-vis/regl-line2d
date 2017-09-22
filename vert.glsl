precision highp float;

attribute vec2 aCoord, bCoord, nextCoord, prevCoord;
attribute vec4 aColor, bColor;
attribute float lineEnd, lineTop;

uniform vec2 scale, translate;
uniform float thickness, pixelRatio, id;
uniform vec4 viewport;
uniform float miterLimit, dashLength;

varying vec4 fragColor;
varying vec4 startCutoff, endCutoff;
varying vec2 tangent;
varying vec2 startCoord, endCoord;
varying float startMiter, endMiter;

const float REVERSE_MITER = -1e-5;
const float MAX_LINES = 256.;

float distToLine(vec2 p, vec2 a, vec2 b) {
	vec2 diff = b - a;
	vec2 perp = normalize(vec2(-diff.y, diff.x));
	return dot(p - a, perp);
}

void main() {
	vec2 aCoord = aCoord, bCoord = bCoord, prevCoord = prevCoord, nextCoord = nextCoord;
	vec2 scaleRatio = scale * viewport.zw;
	vec2 normalWidth = thickness / scaleRatio;

	float lineStart = 1. - lineEnd;
	float lineBot = 1. - lineTop;
	float depth = (MAX_LINES - 1. - id) / (MAX_LINES);

	fragColor = (lineEnd * bColor + lineStart * aColor) / 255.;

	vec2 prevDiff = aCoord - prevCoord;
	vec2 currDiff = bCoord - aCoord;
	vec2 nextDiff = nextCoord - bCoord;

	vec2 prevDirection = normalize(prevDiff);
	vec2 currDirection = normalize(currDiff);
	vec2 nextDirection = normalize(nextDiff);

	if (dot(currDirection, nextDirection) == -1.) {
		nextCoord = bCoord;
		nextDiff = nextCoord - bCoord;
	}
	if (dot(currDirection, prevDirection) == -1.) {
		if (length(currDiff) <= length(prevDiff)) {
			return;
		}
		aCoord = prevCoord;
		currDiff = bCoord - aCoord;
	}

	vec2 prevTangent = normalize(prevDiff * scaleRatio);
	vec2 currTangent = normalize(currDiff * scaleRatio);
	vec2 nextTangent = normalize(nextDiff * scaleRatio);

	vec2 prevNormal = vec2(-prevTangent.y, prevTangent.x);
	vec2 currNormal = vec2(-currTangent.y, currTangent.x);
	vec2 nextNormal = vec2(-nextTangent.y, nextTangent.x);

	vec2 startJoinNormal = normalize(prevTangent - currTangent);
	vec2 endJoinNormal = normalize(currTangent - nextTangent);

	//collapsed/unidirectional segment cases
	if (prevDirection == currDirection) {
		startJoinNormal = currNormal;
	}
	if (nextDirection == currDirection) {
		endJoinNormal = currNormal;
	}
	if (prevCoord == aCoord) {
		startJoinNormal = currNormal;
		prevTangent = currTangent;
		prevNormal = currNormal;
	}
	if (aCoord == bCoord) {
		endJoinNormal = startJoinNormal;
		currNormal = prevNormal;
		currTangent = prevTangent;
	}
	if (bCoord == nextCoord) {
		endJoinNormal = currNormal;
		nextTangent = currTangent;
		nextNormal = currNormal;
	}

	tangent = currTangent;

	//calculate join shifts relative to normals
	float startJoinShift = dot(currNormal, startJoinNormal);
	float endJoinShift = dot(currNormal, endJoinNormal);

	float startMiterRatio = abs(1. / startJoinShift);
	float endMiterRatio = abs(1. / endJoinShift);

	vec2 startJoin = startJoinNormal * startMiterRatio;
	vec2 endJoin = endJoinNormal * endMiterRatio;

	vec2 startTopJoin, startBotJoin, endTopJoin, endBotJoin;
	startTopJoin = sign(startJoinShift) * startJoin * .5;
	startBotJoin = -startTopJoin;

	endTopJoin = sign(endJoinShift) * endJoin * .5;
	endBotJoin = -endTopJoin;

	vec4 startMiterWidth = vec4(startJoinNormal, endJoinNormal) * thickness * miterLimit * .5;
	vec4 endMiterWidth = startMiterWidth;

	vec2 aTopCoord = aCoord + normalWidth * startTopJoin;
	vec2 bTopCoord = bCoord + normalWidth * endTopJoin;
	vec2 aBotCoord = aCoord + normalWidth * startBotJoin;
	vec2 bBotCoord = bCoord + normalWidth * endBotJoin;

	//miter anti-clipping
	float baClipping = distToLine(bCoord, aCoord, aBotCoord) / dot(normalize(normalWidth * endBotJoin), normalize(normalWidth.yx * vec2(-startBotJoin.y, startBotJoin.x)));
	float abClipping = distToLine(aCoord, bCoord, bTopCoord) / dot(normalize(normalWidth * startBotJoin), normalize(normalWidth.yx * vec2(-endBotJoin.y, endBotJoin.x)));

	//prevent close to reverse direction switch
	bool prevReverse = dot(currTangent, prevTangent) <= -.875 && abs(dot(currTangent, prevNormal)) * min(length(prevDiff), length(currDiff)) <  length(normalWidth * currNormal);
	bool nextReverse = dot(currTangent, nextTangent) <= -.875
		&& abs(dot(currTangent, nextNormal)) * min(length(nextDiff), length(currDiff)) <  length(normalWidth * currNormal);

	if (prevReverse) {
		//make join rectangular
		aBotCoord = aCoord - normalWidth * currNormal * .5;
		aTopCoord = aCoord + normalWidth * currNormal * .5;
	}
	else if (!nextReverse && baClipping > 0. && baClipping < length(normalWidth * endBotJoin)) {
		//miter anti-clipping
		bTopCoord -= normalWidth * endTopJoin;
		bTopCoord += normalize(endTopJoin * normalWidth) * baClipping;
	}

	if (nextReverse) {
		//make join rectangular
		//TODO: append miterWidth to coord offset here
		bBotCoord = bCoord - normalWidth * currNormal * .5;
		bTopCoord = bCoord + normalWidth * currNormal * .5;
	}
	else if (!prevReverse && abClipping > 0. && abClipping < length(normalWidth * startBotJoin)) {
		//miter anti-clipping
		aBotCoord -= normalWidth * startBotJoin;
		aBotCoord += normalize(startBotJoin * normalWidth) * abClipping;
	}

	vec2 aPosition = (aCoord + translate) * scale;
	vec2 aTopPosition = (aTopCoord + translate) * scale;
	vec2 aBotPosition = (aBotCoord + translate) * scale;

	vec2 bPosition = (bCoord + translate) * scale;
	vec2 bTopPosition = (bTopCoord + translate) * scale;
	vec2 bBotPosition = (bBotCoord + translate) * scale;

	//position is normalized 0..1 coord on the screen
	vec2 position = (aTopPosition * lineTop + aBotPosition * lineBot) * lineStart + (bTopPosition * lineTop + bBotPosition * lineBot) * lineEnd;

	//bevel miter cutoffs
	startMiter = 0.;
	if (dot(currTangent, prevTangent) < .5) {
		startMiter = 1.;
		startCutoff = vec4(aCoord, aCoord);
		startCutoff.zw += (prevCoord == aCoord ? startBotJoin : vec2(-startJoin.y, startJoin.x)) / scaleRatio;
		startCutoff = (startCutoff + translate.xyxy) * scaleRatio.xyxy;
		startCutoff += viewport.xyxy;
		startCutoff += startMiterWidth.xyxy;
	}

	endMiter = 0.;
	if (dot(currTangent, nextTangent) < .5) {
		endMiter = 1.;
		endCutoff = vec4(bCoord, bCoord);
		endCutoff.zw += (nextCoord == bCoord ? endTopJoin :  vec2(-endJoinNormal.y, endJoinNormal.x))  / scaleRatio;
		endCutoff = (endCutoff + translate.xyxy) * scaleRatio.xyxy;
		endCutoff += viewport.xyxy;
		endCutoff += endMiterWidth.zwzw;
	}

	startCoord = (aCoord + translate) * scaleRatio + viewport.xy;
	endCoord = (bCoord + translate) * scaleRatio + viewport.xy;

	gl_Position = vec4(position  * 2.0 - 1.0, depth, 1);
}
