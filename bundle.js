'use strict';

function _toConsumableArray(arr) {
  return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
}
function _arrayWithoutHoles(arr) {
  if (Array.isArray(arr)) return _arrayLikeToArray(arr);
}
function _iterableToArray(iter) {
  if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
}
function _unsupportedIterableToArray(o, minLen) {
  if (!o) return;
  if (typeof o === "string") return _arrayLikeToArray(o, minLen);
  var n = Object.prototype.toString.call(o).slice(8, -1);
  if (n === "Object" && o.constructor) n = o.constructor.name;
  if (n === "Map" || n === "Set") return Array.from(o);
  if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
}
function _arrayLikeToArray(arr, len) {
  if (len == null || len > arr.length) len = arr.length;
  for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
  return arr2;
}
function _nonIterableSpread() {
  throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}

module.exports = earcut;
module.exports["default"] = earcut;
function earcut(data, holeIndices, dim) {
  dim = dim || 2;
  var hasHoles = holeIndices && holeIndices.length,
    outerLen = hasHoles ? holeIndices[0] * dim : data.length,
    outerNode = linkedList(data, 0, outerLen, dim, true),
    triangles = [];
  if (!outerNode || outerNode.next === outerNode.prev) return triangles;
  var minX, minY, maxX, maxY, x, y, invSize;
  if (hasHoles) outerNode = eliminateHoles(data, holeIndices, outerNode, dim);

  // if the shape is not too simple, we'll use z-order curve hash later; calculate polygon bbox
  if (data.length > 80 * dim) {
    minX = maxX = data[0];
    minY = maxY = data[1];
    for (var i = dim; i < outerLen; i += dim) {
      x = data[i];
      y = data[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    // minX, minY and invSize are later used to transform coords into integers for z-order calculation
    invSize = Math.max(maxX - minX, maxY - minY);
    invSize = invSize !== 0 ? 32767 / invSize : 0;
  }
  earcutLinked(outerNode, triangles, dim, minX, minY, invSize, 0);
  return triangles;
}

// create a circular doubly linked list from polygon points in the specified winding order
function linkedList(data, start, end, dim, clockwise) {
  var i, last;
  if (clockwise === signedArea(data, start, end, dim) > 0) {
    for (i = start; i < end; i += dim) last = insertNode(i, data[i], data[i + 1], last);
  } else {
    for (i = end - dim; i >= start; i -= dim) last = insertNode(i, data[i], data[i + 1], last);
  }
  if (last && equals(last, last.next)) {
    removeNode(last);
    last = last.next;
  }
  return last;
}

// eliminate colinear or duplicate points
function filterPoints(start, end) {
  if (!start) return start;
  if (!end) end = start;
  var p = start,
    again;
  do {
    again = false;
    if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
      removeNode(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else {
      p = p.next;
    }
  } while (again || p !== end);
  return end;
}

// main ear slicing loop which triangulates a polygon (given as a linked list)
function earcutLinked(ear, triangles, dim, minX, minY, invSize, pass) {
  if (!ear) return;

  // interlink polygon nodes in z-order
  if (!pass && invSize) indexCurve(ear, minX, minY, invSize);
  var stop = ear,
    prev,
    next;

  // iterate through ears, slicing them one by one
  while (ear.prev !== ear.next) {
    prev = ear.prev;
    next = ear.next;
    if (invSize ? isEarHashed(ear, minX, minY, invSize) : isEar(ear)) {
      // cut off the triangle
      triangles.push(prev.i / dim | 0);
      triangles.push(ear.i / dim | 0);
      triangles.push(next.i / dim | 0);
      removeNode(ear);

      // skipping the next vertex leads to less sliver triangles
      ear = next.next;
      stop = next.next;
      continue;
    }
    ear = next;

    // if we looped through the whole remaining polygon and can't find any more ears
    if (ear === stop) {
      // try filtering points and slicing again
      if (!pass) {
        earcutLinked(filterPoints(ear), triangles, dim, minX, minY, invSize, 1);

        // if this didn't work, try curing all small self-intersections locally
      } else if (pass === 1) {
        ear = cureLocalIntersections(filterPoints(ear), triangles, dim);
        earcutLinked(ear, triangles, dim, minX, minY, invSize, 2);

        // as a last resort, try splitting the remaining polygon into two
      } else if (pass === 2) {
        splitEarcut(ear, triangles, dim, minX, minY, invSize);
      }
      break;
    }
  }
}

// check whether a polygon node forms a valid ear with adjacent nodes
function isEar(ear) {
  var a = ear.prev,
    b = ear,
    c = ear.next;
  if (area(a, b, c) >= 0) return false; // reflex, can't be an ear

  // now make sure we don't have other points inside the potential ear
  var ax = a.x,
    bx = b.x,
    cx = c.x,
    ay = a.y,
    by = b.y,
    cy = c.y;

  // triangle bbox; min & max are calculated like this for speed
  var x0 = ax < bx ? ax < cx ? ax : cx : bx < cx ? bx : cx,
    y0 = ay < by ? ay < cy ? ay : cy : by < cy ? by : cy,
    x1 = ax > bx ? ax > cx ? ax : cx : bx > cx ? bx : cx,
    y1 = ay > by ? ay > cy ? ay : cy : by > cy ? by : cy;
  var p = c.next;
  while (p !== a) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.next;
  }
  return true;
}
function isEarHashed(ear, minX, minY, invSize) {
  var a = ear.prev,
    b = ear,
    c = ear.next;
  if (area(a, b, c) >= 0) return false; // reflex, can't be an ear

  var ax = a.x,
    bx = b.x,
    cx = c.x,
    ay = a.y,
    by = b.y,
    cy = c.y;

  // triangle bbox; min & max are calculated like this for speed
  var x0 = ax < bx ? ax < cx ? ax : cx : bx < cx ? bx : cx,
    y0 = ay < by ? ay < cy ? ay : cy : by < cy ? by : cy,
    x1 = ax > bx ? ax > cx ? ax : cx : bx > cx ? bx : cx,
    y1 = ay > by ? ay > cy ? ay : cy : by > cy ? by : cy;

  // z-order range for the current triangle bbox;
  var minZ = zOrder(x0, y0, minX, minY, invSize),
    maxZ = zOrder(x1, y1, minX, minY, invSize);
  var p = ear.prevZ,
    n = ear.nextZ;

  // look for points inside the triangle in both directions
  while (p && p.z >= minZ && n && n.z <= maxZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c && pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }

  // look for remaining points in decreasing z-order
  while (p && p.z >= minZ) {
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p !== a && p !== c && pointInTriangle(ax, ay, bx, by, cx, cy, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
    p = p.prevZ;
  }

  // look for remaining points in increasing z-order
  while (n && n.z <= maxZ) {
    if (n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1 && n !== a && n !== c && pointInTriangle(ax, ay, bx, by, cx, cy, n.x, n.y) && area(n.prev, n, n.next) >= 0) return false;
    n = n.nextZ;
  }
  return true;
}

// go through all polygon nodes and cure small local self-intersections
function cureLocalIntersections(start, triangles, dim) {
  var p = start;
  do {
    var a = p.prev,
      b = p.next.next;
    if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
      triangles.push(a.i / dim | 0);
      triangles.push(p.i / dim | 0);
      triangles.push(b.i / dim | 0);

      // remove two nodes involved
      removeNode(p);
      removeNode(p.next);
      p = start = b;
    }
    p = p.next;
  } while (p !== start);
  return filterPoints(p);
}

// try splitting polygon into two and triangulate them independently
function splitEarcut(start, triangles, dim, minX, minY, invSize) {
  // look for a valid diagonal that divides the polygon into two
  var a = start;
  do {
    var b = a.next.next;
    while (b !== a.prev) {
      if (a.i !== b.i && isValidDiagonal(a, b)) {
        // split the polygon in two by the diagonal
        var c = splitPolygon(a, b);

        // filter colinear points around the cuts
        a = filterPoints(a, a.next);
        c = filterPoints(c, c.next);

        // run earcut on each half
        earcutLinked(a, triangles, dim, minX, minY, invSize, 0);
        earcutLinked(c, triangles, dim, minX, minY, invSize, 0);
        return;
      }
      b = b.next;
    }
    a = a.next;
  } while (a !== start);
}

// link every hole into the outer loop, producing a single-ring polygon without holes
function eliminateHoles(data, holeIndices, outerNode, dim) {
  var queue = [],
    i,
    len,
    start,
    end,
    list;
  for (i = 0, len = holeIndices.length; i < len; i++) {
    start = holeIndices[i] * dim;
    end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
    list = linkedList(data, start, end, dim, false);
    if (list === list.next) list.steiner = true;
    queue.push(getLeftmost(list));
  }
  queue.sort(compareX);

  // process holes from left to right
  for (i = 0; i < queue.length; i++) {
    outerNode = eliminateHole(queue[i], outerNode);
  }
  return outerNode;
}
function compareX(a, b) {
  return a.x - b.x;
}

// find a bridge between vertices that connects hole with an outer ring and and link it
function eliminateHole(hole, outerNode) {
  var bridge = findHoleBridge(hole, outerNode);
  if (!bridge) {
    return outerNode;
  }
  var bridgeReverse = splitPolygon(bridge, hole);

  // filter collinear points around the cuts
  filterPoints(bridgeReverse, bridgeReverse.next);
  return filterPoints(bridge, bridge.next);
}

// David Eberly's algorithm for finding a bridge between hole and outer polygon
function findHoleBridge(hole, outerNode) {
  var p = outerNode,
    hx = hole.x,
    hy = hole.y,
    qx = -Infinity,
    m;

  // find a segment intersected by a ray from the hole's leftmost point to the left;
  // segment's endpoint with lesser x will be potential connection point
  do {
    if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
      var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
      if (x <= hx && x > qx) {
        qx = x;
        m = p.x < p.next.x ? p : p.next;
        if (x === hx) return m; // hole touches outer segment; pick leftmost endpoint
      }
    }
    p = p.next;
  } while (p !== outerNode);
  if (!m) return null;

  // look for points inside the triangle of hole point, segment intersection and endpoint;
  // if there are no points found, we have a valid connection;
  // otherwise choose the point of the minimum angle with the ray as connection point

  var stop = m,
    mx = m.x,
    my = m.y,
    tanMin = Infinity,
    tan;
  p = m;
  do {
    if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
      tan = Math.abs(hy - p.y) / (hx - p.x); // tangential

      if (locallyInside(p, hole) && (tan < tanMin || tan === tanMin && (p.x > m.x || p.x === m.x && sectorContainsSector(m, p)))) {
        m = p;
        tanMin = tan;
      }
    }
    p = p.next;
  } while (p !== stop);
  return m;
}

// whether sector in vertex m contains sector in vertex p in the same coordinates
function sectorContainsSector(m, p) {
  return area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0;
}

// interlink polygon nodes in z-order
function indexCurve(start, minX, minY, invSize) {
  var p = start;
  do {
    if (p.z === 0) p.z = zOrder(p.x, p.y, minX, minY, invSize);
    p.prevZ = p.prev;
    p.nextZ = p.next;
    p = p.next;
  } while (p !== start);
  p.prevZ.nextZ = null;
  p.prevZ = null;
  sortLinked(p);
}

// Simon Tatham's linked list merge sort algorithm
// http://www.chiark.greenend.org.uk/~sgtatham/algorithms/listsort.html
function sortLinked(list) {
  var i,
    p,
    q,
    e,
    tail,
    numMerges,
    pSize,
    qSize,
    inSize = 1;
  do {
    p = list;
    list = null;
    tail = null;
    numMerges = 0;
    while (p) {
      numMerges++;
      q = p;
      pSize = 0;
      for (i = 0; i < inSize; i++) {
        pSize++;
        q = q.nextZ;
        if (!q) break;
      }
      qSize = inSize;
      while (pSize > 0 || qSize > 0 && q) {
        if (pSize !== 0 && (qSize === 0 || !q || p.z <= q.z)) {
          e = p;
          p = p.nextZ;
          pSize--;
        } else {
          e = q;
          q = q.nextZ;
          qSize--;
        }
        if (tail) tail.nextZ = e;else list = e;
        e.prevZ = tail;
        tail = e;
      }
      p = q;
    }
    tail.nextZ = null;
    inSize *= 2;
  } while (numMerges > 1);
  return list;
}

// z-order of a point given coords and inverse of the longer side of data bbox
function zOrder(x, y, minX, minY, invSize) {
  // coords are transformed into non-negative 15-bit integer range
  x = (x - minX) * invSize | 0;
  y = (y - minY) * invSize | 0;
  x = (x | x << 8) & 0x00FF00FF;
  x = (x | x << 4) & 0x0F0F0F0F;
  x = (x | x << 2) & 0x33333333;
  x = (x | x << 1) & 0x55555555;
  y = (y | y << 8) & 0x00FF00FF;
  y = (y | y << 4) & 0x0F0F0F0F;
  y = (y | y << 2) & 0x33333333;
  y = (y | y << 1) & 0x55555555;
  return x | y << 1;
}

// find the leftmost node of a polygon ring
function getLeftmost(start) {
  var p = start,
    leftmost = start;
  do {
    if (p.x < leftmost.x || p.x === leftmost.x && p.y < leftmost.y) leftmost = p;
    p = p.next;
  } while (p !== start);
  return leftmost;
}

// check if a point lies within a convex triangle
function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
  return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
}

// check if a diagonal between two polygon nodes is valid (lies in polygon interior)
function isValidDiagonal(a, b) {
  return a.next.i !== b.i && a.prev.i !== b.i && !intersectsPolygon(a, b) && (
  // dones't intersect other edges
  locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) && (
  // locally visible
  area(a.prev, a, b.prev) || area(a, b.prev, b)) ||
  // does not create opposite-facing sectors
  equals(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0); // special zero-length case
}

// signed area of a triangle
function area(p, q, r) {
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
}

// check if two points are equal
function equals(p1, p2) {
  return p1.x === p2.x && p1.y === p2.y;
}

// check if two segments intersect
function intersects(p1, q1, p2, q2) {
  var o1 = sign(area(p1, q1, p2));
  var o2 = sign(area(p1, q1, q2));
  var o3 = sign(area(p2, q2, p1));
  var o4 = sign(area(p2, q2, q1));
  if (o1 !== o2 && o3 !== o4) return true; // general case

  if (o1 === 0 && onSegment(p1, p2, q1)) return true; // p1, q1 and p2 are collinear and p2 lies on p1q1
  if (o2 === 0 && onSegment(p1, q2, q1)) return true; // p1, q1 and q2 are collinear and q2 lies on p1q1
  if (o3 === 0 && onSegment(p2, p1, q2)) return true; // p2, q2 and p1 are collinear and p1 lies on p2q2
  if (o4 === 0 && onSegment(p2, q1, q2)) return true; // p2, q2 and q1 are collinear and q1 lies on p2q2

  return false;
}

// for collinear points p, q, r, check if point q lies on segment pr
function onSegment(p, q, r) {
  return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
}
function sign(num) {
  return num > 0 ? 1 : num < 0 ? -1 : 0;
}

// check if a polygon diagonal intersects any polygon segments
function intersectsPolygon(a, b) {
  var p = a;
  do {
    if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && intersects(p, p.next, a, b)) return true;
    p = p.next;
  } while (p !== a);
  return false;
}

// check if a polygon diagonal is locally inside the polygon
function locallyInside(a, b) {
  return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
}

// check if the middle point of a polygon diagonal is inside the polygon
function middleInside(a, b) {
  var p = a,
    inside = false,
    px = (a.x + b.x) / 2,
    py = (a.y + b.y) / 2;
  do {
    if (p.y > py !== p.next.y > py && p.next.y !== p.y && px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x) inside = !inside;
    p = p.next;
  } while (p !== a);
  return inside;
}

// link two polygon vertices with a bridge; if the vertices belong to the same ring, it splits polygon into two;
// if one belongs to the outer ring and another to a hole, it merges it into a single ring
function splitPolygon(a, b) {
  var a2 = new Node(a.i, a.x, a.y),
    b2 = new Node(b.i, b.x, b.y),
    an = a.next,
    bp = b.prev;
  a.next = b;
  b.prev = a;
  a2.next = an;
  an.prev = a2;
  b2.next = a2;
  a2.prev = b2;
  bp.next = b2;
  b2.prev = bp;
  return b2;
}

// create a node and optionally link it with previous one (in a circular doubly linked list)
function insertNode(i, x, y, last) {
  var p = new Node(i, x, y);
  if (!last) {
    p.prev = p;
    p.next = p;
  } else {
    p.next = last.next;
    p.prev = last;
    last.next.prev = p;
    last.next = p;
  }
  return p;
}
function removeNode(p) {
  p.next.prev = p.prev;
  p.prev.next = p.next;
  if (p.prevZ) p.prevZ.nextZ = p.nextZ;
  if (p.nextZ) p.nextZ.prevZ = p.prevZ;
}
function Node(i, x, y) {
  // vertex index in coordinates array
  this.i = i;

  // vertex coordinates
  this.x = x;
  this.y = y;

  // previous and next vertex nodes in a polygon ring
  this.prev = null;
  this.next = null;

  // z-order curve value
  this.z = 0;

  // previous and next nodes in z-order
  this.prevZ = null;
  this.nextZ = null;

  // indicates whether this is a steiner point
  this.steiner = false;
}

// return a percentage difference between the polygon area and its triangulation area;
// used to verify correctness of triangulation
earcut.deviation = function (data, holeIndices, dim, triangles) {
  var hasHoles = holeIndices && holeIndices.length;
  var outerLen = hasHoles ? holeIndices[0] * dim : data.length;
  var polygonArea = Math.abs(signedArea(data, 0, outerLen, dim));
  if (hasHoles) {
    for (var i = 0, len = holeIndices.length; i < len; i++) {
      var start = holeIndices[i] * dim;
      var end = i < len - 1 ? holeIndices[i + 1] * dim : data.length;
      polygonArea -= Math.abs(signedArea(data, start, end, dim));
    }
  }
  var trianglesArea = 0;
  for (i = 0; i < triangles.length; i += 3) {
    var a = triangles[i] * dim;
    var b = triangles[i + 1] * dim;
    var c = triangles[i + 2] * dim;
    trianglesArea += Math.abs((data[a] - data[c]) * (data[b + 1] - data[a + 1]) - (data[a] - data[b]) * (data[c + 1] - data[a + 1]));
  }
  return polygonArea === 0 && trianglesArea === 0 ? 0 : Math.abs((trianglesArea - polygonArea) / polygonArea);
};
function signedArea(data, start, end, dim) {
  var sum = 0;
  for (var i = start, j = end - dim; i < end; i += dim) {
    sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]);
    j = i;
  }
  return sum;
}

// turn a polygon in a multi-dimensional array form (e.g. as in GeoJSON) into a form Earcut accepts
earcut.flatten = function (data) {
  var dim = data[0][0].length,
    result = {
      vertices: [],
      holes: [],
      dimensions: dim
    },
    holeIndex = 0;
  for (var i = 0; i < data.length; i++) {
    for (var j = 0; j < data[i].length; j++) {
      for (var d = 0; d < dim; d++) result.vertices.push(data[i][j][d]);
    }
    if (i > 0) {
      holeIndex += data[i - 1].length;
      result.holes.push(holeIndex);
    }
  }
  return result;
};

var earcut$1 = /*#__PURE__*/Object.freeze({
  __proto__: null
});

var getBounds = require('array-bounds');
module.exports = normalize;
function normalize(arr, dim, bounds) {
  if (!arr || arr.length == null) throw Error('Argument should be an array');
  if (dim == null) dim = 1;
  if (bounds == null) bounds = getBounds(arr, dim);
  for (var offset = 0; offset < dim; offset++) {
    var max = bounds[dim + offset],
      min = bounds[offset],
      i = offset,
      l = arr.length;
    if (max === Infinity && min === -Infinity) {
      for (i = offset; i < l; i += dim) {
        arr[i] = arr[i] === max ? 1 : arr[i] === min ? 0 : .5;
      }
    } else if (max === Infinity) {
      for (i = offset; i < l; i += dim) {
        arr[i] = arr[i] === max ? 1 : 0;
      }
    } else if (min === -Infinity) {
      for (i = offset; i < l; i += dim) {
        arr[i] = arr[i] === min ? 0 : 1;
      }
    } else {
      var range = max - min;
      for (i = offset; i < l; i += dim) {
        if (!isNaN(arr[i])) {
          arr[i] = range === 0 ? .5 : (arr[i] - min) / range;
        }
      }
    }
  }
  return arr;
}

var arrayNormalize = /*#__PURE__*/Object.freeze({
  __proto__: null
});

module.exports = require("./is-implemented")() ? WeakMap : require("./polyfill");

var es6WeakMap = /*#__PURE__*/Object.freeze({
  __proto__: null
});

module.exports = function (arr, predicate, ctx) {
  if (typeof Array.prototype.findIndex === 'function') {
    return arr.findIndex(predicate, ctx);
  }
  if (typeof predicate !== 'function') {
    throw new TypeError('predicate must be a function');
  }
  var list = Object(arr);
  var len = list.length;
  if (len === 0) {
    return -1;
  }
  for (var i = 0; i < len; i++) {
    if (predicate.call(ctx, list[i], i, list)) {
      return i;
    }
  }
  return -1;
};

var arrayFindIndex = /*#__PURE__*/Object.freeze({
  __proto__: null
});

function getCjsExportFromNamespace (n) {
	return n && n['default'] || n;
}

var triangulate = getCjsExportFromNamespace(earcut$1);

var normalize$1 = getCjsExportFromNamespace(arrayNormalize);

var WeakMap$1 = getCjsExportFromNamespace(es6WeakMap);

var findIndex = getCjsExportFromNamespace(arrayFindIndex);

var rgba = require('color-normalize');
var getBounds$1 = require('array-bounds');
var extend = require('object-assign');
var glslify = require('glslify');
var pick = require('pick-by-alias');
var flatten = require('flatten-vertex-data');
var _require = require('to-float32'),
  float32 = _require.float32,
  fract32 = _require.fract32;
var parseRect = require('parse-rect');
var reglLine2d = Line2D;

/** @constructor */
function Line2D(regl, options) {
  if (!(this instanceof Line2D)) return new Line2D(regl, options);
  if (typeof regl === 'function') {
    if (!options) options = {};
    options.regl = regl;
  } else {
    options = regl;
  }
  if (options.length) options.positions = options;
  regl = options.regl;
  if (!regl.hasExtension('ANGLE_instanced_arrays')) {
    throw Error('regl-error2d: `ANGLE_instanced_arrays` extension should be enabled');
  }

  // persistent variables
  this.gl = regl._gl;
  this.regl = regl;

  // list of options for lines
  this.passes = [];

  // cached shaders instance
  this.shaders = Line2D.shaders.has(regl) ? Line2D.shaders.get(regl) : Line2D.shaders.set(regl, Line2D.createShaders(regl)).get(regl);

  // init defaults
  this.update(options);
}
Line2D.dashMult = 2;
Line2D.maxPatternLength = 256;
Line2D.precisionThreshold = 3e6;
Line2D.maxPoints = 1e4;
Line2D.maxLines = 2048;

// cache of created draw calls per-regl instance
Line2D.shaders = new WeakMap$1();

// create static shaders once
Line2D.createShaders = function (regl) {
  var offsetBuffer = regl.buffer({
    usage: 'static',
    type: 'float',
    data: [0, 1, 0, 0, 1, 1, 1, 0]
  });
  var shaderOptions = {
    primitive: 'triangle strip',
    instances: regl.prop('count'),
    count: 4,
    offset: 0,
    uniforms: {
      miterMode: function miterMode(ctx, prop) {
        return prop.join === 'round' ? 2 : 1;
      },
      miterLimit: regl.prop('miterLimit'),
      scale: regl.prop('scale'),
      scaleFract: regl.prop('scaleFract'),
      translateFract: regl.prop('translateFract'),
      translate: regl.prop('translate'),
      thickness: regl.prop('thickness'),
      dashTexture: regl.prop('dashTexture'),
      opacity: regl.prop('opacity'),
      pixelRatio: regl.context('pixelRatio'),
      id: regl.prop('id'),
      dashLength: regl.prop('dashLength'),
      viewport: function viewport(c, p) {
        return [p.viewport.x, p.viewport.y, c.viewportWidth, c.viewportHeight];
      },
      depth: regl.prop('depth')
    },
    blend: {
      enable: true,
      color: [0, 0, 0, 0],
      equation: {
        rgb: 'add',
        alpha: 'add'
      },
      func: {
        srcRGB: 'src alpha',
        dstRGB: 'one minus src alpha',
        srcAlpha: 'one minus dst alpha',
        dstAlpha: 'one'
      }
    },
    depth: {
      enable: function enable(c, p) {
        return !p.overlay;
      }
    },
    stencil: {
      enable: false
    },
    scissor: {
      enable: true,
      box: regl.prop('viewport')
    },
    viewport: regl.prop('viewport')
  };

  // simplified rectangular line shader
  var drawRectLine = regl(extend({
    vert: glslify(["precision highp float;\n#define GLSLIFY 1\n\nattribute vec2 aCoord, bCoord, aCoordFract, bCoordFract;\nattribute vec4 color;\nattribute float lineEnd, lineTop;\n\nuniform vec2 scale, scaleFract, translate, translateFract;\nuniform float thickness, pixelRatio, id, depth;\nuniform vec4 viewport;\n\nvarying vec4 fragColor;\nvarying vec2 tangent;\n\nvec2 project(vec2 position, vec2 positionFract, vec2 scale, vec2 scaleFract, vec2 translate, vec2 translateFract) {\n\t// the order is important\n\treturn position * scale + translate\n       + positionFract * scale + translateFract\n       + position * scaleFract\n       + positionFract * scaleFract;\n}\n\nvoid main() {\n\tfloat lineStart = 1. - lineEnd;\n\tfloat lineOffset = lineTop * 2. - 1.;\n\n\tvec2 diff = (bCoord + bCoordFract - aCoord - aCoordFract);\n\ttangent = normalize(diff * scale * viewport.zw);\n\tvec2 normal = vec2(-tangent.y, tangent.x);\n\n\tvec2 position = project(aCoord, aCoordFract, scale, scaleFract, translate, translateFract) * lineStart\n\t\t+ project(bCoord, bCoordFract, scale, scaleFract, translate, translateFract) * lineEnd\n\n\t\t+ thickness * normal * .5 * lineOffset / viewport.zw;\n\n\tgl_Position = vec4(position * 2.0 - 1.0, depth, 1);\n\n\tfragColor = color / 255.;\n}\n"]),
    frag: glslify(["precision highp float;\n#define GLSLIFY 1\n\nuniform float dashLength, pixelRatio, thickness, opacity, id;\nuniform sampler2D dashTexture;\n\nvarying vec4 fragColor;\nvarying vec2 tangent;\n\nvoid main() {\n\tfloat alpha = 1.;\n\n\tfloat t = fract(dot(tangent, gl_FragCoord.xy) / dashLength) * .5 + .25;\n\tfloat dash = texture2D(dashTexture, vec2(t, .5)).r;\n\n\tgl_FragColor = fragColor;\n\tgl_FragColor.a *= alpha * opacity * dash;\n}\n"]),
    attributes: {
      // if point is at the end of segment
      lineEnd: {
        buffer: offsetBuffer,
        divisor: 0,
        stride: 8,
        offset: 0
      },
      // if point is at the top of segment
      lineTop: {
        buffer: offsetBuffer,
        divisor: 0,
        stride: 8,
        offset: 4
      },
      // beginning of line coordinate
      aCoord: {
        buffer: regl.prop('positionBuffer'),
        stride: 8,
        offset: 8,
        divisor: 1
      },
      // end of line coordinate
      bCoord: {
        buffer: regl.prop('positionBuffer'),
        stride: 8,
        offset: 16,
        divisor: 1
      },
      aCoordFract: {
        buffer: regl.prop('positionFractBuffer'),
        stride: 8,
        offset: 8,
        divisor: 1
      },
      bCoordFract: {
        buffer: regl.prop('positionFractBuffer'),
        stride: 8,
        offset: 16,
        divisor: 1
      },
      color: {
        buffer: regl.prop('colorBuffer'),
        stride: 4,
        offset: 0,
        divisor: 1
      }
    }
  }, shaderOptions));

  // create regl draw
  var drawMiterLine;
  try {
    drawMiterLine = regl(extend({
      // culling removes polygon creasing
      cull: {
        enable: true,
        face: 'back'
      },
      vert: glslify(["precision highp float;\n#define GLSLIFY 1\n\nattribute vec2 aCoord, bCoord, nextCoord, prevCoord;\nattribute vec4 aColor, bColor;\nattribute float lineEnd, lineTop;\n\nuniform vec2 scale, translate;\nuniform float thickness, pixelRatio, id, depth;\nuniform vec4 viewport;\nuniform float miterLimit, miterMode;\n\nvarying vec4 fragColor;\nvarying vec4 startCutoff, endCutoff;\nvarying vec2 tangent;\nvarying vec2 startCoord, endCoord;\nvarying float enableStartMiter, enableEndMiter;\n\nconst float REVERSE_THRESHOLD = -.875;\nconst float MIN_DIFF = 1e-6;\n\n// TODO: possible optimizations: avoid overcalculating all for vertices and calc just one instead\n// TODO: precalculate dot products, normalize things beforehead etc.\n// TODO: refactor to rectangular algorithm\n\nfloat distToLine(vec2 p, vec2 a, vec2 b) {\n\tvec2 diff = b - a;\n\tvec2 perp = normalize(vec2(-diff.y, diff.x));\n\treturn dot(p - a, perp);\n}\n\nbool isNaN( float val ){\n  return ( val < 0.0 || 0.0 < val || val == 0.0 ) ? false : true;\n}\n\nvoid main() {\n\tvec2 aCoord = aCoord, bCoord = bCoord, prevCoord = prevCoord, nextCoord = nextCoord;\n\n  vec2 adjustedScale;\n  adjustedScale.x = (abs(scale.x) < MIN_DIFF) ? MIN_DIFF : scale.x;\n  adjustedScale.y = (abs(scale.y) < MIN_DIFF) ? MIN_DIFF : scale.y;\n\n  vec2 scaleRatio = adjustedScale * viewport.zw;\n\tvec2 normalWidth = thickness / scaleRatio;\n\n\tfloat lineStart = 1. - lineEnd;\n\tfloat lineBot = 1. - lineTop;\n\n\tfragColor = (lineStart * aColor + lineEnd * bColor) / 255.;\n\n\tif (isNaN(aCoord.x) || isNaN(aCoord.y) || isNaN(bCoord.x) || isNaN(bCoord.y)) return;\n\n\tif (aCoord == prevCoord) prevCoord = aCoord + normalize(bCoord - aCoord);\n\tif (bCoord == nextCoord) nextCoord = bCoord - normalize(bCoord - aCoord);\n\n\tvec2 prevDiff = aCoord - prevCoord;\n\tvec2 currDiff = bCoord - aCoord;\n\tvec2 nextDiff = nextCoord - bCoord;\n\n\tvec2 prevTangent = normalize(prevDiff * scaleRatio);\n\tvec2 currTangent = normalize(currDiff * scaleRatio);\n\tvec2 nextTangent = normalize(nextDiff * scaleRatio);\n\n\tvec2 prevNormal = vec2(-prevTangent.y, prevTangent.x);\n\tvec2 currNormal = vec2(-currTangent.y, currTangent.x);\n\tvec2 nextNormal = vec2(-nextTangent.y, nextTangent.x);\n\n\tvec2 startJoinDirection = normalize(prevTangent - currTangent);\n\tvec2 endJoinDirection = normalize(currTangent - nextTangent);\n\n\t// collapsed/unidirectional segment cases\n\t// FIXME: there should be more elegant solution\n\tvec2 prevTanDiff = abs(prevTangent - currTangent);\n\tvec2 nextTanDiff = abs(nextTangent - currTangent);\n\tif (max(prevTanDiff.x, prevTanDiff.y) < MIN_DIFF) {\n\t\tstartJoinDirection = currNormal;\n\t}\n\tif (max(nextTanDiff.x, nextTanDiff.y) < MIN_DIFF) {\n\t\tendJoinDirection = currNormal;\n\t}\n\tif (aCoord == bCoord) {\n\t\tendJoinDirection = startJoinDirection;\n\t\tcurrNormal = prevNormal;\n\t\tcurrTangent = prevTangent;\n\t}\n\n\ttangent = currTangent;\n\n\t//calculate join shifts relative to normals\n\tfloat startJoinShift = dot(currNormal, startJoinDirection);\n\tfloat endJoinShift = dot(currNormal, endJoinDirection);\n\n\tfloat startMiterRatio = abs(1. / startJoinShift);\n\tfloat endMiterRatio = abs(1. / endJoinShift);\n\n\tvec2 startJoin = startJoinDirection * startMiterRatio;\n\tvec2 endJoin = endJoinDirection * endMiterRatio;\n\n\tvec2 startTopJoin, startBotJoin, endTopJoin, endBotJoin;\n\tstartTopJoin = sign(startJoinShift) * startJoin * .5;\n\tstartBotJoin = -startTopJoin;\n\n\tendTopJoin = sign(endJoinShift) * endJoin * .5;\n\tendBotJoin = -endTopJoin;\n\n\tvec2 aTopCoord = aCoord + normalWidth * startTopJoin;\n\tvec2 bTopCoord = bCoord + normalWidth * endTopJoin;\n\tvec2 aBotCoord = aCoord + normalWidth * startBotJoin;\n\tvec2 bBotCoord = bCoord + normalWidth * endBotJoin;\n\n\t//miter anti-clipping\n\tfloat baClipping = distToLine(bCoord, aCoord, aBotCoord) / dot(normalize(normalWidth * endBotJoin), normalize(normalWidth.yx * vec2(-startBotJoin.y, startBotJoin.x)));\n\tfloat abClipping = distToLine(aCoord, bCoord, bTopCoord) / dot(normalize(normalWidth * startBotJoin), normalize(normalWidth.yx * vec2(-endBotJoin.y, endBotJoin.x)));\n\n\t//prevent close to reverse direction switch\n\tbool prevReverse = dot(currTangent, prevTangent) <= REVERSE_THRESHOLD && abs(dot(currTangent, prevNormal)) * min(length(prevDiff), length(currDiff)) <  length(normalWidth * currNormal);\n\tbool nextReverse = dot(currTangent, nextTangent) <= REVERSE_THRESHOLD && abs(dot(currTangent, nextNormal)) * min(length(nextDiff), length(currDiff)) <  length(normalWidth * currNormal);\n\n\tif (prevReverse) {\n\t\t//make join rectangular\n\t\tvec2 miterShift = normalWidth * startJoinDirection * miterLimit * .5;\n\t\tfloat normalAdjust = 1. - min(miterLimit / startMiterRatio, 1.);\n\t\taBotCoord = aCoord + miterShift - normalAdjust * normalWidth * currNormal * .5;\n\t\taTopCoord = aCoord + miterShift + normalAdjust * normalWidth * currNormal * .5;\n\t}\n\telse if (!nextReverse && baClipping > 0. && baClipping < length(normalWidth * endBotJoin)) {\n\t\t//handle miter clipping\n\t\tbTopCoord -= normalWidth * endTopJoin;\n\t\tbTopCoord += normalize(endTopJoin * normalWidth) * baClipping;\n\t}\n\n\tif (nextReverse) {\n\t\t//make join rectangular\n\t\tvec2 miterShift = normalWidth * endJoinDirection * miterLimit * .5;\n\t\tfloat normalAdjust = 1. - min(miterLimit / endMiterRatio, 1.);\n\t\tbBotCoord = bCoord + miterShift - normalAdjust * normalWidth * currNormal * .5;\n\t\tbTopCoord = bCoord + miterShift + normalAdjust * normalWidth * currNormal * .5;\n\t}\n\telse if (!prevReverse && abClipping > 0. && abClipping < length(normalWidth * startBotJoin)) {\n\t\t//handle miter clipping\n\t\taBotCoord -= normalWidth * startBotJoin;\n\t\taBotCoord += normalize(startBotJoin * normalWidth) * abClipping;\n\t}\n\n\tvec2 aTopPosition = (aTopCoord) * adjustedScale + translate;\n\tvec2 aBotPosition = (aBotCoord) * adjustedScale + translate;\n\n\tvec2 bTopPosition = (bTopCoord) * adjustedScale + translate;\n\tvec2 bBotPosition = (bBotCoord) * adjustedScale + translate;\n\n\t//position is normalized 0..1 coord on the screen\n\tvec2 position = (aTopPosition * lineTop + aBotPosition * lineBot) * lineStart + (bTopPosition * lineTop + bBotPosition * lineBot) * lineEnd;\n\n\tstartCoord = aCoord * scaleRatio + translate * viewport.zw + viewport.xy;\n\tendCoord = bCoord * scaleRatio + translate * viewport.zw + viewport.xy;\n\n\tgl_Position = vec4(position  * 2.0 - 1.0, depth, 1);\n\n\tenableStartMiter = step(dot(currTangent, prevTangent), .5);\n\tenableEndMiter = step(dot(currTangent, nextTangent), .5);\n\n\t//bevel miter cutoffs\n\tif (miterMode == 1.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tvec2 startMiterWidth = vec2(startJoinDirection) * thickness * miterLimit * .5;\n\t\t\tstartCutoff = vec4(aCoord, aCoord);\n\t\t\tstartCutoff.zw += vec2(-startJoinDirection.y, startJoinDirection.x) / scaleRatio;\n\t\t\tstartCutoff = startCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tstartCutoff += viewport.xyxy;\n\t\t\tstartCutoff += startMiterWidth.xyxy;\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tvec2 endMiterWidth = vec2(endJoinDirection) * thickness * miterLimit * .5;\n\t\t\tendCutoff = vec4(bCoord, bCoord);\n\t\t\tendCutoff.zw += vec2(-endJoinDirection.y, endJoinDirection.x)  / scaleRatio;\n\t\t\tendCutoff = endCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tendCutoff += viewport.xyxy;\n\t\t\tendCutoff += endMiterWidth.xyxy;\n\t\t}\n\t}\n\n\t//round miter cutoffs\n\telse if (miterMode == 2.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tvec2 startMiterWidth = vec2(startJoinDirection) * thickness * abs(dot(startJoinDirection, currNormal)) * .5;\n\t\t\tstartCutoff = vec4(aCoord, aCoord);\n\t\t\tstartCutoff.zw += vec2(-startJoinDirection.y, startJoinDirection.x) / scaleRatio;\n\t\t\tstartCutoff = startCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tstartCutoff += viewport.xyxy;\n\t\t\tstartCutoff += startMiterWidth.xyxy;\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tvec2 endMiterWidth = vec2(endJoinDirection) * thickness * abs(dot(endJoinDirection, currNormal)) * .5;\n\t\t\tendCutoff = vec4(bCoord, bCoord);\n\t\t\tendCutoff.zw += vec2(-endJoinDirection.y, endJoinDirection.x)  / scaleRatio;\n\t\t\tendCutoff = endCutoff * scaleRatio.xyxy + translate.xyxy * viewport.zwzw;\n\t\t\tendCutoff += viewport.xyxy;\n\t\t\tendCutoff += endMiterWidth.xyxy;\n\t\t}\n\t}\n}\n"]),
      frag: glslify(["precision highp float;\n#define GLSLIFY 1\n\nuniform float dashLength, pixelRatio, thickness, opacity, id, miterMode;\nuniform sampler2D dashTexture;\n\nvarying vec4 fragColor;\nvarying vec2 tangent;\nvarying vec4 startCutoff, endCutoff;\nvarying vec2 startCoord, endCoord;\nvarying float enableStartMiter, enableEndMiter;\n\nfloat distToLine(vec2 p, vec2 a, vec2 b) {\n\tvec2 diff = b - a;\n\tvec2 perp = normalize(vec2(-diff.y, diff.x));\n\treturn dot(p - a, perp);\n}\n\nvoid main() {\n\tfloat alpha = 1., distToStart, distToEnd;\n\tfloat cutoff = thickness * .5;\n\n\t//bevel miter\n\tif (miterMode == 1.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tdistToStart = distToLine(gl_FragCoord.xy, startCutoff.xy, startCutoff.zw);\n\t\t\tif (distToStart < -1.) {\n\t\t\t\tdiscard;\n\t\t\t\treturn;\n\t\t\t}\n\t\t\talpha *= min(max(distToStart + 1., 0.), 1.);\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tdistToEnd = distToLine(gl_FragCoord.xy, endCutoff.xy, endCutoff.zw);\n\t\t\tif (distToEnd < -1.) {\n\t\t\t\tdiscard;\n\t\t\t\treturn;\n\t\t\t}\n\t\t\talpha *= min(max(distToEnd + 1., 0.), 1.);\n\t\t}\n\t}\n\n\t// round miter\n\telse if (miterMode == 2.) {\n\t\tif (enableStartMiter == 1.) {\n\t\t\tdistToStart = distToLine(gl_FragCoord.xy, startCutoff.xy, startCutoff.zw);\n\t\t\tif (distToStart < 0.) {\n\t\t\t\tfloat radius = length(gl_FragCoord.xy - startCoord);\n\n\t\t\t\tif(radius > cutoff + .5) {\n\t\t\t\t\tdiscard;\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n\t\t\t\talpha -= smoothstep(cutoff - .5, cutoff + .5, radius);\n\t\t\t}\n\t\t}\n\n\t\tif (enableEndMiter == 1.) {\n\t\t\tdistToEnd = distToLine(gl_FragCoord.xy, endCutoff.xy, endCutoff.zw);\n\t\t\tif (distToEnd < 0.) {\n\t\t\t\tfloat radius = length(gl_FragCoord.xy - endCoord);\n\n\t\t\t\tif(radius > cutoff + .5) {\n\t\t\t\t\tdiscard;\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n\t\t\t\talpha -= smoothstep(cutoff - .5, cutoff + .5, radius);\n\t\t\t}\n\t\t}\n\t}\n\n\tfloat t = fract(dot(tangent, gl_FragCoord.xy) / dashLength) * .5 + .25;\n\tfloat dash = texture2D(dashTexture, vec2(t, .5)).r;\n\n\tgl_FragColor = fragColor;\n\tgl_FragColor.a *= alpha * opacity * dash;\n}\n"]),
      attributes: {
        // is line end
        lineEnd: {
          buffer: offsetBuffer,
          divisor: 0,
          stride: 8,
          offset: 0
        },
        // is line top
        lineTop: {
          buffer: offsetBuffer,
          divisor: 0,
          stride: 8,
          offset: 4
        },
        // left color
        aColor: {
          buffer: regl.prop('colorBuffer'),
          stride: 4,
          offset: 0,
          divisor: 1
        },
        // right color
        bColor: {
          buffer: regl.prop('colorBuffer'),
          stride: 4,
          offset: 4,
          divisor: 1
        },
        prevCoord: {
          buffer: regl.prop('positionBuffer'),
          stride: 8,
          offset: 0,
          divisor: 1
        },
        aCoord: {
          buffer: regl.prop('positionBuffer'),
          stride: 8,
          offset: 8,
          divisor: 1
        },
        bCoord: {
          buffer: regl.prop('positionBuffer'),
          stride: 8,
          offset: 16,
          divisor: 1
        },
        nextCoord: {
          buffer: regl.prop('positionBuffer'),
          stride: 8,
          offset: 24,
          divisor: 1
        }
      }
    }, shaderOptions));
  } catch (e) {
    // IE/bad Webkit fallback
    drawMiterLine = drawRectLine;
  }

  // fill shader
  var drawFill = regl({
    primitive: 'triangle',
    elements: function elements(ctx, prop) {
      return prop.triangles;
    },
    offset: 0,
    vert: glslify(["precision highp float;\n#define GLSLIFY 1\n\nattribute vec2 position, positionFract;\n\nuniform vec4 color;\nuniform vec2 scale, scaleFract, translate, translateFract;\nuniform float pixelRatio, id;\nuniform vec4 viewport;\nuniform float opacity;\n\nvarying vec4 fragColor;\n\nconst float MAX_LINES = 256.;\n\nvoid main() {\n\tfloat depth = (MAX_LINES - 4. - id) / (MAX_LINES);\n\n\tvec2 position = position * scale + translate\n       + positionFract * scale + translateFract\n       + position * scaleFract\n       + positionFract * scaleFract;\n\n\tgl_Position = vec4(position * 2.0 - 1.0, depth, 1);\n\n\tfragColor = color / 255.;\n\tfragColor.a *= opacity;\n}\n"]),
    frag: glslify(["precision highp float;\n#define GLSLIFY 1\n\nvarying vec4 fragColor;\n\nvoid main() {\n\tgl_FragColor = fragColor;\n}\n"]),
    uniforms: {
      scale: regl.prop('scale'),
      color: regl.prop('fill'),
      scaleFract: regl.prop('scaleFract'),
      translateFract: regl.prop('translateFract'),
      translate: regl.prop('translate'),
      opacity: regl.prop('opacity'),
      pixelRatio: regl.context('pixelRatio'),
      id: regl.prop('id'),
      viewport: function viewport(ctx, prop) {
        return [prop.viewport.x, prop.viewport.y, ctx.viewportWidth, ctx.viewportHeight];
      }
    },
    attributes: {
      position: {
        buffer: regl.prop('positionBuffer'),
        stride: 8,
        offset: 8
      },
      positionFract: {
        buffer: regl.prop('positionFractBuffer'),
        stride: 8,
        offset: 8
      }
    },
    blend: shaderOptions.blend,
    depth: {
      enable: false
    },
    scissor: shaderOptions.scissor,
    stencil: shaderOptions.stencil,
    viewport: shaderOptions.viewport
  });
  return {
    fill: drawFill,
    rect: drawRectLine,
    miter: drawMiterLine
  };
};

// used to for new lines instances
Line2D.defaults = {
  dashes: null,
  join: 'miter',
  miterLimit: 1,
  thickness: 10,
  cap: 'square',
  color: 'black',
  opacity: 1,
  overlay: false,
  viewport: null,
  range: null,
  close: false,
  fill: null
};
Line2D.prototype.render = function () {
  if (arguments.length) {
    this.update.apply(this, arguments);
  }
  this.draw();
};
Line2D.prototype.draw = function () {
  var _this = this;
  for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }
  // render multiple polylines via regl batch
  (args.length ? args : this.passes).forEach(function (s, i) {
    // render array pass as a list of passes
    if (s && Array.isArray(s)) return _this.draw.apply(_this, _toConsumableArray(s));
    if (typeof s === 'number') s = _this.passes[s];
    if (!(s && s.count > 1 && s.opacity)) return;
    _this.regl._refresh();
    if (s.fill && s.triangles && s.triangles.length > 2) {
      _this.shaders.fill(s);
    }
    if (!s.thickness) return;

    // high scale is only available for rect mode with precision
    if (s.scale[0] * s.viewport.width > Line2D.precisionThreshold || s.scale[1] * s.viewport.height > Line2D.precisionThreshold) {
      _this.shaders.rect(s);
    }

    // thin this.passes or too many points are rendered as simplified rect shader
    else if (s.join === 'rect' || !s.join && (s.thickness <= 2 || s.count >= Line2D.maxPoints)) {
      _this.shaders.rect(s);
    } else {
      _this.shaders.miter(s);
    }
  });
  return this;
};
Line2D.prototype.update = function (options) {
  var _this2 = this;
  if (!options) return;
  if (options.length != null) {
    if (typeof options[0] === 'number') options = [{
      positions: options
    }];
  }

  // make options a batch
  else if (!Array.isArray(options)) options = [options];
  var regl = this.regl,
    gl = this.gl;

  // process per-line settings
  options.forEach(function (o, i) {
    var state = _this2.passes[i];
    if (o === undefined) return;

    // null-argument removes pass
    if (o === null) {
      _this2.passes[i] = null;
      return;
    }
    if (typeof o[0] === 'number') o = {
      positions: o
    };

    // handle aliases
    o = pick(o, {
      positions: 'positions points data coords',
      thickness: 'thickness lineWidth lineWidths line-width linewidth width stroke-width strokewidth strokeWidth',
      join: 'lineJoin linejoin join type mode',
      miterLimit: 'miterlimit miterLimit',
      dashes: 'dash dashes dasharray dash-array dashArray',
      color: 'color colour stroke colors colours stroke-color strokeColor',
      fill: 'fill fill-color fillColor',
      opacity: 'alpha opacity',
      overlay: 'overlay crease overlap intersect',
      close: 'closed close closed-path closePath',
      range: 'range dataBox',
      viewport: 'viewport viewBox',
      hole: 'holes hole hollow',
      splitNull: 'splitNull'
    });

    // init state
    if (!state) {
      _this2.passes[i] = state = {
        id: i,
        scale: null,
        scaleFract: null,
        translate: null,
        translateFract: null,
        count: 0,
        hole: [],
        depth: 0,
        dashLength: 1,
        dashTexture: regl.texture({
          channels: 1,
          data: new Uint8Array([255]),
          width: 1,
          height: 1,
          mag: 'linear',
          min: 'linear'
        }),
        colorBuffer: regl.buffer({
          usage: 'dynamic',
          type: 'uint8',
          data: new Uint8Array()
        }),
        positionBuffer: regl.buffer({
          usage: 'dynamic',
          type: 'float',
          data: new Uint8Array()
        }),
        positionFractBuffer: regl.buffer({
          usage: 'dynamic',
          type: 'float',
          data: new Uint8Array()
        })
      };
      o = extend({}, Line2D.defaults, o);
    }
    if (o.thickness != null) state.thickness = parseFloat(o.thickness);
    if (o.opacity != null) state.opacity = parseFloat(o.opacity);
    if (o.miterLimit != null) state.miterLimit = parseFloat(o.miterLimit);
    if (o.overlay != null) {
      state.overlay = !!o.overlay;
      if (i < Line2D.maxLines) {
        state.depth = 2 * (Line2D.maxLines - 1 - i % Line2D.maxLines) / Line2D.maxLines - 1.;
      }
    }
    if (o.join != null) state.join = o.join;
    if (o.hole != null) state.hole = o.hole;
    if (o.fill != null) state.fill = !o.fill ? null : rgba(o.fill, 'uint8');
    if (o.viewport != null) state.viewport = parseRect(o.viewport);
    if (!state.viewport) {
      state.viewport = parseRect([gl.drawingBufferWidth, gl.drawingBufferHeight]);
    }
    if (o.close != null) state.close = o.close;

    // reset positions
    if (o.positions === null) o.positions = [];
    if (o.positions) {
      var positions, count;

      // if positions are an object with x/y
      if (o.positions.x && o.positions.y) {
        var xPos = o.positions.x;
        var yPos = o.positions.y;
        count = state.count = Math.max(xPos.length, yPos.length);
        positions = new Float64Array(count * 2);
        for (var _i = 0; _i < count; _i++) {
          positions[_i * 2] = xPos[_i];
          positions[_i * 2 + 1] = yPos[_i];
        }
      } else {
        positions = flatten(o.positions, 'float64');
        count = state.count = Math.floor(positions.length / 2);
      }
      var bounds = state.bounds = getBounds$1(positions, 2);

      // create fill positions
      // FIXME: fill positions can be set only along with positions
      if (state.fill) {
        var pos = [];

        // filter bad vertices and remap triangles to ensure shape
        var ids = {};
        var lastId = 0;
        for (var _i2 = 0, ptr = 0, l = state.count; _i2 < l; _i2++) {
          var x = positions[_i2 * 2];
          var y = positions[_i2 * 2 + 1];
          if (isNaN(x) || isNaN(y) || x == null || y == null) {
            x = positions[lastId * 2];
            y = positions[lastId * 2 + 1];
            ids[_i2] = lastId;
          } else {
            lastId = _i2;
          }
          pos[ptr++] = x;
          pos[ptr++] = y;
        }

        // split the input into multiple polygon at Null/NaN
        if (o.splitNull) {
          // use "ids" to track the boundary of segment
          // the keys in "ids" is the end boundary of a segment, or split point

          // make sure there is at least one segment
          if (!(state.count - 1 in ids)) ids[state.count] = state.count - 1;
          var splits = Object.keys(ids).map(Number).sort(function (a, b) {
            return a - b;
          });
          var split_triangles = [];
          var base = 0;

          // do not split holes
          var hole_base = state.hole != null ? state.hole[0] : null;
          if (hole_base != null) {
            var last_id = findIndex(splits, function (e) {
              return e >= hole_base;
            });
            splits = splits.slice(0, last_id);
            splits.push(hole_base);
          }
          var _loop = function _loop(_i3) {
            // create temporary pos array with only one segment and all the holes
            var seg_pos = pos.slice(base * 2, splits[_i3] * 2).concat(hole_base ? pos.slice(hole_base * 2) : []);
            var hole = (state.hole || []).map(function (e) {
              return e - hole_base + (splits[_i3] - base);
            });
            var triangles = triangulate(seg_pos, hole);
            // map triangle index back to the original pos buffer
            triangles = triangles.map(function (e) {
              return e + base + (e + base < splits[_i3] ? 0 : hole_base - splits[_i3]);
            });
            split_triangles.push.apply(split_triangles, _toConsumableArray(triangles));

            // skip split point
            base = splits[_i3] + 1;
          };
          for (var _i3 = 0; _i3 < splits.length; _i3++) {
            _loop(_i3);
          }
          for (var _i4 = 0, _l = split_triangles.length; _i4 < _l; _i4++) {
            if (ids[split_triangles[_i4]] != null) split_triangles[_i4] = ids[split_triangles[_i4]];
          }
          state.triangles = split_triangles;
        } else {
          // treat the wholw input as a single polygon
          var triangles = triangulate(pos, state.hole || []);
          for (var _i5 = 0, _l2 = triangles.length; _i5 < _l2; _i5++) {
            if (ids[triangles[_i5]] != null) triangles[_i5] = ids[triangles[_i5]];
          }
          state.triangles = triangles;
        }
      }

      // update position buffers
      var npos = new Float64Array(positions);
      normalize$1(npos, 2, bounds);
      var positionData = new Float64Array(count * 2 + 6);

      // rotate first segment join
      if (state.close) {
        if (positions[0] === positions[count * 2 - 2] && positions[1] === positions[count * 2 - 1]) {
          positionData[0] = npos[count * 2 - 4];
          positionData[1] = npos[count * 2 - 3];
        } else {
          positionData[0] = npos[count * 2 - 2];
          positionData[1] = npos[count * 2 - 1];
        }
      } else {
        positionData[0] = npos[0];
        positionData[1] = npos[1];
      }
      positionData.set(npos, 2);

      // add last segment
      if (state.close) {
        // ignore coinciding start/end
        if (positions[0] === positions[count * 2 - 2] && positions[1] === positions[count * 2 - 1]) {
          positionData[count * 2 + 2] = npos[2];
          positionData[count * 2 + 3] = npos[3];
          state.count -= 1;
        } else {
          positionData[count * 2 + 2] = npos[0];
          positionData[count * 2 + 3] = npos[1];
          positionData[count * 2 + 4] = npos[2];
          positionData[count * 2 + 5] = npos[3];
        }
      }
      // add stub
      else {
        positionData[count * 2 + 2] = npos[count * 2 - 2];
        positionData[count * 2 + 3] = npos[count * 2 - 1];
        positionData[count * 2 + 4] = npos[count * 2 - 2];
        positionData[count * 2 + 5] = npos[count * 2 - 1];
      }
      var float_data = float32(positionData);
      state.positionBuffer(float_data);
      var frac_data = fract32(positionData, float_data);
      state.positionFractBuffer(frac_data);
    }
    if (o.range) {
      state.range = o.range;
    } else if (!state.range) {
      state.range = state.bounds;
    }
    if ((o.range || o.positions) && state.count) {
      var _bounds = state.bounds;
      var boundsW = _bounds[2] - _bounds[0],
        boundsH = _bounds[3] - _bounds[1];
      var rangeW = state.range[2] - state.range[0],
        rangeH = state.range[3] - state.range[1];
      state.scale = [boundsW / rangeW, boundsH / rangeH];
      state.translate = [-state.range[0] / rangeW + _bounds[0] / rangeW || 0, -state.range[1] / rangeH + _bounds[1] / rangeH || 0];
      state.scaleFract = fract32(state.scale);
      state.translateFract = fract32(state.translate);
    }
    if (o.dashes) {
      var dashLength = 0.,
        dashData;
      if (!o.dashes || o.dashes.length < 2) {
        dashLength = 1.;
        dashData = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);
      } else {
        dashLength = 0.;
        for (var _i6 = 0; _i6 < o.dashes.length; ++_i6) {
          dashLength += o.dashes[_i6];
        }
        dashData = new Uint8Array(dashLength * Line2D.dashMult);
        var _ptr = 0;
        var fillColor = 255;

        // repeat texture two times to provide smooth 0-step
        for (var k = 0; k < 2; k++) {
          for (var _i7 = 0; _i7 < o.dashes.length; ++_i7) {
            for (var j = 0, _l3 = o.dashes[_i7] * Line2D.dashMult * .5; j < _l3; ++j) {
              dashData[_ptr++] = fillColor;
            }
            fillColor ^= 255;
          }
        }
      }
      state.dashLength = dashLength;
      state.dashTexture({
        channels: 1,
        data: dashData,
        width: dashData.length,
        height: 1,
        mag: 'linear',
        min: 'linear'
      }, 0, 0);
    }
    if (o.color) {
      var _count = state.count;
      var colors = o.color;
      if (!colors) colors = 'transparent';
      var colorData = new Uint8Array(_count * 4 + 4);

      // convert colors to typed arrays
      if (!Array.isArray(colors) || typeof colors[0] === 'number') {
        var c = rgba(colors, 'uint8');
        for (var _i8 = 0; _i8 < _count + 1; _i8++) {
          colorData.set(c, _i8 * 4);
        }
      } else {
        for (var _i9 = 0; _i9 < _count; _i9++) {
          var _c = rgba(colors[_i9], 'uint8');
          colorData.set(_c, _i9 * 4);
        }
        colorData.set(rgba(colors[0], 'uint8'), _count * 4);
      }
      state.colorBuffer({
        usage: 'dynamic',
        type: 'uint8',
        data: colorData
      });
    }
  });

  // remove unmentioned passes
  if (options.length < this.passes.length) {
    for (var i = options.length; i < this.passes.length; i++) {
      var pass = this.passes[i];
      if (!pass) continue;
      pass.colorBuffer.destroy();
      pass.positionBuffer.destroy();
      pass.dashTexture.destroy();
    }
    this.passes.length = options.length;
  }

  // remove null items
  var passes = [];
  for (var _i10 = 0; _i10 < this.passes.length; _i10++) {
    if (this.passes[_i10] !== null) passes.push(this.passes[_i10]);
  }
  this.passes = passes;
  return this;
};
Line2D.prototype.destroy = function () {
  this.passes.forEach(function (pass) {
    pass.colorBuffer.destroy();
    pass.positionBuffer.destroy();
    pass.dashTexture.destroy();
  });
  this.passes.length = 0;
  return this;
};

module.exports = reglLine2d;
