'use strict'

require('enable-mobile')
const createLine = require('./')
const panZoom = require('pan-zoom')
const fps = require('fps-indicator')({css:`padding: 1.4rem`})
const random = require('gauss-random')
const rgba = require('color-rgba')
const nanoraf = require('nanoraf')
const palettes = require('nice-color-palettes')
const createScatter = require('regl-scatter2d')
const regl = require('regl')({extensions: ['ANGLE_instanced_arrays', 'OES_element_index_uint']})

let ratio = window.innerWidth / window.innerHeight
let range = [ -5 * ratio, -5, 5 * ratio, 5 ]
let palette = palettes[ Math.floor(Math.random() * palettes.length) ]


var N = 1e5

var positions = new Float32Array(2 * N)
for(var i=0; i<2*N; i+=2) {
  // positions[i]   = (i/N)*10.0-10.0
  positions[i] = random() * 2
  positions[i+1] = random() * 2
}

// positions = [-2.5,0, 0,2,.5,-3]
positions = [-3,4, -3,0, -1,0, -.7,-.5, 0,1, -.5,-.5, .5,1, 0,0, .5,.5, 1,0.5, 2,2, 5,-3, -1,-1.5, -2.5,-2, -5,-3, -4,1, -5,1, -4,-1]

let colors = Array(N).fill(0).map(() => palette[Math.floor(Math.random() * palette.length)])

let viewport =  [0, 200, 600, 500]

let drawLine = createLine({
  regl: regl,
  positions: positions,

  miterlimit: 4,

  width: 10,
  // dashes: [10, 5],
  // color: colors,
  color: 'rgba(0, 0, 255, .5)',
  // color: ['red', 'green', 'blue'],

  range: range,

  viewport
})

let drawPoints = createScatter({
  regl: regl,
  positions: positions,
  size: 8,
  borderSize: 0,// Array(N).fill(0),
  color: 'rgba(255,0,0,.15)',
  // colors: colors,
  range: range,

  viewport
})

function draw(opts) {
  regl._refresh()
  drawLine(opts)

  regl._refresh()
  drawPoints(opts)
}

draw()

setTimeout(() => {
  draw()
}, 200)

//interactions
let prev = null
var frame = nanoraf(draw)

let cnv = document.body.querySelectorAll('canvas')[1]

panZoom(cnv, e => {
  let w = cnv.offsetWidth
  let h = cnv.offsetHeight

  let rx = e.x / w
  let ry = e.y / h

  let xrange = range[2] - range[0],
    yrange = range[3] - range[1]

  if (e.dz) {
    let dz = e.dz / w
    range[0] -= rx * xrange * dz
    range[2] += (1 - rx) * xrange * dz

    range[1] -= (1 - ry) * yrange * dz
    range[3] += ry * yrange * dz
  }

  range[0] -= xrange * e.dx / w
  range[2] -= xrange * e.dx / w
  range[1] += yrange * e.dy / h
  range[3] += yrange * e.dy / h

  let state = {range: range}
  frame(state, prev)
  prev = state
})


window.addEventListener('resize', () => {
  draw()
})
