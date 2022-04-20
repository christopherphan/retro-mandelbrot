/* Retro-style text Mandelbrot explorer
 * Christopher Phan, cphan@chrisphan.com
 * github: christopherphan
 *
 * MIT License
 *
 * Copyright (c) 2022 Christopher Phan
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
*/

function createCanvas (rows, cols, id) {
  /* Create the spans that will be used as "pixels". */
  const canvasDiv = document.getElementById(id)
  let outText = ''
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      outText += `<span id="elt_${r}_${c}" class="outside">.</span>`
    }
    outText += '<br />\n'
  }
  canvasDiv.innerHTML = outText
}

function getCells (rows, cols) {
  /* Produce an array with all the "pixels" in the DOM. */
  const outArray = []
  for (let r = 0; r < rows; r++) {
    outArray[r] = []
    for (let c = 0; c < cols; c++) {
      outArray[r][c] = document.getElementById(`elt_${r}_${c}`)
    }
  }
  return outArray
}

function updateCanvas (row, col, inside, text, cellArray) {
  /* Change a "pixel" (class and text) */
  const elt = cellArray[row][col]
  elt.innerHTML = text
  if (inside) {
    elt.className = 'inside'
  } else {
    elt.className = 'outside'
  }
}

function setBGColor (row, col, color, cellArray) {
  /* Change the background color of a "pixel". */
  const elt = cellArray[row][col]
  elt.setAttribute('style', `background-color: ${color}`)
}

function resetBGColor (row, col, cellArray) {
  /* Remove the styling of a "pixel". */
  const elt = cellArray[row][col]
  elt.removeAttribute('style')
}

function computeDims (zoomLevel) {
  /* Compute the window width and height for a given zoom level) */
  const deltaReal = (INITIAL_LR.real - INITIAL_UL.real) / (4 ** zoomLevel)
  const deltaImag = (INITIAL_UL.imag - INITIAL_LR.imag) / (4 ** zoomLevel)
  return { real: deltaReal, imag: deltaImag }
}

function computeWindow (realCoord, imagCoord, zoomLevel) {
  /* Return the window coordinates given the center and zoom level */
  const dims = computeDims(zoomLevel)
  return {
    UL: { real: realCoord - dims.real / 2, imag: imagCoord + dims.imag / 2 },
    LR: { real: realCoord + dims.real / 2, imag: imagCoord - dims.imag / 2 }
  }
}

class ZoomSituation {
  /* This is the main class that is used to manipulate the "screen". */

  constructor (rows, cols, bailout, numIter, zoomTime) {
    /* Set the data to be passed to the WASM drawing function. */
    this.rows = rows
    this.cols = cols
    this.bailout = bailout
    this.numIter = numIter

    this.zoomTime = zoomTime * 1000 // convert to milliseconds

    // Get paramaters from the url bar
    let badInput = false
    let params
    let realParam
    let imagParam
    let zoomParam
    try {
      params = new URLSearchParams(location.search)
      realParam = parseFloat(params.get('real'))
      imagParam = parseFloat(params.get('imag'))
      zoomParam = parseInt(params.get('zoom'), 0)
    } catch { // Any exceptions will lead to just the default values
      badInput = true
    }
    if (badInput || isNaN(realParam) || isNaN(imagParam) || isNaN(zoomParam)) {
    /* If any parameter is missing or badly formed, use default
     * initial coordinates of the viewing window. */
      this.ulReal = INITIAL_UL.real
      this.ulImag = INITIAL_UL.imag
      this.lrReal = INITIAL_LR.real
      this.lrImag = INITIAL_LR.imag
      this.zoomLevel = 0
    } else {
      /* Use the provided coordinates */
      const coordInfo = computeWindow(realParam, imagParam, zoomParam)
      this.ulReal = coordInfo.UL.real
      this.ulImag = coordInfo.UL.imag
      this.lrReal = coordInfo.LR.real
      this.lrImag = coordInfo.LR.imag
      this.zoomLevel = zoomParam
    }

    this.lastZoomStart = 0 // Represents the last time a zoom was initiated

    /* This object is passed into the WASM function to be accessed by the WASM
     * virtual machine. */

    this.importObject = {
      imports: {
        setinside: setInside,
        setoutside: setOutside
      }
    }

    this.linkDiv = document.getElementById('permlink')
    this.resetHomotopies() // Initialize the zoom coordinate functions to be constant
    this.lastRefresh = 0 // Represents the last time the screen was refreshed
    this.currentlyZooming = false
    this.needUpdate = true // We will need to draw the screen initially.
  }

  resetHomotopies () {
    /* The homotopies are functions that control the zooming. When zooming,
     * the parameter t moves from 0 to 1 over the course of the zoom,
     * and the window corners are defined as functions of t to move linearly to the
     * target coordinates. However, when we are not zooming, these are reset to be
     * constant functions in t. */
    this.homotopies = {
      ulReal: t => this.ulReal,
      ulImag: t => this.ulImag,
      lrReal: t => this.lrReal,
      lrImag: t => this.lrImag
    }
    this.changePermlink()
  }

  render () {
    /* This is the main rendering method. It is run continuously. */
    const currentTime = new Date() * 1 // Multiply by 1 to ensure it becomes an integer
    // (Unix time * 1000) as opposed to a string.
    let t = 1 // If we aren't zooming, then the homotopies are constant functions,
    // and the value of t is irrelevent.
    if (this.currentlyZooming) {
      t = (currentTime - this.lastZoomStart) / (this.zoomTime) // What proportion of the
      // zoom has happened.
      if (t > 1) { // The zoom is over, go back to not being zoomed.
        this.needUpdate = true // One final update to finish the zoom
        this.currentlyZooming = false
        this.resetHomotopies()
      }
    }
    // Update the window corners
    this.ulReal = this.homotopies.ulReal(t)
    this.ulImag = this.homotopies.ulImag(t)
    this.lrReal = this.homotopies.lrReal(t)
    this.lrImag = this.homotopies.lrImag(t)

    /* Refresh the screen every 1/24 of a second while zooming
     * or at any time an update is manually requested. */
    if ((currentTime > this.lastRefresh + 1000 / 24 &&
        this.currentlyZooming) || this.needUpdate) {
      /* Call the WASM code to change the screen. */
      WebAssembly.instantiateStreaming(fetch('mandelbrot_web.wasm'), this.importObject)
        .then(obj => {
          obj.instance.exports.mandel(this.rows, this.cols, this.ulReal, this.ulImag,
            this.lrReal, this.lrImag, this.bailout, this.numIter)
        })
      this.lastRefresh = currentTime
      this.needUpdate = false
    }
  }

  /* Begin the zoom process, including finding the new target viewing window and
   * setting up the homotopies.
   * row and col represent the cell that has been clicked. */
  startZoom (row, col) {
    // We only zoom if the previous zoom has finished.
    if (new Date() * 1 > this.lastZoomStart + this.zoomTime) {
      this.currentlyZooming = true
      this.lastZoomStart = new Date() * 1
      const dim = computeDims(this.zoomLevel)
      // Calculate the width and length of each "pixel".
      const deltas = { real: dim.real / this.cols, imag: dim.imag / this.rows }
      // The new viewing window will be 1/16 of the screen.
      const newDim = computeDims(this.zoomLevel + 1)
      let newUlReal
      let newUlImag
      let newLrReal
      let newLrImag
      // At a certain point, we stop zooming in and zoom back out.
      if (this.zoomLevel < 10) {
        const clicked = {
          real: this.ulReal + deltas.real * col,
          imag: this.ulImag - deltas.imag * row
        }
        newUlReal = clicked.real - newDim.real / 2
        newUlImag = clicked.imag + newDim.imag / 2
        newLrReal = clicked.real + newDim.real / 2
        newLrImag = clicked.imag - newDim.imag / 2
        this.zoomLevel++
      } else {
        newUlReal = INITIAL_UL.real
        newUlImag = INITIAL_UL.imag
        newLrReal = INITIAL_LR.real
        newLrImag = INITIAL_LR.imag
        this.zoomLevel = 0
      }
      /* The homotopies will continuously move the coordinates from the previous
       * window to the new window. */
      this.homotopies = {
        ulReal: t => newUlReal * t + this.ulReal * (1 - t),
        ulImag: t => newUlImag * t + this.ulImag * (1 - t),
        lrReal: t => newLrReal * t + this.lrReal * (1 - t),
        lrImag: t => newLrImag * t + this.lrImag * (1 - t)
      }
    }
  }

  getCenter () {
    /* Find the center of the viewing window. */
    return { real: (this.ulReal + this.lrReal) / 2, imag: (this.ulImag + this.lrImag) / 2 }
  }

  changePermlink () {
    /* Put the permalink on the screen. */
    const center = this.getCenter()
    const realParam = center.real.toFixed(20)
    const imagParam = center.imag.toFixed(20)
    const url = ('https://chrisphan.com/retro_mandelbrot/?' +
      `real=${realParam}&imag=${imagParam}&zoom=${this.zoomLevel}`)
    this.linkDiv.innerHTML = (`<a href="${url}">${url}</a>`)
  }
}

// Define the constants.
const ROWS = 40
const COLS = 120
const BAILOUT = 16.0
const NUM_ITER = 5000
const ZOOM_TIME = 2.0
const INITIAL_UL = { real: -2.0, imag: 1.0 }
const INITIAL_LR = { real: 1.0, imag: -1.0 }

createCanvas(ROWS, COLS, 'mandelbrot')
const cells = getCells(ROWS, COLS)

/* Function for marking a "pixel" as inside the Mandelbrot set */
function setInside (row, col) {
  updateCanvas(row, col, true, '*', cells)
  resetBGColor(row, col, cells)
}

/* Function for marking a "pixel" as outside the Mandelbrot set
 * angle will be the H in HSL. */
function setOutside (row, col, angle) {
  updateCanvas(row, col, false, '.', cells)
  setBGColor(row, col, `hsl(${angle}, 50%, 50%)`, cells)
}

const zs = new ZoomSituation(ROWS, COLS, BAILOUT, NUM_ITER, ZOOM_TIME)

// Create event listeners for each pixel to that clicking will start the zoom process.
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    cells[r][c].onclick = function () { zs.startZoom(r, c) }
  }
}

function mainLoop () {
  zs.render()
  window.requestAnimationFrame(mainLoop)
}

mainLoop()
