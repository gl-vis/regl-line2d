# regl-line2d [![experimental](https://img.shields.io/badge/stability-unstable-green.svg)](http://github.com/badges/stability-badges)

Draw polyline with regl.

![regl-line2d](https://github.com/dfcreative/regl-line2d/blob/master/preview.png?raw=true)

Remake on [gl-line2d](https://github.com/gl-vis/gl-line2d):

* GPU miter calculation
* Bevel, round and rectangular joins
* Correct transparent color handling in joins
* Optimized performance via instanced draws
* Multiple line rendering
* High point precision
* [`<polyline>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/polyline)-compatible API

[Demo](https://dfcreative.github.io/regl-line2d).

## Usage

[![npm install regl-line2d](https://nodei.co/npm/regl-line2d.png?mini=true)](https://npmjs.org/package/regl-line2d/)

```js
let drawLines = require('regl-line2d')(require('regl')())

drawLines({
  positions: data,
  color: 'rgba(0, 100, 200, .75)'
})
```

## API

### `drawLine = require('regl-line2d')(options|regl)`

Create a function drawing line for connected points.

Option | Default | Description
---|---|---
`regl` | `null` | Regl instance to reuse, otherwise new regl is created.
`gl`, `canvas`, `container`, `pixelRatio` | `null` | Options for `regl`, if new regl instance is created.

`drawLine` is invoked with the rest of options.

### `drawLine(points|options|list?)`

Draw line and optionally update options. If plain `points` array passed - it will just update the positions. `null` argument will destroy instance and dispose resources. To render multiple lines - pass an array with options for every lines.

Option | Alias | Default | Description
---|---|---|---
`positions` | `points`, `data` | `[]` | Array with sequence of coordinates for polyline, akin to sequence of `ctx.lineTo()` calls, eg. `[0,0, 1,1, 0,2, 1,-1]` or `[[0,0], [1,1], [0,2], [1,-1]]`.
`color` | `colors`, `stroke` | `black` | Color can be a css color string or an array with float `0..1` values.
`width` | `thickness`, `lineWidth`, `strokeWidth` | `1` | Line width or array with widths corresponding to polylines.
`dashes` | `dasharray` | `null` | Array with dash lengths, altering color/space pairs, ie. `[2,10, 5,10, ...]`. Dash length is defined in pixels. If `null`, solid line will be rendered.
`miterlimit` |  | `1` | The limit on the ratio of the miter length to the thickness.
`range` | `dataBox` | `null` | Limit visible data.
`viewport` | `viewBox` | `null` | Limit visible area within the canvas.
`join` | | `bevel` | Join style: `'rect'`, `'round'`, `'bevel'`.
`cap` | | `square` | Cap style for not closed path: `rect`, `round`.
`close` | `closed`, `closePath` | `false` | Connect last point with the first point with a segment.
`fill` | | `none` | Fills area enclosed by line.
`overlay` | | `false` | Enable overlay of line segments.

Processed options are exposed in `drawLine.state` object, along with `drawLine.draw`, `drawLine.update` and `drawLine.destroy` methods.

## Related

* [regl-scatter2d](https://github.com/dfcreative/regl-scatter2d)
* [regl-error2d](https://github.com/dfcreative/regl-error2d)

## See also

* [`<polyline>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/polyline) svg element.


## License

(c) 2017 Dima Yv. MIT License

Development supported by [plot.ly](https://github.com/plotly/).
