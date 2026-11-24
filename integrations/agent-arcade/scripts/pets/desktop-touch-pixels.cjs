'use strict';
// Test-only tools for a pair of live pet.html windows. Install before loadFile.
// Render the same motion/skin/springs/WebGL at the same logical instant in each
// window. No production gesture, mesh, texture or shader is replaced.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {nativeImage} = require('electron');

function instrument() {
  if (!location.pathname.endsWith('/pet.html')) return;
  let frame = 0, now = 0, id = 0, seed = 0x76ea53cb, lastCapture;
  const frames = new Map(), timers = new Map();
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  Object.defineProperty(performance, 'now', {value: () => now});
  window.requestAnimationFrame = cb => { frames.set(++id, cb); return id; };
  window.cancelAnimationFrame = n => frames.delete(n);
  // Only the live pet's delayed greeting runs on the logical clock.
  // Keep loader and browser scheduling on the host's actual event loop.
  const timeout = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
  window.setTimeout = (callback, delay, ...args) => {
    if (delay !== 500) return timeout(callback, delay, ...args);
    const token = -(++id);
    timers.set(token, {at: now + delay, run: () => callback(...args)});
    return token;
  };
  window.clearTimeout = n => { if (!timers.delete(n)) clear(n); };
  window.__petTestSample = count => {
    if (document.title !== 'pet-ready') throw Error('Production pet renderer is not ready');
    if (!count && lastCapture) return lastCapture;
    if (!Number.isInteger(count) || count < 1 || count > 600) throw Error('Invalid number of frames');
    for (let i = 0; i < count; i++) {
      now = ++frame * 1000/30;
      for (const [token, event] of timers) {
        if (event.at <= now) { timers.delete(token); event.run(); }
      }
      const scheduled = [...frames.values()];
      if (!scheduled.length) throw Error('Production frame callback missing');
      frames.clear();
      for (const callback of scheduled) callback(now);
    }
    // Same JS task as the final render, before Chromium may discard a default
    // drawing buffer. Reading the WebGL canvas excludes cue DOM and the OS cursor.
    const canvas = document.getElementById('stage'), gl = canvas.getContext('webgl2');
    if (!gl || gl.isContextLost()) throw Error('Live WebGL context unavailable');
    const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
    const rgba = new Uint8Array(4 * width * height);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    if (gl.getError() !== gl.NO_ERROR) throw Error('WebGL framebuffer read failed');
    const copy = document.createElement('canvas');
    copy.width = width; copy.height = height;
    const ctx = copy.getContext('2d'), image = ctx.createImageData(width, height);
    let opaquePixels = 0;
    // readPixels is bottom-up; ImageData expects top-down, unpremultiplied RGB.
    for (let y = 0; y < height; y++) {
      let source = (height-1-y)*width*4, target = y*width*4;
      for (let x = 0; x < width; x++, source += 4, target += 4) {
        const alpha = rgba[source+3];
        if (alpha > 230) opaquePixels++;
        const scale = alpha ? 255 / alpha : 0;
        for (let c = 0; c < 3; c++) image.data[target+c] = rgba[source+c]*scale;
        image.data[target+3] = alpha;
      }
    }
    if (opaquePixels < width*height*.08) throw Error('Missing opaque character in WebGL framebuffer');
    ctx.putImageData(image, 0, 0);
    lastCapture = {frame, ms: now, gesture: document.body.dataset.gesture || '',
      activity: document.body.dataset.activity, width, height, opaquePixels,
      png: copy.toDataURL('image/png').split(',')[1]};
    return lastCapture;
  };
}

async function installPixelClock(contents) {
  // A new, never-navigated WebContents may have no DevTools Page target yet.
  if (!contents.getURL()) await contents.loadURL('about:blank');
  const cdp = contents.debugger;
  if (!cdp.isAttached()) cdp.attach('1.3');
  await cdp.sendCommand('Page.enable');
  await cdp.sendCommand('Page.addScriptToEvaluateOnNewDocument', {source: '(' + instrument.toString() + ')()'});
}

async function samplePetFrame(contents, frames, pngPath) {
  if (!Number.isSafeInteger(frames) || frames < 0 || frames > 600) throw Error('Invalid frame count');
  const {png, ...sample} = await contents.executeJavaScript('window.__petTestSample(' + frames + ')');
  const data = Buffer.from(png, 'base64');
  fs.mkdirSync(path.dirname(pngPath), {recursive: true});
  fs.writeFileSync(pngPath, data);
  return {...sample, sha256: createHash('sha256').update(data).digest('hex')};
}

function comparePetFrames(refPng, subjectPng) {
  const images = [refPng, subjectPng].map(p => nativeImage.createFromBuffer(fs.readFileSync(p)));
  const {width, height} = images[0].getSize(), other = images[1].getSize();
  if (images.some(i => i.isEmpty()) || width !== other.width || height !== other.height) {
    throw Error('Need two non-empty pet PNGs of equal size');
  }
  const [a,b] = images.map(i => i.toBitmap());
  // Ju, front camera, all three shipping pet window sizes. Intervals are
  // fractions of height from the horizontal window centre and of frame height.
  // The inner rectangle spans the eyes and eyebrows, clear of the mouth.
  const rect = (xmin, xmax, ymin, ymax) => [Math.floor(width/2 + xmin*height),
    Math.ceil(width/2 + xmax*height), Math.floor(ymin*height), Math.ceil(ymax*height)];
  const face = rect(-.18, .18, .27, .50), eye = rect(-.14, .14, .315, .455);
  const eyesWide = rect(-.24, .24, .33, .47);
  const inside = (box,x,y) => x >= box[0] && x < box[1] && y >= box[2] && y < box[3];
  // Ju's near-white sclera (#fffaf5) and catchlights disappear when she
  // closes her eyes. The skin (#ffe4d2) centre shifts right as she turns.
  // Use opaque pixels from the rendered model, including the turned-face
  // location. Electron nativeImage.toBitmap on Windows/macOS is BGRA.
  const feature = [{white:0,skin:0,skinX:0},{white:0,skin:0,skinX:0}];
  let wholeDiff = 0, faceDiff = 0, eyeDiff = 0, eyeOccupancy = 0, exactDiff = 0;
  for (let y = 0, p = 0; y < height; y++) for (let x = 0; x < width; x++, p+=4) {
    if (inside(eyesWide, x, y)) {
      for (let i=0; i<2; i++) {
        const bmp = i === 0 ? a : b, f = feature[i];
        if (bmp[p+3] < 250) continue;
        const blue=bmp[p], green=bmp[p+1], red=bmp[p+2];
        if (red >= 244 && green >= 238 && blue >= 230) f.white++;
        if (red >= 250 && green >= 222 && green <= 232 && blue >= 202 && blue <= 217) {
          f.skin++; f.skinX += x;
        }
      }
    }
    const eyePixel = inside(eye,x,y) && a[p+3] >= 230 && b[p+3] >= 230;
    if (eyePixel) eyeOccupancy++;
    const delta = Math.max(Math.abs(a[p]-b[p]), Math.abs(a[p+1]-b[p+1]),
      Math.abs(a[p+2]-b[p+2]), Math.abs(a[p+3]-b[p+3]));
    if (delta) exactDiff++;
    if (delta < 12) continue;
    wholeDiff++;
    if (inside(face,x,y)) faceDiff++;
    if (eyePixel) eyeDiff++;
  }
  return {width, height, wholeDiff, exactDiff, faceDiff, eyeDiff, eyeOccupancy,
    eyeWhites: feature.map(f => f.white), eyeBandSkinPixels: feature.map(f => f.skin),
    faceCentreShiftX: feature.every(f => f.skin) ? feature[1].skinX/feature[1].skin-feature[0].skinX/feature[0].skin : null,
    featureBounds: eyesWide,
    eyeArea: (eye[1]-eye[0])*(eye[3]-eye[2]), eyeBounds: eye, faceBounds: face};
}

module.exports = {installPixelClock, samplePetFrame, comparePetFrames};
