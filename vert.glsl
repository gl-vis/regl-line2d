precision highp float;

attribute vec2 aCoord, bCoord, nextCoord, prevCoord;
attribute vec4 aColor, bColor;
attribute float lineEnd, lineTop;

uniform vec2 scale, translate;
uniform float thickness, pixelRatio;
uniform vec4 viewport;
uniform float miterLimit, dashLength;

varying vec4 fragColor;
varying vec4 startCutoff, endCutoff;
varying vec2 tangent;
varying vec2 startCoord, endCoord;
varying float startMiter, endMiter;

const float REVERSE_MITER = -1e-5;

float distToLine(vec2 p, vec2 a, vec2 b) {
	vec2 diff = b - a;
	vec2 perp = normalize(vec2(-diff.y, diff.x));
	return dot(p - a, perp);
}

void main() {
	vec2 aCoord = aCoord, bCoord = bCoord, prevCoord = prevCoord, nextCoord = nextCoord;
	vec2 scaleRatio = scale * viewport.zw;

	float lineStart = 1. - lineEnd;
	float lineBot = 1. - lineTop;

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

	vec2 normalWidth = thickness / scaleRatio;

	vec2 aBotCoord = aCoord + normalWidth * startBotJoin;
	vec2 aTopCoord = aCoord + normalWidth * startTopJoin;
	vec2 bBotCoord = bCoord + normalWidth * endBotJoin;
	vec2 bTopCoord = bCoord + normalWidth * endTopJoin;

	//miter crease anti-clipping
	float abClipping = distToLine(aCoord, bCoord, bTopCoord) / dot(normalize(normalWidth * startBotJoin), normalize(normalWidth.yx * vec2(-endBotJoin.y, endBotJoin.x)));
	float baClipping = distToLine(bCoord, aCoord, aBotCoord) / dot(normalize(normalWidth * endBotJoin), normalize(normalWidth.yx * vec2(-startBotJoin.y, startBotJoin.x)));
	if (abClipping > 0. && abClipping < length(normalWidth * startBotJoin)) {
		aBotCoord -= normalWidth * startBotJoin;
		aBotCoord += normalize(startBotJoin * normalWidth) * abClipping;
	}
	if (baClipping > 0. && baClipping < length(normalWidth * endBotJoin)) {
		bTopCoord -= normalWidth * endTopJoin;
		bTopCoord += normalize(endTopJoin * normalWidth) * baClipping;
	}

	vec2 aPosition = (aCoord + translate) * scale;
	vec2 aTopPosition = (aTopCoord + translate) * scale;
	vec2 aBotPosition = (aBotCoord + translate) * scale;

	vec2 bPosition = (bCoord + translate) * scale;
	vec2 bTopPosition = (bTopCoord + translate) * scale;
	vec2 bBotPosition = (bBotCoord + translate) * scale;

	//position is normalized 0..1 coord on the screen
	vec2 position = (aTopPosition * lineTop + aBotPosition * lineBot) * lineStart + (bTopPosition * lineTop + bBotPosition * lineBot) * lineEnd;

	gl_Position = vec4(position  * 2.0 - 1.0, 0, 1);


	vec4 miterWidth = vec4(startJoinNormal, endJoinNormal) * thickness * miterLimit * .5;

	//provides bevel miter cutoffs
	startMiter = 0.;
	if (dot(currTangent, prevTangent) < .5) {
		startMiter = 1.;
		startCutoff = vec4(aCoord, aCoord);
		startCutoff.zw += (prevCoord == aCoord ? startBotJoin : vec2(-startJoin.y, startJoin.x)) / scaleRatio;
		startCutoff = (startCutoff + translate.xyxy) * scaleRatio.xyxy;
		startCutoff += viewport.xyxy;
		startCutoff += miterWidth.xyxy;
	}

	endMiter = 0.;
	if (dot(currTangent, nextTangent) < .5) {
		endMiter = 1.;
		endCutoff = vec4(bCoord, bCoord);
		endCutoff.zw += (nextCoord == bCoord ? endTopJoin :  vec2(-endJoinNormal.y, endJoinNormal.x))  / scaleRatio;
		endCutoff = (endCutoff + translate.xyxy) * scaleRatio.xyxy;
		endCutoff += viewport.xyxy;
		endCutoff += miterWidth.zwzw;
	}

	startCoord = (aCoord + translate) * scaleRatio + viewport.xy;
	endCoord = (bCoord + translate) * scaleRatio + viewport.xy;

	tangent = currTangent;

	fragColor = (lineEnd * bColor + lineStart * aColor) / 255.;
}
