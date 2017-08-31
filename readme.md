# regl-line2d [![experimental](https://img.shields.io/badge/stability-unstable-green.svg)](http://github.com/badges/stability-badges)

Draw line for a sequence of points.

![regl-line2d](https://github.com/dfcreative/regl-line2d/blob/master/preview.png?raw=true)

Remake on [gl-line2d](https://github.com/gl-vis/gl-line2d):

* enabled miter antialiasing
* fixed transparent color miter overlapping
* max number of lines extended from 1e5 to ...
* optimized performance via instanced draws
* fast 1px line mode

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

### `drawLines = require('regl-line2d')(options|regl)`

Create a function drawing line for connected points.

Option | Default | Description
---|---|---
`regl` | `null` | Regl instance to reuse, otherwise new regl is created.
`gl`, `canvas`, `container`, `pixelRatio` | `null` | Options for `regl`, if new regl instance is created.
`...rest` | | `drawLines(rest)` is invoked with the rest of options.

### `drawLines(points|options?)`

Draw line and optionally update options.

Option | Default | Description
---|---|---
`positions` | Array with sequence of points to connect lines, akin to sequence of `ctx.lineTo()` calls, eg. `[0,0, 1,1, 0,2, 1,-1]`
`color` | Array with channel values `[0, .2, .5, 1]`
`width` | Line width, number, defaults to `1`
`miterLimit` | `2`
`join` | `'miter'`, `'round'`, `'bevel'`
`cap` | `'square'`
`dashes` | Array with dash lengths, altering color/space pairs, ie. `[2,10, 5,10, ...]`
`range` | `null` | Limit visible data.
`viewport` | `null` | Limit visible area within the canvas.

## License

(c) 2017 Dima Yv. MIT License

Development supported by plot.ly.
