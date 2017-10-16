# regl-line2d [![experimental](https://img.shields.io/badge/stability-unstable-green.svg)](http://github.com/badges/stability-badges)

Draw polyline with regl.

![regl-line2d](https://github.com/dfcreative/regl-line2d/blob/master/preview.png?raw=true)

Remake on [gl-line2d](https://github.com/gl-vis/gl-line2d):

* GPU join calculation
* Bevel, round and rectangular joins
* Customizable dash patterns
* Sharp angle joins handling with transparent colors
* Multiline rendering
* Float64 precision
* [`<polyline>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/polyline)-compatible API

[Demo](https://dfcreative.github.io/regl-line2d).

## Usage

[![npm install regl-line2d](https://nodei.co/npm/regl-line2d.png?mini=true)](https://npmjs.org/package/regl-line2d/)

```js
let regl = require('regl')({extensions: 'angle_instanced_arrays'})
let createLine2d = require('regl-line2d')

let line2d = createLine2d(regl)

// draw single line
line2d([0,0, 1,1])

// draw red triangle
line2d({thickness: 4, points: [0,0, 1,1, 1,0], close: true, color: 'red'})

// draw multiple lines
line2d([
  {thickness: 2, points: [0,0, 1,1], color: 'blue'},
  {thickness: 2, points: [0,1, 1,0], color: 'blue'}
])
```

### `createLine2d(regl, options?)`

Create new line2d instance from `regl` and initial `options`. Note that `regl` instance should have `ANGLE_instanced_arrays` extension enabled.

### `line2d(options|list?)`

Draw line and optionally update options.

Option | Default | Description
---|---|---
`positions`, `points`, `data` | `[]` | Array with sequence of coordinates for polyline, akin to sequence of `ctx.lineTo()` calls, eg. `[0,0, 1,1, 0,2, 1,-1]` or `[[0,0], [1,1], [0,2], [1,-1]]`.
`color`, `colors`, `stroke` | `black` | Color can be a css color string or an array with float `0..1` values.
`fill` | `null` | Fills area enclosed by line.
`opacity` | `1` | Regulate line transparency separately from colors.
`width`, `thickness`, `lineWidth`, `strokeWidth` | `1` | Line width or array with widths corresponding to polylines.
`dashes`, `dash`, `dasharray` | `null` | Array with dash lengths, altering color/space pairs, ie. `[2,10, 5,10, ...]`. Dash length is defined in pixels. If `null`, solid line will be rendered.
`miterLimit` | `1` | The limit on the ratio of the miter length to the thickness.
`range`, `dataBox` | `null` | Limit visible data.
`viewport`, `viewBox` | `null` | Limit visible area within the canvas.
`join` | `bevel` | Join style: `'rect'`, `'round'`, `'bevel'`. Applied to caps too.
`close`, `closed`, `closePath` | `false` | Connect last point with the first point with a segment.
`overlay` | `false` | Enable overlay of line segments.

To render multiple lines - pass an array with options for every line. `null` argument will destroy `drawLine` instance and dispose resources.

### `line2d.update(options|list)`

Update options, not incurring redraw.

### `line2d.draw(id?)`

Draw lines based on last options. `id` integer can specify a line to redraw.

### `line2d.destroy()`

Dispose line2d and associated resources.


## Related

* [regl-scatter2d](https://github.com/dfcreative/regl-scatter2d)
* [regl-error2d](https://github.com/dfcreative/regl-error2d)

## Similar

* [regl-line-builder](https://github.com/jpweeks/regl-line-builder)

## License

(c) 2017 Dima Yv. MIT License

Development supported by [plot.ly](https://github.com/plotly/).
