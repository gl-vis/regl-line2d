# regl-line2d [![experimental](https://img.shields.io/badge/stability-unstable-green.svg)](http://github.com/badges/stability-badges)

Draw polyline with regl.

![regl-line2d](https://github.com/dfcreative/regl-line2d/blob/master/preview.png?raw=true)

Remake on [gl-line2d](https://github.com/gl-vis/gl-line2d):

* GPU miter calculation
* bevel, round and rect miter modes
* correct transparent color handling in joins
* optimized performance via instanced draws
* multiple colors support
* `<polyline>`-compatible API

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

### `drawLine(points|options?)`

Draw line and optionally update options. If plain `points` array passed - it will just update the positions. `null` argument will destroy instance and dispose resources.

Option | Alias | Default | Description
---|---|---|---
`positions` | `points`, `data` | `[]` | Array with sequence of coordinates for polyline, akin to sequence of `ctx.lineTo()` calls, eg. `[0,0, 1,1, 0,2, 1,-1]` or `[[0,0], [1,1], [0,2], [1,-1]]`
`color` | `colors`, `stroke` | `black` | Color or array with colors. Each color can be a css color string or an array with float `0..1` values.
`width` | `thickness`, `lineWidth`, `strokeWidth` | `1` | Line width.
`miterlimit` |  | `1` | The limit on the ratio of the miter length to the thickness.
`dashes` | `dasharray` | `null` | Array with dash lengths, altering color/space pairs, ie. `[2,10, 5,10, ...]`. Dash length is defined in pixels. If `null`, solid line will be rendered.
`range` | `dataBox` | `null` | Limit visible data.
`viewport` | `viewBox` | `null` | Limit visible area within the canvas.
`precise` | | `false` |
`join` | | `bevel` | TODO: `'miter'`, `'round'`, `'bevel'`
`cap` | | `square` | TODO: `'square'`
`close` | | `false` | TODO
`fill` | | `none` | TODO: `'none'`

Processed options are exposed in `drawLine.state` object, along with `drawLine.draw`, `drawLine.update` and `drawLine.destroy` methods.

## Related

* [regl-scatter2d](https://github.com/dfcreative/regl-scatter2d)
* [regl-error2d](https://github.com/dfcreative/regl-error2d)

## See also

* [`<polyline>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-miterlimit) svg element.


## License

(c) 2017 Dima Yv. MIT License

Development supported by [plot.ly](https://github.com/plotly/).
