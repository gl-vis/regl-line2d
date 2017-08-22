'use strict'

require('enable-mobile')
const createErrors = require('./')
const panZoom = require('pan-zoom')
const fps = require('fps-indicator')({css:`padding: 1.4rem`})
const random = require('gauss-random')
const rgba = require('color-rgba')
const nanoraf = require('nanoraf')
const palettes = require('nice-color-palettes')


let ratio = window.innerWidth / window.innerHeight
let range = [ -10 * ratio, -10, 10 * ratio, 10 ]
let colors = palettes[ Math.floor(Math.random() * palettes.length) ]


var N = 1e3

var positions = new Float32Array(2 * N)
for(var i=0; i<2*N; i+=2) {
  positions[i]   = (i/N)*10.0-10.0
  positions[i+1] = random()
}

positions[11] = 1e10



let drawLine = createErrors({
  positions: positions,

  // color: Array(N).fill(0).map(() => colors[Math.floor(Math.random() * colors.length)]),
  color: 'rgba(0, 0, 127, 1)',

  range: range
})

drawLine()


//interactions
let prev = null
var frame = nanoraf(drawLine)

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
  drawLine()
})
